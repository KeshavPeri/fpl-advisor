-- training_features: point-in-time training substrate for the learned
-- model (R6, feature-list items 30/31 reshaped).
--
-- Ticket #203. THIS TICKET CHANGES NOTHING USER-VISIBLE. It creates
-- structure only and writes no data -- scripts/build-training-features.ts is
-- the job that populates it, run by hand, on demand, for one season at a
-- time, exactly like scripts/build-feature-history.ts. No model is trained
-- and no model is evaluated by this ticket; that is the next slice. This
-- migration is applied to no environment automatically; see
-- supabase/README.md.
--
-- WHY THIS TABLE EXISTS. docs/model-review-2026-09-02.md's question 4 and
-- docs/projection-model-backlog.md's R6 both name the same next step: a
-- small learned model on the columns this repo already ingests, trained on
-- point-in-time aggregates, written behind the player_projections CSV seam
-- as model_version = 'learned-v1'. Report 10 (4 Sep 2026) measured the
-- five-input hand-built model losing to a one-line "rank by prior minutes"
-- baseline at midfield (0.412 vs 0.464) and forward (0.452 vs 0.476) on the
-- five-gameweek target the solver actually optimises. A learned model needs
-- training ROWS -- point-in-time feature vectors, one per (season,
-- gameweek, player) -- and this table is exactly that, built on the same
-- strictly-before, lookahead-free discipline public.feature_history already
-- established (tickets #121/#125/#146/#167/#181).
--
-- THE GATE THIS SUBSTRATE IS BUILT TOWARD (stated here so a reader of this
-- migration does not have to cross-reference the ticket to know why these
-- columns and no others): learned-v1 must beat the NAIVE minutes baseline
-- per position on the five-gameweek target, on the same measured population
-- as backtest report 10 --
--   Goalkeeper 0.240 | Defender 0.374 | Midfielder 0.464 | Forward 0.476
-- -- not the repaired baseline (report 10 already showed the naive baseline
-- beating baseline-v1 at midfield and forward, so that gate would be too
-- weak). See docs/projection-model-backlog.md for the full gate table and
-- the hindsight ceiling it is read against. This table trains no model and
-- proves no gate; it only makes the gate measurable once a model exists.
--
-- WHY THESE COLUMNS, AND WHY NOT OPENFPL'S 196. product-brief.md §6d and
-- docs/model-review-2026-09-02.md both name reconstructing OpenFPL's
-- 196-206 undocumented features as the ticket shape this pipeline handles
-- worst -- no objective definition of done. This table instead carries the
-- ~15 strongest columns this repo's own ingest already holds: shots on
-- target, the existing xG/xA rates, the minutes structure (the true
-- last-five-match window plus a season-long average), the two
-- defensive-contribution counters, position, team code, opponent team
-- code(s), and the point-in-time team-strength figures
-- scripts/run-backtest.ts already computes for exactly this purpose (ticket
-- #175). FOUR columns named in the ticket -- total shots, chances created,
-- big chances missed, and touches in the opposition box -- turned out NOT
-- to be ingested anywhere in this repo (public.player_match_stats has
-- shots_on_target but no separate total-shots column, and has none of the
-- other three at all) and are DROPPED rather than triggering a new ingest,
-- per the ticket's own explicit instruction. See
-- scripts/build-training-features.ts's header for the full column-by-column
-- "why" and docs/projection-model-backlog.md for the record of what was
-- dropped and why.
--
-- RATES AND SHARES, DELIBERATELY UNLIKE feature_history (Tier 2, logged
-- HIGH-IMPACT on this ticket). feature_history stores RAW cumulative totals
-- only, never a rate, because the rate model (SHRINKAGE_K, the position
-- prior, two-stage shrinkage) has changed repeatedly and a stored rate would
-- freeze one version of a moving model into a table meant to outlive all of
-- them (see that table's own header). This table is a different kind of
-- object -- a training-features table, not a raw-facts ledger -- and the
-- ticket's own wording asks for "rates" (xG/xA) and a "season share"
-- (minutes), not totals. xg_rate_per90/xa_rate_per90/season_avg_minutes
-- below are therefore genuinely computed here: plain, UNSHRUNK per-90 (or
-- per-match) rates straight from feature_history's own prior_xg/prior_xa/
-- prior_minutes/prior_matches -- deliberately NOT the shrunk rate
-- src/lib/projection/rates.ts's computePlayerRates/computeTwoStagePlayerRates
-- would produce. Shrinkage strength (SHRINKAGE_K) and the position-prior
-- construction are baseline-v1-specific modelling choices; baking them into
-- the training substrate would tie every future learned-model attempt to
-- baseline-v1's own current tuning and would re-derive baseline-v1 with
-- different weights rather than let a learned model see the raw signal and
-- find its own weighting. prior_matches is also stored raw (not folded into
-- either rate) precisely so a consumer can bucket by evidence volume the way
-- docs/projection-model-backlog.md's G10 already did for defcon cold-start.
--
-- A ROW REQUIRES prior_matches > 0 -- NO ROW OF ZEROS, UNLIKE
-- feature_history. feature_history deliberately emits a zero-totals row for
-- a player's very first (debut) gameweek, because a raw-facts ledger must
-- answer "what was true as of every gameweek" including "nothing yet". A
-- training row with every feature at its position-prior/zero default
-- carries no real signal about that player and would only teach a model
-- "no history looks like this" on every single such row -- baseline-v1
-- already handles that population with the position prior
-- (docs/projection-model-backlog.md G2); this table's job is to carry
-- players who DO have evidence. scripts/build-training-features.ts skips a
-- feature_history row with prior_matches = 0 rather than writing one here.
--
-- OPPONENT IDENTITY IS SCHEDULE, NOT RESULT, AND IS AN ARRAY BECAUSE A
-- GAMEWEEK CAN HOLD MORE THAN ONE FIXTURE. Unlike every prior_* column
-- (strictly BEFORE gameweek_id), opponent_team_codes describes gameweek_id's
-- OWN fixture(s) -- legitimately knowable in advance (the published
-- fixture list), never a result. docs/projection-model-backlog.md's G14
-- entry confirms this distinction explicitly: fixture identity is real,
-- non-hindsight information a model may use; only match OUTCOMES and
-- match-day form are hindsight. Stored as an array (never a single nullable
-- column) because a double gameweek has two opponents -- the same reasoning
-- ticket #193's buildClubFixtureSchedule already applies in
-- scripts/run-backtest.ts, reused here unmodified rather than re-derived.
--
-- TEAM-STRENGTH FIGURES ARE THE PLAYER'S OWN CLUB ONLY, RAW, NOT AN
-- EXPECTED-SCORE RATIO. team_strength_matches/goals_scored/goals_conceded
-- is the player's own club's point-in-time TeamStrengthRecord (ticket #175,
-- scripts/run-backtest.ts's computeTeamStrengthAsOf, reused unmodified,
-- called with THIS row's own gameweek_id as the strictly-before cutoff) --
-- the raw goals-for/against/matches a fixture-difficulty figure would be
-- built from, not the figure itself. Deliberately NOT the derived
-- expectedScore (computeFixtureExpectedScore, SCALE = 5.6225): that
-- constant is itself a calibrated, revisitable modelling choice (see
-- docs/projection-model-backlog.md G8/G12), and storing raw counts here
-- lets any future SCALE or construction be applied after the fact, exactly
-- the same "raw fact, not a moving model's output" reasoning
-- feature_history already uses for prior_xg/prior_xa. The OPPONENT's own
-- team-strength figures are not stored on this row (a double gameweek would
-- need two, and computing them is a cheap re-application of the same
-- reused, pure computeTeamStrengthAsOf function a consumer already has to
-- import) -- left to whichever ticket actually trains a model, per this
-- ticket's own scope ("no model is trained here").
--
-- KEYED ON player_code, NEVER the per-season FPL element id -- same
-- reasoning as feature_history and every cross-season table in this repo
-- (deltas.md D9).
--
-- Idempotent by construction, matching every migration since #9: CREATE
-- TABLE / CREATE INDEX IF NOT EXISTS, policy dropped then recreated. Running
-- this file twice against the same database is safe and creates nothing new
-- the second time.

BEGIN;

-- ============================================================================
-- Roles -- see the #9 migration for why this guard exists: real Supabase
-- (and its local dev CLI) provisions `anon`/`service_role` automatically,
-- but a bare Postgres install used for migration testing does not.
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
-- training_features
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.training_features (
  season                          text NOT NULL,               -- e.g. "2025-2026" -- the ingested season this row's features belong to
  gameweek_id                     integer NOT NULL,            -- the plain gameweek number, 1-38 -- NOT an FK, same convention as feature_history.gameweek_id
  player_code                     integer NOT NULL,            -- the stable cross-season identifier -- never the per-season element id

  -- Identity, copied through from feature_history (never re-derived, never
  -- from the live players/teams tables -- see feature_history's own header
  -- for why). NULL means feature_history itself could not resolve it for
  -- this player/season.
  element_type                    smallint,                    -- position: 1 = GK, 2 = DEF, 3 = MID, 4 = FWD
  team_code                       integer,                     -- the player's own club for this season

  -- Evidence volume, copied from feature_history.prior_matches. Always > 0
  -- on a row that exists here -- see file header, "A ROW REQUIRES
  -- prior_matches > 0". Kept so a consumer can bucket by history depth
  -- (docs/projection-model-backlog.md G10's cold-start bucketing) without a
  -- second read of feature_history.
  prior_matches                   integer NOT NULL,

  -- Attacking rate signal: plain, UNSHRUNK per-90 rates from
  -- feature_history's own prior_xg/prior_xa divided by prior_minutes/90.
  -- NULL only when prior_minutes = 0 despite prior_matches > 0 (a player
  -- whose only prior "matches" were unused-substitute rows with zero
  -- minutes) -- a genuine "no rate can be computed" case, never a
  -- fabricated zero. See file header, "RATES AND SHARES".
  xg_rate_per90                   numeric,
  xa_rate_per90                   numeric,

  -- Minutes structure -- ticket's own two-part phrasing: the true recent
  -- window, and the season-long share.
  prior_recent_minutes            integer[],                   -- copied verbatim from feature_history.prior_recent_minutes: last RECENT_MATCH_COUNT (5) match minutes, most recent first, strictly before gameweek_id
  season_avg_minutes              numeric,                     -- prior_minutes / prior_matches -- average minutes per Premier League match so far this season, strictly before gameweek_id. Never null on a written row: prior_matches > 0 is this table's own admission requirement.

  -- Shot volume -- the one of the ticket's five named "shots/chances/
  -- touches" columns that IS actually ingested (public.player_match_stats.
  -- shots_on_target). A NEW strictly-before cumulative total, computed by
  -- scripts/build-training-features.ts directly from player_match_stats
  -- (feature_history does not carry this column) using the identical
  -- strictly-before walk feature_history's own prior_* totals use. Never
  -- null: a player_match_stats cell that is blank/non-numeric contributes 0
  -- to the running total, same treatment every prior_* total in
  -- feature_history already gives a missing cell.
  prior_shots_on_target           integer NOT NULL DEFAULT 0,

  -- Defensive-contribution counters -- raw per-match counts, copied
  -- verbatim from feature_history (never re-derived; a hit rate cannot be
  -- recovered from a cumulative total -- see feature_history's own #146
  -- migration header). NULL means feature_history itself has not computed
  -- them for this row (predates ticket #146, or never rebuilt since).
  prior_defcon_qualifying_matches integer,
  prior_defcon_hits               integer,

  -- This gameweek's OWN fixture(s) -- schedule, not result. See file
  -- header, "OPPONENT IDENTITY IS SCHEDULE, NOT RESULT". Empty array means
  -- a genuine blank gameweek for this player's club (or a club_code the
  -- schedule could not resolve), never an unresolved reading -- see
  -- scripts/build-training-features.ts for how that is distinguished and
  -- counted. An individual array element may itself be NULL when the
  -- source's own match_id slug did not resolve to a known club (same
  -- "counted, never guessed" treatment scripts/run-backtest.ts's own
  -- buildClubFixtureSchedule already gives it).
  opponent_team_codes             integer[] NOT NULL DEFAULT '{}',

  -- The player's OWN club's point-in-time TeamStrengthRecord, strictly
  -- before gameweek_id -- raw goals-for/against/matches, not a derived
  -- expected-score ratio. See file header, "TEAM-STRENGTH FIGURES". Zero on
  -- every field is a real value (a club with no resolvable prior matches
  -- yet, e.g. very early in a season), not a missing-data marker -- exactly
  -- computeTeamStrengthAsOf's own return shape for an empty prior record.
  team_strength_matches           integer NOT NULL DEFAULT 0,
  team_strength_goals_scored      integer NOT NULL DEFAULT 0,
  team_strength_goals_conceded    integer NOT NULL DEFAULT 0,

  computed_at                     timestamptz NOT NULL DEFAULT now(),

  PRIMARY KEY (season, gameweek_id, player_code)
);

COMMENT ON TABLE public.training_features IS
  'Point-in-time training substrate for the learned model (R6), one row per '
  '(season, gameweek_id, player_code), built on the SAME strictly-before, '
  'lookahead-free discipline as public.feature_history. UNLIKE '
  'feature_history, a row exists only when prior_matches > 0 (no '
  'row-of-zeros for a debut gameweek), and several columns are genuinely '
  'computed RATES/SHARES rather than raw totals -- see this table''s own '
  'migration file header for the full reasoning. No model is trained or '
  'evaluated by the ticket that created this table (#203); it is substrate '
  'only, consumed by a follow-up ticket.';

COMMENT ON COLUMN public.training_features.season IS
  'The ingested season this row''s features belong to, e.g. "2025-2026" -- matches feature_history.season exactly.';

COMMENT ON COLUMN public.training_features.gameweek_id IS
  'The plain gameweek number (1-38) this row''s features are point-in-time as of -- matches feature_history.gameweek_id. NOT a foreign key (see feature_history''s own header for why).';

COMMENT ON COLUMN public.training_features.player_code IS
  'The stable cross-season player identifier -- never the per-season FPL element id (deltas.md D9). Matches feature_history.player_code and public.player_match_stats.player_code.';

COMMENT ON COLUMN public.training_features.element_type IS
  'FPL position code (1 = GK, 2 = DEF, 3 = MID, 4 = FWD), copied from feature_history.element_type -- expected to carry signal because scoring rules, and therefore the whole model, are position-specific. NULL means feature_history could not resolve it.';

COMMENT ON COLUMN public.training_features.team_code IS
  'The player''s own club (matching public.teams.code, never an FPL team id), copied from feature_history.team_code -- identifies which team_strength_* figures below belong to this player. NULL means feature_history could not resolve it.';

COMMENT ON COLUMN public.training_features.prior_matches IS
  'Count of this player''s Premier League matches strictly before gameweek_id, this season -- copied from feature_history.prior_matches. Always > 0 on a row in this table (see table comment). Expected to carry signal as an evidence-volume feature: a learned model, like docs/projection-model-backlog.md''s G10 bucketing, can weight or condition on how much history a rate/share below is actually based on.';

COMMENT ON COLUMN public.training_features.xg_rate_per90 IS
  'Plain, UNSHRUNK expected-goals per 90 minutes: feature_history.prior_xg / (feature_history.prior_minutes / 90). NULL when prior_minutes = 0. Expected to carry signal as the model''s most direct attacking-quality read -- deliberately not the shrunk src/lib/projection/rates.ts rate; see migration file header, "RATES AND SHARES".';

COMMENT ON COLUMN public.training_features.xa_rate_per90 IS
  'Plain, UNSHRUNK expected-assists per 90 minutes: feature_history.prior_xa / (feature_history.prior_minutes / 90). NULL when prior_minutes = 0. Same reasoning and same caveat as xg_rate_per90.';

COMMENT ON COLUMN public.training_features.prior_recent_minutes IS
  'This player''s minutes played in his most recent Premier League matches, most recent first, capped at RECENT_MATCH_COUNT (5), strictly before gameweek_id -- copied verbatim from feature_history.prior_recent_minutes (ticket #181). Expected to carry signal as the "is he currently a nailed starter" read the live model''s own estimateMinutes() uses.';

COMMENT ON COLUMN public.training_features.season_avg_minutes IS
  'prior_minutes / prior_matches from feature_history -- average minutes per Premier League match so far this season, strictly before gameweek_id. Never null on a written row (prior_matches > 0 is this table''s own admission rule). Expected to carry signal alongside prior_recent_minutes: docs/model-review-2026-09-02.md 1f found the plain season-average-minutes baseline BEATS the 5-match-window model for midfielders at the 5-gameweek horizon (0.473 vs 0.444) -- the recent window is too reactive for a longer horizon, so a learned model should see both and can learn its own blend.';

COMMENT ON COLUMN public.training_features.prior_shots_on_target IS
  'Cumulative shots on target across this player''s Premier League matches strictly before gameweek_id -- a NEW strictly-before total computed by scripts/build-training-features.ts directly from public.player_match_stats.shots_on_target (not stored on feature_history). Expected to carry signal as a volume-of-chances proxy independent of finishing variance, i.e. a more stable attacking-involvement read than goals themselves.';

COMMENT ON COLUMN public.training_features.prior_defcon_qualifying_matches IS
  'Count of this player''s qualifying (60+ minute) Premier League matches strictly before gameweek_id -- copied from feature_history.prior_defcon_qualifying_matches (ticket #146). NULL means feature_history has not computed it for this row.';

COMMENT ON COLUMN public.training_features.prior_defcon_hits IS
  'Of prior_defcon_qualifying_matches, the count in which the player reached his position''s defensive-contribution threshold -- copied from feature_history.prior_defcon_hits (ticket #146). Expected to carry signal alongside prior_defcon_qualifying_matches as a defensive-contribution hit-rate feature, load-bearing since 2026/27''s scoring rules (product-brief.md §6d). NULL means feature_history has not computed it for this row.';

COMMENT ON COLUMN public.training_features.opponent_team_codes IS
  'The club(s) (matching public.teams.code) this player''s own club faces in gameweek_id itself -- SCHEDULE, not result; legitimately knowable in advance (docs/projection-model-backlog.md G14), never a hindsight leak. An array because a double gameweek has two entries; empty ({}) means a genuine blank gameweek for this club, or a club with no resolvable schedule entry. An individual entry may be NULL when the source match_id could not be resolved to a known club. Built via scripts/run-backtest.ts''s buildClubFixtureSchedule/lookupClubFixtureSchedule (ticket #193), reused unmodified. Expected to carry signal as fixture-difficulty identity -- who the opponent below''s team_strength_* figures belong to would come from re-running computeTeamStrengthAsOf on this club code, not stored redundantly on this row (see migration file header).';

COMMENT ON COLUMN public.training_features.team_strength_matches IS
  'This player''s own club''s count of resolvable prior matches (goals scored AND conceded both known), strictly before gameweek_id -- from scripts/run-backtest.ts''s computeTeamStrengthAsOf (ticket #175), reused unmodified. Raw count, not a rate -- see migration file header, "TEAM-STRENGTH FIGURES".';

COMMENT ON COLUMN public.training_features.team_strength_goals_scored IS
  'This player''s own club''s total goals scored across team_strength_matches, strictly before gameweek_id -- from computeTeamStrengthAsOf, reused unmodified. Expected to carry signal, alongside team_strength_goals_conceded, as the raw material of a fixture-adjustment/team-quality feature the way scripts/run-backtest.ts''s own expectedScore construction already uses it -- but that construction (SCALE = 5.6225) is deliberately NOT baked in here; see migration file header.';

COMMENT ON COLUMN public.training_features.team_strength_goals_conceded IS
  'This player''s own club''s total goals conceded across team_strength_matches, strictly before gameweek_id -- from computeTeamStrengthAsOf, reused unmodified. Same reasoning as team_strength_goals_scored.';

COMMENT ON COLUMN public.training_features.computed_at IS
  'When this row was written by scripts/build-training-features.ts -- diagnostic only, never read by any consumer''s logic.';

CREATE INDEX IF NOT EXISTS idx_training_features_player_code ON public.training_features (player_code);
CREATE INDEX IF NOT EXISTS idx_training_features_season_gameweek ON public.training_features (season, gameweek_id);

-- ============================================================================
-- Row Level Security -- read-only for the anon role, same pattern as
-- feature_history.
--
-- Writes come from a hand-run job using the Supabase secret key, which
-- bypasses RLS entirely. There is deliberately no insert/update/delete
-- policy for anon on this table.
-- ============================================================================

ALTER TABLE public.training_features ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "training_features_select_anon" ON public.training_features;
CREATE POLICY "training_features_select_anon" ON public.training_features FOR SELECT TO anon USING (true);

-- ============================================================================
-- GRANTs -- RLS and GRANTs are two independent gates (see the #10/
-- table_grants migration for the full "because"; the short version is that a
-- policy without a grant yields "permission denied for table", not a
-- filtered result). Granted here, in the same file that creates the table,
-- per the pattern in 20260811170000_player_match_stats.sql and
-- 20260827090000_feature_history.sql. DELETE is deliberately withheld --
-- this job upserts and never deletes.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, service_role;

GRANT SELECT ON public.training_features TO anon;
GRANT SELECT, INSERT, UPDATE ON public.training_features TO service_role;

COMMIT;
