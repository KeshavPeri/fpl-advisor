// Penalty-duty diagnostic — ticket #215. Hand-run only; not wired into
// .github/workflows/*.yml, not dispatched by anything, changes nothing.
//
// ============================================================================
// Why this exists.
// ============================================================================
// docs/model-review-2026-09-02.md §1g audited everything this model leaves
// out (cards, own goals, penalty misses) and concluded almost all of it
// should stay out — except penalty DUTY, which it flagged as "the one
// absence with concentrated cost" and named a measurement method: "a
// persistent positive per-player goals-minus-xG residual identifies
// takers". This script is that one diagnostic, weeks overdue on the
// review's own list. It changes no projection — src/lib/projection/ is
// untouched — it produces a number and a recommendation.
//
// ============================================================================
// What "the source carries penalties_scored" actually means, checked before
// writing this.
// ============================================================================
// The review's claim is true of the ultimate source (FPL-Core-Insights'
// per-gameweek playermatchstats.csv, e.g.
// data/2025-2026/By%20Gameweek/GW1/playermatchstats.csv, verified directly
// against a live fetch while building this ticket) — it publishes
// `penalties_scored` and `penalties_missed` per match, right now, populated
// with real values. It is NOT true of this repo's `player_match_stats`
// table: scripts/ingest-core-insights.ts's row mapping never selects those
// two columns, so they never reach Supabase. That gap is real and is
// recorded in this ticket's backlog entry, but it is not this ticket's to
// close (no ingest column, no migration — ticket scope) and it does not
// change the method below: the residual is computed from what
// player_match_stats actually has (minutes_played, goals, xg), which is
// exactly the review's named method, not a fallback from it.
//
// ============================================================================
// The method, and its two outputs.
// ============================================================================
// For every player with at least MIN_SEASON_MINUTES of Premier-League
// minutes in a season, this computes (goals - xg) / (minutes / 90) — the
// per-90 rate at which a player's actual goals exceed his underlying shot
// quality. A season-long, sustained positive value is the review's proposed
// signature of a designated taker: he is converting more often than his
// shots alone would predict, and a penalty converted at anywhere near its
// expected rate adds real surplus above a pure open-play shot profile.
//
// PENALTY_DUTY_RESIDUAL_THRESHOLD_PER_90 below is the separation rule the
// ticket's DoD requires be stated as a judgement, not a derived bound — see
// that constant's own comment for the reasoning, and see
// docs/projection-model-backlog.md's entry for this ticket for what checking
// it against real season records actually showed.
//
// ============================================================================
// No model change. Nothing under src/lib/projection/ is edited — only
// src/lib/projection/pointValues.ts's goalPoints() is imported, to convert a
// per-90 residual into the same point currency the model itself uses,
// exactly the precedent scripts/calibration-report.ts's own header describes
// for the identical import.
// ============================================================================

import { createClient } from '@supabase/supabase-js'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'
import { PREMIER_LEAGUE_COMPETITION } from './lib/competition.ts'
import type { Position } from '../src/lib/scoring/types.ts'
import { goalPoints } from '../src/lib/projection/pointValues.ts'

const JOB_NAME = 'penalty-duty-diagnostic'

// Migration path literals duplicated from scripts/run-backtest.ts /
// scripts/calibration-report.ts for the same reason those two duplicate them
// from each other — see CLAUDE.md's note on small helpers not needing a
// shared import.
const PLAYER_MATCH_STATS_MIGRATION = 'supabase/migrations/20260811170000_player_match_stats.sql'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'
const PLAYER_PROJECTIONS_MIGRATION = 'supabase/migrations/20260815120000_player_projections.sql'

/** Must match scripts/project-points.ts's own MODEL_VERSION — duplicated for the same reason scripts/calibration-report.ts duplicates it. */
const MODEL_VERSION = 'baseline-v1'

