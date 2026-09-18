// Bonus validation report — ticket #224. Read-only, changes nothing.
//
// ============================================================================
// Why this exists.
// ============================================================================
// docs/model-review-2026-09-02.md §1h and docs/projection-model-backlog.md's G3 name the bonus
// allocator (src/lib/projection/bonus.ts, ticket #78) as the one component in this model with no
// validating instrument anywhere. scripts/ingest-gameweek-live-stats.ts (this same ticket) is the
// data source; this file is the comparison. It reads public.gameweek_live_stats (real, awarded
// bonus and BPS) and public.player_projections (this model's own projected bonus, stored at
// components.points.bonusPoints — see scripts/project-points.ts's own row-construction code for
// that exact path) and reports how close the second is to the first, per gameweek and pooled.
//
// NOTHING IS TUNED, CHANGED, OR WRITTEN BACK by this file. src/lib/projection/bonus.ts,
// scripts/run-backtest.ts, scripts/calibration-report.ts and the solver are untouched — this is
// a read-only report, matching scripts/calibration-report.ts's own "changes nothing" convention.
//
// ============================================================================
// THE THREE-GAMEWEEK LIMITATION — read this before reading any number below.
// ============================================================================
// public.gameweek_live_stats can only ever hold CURRENT-SEASON, finished, past-lockdown
// gameweeks — event/{gw}/live/ has no equivalent for a past season, and never will (see that
// table's own migration header). At the time this ticket was written, three 2026/27 gameweeks
// had finished. This report measures however many gameweeks scripts/ingest-gameweek-live-stats.ts
// has actually written by the time it runs — printed explicitly below, never assumed — and it
// can only grow by exactly one gameweek per week the season progresses. There is no way to add
// history faster, and no way to look further back than 2026/27's own results at all. A handful of
// gameweeks is not enough to trust a mean confidently; this instrument's value is that it
// accumulates, not that any single run of it is conclusive.
//
// ============================================================================
// What is compared, and what is not.
// ============================================================================
// Compared: components.points.bonusPoints (this model's allocated bonus share, ticket #78) against
// gameweek_live_stats.bonus (the real, awarded 3/2/1), per (gameweek, player_code), at
// MODEL_VERSION. Both "overall" (every matched player-gameweek) and restricted to each gameweek's
// own top TOP_N_PROJECTED players by expected_points — "because that is the population the
// allocator actually moves" (this ticket's own scope text) and the population G3/G7's own worked
// example (docs/projection-model-backlog.md) already showed the missing bonus term deciding.
//
// NOT compared here: BPS. gameweek_live_stats.bps is ingested and stored (this ticket's own DoD),
// but no persisted "projected BPS" figure exists anywhere in this repo — expectedBps
// (src/lib/projection/bonus.ts) is an intermediate value scripts/project-points.ts computes and
// discards, never written to player_projections. Comparing against real bps is therefore future
// work, not this ticket's — noted in docs/projection-model-backlog.md's G3 entry, not built here.
//
// Sign convention for signed error, matching prediction_log.error and scripts/settle-predictions.ts's
// own computeError: actual - projected. Positive means the model UNDER-projects bonus; negative
// means it OVER-projects.
//
// ============================================================================
// Pooling across gameweeks — from matched ROWS, never from a mean of means.
// ============================================================================
// A season-level figure is computed by concatenating every gameweek's own matched rows and taking
// ONE mean over the pooled set (poolGameweekReports, below) — never by averaging each gameweek's
// already-computed mean. The latter would silently misweight a gameweek with (say) 200 matched
// rows the same as one with 20, which is exactly the kind of quiet arithmetic error this repo's
// other report scripts (scripts/settle-predictions.ts's computeAggregateErrorStats) already avoid
// the same way.
//
// ============================================================================
// Ranking skill, not exact placing.
// ============================================================================
// The allocator "distributes six points continuously, in proportion to modelled BPS share, clamped
// at 3.0 per player. It was never meant to predict who finishes 1st, 2nd and 3rd." (this ticket's
// own Notes). This report therefore judges the DISTRIBUTION (means and signed error across many
// player-gameweeks), never a per-fixture 1st/2nd/3rd placing — no ranking-correlation figure is
// computed here, unlike scripts/run-backtest.ts's ranking-skill slice (G11), because that is not
// what the allocator claims to do.
//
// Reads exactly SUPABASE_URL and SUPABASE_SECRET_KEY, same convention as every other scripts/*.ts
// job. Every multi-row Supabase read goes through scripts/lib/paginate.ts's fetchAllPages +
// assertRowCountMatches. This file writes nothing but its own job_runs row.
//
// ============================================================================
// TICKET #253 — the actual-bonus SOURCE is now chosen, not hardcoded to gameweek_live_stats.
// ============================================================================
// public.player_gameweek_history (ticket #248) carries real per-gameweek bonus/bps for FULL PAST
// SEASONS, sourced from FPL-Core-Insights' playerstats.csv — a different, complementary gap from
// gameweek_live_stats' CURRENT-season-only event/{gw}/live/ source (see this file's "three-gameweek
// limitation" section above, unchanged). This job now PREFERS player_gameweek_history for the
// target season (CURRENT_SEASON below) whenever it has at least one row there, falling back to the
// existing gameweek_live_stats path only when it does not (e.g. before Keshav's post-merge ingest —
// see decisions/ticket-248.md) — resolveActualBonusSource is the pure selection rule, and the
// report/job_runs.details both NAME which source actually supplied a given run's figures, never
// silently. player_gameweek_history's bonus/bps are SEASON-CUMULATIVE-TO-DATE snapshots (verified by
// #248 — tracing one player's rows across consecutive gameweeks found them monotonic), NOT a single
// gameweek's own award — differenceCumulativeGameweekRows recovers the single-gameweek figure by
// differencing consecutive rows for the same player_code, treating a player's first row (no prior
// row to subtract) and any row immediately after a gap (the previous row on file is not exactly
// gameweek − 1) as a fresh baseline rather than guessing across the missing gameweek(s) — see that
// function's own doc comment.
//
// This does NOT give this file a full past-season PROJECTED side: `player_projections` holds
// 2026/27 only (never a past season), so this job's projected-vs-actual comparison still only ever
// runs for CURRENT_SEASON, exactly as before — player_gameweek_history only widens which ACTUAL
// source that current season's comparison reads from. A full point-in-time reconstruction of the
// PROJECTED side for a genuinely past season (2025-2026) is a different, deliberately OFFLINE
// concern — see scripts/fit-bonus-alpha.ts, which reads FPL-Core-Insights' CSVs directly and never
// touches Supabase — never attempted here, which stays Supabase-only like every other scripts/*.ts
// job.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { MAX_BONUS_POINTS_PER_PLAYER_FIXTURE } from '../src/lib/projection/bonus.ts'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'

