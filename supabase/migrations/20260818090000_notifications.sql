-- Notifications: the append-only log of every Telegram send attempt —
-- ticket #55 (feature-list item 14, "so that acknowledging the notification
-- and deciding are the same act").
--
-- One row per send ATTEMPT, success or failure — scripts/send-telegram.ts
-- writes exactly one row here per run that actually reaches a send decision
-- (a run that exits early because TELEGRAM_BOT_TOKEN/TELEGRAM_CHAT_ID are
-- unset writes NOTHING here — see that script's own file header; there is
-- nothing to log because no decision was made).
--
-- This table is what makes a re-run idempotent: before sending,
-- scripts/send-telegram.ts checks for an existing row with the same
-- (gameweek_id, message_text) and outcome='sent', and skips the send
-- entirely if one is found. See that script's own comments for the "because".
--
-- gameweek_id is the CURRENT gameweek the run targeted, independent of
-- which plan (if any) actually got sent. recommendation_gameweek_id/
-- plan_index identify the specific `recommendations` row the message was
-- built from — null together for a failure notice built from no stored
-- recommendation at all (infeasible / no-recommendation-yet). They are
-- always both null or both set (see the CHECK constraint below) and, when
-- set, always point at a real `recommendations` row (the composite FK).
--
-- send_kind records WHICH of the four message shapes was sent — 'current'
-- (the current gameweek's own fresh plan), 'stale' (an older plan, its age
-- stated explicitly — product-brief.md §6a/§6d: never presented as
-- current), 'infeasible' (the specific §6c message), or
-- 'no_recommendation' (the general failure notice, product-brief.md
-- §6a/§6c/§6d: a failure sends a notice, never silence).
--
-- Idempotent by construction, matching every migration since #9: CREATE
-- TABLE / CREATE INDEX are IF NOT EXISTS, the policy is dropped-then-
-- recreated, GRANTs are safe to re-run.
--
-- Real FKs into gameweeks/recommendations, same reasoning as every other
-- job-output table this season: every id referenced here is current-season
-- and always freshly ingested/written before this job runs, so a real FK
-- catches a mapping bug loudly instead of writing an orphan row.

BEGIN;

-- ============================================================================
-- Roles — see the #9 migration for why this guard exists: real Supabase (and
-- its local dev CLI) provisions `anon`/`service_role` automatically, but a
-- bare Postgres install used for migration testing does not.
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
-- notifications
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.notifications (
  id                            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  gameweek_id                   integer NOT NULL REFERENCES public.gameweeks (id),  -- the CURRENT gameweek this run targeted — independent of which plan, if any, was actually sent.
  recommendation_gameweek_id    integer,  -- which recommendations row's gameweek this message was built from (may differ from gameweek_id for a 'stale' send). Null for a failure notice built from no stored recommendation ('infeasible' / 'no_recommendation').
  plan_index                    smallint,  -- which recommendations plan (always 0, Plan A, for the message body — Plan B only ever appears as one line within it). Null exactly when recommendation_gameweek_id is null.

  send_kind                     text NOT NULL CHECK (send_kind IN ('current', 'stale', 'infeasible', 'no_recommendation')),
  outcome                       text NOT NULL CHECK (outcome IN ('sent', 'failed')),
  message_text                  text NOT NULL,  -- the exact text sent (or attempted) — stored verbatim, never reconstructed later.

  http_status                   integer,  -- Telegram's own HTTP status code from the final attempt, or null on a network-level failure (unreachable host).
  telegram_error                text,     -- Telegram's own error `description` (or the network error message) from the final attempt, or null on success.

  sent_at                       timestamptz NOT NULL DEFAULT now(),

  CHECK ((recommendation_gameweek_id IS NULL) = (plan_index IS NULL)),
  FOREIGN KEY (recommendation_gameweek_id, plan_index) REFERENCES public.recommendations (gameweek_id, plan_index)
);

COMMENT ON TABLE public.notifications IS
  'Append-only log of every Telegram send attempt (ticket #55, feature-list '
  'item 14) — one row per attempt, success or failure. What stops a re-run '
  'from double-sending: scripts/send-telegram.ts checks for an existing '
  '(gameweek_id, message_text) row with outcome=''sent'' before sending '
  'again. INSERT-only for service_role — no UPDATE, no DELETE grant exists '
  'on this table, so append-only is a database guarantee, not just a '
  'convention.';

COMMENT ON COLUMN public.notifications.send_kind IS
  'Which of the four message shapes was sent: ''current'' (this gameweek''s '
  'own fresh plan), ''stale'' (an older plan, its age stated explicitly — '
  'product-brief.md §6a/§6d: never presented as current), ''infeasible'' '
  '(the specific §6c squad-does-not-reconcile message), or '
  '''no_recommendation'' (the general failure notice — a failure sends a '
  'notice, never silence).';

COMMENT ON COLUMN public.notifications.message_text IS
  'The exact text sent to Telegram (or attempted, on a failed send), stored '
  'verbatim — this is the idempotency key''s other half alongside '
  'gameweek_id, and the audit trail of what Keshav actually saw.';

CREATE INDEX IF NOT EXISTS idx_notifications_gameweek_id ON public.notifications (gameweek_id);
CREATE INDEX IF NOT EXISTS idx_notifications_sent_at ON public.notifications (sent_at);

-- ============================================================================
-- Row Level Security — read-only for anon, same pattern as every job-output
-- table since #10/#33/#41/#47. Writes come from the scheduled Action using
-- the Supabase secret key (service_role), which bypasses RLS entirely.
-- ============================================================================

ALTER TABLE public.notifications ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "notifications_select_anon" ON public.notifications;
CREATE POLICY "notifications_select_anon" ON public.notifications FOR SELECT TO anon USING (true);

-- ============================================================================
-- GRANTs — RLS and GRANTs are two independent gates (see the #10/
-- table_grants migration for the full "because"). UPDATE and DELETE are
-- deliberately withheld from EVERY role, including service_role: this is a
-- log, and withholding the privilege makes append-only a database
-- guarantee rather than a habit scripts/send-telegram.ts happens to follow.
--
-- The explicit REVOKE below is not defensive boilerplate — it fixes a real
-- gap, found by applying this migration against a live Postgres instance
-- while building this ticket. The #10/table_grants migration's
-- `ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT SELECT, INSERT, UPDATE ON
-- TABLES TO service_role` applies to every table created AFTERWARDS by the
-- same executing role — which, in this project, is every migration, since
-- they all run as the same role. Verified directly: creating this table
-- with only `GRANT SELECT, INSERT ... TO service_role` still left
-- service_role able to UPDATE it, entirely from that earlier statement, with
-- nothing in this file's own GRANT list responsible. The REVOKE below is
-- what actually makes "no UPDATE, no DELETE" true, regardless of what a
-- schema-wide default privileges statement elsewhere grants new tables by
-- default. DELETE was never part of that default grant, so no corresponding
-- leak exists for it today, but it is revoked too — a guarantee that does
-- not depend on what that statement happens to list.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, service_role;

GRANT SELECT ON public.notifications TO anon;
GRANT SELECT, INSERT ON public.notifications TO service_role;
REVOKE UPDATE, DELETE ON public.notifications FROM service_role;

COMMIT;
