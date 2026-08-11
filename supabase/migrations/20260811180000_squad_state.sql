-- Squad state: the app's own record of Keshav's 15-man squad, per gameweek.
--
-- Ticket #13. Two tables:
--   squads       — one row per gameweek: bank, squad value, free transfers, and
--                   `source` (how this row came to exist: manual entry, a later
--                   API sync, or a registered override).
--   squad_picks  — fifteen rows per gameweek: one per squad slot, carrying the
--                   player, starting/bench status, bench order, and captaincy.
--
-- Idempotent by construction, matching the #9/#10/#12 migrations' style: every
-- CREATE TABLE / CREATE INDEX is IF NOT EXISTS, and RLS policies are
-- dropped-then-recreated. Running this file twice against the same database
-- is safe and creates nothing new the second time. Uniqueness rules that a
-- plain CREATE TABLE can't express as inline CHECKs are (partial) unique
-- indexes instead of ALTER TABLE ... ADD CONSTRAINT, specifically because
-- Postgres has no "ADD CONSTRAINT IF NOT EXISTS" — indexes do support
-- IF NOT EXISTS, so that's what stays idempotent on a second apply.
--
-- gameweek_id is squads' primary key, not a surrogate id: this app is
-- single-user (product-brief.md §3), so "the squad for gameweek N" is
-- naturally one row, and whichever process writes it last — this manual
-- entry screen today, the API sync in #14, or a registered override in wave
-- 4 — overwrites it, with `source` recording which. This is a Tier 2
-- decision; see the Builder's ticket #13 report / decisions/ticket-13.md.
--
-- bank and squad_value are integers in tenths of a million, same convention
-- as players.now_cost (#9): 5 means £0.5m. Never a float, per that
-- migration's own note; formatting to "£X.Xm" is a display concern.
--
-- Position codes (1 GK, 2 DEF, 3 MID, 4 FWD) are NOT re-derived from an
-- `element_types` table here, because no such table exists in the reference
-- schema — #9 scoped in only teams/players/fixtures/gameweeks, and
-- `element_types` was never created. This migration doesn't need the codes
-- itself (squad_picks.player_id's position is whatever players.element_type
-- says); the client-side formation check is documented in src/lib/squad/positions.ts.
--
-- No FK from squad_picks.player_code to anywhere — players.code has no
-- unique constraint in the #9 schema to reference, and the whole point of
-- storing it (per the ticket) is to survive players.id being re-keyed across
-- a season boundary, so tying it to today's players row would defeat that.
-- It is a denormalized, honestly-unenforced snapshot value.

BEGIN;

-- ============================================================================
-- Roles — see the #9 migration for why this guard exists: real Supabase (and
-- its local dev CLI) provisions `anon` automatically, but a bare Postgres
-- install used for migration testing does not.
-- ============================================================================

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'anon') THEN
    CREATE ROLE anon NOLOGIN;
  END IF;
END
$$;

