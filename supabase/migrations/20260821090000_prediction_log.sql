-- prediction_log: the accuracy tracker's raw material — ticket #73.
--
-- product-brief.md §2: "every projection stored, scored against actuals after gameweek
-- lockdown, and shown as a rolling figure in-app." This migration builds the storage half of
-- that sentence. The rolling in-app figure itself is explicitly out of scope for this ticket —
-- see the ticket's "explicitly out of scope" list.
--
-- One row per (gameweek, player, model_version), same primary-key shape as player_projections
-- (#33) but NOT overwritten by every run the way that table is: a row here is written ONCE
-- pre-deadline by scripts/snapshot-predictions.ts (captured_at, projected_points,
-- projected_minutes, components), then WRITTEN AT MOST ONCE MORE, post-lockdown, by
-- scripts/settle-predictions.ts (actual_points, actual_minutes, settled_at, error). See that
-- script's header for the freeze rule that makes each half a one-time write.
--
-- ============================================================================
-- Why actual_points/actual_minutes/settled_at/error are all nullable.
-- ============================================================================
-- A row with settled_at IS NULL has not been measured yet — the gameweek has not reached
-- lockdown, or a specific player's actual points were not available in the FPL live/ response
-- when settlement ran (see settle-predictions.ts: a missing actual is left unsettled, never
-- defaulted to zero — "a player who didn't feature has a real zero; a player whose data hasn't
-- arrived has no measurement yet.") A row with settled_at IS NOT NULL and actual_points = 0 is a
-- real, measured zero. Collapsing these two states into one (e.g. actual_points defaulting to 0)
-- would make a prediction log that lies about what it has actually measured — the ticket's own
-- Notes call this out as the single most important line in the migration.
--
-- ============================================================================
-- Idempotent, same guard pattern as every prior migration (#9/#10/#33/...).
-- ============================================================================
-- CREATE TABLE / CREATE INDEX are IF NOT EXISTS, the policy is dropped-then-recreated, and
-- GRANTs are safe to re-run. Running this file twice against the same database creates nothing
-- new the second time.

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
-- prediction_log
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.prediction_log (
  gameweek_id       integer NOT NULL REFERENCES public.gameweeks (id),
  player_id         integer NOT NULL REFERENCES public.players (id),
  model_version     text NOT NULL,
  player_code       integer,
  projected_points  numeric NOT NULL,
  projected_minutes numeric NOT NULL,
  components        jsonb NOT NULL,
  captured_at       timestamptz NOT NULL DEFAULT now(),
  actual_points     numeric,
  actual_minutes    numeric,
  settled_at        timestamptz,
  error             numeric,
  PRIMARY KEY (gameweek_id, player_id, model_version)
);

COMMENT ON TABLE public.prediction_log IS
  'Ticket #73 accuracy tracker storage. One row per (gameweek, player, model_version): '
  'projected_* + components + captured_at written pre-deadline by '
  'scripts/snapshot-predictions.ts, actual_* + settled_at + error written post-lockdown by '
  'scripts/settle-predictions.ts. See product-brief.md §2 and §6d.';

COMMENT ON COLUMN public.prediction_log.player_code IS
  'Denormalized copy of players.code at capture time, same pattern as '
  'player_projections.player_code and squad_picks.player_code — no FK, a convenience for a '
  'consumer that only has the code.';

COMMENT ON COLUMN public.prediction_log.components IS
  'Verbatim copy of the player_projections.components jsonb this row was snapshotted from — '
  'every model input and point component, so a future finding (e.g. docs/'
  'projection-model-backlog.md G7''s open defender question) can be traced to clean sheets vs. '
  'defcon vs. appearance rather than just to a single scalar miss.';

COMMENT ON COLUMN public.prediction_log.captured_at IS
  'When scripts/snapshot-predictions.ts wrote this row''s projected_* fields. Re-running the '
  'snapshot before the gameweek deadline overwrites this (and projected_points/'
  'projected_minutes/components) — latest-before-deadline wins. Never touched after the '
  'deadline passes.';

COMMENT ON COLUMN public.prediction_log.settled_at IS
  'NULL until scripts/settle-predictions.ts has measured this row against actuals. Set exactly '
  'once — an already-settled row (settled_at IS NOT NULL) is never re-settled. Settlement only '
  'ever runs for a gameweek that is both finished and past its 09:00 Europe/London lockdown the '
  'day after its final match (product-brief.md §6d) — never one hour after the final whistle, '
  'which would still be scoring against provisional bonus/defcon numbers.';

COMMENT ON COLUMN public.prediction_log.error IS
  'actual_points - projected_points. Positive means the model under-projected, negative means '
  'it over-projected. Signed, not absolute — mean signed error reveals systematic bias '
  '(docs/projection-model-backlog.md G7''s open defender question), which mean absolute error '
  'alone cannot show. NULL until settled_at is set.';

CREATE INDEX IF NOT EXISTS idx_prediction_log_gameweek_id ON public.prediction_log (gameweek_id);
CREATE INDEX IF NOT EXISTS idx_prediction_log_player_id ON public.prediction_log (player_id);
CREATE INDEX IF NOT EXISTS idx_prediction_log_settled_at ON public.prediction_log (settled_at);

-- ============================================================================
-- Row Level Security — read-only for anon, same pattern as every reference/job table
-- (#9/#10/#33). Writes come from the scheduled Actions using the Supabase secret key, which
-- bypasses RLS entirely. There is deliberately no insert/update/delete policy for anon.
-- ============================================================================

ALTER TABLE public.prediction_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "prediction_log_select_anon" ON public.prediction_log;
CREATE POLICY "prediction_log_select_anon" ON public.prediction_log FOR SELECT TO anon USING (true);

-- ============================================================================
-- GRANTs — RLS and GRANTs are two independent gates (see the #10/table_grants migration for the
-- full "because"). Granted here, in the same file that creates the table, per the pattern in
-- 20260815120000_player_projections.sql. DELETE is deliberately withheld: neither
-- snapshot-predictions.ts nor settle-predictions.ts issues any Supabase row-removal call — a
-- prediction log rewritable or erasable after the outcome is known is not a prediction log (see
-- this ticket's own Notes).
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, service_role;

GRANT SELECT ON public.prediction_log TO anon;
GRANT SELECT, INSERT, UPDATE ON public.prediction_log TO service_role;

COMMIT;
