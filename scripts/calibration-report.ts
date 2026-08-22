// Calibration report — ticket #48. Read-only, measures the baseline
// projection model against last season's actuals; changes nothing.
//
// ============================================================================
// Why this ticket exists.
// ============================================================================
// The first stored solve (16 Aug 2026) projected O'Reilly (DEF) 7.31,
// Guéhi (DEF) 6.82 above every forward and midfielder, and captained a
// defender in four of five gameweeks. That may be correct — 2026/27's
// defensive-contribution rules genuinely raised defender scoring, which is
// why product-brief.md §6d treats defcon as a first-class model input — or
// the model may be systematically over-rewarding defenders. Nothing in the
// system could answer that question before this ticket. This job answers it
// with a number: it reconstructs actual 2025/26 points from
// player_match_stats using the SAME scoring rules the model is built on
// (src/lib/scoring/), aggregates by position, and compares against
// player_projections' stored output. It does not change the model — see
// docs/projection-model-backlog.md and product-brief.md §6d for that.
//
// ============================================================================
// NOT a backtest.
// ============================================================================
// A point-in-time backtest would need lookahead-free feature reconstruction
// (the model's inputs for a GW12 projection built only from data available
// before GW12) — nothing in this repo does that yet; it is feature item 29.
// This job instead compares two DISTRIBUTIONS: does a defender actually
// score about this many points per 90 minutes, and does the model project
// about that many for defenders. player_match_stats is 2025/26;
// player_projections is baseline-v1's 2026/27 output — different seasons,
// mostly different players. That is fine for a distributional comparison and
// wrong for a per-player one; the report says so at the top, in words, not
// just here.
//
// ============================================================================
// No scoring rule is reimplemented here.
// ============================================================================
// Defensive-contribution and goalkeeper-save points come from
// src/lib/scoring/'s own functions (defensiveContributionPoints,
// goalkeeperSavePoints), and every match total is summed by
// src/lib/scoring/totalMatchPoints.ts — never hand-added. The standard
// point-value TABLE (goal/clean-sheet/appearance/goals-conceded/save values)
// lives in src/lib/projection/pointValues.ts, which states in its own header
// that it is "the only place in the repository these numbers may appear"
// (ticket #33 DoD) — this file imports those constants rather than
// reimplementing them a second time, which would both violate that stated
// invariant and risk exactly the kind of silent drift pointValues.ts's own
// goalkeeper-goal-value note warns about (10, not the historical 6). Nothing
// under src/lib/projection/ is EDITED by this ticket — only imported, which
// the ticket's scope constraint permits (it forbids changing the module, not
// reading it) and which docs/projection-model-backlog.md's draft explicitly
// anticipated ("this job imports from src/lib/scoring/").
//
// ============================================================================
// THE JOIN.
// ============================================================================
// Position comes from players.element_type, joined on
// player_match_stats.player_code = players.code — NEVER player_id = id. See
// the #12/#22 migrations' header comments: FPL element ids are not stable
// across a season boundary (453 of 458 sampled players changed id between
// 2025/26 and 2026/27), so player_match_stats.player_id cannot be resolved
// against a current players table. This file never selects
// player_match_stats.player_id at all, which makes that join mistake
// impossible to make by accident rather than merely disciplined against.
//
// ============================================================================
// PREMIER LEAGUE ONLY (ticket #54).
// ============================================================================
// player_match_stats holds every competition the source publishes, not just
// Premier League — cup and European matches score zero FPL points and this
// report was scoring them as though they did (see the ticket for the
// measured effect). The actual-side read below (section 2) filters to
// competition = PREMIER_LEAGUE_COMPETITION IN THE QUERY, alongside the
// existing season filter, on both the data fetch and its count-check, so the
// two always agree — see scripts/calibration-report.test.ts's grep-based
// test for that identity. A row whose competition is NULL (not yet
// re-stamped since the #54 migration added the column) is excluded, same as
// a known non-Premier-League row, and both are counted separately.
//
// ============================================================================
// Bonus and cards.
// ============================================================================
// player_match_stats carries neither bonus nor cards, so both are reported
// as exactly 0 on the actual side — an honest UNDER-count, not a claim that
// nobody earned bonus. Cards remain out of scope on both sides (G4). Bonus
// is DIFFERENT since ticket #78: src/lib/projection/expectedPoints.ts still
// hardcodes bonusPoints to 0 for a single player-fixture, but
// scripts/project-points.ts's second, fixture-grouped pass now allocates a
// real (projected) bonus figure into player_projections.expected_points
// before this report reads it — so the two sides are NOT on the same basis
// any more, and this report's own caveats section says so explicitly rather
// than claiming a like-for-like comparison it can no longer make. See the
// report's own caveats section for the rough average bonus is worth per
// match, computed from the FPL bonus system's known 3/2/1 structure
// (BONUS_POINTS_PER_MATCH_TOTAL / PLAYERS_ON_PITCH_PER_MATCH below) — NOT
// derived from any per-player data this job reads, and not used in any
// point total.
//
// ============================================================================
// Wiring.
// ============================================================================
// Reads exactly SUPABASE_URL and SUPABASE_SECRET_KEY. No VITE_-prefixed
// variable. Writes to no table but job_runs (one row, never upserted — see
// recordJobRun). Writes one file, to CALIBRATION_REPORT_PATH (default
// below). Issues no Supabase row-removal call anywhere in this file.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'
import { PREMIER_LEAGUE_COMPETITION } from './lib/competition.ts'
import type { DefensiveActionStats, Position } from '../src/lib/scoring/types.ts'
import { DEFENDER, FORWARD, GOALKEEPER, MIDFIELDER } from '../src/lib/scoring/types.ts'
import { defensiveContributionPoints } from '../src/lib/scoring/defensiveContribution.ts'
import { goalkeeperSavePoints } from '../src/lib/scoring/goalkeeperSaves.ts'
import { totalMatchPoints, type MatchPointComponents } from '../src/lib/scoring/totalMatchPoints.ts'
import {
  APPEARANCE_POINTS_60_PLUS,
  APPEARANCE_POINTS_UNDER_60,
  ASSIST_POINTS,
  GOALS_CONCEDED_DIVISOR,
  GOALS_CONCEDED_POINTS_PER_UNIT,
  cleanSheetPoints,
  goalPoints,
  goalsConcededPointsApply,
  savePointsApply,
} from '../src/lib/projection/pointValues.ts'

