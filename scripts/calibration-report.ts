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
// nobody earned bonus. Cards remain out of scope on both sides (G4). This is
// a SETTLED FACT for bonus, verified directly from the FPL-Core-Insights
// source CSV header on 28 Aug 2026 (ticket #127): no `bonus` column, no
// `bps` column. It cannot be fixed by improving the actual side — there is
// nothing there to read, and sourcing bonus elsewhere is a whole separate
// ticket (a new data source, Tier 2), not this one.
//
// Bonus on the PROJECTED side is different, and ticket #127 restores this
// report to a like-for-like comparison. src/lib/projection/expectedPoints.ts
// still returns bonusPoints: 0 for a single player-fixture, but ticket #78's
// second, fixture-grouped pass in scripts/project-points.ts allocates a real
// (projected) bonus share into player_projections.expected_points before
// this report reads it. Left alone, that would bias every comparison below
// AGAINST the model by roughly the size of the bonus term, concentrated
// exactly where the Top-20 tables look. Instead, this report subtracts
// components.points.bonusPoints back out of every projected total it
// compares (excludeBonusFromProjection below) — a reporting decision only;
// player_projections itself is never written to or altered. The excluded
// amount is printed alongside each projected total, and its mean per
// player-appearance is bound-checked against the arithmetic ceiling of
// BONUS_POINTS_PER_MATCH_TOTAL bonus points shared per match (see
// EXCLUDED_BONUS_LOWER_BOUND / EXCLUDED_BONUS_UPPER_BOUND and the caveats
// section) — an instrument that cannot bound its own adjustment is not one
// to trust, so a mean outside that bound is reported prominently rather
// than silently passed over.
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

/**
 * The subset of a player_match_stats row this job needs, with nulls exactly
 * as Postgres/PostgREST returns them for an unplayed or partially-recorded
 * match.
 *
 * Ticket #132, defect 2: `teamGoalsConceded` — sourced from
 * player_match_stats.team_goals_conceded, populated on every player's row
 * regardless of position. This is deliberately NOT the old `goalsConceded`
 * field, which read the OTHER, goalkeeper-only stat column on that same
 * table (see the #125 migration's own header for its exact name) — a
 * stat (74% populated on keeper rows, 1.1% on outfield rows) that produced
 * an impossible ~95% "clean sheet rate" for outfielders when read as though
 * it applied to them. See ticket #125's migration header and
 * LEARNINGS-second-build-wave.md §2 for the same bug's first occurrence.
 * `null` means genuinely unknown (the source's own 2% gap for 2025-2026),
 * never "conceded zero" — see reconstructActualMatchPoints below for how
 * that unknown is handled.
 */
export interface ActualMatchStatsInput {
  minutesPlayed: number | null
  goals: number | null
  assists: number | null
  teamGoalsConceded: number | null
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
  /**
   * Ticket #132, defect 2: true when this match's team_goals_conceded was a
   * real number (including 0), false when it was null. `components.cleanSheetPoints`
   * and `components.goalsConcededPoints` are exactly 0 when this is false —
   * "unknown", not "conceded zero" — and the aggregator below uses this flag
   * to exclude this match's minutes from the clean-sheet/goals-conceded
   * per-90 denominator specifically, without dropping the match's other
   * components (goals, assists, appearance, defensive contribution, which
   * team_goals_conceded has no bearing on).
   */
  teamGoalsConcededKnown: boolean
}

/**
 * Reconstructs one player-match's actual FPL points. Appearance: 1 point for
 * 1-59 minutes, 2 for 60+, 0 for zero minutes (a zero-minute row scores 0
 * here and is excluded from per-appearance means by the aggregator below —
 * see its named test). Clean sheet: team goals conceded = 0 AND minutes >=
 * 60, at whatever value CLEAN_SHEET_POINTS gives this position (0 for
 * forwards, by table, so no separate forward gate is needed here).
 * Goals-conceded and save points apply only to the positions pointValues.ts
 * says they apply to (GK/DEF for goals-conceded, GK only for saves) — gated
 * with that module's own predicates, not a locally re-derived position
 * check.
 *
 * Ticket #132, defect 2: when `stats.teamGoalsConceded` is null, clean-sheet
 * and goals-conceded points are 0 for THIS match — not because zero goals
 * were conceded, but because it is unknown — and `teamGoalsConcededKnown` is
 * false so the aggregator can exclude this match's minutes from those two
 * figures' own denominator. Every other component (goals, assists,
 * appearance, defensive contribution) is computed exactly as normal: a
 * missing team-level goals-conceded figure says nothing about whether this
 * player scored a goal.
 */
