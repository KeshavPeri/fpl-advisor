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

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'

const JOB_NAME = 'bonus-validation-report'
/** Must match scripts/project-points.ts's own MODEL_VERSION — duplicated, not imported; see scripts/snapshot-predictions.ts's precedent for why every scripts/*.ts job is a standalone entry point. */
const MODEL_VERSION = 'baseline-v1'
const GAMEWEEK_LIVE_STATS_MIGRATION = 'supabase/migrations/20260911090000_gameweek_live_stats.sql'
const PLAYER_PROJECTIONS_MIGRATION = 'supabase/migrations/20260815120000_player_projections.sql'

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
}

export function poolGameweekReports(reports: readonly GameweekBonusReport[]): SeasonBonusReport {
  return {
    gameweeksMeasured: reports.length,
    overall: computeBonusComparisonStats(reports.flatMap((r) => r.overallMatched)),
    top20: computeBonusComparisonStats(reports.flatMap((r) => r.top20Matched)),
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

export function renderGameweekSection(report: GameweekBonusReport): string {
  const rows = [renderStatsRow('All matched players', report.overall), renderStatsRow(`Top ${TOP_N_PROJECTED} projected`, report.top20)]
  const reconciliation =
    `Projected rows read: ${report.projectedRowsTotal} · no stored bonus figure: ${report.projectedWithNoStoredBonus} · ` +
    `no matching live stats row: ${report.projectedWithNoActual} · live rows with no matching projection: ${report.actualWithNoProjected}` +
    (report.topProjectedUnmatched > 0 ? ` · **${report.topProjectedUnmatched} of the top ${TOP_N_PROJECTED} had no actual row**` : '')
  return `### Gameweek ${report.gameweekId}\n\n${STATS_TABLE_HEADER}\n${rows.join('\n')}\n\n${reconciliation}`
}

export function renderSeasonSection(season: SeasonBonusReport): string {
  const rows = [renderStatsRow('All matched players', season.overall), renderStatsRow(`Top ${TOP_N_PROJECTED} projected (pooled)`, season.top20)]
  return (
    `### Pooled across all ${season.gameweeksMeasured} measured gameweek(s)\n\n` +
    `${STATS_TABLE_HEADER}\n${rows.join('\n')}\n\n` +
    'Pooled from the underlying matched player-gameweek rows, not from a mean of each gameweek\'s own mean — see this file\'s ' +
    'own header, "Pooling across gameweeks".'
  )
}

export function renderReport(reports: readonly GameweekBonusReport[], generatedAt: Date): string {
  const sections: string[] = []

  sections.push(
    '# Bonus allocator validation report\n\n' +
      `Generated: ${generatedAt.toISOString()} · Job: \`${JOB_NAME}\` · Model version: \`${MODEL_VERSION}\`\n\n` +
      "Compares `player_projections.components.points.bonusPoints` (this model's projected bonus share, ticket #78) " +
      'against the real, awarded bonus from `gameweek_live_stats` (ticket #224). **Read-only — changes nothing.**',
  )

  sections.push(
    '## The three-gameweek limitation\n\n' +
      `This run measured **${reports.length} finished, past-lockdown 2026/27 gameweek(s)**. ` +
      'The source endpoint (`event/{gw}/live/`) serves the CURRENT season only — there is no equivalent for a past season, ' +
      'and never will be. This number can only grow by exactly one gameweek per week the season progresses; there is no way ' +
      `to add history faster. ${reports.length} gameweek(s) is not enough to trust a mean with real confidence — this ` +
      "instrument's value is that it accumulates over the season, not that any single run of it is conclusive. " +
      'Read every figure below alongside its own sample size, printed beside it.',
  )

  if (reports.length === 0) {
    sections.push(
      '## No measurable gameweeks yet\n\n' +
        'No rows exist in `gameweek_live_stats` yet. Run `scripts/ingest-gameweek-live-stats.ts` first, once at least one ' +
        '2026/27 gameweek has finished and passed lockdown.',
    )
    return sections.join('\n\n')
  }

  sections.push('## Per gameweek\n\n' + reports.map(renderGameweekSection).join('\n\n'))
  sections.push('## Season\n\n' + renderSeasonSection(poolGameweekReports(reports)))
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
    // 1. Every gameweek_live_stats row — this defines which gameweeks are measurable at all.
    //    Ordered on its own primary key, so pagination is safe.
    // --------------------------------------------------------------------
    const {
      rows: liveStatsRows,
      error: liveStatsError,
      pages: liveStatsPages,
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

    const actualByGameweek = new Map<number, ActualLiveStatRow[]>()
    for (const row of liveStatsRows) {
      const list = actualByGameweek.get(row.gameweek_id) ?? []
      list.push({ playerCode: row.player_code, bonus: row.bonus, bps: row.bps })
      actualByGameweek.set(row.gameweek_id, list)
    }
    const measurableGameweekIds = [...actualByGameweek.keys()].sort((a, b) => a - b)

    if (measurableGameweekIds.length === 0) {
      const message = `${JOB_NAME}: no rows in gameweek_live_stats yet — run scripts/ingest-gameweek-live-stats.ts first.`
      console.log(message)
      console.log(renderReport([], startedAt))
      await recordJobRun(supabase, { status: 'skipped', message, details: { gameweeksMeasured: 0 }, startedAt })
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
    const reportMarkdown = renderReport(gameweekReports, generatedAt)
    console.log(reportMarkdown)

    const season = poolGameweekReports(gameweekReports)
    const details: JsonRecord = {
      gameweeksMeasured: gameweekReports.length,
      measurableGameweekIds,
      liveStatsRowsFetched: liveStatsRows.length,
      liveStatsExpectedByCount: liveStatsExpectedCount ?? 0,
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
      })),
      season,
    }

    const message =
      `${JOB_NAME}: measured ${gameweekReports.length} gameweek(s). ` +
      `Season overall n=${season.overall.sampleSize}, mean projected bonus ${season.overall.meanProjectedBonus?.toFixed(3) ?? 'n/a'}, ` +
      `mean actual bonus ${season.overall.meanActualBonus?.toFixed(3) ?? 'n/a'}, signed error ${season.overall.meanSignedError?.toFixed(3) ?? 'n/a'}. ` +
      `Top ${TOP_N_PROJECTED} n=${season.top20.sampleSize}, mean projected bonus ${season.top20.meanProjectedBonus?.toFixed(3) ?? 'n/a'}, ` +
      `mean actual bonus ${season.top20.meanActualBonus?.toFixed(3) ?? 'n/a'}, signed error ${season.top20.meanSignedError?.toFixed(3) ?? 'n/a'}. ` +
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
