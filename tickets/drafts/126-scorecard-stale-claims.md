## Problem

`scripts/recommendation-scorecard.ts` prints two statements that are no
longer true, and one figure that is unreadable.

**1. A false blocker, printed at the top of every report.**

> **No 2025/26 replay.** player_match_stats has no price column and
> players.now_cost holds only the current season, so there is no record of
> what any player cost last season — a replay that ignores the transfer
> budget measures nothing.

Ticket #248 landed `player_gameweek_history` with `now_cost` for all 38
gameweeks of 2025-2026. The blocker is gone. A report that tells its reader
something is impossible, when it is being built in the same batch, is worse
than saying nothing.

Replace it with a statement of what price history now exists, and name the
replay ticket as where it is used. Do the same for the matching claim in
`docs/projection-model-backlog.md` — #248 corrected G3 and flagged that G19
still carries the same stale "price history does not exist in
FPL-Core-Insights" assertion.

**2. A missing net figure that makes the headline meaningless.**

> Actual net: 48 (n=1)

Gameweeks 2 and 3 both read `override: gross N, net unknown — hit cost not
recorded`. So "Plan A − Actual: 0 (n=1)" compares the engine against the
user on a single gameweek out of four. The comparison that matters most —
did following the app beat what Keshav actually did — is effectively
unreported.

`recommendation_decisions.snapshot` carries `hit_cost` for a commit. An
override records the user's own team, and its hit cost is not in the ledger.
Two honest options; pick one and say which in the report:

- Derive the hit from the override snapshot itself where the transfer count
  can be recovered, and mark it derived rather than recorded.
- Or state plainly, per gameweek, that the net is unrecoverable and exclude
  it from the pooled figure — never silently drop it into an `n=1` total
  that reads like a season verdict.

Do not guess a hit cost. An invented −4 is worse than a stated gap.

**3. Captaincy is losing points and the report buries it.**

The existing captaincy section shows a hit rate of **1/4** and **−21 points**
cumulative against the best alternative starter, with GW4 alone at −15. That
is the largest measured defect on this project and it sits below two sections
of solver totals.

Move it up, directly under Reconciliation, and state the cumulative figure in
points in the section heading rather than only in a table. Add the per-gameweek
captain's name and the best alternative's name — a bare "−15" gives no way to
see whether the miss was a fixture call or a form call.

## Falsification gate

None. No causal claim about a measured number; this corrects text, surfaces
an existing figure, and makes an unrecoverable value explicit.

## Definition of done — offline only

- `npm run build`, `npm run lint`, `npm test` clean.
- Named tests: a gameweek whose net is unrecoverable is excluded from the
  pooled actual-net figure AND named in the report; a commit with a recorded
  `hit_cost` is included; the captaincy section renders its cumulative figure
  in the heading; no string in the file asserts that price history is
  unavailable.
- `docs/projection-model-backlog.md`'s G19 corrected: leave the historical
  reasoning, mark it superseded, name #248.

## Post-merge owner check (does not block this PR)

Keshav re-runs the scorecard and pastes it. **Not a gate.**

## Out of scope

- Changing how captains are chosen, or any model file. This ticket changes
  what the report says and where it says it.
- Every other section's arithmetic.
- `scripts/season-replay.ts` and `scripts/transfer-scorecard.ts` — separate
  tickets own those files.
- `src/lib/projection/*`, `scripts/project-points.ts`.

## Files

- `scripts/recommendation-scorecard.ts`
- `scripts/recommendation-scorecard.test.ts`
- `docs/projection-model-backlog.md`
