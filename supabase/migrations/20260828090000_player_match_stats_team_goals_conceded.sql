-- player_match_stats.team_goals_conceded: the team-level figure clean sheets
-- must be read from.
--
-- Ticket #125. THE README ERROR THIS FIXES. supabase/README.md's row for
-- 20260818100000_player_match_stats_competition.sql has, since 18 Aug 2026,
-- claimed that migration adds team_goals_conceded to player_match_stats.
-- Read directly: that migration adds `competition` and nothing else. No
-- migration in this repository has ever added team_goals_conceded --
-- `grep -rl team_goals_conceded supabase/migrations/` returned nothing before
-- this file. Ticket #121 was written against the README's false claim, which
-- is why scripts/build-feature-history.ts already selects
-- player_match_stats.team_goals_conceded and fails loudly (a named,
-- non-crashing error surfaced through job_runs) when the column is not
-- there -- that failure was correct behaviour given a column that did not
-- exist, and this migration is what makes the read it was already written
-- for succeed. See that file's "TEAM_GOALS_CONCEDED" header section and
-- supabase/README.md's corrected row for the #54 migration, both updated by
-- this same ticket.
--
-- WHY THIS COLUMN, NOT goals_conceded. player_match_stats.goals_conceded is
-- a GOALKEEPER-ONLY stat, verified against real ingested rows: populated on
-- 74% of goalkeeper rows and only 1.1% of outfield rows. A clean-sheet read
-- built on it would be correct for keepers and silently wrong for the other
-- ten outfield players on the pitch. team_goals_conceded, by contrast, is
-- the same team-level figure FPL uses for clean sheets: how many goals the
-- player's own team conceded in that match, present on every player's row
-- regardless of position. The source CSV
-- (data/{season}/By Gameweek/GW{n}/playermatchstats.csv from
-- FPL-Core-Insights) carries this column already; it has simply never been
-- ingested until this ticket. See the COMMENT ON COLUMN below for the
-- consumer-facing version of this note.
--
-- NULLABLE, NO DEFAULT -- DELIBERATE (Tier 2, logged HIGH-IMPACT). A row
-- ingested before this column existed genuinely has no value for it -- that
-- is a different fact from "this team conceded zero goals in this match",
-- and a NOT NULL DEFAULT 0 would collapse the two into the same
-- indistinguishable zero. Every consumer must treat NULL as "not yet
-- known" (a row not yet re-stamped by a re-ingest) and never assume zero --
-- the same reasoning `competition` documents for itself in the #54
-- migration. scripts/ingest-core-insights.ts re-stamps every row, existing
-- and new, on every run (see that file's header), so the null population
-- shrinks toward zero as re-ingests happen -- there is no separate backfill
-- script and none is needed.
--
-- BONUS AND BPS ARE NOT IN THIS SOURCE (Tier 2, logged HIGH-IMPACT --
-- recorded here, not acted on). Checked directly against
-- data/2025-2026/By Gameweek/GW1/playermatchstats.csv while building this
-- migration: the source FPL-Core-Insights publishes carries no bonus or bps
-- column, in GW1 or any other gameweek file inspected. This permanently
-- rules out validating the bonus-points projection (ticket #78) against
-- per-match actuals from this source -- there is nothing here to validate
-- against. No column is added for either field; nothing in this file or in
-- scripts/ingest-core-insights.ts pretends otherwise. See this ticket's
-- Builder report and decisions/ticket-125.md for the same finding logged at
-- the point it was made.
--
-- NO GRANT NEEDED IN THIS FILE. This is ADD COLUMN on a table that already
-- exists (created by the #12 migration,
-- 20260811170000_player_match_stats.sql) with its GRANTs already in place
-- (SELECT for anon; SELECT, INSERT, UPDATE for service_role -- table-level,
-- not column-level, so they cover this new column automatically). This is
-- the exact precedent the #54 migration
-- (20260818100000_player_match_stats_competition.sql) already documented for
-- its own new column on this same table; nothing here needs to repeat that
-- reasoning beyond citing it.
--
-- NO ROLE GUARD, for the same reason the #54 migration carries none: this
-- file issues no GRANT and no CREATE POLICY referencing anon or
-- service_role, so nothing here requires either role to already exist in a
-- bare Postgres install used for migration testing.
--
-- Idempotent by construction: ADD COLUMN IF NOT EXISTS. Running this file
-- twice against the same database is safe and creates nothing new the
-- second time.

BEGIN;

ALTER TABLE public.player_match_stats ADD COLUMN IF NOT EXISTS team_goals_conceded integer;

COMMENT ON COLUMN public.player_match_stats.team_goals_conceded IS
  'The team-level figure clean sheets must be read from: how many goals the '
  'player''s own team conceded in this match, populated on every player''s '
  'row regardless of position. The pre-existing goals_conceded column is a '
  'GOALKEEPER-ONLY stat -- populated on 74% of goalkeeper rows and only 1.1% '
  'of outfield rows -- and must never be substituted for this one. NULL '
  'means the row has not been re-stamped by scripts/ingest-core-insights.ts '
  'since this column was added -- treat as unknown, never assume zero. See '
  'ticket #125.';

COMMIT;