const JOB_NAME = 'bonus-validation-report'
/** Must match scripts/project-points.ts's own MODEL_VERSION — duplicated, not imported; see scripts/snapshot-predictions.ts's precedent for why every scripts/*.ts job is a standalone entry point. */
const MODEL_VERSION = 'baseline-v1'
const GAMEWEEK_LIVE_STATS_MIGRATION = 'supabase/migrations/20260911090000_gameweek_live_stats.sql'
const PLAYER_PROJECTIONS_MIGRATION = 'supabase/migrations/20260815120000_player_projections.sql'
const PLAYER_GAMEWEEK_HISTORY_MIGRATION = 'supabase/migrations/20260917100000_player_gameweek_history.sql'
/** Ticket #253. Matches scripts/project-points.ts's own CURRENT_SEASON — duplicated, not imported, same job-specific-constant convention CLAUDE.md documents (e.g. BACKTEST_SEASON vs FEATURE_HISTORY_SEASON). The only season this job's projected side (`player_projections`) can ever cover. */
const CURRENT_SEASON = '2026-2027'

/** How many of each gameweek's top projected players (by expected_points) get their own restricted figures — "the population the allocator actually moves" (this ticket's own scope text). */
export const TOP_N_PROJECTED = 20

// ============================================================================
// Env — identical contract to every other scripts/*.ts job.
// ============================================================================

interface SupabaseEnv {
  url: string
  secretKey: string
}

function readSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  const missing: string[] = []
  if (!url) missing.push('SUPABASE_URL')
  if (!secretKey) missing.push('SUPABASE_SECRET_KEY')

  if (missing.length > 0) {
    console.error(
      `${JOB_NAME}: required environment variables are not set. ` +
        'Both SUPABASE_URL and SUPABASE_SECRET_KEY must be set ' +
        `(missing: ${missing.join(', ')}). Making no network call.`,
    )
    return null
  }

  return { url: url as string, secretKey: secretKey as string }
}

// ============================================================================
// Errors
// ============================================================================

export class BonusValidationError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'BonusValidationError'
    this.context = context
  }
}

interface PostgrestLikeError {
  code?: string
  message?: string
}

function isMissingTable(error: PostgrestLikeError, tableName: string): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const message = error.message ?? ''
  return new RegExp(tableName).test(message) && /schema cache|does not exist|relation.*does not exist/i.test(message)
}

// ============================================================================
// job_runs
// ============================================================================

type JsonRecord = Record<string, unknown>

interface JobRunInput {
  status: 'success' | 'failure' | 'skipped'
  message: string
  details: JsonRecord
  startedAt: Date
}

async function recordJobRun(supabase: SupabaseClient, input: JobRunInput): Promise<void> {
  const finishedAt = new Date()
  const { error } = await supabase.from('job_runs').insert({
    job_name: JOB_NAME,
    status: input.status,
    message: input.message,
    details: input.details,
    started_at: input.startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
  })
  if (error) {
    if (isMissingTable(error, 'job_runs')) {
      console.error(`${JOB_NAME}: table "job_runs" does not exist. Apply its migration before running this script.`)
    }
    throw new Error(`failed to record job_runs row: ${error.message}`)
  }
}

// ============================================================================
// Extracting the projected bonus figure — PURE. components is untyped jsonb read back from
// Supabase; every step is defensive so a missing/reshaped field degrades to "cannot compare this
// row" (null), never to a guessed 0 masquerading as a measured figure.
// ============================================================================

/** Reads components.points.bonusPoints — see scripts/project-points.ts's row-construction code for exactly this shape. Returns null (never 0) when it cannot be read. */
export function extractProjectedBonus(components: unknown): number | null {
  if (typeof components !== 'object' || components === null || Array.isArray(components)) return null
  const points = (components as Record<string, unknown>).points
  if (typeof points !== 'object' || points === null || Array.isArray(points)) return null
  const bonusPoints = (points as Record<string, unknown>).bonusPoints
  return typeof bonusPoints === 'number' && Number.isFinite(bonusPoints) ? bonusPoints : null
}

// ============================================================================
// Cumulative bonus/bps differencing (ticket #253) — PURE. See the file header's "TICKET #253"
// section for why this exists and what it must never do (guess across a gap).
// ============================================================================

/** One player_gameweek_history row's bonus/bps as read from Supabase — CUMULATIVE season-to-date, never a single gameweek's own award. See that table's own column comments. */
export interface CumulativeGameweekBonusRow {
  playerCode: number
  gameweek: number
  bonus: number
  bps: number
}

/** One player's SINGLE-GAMEWEEK bonus/bps, recovered by differencing two consecutive CumulativeGameweekBonusRow rows. */
export interface DifferencedGameweekBonusRow {
  playerCode: number
  gameweek: number
  bonus: number
  bps: number
}

/**
 * Differences consecutive player_gameweek_history rows (same player_code) to recover each
 * gameweek's own bonus/bps — see the file header for the full "because". Two cases deliberately
 * produce NO delta for a row, rather than guessing:
 *
 *  - A player's FIRST row (lowest gameweek on file for him) — there is no prior row to subtract,
 *    so it is his own baseline only, never emitted as if it were a single gameweek's award (that
 *    would silently attribute his entire cumulative-to-date total, every earlier gameweek included,
 *    to just this one).
 *  - A GAP — the immediately preceding row on file is not exactly `gameweek - 1` (a gameweek this
 *    player has no row for at all, e.g. not yet ingested, or a genuine absence from the source) —
 *    differencing across it would fold two or more gameweeks' worth of award into one, which is not
 *    "a single gameweek's own bonus". The row immediately after a gap becomes a fresh baseline for
 *    whatever follows it, exactly like a first row.
 *
 * Pure — no I/O, no Supabase, no clock. Named tests: first gameweek (no delta), a gap (no delta
 * across it, but differencing resumes correctly afterward), and the ordinary consecutive case.
 */
