-- player_match_stats.player_code: stable cross-season join key.
--
-- Ticket #22, follow-up to #12. player_match_stats is keyed on (player_id,
-- match_id) and that key is deliberately left alone by this migration — see
-- the #12 migration's header comment for why player_id has no FK to
-- players.id. player_id is stable only *within* the season it was ingested
-- for; FPL-Core-Insights' players.csv also carries player_code, which QA on
-- #12 verified is the field that stays stable across a season boundary (458
-- players cross-referenced between the 2025/26 and 2026/27 snapshots: only 5
-- kept the same player_id, 453 changed; player_code is what matched them).
-- This column is what lets a later consumer join historical match rows to
-- the *current* players table via players.code, regardless of which
-- season's player_id they were ingested under.
--
-- Nullable, no FK, no PK change:
--   - Nullable because scripts/ingest-core-insights.ts populates it from
--     that season's players.csv at ingest time, and a row whose player_id
--     has no entry there (source files are generated separately; a small
--     gap is expected, see the ticket) is still written, just without a
--     player_code.
--   - No FK to players.code for the same reason #12 dropped the player_id
--     FK: players is refreshed per season, and a hard constraint would
--     reject historical rows the moment the table is refreshed for a new
--     season. player_code is stored as a join key, not as a constraint.
--   - (player_id, match_id) remains the primary key and the upsert conflict
--     target — unchanged by this migration. player_code is a second column
--     on the same row, not a re-key.
--
-- No new GRANT in this file. GRANT SELECT/INSERT/UPDATE on
-- public.player_match_stats already exist from the #12 migration and are
-- table-level, not column-level — they cover this new column automatically,
-- the same way they'd cover any other column added to an already-granted
-- table. There is no new object here for a role to be denied access to.
--
-- Idempotent by construction, matching #9/#10/#12's style: ADD COLUMN IF NOT
-- EXISTS and CREATE INDEX IF NOT EXISTS. Running this file twice against the
-- same database is safe and creates nothing new the second time.

BEGIN;

ALTER TABLE public.player_match_stats ADD COLUMN IF NOT EXISTS player_code integer;

COMMENT ON COLUMN public.player_match_stats.player_code IS
  'FPL-Core-Insights stable player code, from that season''s players.csv '
  '(player_id -> player_code map built at ingest time). Stable across a '
  'season boundary, unlike player_id — see this migration''s file header. '
  'Null when the row''s player_id had no entry in that season''s '
  'players.csv. No FK to players.code (players is refreshed per season); '
  'join manually, e.g. '
  '"... JOIN players p ON p.code = player_match_stats.player_code".';

CREATE INDEX IF NOT EXISTS idx_player_match_stats_player_code ON public.player_match_stats (player_code);

COMMIT;
