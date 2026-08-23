## Context

**Feature-list item 20.** The commit action (item 19, merged as ticket #84) records that Keshav took
the recommendation. Nothing records that he did **not** — which is the more interesting half, because
the weeks the model was overruled are exactly the weeks worth measuring it against.

`design-reference.md` commits the interaction and its shape: **"Registering an override carries
deliberate friction — a confirm step that shows what the model expected and what it is being
overridden with. The friction is the feature; it makes the ledger entry meaningful."**

Depends on item 19 (merged, #84) and item 7, squad sync (merged, #14). Nothing unmerged.

### The storage already exists — this ticket adds no migration

`supabase/migrations/20260823090000_recommendation_decisions.sql` created
`public.recommendation_decisions` with `kind text NOT NULL CHECK (kind IN ('commit', 'override'))`
and a free-shaped `snapshot jsonb`. The `'override'` value is already accepted by the CHECK
constraint and is written by nothing. **That was deliberate — see `decisions/ticket-84.md` — so this
ticket needs no schema change, no second migration, and no manual apply step.** The table is
append-only by grant (`SELECT, INSERT` only, no `UPDATE`, no `DELETE`), which is the property that
makes a decision ledger worth having.

### The one thing that must not be misunderstood

**Registering an override records a decision. It does not make a transfer.** The FPL API is never
authenticated and `my-team/` is never called — `product-brief.md` §6a, and the reason the app needs
no FPL account. Keshav makes the actual moves in the FPL app; this screen records what he did.
**Any implementation that attempts to write to fantasy.premierleague.com, or that asks for an FPL
credential, is a Tier 1 stop.**

## Scope

**In scope:**

- **A new `/override` screen** (`src/screens/OverrideScreen.tsx`), registered in `src/App.tsx`,
  reached from the verdict card alongside the existing commit control.
- **A two-step flow, and the two steps are the friction:**
  1. **Enter what was actually done** — captain, vice-captain, and the transfer decision (rolled, or
     one player out and one player in).
  2. **Confirm against the recommendation** — a panel showing, side by side, what the model
     recommended and what is about to be recorded, with the differences visible. Only then does the
     write happen.
- **Captain and vice-captain are chosen from the 15 players in `squad_picks`** for that gameweek.
  The transfer-out player is likewise chosen from those 15; the transfer-in player is chosen from
  `players`, filtered to the same position as the player going out.
- **Reuse the existing selection pattern.** `src/screens/SquadEntryScreen.tsx` already solves
  position-filtered player selection with plain `<select>` elements over a list loaded by
  `src/lib/squad/api.ts`. **Read that file and follow it** — this ticket reads
  `src/lib/squad/api.ts` and does not modify it.
- **A new `src/lib/override/` module** — `api.ts` (Supabase reads and the one insert), `derive.ts`
  (pure: validation, the difference between recommended and actual, and the resulting view state),
  `types.ts`. `derive.ts` must be pure and directly unit-tested; the screen does no derivation.
- **The written row** carries `kind = 'override'`, the recommendation's own `gameweek_id` and
  `plan_index`, and a `snapshot` using the **same key names** the commit snapshot uses —
  `is_roll`, `transfer_in_player_id`, `transfer_out_player_id`, `captain_player_id`,
  `vice_captain_player_id`, `hit_cost`, `solver_run_id` — so one query can read both kinds.
- **One decision per gameweek, enforced in the interface:** a gameweek that already has a `commit`
  row does not offer the override entry point, and one that already has an `override` row shows the
  registered override rather than the form.

**Explicitly out of scope:**

- **No FPL API write of any kind, and no FPL credential.** See Context. Tier 1.
- **No migration, no schema change, nothing under `supabase/`.** The table, the CHECK value and the
  grants all already exist.
- **No undo, no edit, no delete.** The ledger is append-only by grant. If a mis-entry needs
  correcting, that is a real requirement and it needs its own ticket and its own design — do not
  work around the grants.
- **No hit-cost entry field.** See Notes: the real cost arrives from the FPL API and must not be
  typed by hand.
- **No chip selection.** Recording which chip was played is item 25's territory and the chip state
  screen already reads it from the API. An override that coincides with a chip is still just a
  captain-and-transfer record here.
- **No multi-transfer entry.** One out, one in, or a roll. A gameweek with two or more transfers is
  recorded as a roll being overridden with a transfer, and the FPL API's own transfer history
  remains the authoritative record of exactly what moved. **State this limitation on the screen**
  rather than silently truncating it.
- **No change to the commit flow, to `src/lib/commit/`, or to how the recommendation is generated.**
- No new npm dependency.

## Definition of done

- [ ] `/override` renders as a route in `src/App.tsx` and is reachable from the verdict card.
- [ ] `src/lib/override/derive.ts` is pure: the strings `supabase`, `fetch` and `useEffect` appear
      nowhere in it.
- [ ] **The write cannot happen from step one.** A unit test asserts the derived view exposes no
      confirmable state until the confirm step has been reached, and that reaching it requires a
      complete entry.
- [ ] The confirm panel states both sides explicitly — what was recommended and what will be
      recorded — and names every field that differs. Asserted by a unit test comparing a
      recommendation against an entry that differs in captain only, in transfer only, and in both.
- [ ] An entry identical to the recommendation is **refused with a specific message** telling Keshav
      to use Commit instead. Asserted by a unit test. *(An "override" that matches the
      recommendation is a commit, and recording it as an override would poison the one measurement
      this ledger exists to support.)*
- [ ] Registering writes exactly one row with `kind = 'override'` and a `snapshot` carrying all
      seven key names listed in Scope, with `hit_cost` explicitly `null`.
- [ ] The transfer-in selector offers only players in the same position as the transfer-out player,
      and excludes players already in the squad. Named test for each rule.
- [ ] A gameweek with an existing `commit` row does not offer the override entry point; a gameweek
      with an existing `override` row shows the registered override rather than the form. Asserted
      by unit tests on the derived view for both cases.
- [ ] **No file under `scripts/` or `supabase/` is modified, and the strings
      `fantasy.premierleague.com` and `my-team` appear nowhere in this ticket's diff.**
      Grep-checkable — this is the Tier 1 guard.
- [ ] The action keeps its name through the flow: the control says **Register override**, the
      confirm step says **Register override**, and the recorded state says **Override registered** —
      never *Submit*, *Save* or *Done*. `design-reference.md`'s interface-writing rule.
- [ ] A write failure renders a specific message saying what failed and what to do, not a generic
      error and not a silent no-op. Asserted by a unit test.
- [ ] `design-reference.md` compliance: Geist and Geist Mono with tabular figures; translucent
      layered surfaces via the existing `Surface` component, not flat bordered cards; no green, no
      yellow, no purple; no emoji; sentence case, plain verbs, no filler.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests run against a mocked Supabase client, so they
      cannot prove the live RLS policy and GRANT permit an `anon` insert of `kind = 'override'` —
      and a local Postgres test is blind to grants entirely, because it runs as superuser
      (`deltas.md` D8). The commit path proved the same grants work for `kind = 'commit'` on the
      same table, which is strong but not identical evidence. The human check after merge is opening
      the preview URL, registering an override, and confirming the row appears in
      `recommendation_decisions` with `kind = 'override'`.

## Notes for the Analyst / Builder

**Why there is no hit-cost field, stated as a *because*.** A points hit is a number Keshav would
have to compute and type, and a hand-typed number in a ledger is a number that will eventually be
wrong. **The real figure already arrives from the FPL API** — `entry/{id}/`'s transfer data is read
by `scripts/sync-squad.ts` after every deadline — so the honest design is to leave `hit_cost` null
in the override snapshot and let the authoritative source fill that gap later. Recording what was
decided is this screen's job; recording what it cost is the API's.

**Why an override identical to the recommendation is refused rather than accepted.** The whole point
of two `kind` values is that a later ticket can ask "in the weeks Keshav overruled the model, was he
right?" An override row that matches the recommendation makes that question unanswerable. Refuse it
and point at Commit.

**The friction is the requirement, not an obstacle to minimise.** `design-reference.md` says so
explicitly. Do not collapse the two steps into one, do not add a "skip confirmation" affordance, and
do not pre-fill the entry with the recommendation's own values — pre-filling would turn the confirm
step into a formality and produce exactly the accidental identical-override the rule above exists to
catch.

**One decision per gameweek is an interface rule, not a database guarantee — and the code should say
so where it is implemented.** The unique index is on `(gameweek_id, plan_index, kind)`, so a
`commit` row and an `override` row for the same gameweek can coexist as far as the database is
concerned. The screen prevents it. If that gap ever bites, the fix is a partial unique index in a
later migration; **do not add one here**, and do not weaken the interface rule on the grounds that
the database allows it.

**Read `src/lib/commit/` and `src/screens/SquadEntryScreen.tsx` before writing anything.** The first
is the established shape for writing to this exact table, including how it handles the
unique-violation race (`isAlreadyCommittedError`, Postgres code `23505`); the second is the
established pattern for position-filtered player selection. Matching both is cheaper than inventing
a third pattern, and the repo's rule against duplicating logic applies.

**Every Supabase read must paginate**, per the convention `src/lib/verdict/api.ts` establishes. The
`players` read in particular returns roughly 600 rows and Supabase silently caps a query at 1,000
with no error and no flag.

**This ticket establishes a genuinely new surface**, so the `frontend-design` skill **is** invoked
per `CLAUDE.md`'s design-pass rule. It must nonetheless reuse the existing design tokens, the
`Surface` component and the established type scale — a new surface is not a new design system.
**Impeccable and emil-design-eng are NOT invoked**; this is not a polish ticket.

**Two other tickets may be running in this batch.** One owns `scripts/preflight-check.ts`; the other
owns `scripts/send-telegram.ts`, `scripts/notification-schedule.ts` and
`src/lib/notification/message.ts`. This ticket touches none of them, and nothing under `scripts/` at
all.

## Scope constraint

Nothing outside the following files changes:

- `src/lib/override/api.ts` (new), `src/lib/override/derive.ts` (new),
  `src/lib/override/types.ts` (new), `src/lib/override/derive.test.ts` (new)
- `src/screens/OverrideScreen.tsx` (new), `src/screens/OverrideScreen.css` (new)
- `src/App.tsx` (the route registration only)
- `src/components/VerdictCard.tsx`, `src/components/VerdictCard.css` (the link through only)
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/` changes. No workflow file is touched.
Nothing under `scripts/` changes. `src/lib/commit/`, `src/lib/squad/` and
`src/screens/SquadEntryScreen.tsx` are read but not modified.