export function differenceCumulativeGameweekRows(rows: readonly CumulativeGameweekBonusRow[]): DifferencedGameweekBonusRow[] {
  const byPlayer = new Map<number, CumulativeGameweekBonusRow[]>()
  for (const row of rows) {
    const list = byPlayer.get(row.playerCode) ?? []
    list.push(row)
    byPlayer.set(row.playerCode, list)
  }

  const out: DifferencedGameweekBonusRow[] = []
  for (const list of byPlayer.values()) {
    const sorted = [...list].sort((a, b) => a.gameweek - b.gameweek)
    for (let i = 1; i < sorted.length; i++) {
      const prev = sorted[i - 1]
      const curr = sorted[i]
      if (curr.gameweek !== prev.gameweek + 1) continue // a gap -- curr becomes a fresh baseline, never differenced across the missing gameweek(s)
      out.push({ playerCode: curr.playerCode, gameweek: curr.gameweek, bonus: curr.bonus - prev.bonus, bps: curr.bps - prev.bps })
    }
  }
  return out
}

// ============================================================================
// Actual-bonus source selection (ticket #253) — PURE.
// ============================================================================

export type ActualBonusSource = 'player_gameweek_history' | 'gameweek_live_stats'

/**
 * player_gameweek_history (full past-season coverage, ticket #248) is preferred for the target
 * season whenever it has at least one row there; gameweek_live_stats (current-season-only, ticket
 * #224) is the fallback for a season it has no rows for yet — e.g. before Keshav's post-merge
 * ingest (decisions/ticket-248.md), or before the #248 migration has been applied at all. Pure
 * selection only — the caller does the actual reading and reports which source it names. Named
 * test (ticket #253 DoD): "a season with no player_gameweek_history rows falls back to
 * gameweek_live_stats and says so".
 */
export function resolveActualBonusSource(playerGameweekHistoryRowCountForSeason: number): ActualBonusSource {
  return playerGameweekHistoryRowCountForSeason > 0 ? 'player_gameweek_history' : 'gameweek_live_stats'
}

// ============================================================================
// Per-fixture reconstruction (ticket #237) — PURE. Neither `gameweek_live_stats` nor
// `player_projections` stores a per-fixture "clamped" flag or a per-fixture bonus split (a
// player's `components.points.bonusPoints` is the SUM across every fixture he was staged for
// that gameweek, aggregated by scripts/project-points.ts's own step 6) -- so both figures below
// are reconstructed from what IS already stored, not read off a new column:
//
//  - `components.fixtures[].fixtureId` (see scripts/project-points.ts's row-construction code,
//    `fixtures: fixtureProjections.map((fp) => fp.modelInputs)`, each with its own `fixtureId`)
//    lets rows be grouped by the REAL fixture they belong to, not just by gameweek — a gameweek
//    has ~10 concurrent fixtures, each with its own separate 6-point pool.
//  - "Clamped" is INFERRED, never read off a stored flag: a player-fixture whose stored
//    `bonusPoints` is at (or numerically indistinguishable from) MAX_BONUS_POINTS_PER_PLAYER_FIXTURE
//    (imported from src/lib/projection/bonus.ts, never re-typed here) is treated as clamped. This
//    is a safe proxy for a SINGLE-fixture player-gameweek specifically (see the exclusion below):
//    allocateFixtureBonus only ever writes bonusPoints === 3.0 for an entry it clamped — a raw
//    share landing on exactly 3.0 without clamping is not impossible in principle but is not
//    something floating-point arithmetic on continuous inputs produces in practice.
//
// A player-gameweek is EXCLUDED from both figures (counted, never guessed) when its own bonus
// cannot be attributed to exactly one fixture:
//  - zero fixtures that gameweek (a genuine blank gameweek — his club did not play) — a real,
//    legitimate zero, just not a fixture to attribute a total to;
//  - two or more fixtures that gameweek (a double gameweek) — bonusPoints is their SUM, and
//    splitting it back into per-fixture pieces (which one was clamped, if either) is not
//    recoverable from the aggregate alone, same "count both, report both, fix neither" precedent
//    docs/projection-model-backlog.md's G10 already uses for run-backtest.ts's own multi-fixture
//    rows;
//  - components.fixtures (or components.points.bonusPoints) itself unreadable — same "excluded,
//    never guessed" discipline every other extractor in this file already follows.
// ============================================================================

/** Reads components.fixtures[].fixtureId. Returns null (never []) when the structure itself is unreadable — distinct from a genuine empty array (a real blank gameweek, not a parsing failure). */
export function extractFixtureIds(components: unknown): number[] | null {
  if (typeof components !== 'object' || components === null || Array.isArray(components)) return null
  const fixtures = (components as Record<string, unknown>).fixtures
  if (!Array.isArray(fixtures)) return null
  const ids: number[] = []
  for (const f of fixtures) {
    if (typeof f !== 'object' || f === null || Array.isArray(f)) return null
    const fixtureId = (f as Record<string, unknown>).fixtureId
    if (typeof fixtureId !== 'number' || !Number.isFinite(fixtureId)) return null
    ids.push(fixtureId)
  }
  return ids
}

export interface SingleFixtureBonusRow {
  playerCode: number
  fixtureId: number
  projectedBonus: number
}

export interface ExtractSingleFixtureRowsResult {
  rows: SingleFixtureBonusRow[]
  /** Rows with 0 fixtures this gameweek — a genuine blank gameweek, not a parsing failure. */
  zeroFixtureRows: number
  /** Rows with 2+ fixtures this gameweek — a double gameweek; bonusPoints is their sum and cannot be split back per-fixture. */
  multiFixtureRows: number
  /** Rows whose components.points.bonusPoints or components.fixtures could not be read at all. */
  incompleteData: number
}

export function extractSingleFixtureBonusRows(rows: readonly RawProjectedRow[]): ExtractSingleFixtureRowsResult {
  const out: SingleFixtureBonusRow[] = []
  let zeroFixtureRows = 0
  let multiFixtureRows = 0
  let incompleteData = 0
  for (const row of rows) {
    const projectedBonus = extractProjectedBonus(row.components)
    const fixtureIds = extractFixtureIds(row.components)
    if (projectedBonus === null || fixtureIds === null) {
      incompleteData++
      continue
    }
    if (fixtureIds.length === 0) {
      zeroFixtureRows++
      continue
    }
    if (fixtureIds.length >= 2) {
      multiFixtureRows++
      continue
    }
    out.push({ playerCode: row.playerCode, fixtureId: fixtureIds[0], projectedBonus })
  }
  return { rows: out, zeroFixtureRows, multiFixtureRows, incompleteData }
}