const JOB_NAME = 'calibration-report'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'
const PLAYER_MATCH_STATS_MIGRATION = 'supabase/migrations/20260811170000_player_match_stats.sql'
const PLAYER_PROJECTIONS_MIGRATION = 'supabase/migrations/20260815120000_player_projections.sql'

/**
 * Must match scripts/project-points.ts's own MODEL_VERSION — duplicated,
 * not imported, matching the convention scripts/emit-projections-csv.ts's
 * file header documents: each scripts/*.ts job is a standalone entry point,
 * src/lib/ is the one blessed cross-script import boundary. This job filters
 * player_projections to this one version so a future model written
 * alongside 'baseline-v1' does not silently double the sample.
 */
export const MODEL_VERSION = 'baseline-v1'

/**
 * Must match scripts/ingest-core-insights.ts's own DEFAULT_SEASON —
 * duplicated for the same reason as MODEL_VERSION above. player_match_stats
 * holds only this one season today (docs/projection-model-backlog.md G6),
 * but filtering explicitly rather than reading the whole table unfiltered
 * means a future second season ingested into the same table cannot silently
 * widen this report's sample without anyone deciding it should.
 */
export const TARGET_SEASON = '2025-2026'

const DEFAULT_REPORT_PATH = './out/calibration-report.md'

/** Top-N players per position shown in the distribution tables — cheap and, per the ticket Notes, likely the most useful single table in the report. */
const TOP_N_PLAYERS = 20

/**
 * The FPL bonus system's known 3/2/1 structure — the top three BPS scorers
 * in a match earn 3, 2 and 1 bonus points. Used ONLY to state a rough
 * "bonus is worth about this much per player-appearance on average" figure
 * in the report's caveats section (6 bonus points shared among the ~22
 * players who appear in a match). NOT derived from any data this job reads,
 * and NOT added to any point total — see the file header's Bonus and cards
 * section.
 */
const BONUS_POINTS_PER_MATCH_TOTAL = 3 + 2 + 1
/** 11 players per side, 2 sides. */
const PLAYERS_ON_PITCH_PER_MATCH = 22

const POSITIONS: readonly Position[] = [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD]
const POSITION_NAMES: Readonly<Record<Position, string>> = {
  1: 'Goalkeeper',
  2: 'Defender',
  3: 'Midfielder',
  4: 'Forward',
}
const POSITION_ABBREVIATIONS: Readonly<Record<Position, string>> = {
  1: 'GK',
  2: 'DEF',
  3: 'MID',
  4: 'FWD',
}

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

function readReportPath(): string {
  return process.env.CALIBRATION_REPORT_PATH ?? DEFAULT_REPORT_PATH
}

// ============================================================================
// Errors
// ============================================================================

export class CalibrationReportError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'CalibrationReportError'
    this.context = context
  }
}

interface PostgrestLikeError {
  code?: string
  message?: string
}

// Same PGRST205 / 42P01 recognition as every other job in scripts/.
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
  details: JsonRecord | null
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
// Pure computation — reconstruction. No I/O, unit-testable against fixed
// fixtures with no database. See the file header for the rule this section
// follows: defcon and saves come from src/lib/scoring/'s own functions,
// point VALUES come from src/lib/projection/pointValues.ts, nothing is
// reimplemented.
// ============================================================================

/** The subset of a player_match_stats row this job needs, with nulls exactly as Postgres/PostgREST returns them for an unplayed or partially-recorded match. */
export interface ActualMatchStatsInput {
  minutesPlayed: number | null
  goals: number | null
  assists: number | null
  goalsConceded: number | null
  saves: number | null
  clearances: number | null
  blocks: number | null
  interceptions: number | null
  tackles: number | null
  recoveries: number | null
}

/** The seven point components this report compares actual against projected — appearance, goals, assists, clean sheets, goals conceded, saves, defensive contribution. Deliberately excludes bonus/cards from this per-component breakdown: the actual side has no data for either (see file header), and since ticket #78 the projected side's bonus is no longer 0 either, so a ratio row here would compare a real number against an always-missing one rather than divide by zero. Both stay covered as text in the report's caveats instead. */
export interface ComponentTotals {
  appearancePoints: number
  goalPoints: number
  assistPoints: number
  cleanSheetPoints: number
  goalsConcededPoints: number
  savePoints: number
  defensiveContributionPoints: number
}

export function emptyComponentTotals(): ComponentTotals {
  return {
    appearancePoints: 0,
    goalPoints: 0,
    assistPoints: 0,
    cleanSheetPoints: 0,
    goalsConcededPoints: 0,
    savePoints: 0,
    defensiveContributionPoints: 0,
  }
}

export interface ReconstructedMatch {
  minutes: number
  /** Full 12-field breakdown, exactly as totalMatchPoints() consumed it — kept for totalPoints' provenance, even though only the 7 ComponentTotals fields are reported per-component. */
  fullComponents: MatchPointComponents
  components: ComponentTotals
  totalPoints: number
}

/**
 * Reconstructs one player-match's actual FPL points. Appearance: 1 point for
 * 1-59 minutes, 2 for 60+, 0 for zero minutes (a zero-minute row scores 0
 * here and is excluded from per-appearance means by the aggregator below —
 * see its named test). Clean sheet: goals conceded = 0 AND minutes >= 60,
 * at whatever value CLEAN_SHEET_POINTS gives this position (0 for forwards,
 * by table, so no separate forward gate is needed here). Goals-conceded and
 * save points apply only to the positions pointValues.ts says they apply to
 * (GK/DEF for goals-conceded, GK only for saves) — gated with that module's
 * own predicates, not a locally re-derived position check.
 */