/**
 * Season this diagnostic reads, from PENALTY_DIAGNOSTIC_SEASON — trimmed,
 * falling back to DEFAULT_SEASON when unset or blank. DEFAULT_SEASON is
 * 2025-2026 deliberately: it is the one ingested season that has actually
 * finished, so "over a full season" (the ticket's own words) means something
 * — 2026/27 has only two finished gameweeks as of this ticket and cannot yet
 * support a season-long residual without the exact single-gameweek noise
 * this diagnostic's separation rule exists to reject.
 */
export const DEFAULT_SEASON = '2025-2026'

function readSeason(): string {
  return (process.env.PENALTY_DIAGNOSTIC_SEASON ?? '').trim() || DEFAULT_SEASON
}

// ============================================================================
// Constants — the judgement calls, each argued where it is declared.
// ============================================================================

/**
 * A player needs at least this many Premier-League minutes in the measured
 * season to be scored at all — roughly ten full matches. This is the
 * mechanism behind the DoD's "a single high-scoring gameweek does not
 * qualify a player on its own": one hot match is ~1 ninety of evidence, and
 * a residual computed over 1 ninety is dominated by that match's own
 * variance, not a season-long tendency. Ten nineties is not derived from
 * this data — it is the same order of magnitude src/lib/projection/rates.ts's
 * own shrinkage uses to decide when personal history starts to dominate a
 * position prior, chosen here for the same reason: enough matches that one
 * outlier can no longer carry the average on its own.
 */
export const MIN_SEASON_MINUTES = 900

/**
 * THE SEPARATION RULE — a judgement, not a derived threshold, exactly as the
 * DoD requires this be stated. 0.10 goals/90 of season-long surplus over
 * shot-quality-implied output is the line this diagnostic draws between
 * "plausibly taking penalties" and "a good finisher having a good season" —
 * chosen as a round number comfortably above ordinary finishing noise
 * (measured season-wide standard deviation of this residual across
 * qualifying players is roughly 0.07/90 — see the backlog entry) without
 * being so strict that a real taker who also misses a couple of penalties
 * (which drags the residual back down, since a miss adds ~0.8 xG for zero
 * goals) falls under it.
 *
 * IMPORTANT, and this is the finding this whole diagnostic turns on: checking
 * this threshold's OUTPUT against real season records (players who actually
 * have a penalty miss or a penalty goal on the books) shows the threshold
 * does not do the job the review's method assumed. See
 * docs/projection-model-backlog.md's entry for this ticket for the measured
 * numbers. This constant is kept, and the diagnostic still computes and
 * reports its output, because the DoD's separation-rule requirement is about
 * this diagnostic stating its rule honestly and testably — not about the
 * rule turning out to work. A rule that fails a real cross-check is itself
 * the answer to "is this worth building further", which is exactly what a
 * diagnostic is for.
 */
export const PENALTY_DUTY_RESIDUAL_THRESHOLD_PER_90 = 0.1

/**
 * Below this many qualifying players (MIN_SEASON_MINUTES minutes or more),
 * the whole exercise is refused rather than reported — the same "too small
 * to read" discipline scripts/run-backtest.ts's MIN_BUCKET_SAMPLE_SIZE
 * applies to its own buckets, scaled down for this diagnostic's much smaller
 * unit of measurement (one number per player-season, not per gameweek row).
 */
export const MIN_QUALIFYING_POPULATION = 20

/**
 * A flagged population smaller than this is refused for the
 * penalties_missed cross-check specifically — five candidates is the point
 * below which "N of 5 have a missed penalty on record" reads as noise
 * regardless of what N is.
 */
export const MIN_CROSSCHECK_POPULATION = 5

/**
 * Below this many measured gameweeks, "how often is a candidate the
 * top-projected player" is refused — five gameweeks is the point below which
 * a single fixture swing decides the whole reported rate.
 */
export const MIN_CAPTAINCY_GAMEWEEKS = 5

