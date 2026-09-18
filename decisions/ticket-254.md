# Ticket #254 — Measure the transfer decision — realised gain against a roll baseline

## HIGH-IMPACT

None this ticket — a new read-only measurement script with no effect on the model, solver, or
recommendations; the decisions below are local implementation choices inside that script, not
decisions with downstream dependents.

## ROUTINE

- **Tier 3 — affordable-ceiling candidates restricted to the outgoing player's own position
  (`element_type`).** **Because** a real FPL transfer always replaces a squad slot with a
  same-position player — an unconstrained-position "ceiling" would describe a transfer nobody
  could actually have made, defeating the point of a hindsight ceiling.
- **Tier 3 — affordable-ceiling budget = pre-transfer `squads.bank` (converted to decimal
  millions) + outgoing player's own `player_gameweek_history` price at that gameweek.**
  **Because** this mirrors `scripts/build-solver-input.ts`'s own convention of reading
  `squads`/`squad_picks` at the same `gameweek_id` as the target gameweek — that row already
  represents the pre-transfer state, carried forward by `sync-squad.ts` before the deadline.
- **Tier 3 — affordable-ceiling scored with zero hit cost** (a free hypothetical single
  transfer). **Because** the ticket specified no hit-cost rule for the ceiling, and "how much of
  the available gain the solver captured" reads most honestly against a like-for-like
  free-transfer ceiling rather than one that arbitrarily assumes a hit was also taken.
- **Tier 3 — pre-transfer 15-man squad reconstructed from `plan_snapshot`'s own `startingXi` +
  `benchOrder`** (swapping the transferred-in code back to the transferred-out code), rather than
  reading `squad_picks` separately. **Because** this avoids a second, potentially-inconsistent
  source for the same squad shape — the same reconstruction technique
  `scripts/recommendation-scorecard.ts`'s `buildRollShape` already uses.
- **Tier 3 — "the following gameweek" = the transfer's own `gameweekId`**, and the 5-gameweek
  horizon = that id plus the next four consecutive ids from `gameweeks`, mirroring
  `scripts/project-points.ts`'s own `PROJECTION_HORIZON` slice convention. Each horizon gameweek
  must be individually settled or the whole horizon figure is excluded and named, never partially
  summed.

## Process note

Revision round 1 of 2: QA's first pass failed one item — the sample-size-limitation paragraph
said "a handful of gameweeks" instead of stating the precise, currently-true ceiling ("at most
four") in its own labelled section, matching `bonus-validation-report.ts`'s shape. Builder fixed
it narrowly (one paragraph + one regression test, commit `ebbc5d2`); QA's second pass confirmed
the fix and passed. No other code changed between rounds.

All Tier 3 calls above and the process note were verified by QA (PASS on round 1 of revision,
18 Sep 2026) alongside the full diff, build, lint and test suite, with no unflagged Tier 1/2
concern found.
