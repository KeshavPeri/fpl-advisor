-- Reference schema: teams, players, fixtures, gameweeks.
--
-- Ticket #9. These four tables hold reference data pulled straight from the
-- FPL API's bootstrap-static/ (teams, elements, events) and fixtures/
-- endpoints. Every ingest job (#11) and every projection reads from here.
-- Nothing in this file writes any data — it only creates structure.
--
-- Idempotent by construction: every CREATE TABLE / CREATE INDEX is
-- IF NOT EXISTS, ALTER TABLE ... ENABLE ROW LEVEL SECURITY is a no-op the
-- second time, and every policy is dropped-then-recreated. Running this file
-- twice against the same database is safe and creates nothing new the
-- second time.
--
-- Primary keys are the FPL integer ids themselves (teams.id = FPL team id,
-- players.id = FPL element id, gameweeks.id = FPL event id, fixtures.id =
-- FPL fixture id) — a Tier 2 decision, not re-litigated here. See the
-- Builder's ticket #9 report / decisions.md for the "because".
--
-- All timestamps are timestamptz, stored in UTC as the FPL API returns them.
-- Conversion to Asia/Singapore for display happens at the edge, not here
-- (product-brief.md §8).
--
-- now_cost is stored as the raw integer FPL returns (tenths of a million;
-- 85 means £8.5m) — never as a float. Formatting to "£8.5m" is a display
-- concern.

BEGIN;

-- ============================================================================
-- teams
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.teams (
  id                       integer PRIMARY KEY,        -- FPL team id
  name                     text NOT NULL,
  short_name               text NOT NULL,
  code                     integer,                     -- FPL's stable club code (crest/kit assets)
  strength                 integer,
  strength_overall_home    integer,
  strength_overall_away    integer,
  strength_attack_home     integer,
  strength_attack_away     integer,
  strength_defence_home    integer,
  strength_defence_away    integer,
  pulse_id                 integer,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.teams IS
  'Premier League clubs, from bootstrap-static/ "teams". Keyed on the FPL team id.';

-- ============================================================================
-- gameweeks
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.gameweeks (
  id                       integer PRIMARY KEY,        -- FPL event id
  name                     text NOT NULL,               -- e.g. "Gameweek 1"
  deadline_time            timestamptz NOT NULL,
  finished                 boolean NOT NULL DEFAULT false,
  is_previous              boolean NOT NULL DEFAULT false,
  is_current               boolean NOT NULL DEFAULT false,
  is_next                  boolean NOT NULL DEFAULT false,
  average_entry_score      integer,
  highest_score            integer,
  most_selected            integer,
  most_transferred_in      integer,
  top_element               integer,
  most_captained           integer,
  most_vice_captained      integer,
  transfers_made           integer,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.gameweeks IS
  'FPL gameweeks ("events" in bootstrap-static/). Keyed on the FPL event id. '
  'deadline_time is the source of the deadline countdown on the home screen.';

-- ============================================================================
-- players
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.players (
  id                            integer PRIMARY KEY,   -- FPL element id
  code                          integer,                -- FPL's stable player code (shirt assets)
  web_name                      text NOT NULL,
  first_name                    text,
  second_name                   text,
  team_id                       integer NOT NULL REFERENCES public.teams (id),
  element_type                  smallint NOT NULL,      -- 1 GK, 2 DEF, 3 MID, 4 FWD
  now_cost                      integer NOT NULL,       -- tenths of a million, as FPL returns it
  status                        text NOT NULL DEFAULT 'a',  -- a/d/i/s/u/n, straight from the API
  chance_of_playing_next_round  integer,
  chance_of_playing_this_round  integer,
  news                          text,
  news_added                    timestamptz,
  total_points                  integer NOT NULL DEFAULT 0,
  form                          numeric(4,1),
  selected_by_percent           numeric(4,1),
  minutes                       integer NOT NULL DEFAULT 0,
  goals_scored                  integer NOT NULL DEFAULT 0,
  assists                       integer NOT NULL DEFAULT 0,
  clean_sheets                  integer NOT NULL DEFAULT 0,
  goals_conceded                integer NOT NULL DEFAULT 0,
  own_goals                     integer NOT NULL DEFAULT 0,
  penalties_saved               integer NOT NULL DEFAULT 0,
  penalties_missed              integer NOT NULL DEFAULT 0,
  yellow_cards                  integer NOT NULL DEFAULT 0,
  red_cards                     integer NOT NULL DEFAULT 0,
  saves                         integer NOT NULL DEFAULT 0,
  bonus                         integer NOT NULL DEFAULT 0,
  bps                           integer NOT NULL DEFAULT 0,
  influence                     numeric(6,1),
  creativity                    numeric(6,1),
  threat                        numeric(6,1),
  ict_index                     numeric(6,1),
  defensive_contribution        integer NOT NULL DEFAULT 0,
  expected_goals                numeric(5,2) NOT NULL DEFAULT 0,
  expected_assists              numeric(5,2) NOT NULL DEFAULT 0,
  expected_goal_involvements    numeric(5,2) NOT NULL DEFAULT 0,
  expected_goals_conceded       numeric(5,2) NOT NULL DEFAULT 0,
  updated_at                    timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.players IS
  'FPL players ("elements" in bootstrap-static/). Keyed on the FPL element id.';

-- ============================================================================
-- fixtures
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fixtures (
  id                       integer PRIMARY KEY,        -- FPL fixture id
  event_id                 integer REFERENCES public.gameweeks (id),  -- null for blank-gameweek fixtures not yet assigned
  team_h                   integer NOT NULL REFERENCES public.teams (id),
  team_a                   integer NOT NULL REFERENCES public.teams (id),
  team_h_score             smallint,
  team_a_score             smallint,
  team_h_difficulty        smallint,
  team_a_difficulty        smallint,
  kickoff_time             timestamptz,                 -- null while FPL has the fixture as TBC
  started                  boolean NOT NULL DEFAULT false,
  finished                 boolean NOT NULL DEFAULT false,
  finished_provisional     boolean NOT NULL DEFAULT false,
  minutes                  smallint NOT NULL DEFAULT 0,
  provisional_start_time   boolean NOT NULL DEFAULT false,
  pulse_id                 integer,
  updated_at               timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.fixtures IS
  'Premier League fixtures, from fixtures/. Keyed on the FPL fixture id.';

-- ============================================================================
-- Indexes — sensible defaults for the columns later jobs will filter by.
-- ============================================================================

CREATE INDEX IF NOT EXISTS idx_fixtures_kickoff_time ON public.fixtures (kickoff_time);
CREATE INDEX IF NOT EXISTS idx_fixtures_event_id ON public.fixtures (event_id);
CREATE INDEX IF NOT EXISTS idx_fixtures_team_h ON public.fixtures (team_h);
CREATE INDEX IF NOT EXISTS idx_fixtures_team_a ON public.fixtures (team_a);
CREATE INDEX IF NOT EXISTS idx_players_team_id ON public.players (team_id);

-- ============================================================================
-- Row Level Security — read-only for the anon role.
--
-- Writes come from the ingest Action using the Supabase secret key, which
-- bypasses RLS entirely. There is deliberately no insert/update/delete
-- policy for anon on any of these tables.
-- ============================================================================

ALTER TABLE public.teams ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "teams_select_anon" ON public.teams;
CREATE POLICY "teams_select_anon" ON public.teams FOR SELECT TO anon USING (true);

ALTER TABLE public.gameweeks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "gameweeks_select_anon" ON public.gameweeks;
CREATE POLICY "gameweeks_select_anon" ON public.gameweeks FOR SELECT TO anon USING (true);

ALTER TABLE public.players ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "players_select_anon" ON public.players;
CREATE POLICY "players_select_anon" ON public.players FOR SELECT TO anon USING (true);

ALTER TABLE public.fixtures ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fixtures_select_anon" ON public.fixtures;
CREATE POLICY "fixtures_select_anon" ON public.fixtures FOR SELECT TO anon USING (true);

COMMIT;
