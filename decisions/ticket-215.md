# Ticket #215 — decisions log

## HIGH-IMPACT

None.

## ROUTINE

- **Console-only output, no `job_runs` write, no report file, no workflow wiring.** Because the
  ticket calls this "a standalone hand-run diagnostic," not a pipeline job, and any extra
  artifact would be scope creep against "one new script... nothing else."
- **Five judgement constants, each argued in-file rather than derived**:
  `MIN_SEASON_MINUTES=900`, `PENALTY_DUTY_RESIDUAL_THRESHOLD_PER_90=0.10`,
  `MIN_QUALIFYING_POPULATION=20`, `MIN_CROSSCHECK_POPULATION=5`, `MIN_CAPTAINCY_GAMEWEEKS=5`,
  `FIVE_GAMEWEEK_HORIZON_NINETIES=5`. Because the DoD explicitly requires the separation rule
  and the sample-size refusal gates to be stated judgements, not derived thresholds.
- **Primary analysis season is 2025-2026, not the current in-progress season.** Because "over a
  full season" requires a completed one, and 2026-27 has only 2 finished gameweeks so far.

## Notable finding, not a decision — flag for Keshav

`playermatchstats.csv` (the same FPL-Core-Insights file `ingest-core-insights.ts` already
fetches) publishes per-match `penalties_scored`/`penalties_missed`, currently unmapped into
`player_match_stats`. Not acted on — mapping it would be a Tier 2 ingest/migration decision,
out of this ticket's scope, and the ticket's own recommendation argues it isn't needed for this
purpose anyway (see below). Recorded here and in `docs/projection-model-backlog.md` so it isn't
rediscovered from scratch later.

## Measurement note

This Builder session had no live Supabase project. Rather than stopping at "not yet read" for
every figure (the pattern #213/#214 hit), the Builder reproduced the diagnostic's exact logic
directly against the public FPL-Core-Insights CSVs for the completed 2025-26 season, and
verified its row counts against this repo's own previously-documented ingest figures
(15,340 total / 12,754 Premier-League rows) before trusting the reproduction. Figures 1 and 2
are real numbers from that reproduction. Figure 3 (captaincy overlap) genuinely needs the
current season's live `player_projections`, which don't exist in sufficient volume yet (2
finished 2026-27 gameweeks) — reported honestly as "not yet read," consistent with the G9/G11
precedent, rather than guessed or backfilled from the wrong season.

**Recommendation shipped: leave it alone.** Pearson r ≈ 0.002 between the goals-minus-xG
residual and real season penalty-attempt counts across 339 qualifying players; only 5 of 21
residual-flagged candidates (24%) have any real penalty attempt on record (76% false positives);
known heavy real takers rank in the bottom third of 339 by residual. The mechanism argued for
why: the model's rate input is shrunk xG, not shrunk goals, and the source's xG model already
prices a penalty kick near its real conversion rate, so taking penalties doesn't push a taker's
actual goals persistently above what his own xG-based rate already assumes. `penalties_order` is
confirmed present in the live `bootstrap-static` payload (non-null for 64 of 652 players) — noted
for the record, though the recommendation is not to build on it for this purpose.