export function reconstructActualMatchPoints(position: Position, stats: ActualMatchStatsInput): ReconstructedMatch {
  const minutes = stats.minutesPlayed ?? 0
  const goals = stats.goals ?? 0
  const assists = stats.assists ?? 0
  const goalsConceded = stats.goalsConceded ?? 0
  const saves = stats.saves ?? 0

  const defconStats: DefensiveActionStats = {
    clearances: stats.clearances ?? 0,
    blocks: stats.blocks ?? 0,
    interceptions: stats.interceptions ?? 0,
    tackles: stats.tackles ?? 0,
    recoveries: stats.recoveries ?? 0,
  }

  const appearancePoints = minutes === 0 ? 0 : minutes < 60 ? APPEARANCE_POINTS_UNDER_60 : APPEARANCE_POINTS_60_PLUS
  const isCleanSheet = minutes >= 60 && goalsConceded === 0

  const components: ComponentTotals = {
    appearancePoints,
    goalPoints: goals * goalPoints(position),
    assistPoints: assists * ASSIST_POINTS,
    cleanSheetPoints: isCleanSheet ? cleanSheetPoints(position) : 0,
    goalsConcededPoints: goalsConcededPointsApply(position)
      ? Math.floor(goalsConceded / GOALS_CONCEDED_DIVISOR) * GOALS_CONCEDED_POINTS_PER_UNIT
      : 0,
    savePoints: savePointsApply(position) ? goalkeeperSavePoints(saves) : 0,
    defensiveContributionPoints: defensiveContributionPoints(position, defconStats),
  }

  const fullComponents: MatchPointComponents = {
    ...components,
    penaltySavePoints: 0,
    penaltyMissPoints: 0,
    yellowCardPoints: 0,
    redCardPoints: 0,
    ownGoalPoints: 0,
    bonusPoints: 0,
  }

  return { minutes, fullComponents, components, totalPoints: totalMatchPoints(fullComponents) }
}

// ============================================================================
// Pure computation — aggregation by position. No I/O, unit-testable.
// ============================================================================

function addComponents(a: ComponentTotals, b: ComponentTotals): ComponentTotals {
  return {
    appearancePoints: a.appearancePoints + b.appearancePoints,
    goalPoints: a.goalPoints + b.goalPoints,
    assistPoints: a.assistPoints + b.assistPoints,
    cleanSheetPoints: a.cleanSheetPoints + b.cleanSheetPoints,
    goalsConcededPoints: a.goalsConcededPoints + b.goalsConcededPoints,
    savePoints: a.savePoints + b.savePoints,
    defensiveContributionPoints: a.defensiveContributionPoints + b.defensiveContributionPoints,
  }
}

export function sumComponents(list: readonly ComponentTotals[]): ComponentTotals {
  return list.reduce(addComponents, emptyComponentTotals())
}

/** Scales a components total to a per-90-minutes rate. Null when totalMinutes is 0 — "no data", not "zero rate". */
export function componentsPer90(totals: ComponentTotals, totalMinutes: number): ComponentTotals | null {
  if (totalMinutes <= 0) return null
  const scale = 90 / totalMinutes
  return {
    appearancePoints: totals.appearancePoints * scale,
    goalPoints: totals.goalPoints * scale,
    assistPoints: totals.assistPoints * scale,
    cleanSheetPoints: totals.cleanSheetPoints * scale,
    goalsConcededPoints: totals.goalsConcededPoints * scale,
    savePoints: totals.savePoints * scale,
    defensiveContributionPoints: totals.defensiveContributionPoints * scale,
  }
}

export interface ActualAggregationInput {
  position: Position
  playerCode: number | null
  minutes: number
  totalPoints: number
  components: ComponentTotals
}

export interface PositionActualAggregate {
  position: Position
  playerMatchCount: number
  /** Player-matches with minutes > 0 — the denominator for meanPointsPerAppearance, per the ticket's named "zero-minute rows excluded" requirement. */
  appearanceCount: number
  distinctPlayerCount: number
  totalMinutes: number
  totalPoints: number
  meanPointsPerAppearance: number | null
  meanPointsPer90: number | null
  componentTotals: ComponentTotals
  componentPer90: ComponentTotals | null
}

/**
 * Aggregates reconstructed actual matches by position. Zero-minute rows
 * ARE counted in playerMatchCount and totalMinutes/totalPoints/per-90 (they
 * contribute 0 to each, correctly) but are EXCLUDED from appearanceCount and
 * meanPointsPerAppearance — see this file's test for the named case this
 * covers.
 */
export function aggregateActualByPosition(
  records: readonly ActualAggregationInput[],
): Record<Position, PositionActualAggregate> {
  const result = {} as Record<Position, PositionActualAggregate>

  for (const position of POSITIONS) {
    const forPosition = records.filter((r) => r.position === position)
    const appearances = forPosition.filter((r) => r.minutes > 0)
    const totalMinutes = forPosition.reduce((sum, r) => sum + r.minutes, 0)
    const totalPoints = forPosition.reduce((sum, r) => sum + r.totalPoints, 0)
    const componentTotals = sumComponents(forPosition.map((r) => r.components))
    const distinctPlayerCount = new Set(forPosition.map((r) => r.playerCode).filter((c): c is number => c !== null)).size

    result[position] = {
      position,
      playerMatchCount: forPosition.length,
      appearanceCount: appearances.length,
      distinctPlayerCount,
      totalMinutes,
      totalPoints,
      meanPointsPerAppearance:
        appearances.length > 0 ? appearances.reduce((sum, r) => sum + r.totalPoints, 0) / appearances.length : null,
      meanPointsPer90: totalMinutes > 0 ? (totalPoints / totalMinutes) * 90 : null,
      componentTotals,
      componentPer90: componentsPer90(componentTotals, totalMinutes),
    }
  }

  return result
}

export interface ProjectedAggregationInput {
  position: Position
  playerId: number
  expectedPoints: number
  expectedMinutes: number
  components: ComponentTotals
}

export interface PositionProjectedAggregate {
  position: Position
  rowCount: number
  distinctPlayerCount: number
  totalExpectedMinutes: number
  totalExpectedPoints: number
  meanPointsPer90: number | null
  componentPer90: ComponentTotals | null
}

/** Aggregates stored player_projections rows by position — same per-90 shape as the actual side, so the two are directly comparable. */
export function aggregateProjectedByPosition(
  records: readonly ProjectedAggregationInput[],
): Record<Position, PositionProjectedAggregate> {
  const result = {} as Record<Position, PositionProjectedAggregate>

  for (const position of POSITIONS) {
    const forPosition = records.filter((r) => r.position === position)
    const totalExpectedMinutes = forPosition.reduce((sum, r) => sum + r.expectedMinutes, 0)
    const totalExpectedPoints = forPosition.reduce((sum, r) => sum + r.expectedPoints, 0)
    const componentTotals = sumComponents(forPosition.map((r) => r.components))

    result[position] = {
      position,
      rowCount: forPosition.length,
      distinctPlayerCount: new Set(forPosition.map((r) => r.playerId)).size,
      totalExpectedMinutes,
      totalExpectedPoints,
      meanPointsPer90: totalExpectedMinutes > 0 ? (totalExpectedPoints / totalExpectedMinutes) * 90 : null,
      componentPer90: componentsPer90(componentTotals, totalExpectedMinutes),
    }
  }

  return result
}

