-- fixture_odds: market odds as the forward fixture term — ticket #238.
--
-- ============================================================================
-- Why this table exists.
-- ============================================================================
-- The results-derived team-strength term (public.fixtures, src/lib/projection/teamStrength.ts,
-- tickets #114/#229/#235) is current but lags by construction — it cannot know a suspension, a
-- rotation after a midweek European tie, or an injury crisis. Bookmakers price all of that,
-- continuously, with real money behind the estimate. This table stores what The Odds API returns,
-- one row per fetch, so the fixture term can use a genuinely forward-looking instrument whenever
-- one is available and trustworthy — see src/lib/projection/expectedPoints.ts's
-- resolveFixtureExpectedScore, which now tries this tier FIRST.
--
-- ============================================================================
-- Source.
-- ============================================================================
-- GET https://api.the-odds-api.com/v4/sports/soccer_epl/odds?regions=uk&markets=h2h&oddsFormat=decimal&apiKey=...
-- Free tier, 500 requests/month. Measured against the live key on 15 Sept 2026: one call returned
-- 20 fixtures (roughly four gameweeks of forward coverage, ~24 days), every fixture carried 21
-- bookmakers, and the call cost 1 credit (a daily run costs about 30/month). See
-- scripts/ingest-match-odds.ts for the club-name mapping and freshness/book-count rules.
--
-- ============================================================================
-- Append-only — one row per fetch, never an upsert.
-- ============================================================================
-- Same convention as public.notifications: this table keeps the full price history so a later
-- ticket can measure how much the market moved before a deadline. `fetched_at` (not
-- `fixture_id` alone) is what makes each fetch its own row — scripts/ingest-match-odds.ts reads
-- the MOST RECENT row per fixture_id (`ORDER BY fetched_at DESC LIMIT 1` per fixture, done at
-- read time by scripts/project-points.ts / scripts/team-strength-diagnostic.ts) and never deletes
-- or overwrites an older one.
--
-- ============================================================================
-- Storage: medians and probabilities are already overround-removed here, not re-derived by every
-- reader.
-- ============================================================================
-- median_home/median_draw/median_away are the median decimal price across every bookmaker
-- returned for that fixture (src/lib/projection/marketOdds.ts's medianOddsAcrossBooks — robust to
-- a single stale or mispriced feed, never the mean, never one chosen book). p_home/p_draw/p_away
-- and overround are that median's proportional overround removal (marketOdds.ts's
-- removeOverround) — stored once at ingest time, so every reader (the live projection, the
-- diagnostic) reads the same three probabilities rather than each re-deriving them from the raw
-- prices.
--
-- Idempotent by construction, matching every migration since #9: CREATE TABLE / CREATE INDEX are
-- IF NOT EXISTS, the policy is dropped-then-recreated, GRANTs are safe to re-run.

BEGIN;

-- ============================================================================
-- Roles — see the #9 migration for why this guard exists: real Supabase (and its local dev CLI)
-- provisions anon/service_role automatically, a bare Postgres install used for migration testing
-- does not.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'service_role') THEN
    CREATE ROLE service_role NOLOGIN BYPASSRLS;
  END IF;
END
$$;

-- ============================================================================
-- fixture_odds
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.fixture_odds (
  id           bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  fixture_id   integer NOT NULL REFERENCES public.fixtures (id),
  fetched_at   timestamptz NOT NULL DEFAULT now(),
  book_count   integer NOT NULL,
  median_home  numeric NOT NULL,
  median_draw  numeric NOT NULL,
  median_away  numeric NOT NULL,
  p_home       numeric NOT NULL,
  p_draw       numeric NOT NULL,
  p_away       numeric NOT NULL,
  overround    numeric NOT NULL
);

COMMENT ON TABLE public.fixture_odds IS
  'Market odds as the forward fixture term (ticket #238) — one row per scripts/ingest-match-odds.ts '
  'fetch, APPEND-ONLY (never an upsert, same convention as public.notifications), so the price '
  'history is kept. A fixture uses this term only when the MOST RECENT row for it is under 48h '
  'old and book_count >= 3 (src/lib/projection/marketOdds.ts, resolveFixtureExpectedScore) — '
  'everything else keeps the point-in-time team-strength term.';

COMMENT ON COLUMN public.fixture_odds.fixture_id IS
  'FK to public.fixtures — resolved from The Odds API''s own club names via '
  'scripts/lib/oddsClubNames.ts''s explicit, committed name map (never fuzzy-matched) and the '
  'current public.fixtures schedule. A fixture whose two clubs cannot both be resolved, or that '
  'cannot be matched to a scheduled public.fixtures row, is skipped and counted — never guessed.';

COMMENT ON COLUMN public.fixture_odds.fetched_at IS
  'When this row was fetched from The Odds API — NOT the fixture kickoff time. Defines this row''s '
  'own freshness window (48h) for resolveFixtureExpectedScore.';

COMMENT ON COLUMN public.fixture_odds.book_count IS
  'Number of bookmakers whose h2h market for this fixture parsed successfully and fed the median '
  'below. Must be >= 3 (MIN_MARKET_ODDS_BOOK_COUNT) before this row is trusted by the projection — '
  'a real value below 3 is still stored, for diagnosis, but never used.';

COMMENT ON COLUMN public.fixture_odds.median_home IS 'Median decimal home-win price across every bookmaker read for this fixture.';
COMMENT ON COLUMN public.fixture_odds.median_draw IS 'Median decimal draw price across every bookmaker read for this fixture.';
COMMENT ON COLUMN public.fixture_odds.median_away IS 'Median decimal away-win price across every bookmaker read for this fixture.';

COMMENT ON COLUMN public.fixture_odds.p_home IS 'Proportional-overround-removed home-win probability, derived from median_home/median_draw/median_away at ingest time.';
COMMENT ON COLUMN public.fixture_odds.p_draw IS 'Proportional-overround-removed draw probability.';
COMMENT ON COLUMN public.fixture_odds.p_away IS 'Proportional-overround-removed away-win probability. p_home + p_draw + p_away sums to exactly 1 by construction.';

COMMENT ON COLUMN public.fixture_odds.overround IS
  'The bookmaker''s combined margin before proportional normalisation (sum of 1/median price '
  'across the three outcomes) — a real UK three-way market sits in roughly [1.00, 1.15]; outside '
  'that range the prices were likely misparsed (scripts/team-strength-diagnostic.ts''s '
  'falsification-gate item 3).';

CREATE INDEX IF NOT EXISTS idx_fixture_odds_fixture_id_fetched_at ON public.fixture_odds (fixture_id, fetched_at DESC);

-- ============================================================================
-- Row Level Security — read-only for anon, same pattern as every job/projection table (#9/#10/
-- #33/#73). Writes come from the scheduled job using the Supabase secret key, which bypasses RLS
-- entirely — there is deliberately no insert policy for anon.
-- ============================================================================

ALTER TABLE public.fixture_odds ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "fixture_odds_select_anon" ON public.fixture_odds;
CREATE POLICY "fixture_odds_select_anon" ON public.fixture_odds FOR SELECT TO anon USING (true);

-- ============================================================================
-- GRANTs — RLS and GRANTs are two independent gates (see the #10/table_grants migration for the
-- full "because"). service_role gets SELECT and INSERT only — no UPDATE, no DELETE, so
-- append-only (ticket text: "one row per fetch, never an upsert") is a database guarantee, same
-- as public.notifications and public.recommendation_decisions.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, service_role;

GRANT SELECT ON public.fixture_odds TO anon;
GRANT SELECT, INSERT ON public.fixture_odds TO service_role;

COMMIT;
