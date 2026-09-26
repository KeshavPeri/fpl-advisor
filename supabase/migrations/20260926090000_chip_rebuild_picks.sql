-- chip_rebuild_picks: the actual fifteen players a Wildcard/Free Hit
-- squad-rebuild solve picked -- ticket #284 (feature-list item 28, the
-- second half). #134's chip_advisories row already stores ONE number (the
-- points delta of rebuilding right now, chip_code 'WC'/'FH'); this table
-- stores what's actually behind that number, so the Chips screen can show
-- the starting XI, bench, captain and an In/Out comparison against the
-- saved squad under a "See the squad" disclosure, rather than a figure with
-- nothing behind it (see this ticket's own WHY).
--
-- ONE ROW PER (chip_advisory_id, player_id) -- fifteen rows per advisory,
-- written by scripts/store-squad-advisory.ts in the SAME run as its own
-- chip_advisories insert, right after it, from the rebuild solve's own
-- results CSV -- solution_index 0, the FIRST rebuild gameweek only (never
-- the rest of the five-gameweek horizon a preseason rebuild also touches;
-- see that script's own comment on why the advisory's gameweek_id IS the
-- target gameweek for a rebuild, not a chip's own later horizon gameweek).
-- PRIMARY KEY (chip_advisory_id, player_id), not a bare identity column,
-- deliberately: chip_advisories is append-only (a later squad-rebuild-probe
-- dispatch gets its own NEW chip_advisories row, never overwrites an
-- existing one), so this table's own natural key already prevents two rows
-- for the same player under the same advisory without a second uniqueness
-- mechanism.
--
-- chip_advisory_id HAS A REAL FK to public.chip_advisories(id) -- the exact
-- advisory row these fifteen picks explain. There is deliberately no FK
-- from player_id to public.players(id): squad-rebuild-probe.yml is
-- dispatch-only (now also nightly, per this ticket) and its picks must
-- remain readable even if the live players table has moved on since —
-- matching player_match_stats' own "FPL element ids are not stable" caution.
-- player_code (nullable, no FK -- same convention player_projections.
-- player_code and solver_picks.player_code already use) is the season-
-- stable identifier a caller should prefer once player_id might not
-- resolve.
--
-- position IS STORED VERBATIM from the results CSV's own "pos" column
-- (e.g. "GKP", "DEF", "MID", "FWD") -- never normalized to an enum or to
-- players.element_type's numeric code, the same "third-party output is
-- ground truth" convention chip_advisories.chip_code and solver_runs.
-- solver_status already use in this codebase. The Chips screen groups by
-- position using the live players table's own element_type instead (see
-- src/lib/chips/derive.ts) -- this column is stored for completeness and
-- as a fallback, not read as the primary grouping key.
--
-- is_starting / bench_order follow public.squad_picks' own convention
-- exactly (bench_order NULL for a starting player, 1-4 for the bench, the
-- solver's own 0-3 slot shifted by one) -- see scripts/store-solver-output.
-- ts's mapResultsCsvRow, which scripts/store-squad-advisory.ts's own mapping
-- mirrors.
--
-- RLS read-only for anon, matching every advisory-adjacent table since
-- #126: SELECT, INSERT for service_role, no UPDATE, no DELETE -- a re-run
-- writes a fresh chip_advisories row and a fresh set of fifteen picks
-- rather than mutating an earlier advisory's own squad in place.
--
-- Idempotent by construction, matching every migration since #9: CREATE
-- TABLE / CREATE INDEX IF NOT EXISTS, policy dropped then recreated.
-- Running this file twice against the same database is safe and creates
-- nothing new the second time.

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
-- chip_rebuild_picks
-- ============================================================================

CREATE TABLE IF NOT EXISTS public.chip_rebuild_picks (
  chip_advisory_id  bigint NOT NULL REFERENCES public.chip_advisories (id),
  player_id         integer NOT NULL,   -- the live FPL element id at solve time -- no FK, see file header.
  player_code       integer,            -- the season-stable identifier -- nullable, no FK, same convention player_projections.player_code / solver_picks.player_code use.
  position          text NOT NULL,      -- verbatim from the results CSV's own "pos" column -- see file header.
  is_starting       boolean NOT NULL,
  bench_order       smallint CHECK (bench_order IS NULL OR bench_order BETWEEN 1 AND 4),  -- NULL for a starting player, 1-4 for the bench -- same convention as squad_picks.bench_order / solver_picks.bench_order.
  is_captain        boolean NOT NULL,
  is_vice_captain   boolean NOT NULL,
  expected_points   numeric NOT NULL,   -- this solve's own xP for this player, from the results CSV, for the target gameweek only.
  PRIMARY KEY (chip_advisory_id, player_id)
);

COMMENT ON TABLE public.chip_rebuild_picks IS
  'The fifteen players a Wildcard/Free Hit squad-rebuild solve picked -- '
  'ticket #284. One row per (chip_advisory_id, player_id); chip_advisory_id '
  'is a real FK to the chip_advisories row (ticket #134) this squad '
  'explains. Written once, in the same run as that chip_advisories row, '
  'from the rebuild solve''s own results CSV -- solution_index 0, the '
  'first rebuild gameweek only. Never read by recommendations/solver_picks/ '
  'the Telegram message -- surfaced only on the chips screen''s "See the '
  'squad" disclosure, never a "play this chip" instruction '
  '(product-brief.md §6a).';

COMMENT ON COLUMN public.chip_rebuild_picks.position IS
  'Verbatim from the results CSV''s own "pos" column, e.g. "GKP", "DEF", '
  '"MID", "FWD" -- not an enum, same "third-party output is ground truth" '
  'reasoning as chip_advisories.chip_code and solver_runs.solver_status.';

CREATE INDEX IF NOT EXISTS idx_chip_rebuild_picks_chip_advisory_id ON public.chip_rebuild_picks (chip_advisory_id);

-- ============================================================================
-- Row Level Security -- read-only for anon, matching chip_advisories (#126).
-- ============================================================================

ALTER TABLE public.chip_rebuild_picks ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS "chip_rebuild_picks_select_anon" ON public.chip_rebuild_picks;
CREATE POLICY "chip_rebuild_picks_select_anon" ON public.chip_rebuild_picks FOR SELECT TO anon USING (true);

-- ============================================================================
-- GRANTs -- RLS and GRANTs are two independent gates (see the #10/
-- table_grants migration). DELETE (and UPDATE) are deliberately withheld --
-- scripts/store-squad-advisory.ts only ever inserts (`.delete(` and
-- `.update(` do not appear in it).
-- ============================================================================

GRANT USAGE ON SCHEMA public TO anon, service_role;

GRANT SELECT ON public.chip_rebuild_picks TO anon;
GRANT SELECT, INSERT ON public.chip_rebuild_picks TO service_role;

COMMIT;