/**
 * The horizon the ticket asks the points-impact figure to be measured over.
 * One ninety assumed per gameweek — a deliberate simplification (this
 * diagnostic has no fixture schedule the way scripts/run-backtest.ts's
 * 5-gameweek window does; see G13/#193 in the backlog for why that machinery
 * exists there and is overkill here) that slightly understates a
 * double-gameweek and slightly overstates a blank one. Stated, not hidden.
 */
export const FIVE_GAMEWEEK_HORIZON_NINETIES = 5

// ============================================================================
// Pure logic — everything below this line takes only its arguments and does
// no I/O. Tested in penalty-duty-diagnostic.test.ts on constructed rows.
// ============================================================================

export interface MatchStatsRow {
  player_code: number | null
  minutes_played: number | null
  goals: number | null
  xg: number | null
}

export interface PlayerSeasonTotals {
  minutesPlayed: number
  goals: number
  xg: number
}

/**
 * Sums minutes/goals/xg per player_code across every row given. Rows with a
 * null player_code are skipped (an unresolved-transfer row, per D9 — never
 * key on element id) and never silently counted against any player. Null
 * numeric fields count as 0, matching every other job's convention for a
 * source row that recorded no value for a stat the player did not attempt.
 */
export function aggregateSeasonTotals(rows: readonly MatchStatsRow[]): Map<number, PlayerSeasonTotals> {
  const totals = new Map<number, PlayerSeasonTotals>()
  for (const row of rows) {
    if (row.player_code === null) continue
    const existing = totals.get(row.player_code) ?? { minutesPlayed: 0, goals: 0, xg: 0 }
    existing.minutesPlayed += row.minutes_played ?? 0
    existing.goals += row.goals ?? 0
    existing.xg += row.xg ?? 0
    totals.set(row.player_code, existing)
  }
  return totals
}

/** (goals - xg) per 90 minutes played. Null when the player has no minutes at all — never divide by zero. */
export function computeGoalsMinusXgResidualPerNinety(totals: PlayerSeasonTotals): number | null {
  if (totals.minutesPlayed <= 0) return null
  const nineties = totals.minutesPlayed / 90
  return (totals.goals - totals.xg) / nineties
}

export interface PenaltyDutyCandidate {
  playerCode: number
  position: Position
  minutesPlayed: number
  goals: number
  xg: number
  residualPerNinety: number
}

export interface CandidateIdentificationResult {
  /** Players with >= MIN_SEASON_MINUTES minutes — the population the threshold was applied against, for the "of N" figure the DoD requires. */
  qualifyingPopulation: number
  /** Empty when tooSmallToRead is true. Sorted by residualPerNinety, largest first. */
  candidates: PenaltyDutyCandidate[]
  tooSmallToRead: boolean
}

/**
 * Applies MIN_SEASON_MINUTES (sample-size gate) and then
 * PENALTY_DUTY_RESIDUAL_THRESHOLD_PER_90 (the separation rule) to every
 * player_code in totalsByCode. Refuses (tooSmallToRead) rather than reports
 * a candidate list when fewer than MIN_QUALIFYING_POPULATION players clear
 * the minutes gate at all — a season this diagnostic has no business reading
 * yet (e.g. a season still in its first few gameweeks).
 */
export function identifyPenaltyDutyCandidates(
  totalsByCode: ReadonlyMap<number, PlayerSeasonTotals>,
  positionByCode: ReadonlyMap<number, Position>,
): CandidateIdentificationResult {
  const qualifying: { code: number; totals: PlayerSeasonTotals; residual: number }[] = []
  for (const [code, totals] of totalsByCode) {
    if (totals.minutesPlayed < MIN_SEASON_MINUTES) continue
    const residual = computeGoalsMinusXgResidualPerNinety(totals)
    if (residual === null) continue
    qualifying.push({ code, totals, residual })
  }

  if (qualifying.length < MIN_QUALIFYING_POPULATION) {
    return { qualifyingPopulation: qualifying.length, candidates: [], tooSmallToRead: true }
  }

  const candidates: PenaltyDutyCandidate[] = []
  for (const q of qualifying) {
    if (q.residual < PENALTY_DUTY_RESIDUAL_THRESHOLD_PER_90) continue
    const position = positionByCode.get(q.code)
    if (position === undefined) continue
    candidates.push({
      playerCode: q.code,
      position,
      minutesPlayed: q.totals.minutesPlayed,
      goals: q.totals.goals,
      xg: q.totals.xg,
      residualPerNinety: q.residual,
    })
  }
  candidates.sort((a, b) => b.residualPerNinety - a.residualPerNinety)

  return { qualifyingPopulation: qualifying.length, candidates, tooSmallToRead: false }
}