export function reconstructActualMatchPoints(position: Position, stats: ActualMatchStatsInput): ReconstructedMatch {
  const minutes = stats.minutesPlayed ?? 0
  const goals = stats.goals ?? 0
  const assists = stats.assists ?? 0
  const teamGoalsConcededKnown = stats.teamGoalsConceded !== null
  const teamGoalsConceded = stats.teamGoalsConceded ?? 0
  const saves = stats.saves ?? 0

  const defconStats: DefensiveActionStats = {
    clearances: stats.clearances ?? 0,
    blocks: stats.blocks ?? 0,
    interceptions: stats.interceptions ?? 0,
    tackles: stats.tackles ?? 0,
    recoveries: stats.recoveries ?? 0,
  }

  const appearancePoints = minutes === 0 ? 0 : minutes < 60 ? APPEARANCE_POINTS_UNDER_60 : APPEARANCE_POINTS_60_PLUS
  const isCleanSheet = teamGoalsConcededKnown && minutes >= 60 && teamGoalsConceded === 0

  const components: ComponentTotals = {
    appearancePoints,
    goalPoints: goals * goalPoints(position),
    assistPoints: assists * ASSIST_POINTS,
    cleanSheetPoints: isCleanSheet ? cleanSheetPoints(position) : 0,
    goalsConcededPoints:
      teamGoalsConcededKnown && goalsConcededPointsApply(position)
        ? Math.floor(teamGoalsConceded / GOALS_CONCEDED_DIVISOR) * GOALS_CONCEDED_POINTS_PER_UNIT
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

  return { minutes, fullComponents, components, totalPoints: totalMatchPoints(fullComponents), teamGoalsConcededKnown }
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
  /**
   * Ticket #132, defect 2. Optional so pre-existing fixtures that never
   * touch team_goals_conceded continue to pass unmodified — absent is
   * treated as true (known), matching every record built before this field
   * existed, all of which came from a real reconstructed value. See
   * ProjectedAggregationInput.excludedBonus above for the same convention.
   */
  teamGoalsConcededKnown?: boolean
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
  /**
   * Ticket #132, defect 2: componentPer90.cleanSheetPoints and
   * .goalsConcededPoints are scaled by cleanSheetEligibleMinutes below, NOT
   * totalMinutes — a match whose team_goals_conceded was null is excluded
   * from those two figures' own denominator, not diluted into it. Every
   * other component in this object is scaled by the ordinary totalMinutes.
   */
  componentPer90: ComponentTotals | null
  /** Ticket #132, defect 2: player-matches with a known (non-null) team_goals_conceded — the sample size behind componentPer90's cleanSheetPoints/goalsConcededPoints figures specifically. */
  cleanSheetEligibleMatchCount: number
  /** Ticket #132, defect 2: minutes from cleanSheetEligibleMatchCount's matches only — the denominator for componentPer90's cleanSheetPoints/goalsConcededPoints. */
  cleanSheetEligibleMinutes: number
}

/**
 * Aggregates reconstructed actual matches by position. Zero-minute rows
 * ARE counted in playerMatchCount and totalMinutes/totalPoints/per-90 (they
 * contribute 0 to each, correctly) but are EXCLUDED from appearanceCount and
 * meanPointsPerAppearance — see this file's test for the named case this
 * covers.
 *
 * Ticket #132, defect 2: a record whose team_goals_conceded was null (see
 * ActualMatchStatsInput / reconstructActualMatchPoints) already carries
 * cleanSheetPoints = 0 and goalsConcededPoints = 0 in its own components —
 * that much is unavoidable, we cannot invent a value for what is unknown.
 * What this aggregator does on top is keep that match's minutes OUT of the
 * denominator used to turn those two totals into a per-90 rate, so an
 * unknown match dilutes neither the numerator (already 0) nor the
 * denominator of the clean-sheet/goals-conceded figures specifically. Every
 * other component (goals, assists, appearance, defensive contribution) is
 * unaffected and still scaled by the full totalMinutes, exactly as before —
 * a null team_goals_conceded says nothing about whether a goal was scored.
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

    const cleanSheetEligible = forPosition.filter((r) => r.teamGoalsConcededKnown ?? true)
    const cleanSheetEligibleMinutes = cleanSheetEligible.reduce((sum, r) => sum + r.minutes, 0)
    // componentTotals.cleanSheetPoints/.goalsConcededPoints already sum to
    // exactly the eligible rows' contribution (ineligible rows contribute a
    // real 0 — see reconstructActualMatchPoints) — only the DENOMINATOR
    // needs to change for these two components.
    const cleanSheetFigures = componentsPer90(
      { ...emptyComponentTotals(), cleanSheetPoints: componentTotals.cleanSheetPoints, goalsConcededPoints: componentTotals.goalsConcededPoints },
      cleanSheetEligibleMinutes,
    )
    const componentPer90 = componentsPer90(componentTotals, totalMinutes)
    const blendedComponentPer90: ComponentTotals | null =
      componentPer90 === null
        ? null
        : {
            ...componentPer90,
            cleanSheetPoints: cleanSheetFigures?.cleanSheetPoints ?? 0,
            goalsConcededPoints: cleanSheetFigures?.goalsConcededPoints ?? 0,
          }

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
      componentPer90: blendedComponentPer90,
      cleanSheetEligibleMatchCount: cleanSheetEligible.length,
      cleanSheetEligibleMinutes,
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
  /** Bonus already subtracted out of expectedPoints above (ticket #127) — carried separately so the report can print what was excluded alongside each total. Optional so pre-existing fixtures that never touch bonus continue to pass unmodified; absent is treated as zero, same as excludeBonusFromProjection's own default. */
  excludedBonus?: number
}