-- ============================================================================
-- squads
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.squads (
  gameweek_id      integer PRIMARY KEY REFERENCES public.gameweeks (id),
  bank             integer NOT NULL CHECK (bank >= 0),
  squad_value      integer NOT NULL CHECK (squad_value >= 0),
  free_transfers   integer NOT NULL DEFAULT 1 CHECK (free_transfers >= 0),
  source           text NOT NULL CHECK (source IN ('manual', 'api_sync', 'override')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE public.squads IS
  'One row per gameweek: Keshav''s bank, squad value and free transfers for '
  'that gameweek, plus which mechanism last wrote it (manual entry, API '
  'sync, or a registered override). gameweek_id is the primary key because '
  'this is a single-user app (product-brief.md §3) with exactly one squad '
  'per gameweek.';

COMMENT ON COLUMN public.squads.bank IS
  'Tenths of a million, same convention as players.now_cost. 5 = £0.5m.';

COMMENT ON COLUMN public.squads.squad_value IS
  'Tenths of a million, same convention as players.now_cost.';

-- ============================================================================
-- squad_picks
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.squad_picks (
  gameweek_id      integer NOT NULL REFERENCES public.squads (gameweek_id) ON DELETE CASCADE,
  squad_position   smallint NOT NULL CHECK (squad_position BETWEEN 1 AND 15),
  player_id        integer NOT NULL REFERENCES public.players (id),
  player_code      integer NOT NULL,
  is_starting      boolean NOT NULL,
  bench_order      smallint CHECK (
                     (is_starting AND bench_order IS NULL)
                     OR (NOT is_starting AND bench_order BETWEEN 1 AND 4)
                   ),
  is_captain       boolean NOT NULL DEFAULT false,
  is_vice_captain  boolean NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (gameweek_id, squad_position)
);

COMMENT ON TABLE public.squad_picks IS
  'Fifteen rows per gameweek, one per squad slot (squad_position 1-15). '
  'player_id is an FK into the currently-ingested players table; player_code '
  'is a denormalized copy of players.code, the FPL id that survives a '
  'season boundary (see file header) — id does not.';

COMMENT ON COLUMN public.squad_picks.bench_order IS
  'NULL for starters. 1-4 for bench players (one of the four is the reserve '
  'goalkeeper), lowest number substituted first.';

-- Database-enforced squad-integrity rules (DoD): no two picks share a squad
-- position in one gameweek (the table's own primary key), the same player
-- cannot appear twice in one gameweek, at most one captain per gameweek, at
-- most one vice-captain per gameweek.
CREATE UNIQUE INDEX IF NOT EXISTS idx_squad_picks_unique_player
  ON public.squad_picks (gameweek_id, player_id);

CREATE UNIQUE INDEX IF NOT EXISTS idx_squad_picks_one_captain
  ON public.squad_picks (gameweek_id) WHERE is_captain;

CREATE UNIQUE INDEX IF NOT EXISTS idx_squad_picks_one_vice_captain
  ON public.squad_picks (gameweek_id) WHERE is_vice_captain;

CREATE INDEX IF NOT EXISTS idx_squad_picks_player_id ON public.squad_picks (player_id);

-- Exactly-15-picks, exactly-11-starters and formation legality are NOT
-- database constraints. Each spans all fifteen rows of a gameweek at once,
-- which needs a deferred constraint trigger — a substantial amount of
-- PL/pgSQL to write, test and maintain for a single-user app whose only
-- realistic writer is the entry screen in src/. The database enforces
-- everything a plain (partial) unique index can express, above; the UI
-- enforces the rest (src/lib/squad/validate.ts). This is a Tier 2 decision,
-- pre-answered in the ticket; see decisions/ticket-13.md.

-- ============================================================================
-- Row Level Security — the browser's publishable key both reads and writes
-- these two tables, unlike every read-only reference table from #9. This app
-- has no authentication and no server (product-brief.md §3 puts accounts and
-- auth permanently out of scope), so the anon role is the only writer
-- available, and the data at stake — Keshav's own FPL squad — is already
-- public via the unauthenticated entry/{id}/ endpoint. This is a Tier 2
-- decision; see decisions/ticket-13.md. Applied to these two tables only —
-- every reference table from #9 stays read-only.
-- ============================================================================

ALTER TABLE public.squads ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "squads_all_anon" ON public.squads;
CREATE POLICY "squads_all_anon" ON public.squads FOR ALL TO anon USING (true) WITH CHECK (true);

ALTER TABLE public.squad_picks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "squad_picks_all_anon" ON public.squad_picks;
CREATE POLICY "squad_picks_all_anon" ON public.squad_picks FOR ALL TO anon USING (true) WITH CHECK (true);

-- ============================================================================
-- GRANTs — RLS and GRANTs are two independent gates (see the #10/
-- table_grants migration for the full "because"; the short version is that a
-- policy without a grant yields "permission denied for table", not a
-- filtered result). Granted here, in the same file that creates the tables,
-- per that migration's pattern.
--
-- DELETE is granted here, unlike every reference table, because replacing a
-- 15-player squad is this screen's normal save path: it deletes the
-- gameweek's fifteen old picks and inserts fifteen new ones rather than
-- trying to diff and patch fifteen rows in place.
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon;

GRANT SELECT, INSERT, UPDATE, DELETE ON public.squads TO anon;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.squad_picks TO anon;

COMMIT;