/** Floating-point slop allowed when inferring "clamped" from a stored bonusPoints figure — see file header. */
const CLAMPED_INFERENCE_EPSILON = 1e-9

/** One gameweek's per-fixture reconstruction, BEFORE any mean is taken — kept as the raw per-fixture totals array (not a pre-computed mean) specifically so pooling across gameweeks can sum the underlying fixtures, never average of means, matching this file's own "Pooling across gameweeks" convention. */
export interface FixtureAllocationRaw {
  /** One entry per real fixture this gameweek that had at least one single-fixture-attributable player — that fixture's total allocated bonus (sum of every such player's projectedBonus). */
  fixtureTotals: number[]
  clampedPlayerFixtureCount: number
  zeroFixtureRowsExcluded: number
  multiFixtureRowsExcluded: number
  incompleteDataExcluded: number
}

/** Groups by real fixture (component.fixtures[].fixtureId), over EVERY projected row for the gameweek — not just rows matched to an actual — because a fixture's real allocated total includes every player staged for it, matched or not, exactly like scripts/project-points.ts's own allocateFixtureBonus call groups every staged player, not only ones this report can later reconcile against gameweek_live_stats. */
export function computeFixtureAllocationRaw(projectedRaw: readonly RawProjectedRow[]): FixtureAllocationRaw {
  const { rows, zeroFixtureRows, multiFixtureRows, incompleteData } = extractSingleFixtureBonusRows(projectedRaw)

  const totalsByFixture = new Map<number, number>()
  let clampedPlayerFixtureCount = 0
  for (const row of rows) {
    totalsByFixture.set(row.fixtureId, (totalsByFixture.get(row.fixtureId) ?? 0) + row.projectedBonus)
    if (row.projectedBonus >= MAX_BONUS_POINTS_PER_PLAYER_FIXTURE - CLAMPED_INFERENCE_EPSILON) clampedPlayerFixtureCount++
  }

  return {
    fixtureTotals: [...totalsByFixture.values()],
    clampedPlayerFixtureCount,
    zeroFixtureRowsExcluded: zeroFixtureRows,
    multiFixtureRowsExcluded: multiFixtureRows,
    incompleteDataExcluded: incompleteData,
  }
}

export interface FixtureAllocationStats {
  fixturesMeasured: number
  /** Mean of fixtureTotals — null (never 0) when no fixture could be measured, same "unmeasured mean must never read as measured and zero" rule as computeBonusComparisonStats. */
  meanAllocatedTotal: number | null
  clampedPlayerFixtureCount: number
}

export function summarizeFixtureAllocation(fixtureTotals: readonly number[], clampedPlayerFixtureCount: number): FixtureAllocationStats {
  if (fixtureTotals.length === 0) {
    return { fixturesMeasured: 0, meanAllocatedTotal: null, clampedPlayerFixtureCount }
  }
  const sum = fixtureTotals.reduce((s, t) => s + t, 0)
  return { fixturesMeasured: fixtureTotals.length, meanAllocatedTotal: sum / fixtureTotals.length, clampedPlayerFixtureCount }
}

// ============================================================================
// Matching and statistics — PURE.
// ============================================================================

export interface RawProjectedRow {
  playerCode: number
  expectedPoints: number
  components: unknown
}

export interface ProjectedRowWithBonus {
  playerCode: number
  expectedPoints: number
  projectedBonus: number
}

export interface ActualLiveStatRow {
  playerCode: number
  bonus: number
  bps: number
}

export interface ExtractProjectedRowsResult {
  rows: ProjectedRowWithBonus[]
  /** Rows whose components.points.bonusPoints could not be read at all — excluded, never guessed. */
  skippedNoStoredBonus: number
}

export function extractProjectedRowsWithBonus(rows: readonly RawProjectedRow[]): ExtractProjectedRowsResult {
  const out: ProjectedRowWithBonus[] = []
  let skippedNoStoredBonus = 0
  for (const row of rows) {
    const projectedBonus = extractProjectedBonus(row.components)
    if (projectedBonus === null) {
      skippedNoStoredBonus++
      continue
    }
    out.push({ playerCode: row.playerCode, expectedPoints: row.expectedPoints, projectedBonus })
  }
  return { rows: out, skippedNoStoredBonus }
}

/** Highest expected_points first. A stable sort is not required here — ties are rare (distinct players rarely project identically) and this report reads means, not exact placings (see file header, "ranking skill, not exact placing"). */
export function topByExpectedPoints<T extends { expectedPoints: number }>(rows: readonly T[], n: number): T[] {
  return [...rows].sort((a, b) => b.expectedPoints - a.expectedPoints).slice(0, n)
}

export interface MatchedBonusRow {
  playerCode: number
  expectedPoints: number
  projectedBonus: number
  actualBonus: number
}

export interface MatchRowsResult {
  matched: MatchedBonusRow[]
  /** Projected rows (with a readable bonus figure) that had no gameweek_live_stats row for the same player_code — e.g. an unmappable element id was excluded at ingest time. */
  unmatchedCount: number
}

export function matchRowsToActual(
  projectedRows: readonly ProjectedRowWithBonus[],
  actualByPlayerCode: ReadonlyMap<number, ActualLiveStatRow>,
): MatchRowsResult {
  const matched: MatchedBonusRow[] = []
  let unmatchedCount = 0
  for (const p of projectedRows) {
    const actual = actualByPlayerCode.get(p.playerCode)
    if (!actual) {
      unmatchedCount++
      continue
    }
    matched.push({ playerCode: p.playerCode, expectedPoints: p.expectedPoints, projectedBonus: p.projectedBonus, actualBonus: actual.bonus })
  }
  return { matched, unmatchedCount }
}

export interface BonusComparisonStats {
  sampleSize: number
  meanProjectedBonus: number | null
  meanActualBonus: number | null
  /** actual - projected: positive = the model UNDER-projects bonus; negative = it OVER-projects. Same convention as scripts/settle-predictions.ts's computeError. */
  meanSignedError: number | null
}

