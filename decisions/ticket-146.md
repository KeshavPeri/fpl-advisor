# Ticket #146 — Store position and per-match defensive-contribution counters in feature_history

## HIGH-IMPACT

- **Added `player_match_stats.element_type` and populated it from the ingested season's own
  `players.csv`, rather than joining to the live `players` table, because that join is exactly the
  cross-season identity bug this ticket exists to fix.** Verified live against the actual
  FPL-Core-Insights source (`data/2025-2026/players.csv`, 841 rows) that its `position` column holds
  `Goalkeeper`/`Defender`/`Midfielder`/`Forward`. The ticket's own Notes anticipated this exact
  outcome ("if that requires a column on `player_match_stats`, add it in the same migration rather
  than reaching for the live `players` table") — this is a schema change other model work will build
  on, so it is logged as Tier 2 per the ticket's own classification.

## ROUTINE

- **`reachedThreshold` is not exported from `src/lib/projection/defconRate.ts`** (only
  `isQualifyingMatch` is public); since nothing under `src/` may be touched by this ticket, the job
  instead calls `defensiveContributionPoints(position, stats) > 0`, imported from
  `src/lib/scoring/defensiveContribution.ts` — the exact per-match threshold expression
  `reachedThreshold` itself wraps internally. Satisfies "imported, never reimplemented" and the
  no-60/10/12-literal grep check without modifying `src/`.
- **An unknown position string from the season's `players.csv` fails the whole ingest run loudly**
  (`UnknownPositionError`, uncaught), matching `parseCompetition`'s existing "fail loudly on schema
  drift" convention, rather than being treated as a silent gap.
- **`toMatchStatRow`'s new `elementTypeByPlayerId` parameter defaults to an empty `Map`**, so every
  pre-#146 call site and test keeps working unmodified.
- **A single `element_type` is stamped per player per season** (the first non-null value found across
  his matches), not recomputed per gameweek — matching the ticket's own "position code as it was in
  the ingested season" wording (singular, season-level), and what one ingest run's single
  `players.csv` snapshot naturally produces.

## Note on a Definition-of-Done inconsistency

The ticket's own Definition-of-Done bullet ("no file under `scripts/` other than
`build-feature-history.ts` and its test changes") is narrower than the ticket's own "Scope constraint
— hard boundary" section, which explicitly lists `scripts/ingest-core-insights.ts`/`.test.ts` as
in-scope conditional on position not already being persisted (confirmed not persisted; the change was
required). The Builder followed the hard-boundary section and the ticket's Notes, which are internally
consistent with each other; that one DoD bullet appears to be a wording oversight in the ticket
against its own scope section. No file outside the hard-boundary list was touched.