/**
 * How many projected-points this candidate's residual represents over a
 * five-gameweek horizon, in the model's own point currency
 * (src/lib/projection/pointValues.ts's goalPoints — the only place these
 * values may appear, per that file's own header).
 */
export function projectedPointsErrorOverHorizon(
  candidate: Pick<PenaltyDutyCandidate, 'residualPerNinety' | 'position'>,
  horizonNineties: number = FIVE_GAMEWEEK_HORIZON_NINETIES,
): number {
  return candidate.residualPerNinety * horizonNineties * goalPoints(candidate.position)
}

export interface PointsImpactSummary {
  n: number
  meanPointsImpact: number
  totalPointsImpact: number
}

/** Null when there are no candidates to summarize — never a mean of zero rows. */
export function summarizePointsImpact(candidates: readonly PenaltyDutyCandidate[]): PointsImpactSummary | null {
  if (candidates.length === 0) return null
  const impacts = candidates.map((c) => projectedPointsErrorOverHorizon(c))
  const total = impacts.reduce((sum, v) => sum + v, 0)
  return { n: candidates.length, meanPointsImpact: total / candidates.length, totalPointsImpact: total }
}

export interface CrossCheckResult {
  n: number
  withPenaltiesMissedOnRecord: number
  tooSmallToRead: boolean
}

/**
 * The ticket's own specified cross-check: of the flagged candidates, how
 * many have a penalty miss on record (players.penalties_missed)? A miss is
 * real, if indirect, evidence — you cannot miss a penalty you did not take.
 * Zero here for a given candidate is NOT proof he never takes penalties
 * (most takers never miss), but a nonzero count is proof positive, which is
 * exactly why the DoD calls this "real if indirect".
 */
export function crossCheckAgainstPenaltiesMissed(
  candidates: readonly PenaltyDutyCandidate[],
  penaltiesMissedByCode: ReadonlyMap<number, number>,
): CrossCheckResult {
  if (candidates.length < MIN_CROSSCHECK_POPULATION) {
    return { n: candidates.length, withPenaltiesMissedOnRecord: 0, tooSmallToRead: true }
  }
  const withRecord = candidates.filter((c) => (penaltiesMissedByCode.get(c.playerCode) ?? 0) > 0).length
  return { n: candidates.length, withPenaltiesMissedOnRecord: withRecord, tooSmallToRead: false }
}

export interface ProjectionRowForCaptaincy {
  gameweekId: number
  playerCode: number
  expectedPoints: number
}

/** One entry per gameweek: the player_code with the highest expected_points that gameweek. Ties keep whichever row is encountered first — a genuine tie is rare enough at floating-point precision that no tie-break policy is worth stating as a judgement here. */
export function computeTopProjectedPerGameweek(rows: readonly ProjectionRowForCaptaincy[]): Map<number, number> {
  const best = new Map<number, { playerCode: number; expectedPoints: number }>()
  for (const row of rows) {
    const current = best.get(row.gameweekId)
    if (!current || row.expectedPoints > current.expectedPoints) {
      best.set(row.gameweekId, { playerCode: row.playerCode, expectedPoints: row.expectedPoints })
    }
  }
  const result = new Map<number, number>()
  for (const [gameweekId, top] of best) result.set(gameweekId, top.playerCode)
  return result
}