/** null (not 0) for every figure on an empty input — an unmeasured mean must never read as "measured and zero". Same reasoning as scripts/settle-predictions.ts's computeAggregateErrorStats. */
export function computeBonusComparisonStats(rows: readonly { projectedBonus: number; actualBonus: number }[]): BonusComparisonStats {
  if (rows.length === 0) {
    return { sampleSize: 0, meanProjectedBonus: null, meanActualBonus: null, meanSignedError: null }
  }
  const n = rows.length
  const sumProjected = rows.reduce((sum, r) => sum + r.projectedBonus, 0)
  const sumActual = rows.reduce((sum, r) => sum + r.actualBonus, 0)
  const sumSignedError = rows.reduce((sum, r) => sum + (r.actualBonus - r.projectedBonus), 0)
  return {
    sampleSize: n,
    meanProjectedBonus: sumProjected / n,
    meanActualBonus: sumActual / n,
    meanSignedError: sumSignedError / n,
  }
}

// ============================================================================
// Per-gameweek report — PURE. Composes the pieces above. Carries the matched-row arrays
// (overallMatched/top20Matched) alongside their derived stats specifically so
// poolGameweekReports (below) can pool ROWS across gameweeks rather than averaging means — see
// file header, "Pooling across gameweeks".
// ============================================================================

export interface GameweekBonusReport {
  gameweekId: number
  overall: BonusComparisonStats
  overallMatched: MatchedBonusRow[]
  top20: BonusComparisonStats
  top20Matched: MatchedBonusRow[]
  /** How many of the gameweek's top TOP_N_PROJECTED-by-expected_points players had no actual row to compare against — should normally be 0; nonzero flags a reconciliation gap worth reading job_runs.details for. */
  topProjectedUnmatched: number
  projectedRowsTotal: number
  projectedWithNoStoredBonus: number
  projectedWithNoActual: number
  actualWithNoProjected: number
  /** Ticket #237 — the raw per-fixture reconstruction (clamped count + fixture totals), kept unsummarised so poolGameweekReports can pool fixtures across gameweeks, not average of means. */
  fixtureAllocationRaw: FixtureAllocationRaw
  /** Ticket #237 — this gameweek's own clamped count + mean per-fixture allocated total. */
  fixtureAllocation: FixtureAllocationStats
}

export function buildGameweekBonusReport(
  gameweekId: number,
  projectedRaw: readonly RawProjectedRow[],
  actual: readonly ActualLiveStatRow[],
  topN: number = TOP_N_PROJECTED,
): GameweekBonusReport {
  const { rows: projectedRows, skippedNoStoredBonus } = extractProjectedRowsWithBonus(projectedRaw)
  const actualByPlayerCode = new Map(actual.map((a) => [a.playerCode, a]))

  const overallMatch = matchRowsToActual(projectedRows, actualByPlayerCode)
  const overall = computeBonusComparisonStats(overallMatch.matched)

  const topProjectedRows = topByExpectedPoints(projectedRows, topN)
  const topMatch = matchRowsToActual(topProjectedRows, actualByPlayerCode)
  const top20 = computeBonusComparisonStats(topMatch.matched)

  const matchedCodes = new Set(overallMatch.matched.map((m) => m.playerCode))
  const actualWithNoProjected = actual.filter((a) => !matchedCodes.has(a.playerCode)).length

  const fixtureAllocationRaw = computeFixtureAllocationRaw(projectedRaw)
  const fixtureAllocation = summarizeFixtureAllocation(fixtureAllocationRaw.fixtureTotals, fixtureAllocationRaw.clampedPlayerFixtureCount)

  return {
    gameweekId,
    overall,
    overallMatched: overallMatch.matched,
    top20,
    top20Matched: topMatch.matched,
    topProjectedUnmatched: topMatch.unmatchedCount,
    projectedRowsTotal: projectedRaw.length,
    projectedWithNoStoredBonus: skippedNoStoredBonus,
    projectedWithNoActual: overallMatch.unmatchedCount,
    actualWithNoProjected,
    fixtureAllocationRaw,
    fixtureAllocation,
  }
}

// ============================================================================
// Season pooling — PURE. Concatenates matched ROWS across every measured gameweek, then computes
// ONE mean over the pooled set — never a mean of each gameweek's own mean. See file header.
// ============================================================================

export interface SeasonBonusReport {
  gameweeksMeasured: number
  overall: BonusComparisonStats
  top20: BonusComparisonStats
  /** Ticket #237 — pooled from every measured gameweek's own fixtureTotals array (never a mean of means), matching this file's existing pooling convention. */
  fixtureAllocation: FixtureAllocationStats
}

export function poolGameweekReports(reports: readonly GameweekBonusReport[]): SeasonBonusReport {
  const pooledFixtureTotals = reports.flatMap((r) => r.fixtureAllocationRaw.fixtureTotals)
  const pooledClampedCount = reports.reduce((sum, r) => sum + r.fixtureAllocationRaw.clampedPlayerFixtureCount, 0)
  return {
    gameweeksMeasured: reports.length,
    overall: computeBonusComparisonStats(reports.flatMap((r) => r.overallMatched)),
    top20: computeBonusComparisonStats(reports.flatMap((r) => r.top20Matched)),
    fixtureAllocation: summarizeFixtureAllocation(pooledFixtureTotals, pooledClampedCount),
  }
}

// ============================================================================
// Rendering — PURE string building, no I/O. Markdown, matching scripts/calibration-report.ts's
// own console-log-a-markdown-report convention.
// ============================================================================

function fmt(n: number | null, digits = 3): string {
  return n === null ? 'n/a' : n.toFixed(digits)
}

function renderStatsRow(label: string, stats: BonusComparisonStats): string {
  return `| ${label} | ${stats.sampleSize} | ${fmt(stats.meanProjectedBonus)} | ${fmt(stats.meanActualBonus)} | ${fmt(stats.meanSignedError)} |`
}

const STATS_TABLE_HEADER = '| Population | n | Mean projected bonus | Mean actual bonus | Mean signed error (actual − projected) |\n|---|---|---|---|---|'

function renderFixtureAllocationLine(stats: FixtureAllocationStats, raw: FixtureAllocationRaw): string {
  const meanText = stats.meanAllocatedTotal === null ? 'n/a' : stats.meanAllocatedTotal.toFixed(3)
  return (
    `Fixture allocation (ticket #237): ${stats.fixturesMeasured} fixture(s) reconstructed, ` +
    `mean per-fixture allocated total **${meanText}** (of 6.00), ${stats.clampedPlayerFixtureCount} player-fixture(s) inferred clamped ` +
    `(bonusPoints at ${MAX_BONUS_POINTS_PER_PLAYER_FIXTURE.toFixed(1)}). Excluded from this reconstruction: ${raw.zeroFixtureRowsExcluded} ` +
    `blank-gameweek row(s), ${raw.multiFixtureRowsExcluded} multi-fixture (double-gameweek) row(s), ${raw.incompleteDataExcluded} row(s) ` +
    'with unreadable bonus/fixture data.'
  )
}

