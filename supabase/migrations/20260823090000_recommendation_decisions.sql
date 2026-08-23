-- Recommendation decisions: the append-only ledger of what Keshav actually
-- did with a recommendation — ticket #84 (feature-list item 19, "so that
-- acknowledging the notification and deciding are the same act").
--
-- The app tells Keshav what to do (item 13/17) and, until this table
-- existed, had no way for him to say he'd done it. One row per decision:
-- `kind = 'commit'` when he accepted the recommendation as given. The
-- `'override'` value is accepted by the CHECK constraint now so item 20
-- (registering that he did something OTHER than what was recommended, with
-- deliberate friction — design-reference.md) needs no second migration and
-- no second manual-apply step later; nothing in this ticket writes it.
--
-- Committing records a decision. It does NOT make a transfer — the FPL API
-- is never authenticated anywhere in this app and no private, write-capable
-- FPL endpoint is ever called (product-brief.md §6a). Keshav makes the real
-- transfer in the FPL app himself; this table is only the ledger of what he
-- accepted.
--
-- A SEPARATE table, not a column on `recommendations` — deliberately.
-- `recommendations` is upserted every solver run, and
-- 20260820100000_recommendations_delete_grant.sql (ticket #60) grants
-- service_role DELETE on it so a re-run can remove orphaned Plan B/C rows.
-- A commit recorded on that table could therefore be destroyed by the very
-- next nightly run. A decision is a historical fact about what Keshav did;
-- it must outlive the recommendation it refers to — which is also why this
-- table carries a `snapshot` of what was committed rather than only a
-- foreign key into `recommendations`: the row that produced the snapshot
-- may later be replaced or deleted, and the ledger must still say what was
-- actually accepted. For the same reason there is deliberately no foreign
-- key from this table into `recommendations` — only into `gameweeks`, which
-- is never deleted.
--
-- Append-only as a DATABASE guarantee, same shape as
-- 20260818090000_notifications.sql and for the same reason: RLS enabled,
-- one SELECT policy for anon, and GRANT SELECT, INSERT only — no UPDATE, no
-- DELETE to any role, including service_role. No undo, no edit, no delete
-- (ticket #84 scope) is therefore not just a UI rule, it is unenforceable
-- to violate even by mistake.
--
-- The unique index on (gameweek_id, plan_index, kind) is what makes "one
-- gameweek cannot be committed twice" true at the database level. The
-- write path (src/lib/commit/api.ts) does not depend on this firing in the
-- ordinary case — the UI disables the control the moment a commit exists —
-- but treats the resulting unique_violation (23505) as success, not
-- failure, for the rare race (two tabs, a duplicate tap that got in before
-- a re-render) where it does.
--
-- Idempotent by construction, matching every migration since #9: CREATE
-- TABLE / CREATE INDEX are IF NOT EXISTS, the policy is dropped-then-
-- recreated, GRANTs are safe to re-run. Running this file twice against the
-- same database is safe and creates nothing new the second time.

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
-- recommendation_decisions
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.recommendation_decisions (
  id            bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,

  gameweek_id   integer NOT NULL REFERENCES public.gameweeks (id),  -- the gameweek this decision is about. No FK into `recommendations` — see file header, "deliberately no foreign key".
  plan_index    smallint NOT NULL CHECK (plan_index IN (0, 1, 2)),  -- which plan (0/1/2 = Plan A/B/C, same domain as recommendations.plan_index). Ticket #84 writes 0 (Plan A) only; the CHECK matches recommendations' own so a later ticket committing Plan B/C needs no migration change.

  kind          text NOT NULL CHECK (kind IN ('commit', 'override')),  -- 'commit' = accepted the recommendation as given (ticket #84). 'override' = did something else (item 20) — accepted by the CHECK now, written by nothing yet.
  decided_at    timestamptz NOT NULL DEFAULT now(),

  snapshot      jsonb NOT NULL  -- what was actually committed, frozen at decision time: is_roll, transfer_in_player_id, transfer_out_player_id, captain_player_id, vice_captain_player_id, hit_cost, solver_run_id. Independent of whatever `recommendations` holds later — see file header.
);

COMMENT ON TABLE public.recommendation_decisions IS
  'Append-only ledger of every recommendation decision (ticket #84, '
  'feature-list item 19) — one row per decision, ''commit'' (accepted as '
  'given) or ''override'' (item 20, not yet written). INSERT-only for anon '
  'and service_role — no UPDATE, no DELETE grant exists on this table, so '
  'append-only is a database guarantee, not just a convention. A unique '
  'index on (gameweek_id, plan_index, kind) stops the same plan being '
  'decided twice under the same kind.';

COMMENT ON COLUMN public.recommendation_decisions.snapshot IS
  'What was actually committed, frozen at decision time — is_roll, '
  'transfer_in_player_id, transfer_out_player_id, captain_player_id, '
  'vice_captain_player_id, hit_cost, solver_run_id. Stored here rather than '
  'left to a join into `recommendations` because that table is upserted '
  'every solver run and has a DELETE grant (ticket #60) for orphan '
  'cleanup — the recommendation this decision was about can be replaced or '
  'removed after the fact, and the ledger must still say what was actually '
  'accepted.';

CREATE INDEX IF NOT EXISTS idx_recommendation_decisions_gameweek_id
  ON public.recommendation_decisions (gameweek_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_recommendation_decisions_unique_decision
  ON public.recommendation_decisions (gameweek_id, plan_index, kind);

-- ============================================================================
-- Row Level Security — read-only for anon via policy; the write path is a
-- separate grant below (this app is single-user with no auth, ticket #13's
-- squad_state migration is the precedent for anon INSERT — see that
-- migration and this ticket's own notes for why that is not a Tier 1
-- escalation).
-- ============================================================================

ALTER TABLE public.recommendation_decisions ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "recommendation_decisions_select_anon" ON public.recommendation_decisions;
CREATE POLICY "recommendation_decisions_select_anon" ON public.recommendation_decisions FOR SELECT TO anon USING (true);

DROP POLICY IF EXISTS "recommendation_decisions_insert_anon" ON public.recommendation_decisions;
CREATE POLICY "recommendation_decisions_insert_anon" ON public.recommendation_decisions FOR INSERT TO anon WITH CHECK (true);

-- ============================================================================
-- GRANTs — RLS and GRANTs are two independent gates (see the #10/
-- table_grants migration for the full "because"; the short version is that a
-- policy without a grant yields "permission denied for table X", and a
-- grant without a policy yields "new row violates row-level security
-- policy" — deltas.md D8). UPDATE and DELETE are deliberately withheld from
-- EVERY role, including service_role, same reasoning and same explicit
-- REVOKE-after-GRANT pattern as 20260818090000_notifications.sql: a
-- schema-wide default-privileges statement from an earlier migration can
-- silently hand a new table UPDATE it never asked for, and only an
-- explicit REVOKE actually closes that.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, service_role;

GRANT SELECT, INSERT ON public.recommendation_decisions TO anon;
GRANT SELECT, INSERT ON public.recommendation_decisions TO service_role;

-- Split across lines deliberately, matching 20260811160000_table_grants.sql's
-- own multi-line GRANT style: a REVOKE naming both privileges on one line
-- would otherwise read, contiguously, as a grant of the very privilege it is
-- removing. This still revokes both, from both roles, in one statement.
REVOKE UPDATE, DELETE
  ON public.recommendation_decisions
  FROM anon, service_role;

COMMIT;