/** projected / actual, by position — null (not a divide-by-zero) whenever either side has no data. */
export function ratio(projectedPer90: number | null, actualPer90: number | null): number | null {
  if (projectedPer90 === null || actualPer90 === null || actualPer90 === 0) return null
  return projectedPer90 / actualPer90
}

// ============================================================================
// Top-N distribution tables — pure, small, not independently tested (not a
// DoD item), but kept out of main() for the same reason as the aggregators.
// ============================================================================

export interface PlayerActualTotal {
  playerCode: number
  webName: string
  position: Position
  totalPoints: number
  matchCount: number
}

export function topActualScorersByPosition(
  totals: readonly PlayerActualTotal[],
  n: number,
): Record<Position, PlayerActualTotal[]> {
  const result = {} as Record<Position, PlayerActualTotal[]>
  for (const position of POSITIONS) {
    result[position] = totals
      .filter((t) => t.position === position)
      .sort((a, b) => b.totalPoints - a.totalPoints)
      .slice(0, n)
  }
  return result
}

export interface PlayerProjectedMean {
  playerId: number
  webName: string
  position: Position
  meanExpectedPoints: number
  rowCount: number
}

export function topProjectedPlayersByPosition(
  means: readonly PlayerProjectedMean[],
  n: number,
): Record<Position, PlayerProjectedMean[]> {
  const result = {} as Record<Position, PlayerProjectedMean[]>
  for (const position of POSITIONS) {
    result[position] = means
      .filter((m) => m.position === position)
      .sort((a, b) => b.meanExpectedPoints - a.meanExpectedPoints)
      .slice(0, n)
  }
  return result
}

// ============================================================================
// Formatting helpers for the markdown report.
// ============================================================================

function fmt(n: number | null, decimals = 2): string {
  return n === null ? 'n/a' : n.toFixed(decimals)
}

function fmtRatio(r: number | null): string {
  return r === null ? 'n/a' : `${r.toFixed(2)}x`
}

function componentRow(label: string, actual: ComponentTotals | null, projected: ComponentTotals | null, key: keyof ComponentTotals): string {
  const a = actual ? actual[key] : null
  const p = projected ? projected[key] : null
  return `| ${label} | ${fmt(a)} | ${fmt(p)} | ${fmtRatio(ratio(p, a))} |`
}

// ============================================================================
// Row shapes read from Supabase — only the fields this job uses.
// ============================================================================

interface PlayerRow {
  id: number
  code: number | null
  element_type: number
  web_name: string
}

interface MatchStatsRow {
  player_code: number | null
  minutes_played: number | null
  goals: number | null
  assists: number | null
  goals_conceded: number | null
  saves: number | null
  clearances: number | null
  blocks: number | null
  interceptions: number | null
  tackles: number | null
  recoveries: number | null
}

interface ProjectionPointsJson {
  appearancePoints?: number
  goalPoints?: number
  assistPoints?: number
  cleanSheetPoints?: number
  goalsConcededPoints?: number
  savePoints?: number
  defensiveContributionPoints?: number
  bonusPoints?: number
}

interface ProjectionRow {
  gameweek_id: number
  player_id: number
  expected_points: number
  expected_minutes: number
  components: { points?: ProjectionPointsJson } | null
}

function pickProjectedComponents(points: ProjectionPointsJson | undefined): ComponentTotals {
  return {
    appearancePoints: points?.appearancePoints ?? 0,
    goalPoints: points?.goalPoints ?? 0,
    assistPoints: points?.assistPoints ?? 0,
    cleanSheetPoints: points?.cleanSheetPoints ?? 0,
    goalsConcededPoints: points?.goalsConcededPoints ?? 0,
    savePoints: points?.savePoints ?? 0,
    defensiveContributionPoints: points?.defensiveContributionPoints ?? 0,
  }
}

// ============================================================================
// Report generation.
// ============================================================================

interface ReportData {
  generatedAt: Date
  actualByPosition: Record<Position, PositionActualAggregate>
  projectedByPosition: Record<Position, PositionProjectedAggregate>
  topActual: Record<Position, PlayerActualTotal[]>
  topProjected: Record<Position, PlayerProjectedMean[]>
  skippedMatchStatsNoPosition: number
  skippedProjectionsNoPosition: number
  playersRowCount: number
  matchStatsRowCount: number
  projectionRowCount: number
  /** Ticket #54: player_match_stats rows for TARGET_SEASON whose competition was a known non-Premier-League value — excluded from the actual side, counted separately from a null competition below. */
  matchStatsRowsExcludedNonPremierLeague: number
  /** Ticket #54: player_match_stats rows for TARGET_SEASON whose competition was NULL (not yet re-stamped since the #54 migration added the column) — excluded and counted separately from a known non-Premier-League value above. */
  matchStatsRowsExcludedNullCompetition: number
}

function averageBonusPerAppearance(): number {
  return BONUS_POINTS_PER_MATCH_TOTAL / PLAYERS_ON_PITCH_PER_MATCH
}

function defenderHeadline(
  actual: Record<Position, PositionActualAggregate>,
  projected: Record<Position, PositionProjectedAggregate>,
): string {
  const actualDef = actual[DEFENDER].meanPointsPer90
  const actualMid = actual[MIDFIELDER].meanPointsPer90
  const actualFwd = actual[FORWARD].meanPointsPer90
  const projDef = projected[DEFENDER].meanPointsPer90
  const projMid = projected[MIDFIELDER].meanPointsPer90
  const projFwd = projected[FORWARD].meanPointsPer90

  const projAboveBoth = projDef !== null && projMid !== null && projFwd !== null && projDef > projMid && projDef > projFwd
  const actualAboveBoth =
    actualDef !== null && actualMid !== null && actualFwd !== null && actualDef > actualMid && actualDef > actualFwd

  return (
    `**Projected:** defenders ${fmt(projDef)} pts/90 vs midfielders ${fmt(projMid)} and forwards ${fmt(projFwd)} ` +
    `— defenders projected above both: **${projAboveBoth ? 'yes' : 'no'}**. ` +
    `**Actual (2025/26):** defenders ${fmt(actualDef)} pts/90 vs midfielders ${fmt(actualMid)} and forwards ${fmt(actualFwd)} ` +
    `— defenders actually scored above both: **${actualAboveBoth ? 'yes' : 'no'}**.`
  )
}