export interface CaptaincyOverlapResult {
  gameweeksMeasured: number
  gameweeksWithCandidateOnTop: number
  rate: number
  tooSmallToRead: boolean
}

/**
 * The ticket's third cost figure: across every gameweek measured, how often
 * was the single top-projected player (by expected_points) one of the
 * flagged penalty-duty candidates? This is the captaincy case stated
 * directly — the captain is by definition the squad's highest-projected
 * player.
 */
export function computeCaptaincyOverlap(
  candidateCodes: ReadonlySet<number>,
  topProjectedByGameweek: ReadonlyMap<number, number>,
): CaptaincyOverlapResult {
  const gameweeksMeasured = topProjectedByGameweek.size
  if (gameweeksMeasured < MIN_CAPTAINCY_GAMEWEEKS) {
    return { gameweeksMeasured, gameweeksWithCandidateOnTop: 0, rate: 0, tooSmallToRead: true }
  }
  let hits = 0
  for (const playerCode of topProjectedByGameweek.values()) {
    if (candidateCodes.has(playerCode)) hits += 1
  }
  return { gameweeksMeasured, gameweeksWithCandidateOnTop: hits, rate: hits / gameweeksMeasured, tooSmallToRead: false }
}

export interface PenaltiesOrderAvailability {
  available: boolean
  totalElements: number
  nonNullCount: number
}

/**
 * Answers the ticket's yes/no question from an already-fetched
 * bootstrap-static/ JSON payload: does `penalties_order` exist as a field on
 * elements at all (regardless of how many are null), and if so, for how many
 * players is it actually populated. Pure — takes the parsed payload, makes
 * no network call itself (see fetchLivePenaltiesOrderAvailability below for
 * that half).
 */
export function parsePenaltiesOrderAvailability(bootstrapPayload: unknown): PenaltiesOrderAvailability {
  if (typeof bootstrapPayload !== 'object' || bootstrapPayload === null) {
    return { available: false, totalElements: 0, nonNullCount: 0 }
  }
  const elements = (bootstrapPayload as { elements?: unknown }).elements
  if (!Array.isArray(elements) || elements.length === 0) {
    return { available: false, totalElements: 0, nonNullCount: 0 }
  }
  const first = elements[0]
  const hasKey = typeof first === 'object' && first !== null && 'penalties_order' in (first as Record<string, unknown>)
  if (!hasKey) {
    return { available: false, totalElements: elements.length, nonNullCount: 0 }
  }
  let nonNullCount = 0
  for (const element of elements) {
    if (typeof element !== 'object' || element === null) continue
    const value = (element as Record<string, unknown>).penalties_order
    if (value !== null && value !== undefined) nonNullCount += 1
  }
  return { available: true, totalElements: elements.length, nonNullCount }
}

// ============================================================================
// I/O — everything below this line touches the network. Not exercised by
// the test file beyond the pure parse above; matches every other
// scripts/*.ts job's convention of leaving main() itself untested against a
// live database (see e.g. scripts/run-backtest.test.ts's own file header).
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
      `${JOB_NAME}: required environment variables are not set. Both SUPABASE_URL and SUPABASE_SECRET_KEY must be ` +
        `set (missing: ${missing.join(', ')}). Making no network call.`,
    )
    return null
  }
  return { url: url as string, secretKey: secretKey as string }
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

export class PenaltyDutyDiagnosticError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'PenaltyDutyDiagnosticError'
    this.context = context
  }
}

// The only remote host this script talks to beyond Supabase — same
// unauthenticated, no-account, public endpoint scripts/ingest-fpl.ts already
// calls every scheduled run. FPL_API_BASE_URL exists so a test or a mirror
// can point elsewhere; nothing here ever sends a credential to it.
const DEFAULT_API_BASE_URL = 'https://fantasy.premierleague.com/api'
const API_BASE_URL = process.env.FPL_API_BASE_URL ?? DEFAULT_API_BASE_URL
const BOOTSTRAP_URL = `${API_BASE_URL}/bootstrap-static/`