export function renderGameweekSection(report: GameweekBonusReport): string {
  const rows = [renderStatsRow('All matched players', report.overall), renderStatsRow(`Top ${TOP_N_PROJECTED} projected`, report.top20)]
  const reconciliation =
    `Projected rows read: ${report.projectedRowsTotal} · no stored bonus figure: ${report.projectedWithNoStoredBonus} · ` +
    `no matching live stats row: ${report.projectedWithNoActual} · live rows with no matching projection: ${report.actualWithNoProjected}` +
    (report.topProjectedUnmatched > 0 ? ` · **${report.topProjectedUnmatched} of the top ${TOP_N_PROJECTED} had no actual row**` : '')
  return (
    `### Gameweek ${report.gameweekId}\n\n${STATS_TABLE_HEADER}\n${rows.join('\n')}\n\n${reconciliation}\n\n` +
    renderFixtureAllocationLine(report.fixtureAllocation, report.fixtureAllocationRaw)
  )
}

export function renderSeasonSection(season: SeasonBonusReport, pooledFixtureAllocationRaw: FixtureAllocationRaw): string {
  const rows = [renderStatsRow('All matched players', season.overall), renderStatsRow(`Top ${TOP_N_PROJECTED} projected (pooled)`, season.top20)]
  return (
    `### Pooled across all ${season.gameweeksMeasured} measured gameweek(s)\n\n` +
    `${STATS_TABLE_HEADER}\n${rows.join('\n')}\n\n` +
    'Pooled from the underlying matched player-gameweek rows, not from a mean of each gameweek\'s own mean — see this file\'s ' +
    'own header, "Pooling across gameweeks".\n\n' +
    renderFixtureAllocationLine(season.fixtureAllocation, pooledFixtureAllocationRaw)
  )
}

export function renderReport(reports: readonly GameweekBonusReport[], generatedAt: Date, actualBonusSource: ActualBonusSource = 'gameweek_live_stats'): string {
  const sections: string[] = []
  const sourceLabel =
    actualBonusSource === 'player_gameweek_history'
      ? `\`player_gameweek_history\` (${CURRENT_SEASON}, ticket #248 — differenced from its cumulative bonus column, ticket #253)`
      : '`gameweek_live_stats` (ticket #224)'

  sections.push(
    '# Bonus allocator validation report\n\n' +
      `Generated: ${generatedAt.toISOString()} · Job: \`${JOB_NAME}\` · Model version: \`${MODEL_VERSION}\`\n\n` +
      "Compares `player_projections.components.points.bonusPoints` (this model's projected bonus share, ticket #78) " +
      `against the real, awarded bonus. **Actual-bonus source this run: ${sourceLabel}** (ticket #253 — ` +
      `\`player_gameweek_history\` is preferred whenever it has rows for ${CURRENT_SEASON}, falling back to ` +
      '`gameweek_live_stats` when it does not, per `resolveActualBonusSource`). **Read-only — changes nothing.**',
  )

  sections.push(
    '## The three-gameweek limitation\n\n' +
      `This run measured **${reports.length} finished, past-lockdown 2026/27 gameweek(s)**. ` +
      'The source endpoint (`event/{gw}/live/`) serves the CURRENT season only — there is no equivalent for a past season, ' +
      'and never will be. This number can only grow by exactly one gameweek per week the season progresses; there is no way ' +
      `to add history faster. ${reports.length} gameweek(s) is not enough to trust a mean with real confidence — this ` +
      "instrument's value is that it accumulates over the season, not that any single run of it is conclusive. " +
      `Read every figure below alongside its own sample size, printed beside it. (This limitation is about ` +
      "gameweek_live_stats specifically; player_gameweek_history, when it is this run's source instead, is not bounded " +
      'the same way — see the header above for which source this run actually used.)',
  )

  if (reports.length === 0) {
    sections.push(
      '## No measurable gameweeks yet\n\n' +
        `No rows exist yet from either source for ${CURRENT_SEASON}. Run \`scripts/ingest-core-insights.ts\` (populates ` +
        '`player_gameweek_history`) or `scripts/ingest-gameweek-live-stats.ts` (populates `gameweek_live_stats`, once at ' +
        'least one gameweek has finished and passed lockdown) first.',
    )
    return sections.join('\n\n')
  }

  sections.push('## Per gameweek\n\n' + reports.map(renderGameweekSection).join('\n\n'))
  const season = poolGameweekReports(reports)
  const pooledFixtureAllocationRaw: FixtureAllocationRaw = {
    fixtureTotals: reports.flatMap((r) => r.fixtureAllocationRaw.fixtureTotals),
    clampedPlayerFixtureCount: season.fixtureAllocation.clampedPlayerFixtureCount,
    zeroFixtureRowsExcluded: reports.reduce((sum, r) => sum + r.fixtureAllocationRaw.zeroFixtureRowsExcluded, 0),
    multiFixtureRowsExcluded: reports.reduce((sum, r) => sum + r.fixtureAllocationRaw.multiFixtureRowsExcluded, 0),
    incompleteDataExcluded: reports.reduce((sum, r) => sum + r.fixtureAllocationRaw.incompleteDataExcluded, 0),
  }
  sections.push('## Season\n\n' + renderSeasonSection(season, pooledFixtureAllocationRaw))
  sections.push(
    '## What this does and does not tell us\n\n' +
      '- **BPS is stored but not compared here** — `gameweek_live_stats.bps` is ingested for a future ticket; no persisted ' +
      '"projected BPS" figure exists on `player_projections` today for it to be compared against. See ' +
      '`docs/projection-model-backlog.md`\'s G3 entry.\n' +
      '- **This measures the DISTRIBUTION, not exact placings.** The allocator shares six points continuously by modelled BPS ' +
      'share; it was never meant to predict who finishes 1st/2nd/3rd in a fixture. A signed error near zero with a small ' +
      'sample is still weak evidence — read the sample size.\n' +
      '- **Nothing here changes the allocator, the backtest, the calibration report, the solver, or the app.** This is a ' +
      'read-only measurement, same convention as `scripts/calibration-report.ts`.',
  )

  return sections.join('\n\n')
}

// ============================================================================
// Row shapes read from Supabase — only the fields this job uses.
// ============================================================================

interface GameweekLiveStatsRow {
  gameweek_id: number
  player_code: number
  bonus: number
  bps: number
}