function buildPositionTable(
  actual: Record<Position, PositionActualAggregate>,
  projected: Record<Position, PositionProjectedAggregate>,
): string {
  const header =
    '| Position | Actual pts/appearance (n) | Actual pts/90 (matches, players) | Projected pts/90 (rows, players) | Ratio (proj/actual) |\n' +
    '|---|---|---|---|---|'
  const rows = POSITIONS.map((position) => {
    const a = actual[position]
    const p = projected[position]
    const actualAppearanceCell = `${fmt(a.meanPointsPerAppearance)} (n=${a.appearanceCount})`
    const actualPer90Cell = `${fmt(a.meanPointsPer90)} (${a.playerMatchCount} matches, ${a.distinctPlayerCount} players)`
    const projPer90Cell = `${fmt(p.meanPointsPer90)} (${p.rowCount} rows, ${p.distinctPlayerCount} players)`
    return `| ${POSITION_NAMES[position]} | ${actualAppearanceCell} | ${actualPer90Cell} | ${projPer90Cell} | ${fmtRatio(ratio(p.meanPointsPer90, a.meanPointsPer90))} |`
  })
  return [header, ...rows].join('\n')
}

function buildComponentTable(
  actual: Record<Position, PositionActualAggregate>,
  projected: Record<Position, PositionProjectedAggregate>,
): string {
  const componentLabels: Array<[keyof ComponentTotals, string]> = [
    ['appearancePoints', 'Appearance'],
    ['goalPoints', 'Goals'],
    ['assistPoints', 'Assists'],
    ['cleanSheetPoints', 'Clean sheets'],
    ['goalsConcededPoints', 'Goals conceded'],
    ['savePoints', 'Saves'],
    ['defensiveContributionPoints', 'Defensive contribution'],
  ]
  const sections = POSITIONS.map((position) => {
    const a = actual[position]
    const p = projected[position]
    // Sample size stated once per position, ahead of every component row it
    // covers — DoD: "every figure in the report carries its sample size."
    const sampleSizeLine =
      `*Sample: ${a.playerMatchCount} actual player-matches (${a.appearanceCount} with minutes played, ${a.distinctPlayerCount} distinct players) ` +
      `vs ${p.rowCount} projected rows (${p.distinctPlayerCount} distinct players).*`
    const header = `### ${POSITION_NAMES[position]}\n\n${sampleSizeLine}\n\n| Component | Actual pts/90 | Projected pts/90 | Ratio (proj/actual) |\n|---|---|---|---|`
    const rows = componentLabels.map(([key, label]) => componentRow(label, a.componentPer90, p.componentPer90, key))
    return [header, ...rows].join('\n')
  })
  return sections.join('\n\n')
}

function buildTopTable(title: string, actualRows: PlayerActualTotal[], projectedRows: PlayerProjectedMean[]): string {
  const actualHeader = `**Top ${actualRows.length} actual scorers (2025/26, total points)**\n\n| # | Player | Total pts | Matches |\n|---|---|---|---|`
  const actualBody = actualRows
    .map((r, i) => `| ${i + 1} | ${r.webName} | ${r.totalPoints} | ${r.matchCount} |`)
    .join('\n')
  const projHeader = `**Top ${projectedRows.length} projected players (baseline-v1, mean expected points)**\n\n| # | Player | Mean expected pts | Rows |\n|---|---|---|---|`
  const projBody = projectedRows
    .map((r, i) => `| ${i + 1} | ${r.webName} | ${fmt(r.meanExpectedPoints)} | ${r.rowCount} |`)
    .join('\n')
  return `#### ${title}\n\n${actualHeader}\n${actualBody || '| — | (none) | — | — |'}\n\n${projHeader}\n${projBody || '| — | (none) | — | — |'}`
}

