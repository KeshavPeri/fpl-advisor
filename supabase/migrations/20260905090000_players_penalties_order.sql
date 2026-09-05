-- public.players.penalties_order: FPL's own published penalty-taking priority, ticket #219.
--
-- THE SOURCE. Live `bootstrap-static/` publishes `penalties_order` on every element: an
-- explicit 1-N priority rank naming that club's penalty takers directly (1 = first choice, 2 =
-- second choice, and so on), or null for a player with no recorded penalty-taking role. Verified
-- directly against a live fetch while building this ticket, 5 Sep 2026: 61 of 652 elements
-- carried a non-null value, distributed 1: 20, 2: 17, 3: 15, 4: 6, 5: 3 -- a close match to
-- ticket #215's own "64 of 652" figure from the same week, the small difference being normal
-- squad-list churn (transfers, injuries, position changes) over a few days, not a data problem.
-- `scripts/ingest-fpl.ts`'s `mapPlayers` now reads this field verbatim (null/1/2/3/4/5, whatever
-- the API returns) -- no range validation is applied here or in that script, since FPL is free to
-- publish more than three priority ranks (observed live: up to 5) and a smallint column has no
-- reason to reject a value the source actually sends.
--
-- WHY THIS TICKET INGESTS IT WHEN #215 EXPLICITLY SAID NOT TO. #215's own recommendation ("do
-- not chase this via penalties_order ... for projection-accuracy purposes") stands and is not
-- contradicted here -- see docs/projection-model-backlog.md's ticket #219 entry for the full
-- reasoning. That recommendation was about NOT building a projection change on top of this field
-- without first measuring one; it was never an argument against ingesting the field itself, which
-- this ticket's own scope requires regardless of which way the measurement came out. The
-- measurement in the same entry found no model change clears its own falsification bar, so
-- nothing downstream of this column changed -- this migration adds data, not behaviour.
--
-- NULLABLE, NO DEFAULT -- DELIBERATE. The overwhelming majority of players never take a penalty
-- and genuinely have nothing to report here; a NOT NULL DEFAULT would manufacture a fake "not a
-- taker" for every player rather than leaving the honest "FPL has never named a priority for this
-- player" as NULL. Same null-means-not-applicable reasoning as
-- 20260901090000_teams_elo_stale_since.sql and 20260828090000_player_match_stats_team_goals_conceded.sql
-- for their own new columns.
--
-- SMALLINT, NOT INTEGER. FPL's own priority ranks are small positive integers (observed range
-- 1-5); smallint is the same choice ticket #146's element_type column already made for a
-- similarly small, bounded FPL enum on this same table's neighbours.
--
-- NO GRANT NEEDED IN THIS FILE. This is ADD COLUMN on public.players, a table created by the #9
-- reference-schema migration (20260811100000_reference_schema.sql) with its GRANTs already in
-- place via 20260811160000_table_grants.sql (SELECT for anon; SELECT, INSERT, UPDATE for
-- service_role -- table-level, not column-level, so it covers this new column automatically).
-- Same precedent 20260901090000_teams_elo_stale_since.sql and the #125/#146 migrations already
-- documented for their own new columns on existing tables. RLS is likewise unchanged -- the
-- existing table-level policies already cover every column.
--
-- NO ROLE GUARD, for the same reason those migrations carry none: this file issues no GRANT and
-- no CREATE POLICY referencing anon or service_role, so nothing here requires either role to
-- already exist in a bare Postgres install used for migration testing.
--
-- Idempotent by construction: ADD COLUMN IF NOT EXISTS. Running this file twice against the same
-- database is safe and creates nothing new the second time.

BEGIN;

ALTER TABLE public.players ADD COLUMN IF NOT EXISTS penalties_order smallint;

COMMENT ON COLUMN public.players.penalties_order IS
  'FPL''s own published penalty-taking priority for this player, straight from '
  'bootstrap-static/''s penalties_order field (1 = first choice, 2 = second choice, ...). NULL '
  'means FPL has never named a penalty-taking role for this player -- true of the large majority '
  'of the table. Populated by scripts/ingest-fpl.ts''s mapPlayers, verbatim, with no range '
  'validation (the source has been observed to publish values above 3). Ticket #219 ingests this '
  'field but ships NO projection-model change on top of it -- see '
  'docs/projection-model-backlog.md''s ticket #219 entry for the measured reason (an explicit '
  'penalty scoring term would double-count against xG, which already prices penalty value in at '
  '~0.79 per attempt regardless of outcome; a reduced-shrinkage treatment for first-choice takers '
  'was measured directly and made goal calibration worse, not better, so neither treatment '
  'shipped). This column exists for that measurement and for any future, separately-scoped use '
  '(e.g. a UI "penalty taker" badge) -- not because src/lib/projection/ reads it today.';

COMMIT;
