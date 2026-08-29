-- feature_history: position + per-match defensive-contribution counters.
--
-- Ticket #146. Two defects in feature_history with one root cause: the table
-- stores cumulative totals but not the two things a point-in-time projection
-- (and a backtest built on it) actually needs. They are one migration because
-- the second cannot be computed without the first.
--
-- (1) DEFCON COUNTERS, NOT A RATE -- SAME REASONING AS #121's "RAW TOTALS,
-- NEVER RATES" (Tier 2, logged HIGH-IMPACT). src/lib/projection/defconRate.ts
-- computes a per-match hit rate: the proportion of QUALIFYING matches (60+
-- minutes) in which the player reached his position's threshold (10 CBIT for
-- defenders, 12 CBIRT for midfielders/forwards). That is a per-match
-- determination -- feature_history's existing prior_clearances/prior_blocks/
-- prior_interceptions/prior_tackles/prior_recoveries are cumulative totals, and
-- a hit rate cannot be recovered from them: a player with 30 clearances over
-- 10 matches might have hit the threshold three times or never, and the
-- totals alone cannot tell you which. prior_defcon_qualifying_matches and
-- prior_defcon_hits store the two raw per-match COUNTS instead of a rate, for
-- the same reason #121 stores raw totals instead of a rate: the rate model
-- has changed repeatedly (CBI/recoveries added, two-stage shrinkage, the
-- position prior) and storing a rate would freeze one version of a moving
-- model into a table meant to outlive all of them. Any past or future rate
-- model can recompute hits/qualifying from these two raw counts.
--
-- (2) element_type CLOSES THE CROSS-SEASON IDENTITY GAP (deltas.md D9,
-- tickets #22/#32, repeated here). feature_history is keyed on player_code
-- with no position column, so every consumer has been joining to the LIVE
-- public.players table to get one -- and that table holds only the CURRENT
-- season's players (616 for 2026/27), while 2025-2026 had 841. Anyone who
-- left the league between those two seasons has no row there, and the
-- backtest/calibration report have been silently dropping their entire
-- history as a result (23% of feature_history's population). The position
-- was available at ingest time all along (FPL-Core-Insights' own players.csv
-- for that season) and simply was not stored -- see the companion change to
-- scripts/ingest-core-insights.ts (also ticket #146), which now persists it
-- onto public.player_match_stats.element_type, and to
-- scripts/build-feature-history.ts, which copies it across from there rather
-- than ever touching the live players table.
--
-- ALL THREE COLUMNS NULLABLE, NO DEFAULT -- DELIBERATE, same reasoning as
-- #125's team_goals_conceded. A row written before this migration genuinely
-- has no value for any of the three -- that is a different fact from a real
-- zero (a player who played 10 qualifying matches and hit the threshold zero
-- times) or a real position code. Collapsing "never computed" into 0/NULL-as-
-- zero would make the table lie about what it has actually measured. A
-- rebuild via scripts/build-feature-history.ts (one hand-run, upsert-only,
-- same pattern #54/#125 used to back-stamp their own new columns) fills every
-- row going forward; there is no separate backfill script.
--
-- NO NEW GRANT NEEDED. Both statements below are ADD COLUMN on tables that
-- already exist with their GRANTs already in place (feature_history:
-- 20260827090000_feature_history.sql; player_match_stats:
-- 20260811170000_player_match_stats.sql) -- table-level grants, not
-- column-level, so they cover new columns automatically. Same precedent as
-- the #54 and #125 migrations on this same pair of tables.
--
-- Idempotent by construction: ADD COLUMN IF NOT EXISTS. Running this file
-- twice against the same database is safe and creates nothing new the second
-- time.

BEGIN;

-- ============================================================================
-- feature_history: element_type + the two defcon counters.
-- ============================================================================

ALTER TABLE public.feature_history ADD COLUMN IF NOT EXISTS element_type smallint;
ALTER TABLE public.feature_history ADD COLUMN IF NOT EXISTS prior_defcon_qualifying_matches integer;
ALTER TABLE public.feature_history ADD COLUMN IF NOT EXISTS prior_defcon_hits integer;

COMMENT ON COLUMN public.feature_history.element_type IS
  'The FPL position code (1 = goalkeeper, 2 = defender, 3 = midfielder, '
  '4 = forward) as it was in the ingested season, copied from '
  'public.player_match_stats.element_type -- never from the live '
  'public.players table, which holds only the current season''s players and '
  'silently drops anyone who has since left the league. NULL means this row '
  'predates this column or the player''s position could not be resolved from '
  'the season''s own player list -- never assume a value. See ticket #146.';

COMMENT ON COLUMN public.feature_history.prior_defcon_qualifying_matches IS
  'Count of this player''s Premier League matches STRICTLY BEFORE '
  'gameweek_id, in this season, with 60+ minutes played -- the same '
  'qualifying rule src/lib/projection/defconRate.ts''s isQualifyingMatch() '
  'applies. NULL means never computed (a row written before this column '
  'existed); 0 is a real measurement (the player had no qualifying match '
  'yet). See ticket #146.';

COMMENT ON COLUMN public.feature_history.prior_defcon_hits IS
  'Of prior_defcon_qualifying_matches, the count in which the player reached '
  'his position''s defensive-contribution threshold (10 CBIT for defenders, '
  '12 CBIRT for midfielders/forwards; always 0 for goalkeepers, who do not '
  'earn defensive-contribution points) -- determined per match via '
  'src/lib/scoring/defensiveContribution.ts''s defensiveContributionPoints(), '
  'never a locally reimplemented threshold. A cumulative total (e.g. 30 '
  'clearances across 10 matches) cannot express this: it cannot distinguish '
  'one huge match from ten ordinary ones, which have very different hit '
  'counts. NULL means never computed; 0 is a real measurement. See ticket '
  '#146.';

-- ============================================================================
-- player_match_stats: element_type, the source column build-feature-history.ts
-- copies onto every dense row it writes for a player. Populated by
-- scripts/ingest-core-insights.ts from that season's own players.csv --
-- never from the live public.players table (see header).
-- ============================================================================

ALTER TABLE public.player_match_stats ADD COLUMN IF NOT EXISTS element_type smallint;

COMMENT ON COLUMN public.player_match_stats.element_type IS
  'The FPL position code (1 = goalkeeper, 2 = defender, 3 = midfielder, '
  '4 = forward) as published in this ingested season''s own players.csv, '
  'mapped from its "position" column (Goalkeeper/Defender/Midfielder/'
  'Forward) by scripts/ingest-core-insights.ts. NULL means the row''s '
  'player_id had no resolvable position in that season''s players.csv (the '
  'same small, expected gap player_code already documents) or predates this '
  'column. See ticket #146.';

COMMIT;
