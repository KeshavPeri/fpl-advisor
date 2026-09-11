## Context

Everything this project has measured is the **projection** — whether the model ranks players in the
right order. Nothing has ever measured the **recommendation**: whether the transfer it tells Keshav
to make, and the captain it tells him to pick, were good calls. `feature-list.md` item 32 says so in
as many words — the recommendation-level replay "is not built".

The 2025/26 season replay that would have answered this **cannot be built and should not be
attempted.** `player_match_stats` has no price column and `players.now_cost` holds the current
season only, so there is no record of what any player cost in 2025/26. A replay that ignores the
budget measures nothing, because optimising under a budget is the solver's whole job. Record that
blocker; do not work around it.

**What can be built is better anyway:** score the recommendations the app has actually issued,
against what actually happened, using only data already stored. Every piece is in the database —
`recommendations` holds Plan A, B and C with their starting XI, bench order, captain, vice-captain
and hit cost; `recommendation_decisions` holds what Keshav committed or overrode;
`prediction_log` holds each player's projection and its post-lockdown settled actual; and
`player_match_stats` holds the raw actuals behind them.

## Scope

**In scope:**

- A new hand-run script producing a **recommendation scorecard**: one row per settled gameweek,
  scoring each of these against real points —
  - **Plan A** as issued: its starting XI's actual points, captain doubled, minus its hit cost.
  - **Plan B and Plan C**, identically.
  - **Roll**, meaning the squad as it stood with no transfer — the honest do-nothing counterfactual.
  - **What Keshav actually did**, from `recommendation_decisions` (commit or override, with the
    override's own snapshot).
- Season totals across every settled gameweek, plus the gap between Plan A and each alternative.
- A settled-only rule: a gameweek is scored only after `prediction_log.settled_at` exists for it.
  An unsettled gameweek is excluded by name and counted, never scored on provisional data.
- **The captaincy question answered separately**, because it is the one Keshav feels most: for each
  gameweek, did Plan A's captain outscore the best alternative in the same starting XI, and by how
  much. Report the hit rate and the cumulative points won or lost.
- Counters that reconcile: gameweeks read, gameweeks scored, gameweeks excluded and why.

**Explicitly out of scope:**

- **No 2025/26 replay, and no attempt to reconstruct historical prices.** Record the blocker in
  `docs/projection-model-backlog.md` and stop there.
- No app screen. This is a report first; surfacing it is a later ticket once there is enough data
  to be worth looking at.
- No change to the model, the solver, the projection, or any stored recommendation.
- No new external data source, no migration, no new Supabase write beyond one `job_runs` row.
- No change to `scripts/run-backtest.ts`.

## The sample is tiny and the report must say so on its own face

Only three or four gameweeks have settled. **Three gameweeks cannot tell you whether a
recommendation engine is good**, and the report must refuse to imply otherwise: print the sample
size beside every figure, and carry a standing line stating how many gameweeks would be needed
before any of it means anything.

This is the same "too small to read" discipline `scripts/run-backtest.ts` already applies per
gameweek and `src/lib/accuracy/derive.ts` applies to the in-app accuracy figure. Follow it. A
scorecard that reads like a verdict after three weeks is worse than no scorecard — it is the
`LEARNINGS-second-build-wave.md` §13 failure again, an absolute number with nothing to read it
against.

**The value here is that it compounds.** Run it every week and by December it is the most important
report in the repo.

## Definition of done

- [ ] The scoring logic is pure over its inputs, with named tests: a plan whose captain blanks, a
      plan with a hit, a roll week, an overridden week, and a gameweek with a player who did not
      feature.
- [ ] Captain doubling and hit cost are both applied, and a named test proves a −4 plan that
      outscores a roll by 3 is correctly reported as the worse decision.
- [ ] Only settled gameweeks are scored; unsettled ones are excluded by name and counted.
- [ ] Counters reconcile arithmetically.
- [ ] Every figure carries its sample size, and the report states how many gameweeks are needed
      before the numbers are readable.
- [ ] The captaincy section reports hit rate and cumulative points against the best alternative
      starter.
- [ ] The price blocker is recorded in `docs/projection-model-backlog.md` as its own entry, naming
      what would unblock it.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` exit 0.
- [ ] Scope constraint: one new script and its test under `scripts/`,
      `docs/projection-model-backlog.md`, and this ticket's own `decisions/ticket-<issue>.md`.

## Notes for the Analyst / Builder

- `recommendations` keys on `(gameweek_id, plan_index)` and is **upserted in place** — a re-run
  replaces that gameweek's plans. So the scorecard measures the plans as they stand now, not
  necessarily as they stood at the deadline. Say this in the report; it is a real limitation and it
  is not fixable retroactively.
- `prediction_log` is the settled source and it already waits for 09:00 UK the morning after the
  final match. Do not reconstruct actuals from `player_match_stats` if `prediction_log` has them —
  one source, not two.
- Filter to `competition = 'prem'` on any `player_match_stats` read, and pass an explicit ordering
  to every paginated call.
- Key on `player_code` wherever a join crosses tables (`deltas.md` D9).
