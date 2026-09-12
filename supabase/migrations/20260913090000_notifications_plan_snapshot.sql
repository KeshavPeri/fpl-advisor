-- public.notifications.plan_snapshot: freeze the structured recommendation at
-- send time -- ticket #231.
--
-- THE DEFECT THIS FIXES. scripts/generate-recommendations.ts upserts
-- `recommendations` keyed on (gameweek_id, plan_index) -- every later solve for
-- the same gameweek overwrites the row in place
-- (20260817090000_recommendations.sql: "a re-run for the same gameweek
-- replaces that gameweek's plans"). scripts/send-telegram.ts reads
-- `recommendations` at plan_index 0 and sends it; scripts/
-- recommendation-scorecard.ts also reads `recommendations`, but later -- by
-- which time the row can hold a different plan from the one Keshav actually
-- received. There has never been a permanent record of the structured
-- recommendation that was actually issued, so the scorecard cannot honestly
-- score what Keshav acted on. This matters now, specifically: ticket #111
-- changes the fixture term in every projection, and the only way to tell
-- whether recommendations got better is to compare what was issued before
-- against what is issued after -- impossible while the record of "what was
-- issued" is itself overwritten.
--
-- THE FIX. `notifications` is already append-only (INSERT-only grant, no
-- UPDATE/DELETE -- see that table's own migration). This column snapshots the
-- structured plan into that permanent log, in the SAME insert that already
-- records the send (scripts/send-telegram.ts), built from the exact
-- `recommendations`/`recommendation_reasons` rows that insert already read to
-- compose `message_text` -- no second read, no re-read after sending. Written
-- on a failed send too: a recommendation that failed to reach Telegram is
-- still a recommendation the model produced, and those rows are the ones
-- worth reading later. Null exactly when no plan was actually referenced by
-- the message (an 'infeasible' or 'no_recommendation' send, matching the
-- existing recommendation_gameweek_id/plan_index NULL-together pair on this
-- same table) -- see scripts/send-telegram.ts's own comments for the exact
-- condition.
--
-- SHAPE (see scripts/send-telegram.ts's buildPlanSnapshot for the source of
-- truth): { gameweekId, planIndex, modelVersion, isRoll, transferIn:
-- {code, name} | null, transferOut: {code, name} | null, captainPlayerCode,
-- viceCaptainPlayerCode, startingXi: number[] (player codes), benchOrder:
-- number[] (player codes), hitCost, expectedPoints (net_points, full
-- precision), confidenceBand }. Player CODE throughout, never player_id --
-- deltas.md D9, code is the stable cross-season key, and this is a permanent
-- record that must still mean the same thing after a season boundary.
--
-- NULLABLE, NO DEFAULT, NO BACKFILL -- DELIBERATE AND TIER-1-BOUNDED. Every
-- row written before this migration predates the concept of a snapshot and
-- must not be back-filled with a guess (a reconstruction from today's
-- `recommendations` would silently claim to be what was actually sent, which
-- is exactly the dishonesty this ticket exists to remove). Nullable is what
-- lets scripts/recommendation-scorecard.ts fall back to `recommendations`
-- cleanly for every row before this ticket, and say so.
--
-- NO GRANT CHANGE NEEDED. This is ADD COLUMN on a table that already exists
-- (20260818090000_notifications.sql) with its GRANTs already in place --
-- SELECT for anon, SELECT+INSERT (only) for service_role, table-level so it
-- covers this new column automatically. Same precedent as
-- 20260901090000_teams_elo_stale_since.sql and 20260902090000_
-- feature_history_recent_minutes.sql for their own new nullable columns.
--
-- NO ROLE GUARD, for the same reason those two migrations carry none: this
-- file issues no GRANT and no CREATE POLICY referencing anon or
-- service_role, so nothing here requires either role to already exist in a
-- bare Postgres install used for migration testing.
--
-- Idempotent by construction: ADD COLUMN IF NOT EXISTS. Running this file
-- twice against the same database is safe and creates nothing new the
-- second time.

BEGIN;

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS plan_snapshot jsonb;

COMMENT ON COLUMN public.notifications.plan_snapshot IS
  'The structured recommendation frozen at send time (ticket #231), written '
  'in the SAME insert that records the send -- built from the exact '
  '`recommendations`/`recommendation_reasons` rows already read to compose '
  '`message_text`, never a second or later read. Written on a failed send '
  'too (a failed delivery is still a recommendation the model produced). '
  'NULL exactly when no plan was referenced by the message (an '
  '''infeasible'' or ''no_recommendation'' send -- matches this table''s own '
  'recommendation_gameweek_id/plan_index NULL-together pair) or for any row '
  'written before this migration -- nullable, never back-filled '
  '(escalation.md Tier 1: no destructive or guessed rewrite of live data). '
  'Carries player CODE throughout, never player_id (deltas.md D9). See '
  'scripts/send-telegram.ts''s buildPlanSnapshot for the exact shape and '
  'scripts/recommendation-scorecard.ts for the fallback-to-`recommendations` '
  'read this column exists to replace.';

COMMIT;
