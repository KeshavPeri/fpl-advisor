-- public.teams.elo_stale_since: when a ClubElo rating went stale, ticket #176.
--
-- THE DEFECT THIS FIXES. Ticket #63 (18 Aug 2026) made
-- scripts/ingest-core-insights.ts null out `teams.elo` on every row whose
-- `code` it could not match to the ingested season's teams.csv, so a
-- pre-#32 mismatched rating (a promoted club literally holding a different
-- club's number) could not sit there silently forever. That was the right
-- fix for that specific problem. It was not written for -- and, on live
-- data, turned out to also fire on -- a club that is very much still in the
-- competition but whose *season file* the source has not yet populated:
-- data/2026-2027/teams.csv was checked on 1 Sept 2026 and its `elo` column
-- is empty for all 20 clubs. Every run of the 2025-2026-season ingest
-- re-nulled the three 2026/27 promoted clubs' `elo` on that basis, and
-- nothing has ever repopulated it, because no season file has ever
-- supplied a fresh value for them. 15 of 50 fixtures in the live
-- five-gameweek horizon were on the coarser FPL-difficulty fallback as a
-- direct result. See scripts/ingest-core-insights.ts's own header comment
-- for the full "because", including why #63's own "genuinely removed from
-- the competition" case cannot actually reach that job's input (identity is
-- owned entirely by scripts/ingest-fpl.ts, upserted by id from the CURRENT
-- season's bootstrap-static/, so a club this job's own read of public.teams
-- ever sees is, by construction, still in the competition).
--
-- THE FIX (ticket #176): scripts/ingest-core-insights.ts now PRESERVES an
-- existing `teams.elo` whenever the season file has nothing to say about
-- that club this run -- absent entirely, or present with a blank/malformed
-- elo cell -- rather than nulling it. So "we have a rating and it is
-- current" and "we have a rating and the source stopped supplying it" do
-- not collapse into the same value, this column exists: NULL means the
-- rating is current (confirmed fresh by the most recent successful match on
-- `code`); a timestamp means the rating has been PRESERVED, not confirmed,
-- since that moment. The ingest job sets it the FIRST time a row goes
-- stale and leaves it alone on every subsequent run it stays stale (so the
-- timestamp records when staleness began, not when it was last checked),
-- and clears it back to NULL the moment a fresh CSV value updates `elo`
-- again.
--
-- NULLABLE, NO DEFAULT -- DELIBERATE. A row ingested before this column
-- existed, or a club whose rating has never gone stale, genuinely has
-- nothing to report here; a NOT NULL DEFAULT would manufacture a fake
-- "always been fresh" for every existing row. This is the same
-- null-means-unknown-or-not-applicable reasoning
-- 20260828090000_player_match_stats_team_goals_conceded.sql and
-- 20260818100000_player_match_stats_competition.sql already document for
-- their own new columns.
--
-- NO GRANT NEEDED IN THIS FILE. This is ADD COLUMN on a table that already
-- exists (created by the #9 reference-schema migration,
-- 20260811100000_reference_schema.sql) with its GRANTs already in place via
-- 20260811160000_table_grants.sql (SELECT for anon; SELECT, INSERT, UPDATE
-- for service_role -- table-level, not column-level, so it covers this new
-- column automatically). Same precedent the #125 and #146 migrations already
-- documented for their own new columns on existing tables.
--
-- NO ROLE GUARD, for the same reason those migrations carry none: this file
-- issues no GRANT and no CREATE POLICY referencing anon or service_role, so
-- nothing here requires either role to already exist in a bare Postgres
-- install used for migration testing.
--
-- Idempotent by construction: ADD COLUMN IF NOT EXISTS. Running this file
-- twice against the same database is safe and creates nothing new the
-- second time.

BEGIN;

ALTER TABLE public.teams ADD COLUMN IF NOT EXISTS elo_stale_since timestamptz;

COMMENT ON COLUMN public.teams.elo_stale_since IS
  'When this team''s ClubElo rating (elo) went stale -- i.e. the most recent '
  'run of scripts/ingest-core-insights.ts had no fresh value for it (the '
  'club''s code was absent from the ingested season''s teams.csv, or present '
  'with a blank/malformed elo cell) and PRESERVED the existing elo rather '
  'than nulling it (ticket #176, replacing ticket #63''s nulling rule). NULL '
  'means the rating is current, confirmed by the most recent successful '
  'match on code. A non-null timestamp means the rating shown is stale as of '
  'that moment -- still usable (and strictly better than the FDR fallback in '
  'src/lib/projection/fixture.ts, which engages only when elo itself is '
  'null), but not confirmed since. Set once, the first time a row goes '
  'stale; left untouched on every subsequent run it stays stale so this '
  'records WHEN staleness began, not when it was last checked; cleared back '
  'to NULL the moment a fresh CSV value updates elo again. See '
  'scripts/ingest-core-insights.ts''s header comment for the full '
  '"because".';

COMMIT;
