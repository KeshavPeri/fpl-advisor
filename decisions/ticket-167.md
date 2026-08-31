# Ticket #167 — Store team and opponent on match data

## HIGH-IMPACT

- **Resolved opponent identity via a club-slug → `team_code` map built from `teams.csv`'s
  `fotmob_name` column, because it is the only column that was verified to slugify exactly onto
  `match_id`'s club-name segments.** `name`/`short_name` do not (e.g. "Man Utd", "Nott'm
  Forest", "Spurs" don't match the slug's club segments). This is Tier 2 because it is the join
  key every future fixture-aware measurement — the backtest, calibration, projections — will
  depend on; getting it wrong here would silently corrupt all of them. **Named consumer for the
  next batch:** the not-yet-numbered follow-up ticket that makes `scripts/run-backtest.ts`
  fixture-aware — this column exists for it and has no consumer until it lands.
- **A `match_id` slug that fails to parse into two known club codes fails the whole ingest run,
  uncaught — it does not fall back to a guess.** Matches the existing precedent in
  `scripts/lib/competition.ts`'s `parseCompetition` (cited by the ticket itself): a change in the
  shape of this file's own primary-key source is schema drift, not a per-row data gap, and must
  be loud. **Live discovery during the build**: 2026-2027's `teams.csv` has `fotmob_name` blank
  for all 20 rows (verified 31 Aug 2026) — opponent resolution for that season resolves 0 by
  construction. This is counted and reported via the new `job_runs.details` counters, never
  silently guessed from a mismatched column. Flagging this for visibility: if the 2026-2027
  ingest run's `matchRowsOpponentUnresolvedByReason` shows 100% unresolved for that season, this
  is why — it is expected until FPL-Core-Insights populates `fotmob_name` for that season, not a
  bug in this ticket.

## ROUTINE

- `opponent_team_code` lives only on `player_match_stats`, not `feature_history` — opponent
  varies per match, unlike a player's own team, so it doesn't fit `feature_history`'s
  one-cumulative-value-per-player-per-season shape. Follows directly from the ticket's own scope
  wording.
- The migration's new columns are nullable with no default, added via idempotent
  `ADD COLUMN IF NOT EXISTS`; no new `GRANT` was needed since the existing table-level grants
  from earlier migrations already cover new columns on the same tables (same precedent as
  #125/#146).
- `MatchStatRow` was widened from a private `interface` to an exported one, so the new
  `tallyOpponentResolution` reconciliation helper could be unit-tested directly against
  constructed rows rather than only provable by code inspection. Type-visibility change only, no
  behavioural change, and stays inside `scripts/ingest-core-insights.ts`.
- Split the `parseCompetition` import and the new `parseMatchClubSlugs`/`CompetitionToken`
  import into two separate `import` lines, to avoid weakening an existing test that regex-matches
  the exact import shape.
- Added `fotmob_name` to `TEAMS_REQUIRED_COLUMNS`, so a source file that drops the column header
  entirely fails loud — distinct from the column merely being blank-valued, which is the counted,
  non-fatal gap described above.

## Note

The Builder flagged 3 pre-existing test failures in `ingest-core-insights.test.ts` /
`build-feature-history.test.ts` (stale `"not yet applied"` assertions for the #125/#146 migration
rows in `supabase/README.md`, which were later marked applied without the tests being updated).
Confirmed these reproduce byte-for-byte on a clean `origin/main` checkout, before this ticket's
changes — pre-existing, out of scope for #167, and not fixed here.
