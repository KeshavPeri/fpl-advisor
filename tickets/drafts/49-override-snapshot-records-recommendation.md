## Context

**A specification defect in ticket #103, correctly caught and reported by the Builder rather than
faked.** Read `decisions/ticket-103.md` before anything else.

The decision-history screen was asked to show, for each override, **which fields differed from what
the model recommended**. That turned out to be uncomputable: `recommendation_decisions.snapshot`
only ever holds the seven *decided* values, never a recommended counterpart. The Builder refused to
fill the gap by reading `recommendations` live — which would have silently labelled tonight's plan
as last week's, since that table is upserted by every solver run — narrowed the scope, and shipped
an honest note saying the original recommendation was not preserved and cannot be compared.

**That was the right call and the ticket was wrong, not the build.** The fault is upstream, at
drafting, and it is the same shape as the four specification defects in
`LEARNINGS-first-build-wave.md` §2 and the four in `LEARNINGS-second-build-wave.md` §7 — a
definition of done no correct implementation could meet.

### Why the fix belongs at the write path

The comparison is only knowable **at the moment the override is registered**, because that is the
only moment both sides exist together: the override screen already fetches the recommendation to
build its confirm panel, and already computes the difference to render it. It then discards the
recommended side and stores only what was decided.

**`snapshot` is a free-shaped `jsonb` column.** Recording the recommended side alongside the decided
one needs **no migration, no schema change and no manual apply step** — the same property that let
the `override` kind ship without one.

Depends on item 19 (merged, #84), item 20 (merged, #91) and the decision history (merged, #103).
Nothing unmerged.

## Scope

**In scope:**

- **`src/lib/override/api.ts`'s `registerOverride` writes a `recommended` object into the
  snapshot**, alongside the existing seven decided keys — carrying the same field names, sourced
  from the recommendation the confirm step compared against: `is_roll`, `transfer_in_player_id`,
  `transfer_out_player_id`, `captain_player_id`, `vice_captain_player_id`, `hit_cost`,
  `solver_run_id`.
- **`src/lib/override/types.ts` types it**, and `OverrideTarget` carries the recommended side
  through from the screen, which already holds it.
- **`src/lib/decisions/` renders the comparison when `recommended` is present**, naming the fields
  that differ — the three cases the original ticket asked for: captain only, transfer only, both.
- **When `recommended` is absent, the existing honest gap note stays exactly as it is.** Every
  override recorded before this ticket has no recommended side and never will; **that data does not
  exist and must not be invented.** The note is the correct output for those rows, permanently.
- **A commit entry is unchanged.** A commit *is* the recommendation, so there is nothing to compare.

**Explicitly out of scope:**

- **No migration, no schema change, nothing under `supabase/`.** `snapshot` is `jsonb`.
- **No backfill of past overrides.** The recommended side was never stored and cannot be
  reconstructed; the table is append-only by grant and writing a fabricated value into it would be
  worse than the gap. **Do not attempt it, and do not add an UPDATE path.**
- **No reading of `recommendations` from the decision-history screen**, now or ever. That is exactly
  what #103 refused to do and the reason is unchanged: the row is replaced every night.
- **No change to the override flow's two-step friction, its validation, or its refusal of an
  identical-to-recommendation entry.**
- **No change to `src/lib/commit/`.** A commit needs no recommended side.
- **No change to the reasoning screen, the verdict card, or anything under `scripts/`.**
- No new npm dependency.

## Definition of done

- [ ] `registerOverride` writes a `recommended` object inside `snapshot` containing all seven key
      names listed in Scope. Named unit test asserting the exact written shape.
- [ ] The seven existing top-level decided keys are **unchanged** in name, position and value — a
      unit test asserts the full written snapshot object, so an accidental rename or nesting of the
      decided side fails the build. **This is the ticket's most important test:**
      `src/lib/decisions/` and any future reader depend on those key names.
- [ ] With `recommended` present, the decision-history entry names the fields that differ. Named
      tests for captain-only, transfer-only, and both — the three the original ticket asked for,
      now genuinely satisfiable.
- [ ] With `recommended` present and **nothing** differing, the entry says so rather than rendering
      an empty difference list. Named test. *(The override screen refuses an identical entry, so
      this should be unreachable — but a stored row is a fact and the reader must not assume the
      writer's validation held.)*
- [ ] With `recommended` absent, the existing gap note renders exactly as it does today, and the
      existing `#103` tests covering it pass **unmodified**. If one needs changing, that is a signal
      the ticket has gone too far.
- [ ] A `recommended` object present but missing a key renders that field as not recorded rather
      than erroring or showing "null". Named test.
- [ ] `src/lib/decisions/derive.ts` and `src/lib/override/derive.ts` both stay pure: the strings
      `supabase`, `fetch` and `useEffect` appear in neither.
- [ ] **Tier 1 guard, grep-checkable:** the strings `fantasy.premierleague.com` and `my-team` appear
      nowhere in this ticket's diff.
- [ ] No file under `scripts/` or `supabase/` is modified. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests run against a mocked Supabase client, so nothing
      here proves a real `anon` insert carrying the larger snapshot succeeds. The human check after
      merge is registering one override on the preview URL and confirming the new entry on
      `/decisions` shows the comparison, while the gameweek-1 entry still shows the gap note.

## Notes for the Analyst / Builder

**The rule this encodes, as its *because*.** A ledger entry must be self-contained, **because**
everything it refers to is mutable: `recommendations` is upserted every solver run and #60 added a
`DELETE` grant on it. The snapshot exists so a decision can be read years later without depending on
anything else still being true — and a comparison is part of the decision, not a derivation from
current state. If a Builder hits a case this rule does not cover, reason from that sentence.

**Do not "improve" the gap note out of existence.** Rows written before this ticket genuinely lack
the recommended side. Showing the note for them is correct and permanent, and
`LEARNINGS-second-build-wave.md` §3 is explicit that reporting "I cannot measure this" is a
trustworthy output while a plausible fabrication is not.

**The override screen already has both sides in hand** — its confirm panel exists precisely to show
the recommendation against the entry. This ticket threads a value that is already computed; it does
not add a fetch.

**Read `decisions/ticket-103.md` first.** It records the reasoning, the Tier 2 classification and
exactly why the tests were reframed. This ticket reverses that narrowing at the write path, and the
decision log should say so.

**This is Tier 2** — it changes the shape of data stored in an append-only ledger, which is
expensive to reverse once other work reads it. Log it as HIGH-IMPACT with its *because*.

**Two other tickets may be running in this batch.** One owns `scripts/build-solver-input.ts` and
`docs/solver-notes.md`; the other owns `src/lib/projection/` and
`docs/projection-model-backlog.md`. This ticket touches neither.

## Scope constraint

Nothing outside the following files changes:

- `src/lib/override/api.ts`, `src/lib/override/types.ts`, `src/lib/override/derive.ts`,
  `src/lib/override/derive.test.ts`
- `src/screens/OverrideScreen.tsx` (threading the recommended side into the write only)
- `src/lib/decisions/derive.ts`, `src/lib/decisions/types.ts`, `src/lib/decisions/derive.test.ts`
- `src/screens/DecisionHistoryScreen.tsx` (rendering the comparison only)
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/` changes. No workflow file is touched.
Nothing under `scripts/` changes. `src/lib/commit/`, `src/lib/reasoning/`, `src/lib/projection/` and
`src/components/VerdictCard.tsx` are not modified.