/**
 * Live half of the penalties_order check. Graceful failure path, per
 * CLAUDE.md: an unofficial API that changes without notice or a flaky
 * network must never crash this diagnostic — a failed check here just means
 * that one figure could not be confirmed this run, reported as such, and
 * everything else in the diagnostic still runs.
 */
async function fetchLivePenaltiesOrderAvailability(): Promise<PenaltiesOrderAvailability | null> {
  try {
    const response = await fetch(BOOTSTRAP_URL)
    if (!response.ok) {
      console.error(`${JOB_NAME}: bootstrap-static/ returned HTTP ${response.status}; penalties_order availability not confirmed this run.`)
      return null
    }
    const payload: unknown = await response.json()
    return parsePenaltiesOrderAvailability(payload)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: bootstrap-static/ fetch failed (${message}); penalties_order availability not confirmed this run.`)
    return null
  }
}

interface PlayerRow {
  id: number
  code: number | null
  element_type: number
  web_name: string
  penalties_missed: number | null
}

interface ProjectionRow {
  gameweek_id: number
  player_id: number
  expected_points: number | null
}

function formatCandidate(c: PenaltyDutyCandidate, webNameByCode: ReadonlyMap<number, string>): string {
  const name = webNameByCode.get(c.playerCode) ?? `player_code ${c.playerCode}`
  const impact = projectedPointsErrorOverHorizon(c)
  return `  - ${name}: residual ${c.residualPerNinety.toFixed(3)}/90 over ${c.minutesPlayed.toFixed(0)} min (${c.goals.toFixed(0)} goals vs ${c.xg.toFixed(2)} xG) — ${impact.toFixed(2)} pts/5-GW if taken at face value`
}

async function main(): Promise<void> {
  const env = readSupabaseEnv()
  if (!env) {
    process.exit(1)
    return
  }
  const season = readSeason()
  const supabase = createClient(env.url, env.secretKey)

  try {
    // ------------------------------------------------------------------
    // 1. players — position, web_name, penalties_missed. Paginated and
    //    count-verified, matching every other job's read of this table.
    // ------------------------------------------------------------------
    const { rows: playerRows, error: playersError } = await fetchAllPages<PlayerRow>((from, to) =>
      supabase
        .from('players')
        .select('id, code, element_type, web_name, penalties_missed')
        .order('id', { ascending: true })
        .range(from, to)
        .returns<PlayerRow[]>(),
    )
    if (playersError) {
      if (isMissingTable(playersError, 'players')) {
        throw new PenaltyDutyDiagnosticError(`the "players" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'players')
      }
      throw new PenaltyDutyDiagnosticError(`players lookup failed: ${playersError.message}`, 'players')
    }
    const { count: playersExpectedCount, error: playersCountError } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true })
    if (playersCountError) {
      throw new PenaltyDutyDiagnosticError(`players count check failed: ${playersCountError.message}`, 'players')
    }
    assertRowCountMatches('players', playerRows.length, playersExpectedCount ?? 0)

    const positionByCode = new Map<number, Position>()
    const webNameByCode = new Map<number, string>()
    const penaltiesMissedByCode = new Map<number, number>()
    const codeById = new Map<number, number>()
    for (const p of playerRows) {
      if (p.code === null) continue
      positionByCode.set(p.code, p.element_type as Position)
      webNameByCode.set(p.code, p.web_name)
      penaltiesMissedByCode.set(p.code, p.penalties_missed ?? 0)
      codeById.set(p.id, p.code)
    }

    // ------------------------------------------------------------------
    // 2. player_match_stats — the season's Premier-League rows only.
    // ------------------------------------------------------------------
    const { rows: matchStatsRows, error: matchStatsError } = await fetchAllPages<MatchStatsRow>((from, to) =>
      supabase
        .from('player_match_stats')
        .select('player_code, minutes_played, goals, xg')
        .eq('season', season)
        .eq('competition', PREMIER_LEAGUE_COMPETITION)
        .order('player_id', { ascending: true })
        .order('match_id', { ascending: true })
        .range(from, to)
        .returns<MatchStatsRow[]>(),
    )
    if (matchStatsError) {
      if (isMissingTable(matchStatsError, 'player_match_stats')) {
        throw new PenaltyDutyDiagnosticError(
          `the "player_match_stats" table does not exist. Apply ${PLAYER_MATCH_STATS_MIGRATION} first.`,
          'player_match_stats',
        )
      }
      throw new PenaltyDutyDiagnosticError(`player_match_stats lookup failed: ${matchStatsError.message}`, 'player_match_stats')
    }
    const { count: matchStatsExpectedCount, error: matchStatsCountError } = await supabase
      .from('player_match_stats')
      .select('*', { count: 'exact', head: true })
      .eq('season', season)
      .eq('competition', PREMIER_LEAGUE_COMPETITION)
    if (matchStatsCountError) {
      throw new PenaltyDutyDiagnosticError(`player_match_stats count check failed: ${matchStatsCountError.message}`, 'player_match_stats')
    }
    assertRowCountMatches(
      `player_match_stats (season=${season}, competition=${PREMIER_LEAGUE_COMPETITION})`,
      matchStatsRows.length,
      matchStatsExpectedCount ?? 0,
    )

    if (matchStatsRows.length === 0) {
      console.log(`${JOB_NAME}: no player_match_stats rows for season=${season}, competition=${PREMIER_LEAGUE_COMPETITION}. Nothing to diagnose. Exiting.`)
      process.exit(0)
      return
    }

    // ------------------------------------------------------------------
    // 3. The diagnostic itself.
    // ------------------------------------------------------------------
    const totalsByCode = aggregateSeasonTotals(matchStatsRows)
    const identification = identifyPenaltyDutyCandidates(totalsByCode, positionByCode)

    console.log(`\n${JOB_NAME} — season ${season}, competition=${PREMIER_LEAGUE_COMPETITION}`)
    console.log('='.repeat(72))
    console.log(`Qualifying population (>= ${MIN_SEASON_MINUTES} minutes): ${identification.qualifyingPopulation}`)

    if (identification.tooSmallToRead) {
      console.log(
        `Too small to read: fewer than ${MIN_QUALIFYING_POPULATION} players qualify for season=${season}. ` +
          'No candidates identified, no cost figures computed. Try a completed season.',
      )
    } else {
      console.log(
        `Candidates (residual >= ${PENALTY_DUTY_RESIDUAL_THRESHOLD_PER_90}/90): ${identification.candidates.length} of ${identification.qualifyingPopulation}`,
      )
      for (const c of identification.candidates) {
        console.log(formatCandidate(c, webNameByCode))
      }

      const pointsImpact = summarizePointsImpact(identification.candidates)
      if (pointsImpact) {
        console.log(
          `\nCost figure 1 — points-impact over ${FIVE_GAMEWEEK_HORIZON_NINETIES} gameweeks: mean ${pointsImpact.meanPointsImpact.toFixed(2)} pts, ` +
            `total ${pointsImpact.totalPointsImpact.toFixed(2)} pts across n=${pointsImpact.n} candidates (at face value — see the threshold comment above for the caveat).`,
        )
      } else {
        console.log('\nCost figure 1 — points-impact: no candidates, nothing to summarize.')
      }

      const crossCheck = crossCheckAgainstPenaltiesMissed(identification.candidates, penaltiesMissedByCode)
      if (crossCheck.tooSmallToRead) {
        console.log(`\nCost figure 2 — penalties_missed cross-check: too small to read (n=${crossCheck.n} candidates, need >= ${MIN_CROSSCHECK_POPULATION}).`)
      } else {
        console.log(
          `\nCost figure 2 — penalties_missed cross-check: ${crossCheck.withPenaltiesMissedOnRecord} of ${crossCheck.n} flagged candidates ` +
            `(${((crossCheck.withPenaltiesMissedOnRecord / crossCheck.n) * 100).toFixed(0)}%) have a penalty miss on record ` +
            '(players.penalties_missed, current season — a season-mismatch caveat applies when `season` above is not the current one; see the backlog entry).',
        )
      }

      // --------------------------------------------------------------
      // 4. Captaincy figure — player_projections. Best-effort: a missing
      //    or empty table does not fail the diagnostic, since this figure
      //    only exists once the current season's model has produced
      //    enough gameweeks of output to be worth reading.
      // --------------------------------------------------------------
      try {
        const { rows: projectionRows, error: projectionsError } = await fetchAllPages<ProjectionRow>((from, to) =>
          supabase
            .from('player_projections')
            .select('gameweek_id, player_id, expected_points')
            .eq('model_version', MODEL_VERSION)
            .order('gameweek_id', { ascending: true })
            .order('player_id', { ascending: true })
            .range(from, to)
            .returns<ProjectionRow[]>(),
        )
        if (projectionsError) {
          if (isMissingTable(projectionsError, 'player_projections')) {
            console.log(
              `\nCost figure 3 — captaincy overlap: the "player_projections" table does not exist yet. Apply ${PLAYER_PROJECTIONS_MIGRATION} first. Skipped.`,
            )
          } else {
            console.log(`\nCost figure 3 — captaincy overlap: player_projections lookup failed (${projectionsError.message}). Skipped.`)
          }
        } else {
          const rowsForCaptaincy: ProjectionRowForCaptaincy[] = []
          for (const row of projectionRows) {
            const code = codeById.get(row.player_id)
            if (code === undefined || row.expected_points === null) continue
            rowsForCaptaincy.push({ gameweekId: row.gameweek_id, playerCode: code, expectedPoints: row.expected_points })
          }
          const topProjectedByGameweek = computeTopProjectedPerGameweek(rowsForCaptaincy)
          const candidateCodes = new Set(identification.candidates.map((c) => c.playerCode))
          const overlap = computeCaptaincyOverlap(candidateCodes, topProjectedByGameweek)
          if (overlap.tooSmallToRead) {
            console.log(
              `\nCost figure 3 — captaincy overlap: too small to read (${overlap.gameweeksMeasured} gameweeks measured, need >= ${MIN_CAPTAINCY_GAMEWEEKS}).`,
            )
          } else {
            console.log(
              `\nCost figure 3 — captaincy overlap: a flagged candidate was the single top-projected player in ${overlap.gameweeksWithCandidateOnTop} ` +
                `of ${overlap.gameweeksMeasured} measured gameweeks (${(overlap.rate * 100).toFixed(0)}%).`,
            )
          }
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err)
        console.log(`\nCost figure 3 — captaincy overlap: unexpected failure (${message}). Skipped, not fatal.`)
      }
    }

    // ------------------------------------------------------------------
    // 5. penalties_order — the live bootstrap-static/ check.
    // ------------------------------------------------------------------
    const penaltiesOrder = await fetchLivePenaltiesOrderAvailability()
    console.log('\npenalties_order availability (live bootstrap-static/):')
    if (penaltiesOrder === null) {
      console.log('  Could not be confirmed this run — see above for the network error.')
    } else if (!penaltiesOrder.available) {
      console.log(`  NOT PRESENT — checked ${penaltiesOrder.totalElements} elements, field does not exist on the payload.`)
    } else {
      console.log(`  PRESENT — ${penaltiesOrder.nonNullCount} of ${penaltiesOrder.totalElements} elements have a non-null penalties_order value.`)
    }

    console.log('\nSee docs/projection-model-backlog.md for the argued recommendation from a full run of this diagnostic.\n')
    process.exit(0)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: failed: ${message}`)
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