/** Ticket #253. Only the columns this job differences — see differenceCumulativeGameweekRows. */
interface PlayerGameweekHistoryRow {
  gameweek: number
  player_code: number
  bonus: number
  bps: number
}

interface PlayerProjectionRow {
  player_code: number | null
  expected_points: number
  components: unknown
}

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const startedAt = new Date()
  const env = readSupabaseEnv()
  if (!env) {
    process.exit(1)
    return
  }
  const supabase = createClient(env.url, env.secretKey)

  try {
    // --------------------------------------------------------------------
    // 1. The actual-bonus source (ticket #253) — player_gameweek_history for CURRENT_SEASON when
    //    it has rows, else the pre-#253 gameweek_live_stats path, unchanged. See resolveActualBonusSource
    //    and the file header's "TICKET #253" section. This defines which gameweeks are measurable at all.
    // --------------------------------------------------------------------
    let liveStatsPages = 0
    let playerGameweekHistoryRowsFetched = 0
    const {
      rows: playerGameweekHistoryRows,
      error: playerGameweekHistoryError,
      pages: playerGameweekHistoryPages,
    } = await fetchAllPages<PlayerGameweekHistoryRow>((from, to) =>
      supabase
        .from('player_gameweek_history')
        .select('gameweek, player_code, bonus, bps')
        .eq('season', CURRENT_SEASON)
        .order('player_code', { ascending: true })
        .order('gameweek', { ascending: true })
        .range(from, to)
        .returns<PlayerGameweekHistoryRow[]>(),
    )
    // A missing table is a graceful, EXPECTED-during-rollout case (the #248 migration/ingest may
    // not have run yet on this database — see decisions/ticket-248.md) — never a hard failure here;
    // it is treated exactly like "0 rows for this season", which resolveActualBonusSource already
    // falls back on. Any OTHER error is a real failure and still propagates.
    const playerGameweekHistoryMissingTable = playerGameweekHistoryError !== null && isMissingTable(playerGameweekHistoryError, 'player_gameweek_history')
    if (playerGameweekHistoryError && !playerGameweekHistoryMissingTable) {
      throw new BonusValidationError(`player_gameweek_history lookup failed: ${playerGameweekHistoryError.message}`, 'player_gameweek_history')
    }
    if (!playerGameweekHistoryError) {
      playerGameweekHistoryRowsFetched = playerGameweekHistoryRows.length
      console.log(`${JOB_NAME}: player_gameweek_history (${CURRENT_SEASON}): ${playerGameweekHistoryRowsFetched} row(s) read (${playerGameweekHistoryPages} page(s)).`)
    } else {
      console.log(
        `${JOB_NAME}: table "player_gameweek_history" does not exist yet — treating as 0 rows for ${CURRENT_SEASON} ` +
          `(apply ${PLAYER_GAMEWEEK_HISTORY_MIGRATION} to enable it as this run's actual-bonus source).`,
      )
    }

    const actualBonusSource = resolveActualBonusSource(playerGameweekHistoryRowsFetched)
    const actualByGameweek = new Map<number, ActualLiveStatRow[]>()
    let liveStatsRowsFetched = 0

    if (actualBonusSource === 'player_gameweek_history') {
      const differenced = differenceCumulativeGameweekRows(
        playerGameweekHistoryRows.map((row) => ({ playerCode: row.player_code, gameweek: row.gameweek, bonus: row.bonus, bps: row.bps })),
      )
      for (const row of differenced) {
        const list = actualByGameweek.get(row.gameweek) ?? []
        list.push({ playerCode: row.playerCode, bonus: row.bonus, bps: row.bps })
        actualByGameweek.set(row.gameweek, list)
      }
      console.log(
        `${JOB_NAME}: actual-bonus source is player_gameweek_history (${CURRENT_SEASON}) — ` +
          `${playerGameweekHistoryRowsFetched} cumulative row(s) differenced into ${differenced.length} single-gameweek row(s).`,
      )
    } else {
      const {
        rows: liveStatsRows,
        error: liveStatsError,
        pages: fetchedLiveStatsPages,
      } = await fetchAllPages<GameweekLiveStatsRow>((from, to) =>
        supabase
          .from('gameweek_live_stats')
          .select('gameweek_id, player_code, bonus, bps')
          .order('gameweek_id', { ascending: true })
          .order('player_code', { ascending: true })
          .range(from, to)
          .returns<GameweekLiveStatsRow[]>(),
      )
      if (liveStatsError) {
        if (isMissingTable(liveStatsError, 'gameweek_live_stats')) {
          throw new BonusValidationError(
            `the "gameweek_live_stats" table does not exist. Apply ${GAMEWEEK_LIVE_STATS_MIGRATION} first.`,
            'gameweek_live_stats',
          )
        }
        throw new BonusValidationError(`gameweek_live_stats lookup failed: ${liveStatsError.message}`, 'gameweek_live_stats')
      }
      const { count: liveStatsExpectedCount, error: liveStatsCountError } = await supabase
        .from('gameweek_live_stats')
        .select('*', { count: 'exact', head: true })
      if (liveStatsCountError) {
        throw new BonusValidationError(`gameweek_live_stats count check failed: ${liveStatsCountError.message}`, 'gameweek_live_stats')
      }
      assertRowCountMatches('gameweek_live_stats', liveStatsRows.length, liveStatsExpectedCount ?? 0)
      liveStatsPages = fetchedLiveStatsPages
      liveStatsRowsFetched = liveStatsRows.length

      for (const row of liveStatsRows) {
        const list = actualByGameweek.get(row.gameweek_id) ?? []
        list.push({ playerCode: row.player_code, bonus: row.bonus, bps: row.bps })
        actualByGameweek.set(row.gameweek_id, list)
      }
      console.log(
        `${JOB_NAME}: actual-bonus source is gameweek_live_stats — player_gameweek_history had 0 row(s) for ${CURRENT_SEASON}, falling back ` +
          `(this is the expected state before Keshav's post-merge ingest — see decisions/ticket-248.md).`,
      )
    }

    const measurableGameweekIds = [...actualByGameweek.keys()].sort((a, b) => a - b)

    if (measurableGameweekIds.length === 0) {
      const message =
        `${JOB_NAME}: no measurable rows yet from either source (player_gameweek_history: ` +
        `${playerGameweekHistoryRowsFetched} row(s) for ${CURRENT_SEASON}; gameweek_live_stats: ${liveStatsRowsFetched} row(s)) — ` +
        'run scripts/ingest-core-insights.ts or scripts/ingest-gameweek-live-stats.ts first.'
      console.log(message)
      console.log(renderReport([], startedAt, actualBonusSource))
      await recordJobRun(supabase, { status: 'skipped', message, details: { gameweeksMeasured: 0, actualBonusSource }, startedAt })
      return
    }

    // --------------------------------------------------------------------
    // 2. player_projections at MODEL_VERSION for each measurable gameweek.
    // --------------------------------------------------------------------
    const gameweekReports: GameweekBonusReport[] = []

    for (const gwId of measurableGameweekIds) {
      const {
        rows: projectionRows,
        error: projectionError,
        pages: projectionPages,
      } = await fetchAllPages<PlayerProjectionRow>((from, to) =>
        supabase
          .from('player_projections')
          .select('player_code, expected_points, components')
          .eq('gameweek_id', gwId)
          .eq('model_version', MODEL_VERSION)
          .order('player_code', { ascending: true })
          .range(from, to)
          .returns<PlayerProjectionRow[]>(),
      )
      if (projectionError) {
        if (isMissingTable(projectionError, 'player_projections')) {
          throw new BonusValidationError(
            `the "player_projections" table does not exist. Apply ${PLAYER_PROJECTIONS_MIGRATION} first.`,
            'player_projections',
          )
        }
        throw new BonusValidationError(`player_projections lookup for gameweek ${gwId} failed: ${projectionError.message}`, 'player_projections')
      }
      const { count: projectionExpectedCount, error: projectionCountError } = await supabase
        .from('player_projections')
        .select('*', { count: 'exact', head: true })
        .eq('gameweek_id', gwId)
        .eq('model_version', MODEL_VERSION)
      if (projectionCountError) {
        throw new BonusValidationError(`player_projections count check for gameweek ${gwId} failed: ${projectionCountError.message}`, 'player_projections')
      }
      assertRowCountMatches(`player_projections (gameweek ${gwId})`, projectionRows.length, projectionExpectedCount ?? 0)

      const rawRows: RawProjectedRow[] = projectionRows
        .filter((r): r is PlayerProjectionRow & { player_code: number } => r.player_code !== null)
        .map((r) => ({ playerCode: r.player_code, expectedPoints: r.expected_points, components: r.components }))
      const projectionRowsWithNoPlayerCode = projectionRows.length - rawRows.length

      const report = buildGameweekBonusReport(gwId, rawRows, actualByGameweek.get(gwId) ?? [])
      gameweekReports.push(report)

      console.log(
        `${JOB_NAME}: gameweek ${gwId}: ${projectionRows.length} projection row(s) read (${projectionPages} page(s)), ` +
          `${(actualByGameweek.get(gwId) ?? []).length} live stat row(s), ${report.overall.sampleSize} matched, ` +
          `${projectionRowsWithNoPlayerCode} projection row(s) with no player_code excluded.`,
      )
    }

    const generatedAt = new Date()
    const reportMarkdown = renderReport(gameweekReports, generatedAt, actualBonusSource)
    console.log(reportMarkdown)

    const season = poolGameweekReports(gameweekReports)
    const details: JsonRecord = {
      gameweeksMeasured: gameweekReports.length,
      measurableGameweekIds,
      actualBonusSource,
      playerGameweekHistoryRowsFetched,
      liveStatsRowsFetched,
      liveStatsPages,
      perGameweek: gameweekReports.map((r) => ({
        gameweekId: r.gameweekId,
        overallSampleSize: r.overall.sampleSize,
        overallMeanProjectedBonus: r.overall.meanProjectedBonus,
        overallMeanActualBonus: r.overall.meanActualBonus,
        overallMeanSignedError: r.overall.meanSignedError,
        top20SampleSize: r.top20.sampleSize,
        top20MeanProjectedBonus: r.top20.meanProjectedBonus,
        top20MeanActualBonus: r.top20.meanActualBonus,
        top20MeanSignedError: r.top20.meanSignedError,
        projectedRowsTotal: r.projectedRowsTotal,
        projectedWithNoStoredBonus: r.projectedWithNoStoredBonus,
        projectedWithNoActual: r.projectedWithNoActual,
        actualWithNoProjected: r.actualWithNoProjected,
        topProjectedUnmatched: r.topProjectedUnmatched,
        fixtureAllocation: r.fixtureAllocation,
      })),
      season,
    }

    const message =
      `${JOB_NAME}: measured ${gameweekReports.length} gameweek(s). Actual-bonus source: ${actualBonusSource} (ticket #253). ` +
      `Season overall n=${season.overall.sampleSize}, mean projected bonus ${season.overall.meanProjectedBonus?.toFixed(3) ?? 'n/a'}, ` +
      `mean actual bonus ${season.overall.meanActualBonus?.toFixed(3) ?? 'n/a'}, signed error ${season.overall.meanSignedError?.toFixed(3) ?? 'n/a'}. ` +
      `Top ${TOP_N_PROJECTED} n=${season.top20.sampleSize}, mean projected bonus ${season.top20.meanProjectedBonus?.toFixed(3) ?? 'n/a'}, ` +
      `mean actual bonus ${season.top20.meanActualBonus?.toFixed(3) ?? 'n/a'}, signed error ${season.top20.meanSignedError?.toFixed(3) ?? 'n/a'}. ` +
      `Fixture allocation (ticket #237): ${season.fixtureAllocation.fixturesMeasured} fixture(s), mean per-fixture total ` +
      `${season.fixtureAllocation.meanAllocatedTotal?.toFixed(3) ?? 'n/a'}, ${season.fixtureAllocation.clampedPlayerFixtureCount} clamped. ` +
      'Only 2026/27 gameweeks can ever be measured — see the report\'s own "three-gameweek limitation" section.'
    await recordJobRun(supabase, { status: 'success', message, details, startedAt })
  } catch (err) {
    const message =
      err instanceof BonusValidationError
        ? err.message
        : err instanceof Error
          ? `unexpected failure: ${err.message}`
          : `unexpected failure: ${String(err)}`

    console.error(`${JOB_NAME}: failed: ${message}`)

    try {
      await recordJobRun(supabase, { status: 'failure', message, details: {}, startedAt })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}: additionally failed to record the failed job_runs row: ${recordMessage}`)
    }

    process.exit(1)
  }
}

// Guarded, matching every other scripts/*.ts job: importing this module (e.g. from a test file)
// must not trigger a real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
