## Problem

The recommendation engine has never been measured. Only the projection has.

`scripts/recommendation-scorecard.ts` says so in its own header:

> **No 2025/26 replay.** player_match_stats has no price column and
> players.now_cost holds only the current season, so there is no record of
> what any player cost last season — a replay that ignores the transfer
> budget measures nothing.

**That blocker is gone.** Ticket #248 landed
`public.player_gameweek_history` with `now_cost` for every player in every
gameweek of 2025-2026 — 29,978 rows, reconciled exactly (29,978 read, 29,978
written, 0 unresolved).

The scorecard has 4 settled gameweeks and says it needs 20 before anything
reads as a verdict. A completed season is 38. A replay turns "wait four
months" into "run it now".

## The work

New script `scripts/season-replay.ts`, writing `./out/season-replay.md`.
Read-only. Changes no model file, no recommendation, no solver config.

Replay 2025-2026 gameweek by gameweek, point-in-time throughout:

- Start from a legal opening squad under that season's own gameweek-1 prices.
- At each gameweek, project with `baseline-v1` using ONLY data strictly
  before that gameweek — reuse `scripts/run-backtest.ts`'s existing
  point-in-time machinery (`feature_history`, `buildTeamMatchRecords`,
  `computeTeamStrengthAsOf`) unmodified. Do not write a second projection
  path.
- Apply the same transfer rules the app follows: one free transfer, rolling
  to a maximum of two, −4 per extra, 15-player squad, max 3 per club, the
  real budget at that gameweek's real prices.
- Captain by the same rule the app uses.
- Score against actual points from `player_match_stats`.

Report, per gameweek and as a season total:

- Replay net points.
- **Never-transfer baseline** — the opening squad held all season, same
  captaincy rule. Anything the engine does must beat holding.
- **Random-legal-transfer baseline** — a transfer chosen uniformly from the
  affordable legal set, averaged over 20 seeds. This separates "the engine
  picks well" from "transferring at all helps".
- Transfers made, hits taken, points lost to hits.
- Captaincy regret against the best starter each week, pooled.

Prices come from `player_gameweek_history` at that gameweek. **`now_cost`
there is DECIMAL MILLIONS (e.g. `5.8`), not integer tenths** — verified by
#248. `public.players.now_cost` uses integer tenths; the two are not
interchangeable and mixing them misprices every squad by a factor of ten.
Assert the unit with a named test.

`bonus`, `bps` and `starts` in that table are season-cumulative-to-date, not
per-gameweek (#248). This script does not need them; do not assume otherwise
if you reach for them.

**No lookahead.** Every price, every rate, every fixture rating must come
from strictly before the gameweek being decided. Four separate lookahead
leaks have already been found and closed in the backtest harness; assume a
fifth is waiting here and write the tests that would catch it.

## Falsification gate

Runnable offline against the public FPL-Core-Insights CSVs — the route #248
used. No credentials.

**Stop and report unless all three hold:**

1. The replay's own projected-points figures reproduce
   `scripts/run-backtest.ts`'s published one-gameweek Spearman of **0.354**
   within **0.01** on the same population. Same model, same data — if it does
   not reproduce, the replay harness is wrong and nothing it reports can be
   trusted.
2. Total squad value never exceeds the budget at any gameweek, and no squad
   ever holds 4+ players from one club. Assert per gameweek, not just at the
   end.
3. A deliberately injected lookahead — pricing a transfer at the FOLLOWING
   gameweek's `now_cost` — must make the replay score visibly better. If it
   does not, the harness is not actually using prices and the test is not
   measuring what it claims. Report the size of the difference.

## Definition of done — offline only

- `npm run build`, `npm run lint`, `npm test` clean.
- Named tests: the budget constraint binds; the 3-per-club limit binds;
  rolling caps at two free transfers; a hit costs exactly −4 once;
  `now_cost` is decimal millions; prices come from the decision's own
  gameweek, never a later one.
- The three gate conditions above, as tests.

## Post-merge owner check (does not block this PR)

Keshav runs the script and pastes the report. **Not a gate.**

## Out of scope

- Changing the solver, the transfer rule, the captaincy rule or any model
  constant. This measures what the current engine does. Acting on the result
  is the next ticket and needs this number first.
- Chips. Wildcard, bench boost, triple captain and free hit are all excluded
  from the replay; say so in the report.
- `scripts/recommendation-scorecard.ts`, `scripts/transfer-scorecard.ts`,
  `src/lib/projection/*`, `scripts/project-points.ts`,
  `scripts/preflight-check.ts`, `scripts/team-strength-diagnostic.ts`.
- Correcting the scorecard's now-false "No 2025/26 replay" header — another
  ticket in this batch owns that file.

## Files

- `scripts/season-replay.ts` (new)
- `scripts/season-replay.test.ts` (new)
- `docs/projection-model-backlog.md`
