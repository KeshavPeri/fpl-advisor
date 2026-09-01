-- player_match_stats + feature_history: team and opponent identity.
--
-- Ticket #167. STORES IDENTITY ONLY -- turning it into fixture difficulty is
-- a follow-up ticket's entire job (see this file's own header note below and
-- the ticket's own "why this ticket builds data rather than the
-- measurement"). Nothing about the backtest's numbers changes when this
-- migration is applied; scripts/run-backtest.ts is untouched.
--
-- WHY THIS EXISTS. The backtest cannot see fixtures: every row it measures
-- is projected under a neutral fixture (expectedScore exactly 0.5, every
-- multiplier exactly 1.0), because neither player_match_stats nor
-- feature_history records which team a player was on or which team he
-- faced. Making the backtest fixture-aware needs both, per measured row --
-- this migration adds the columns; scripts/ingest-core-insights.ts and
-- scripts/build-feature-history.ts (same ticket) populate them.
--
-- `code`, NEVER `id` -- the fourth time this repo has had to learn this
-- lesson (deltas.md D9; tickets #12/#22/#32/#63/#146). 15 of 20 FPL team ids
-- referred to a DIFFERENT club across the 2025/26 -> 2026/27 season boundary;
-- `teams.code` was the one identifier stable for all 17 clubs present in
-- both seasons. `team_code` here follows that same rule, exactly like
-- `player_match_stats.player_code` and `feature_history.player_code` already
-- do one level up.
--
-- team_code (player_match_stats + feature_history): the player's OWN club
-- for that row, resolved from that season's own players.csv (its own
-- `team_code` column, already required and already fetched by
-- scripts/ingest-core-insights.ts for every other per-player column) --
-- never from the live public.teams/public.players tables, which hold only
-- the CURRENT season's roster and silently drop anyone who has since
-- transferred or left the league. Same "never the live table" discipline
-- ticket #146 established for element_type.
--
-- opponent_team_code (player_match_stats ONLY -- feature_history has no
-- opponent column; opponent varies match to match, unlike a player's team,
-- so it does not fit feature_history's "one cumulative value per player per
-- season" shape): derived from the match_id slug's two club-name segments
-- (e.g. "25-26-prem-brighton-hove-albion-vs-fulham"), given the player's own
-- club -- the opponent is whichever of the two named clubs is NOT him. A
-- slug that does not resolve to exactly two recognized clubs is left NULL
-- and counted in job_runs.details, never guessed -- see
-- scripts/ingest-core-insights.ts's resolveOpponentTeamCode for the full
-- reasoning and every named failure reason.
--
-- ALL THREE COLUMNS NULLABLE, NO DEFAULT -- same reasoning as every
-- previous "raw fact the source may not always resolve" column in this repo
-- (element_type, team_goals_conceded): a row written before this migration,
-- or a row this job genuinely could not resolve identity for, has no value
-- for these columns -- that is a different fact from a real team code of 0
-- (which does not exist; FPL codes start at 1) and must not be defaulted
-- into looking like one. A rebuild via scripts/ingest-core-insights.ts and
-- scripts/build-feature-history.ts (both upsert-only, same pattern every
-- earlier back-stamped column used) fills every row going forward; there is
-- no separate backfill script.
--
-- NO NEW GRANT NEEDED. Both statements below are ADD COLUMN on tables that
-- already exist with their GRANTs already in place (player_match_stats:
-- 20260811170000_player_match_stats.sql; feature_history:
-- 20260827090000_feature_history.sql) -- table-level grants, not
-- column-level, so they cover new columns automatically. Same precedent as
-- the #54/#125/#146 migrations on this same pair of tables.
--
-- Idempotent by construction: ADD COLUMN IF NOT EXISTS. Running this file
-- twice against the same database is safe and creates nothing new the
-- second time.

BEGIN;

-- ============================================================================
-- player_match_stats: team_code (the player's own club) + opponent_team_code
-- (the club he faced that match). Populated by
-- scripts/ingest-core-insights.ts -- see that file's header.
-- ============================================================================

ALTER TABLE public.player_match_stats ADD COLUMN IF NOT EXISTS team_code integer;
ALTER TABLE public.player_match_stats ADD COLUMN IF NOT EXISTS opponent_team_code integer;

COMMENT ON COLUMN public.player_match_stats.team_code IS
  'The FPL stable club code (matching public.teams.code, NEVER an FPL team '
  'id -- see deltas.md D9) of the player''s OWN club for this row, as '
  'published in this ingested season''s own players.csv (its own team_code '
  'column). NULL means the row''s player_id had no resolvable team_code in '
  'that season''s players.csv (the same small, expected gap player_code '
  'already documents) or predates this column. Never sourced from the live '
  'public.players/public.teams tables -- those hold only the CURRENT '
  'season''s roster. See ticket #167.';

COMMENT ON COLUMN public.player_match_stats.opponent_team_code IS
  'The FPL stable club code (matching public.teams.code) of the club the '
  'player faced in this match, derived from the two club-name segments of '
  'match_id given the player''s own team_code -- see '
  'scripts/ingest-core-insights.ts''s resolveOpponentTeamCode. NULL means '
  'this row predates this column, or the opponent could not be resolved '
  '(the match_id slug did not split into exactly two recognized clubs, or '
  'the player''s own team_code was not among the two found) -- a genuine, '
  'counted gap, never a guess. See ticket #167. STORES IDENTITY ONLY: '
  'turning this into fixture difficulty is a follow-up ticket''s job, not '
  'this column''s.';

-- ============================================================================
-- feature_history: team_code only -- see file header for why opponent has
-- no place here. Copied through from player_match_stats.team_code by
-- scripts/build-feature-history.ts, the same "single value per player per
-- season" treatment element_type already gets (ticket #146).
-- ============================================================================

ALTER TABLE public.feature_history ADD COLUMN IF NOT EXISTS team_code integer;

COMMENT ON COLUMN public.feature_history.team_code IS
  'The FPL stable club code (matching public.teams.code) of the player''s '
  'own club for this season, copied from public.player_match_stats.team_code '
  '-- never from the live public.players/public.teams tables. NULL means '
  'this row predates this column or the player''s team_code could not be '
  'resolved at ingest time. See ticket #167.';

COMMIT;