function generateReportMarkdown(data: ReportData): string {
  const avgBonus = averageBonusPerAppearance()

  const sections: string[] = []

  sections.push(
    '# Baseline projection calibration report\n\n' +
      `Generated: ${data.generatedAt.toISOString()} · Job: \`${JOB_NAME}\` · Model version: \`${MODEL_VERSION}\` · ` +
      `Actuals season: \`${TARGET_SEASON}\`\n\n` +
      'This report measures the baseline-v1 projection model against last season\'s actual results. ' +
      '**It does not change the model.** See `docs/projection-model-backlog.md` and `product-brief.md` §6d.',
  )

  sections.push(
    '## Why this comparison is imperfect\n\n' +
      '**Directional evidence, not a verdict** — three reasons:\n\n' +
      `1. **Different seasons, mostly different players.** \`player_match_stats\` holds ${TARGET_SEASON} match data; ` +
      `\`player_projections\` holds \`${MODEL_VERSION}\`'s 2026/27 output. This is a *distributional* comparison — does a defender ` +
      'score about this many points per 90 and does a forward score about that many — not a player-for-player check. ' +
      'This is not a point-in-time backtest (feature item 29); it uses full-season hindsight on both sides, which is invalid for ' +
      'judging any one prediction but fine for judging a position-level distribution.\n' +
      `2. **${TARGET_SEASON} was played under the PREVIOUS BPS rules.** The 2026/27 BPS rebalance (CBI at 1 per 3 actions instead ` +
      'of 2, the tackled penalty removed, revised goalkeeper save BPS) changes who earns bonus. The actual side below still ' +
      'cannot see bonus at all regardless of which rules apply — see point 3.\n' +
      '3. **The actual side has no bonus or cards data; the projected side now has projected bonus (ticket #78), so the two are ' +
      'NOT on the same basis any more.** `player_match_stats` carries neither bonus nor cards, so the actual figures below are ' +
      `an **under-count**. The FPL bonus system awards ${BONUS_POINTS_PER_MATCH_TOTAL} points (3/2/1) to three players out of ` +
      `the ~${PLAYERS_ON_PITCH_PER_MATCH} who appear in a match — roughly **${avgBonus.toFixed(2)} points per player-appearance ` +
      'on average**, concentrated among a match\'s standout performers rather than spread evenly, so this under-count is larger ' +
      'for the top of the distribution (the Top-20 tables below) than for the position means. The projected side is DIFFERENT: ' +
      'since ticket #78, `scripts/project-points.ts` allocates a projected bonus share into `player_projections.expected_points` ' +
      '(the totals and Top-20 tables below read that figure), computed from expected BPS above a bare-appearance baseline — a ' +
      'proportional share, not a simulated BPS ranking, and still not validated against any real bonus or BPS figure (nothing in ' +
      'the database records either — see `docs/projection-model-backlog.md` G3). Cards remain unmodelled on both sides. The ' +
      '**By point component** table below is unaffected by this asymmetry: it omits bonus/cards entirely (see its own note).',
  )

  sections.push('## Headline: are defenders over-projected?\n\n' + defenderHeadline(data.actualByPosition, data.projectedByPosition))

  sections.push(
    '## By position: totals\n\n' +
      'Every figure carries its sample size in parentheses.\n\n' +
      buildPositionTable(data.actualByPosition, data.projectedByPosition),
  )

  sections.push(
    '## By point component\n\n' +
      'Per-90 rates, actual vs projected, so a gap in the totals above is attributable to a specific component rather than only ' +
      'visible in aggregate. Bonus and cards are omitted from this table: the actual side is fixed at exactly 0 for both (no data), ' +
      'and the projected side\'s bonus (non-zero since ticket #78) has no actual-side counterpart to compare it against here — see ' +
      'the caveats above for how the totals tables elsewhere in this report are affected instead.\n\n' +
      buildComponentTable(data.actualByPosition, data.projectedByPosition),
  )

  const topSections = POSITIONS.map((position) =>
    buildTopTable(POSITION_NAMES[position], data.topActual[position], data.topProjected[position]),
  )
  sections.push(
    '## Distributions: top scorers vs top projections, by position\n\n' +
      'A mean can match while the spread is wrong, and the spread is what drives a recommendation — the captain is by definition ' +
      'the highest-projected player. These are independent rankings (2025/26 actual total points vs baseline-v1 mean expected ' +
      'points per player), not paired by player.\n\n' +
      topSections.join('\n\n'),
  )

  sections.push(
    '## What this bears on, in `docs/projection-model-backlog.md`\n\n' +
      '- **G3 (bonus):** addressed by ticket #78 — the projected side\'s totals now include a projected bonus share, so this ' +
      'report\'s numbers speak to it differently than before: see the caveats section above for why the two sides are no longer ' +
      'on the same basis, and the rough per-appearance bonus figure for how large the actual side\'s remaining under-count is.\n' +
      `- **G6 (last season's behaviour under this season's rules):** this report is itself an instance of the residual risk G6 ` +
      'names — the actual side is scored under 2026/27 rules applied to 2025/26 raw actions, exactly as `src/lib/scoring/` is built to do, ' +
      'but the *behaviour* that produced those raw actions was not shaped by 2026/27 incentives.\n' +
      '- **G1 (goalkeeper saves not fixture-scaled) and G2 (45% of players have no history):** this report does not test either — ' +
      'G1 needs a fixture-level breakdown this position-level comparison does not do, and G2 is about which players get a signal ' +
      'at all, not about the calibration of the signal players do have. Not confirmed or refuted here.',
  )

  sections.push(
    '## Sample sizes and data provenance\n\n' +
      `- players rows fetched: ${data.playersRowCount}\n` +
      `- player_match_stats rows fetched (season=${TARGET_SEASON}, competition=${PREMIER_LEAGUE_COMPETITION}): ${data.matchStatsRowCount}\n` +
      `- player_match_stats rows excluded as non-Premier-League (season=${TARGET_SEASON}, competition known and != ${PREMIER_LEAGUE_COMPETITION}): ` +
      `${data.matchStatsRowsExcludedNonPremierLeague}\n` +
      `- player_match_stats rows excluded for a null competition (season=${TARGET_SEASON}, not yet re-stamped since ticket #54): ` +
      `${data.matchStatsRowsExcludedNullCompetition}\n` +
      `- player_match_stats rows skipped (no player_code, or player_code not found in players): ${data.skippedMatchStatsNoPosition}\n` +
      `- player_projections rows fetched (model_version=${MODEL_VERSION}): ${data.projectionRowCount}\n` +
      `- player_projections rows skipped (player_id not found in players): ${data.skippedProjectionsNoPosition}\n`,
  )

  return sections.join('\n\n') + '\n'
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
  const reportPath = readReportPath()
  const supabase = createClient(env.url, env.secretKey)

  try {
    // --------------------------------------------------------------------
    // 1. players — needed to resolve position for both sides' joins.
    //    Paginated and count-verified, matching every other job's read of
    //    this table (see scripts/lib/paginate.ts's file header for the bug
    //    this guards against).
    // --------------------------------------------------------------------
    const {
      rows: playerRows,
      error: playersError,
      pages: playersPagesFetched,
    } = await fetchAllPages<PlayerRow>((from, to) =>
      supabase.from('players').select('id, code, element_type, web_name').range(from, to).returns<PlayerRow[]>(),
    )
    if (playersError) {
      if (isMissingTable(playersError, 'players')) {
        throw new CalibrationReportError(`the "players" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'players')
      }
      throw new CalibrationReportError(`players lookup failed: ${playersError.message}`, 'players')
    }
    if (playerRows.length === 0) {
      throw new CalibrationReportError(
        'the players table is empty. Run scripts/ingest-fpl.ts before running the calibration report.',
        'players',
      )
    }
    const { count: playersRowsExpectedByCount, error: playersCountError } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true })
    if (playersCountError) {
      throw new CalibrationReportError(`players count check failed: ${playersCountError.message}`, 'players')
    }
    assertRowCountMatches('players', playerRows.length, playersRowsExpectedByCount ?? 0)

    const codeToPosition = new Map<number, Position>()
    const codeToWebName = new Map<number, string>()
    const idToPosition = new Map<number, Position>()
    const idToWebName = new Map<number, string>()
    for (const player of playerRows) {
      const position = player.element_type as Position
      idToPosition.set(player.id, position)
      idToWebName.set(player.id, player.web_name)
      if (player.code !== null) {
        codeToPosition.set(player.code, position)
        codeToWebName.set(player.code, player.web_name)
      }
    }

    // --------------------------------------------------------------------
    // 2. player_match_stats, filtered to TARGET_SEASON AND to Premier League
    //    rows only (ticket #54 — see file header). Over 15,000 rows in the
    //    live table — well past the 1,000-row db-max-rows ceiling. Paginated
    //    and count-verified against the SAME filter (both filters, on both
    //    queries).
    // --------------------------------------------------------------------
    const {
      rows: matchStatsRows,
      error: matchStatsError,
      pages: matchStatsPagesFetched,
    } = await fetchAllPages<MatchStatsRow>((from, to) =>
      supabase
        .from('player_match_stats')
        .select(
          'player_code, minutes_played, goals, assists, goals_conceded, saves, clearances, blocks, interceptions, tackles, recoveries',
        )
        .eq('season', TARGET_SEASON)
        .eq('competition', PREMIER_LEAGUE_COMPETITION)
        .range(from, to)
        .returns<MatchStatsRow[]>(),
    )
    if (matchStatsError) {
      if (isMissingTable(matchStatsError, 'player_match_stats')) {
        throw new CalibrationReportError(
          `the "player_match_stats" table does not exist. Apply ${PLAYER_MATCH_STATS_MIGRATION} first.`,
          'player_match_stats',
        )
      }
      throw new CalibrationReportError(`player_match_stats lookup failed: ${matchStatsError.message}`, 'player_match_stats')
    }
    const { count: matchStatsRowsExpectedByCount, error: matchStatsCountError } = await supabase
      .from('player_match_stats')
      .select('*', { count: 'exact', head: true })
      .eq('season', TARGET_SEASON)
      .eq('competition', PREMIER_LEAGUE_COMPETITION)
    if (matchStatsCountError) {
      throw new CalibrationReportError(`player_match_stats count check failed: ${matchStatsCountError.message}`, 'player_match_stats')
    }
    assertRowCountMatches('player_match_stats', matchStatsRows.length, matchStatsRowsExpectedByCount ?? 0)

    // Exclusion counts — informational only, scoped to TARGET_SEASON like
    // the read above, never used to filter anything. Two independent
    // count-only queries so a null competition (not yet re-stamped since the
    // #54 migration added the column) is reported separately from a known
    // non-Premier-League competition, per the ticket's robustness requirement.
    const { count: matchStatsRowsNullCompetition, error: nullCompetitionError } = await supabase
      .from('player_match_stats')
      .select('*', { count: 'exact', head: true })
      .eq('season', TARGET_SEASON)
      .is('competition', null)
    if (nullCompetitionError) {
      throw new CalibrationReportError(
        `player_match_stats null-competition count check failed: ${nullCompetitionError.message}`,
        'player_match_stats',
      )
    }

    const { count: matchStatsRowsExcludedNonPremierLeague, error: nonPremierLeagueError } = await supabase
      .from('player_match_stats')
      .select('*', { count: 'exact', head: true })
      .eq('season', TARGET_SEASON)
      .not('competition', 'is', null)
      .neq('competition', PREMIER_LEAGUE_COMPETITION)
    if (nonPremierLeagueError) {
      throw new CalibrationReportError(
        `player_match_stats non-Premier-League count check failed: ${nonPremierLeagueError.message}`,
        'player_match_stats',
      )
    }

    // --------------------------------------------------------------------
    // 3. player_projections, filtered to MODEL_VERSION. Same pagination +
    //    count-verification discipline.
    // --------------------------------------------------------------------
    const {
      rows: projectionRows,
      error: projectionsError,
      pages: projectionsPagesFetched,
    } = await fetchAllPages<ProjectionRow>((from, to) =>
      supabase
        .from('player_projections')
        .select('gameweek_id, player_id, expected_points, expected_minutes, components')
        .eq('model_version', MODEL_VERSION)
        .range(from, to)
        .returns<ProjectionRow[]>(),
    )
    if (projectionsError) {
      if (isMissingTable(projectionsError, 'player_projections')) {
        throw new CalibrationReportError(
          `the "player_projections" table does not exist. Apply ${PLAYER_PROJECTIONS_MIGRATION} first.`,
          'player_projections',
        )
      }
      throw new CalibrationReportError(`player_projections lookup failed: ${projectionsError.message}`, 'player_projections')
    }
    const { count: projectionRowsExpectedByCount, error: projectionsCountError } = await supabase
      .from('player_projections')
      .select('*', { count: 'exact', head: true })
      .eq('model_version', MODEL_VERSION)
    if (projectionsCountError) {
      throw new CalibrationReportError(`player_projections count check failed: ${projectionsCountError.message}`, 'player_projections')
    }
    assertRowCountMatches('player_projections', projectionRows.length, projectionRowsExpectedByCount ?? 0)

    // --------------------------------------------------------------------
    // 4. Empty-table guard — DoD: exits ZERO with a named message, writes
    //    no report, rather than producing a report full of zeroes.
    // --------------------------------------------------------------------
    if (matchStatsRows.length === 0 || projectionRows.length === 0) {
      const emptyTables = [
        matchStatsRows.length === 0 ? 'player_match_stats' : null,
        projectionRows.length === 0 ? 'player_projections' : null,
      ].filter((t): t is string => t !== null)
      const message =
        `${JOB_NAME}: ${emptyTables.join(' and ')} ${emptyTables.length > 1 ? 'are' : 'is'} empty ` +
        `(season=${TARGET_SEASON} for player_match_stats, model_version=${MODEL_VERSION} for player_projections). ` +
        'Nothing to calibrate — writing no report. Run scripts/ingest-core-insights.ts and/or scripts/project-points.ts first.'
      console.log(message)
      await recordJobRun(supabase, {
        status: 'skipped',
        message,
        details: { matchStatsRowCount: matchStatsRows.length, projectionRowCount: projectionRows.length },
        startedAt,
      })
      process.exit(0)
      return
    }

    // --------------------------------------------------------------------
    // 5. Reconstruct actual points. Position via player_code = players.code
    //    ONLY — see file header. A row with no player_code, or a
    //    player_code not present in the current players table, is skipped
    //    and counted (this file selects no player_id from player_match_stats
    //    at all, so falling back to id-matching is not possible here even
    //    by accident).
    // --------------------------------------------------------------------
    let skippedMatchStatsNoPosition = 0
    const actualInputs: ActualAggregationInput[] = []
    const actualPlayerTotals = new Map<number, PlayerActualTotal>()

    for (const row of matchStatsRows) {
      const position = row.player_code !== null ? codeToPosition.get(row.player_code) : undefined
      if (position === undefined || row.player_code === null) {
        skippedMatchStatsNoPosition++
        continue
      }

      const reconstructed = reconstructActualMatchPoints(position, {
        minutesPlayed: row.minutes_played,
        goals: row.goals,
        assists: row.assists,
        goalsConceded: row.goals_conceded,
        saves: row.saves,
        clearances: row.clearances,
        blocks: row.blocks,
        interceptions: row.interceptions,
        tackles: row.tackles,
        recoveries: row.recoveries,
      })

      actualInputs.push({
        position,
        playerCode: row.player_code,
        minutes: reconstructed.minutes,
        totalPoints: reconstructed.totalPoints,
        components: reconstructed.components,
      })

      const existing = actualPlayerTotals.get(row.player_code)
      if (existing) {
        existing.totalPoints += reconstructed.totalPoints
        existing.matchCount += 1
      } else {
        actualPlayerTotals.set(row.player_code, {
          playerCode: row.player_code,
          webName: codeToWebName.get(row.player_code) ?? `code:${row.player_code}`,
          position,
          totalPoints: reconstructed.totalPoints,
          matchCount: 1,
        })
      }
    }

    const actualByPosition = aggregateActualByPosition(actualInputs)

    // --------------------------------------------------------------------
    // 6. Projected side. Position via player_id = players.id — a real FK
    //    here (see the player_projections migration's header: both sides
    //    are always the CURRENT season's freshly-ingested rows, unlike
    //    player_match_stats' historical player_id).
    // --------------------------------------------------------------------
    let skippedProjectionsNoPosition = 0
    const projectedInputs: ProjectedAggregationInput[] = []
    const projectedPlayerSums = new Map<number, { webName: string; position: Position; sum: number; count: number }>()

    for (const row of projectionRows) {
      const position = idToPosition.get(row.player_id)
      if (position === undefined) {
        skippedProjectionsNoPosition++
        continue
      }

      const components = pickProjectedComponents(row.components?.points)
      projectedInputs.push({
        position,
        playerId: row.player_id,
        expectedPoints: row.expected_points,
        expectedMinutes: row.expected_minutes,
        components,
      })

      const existing = projectedPlayerSums.get(row.player_id)
      if (existing) {
        existing.sum += row.expected_points
        existing.count += 1
      } else {
        projectedPlayerSums.set(row.player_id, {
          webName: idToWebName.get(row.player_id) ?? `id:${row.player_id}`,
          position,
          sum: row.expected_points,
          count: 1,
        })
      }
    }

    const projectedByPosition = aggregateProjectedByPosition(projectedInputs)

    // --------------------------------------------------------------------
    // 7. Top-N distribution tables.
    // --------------------------------------------------------------------
    const topActual = topActualScorersByPosition([...actualPlayerTotals.values()], TOP_N_PLAYERS)
    const projectedMeans: PlayerProjectedMean[] = [...projectedPlayerSums.entries()].map(([playerId, v]) => ({
      playerId,
      webName: v.webName,
      position: v.position,
      meanExpectedPoints: v.sum / v.count,
      rowCount: v.count,
    }))
    const topProjected = topProjectedPlayersByPosition(projectedMeans, TOP_N_PLAYERS)

    // --------------------------------------------------------------------
    // 8. Report + job_runs.
    // --------------------------------------------------------------------
    const reportData: ReportData = {
      generatedAt: new Date(),
      actualByPosition,
      projectedByPosition,
      topActual,
      topProjected,
      skippedMatchStatsNoPosition,
      skippedProjectionsNoPosition,
      playersRowCount: playerRows.length,
      matchStatsRowCount: matchStatsRows.length,
      projectionRowCount: projectionRows.length,
      matchStatsRowsExcludedNonPremierLeague: matchStatsRowsExcludedNonPremierLeague ?? 0,
      matchStatsRowsExcludedNullCompetition: matchStatsRowsNullCompetition ?? 0,
    }
    const reportMarkdown = generateReportMarkdown(reportData)

    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, reportMarkdown, 'utf8')

    const headlineRatios = Object.fromEntries(
      POSITIONS.map((position) => [
        POSITION_ABBREVIATIONS[position],
        {
          actualPointsPer90: actualByPosition[position].meanPointsPer90,
          projectedPointsPer90: projectedByPosition[position].meanPointsPer90,
          ratio: ratio(projectedByPosition[position].meanPointsPer90, actualByPosition[position].meanPointsPer90),
          actualPlayerMatches: actualByPosition[position].playerMatchCount,
          actualPlayers: actualByPosition[position].distinctPlayerCount,
          projectedRows: projectedByPosition[position].rowCount,
          projectedPlayers: projectedByPosition[position].distinctPlayerCount,
        },
      ]),
    )

    const details: JsonRecord = {
      reportPath,
      headlineRatiosByPosition: headlineRatios,
      playersRowsFetched: playerRows.length,
      playersPagesFetched,
      matchStatsRowsFetched: matchStatsRows.length,
      matchStatsPagesFetched,
      matchStatsRowsSkippedNoPosition: skippedMatchStatsNoPosition,
      // Ticket #54: rows read is the Premier-League-filtered count above;
      // excluded rows are reported as two separate named counts (known
      // non-Premier-League vs not-yet-stamped null), never combined.
      matchStatsRowsRead: matchStatsRows.length,
      matchStatsRowsExcludedNonPremierLeague: matchStatsRowsExcludedNonPremierLeague ?? 0,
      matchStatsRowsExcludedNullCompetition: matchStatsRowsNullCompetition ?? 0,
      projectionRowsFetched: projectionRows.length,
      projectionsPagesFetched,
      projectionRowsSkippedNoPosition: skippedProjectionsNoPosition,
    }

    const message =
      `${JOB_NAME}: compared ${matchStatsRows.length} actual Premier League player-matches (${TARGET_SEASON}) against ` +
      `${projectionRows.length} projection rows (${MODEL_VERSION}) ` +
      `(${matchStatsRowsExcludedNonPremierLeague ?? 0} non-Premier-League row(s) and ` +
      `${matchStatsRowsNullCompetition ?? 0} null-competition row(s) excluded). Defender pts/90 — actual ${fmt(
        actualByPosition[DEFENDER].meanPointsPer90,
      )}, projected ${fmt(projectedByPosition[DEFENDER].meanPointsPer90)}. Report written to ${reportPath}.`
    console.log(message)
    await recordJobRun(supabase, { status: 'success', message, details, startedAt })
  } catch (err) {
    const message =
      err instanceof CalibrationReportError
        ? err.message
        : err instanceof Error
          ? `unexpected failure: ${err.message}`
          : `unexpected failure: ${String(err)}`

    console.error(`${JOB_NAME}: failed: ${message}`)

    try {
      await recordJobRun(supabase, { status: 'failure', message, details: null, startedAt })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}: additionally failed to record the failed job_runs row: ${recordMessage}`)
    }

    process.exit(1)
  }
}

// Guarded, matching every other scripts/*.ts job: importing this module
// (e.g. from its test file) must not trigger a real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