export interface PositionProjectedAggregate {
  position: Position
  rowCount: number
  distinctPlayerCount: number
  totalExpectedMinutes: number
  totalExpectedPoints: number
  meanPointsPer90: number | null
  componentPer90: ComponentTotals | null
  /** Ticket #127 — total and per-90 bonus excluded from totalExpectedPoints above, for this position, printed alongside the projected total in the report. */
  totalExcludedBonus: number
  excludedBonusPer90: number | null
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
    const totalExcludedBonus = forPosition.reduce((sum, r) => sum + (r.excludedBonus ?? 0), 0)
    const componentTotals = sumComponents(forPosition.map((r) => r.components))

    result[position] = {
      position,
      rowCount: forPosition.length,
      distinctPlayerCount: new Set(forPosition.map((r) => r.playerId)).size,
      totalExpectedMinutes,
      totalExpectedPoints,
      meanPointsPer90: totalExpectedMinutes > 0 ? (totalExpectedPoints / totalExpectedMinutes) * 90 : null,
      componentPer90: componentsPer90(componentTotals, totalExpectedMinutes),
      totalExcludedBonus,
      excludedBonusPer90: totalExpectedMinutes > 0 ? (totalExcludedBonus / totalExpectedMinutes) * 90 : null,
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
// Clean-sheet rate bound — ticket #132, defect 2. Pure, no I/O.
// ============================================================================
// "Bounds-check any derived rate that has a known real-world limit" (the
// ticket's own words). A clean sheet is worth a fixed number of points
// (CLEAN_SHEET_POINTS, from pointValues.ts); dividing the measured
// clean-sheet points/90 by that fixed value gives back the RATE of matches
// that were clean sheets — and that rate has a real, checkable ceiling. It
// cannot plausibly exceed 60% for any position across a full season: this is
// the same arithmetic that turned a goalkeeper-only column read as though it
// applied to outfielders into an "impossible" ~95% figure — the third time
// this exact bug has shipped (LEARNINGS-second-build-wave.md §2). A bound
// that WARNS rather than FAILS would not have caught it any of the three
// times; this one throws.
// ============================================================================

/** A real clean-sheet rate cannot plausibly exceed this, for any position, across a full season. Derivation: the ticket's own measurement puts the true 2025/26 rate at roughly 28%; 60% is a wide, deliberately generous ceiling above that, not a tight statistical bound — the earlier ~95% bug was never close to this line. */
export const CLEAN_SHEET_RATE_UPPER_BOUND = 0.6

/**
 * projected/actual pts-per-90 ratio's sibling for clean sheets specifically:
 * derives the IMPLIED clean-sheet rate (a fraction, 0..1) from a measured
 * clean-sheet points/90 figure and this position's fixed points-per-clean-sheet
 * value. Null when there is no per-90 figure to derive from, or when this
 * position's clean-sheet point value is 0 (forwards) — a rate cannot be
 * derived from a zero denominator, and reporting one as 0% would claim
 * knowledge ("forwards never keep a clean sheet") this arithmetic does not
 * have.
 */
export function computeCleanSheetRate(cleanSheetPointsPer90: number | null, position: Position): number | null {
  if (cleanSheetPointsPer90 === null) return null
  const perCleanSheet = cleanSheetPoints(position)
  if (perCleanSheet <= 0) return null
  return cleanSheetPointsPer90 / perCleanSheet
}

/**
 * Throws — the report FAILS rather than printing an impossible figure — the
 * moment any position's derived clean-sheet rate exceeds
 * CLEAN_SHEET_RATE_UPPER_BOUND. Names both the position and the rate, so the
 * failure is actionable from the job_runs message alone. A null rate (no
 * data, or a position with no clean-sheet value) is not a violation — there
 * is nothing implausible about "no data".
 */
export function assertCleanSheetRatesPlausible(ratesByPosition: ReadonlyMap<Position, number | null>): void {
  for (const [position, rate] of ratesByPosition) {
    if (rate !== null && rate > CLEAN_SHEET_RATE_UPPER_BOUND) {
      throw new CalibrationReportError(
        `${POSITION_NAMES[position]}'s derived clean-sheet rate is ${(rate * 100).toFixed(1)}% — above the ` +
          `${(CLEAN_SHEET_RATE_UPPER_BOUND * 100).toFixed(0)}% bound a real clean-sheet rate can ever plausibly reach across a ` +
          'full season. This is impossible, not a finding — refusing to print it. The same signature (goalkeepers correct, ' +
          'outfielders not) already broke this report twice before (LEARNINGS-second-build-wave.md §2): a clean-sheet figure ' +
          'read from the wrong column.',
        'clean_sheet_rate_bound',
      )
    }
  }
}

function fmtPercent(rate: number | null): string {
  return rate === null ? 'n/a' : `${(rate * 100).toFixed(0)}%`
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
  /** Ticket #127 — mean bonus excluded per row for this player, printed alongside meanExpectedPoints (which already has that bonus subtracted out). Optional so pre-existing fixtures that never touch bonus continue to pass unmodified; absent renders as zero. */
  meanExcludedBonus?: number
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
  /** Ticket #132, defect 2: the team-level figure — see ActualMatchStatsInput.teamGoalsConceded above. Never read the OTHER, goalkeeper-only column on this table (see the #125 migration's own header) that this replaces. */
  team_goals_conceded: number | null
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
// Bonus exclusion — ticket #127. Pure, no I/O, unit-testable. Restores this
// report to a like-for-like comparison: the actual side can never carry
// bonus (verified — see the file header's "Bonus and cards" section), so
// the only way to make the two sides comparable is to remove bonus from the
// side that HAS it (the projected side, since ticket #78), not to invent
// bonus on the side that doesn't. The stored projection is never touched —
// this only affects the figure THIS REPORT compares.
// ============================================================================

export interface BonusExclusion {
  /** The projected total this report compares against the actual side — expectedPoints with bonus subtracted back out. */
  comparedPoints: number
  /** The bonus that was subtracted, printed alongside comparedPoints so the reader can see the size of what was set aside rather than taking the adjustment on trust. Zero for a row whose components carry no bonusPoints key — every row written before ticket #78 — treated as zero excluded bonus, not dropped and not an error. */
  excludedBonus: number
}

export function excludeBonusFromProjection(expectedPoints: number, bonusPoints: number | undefined): BonusExclusion {
  const excludedBonus = bonusPoints ?? 0
  return { comparedPoints: expectedPoints - excludedBonus, excludedBonus }
}

/**
 * The bound this report checks its own adjustment against. The FPL bonus
 * system shares BONUS_POINTS_PER_MATCH_TOTAL (6) points among however many
 * players a match's projected rows cover, so the mean excluded bonus per
 * player-appearance should sit somewhere near a small fraction of that
 * ceiling — not at exactly zero (the exclusion not applying at all) and not
 * anywhere close to the full 6 (something read from the wrong field). 0.05
 * to 1.00 is that "near" band, not a guess: see the ticket for the derivation.
 */
export const EXCLUDED_BONUS_LOWER_BOUND = 0.05
export const EXCLUDED_BONUS_UPPER_BOUND = 1.0

export interface ExcludedBonusBoundCheck {
  rowCount: number
  meanExcludedBonusPerAppearance: number | null
  withinBound: boolean
}

/**
 * Bound-checks the mean excluded bonus per player-appearance against
 * EXCLUDED_BONUS_LOWER_BOUND / EXCLUDED_BONUS_UPPER_BOUND above. An
 * instrument that cannot bound its own adjustment is not one to trust: no
 * rows at all reports a null mean, which also fails the bound — "not
 * comparable" is a legitimate output, not a case to paper over with a
 * default.
 */
export function checkExcludedBonusBound(excludedBonusValues: readonly number[]): ExcludedBonusBoundCheck {
  const rowCount = excludedBonusValues.length
  const meanExcludedBonusPerAppearance =
    rowCount > 0 ? excludedBonusValues.reduce((sum, v) => sum + v, 0) / rowCount : null
  const withinBound =
    meanExcludedBonusPerAppearance !== null &&
    meanExcludedBonusPerAppearance >= EXCLUDED_BONUS_LOWER_BOUND &&
    meanExcludedBonusPerAppearance <= EXCLUDED_BONUS_UPPER_BOUND
  return { rowCount, meanExcludedBonusPerAppearance, withinBound }
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
  /** Ticket #127: bound check on the mean bonus excluded per player-appearance across every projected row read — see checkExcludedBonusBound. */
  excludedBonusBound: ExcludedBonusBoundCheck
  /** Ticket #132, defect 2: player_match_stats rows (within the season/competition sample above) whose team_goals_conceded was null — excluded from the clean-sheet and goals-conceded figures only, not from the rest of that row's components, and never read as zero conceded. Counted here, alongside the other sample sizes, per the ticket's own DoD. */
  matchStatsRowsNullTeamGoalsConceded: number
}

function averageBonusPerAppearance(): number {
  return BONUS_POINTS_PER_MATCH_TOTAL / PLAYERS_ON_PITCH_PER_MATCH
}

/**
 * Ticket #127: states the measured mean excluded bonus per player-appearance
 * and its bound check, prominently, every time — not just when it fails.
 * "Not comparable" is a legitimate output: if the bound fires, this says so
 * loudly, in the report itself, rather than burying it in a footnote.
 */
function excludedBonusBoundNote(bound: ExcludedBonusBoundCheck): string {
  const meanText =
    bound.meanExcludedBonusPerAppearance === null
      ? 'n/a (no projected rows read)'
      : `${bound.meanExcludedBonusPerAppearance.toFixed(3)} pts`
  const boundLine =
    `Mean excluded bonus per player-appearance: **${meanText}** (n=${bound.rowCount} projected rows), checked against the ` +
    `${EXCLUDED_BONUS_LOWER_BOUND}–${EXCLUDED_BONUS_UPPER_BOUND} bound — the arithmetic ceiling is ` +
    `${BONUS_POINTS_PER_MATCH_TOTAL} bonus points shared per match.`
  if (bound.withinBound) return `${boundLine} Within bound.`
  return (
    `${boundLine}\n\n**⚠️ BONUS EXCLUSION OUT OF BOUND — this comparison is NOT reliable.** An excluded-bonus mean ` +
    'outside the expected range means the bonus adjustment itself cannot be trusted, so the Top-20 tables and position totals ' +
    'in this report should NOT be read as like-for-like until this is investigated. Reported here, prominently, rather than ' +
    'silently passed over.'
  )
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
    '| Position | Actual pts/appearance (n) | Actual pts/90 (matches, players) | Projected pts/90 (rows, players) | Excluded bonus pts/90 | Ratio (proj/actual) |\n' +
    '|---|---|---|---|---|---|'
  const rows = POSITIONS.map((position) => {
    const a = actual[position]
    const p = projected[position]
    const actualAppearanceCell = `${fmt(a.meanPointsPerAppearance)} (n=${a.appearanceCount})`
    const actualPer90Cell = `${fmt(a.meanPointsPer90)} (${a.playerMatchCount} matches, ${a.distinctPlayerCount} players)`
    const projPer90Cell = `${fmt(p.meanPointsPer90)} (${p.rowCount} rows, ${p.distinctPlayerCount} players)`
    // Ticket #127: projPer90Cell above already has bonus subtracted out — this column states how much, so the adjustment is never taken on trust.
    return `| ${POSITION_NAMES[position]} | ${actualAppearanceCell} | ${actualPer90Cell} | ${projPer90Cell} | ${fmt(p.excludedBonusPer90)} | ${fmtRatio(ratio(p.meanPointsPer90, a.meanPointsPer90))} |`
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

/**
 * Ticket #132, defect 2 DoD: "the clean-sheet rate is printed per position
 * as a percentage... so the implausible number is visible without anyone
 * doing division in their head." Mirrors the ticket's own illustrative
 * table (Position | Actual clean-sheet pts/90 | Points per clean sheet |
 * Implied clean-sheet rate).
 */
function buildCleanSheetRateTable(actual: Record<Position, PositionActualAggregate>): string {
  const header =
    '| Position | Actual clean-sheet pts/90 (eligible matches, minutes) | Points per clean sheet | Implied clean-sheet rate |\n' +
    '|---|---|---|---|'
  const rows = POSITIONS.map((position) => {
    const a = actual[position]
    const cleanSheetPer90 = a.componentPer90?.cleanSheetPoints ?? null
    const perCleanSheet = cleanSheetPoints(position)
    const rateCell = `${fmtPercent(computeCleanSheetRate(cleanSheetPer90, position))}`
    return `| ${POSITION_NAMES[position]} | ${fmt(cleanSheetPer90)} (${a.cleanSheetEligibleMatchCount} matches, ${Math.round(a.cleanSheetEligibleMinutes)} min) | ${perCleanSheet} | ${rateCell} |`
  })
  return [header, ...rows].join('\n')
}

function buildTopTable(title: string, actualRows: PlayerActualTotal[], projectedRows: PlayerProjectedMean[]): string {
  const actualHeader = `**Top ${actualRows.length} actual scorers (2025/26, total points)**\n\n| # | Player | Total pts | Matches |\n|---|---|---|---|`
  const actualBody = actualRows
    .map((r, i) => `| ${i + 1} | ${r.webName} | ${r.totalPoints} | ${r.matchCount} |`)
    .join('\n')
  // Ticket #127: mean expected pts below already excludes bonus — "Excluded bonus" states how much, alongside every projected total, so the adjustment is never taken on trust.
  const projHeader =
    `**Top ${projectedRows.length} projected players (baseline-v1, mean expected points, bonus excluded)**\n\n` +
    '| # | Player | Mean expected pts (excl. bonus) | Excluded bonus | Rows |\n|---|---|---|---|---|'
  const projBody = projectedRows
    .map((r, i) => `| ${i + 1} | ${r.webName} | ${fmt(r.meanExpectedPoints)} | ${fmt(r.meanExcludedBonus ?? 0)} | ${r.rowCount} |`)
    .join('\n')
  return `#### ${title}\n\n${actualHeader}\n${actualBody || '| — | (none) | — | — |'}\n\n${projHeader}\n${projBody || '| — | (none) | — | — | — |'}`
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
      '**Directional evidence, not a verdict** — four reasons:\n\n' +
      `1. **Different seasons, mostly different players.** \`player_match_stats\` holds ${TARGET_SEASON} match data; ` +
      `\`player_projections\` holds \`${MODEL_VERSION}\`'s 2026/27 output. This is a *distributional* comparison — does a defender ` +
      'score about this many points per 90 and does a forward score about that many — not a player-for-player check. ' +
      'This is not a point-in-time backtest (feature item 29); it uses full-season hindsight on both sides, which is invalid for ' +
      'judging any one prediction but fine for judging a position-level distribution.\n' +
      `2. **${TARGET_SEASON} was played under the PREVIOUS BPS rules.** The 2026/27 BPS rebalance (CBI at 1 per 3 actions instead ` +
      'of 2, the tackled penalty removed, revised goalkeeper save BPS) changes who earns bonus. The actual side below still ' +
      'cannot see bonus at all regardless of which rules apply — see point 3.\n' +
      `3. **The actual side can never include bonus or cards.** \`player_match_stats\` (sourced from FPL-Core-Insights) has no ` +
      '`bonus` column and no `bps` column — verified directly from the source CSV header on 28 Aug 2026 (ticket #127) — so the ' +
      'actual figures below are a permanent **under-count**, not a temporary gap a future ingest could close. The FPL bonus ' +
      `system awards ${BONUS_POINTS_PER_MATCH_TOTAL} points (3/2/1) to three players out of the ~${PLAYERS_ON_PITCH_PER_MATCH} ` +
      `who appear in a match — roughly **${avgBonus.toFixed(2)} points per player-appearance on average**, concentrated among ` +
      'a match\'s standout performers rather than spread evenly, so this under-count is larger for the top of the distribution ' +
      '(the Top-20 tables below) than for the position means. Cards remain unmodelled on both sides.\n' +
      '4. **The projected side models bonus (ticket #78); this report excludes it from every total it compares (ticket #127), ' +
      'to stay like-for-like against a side that can never have it.** `scripts/project-points.ts` allocates a projected bonus ' +
      'share into `player_projections.expected_points`; this report subtracts `components.points.bonusPoints` back out before ' +
      'summing, averaging or ranking anything below — a reporting decision only, `player_projections` itself is never written ' +
      'to or altered — and prints the excluded amount alongside each projected total (the **By position: totals** and ' +
      '**Top scorers** tables below) so the reader can see the size of what was set aside rather than taking the adjustment on ' +
      'trust. A projection row whose components carry no `bonusPoints` key — every row written before ticket #78 — is treated ' +
      `as exactly zero excluded bonus, not dropped and not an error. This means the Top-20 tables now read a little lower than ` +
      'the total a player would actually see in-app, which is intentional: the comparison would otherwise be biased against ' +
      'the model by exactly the size of the bonus term, concentrated exactly where those tables look. ' +
      `${excludedBonusBoundNote(data.excludedBonusBound)}\n\n` +
      'The **By point component** table below is unaffected by any of this: it omits bonus/cards entirely (see its own note).',
  )

  sections.push('## Headline: are defenders over-projected?\n\n' + defenderHeadline(data.actualByPosition, data.projectedByPosition))

  sections.push(
    '## By position: totals\n\n' +
      'Every figure carries its sample size in parentheses.\n\n' +
      buildPositionTable(data.actualByPosition, data.projectedByPosition),
  )

  sections.push(
    '## Clean-sheet rate, by position\n\n' +
      'Ticket #132: the implied clean-sheet rate behind the actual clean-sheet pts/90 figure above, printed explicitly as a ' +
      'percentage so an implausible reading is visible without doing the division by hand — `Implied clean-sheet rate` is the ' +
      '`Actual clean-sheet pts/90` column divided by `Points per clean sheet`. A rate above ' +
      `${(CLEAN_SHEET_RATE_UPPER_BOUND * 100).toFixed(0)}% for any position is impossible and would have made this report fail ` +
      `before reaching this line (see \`assertCleanSheetRatesPlausible\`) — this is the check that would have caught the ~95% bug ` +
      'three times over. A row with a null `team_goals_conceded` is excluded from the eligible matches/minutes behind this table ' +
      `(${data.matchStatsRowsNullTeamGoalsConceded} such row(s) this run — see the provenance section below), never read as a ` +
      'clean sheet.\n\n' +
      buildCleanSheetRateTable(data.actualByPosition),
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
      '- **G3 (bonus):** addressed by ticket #78 (bonus now modelled) and restored to a fair comparison by ticket #127 (this ' +
      'report excludes projected bonus from every total it compares, because the actual side can never carry it — verified, no ' +
      '`bonus` or `bps` column in the source). See the caveats section above for the mean excluded bonus and its bound check.\n' +
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
      `- player_match_stats rows with a null team_goals_conceded (ticket #132): ${data.matchStatsRowsNullTeamGoalsConceded} — ` +
      'excluded from the clean-sheet and goals-conceded figures only (see the Clean-sheet rate section above); every other ' +
      'component for these rows is still counted normally, never read as zero conceded\n' +
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
          'player_code, minutes_played, goals, assists, team_goals_conceded, saves, clearances, blocks, interceptions, tackles, recoveries',
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
    // Ticket #132, defect 2: rows with a null team_goals_conceded are NOT
    // skipped — every other component (goals, assists, appearance,
    // defensive contribution) is still real and still counted. Only their
    // clean-sheet/goals-conceded contribution is 0 (unknown, not zero
    // conceded — see reconstructActualMatchPoints), and their minutes are
    // excluded from THAT figure's own per-90 denominator by
    // aggregateActualByPosition. This counter is purely informational,
    // reported in the provenance section below.
    let matchStatsRowsNullTeamGoalsConceded = 0
    const actualInputs: ActualAggregationInput[] = []
    const actualPlayerTotals = new Map<number, PlayerActualTotal>()

    for (const row of matchStatsRows) {
      const position = row.player_code !== null ? codeToPosition.get(row.player_code) : undefined
      if (position === undefined || row.player_code === null) {
        skippedMatchStatsNoPosition++
        continue
      }

      if (row.team_goals_conceded === null) matchStatsRowsNullTeamGoalsConceded++

      const reconstructed = reconstructActualMatchPoints(position, {
        minutesPlayed: row.minutes_played,
        goals: row.goals,
        assists: row.assists,
        teamGoalsConceded: row.team_goals_conceded,
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
        teamGoalsConcededKnown: reconstructed.teamGoalsConcededKnown,
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
    // 5b. Ticket #132, defect 2: the bound that would have caught the ~95%
    //     bug three times over. Runs BEFORE any report content is written —
    //     an impossible clean-sheet rate must fail the job, never reach the
    //     file on disk.
    // --------------------------------------------------------------------
    const cleanSheetRatesByPosition = new Map<Position, number | null>(
      POSITIONS.map((position) => [
        position,
        computeCleanSheetRate(actualByPosition[position].componentPer90?.cleanSheetPoints ?? null, position),
      ]),
    )
    assertCleanSheetRatesPlausible(cleanSheetRatesByPosition)

    // --------------------------------------------------------------------
    // 6. Projected side. Position via player_id = players.id — a real FK
    //    here (see the player_projections migration's header: both sides
    //    are always the CURRENT season's freshly-ingested rows, unlike
    //    player_match_stats' historical player_id).
    // --------------------------------------------------------------------
    let skippedProjectionsNoPosition = 0
    const projectedInputs: ProjectedAggregationInput[] = []
    const projectedPlayerSums = new Map<
      number,
      { webName: string; position: Position; sum: number; count: number; excludedBonusSum: number }
    >()
    // Ticket #127: every excluded-bonus value read, across all positions, for the report-wide bound check below (checkExcludedBonusBound).
    const allExcludedBonusValues: number[] = []

    for (const row of projectionRows) {
      const position = idToPosition.get(row.player_id)
      if (position === undefined) {
        skippedProjectionsNoPosition++
        continue
      }

      const components = pickProjectedComponents(row.components?.points)
      // Ticket #127: subtract bonus back out of the stored expected_points before this report compares it against the
      // actual side — the actual side can never carry bonus (verified, see file header), so the projected side is the
      // only side this CAN be made comparable from. Nothing here writes back to player_projections.
      const { comparedPoints, excludedBonus } = excludeBonusFromProjection(row.expected_points, row.components?.points?.bonusPoints)
      allExcludedBonusValues.push(excludedBonus)
      projectedInputs.push({
        position,
        playerId: row.player_id,
        expectedPoints: comparedPoints,
        expectedMinutes: row.expected_minutes,
        components,
        excludedBonus,
      })

      const existing = projectedPlayerSums.get(row.player_id)
      if (existing) {
        existing.sum += comparedPoints
        existing.count += 1
        existing.excludedBonusSum += excludedBonus
      } else {
        projectedPlayerSums.set(row.player_id, {
          webName: idToWebName.get(row.player_id) ?? `id:${row.player_id}`,
          position,
          sum: comparedPoints,
          count: 1,
          excludedBonusSum: excludedBonus,
        })
      }
    }

    const projectedByPosition = aggregateProjectedByPosition(projectedInputs)
    const excludedBonusBound = checkExcludedBonusBound(allExcludedBonusValues)

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
      meanExcludedBonus: v.excludedBonusSum / v.count,
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
      excludedBonusBound,
      matchStatsRowsNullTeamGoalsConceded,
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
      // Ticket #127: the bound check on the mean bonus excluded from every projected total this report compares.
      excludedBonusBound,
      // Ticket #132, defect 2: rows excluded from the clean-sheet/goals-conceded figures only (see reportData above).
      matchStatsRowsNullTeamGoalsConceded,
      cleanSheetRatesByPosition: Object.fromEntries(cleanSheetRatesByPosition),
    }

    const bonusBoundNote = excludedBonusBound.withinBound
      ? ''
      : ' WARNING: excluded-bonus bound check FAILED — see the report\'s caveats section before trusting any figure in it.'
    const message =
      `${JOB_NAME}: compared ${matchStatsRows.length} actual Premier League player-matches (${TARGET_SEASON}) against ` +
      `${projectionRows.length} projection rows (${MODEL_VERSION}) ` +
      `(${matchStatsRowsExcludedNonPremierLeague ?? 0} non-Premier-League row(s) and ` +
      `${matchStatsRowsNullCompetition ?? 0} null-competition row(s) excluded). Defender pts/90 — actual ${fmt(
        actualByPosition[DEFENDER].meanPointsPer90,
      )}, projected ${fmt(projectedByPosition[DEFENDER].meanPointsPer90)} (bonus excluded). Mean excluded bonus/appearance: ${fmt(
        excludedBonusBound.meanExcludedBonusPerAppearance,
        3,
      )}. Report written to ${reportPath}.${bonusBoundNote}`
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
