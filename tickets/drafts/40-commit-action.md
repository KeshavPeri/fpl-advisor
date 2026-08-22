## Context

**Feature-list item 19.** The app tells Keshav what to do and has no way for him to say he has done
it. Every recommendation is read and then forgotten; nothing records which advice was taken, so
nothing downstream can ever ask whether taking it was right.

`product-brief.md` §1 frames the whole app around a single act — *"so that acknowledging the
notification and deciding are the same act"*. `design-reference.md` commits the interaction
explicitly: **"One tap to commit each recommendation, individually. No 'accept all'."**

This ticket builds the commit half only. Item 20 (override registration — recording that Keshav did
something *other* than what was recommended, with deliberate friction) is the other half and is a
separate ticket that depends on this one.

Depends on item 17, the verdict card (merged, #61, corrected by #68 and #72) and item 13,
recommendations (merged, #47/#60). Nothing unmerged.

### The one thing that must not be misunderstood

**Committing records a decision. It does not make a transfer.** The FPL API is never authenticated
and `my-team/` is never called — `product-brief.md` §6a, and the reason the app needs no FPL
account at all. Keshav makes the actual transfer in the FPL app; this button records that the
recommendation was accepted, so the decision ledger and later accuracy work have something to read.
**Any implementation that attempts to write to fantasy.premierleague.com, or that asks for an FPL
credential, is a Tier 1 stop.**

## Scope

**In scope:**

- **A new table `public.recommendation_decisions`**, in migration file
  **`supabase/migrations/20260823090000_recommendation_decisions.sql`** — the filename is pinned
  because two tickets in one batch have collided on a migration timestamp before.
  - Columns: `id` identity primary key; `gameweek_id` referencing `gameweeks`; `plan_index`
    smallint; `kind text NOT NULL CHECK (kind IN ('commit', 'override'))`; `decided_at timestamptz
    NOT NULL DEFAULT now()`; and `snapshot jsonb NOT NULL` holding what was actually committed —
    `is_roll`, `transfer_in_player_id`, `transfer_out_player_id`, `captain_player_id`,
    `vice_captain_player_id`, `hit_cost`, and the recommendation's `solver_run_id`.
  - **Append-only, as a database guarantee:** RLS enabled, `SELECT` policy for `anon`, and
    `GRANT SELECT, INSERT` to `anon` and to `service_role` — **no `UPDATE`, no `DELETE` to anyone.**
    Same shape as the `notifications` migration, for the same reason.
  - **RLS and GRANTs both, in this same file.** A policy without a grant gives
    `permission denied for table X`; a grant without a policy gives
    `new row violates row-level security policy`. This has cost a failed run before — `deltas.md` D8.
  - A unique index on `(gameweek_id, plan_index, kind)` so one gameweek cannot be committed twice.
- **A commit control on the verdict card** — one tap, on the recommendation it belongs to, per
  `design-reference.md`. It writes one `recommendation_decisions` row with `kind = 'commit'` and the
  snapshot above.
- **The committed state is visible and persists** across a reload: a card whose gameweek already has
  a `commit` row renders as committed rather than offering the action again.
- **A new `src/lib/commit/` module** following the established `src/lib/verdict/` shape: `api.ts`
  (Supabase read and write), `derive.ts` (pure state logic), `types.ts`. `derive.ts` must be pure
  and directly unit-tested; the component does no derivation.

**Explicitly out of scope:**

- **No FPL API write of any kind, and no FPL credential.** See Context. Tier 1.
- **No override registration.** Item 20. This ticket writes `kind = 'commit'` only; the `'override'`
  value exists in the CHECK constraint so item 20 needs no second migration, and nothing in this
  ticket writes it.
- **No undo, no edit, no delete.** The table is append-only by grant. If a mis-tap needs undoing,
  that is a real requirement and it belongs in item 20's design, not bolted on here.
- **No accept-all, no multi-select, no bulk action.** Explicitly banned by `design-reference.md`.
- **No change to how recommendations are generated, stored or scored.** Nothing under `scripts/`
  changes.
- **No Plan B or Plan C commit.** Plan A only (`plan_index = 0`), matching the card's existing scope.
- No new npm dependency.

## Definition of done

- [ ] `supabase/migrations/20260823090000_recommendation_decisions.sql` exists with exactly that
      filename, is idempotent (`IF NOT EXISTS` / `DROP POLICY IF EXISTS`), and applies cleanly.
- [ ] That migration contains both a `CREATE POLICY` for `anon` **and** explicit `GRANT` statements.
      Grep-checkable: the strings `GRANT SELECT` and `CREATE POLICY` both appear in it.
- [ ] The migration grants **no** `UPDATE` and **no** `DELETE` on the new table to any role.
      Grep-checkable: the strings `UPDATE ON public.recommendation_decisions` and
      `DELETE ON public.recommendation_decisions` appear nowhere.
- [ ] Tapping commit writes exactly one row with `kind = 'commit'`, the correct `gameweek_id`, and a
      `snapshot` containing all seven fields named in Scope.
- [ ] A second tap on an already-committed gameweek does not write a second row and does not surface
      an error to the user — the unique index is the guarantee and the interface must not depend on
      it firing.
- [ ] The committed state survives a page reload, read back from the table rather than held in
      component state. Asserted by a unit test on `derive.ts` with a stored decision present and
      absent.
- [ ] `src/lib/commit/derive.ts` is pure: the strings `supabase`, `fetch` and `useEffect` appear
      nowhere in it.
- [ ] **No file under `scripts/` is modified, and the strings `fantasy.premierleague.com` and
      `my-team` appear nowhere in this ticket's diff.** Grep-checkable — this is the Tier 1 guard.
- [ ] The action keeps its name through the flow: the control says **Commit** and the committed
      state says **Committed** — never *Submit*, *Save* or *Done*. `design-reference.md`'s
      interface-writing rule.
- [ ] A write failure renders a specific message saying what failed and what to do, not a generic
      error and not a silent no-op. Asserted by a unit test on the derived view.
- [ ] `design-reference.md` compliance: Geist and Geist Mono, no green, no yellow, no purple, no
      emoji, translucent layered surface via the existing `Surface` component, and the commit action
      is one of the two interactions `design-reference.md` says may be animated — subtle, and
      respecting `prefers-reduced-motion`.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests run against a mocked Supabase client, so they
      cannot prove the live RLS policy and GRANT actually permit an `anon` insert — and a local
      Postgres test is blind to grants entirely, because it runs as superuser (`deltas.md` D8).
      The human check after merge is: apply the migration in the Supabase SQL editor, open the
      preview URL, tap commit, and confirm a row appears in `recommendation_decisions`.

## Notes for the Analyst / Builder

**The Tier 2 decision, pre-answered with its *because*: a separate table, not a column on
`recommendations`.** `recommendations` is upserted every solver run and ticket #60 added a `DELETE`
grant on it so a re-run can remove orphaned plans — **so a commit recorded on that table could be
destroyed by the next nightly run.** A decision is a historical fact about what Keshav did; it must
outlive the recommendation it refers to. That is also why the row carries a `snapshot` rather than
only a foreign key: the recommendation it points at may be replaced, and the ledger must still say
what was actually accepted.

**Why `kind` exists now when only one value is written.** Item 20 records overrides into the same
ledger. Adding the column and its CHECK constraint now costs nothing and saves a second migration
and a second manual apply step later. It is a Tier 2 call — expensive to reverse after ten more
tickets — and it is made here deliberately.

**Precedent for granting `anon` write access.** `supabase/migrations/20260811180000_squad_state.sql`
already grants `anon` `INSERT`, `UPDATE` and `DELETE` on `squads` and `squad_picks` for the manual
squad-entry screen (#13). This app has no authentication by design and is personal-use; an `anon`
`INSERT` on an append-only ledger is the same shape and is **not** a Tier 1 escalation. Do not
block on it — but do withhold `UPDATE` and `DELETE`, which is what makes append-only real rather
than promised.

**Every Supabase read must paginate**, per the convention `src/lib/verdict/api.ts` already
establishes. This table will be small for a long time, and the rule is about the class of bug, not
the current row count — Supabase silently caps at 1,000 with no error and no flag.

**Read `src/lib/verdict/` before writing `src/lib/commit/`.** It is the established shape for this
exact kind of module and the card already renders from it; matching it is cheaper than inventing a
second pattern, and the verdict card's own reads already solve the gameweek and solver-run filtering
this ticket needs.

**This ticket extends existing UI rather than establishing new visual direction**, so the
`frontend-design` skill is **not** invoked and Impeccable is **not** invoked (`CLAUDE.md`'s
design-pass rule). Match the verdict card's existing components and tokens.

**Two other tickets may be running in this batch.** One owns `scripts/build-solver-input.ts` and
`.github/workflows/solver-run.yml`; the other owns `src/App.tsx`, `src/screens/` and a new
`src/lib/chips/`. This ticket touches none of them — in particular, **do not add a route to
`src/App.tsx`**; the commit control lives on the verdict card, which is already on the home screen.

## Scope constraint

Nothing outside the following files changes:

- `supabase/migrations/20260823090000_recommendation_decisions.sql` (new)
- `src/lib/commit/api.ts` (new), `src/lib/commit/derive.ts` (new), `src/lib/commit/types.ts` (new),
  `src/lib/commit/derive.test.ts` (new)
- `src/components/VerdictCard.tsx`, `src/components/VerdictCard.css`
- `supabase/README.md` (the applied-migrations table gains a row for the new migration, marked
  not yet applied)
- `decisions/ticket-<this issue number>.md`

No workflow file is touched. Nothing under `scripts/` changes. `src/App.tsx`, `src/screens/` and
`src/lib/verdict/` are not modified.
