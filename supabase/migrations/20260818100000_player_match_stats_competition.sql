-- player_match_stats.competition: derived from the match_id slug at ingest.
--
-- Ticket #54. player_match_stats stores every competition the source
-- publishes (Premier League, EFL Cup, FA Cup, Champions League, Europa
-- League, Conference League) under whichever gameweek folder it fell in, not
-- just Premier League matches — yet every consumer of the table has been
-- treating a row as a Premier League appearance. Cup and European matches
-- score ZERO FPL points, and their rates differ materially from Premier
-- League form (measured directly: xG per 90 is 34% higher in cup/European
-- rows). This column lets a consumer filter to Premier League rows in the
-- query itself, rather than pattern-matching match_id at each call site
-- (a `LIKE '%-prem-%'` filter scattered across files would be untestable in
-- isolation and would silently admit any future competition whose slug
-- happens to contain the substring).
--
-- scripts/ingest-core-insights.ts derives this value from match_id via the
-- scripts/lib/competition.ts parser and writes it on EVERY row, existing and
-- new, through the same (player_id, match_id) upsert that already exists —
-- no separate backfill script. A slug whose competition token is not on the
-- parser's known list makes that job fail loudly (non-zero exit, failed
-- job_runs row naming the match_id) rather than writing a guessed or silent
-- null value — see that file's header and scripts/lib/competition.ts.
--
-- Nullable, deliberately: rows written before this migration ran, or before
-- the next ingest run has re-stamped them, have no competition value yet.
-- Every consumer (scripts/project-points.ts, scripts/calibration-report.ts)
-- treats NULL as "unknown, exclude" and counts it separately from rows whose
-- competition is a known non-Premier-League value — never as "probably
-- Premier League". Under-counting for one run is recoverable and visible in
-- the counts; assuming Premier League is exactly the bug this ticket exists
-- to stop.
--
-- No new GRANT in this file. GRANT SELECT/INSERT/UPDATE on
-- public.player_match_stats already exist from the #12 migration
-- (20260811170000_player_match_stats.sql) and are table-level, not
-- column-level — they cover this new column automatically, the same
-- reasoning the #22 migration
-- (20260811180000_player_match_stats_player_code.sql) documented for its own
-- new column. There is no new object here for a role to be denied access to.
--
-- No role guard (the "CREATE ROLE IF NOT EXISTS anon/service_role" DO $$
-- block several other migrations open with, for a bare Postgres install used
-- in migration testing that does not auto-provision those roles): this file
-- issues no GRANT and no CREATE POLICY referencing either role, so nothing
-- here requires them to already exist. Same shape, same reasoning, and the
-- same omission as the #22 migration this file otherwise mirrors — that
-- migration is also an ADD COLUMN + COMMENT + CREATE INDEX with no GRANT and
-- carries no role guard either.
--
-- Idempotent by construction, matching every migration since #9: ADD COLUMN
-- IF NOT EXISTS, CREATE INDEX IF NOT EXISTS. Running this file twice against
-- the same database is safe and creates nothing new the second time.

BEGIN;

ALTER TABLE public.player_match_stats ADD COLUMN IF NOT EXISTS competition text;

COMMENT ON COLUMN public.player_match_stats.competition IS
  'Competition token parsed from match_id at ingest time '
  '(scripts/lib/competition.ts) -- "prem" for Premier League, or one of '
  '"efl-cup", "fa-cup", "champions-league", "europa-league", '
  '"conference-league" for cup/European fixtures. Only Premier League '
  'matches score FPL points -- every consumer of this table must filter to '
  'competition = ''prem'' (PREMIER_LEAGUE_COMPETITION) in the query, never '
  'in memory after fetching. NULL means the row has not been re-stamped '
  'since this column was added -- treat as unknown and EXCLUDE, never '
  'assume Premier League. See ticket #54.';

CREATE INDEX IF NOT EXISTS idx_player_match_stats_competition ON public.player_match_stats (competition);

COMMIT;
