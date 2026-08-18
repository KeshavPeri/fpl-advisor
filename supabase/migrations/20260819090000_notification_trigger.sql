-- Adds a `trigger` column to `notifications` and the partial unique index
-- that makes double-sending impossible at the database level — ticket #59
-- (feature-list item 15, "the last piece of the value loop"). See
-- src/lib/notification/schedule.ts for the pure logic that DECIDES which
-- trigger, if any, fires on a given hourly run; this migration is what
-- makes a double-fire physically unrepresentable in the database,
-- independent of whatever that logic (or a racing second run of it)
-- concludes.
--
-- ============================================================================
-- WHY A PARTIAL UNIQUE INDEX, NOT A PLAIN ONE.
-- ============================================================================
-- The index below is scoped to `WHERE outcome = 'sent'` on purpose. A FAILED
-- send (Telegram unreachable, rate-limited, a transient network error) must
-- NOT permanently consume the (gameweek_id, trigger) slot —
-- scripts/notification-schedule.ts runs hourly, and the very next run must
-- still be able to retry a failed deadline_24h/deadline_10h send. A plain
-- unique index on (gameweek_id, trigger) with no WHERE clause would make
-- that retry permanently impossible: the first (failed) row would already
-- occupy the slot forever, and no gameweek could ever get a working send
-- again once one attempt happened to fail. Scoping the index to successful
-- sends only means the constraint enforces exactly what product-brief.md §2
-- needs — at most one SUCCESSFUL send per (gameweek, trigger) — while
-- leaving retries after a failure fully available.
--
-- Checking "has this been sent?" before sending (which
-- scripts/send-telegram.ts already does, keyed on message_text, since
-- ticket #55) is a read-then-write race: two overlapping runs can both pass
-- that check before either has inserted its row. This index is the ACTUAL
-- guarantee — a second INSERT that would violate it fails with a
-- unique-violation (Postgres SQLSTATE 23505), which
-- scripts/send-telegram.ts's runSend() catches via isUniqueViolation() and
-- reports as "already sent," not as a crash (this ticket's own DoD: "two
-- workflow runs overlapping is a normal race, not a failure").
--
-- Idempotent by construction, matching every migration since #9: ADD COLUMN
-- and CREATE INDEX are IF NOT EXISTS; the CHECK constraint is
-- dropped-then-recreated (Postgres has no "ADD CONSTRAINT IF NOT EXISTS" for
-- CHECK constraints, unlike columns and indexes — the DROP/ADD pair mirrors
-- the DROP POLICY/CREATE POLICY idiom every RLS policy in this repo already
-- uses for the same reason); the role guard matches every prior migration.

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
-- notifications.trigger
-- ============================================================================

ALTER TABLE public.notifications ADD COLUMN IF NOT EXISTS trigger text NOT NULL DEFAULT 'manual';
-- Existing rows: every notification sent before this migration WAS a manual
-- (workflow_dispatch) send — item 15's scheduled 24h/10h trigger did not
-- exist yet — so the DEFAULT above is not a placeholder value, it is the
-- correct historical fact, applied to every pre-existing row automatically
-- by Postgres (a constant-default ADD COLUMN backfills existing rows
-- without a table rewrite).

ALTER TABLE public.notifications DROP CONSTRAINT IF EXISTS notifications_trigger_check;
ALTER TABLE public.notifications ADD CONSTRAINT notifications_trigger_check
  CHECK (trigger IN ('manual', 'deadline_24h', 'deadline_10h'));

COMMENT ON COLUMN public.notifications.trigger IS
  'Which trigger caused this send attempt: ''manual'' (workflow_dispatch, '
  'the on-demand path from ticket #55) or ''deadline_24h'' / ''deadline_10h'' '
  '(the scheduled window triggers from ticket #59 — '
  'src/lib/notification/schedule.ts decides which, if any, fires on a given '
  'hourly run). Defaults to ''manual'' for every row written before this '
  'column existed, which is what they all were.';

-- ============================================================================
-- The double-send guarantee — see this file's header for the full
-- reasoning. Partial on outcome = 'sent' so a FAILED send never permanently
-- consumes the slot: the next hourly run must still be able to retry it.
-- ============================================================================

CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_gameweek_trigger_sent_once
  ON public.notifications (gameweek_id, trigger)
  WHERE outcome = 'sent';

-- ============================================================================
-- GRANTs — deliberately untouched. notifications keeps SELECT for anon and
-- SELECT, INSERT for service_role (from the #55 migration); no UPDATE, no
-- DELETE for any role — it is a log (deltas.md D8). Adding a column and a
-- partial index does not require re-granting anything: both are covered by
-- the existing table-wide grants, and this migration grants nothing new.
-- ============================================================================

COMMIT;
