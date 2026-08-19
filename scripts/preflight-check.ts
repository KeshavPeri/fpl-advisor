// Preflight check — ticket #69. GW1 locks 01:30 Singapore time, Saturday 22
// August 2026. Every job in the chain (ingest, projection, CSV, solve,
// recommendation, notification) has run end to end at least once. The risk
// from here to Friday is not that something is unbuilt — it is that
// something quietly stops being true and nobody notices until the
// notification fails to arrive or arrives carrying nonsense. Every failure
// this project has actually had was of that shape (an unapplied migration,
// a silently-truncated read fixed by scripts/lib/paginate.ts, ClubElo
// ratings attached to the wrong clubs, cup matches counted as league form
// fixed by scripts/lib/competition.ts) — each job reported success because
// each job only checks its own step. This file is the one job that reads
// what already exists across the whole chain and reports whether it holds
// together, right now.
//
// ============================================================================
// READ-ONLY. This job's only job is to be trusted.
// ============================================================================
// This file never writes to any table except job_runs, and never sends
// anything anywhere. It does not repair, re-run, re-trigger or notify — a
// check that tried to fix what it finds is a check nobody could trust. And
// it never returns "pass" for something it could not actually evaluate: a
// missing table, a query error, or an empty result all resolve to FAIL with
// a stated reason (see buildCannotEvaluateResult below), never silently to
// pass. A false "pass" on a missing table converts an unknown into a false
// reassurance — precisely the failure mode every incident named above
// shares.
//
// ============================================================================
// Partial evaluation, not all-or-nothing.
// ============================================================================
// Every other scripts/*.ts job throws on a missing table or a query error
// and lets that abort the entire run — correct for a job that does one
// thing. This job does ten independent things, and a single missing table
// (say, `recommendations`) must not blank out the other nine checks that
// have nothing to do with it. Every Supabase read below therefore goes
// through safeFetchAllPages / safeMaybeSingle / safeCount (this file's own
// small wrappers around scripts/lib/paginate.ts's fetchAllPages /
// assertRowCountMatches), which never throw — they return `{ ..., error }`,
// and the caller turns a non-null error into a FAIL CheckResult for exactly
// the check(s) that depend on that read, letting every independent check
// still run. Only a genuine unhandled exception (a bug, not an expected
// data-shape failure) reaches the outer try/catch and aborts the whole run
// — see main()'s own catch block, which mirrors every other job's.
//
// ============================================================================
// Checks 2-5 and 9 cascade from check 1 (next-gameweek).
// ============================================================================
// "The next gameweek" is resolved exactly once, from the `gameweeks` row(s)
// marked `is_next` (check 1's own subject) — never re-derived per check, so
// every check that names a gameweek names the SAME one. If zero or more
// than one row is marked `is_next`, no target gameweek exists and checks 2
// (squad), 3 (projections), 4 (recommendation), 5 (solver) and 9
// (notifications) all report FAIL with a reason pointing back at check 1,
// rather than guessing which gameweek to use. If exactly one row is marked
// `is_next` but its OWN deadline has already passed (check 1 itself fails
// on that), the gameweek id is still well-defined and every dependent check
// still evaluates against it — a passed deadline is a real, useful thing to
// know about a squad/projection/solve/recommendation/notification, not a
// reason to stop looking.
//
// ============================================================================
// Fail vs warn — decided in the ticket, restated here so the assertion
// functions below are self-explanatory without cross-referencing it.
// ============================================================================
// FAIL: anything that would make Friday's notification wrong or absent — no
// next gameweek, no squad or a malformed one, no/broken projections, no
// recommendation (or one stale relative to the last solve), a non-optimal
// or infeasible solve, every player_match_stats row not carrying a
// competition, a player over the 38-match season cap, a tracked job whose
// most recent run failed or is stale, a missing required env var that would
// itself make the notification absent (Supabase or Telegram credentials),
// or the deadline having passed with no scheduled notification ever sent.
// WARN: degrades quality without breaking the chain — a team with a null
// ClubElo rating, a horizon fixture falling back to FPL's own difficulty
// scale, a projection row count slightly (not drastically) under the
// player count, a missing FPL_ENTRY_ID (squad can still be entered
// manually). See decisions/ticket-69.md for the two calls that were
// genuinely ambiguous (all-zero projection rows; TELEGRAM_* severity).
//
// ============================================================================
// job_runs.job_name — 'solver-run' is shared by THREE scripts.
// ============================================================================
// build-solver-input.ts, store-solver-output.ts and
// generate-recommendations.ts all write job_runs with job_name = 'solver-run'
// (verified directly against all three files) — there is no distinct
// job_name = 'generate-recommendations' row anywhere in job_runs. Check 8
// (job freshness) is asked for both 'solver-run' and 'generate-recommendations'
// as separate, named freshness signals. Rather than let the
// 'generate-recommendations' entry permanently and uninformatively FAIL
// (there being no row under that job_name, ever, regardless of the chain's
// real health), this file disambiguates using the message-prefix convention
// EVERY ONE of those three scripts already writes on every row —
// `${JOB_NAME}/build-solver-input: ...`, `${JOB_NAME}/store-solver-output: ...`,
// `${JOB_NAME}/generate-recommendations: ...` (verified by reading all
// three files' own message strings). 'solver-run' below means "the most
// recent row under job_name='solver-run', from any of the three scripts";
// 'generate-recommendations' means "the most recent row under
// job_name='solver-run' whose message starts with
// 'solver-run/generate-recommendations:'" — a read-only, additive technique
// that touches none of those three existing files. See
// decisions/ticket-69.md (Tier 2): if a future ticket ever changes that
// message-prefix convention, this specific sub-check starts reporting FAIL
// (no matching row found) rather than silently reporting nothing — the
// correct failure mode for this file's own stated purpose.
//
// ============================================================================
// Pagination — the DoD's "every Supabase read uses the shared pagination
// helper" applies to every read that can return more than one row.
// ============================================================================
// Two classes of read are structurally exempt, matching the precedent in
// decisions/ticket-43.md and decisions/ticket-47.md ("single-row
// primary-key lookups... are plain queries, not paginated"):
//   - A `.select('*', { count: 'exact', head: true })` count-only query
//     returns zero data rows by construction (head: true) — there is
//     nothing for scripts/lib/paginate.ts's db-max-rows bug to truncate.
//   - A query bounded to at most one row by a unique key or by `.limit(1)`
//     (squads by gameweek_id, recommendations by (gameweek_id, plan_index),
//     the single most-recent solver_runs/job_runs row) cannot return a
//     second row for the cap to silently trim — see safeMaybeSingle below.
// Every read that can genuinely return more than one row — gameweeks,
// teams, fixtures, squad_picks, player_projections, player_match_stats,
// notifications — goes through safeFetchAllPages, which pages via
// fetchAllPages and count-checks via assertRowCountMatches, exactly like
// every other scripts/*.ts job since ticket #43.
//
// ============================================================================
// Wiring.
// ============================================================================
// Reads exactly SUPABASE_URL and SUPABASE_SECRET_KEY to connect, plus
// PREFLIGHT_REPORT_PATH (optional, defaulted) for where to write the report.
// Check 10 (configuration) additionally reads the PRESENCE — never the
// value — of TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and FPL_ENTRY_ID, which
// this job does not otherwise use. Writes to no table but job_runs (one row
// per execution, never upserted). Makes no network request other than to
// Supabase — the strings 'fantasy.premierleague.com', 'api.telegram.org'
// and 'raw.githubusercontent.com' appear nowhere in this file, and it
// issues no insert/upsert/update/delete against any table but job_runs.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'
import { PREMIER_LEAGUE_COMPETITION } from './lib/competition.ts'
import { formatSyncTimestamp } from '../src/lib/format.ts'

const JOB_NAME = 'preflight-check'
const DEFAULT_REPORT_PATH = './out/preflight-report.md'
const MS_PER_HOUR = 60 * 60 * 1000

/** Must match scripts/project-points.ts's own MODEL_VERSION — duplicated, not imported (every scripts/*.ts job is a standalone entry point; src/lib/ is the one blessed cross-script import boundary, per CLAUDE.md and every prior job's own header). */
const MODEL_VERSION = 'baseline-v1'

/** Must match scripts/project-points.ts's own PROJECTION_HORIZON — duplicated for the same reason as MODEL_VERSION above. The window of upcoming gameweeks over which check 6 (team ratings) counts fixtures falling back to the FPL-difficulty scale. */
const PREFLIGHT_HORIZON = 5

/** The solver's own verbatim HiGHS status string for a proven optimum (scripts/store-solver-output.ts's own file header: "never classified as optimal" for anything else). Not an enum — the solver is a pinned third-party dependency and this is its exact wording. */
const OPTIMAL_SOLVER_STATUS = 'Optimal'

/** A season has at most 38 Premier League gameweeks, so no player can have more than 38 Premier-League player_match_stats rows in one season. Check 7. */
const MAX_PREMIER_LEAGUE_MATCHES_PER_SEASON = 38

/**
 * Job freshness threshold (check 8). The nightly ingest/projection workflow
 * runs once daily (.github/workflows/scheduled-jobs.yml, 17:45 UTC), so a
 * healthy job is always under about 25 hours old; 36 hours leaves room for
 * one delayed cron run without going green on a job that has genuinely
 * stopped. One named constant, one comment, per the ticket's own Notes.
 */
const STALE_JOB_HOURS = 36

/**
 * Coverage tolerances for check 3 (projections). A row COUNT slightly under
 * the players count is a WARN, per the ticket's own Notes ("a projection
 * count slightly under the player count"); a count catastrophically under
 * it (most players have no projection at all) is functionally the same as
 * "no projections" and is a FAIL. Both are Tier 3, decided here — no
 * calibration data exists yet for where "slightly" should sit exactly, so
 * these are round, conservative numbers rather than fitted ones. See
 * decisions/ticket-69.md.
 */
const PROJECTION_COVERAGE_WARN_THRESHOLD = 0.95
const PROJECTION_COVERAGE_FAIL_THRESHOLD = 0.5

/**
 * Clock-skew tolerance for check 4 (recommendation freshness). generate-
 * recommendations.ts writes `recommendations.updated_at` moments after
 * store-solver-output.ts writes `solver_runs.created_at`, in the same
 * workflow run — the recommendation should never predate the solve it was
 * built from. A small positive buffer, not zero, so this check cannot flag
 * a false stale reading from ordinary clock/round-trip jitter between two
 * back-to-back writes. Tier 3, decided here.
 */
const RECOMMENDATION_STALE_TOLERANCE_MS = 5 * 60 * 1000

/** The two window triggers scripts/notification-schedule.ts can fire — mirrors src/lib/notification/schedule.ts's own ScheduledTrigger type (never imported: that module decides WHEN to send; this file only reads what has already been sent). 'manual' sends never occupy either window's slot, matching that module's own doc comment, so this file never asks about it. */
type ScheduledTrigger = 'deadline_24h' | 'deadline_10h'
const SCHEDULED_TRIGGERS: readonly ScheduledTrigger[] = ['deadline_24h', 'deadline_10h']
/** Mirrors src/lib/notification/schedule.ts's own DEADLINE_10H_WINDOW_HOURS — the instant at or inside which deadline_24h can no longer fire (that module: "at or inside 10h remaining... REGARDLESS of whether deadline_24h already fired or was missed entirely"). Duplicated, not imported: this file only reports what already happened, never decides a send. */
const DEADLINE_10H_WINDOW_HOURS = 10

// ============================================================================
// Env
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
      `${JOB_NAME}: required environment variables are not set. Both SUPABASE_URL and SUPABASE_SECRET_KEY must be set ` +
        `(missing: ${missing.join(', ')}). Making no network call.`,
    )
    return null
  }
  return { url: url as string, secretKey: secretKey as string }
}

function readReportPath(): string {
  return process.env.PREFLIGHT_REPORT_PATH ?? DEFAULT_REPORT_PATH
}

// ============================================================================
// Errors — a genuine unhandled exception only. Every expected data-shape
// failure (missing table, empty result) is turned into a FAIL CheckResult
// instead of thrown — see the file header's "Partial evaluation" section.
// ============================================================================

export class PreflightCheckError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'PreflightCheckError'
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

/** Turns a Postgrest-level error into a one-line, human-readable reason string — never throws, never includes anything but the table name and the database's own error text. */
function describeError(tableName: string, error: PostgrestLikeError): string {
  if (isMissingTable(error, tableName)) {
    return `cannot evaluate — the "${tableName}" table does not exist or is not reachable (${error.message ?? error.code ?? 'unknown error'}).`
  }
  return `cannot evaluate — "${tableName}" query failed (${error.message ?? error.code ?? 'unknown error'}).`
}

// ============================================================================
// job_runs
// ============================================================================

type JsonRecord = Record<string, unknown>

interface JobRunInput {
  status: 'success' | 'failure'
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
// Pure assertion logic — no I/O. Every function below takes already-queried
// plain values and returns a CheckResult. This is the part of the file the
// DoD asks to be unit-tested with no database — see preflight-check.test.ts.
// ============================================================================

export type Verdict = 'pass' | 'warn' | 'fail'

export interface CheckResult {
  id: string
  verdict: Verdict
  reason: string
  values: JsonRecord
}

const VERDICT_RANK: Record<Verdict, number> = { pass: 0, warn: 1, fail: 2 }

/** The overall verdict is the worst individual result — pass < warn < fail. */
export function worstVerdict(verdicts: readonly Verdict[]): Verdict {
  return verdicts.reduce<Verdict>((worst, v) => (VERDICT_RANK[v] > VERDICT_RANK[worst] ? v : worst), 'pass')
}

export function computeOverallVerdict(checks: readonly CheckResult[]): Verdict {
  return worstVerdict(checks.map((c) => c.verdict))
}

/** Used whenever a check's own data could not be fetched, or a check depends on a gameweek check 1 could not uniquely resolve. Always FAIL, per the ticket: "a check that cannot be evaluated... returns fail with the reason, never pass." */
export function buildCannotEvaluateResult(id: string, reason: string): CheckResult {
  return { id, verdict: 'fail', reason, values: {} }
}

/** Shared by checks 2-5 and 9 whenever check 1 could not resolve exactly one `is_next` gameweek. */
export const UNRESOLVED_GAMEWEEK_REASON = 'cannot evaluate — the next gameweek could not be uniquely determined (see the "next-gameweek" check).'

// ----------------------------------------------------------------------------
// 1. Next gameweek
// ----------------------------------------------------------------------------

export interface NextGameweekInput {
  /** Every `gameweeks` row with `is_next = true`. Normally exactly one. */
  nextGameweeks: ReadonlyArray<{ id: number; name: string; deadlineTimeMs: number }>
  nowMs: number
}

export function checkNextGameweek(input: NextGameweekInput): CheckResult {
  const { nextGameweeks, nowMs } = input
  if (nextGameweeks.length === 0) {
    return { id: 'next-gameweek', verdict: 'fail', reason: 'no "gameweeks" row is marked is_next.', values: { markedNextCount: 0 } }
  }
  if (nextGameweeks.length > 1) {
    return {
      id: 'next-gameweek',
      verdict: 'fail',
      reason: `${nextGameweeks.length} "gameweeks" rows are marked is_next; expected exactly one.`,
      values: { markedNextCount: nextGameweeks.length, gameweekIds: nextGameweeks.map((g) => g.id) },
    }
  }
  const gw = nextGameweeks[0]
  const hoursRemaining = (gw.deadlineTimeMs - nowMs) / MS_PER_HOUR
  const values = { markedNextCount: 1, gameweekId: gw.id, gameweekName: gw.name, hoursRemaining }
  if (hoursRemaining <= 0) {
    return {
      id: 'next-gameweek',
      verdict: 'fail',
      reason: `${gw.name}'s deadline already passed ${Math.abs(hoursRemaining).toFixed(2)}h ago but it is still marked is_next.`,
      values,
    }
  }
  return { id: 'next-gameweek', verdict: 'pass', reason: `${gw.name}, deadline in ${hoursRemaining.toFixed(2)}h.`, values }
}

// ----------------------------------------------------------------------------
// 2. Squad
// ----------------------------------------------------------------------------

export interface SquadCheckInput {
  gameweekId: number
  squadExists: boolean
  picks: ReadonlyArray<{ isStarting: boolean; isCaptain: boolean; isViceCaptain: boolean }>
}

export function checkSquad(input: SquadCheckInput): CheckResult {
  const { gameweekId, squadExists, picks } = input
  if (!squadExists) {
    return { id: 'squad', verdict: 'fail', reason: `no "squads" row exists for gameweek ${gameweekId}.`, values: { gameweekId, squadExists } }
  }
  const startingCount = picks.filter((p) => p.isStarting).length
  const captainCount = picks.filter((p) => p.isCaptain).length
  const viceCaptainCount = picks.filter((p) => p.isViceCaptain).length
  const values = { gameweekId, squadExists, pickCount: picks.length, startingCount, captainCount, viceCaptainCount }

  const problems: string[] = []
  if (picks.length !== 15) problems.push(`${picks.length} squad_picks row(s) (expected 15)`)
  if (startingCount !== 11) problems.push(`${startingCount} starting (expected 11)`)
  if (captainCount !== 1) problems.push(`${captainCount} captain(s) (expected 1)`)
  if (viceCaptainCount !== 1) problems.push(`${viceCaptainCount} vice-captain(s) (expected 1)`)

  if (problems.length > 0) {
    return { id: 'squad', verdict: 'fail', reason: `squad for gameweek ${gameweekId} is malformed: ${problems.join(', ')}.`, values }
  }
  return { id: 'squad', verdict: 'pass', reason: `squad for gameweek ${gameweekId}: 15 picks, 11 starting, 1 captain, 1 vice-captain.`, values }
}

// ----------------------------------------------------------------------------
// 3. Projections
// ----------------------------------------------------------------------------

export interface ProjectionsCheckInput {
  gameweekId: number
  modelVersion: string
  projectionRowCount: number
  playersCount: number
  allZeroRowCount: number
  coverageWarnThreshold: number
  coverageFailThreshold: number
}

export function checkProjections(input: ProjectionsCheckInput): CheckResult {
  const { gameweekId, modelVersion, projectionRowCount, playersCount, allZeroRowCount, coverageWarnThreshold, coverageFailThreshold } = input
  const coverage = playersCount > 0 ? projectionRowCount / playersCount : 0
  const values = { gameweekId, modelVersion, projectionRowCount, playersCount, coverage, allZeroRowCount }

  if (projectionRowCount === 0) {
    return { id: 'projections', verdict: 'fail', reason: `no "player_projections" rows for gameweek ${gameweekId}, model_version "${modelVersion}".`, values }
  }
  if (allZeroRowCount > 0) {
    return {
      id: 'projections',
      verdict: 'fail',
      reason: `${allZeroRowCount} of ${projectionRowCount} projection row(s) have zero expected_points AND zero expected_minutes.`,
      values,
    }
  }
  if (coverage < coverageFailThreshold) {
    return {
      id: 'projections',
      verdict: 'fail',
      reason: `projections cover only ${(coverage * 100).toFixed(1)}% of players (${projectionRowCount}/${playersCount}) — below the ${(coverageFailThreshold * 100).toFixed(0)}% floor.`,
      values,
    }
  }
  if (coverage < coverageWarnThreshold) {
    return {
      id: 'projections',
      verdict: 'warn',
      reason: `projections cover ${(coverage * 100).toFixed(1)}% of players (${projectionRowCount}/${playersCount}), below the ${(coverageWarnThreshold * 100).toFixed(0)}% target.`,
      values,
    }
  }
  return {
    id: 'projections',
    verdict: 'pass',
    reason: `${projectionRowCount} projection rows cover ${(coverage * 100).toFixed(1)}% of ${playersCount} players, none all-zero.`,
    values,
  }
}

// ----------------------------------------------------------------------------
// 4. Recommendation
// ----------------------------------------------------------------------------

export interface RecommendationCheckInput {
  gameweekId: number
  recommendation: { planIndex: number; updatedAtMs: number } | null
  lastSolverRunAtMs: number | null
  staleToleranceMs: number
}

export function checkRecommendation(input: RecommendationCheckInput): CheckResult {
  const { gameweekId, recommendation, lastSolverRunAtMs, staleToleranceMs } = input
  const values = { gameweekId, hasRecommendation: recommendation !== null, updatedAtMs: recommendation?.updatedAtMs ?? null, lastSolverRunAtMs }

  if (!recommendation) {
    return { id: 'recommendation', verdict: 'fail', reason: `no "recommendations" row at plan_index 0 for gameweek ${gameweekId}.`, values }
  }
  if (lastSolverRunAtMs === null) {
    return {
      id: 'recommendation',
      verdict: 'fail',
      reason: 'a recommendation exists but there is no "solver_runs" row to check its freshness against.',
      values,
    }
  }
  if (recommendation.updatedAtMs + staleToleranceMs < lastSolverRunAtMs) {
    return {
      id: 'recommendation',
      verdict: 'fail',
      reason:
        `recommendation for gameweek ${gameweekId} was last updated ${new Date(recommendation.updatedAtMs).toISOString()}, ` +
        `before the most recent solver run at ${new Date(lastSolverRunAtMs).toISOString()} — stale.`,
      values,
    }
  }
  return { id: 'recommendation', verdict: 'pass', reason: `recommendation for gameweek ${gameweekId} is at least as recent as the last solver run.`, values }
}

// ----------------------------------------------------------------------------
// 5. Solver
// ----------------------------------------------------------------------------

export interface SolverCheckInput {
  targetGameweekId: number
  latestRun: { gameweekId: number; solverStatus: string; createdAtMs: number } | null
}

export function checkSolver(input: SolverCheckInput): CheckResult {
  const { targetGameweekId, latestRun } = input
  if (!latestRun) {
    return { id: 'solver', verdict: 'fail', reason: 'no "solver_runs" row exists.', values: { targetGameweekId } }
  }
  const values = { targetGameweekId, solverGameweekId: latestRun.gameweekId, solverStatus: latestRun.solverStatus, createdAtMs: latestRun.createdAtMs }
  if (latestRun.gameweekId !== targetGameweekId) {
    return {
      id: 'solver',
      verdict: 'fail',
      reason: `most recent solver_runs row is for gameweek ${latestRun.gameweekId}, not the next gameweek ${targetGameweekId}.`,
      values,
    }
  }
  if (latestRun.solverStatus !== OPTIMAL_SOLVER_STATUS) {
    return {
      id: 'solver',
      verdict: 'fail',
      reason: `most recent solve for gameweek ${targetGameweekId} reports status "${latestRun.solverStatus}", not a proven optimum.`,
      values,
    }
  }
  return { id: 'solver', verdict: 'pass', reason: `most recent solve for gameweek ${targetGameweekId} is a proven optimum.`, values }
}

// ----------------------------------------------------------------------------
// 6. Team ratings — never an automatic failure, per the ticket.
// ----------------------------------------------------------------------------

export interface TeamRatingsCheckInput {
  nullEloTeamsCount: number
  totalTeamsCount: number
  fixturesFallbackCount: number
  totalFixturesInHorizon: number
}

export function checkTeamRatings(input: TeamRatingsCheckInput): CheckResult {
  const { nullEloTeamsCount, totalTeamsCount, fixturesFallbackCount, totalFixturesInHorizon } = input
  const values = { nullEloTeamsCount, totalTeamsCount, fixturesFallbackCount, totalFixturesInHorizon }
  if (nullEloTeamsCount > 0 || fixturesFallbackCount > 0) {
    return {
      id: 'team-ratings',
      verdict: 'warn',
      reason:
        `${nullEloTeamsCount}/${totalTeamsCount} team(s) have no ClubElo rating; ` +
        `${fixturesFallbackCount}/${totalFixturesInHorizon} fixture(s) in the ${PREFLIGHT_HORIZON}-gameweek horizon fall back to FPL difficulty.`,
      values,
    }
  }
  return { id: 'team-ratings', verdict: 'pass', reason: 'every team has a ClubElo rating; no horizon fixture uses the FDR fallback.', values }
}

// ----------------------------------------------------------------------------
// 7. Match data
// ----------------------------------------------------------------------------

export interface MatchDataCheckInput {
  totalRows: number
  nullCompetitionRows: number
  maxMatchesForAnyPlayerSeason: { playerCode: number; season: string; count: number } | null
  maxAllowedMatchesPerSeason: number
}

export function checkMatchData(input: MatchDataCheckInput): CheckResult {
  const { totalRows, nullCompetitionRows, maxMatchesForAnyPlayerSeason, maxAllowedMatchesPerSeason } = input
  const values = { totalRows, nullCompetitionRows, maxMatchesForAnyPlayerSeason, maxAllowedMatchesPerSeason }

  const problems: string[] = []
  if (nullCompetitionRows > 0) problems.push(`${nullCompetitionRows}/${totalRows} row(s) have no competition value`)
  if (maxMatchesForAnyPlayerSeason && maxMatchesForAnyPlayerSeason.count > maxAllowedMatchesPerSeason) {
    problems.push(
      `player_code ${maxMatchesForAnyPlayerSeason.playerCode} has ${maxMatchesForAnyPlayerSeason.count} Premier League matches in season ` +
        `${maxMatchesForAnyPlayerSeason.season} (max ${maxAllowedMatchesPerSeason})`,
    )
  }

  if (problems.length > 0) {
    return { id: 'match-data', verdict: 'fail', reason: `${problems.join('; ')}.`, values }
  }
  return {
    id: 'match-data',
    verdict: 'pass',
    reason: `every player_match_stats row carries a competition; no player exceeds ${maxAllowedMatchesPerSeason} Premier League matches in a season.`,
    values,
  }
}

// ----------------------------------------------------------------------------
// 8. Job freshness
// ----------------------------------------------------------------------------

export interface JobFreshnessTarget {
  id: string
  row: { status: string; startedAtMs: number } | null
  /** Set instead of `row` when this job's own job_runs read failed — reported verbatim rather than as "no row found", per the file header's cannot-evaluate rule. */
  fetchError?: string | null
}

export interface JobFreshnessResult {
  id: string
  verdict: Verdict
  reason: string
  status: string | null
  ageHours: number | null
}

export function checkOneJobFreshness(target: JobFreshnessTarget, nowMs: number, staleHours: number): JobFreshnessResult {
  const { id, row, fetchError } = target
  if (fetchError) {
    return { id, verdict: 'fail', reason: fetchError, status: null, ageHours: null }
  }
  if (!row) {
    return { id, verdict: 'fail', reason: `no job_runs row found for "${id}".`, status: null, ageHours: null }
  }
  const ageHours = (nowMs - row.startedAtMs) / MS_PER_HOUR
  if (row.status === 'failure') {
    return { id, verdict: 'fail', reason: `most recent "${id}" run failed, ${ageHours.toFixed(1)}h ago.`, status: row.status, ageHours }
  }
  if (ageHours > staleHours) {
    return {
      id,
      verdict: 'fail',
      reason: `most recent "${id}" run is ${ageHours.toFixed(1)}h old, past the ${staleHours}h staleness threshold.`,
      status: row.status,
      ageHours,
    }
  }
  return { id, verdict: 'pass', reason: `"${id}": ${row.status}, ${ageHours.toFixed(1)}h ago.`, status: row.status, ageHours }
}

export function checkJobFreshness(targets: readonly JobFreshnessTarget[], nowMs: number, staleHours: number): CheckResult {
  const perJob = targets.map((t) => checkOneJobFreshness(t, nowMs, staleHours))
  const verdict = worstVerdict(perJob.map((j) => j.verdict))
  const notPassing = perJob.filter((j) => j.verdict !== 'pass')
  const reason = notPassing.length > 0 ? notPassing.map((j) => j.reason).join(' | ') : "every tracked job's most recent run is healthy and fresh."
  return {
    id: 'job-freshness',
    verdict,
    reason,
    values: {
      staleHoursThreshold: staleHours,
      jobs: Object.fromEntries(perJob.map((j) => [j.id, { verdict: j.verdict, reason: j.reason, status: j.status, ageHours: j.ageHours }])),
    },
  }
}

// ----------------------------------------------------------------------------
// 9. Notifications
// ----------------------------------------------------------------------------

export interface NotificationsCheckInput {
  gameweekId: number
  deadlineMs: number
  nowMs: number
  sentTriggers: ReadonlySet<ScheduledTrigger>
}

export function checkNotifications(input: NotificationsCheckInput): CheckResult {
  const { gameweekId, deadlineMs, nowMs, sentTriggers } = input
  const hoursRemaining = (deadlineMs - nowMs) / MS_PER_HOUR
  const sent24h = sentTriggers.has('deadline_24h')
  const sent10h = sentTriggers.has('deadline_10h')
  // Mirrors src/lib/notification/schedule.ts's own window rule: deadline_24h
  // can only ever fire strictly outside the 10h window, and deadline_10h can
  // only ever fire before the deadline itself.
  const deadline24hReachable = hoursRemaining > DEADLINE_10H_WINDOW_HOURS
  const deadline10hReachable = hoursRemaining > 0
  const values = { gameweekId, hoursRemaining, sent24h, sent10h, deadline24hReachable, deadline10hReachable }

  if (hoursRemaining <= 0) {
    if (!sent10h) {
      return {
        id: 'notifications',
        verdict: 'fail',
        reason: `the deadline for gameweek ${gameweekId} has passed and deadline_10h was never sent — the notification never arrived.`,
        values,
      }
    }
    return { id: 'notifications', verdict: 'pass', reason: `deadline_10h was sent for gameweek ${gameweekId} before its deadline.`, values }
  }

  const status24h = sent24h ? 'sent' : deadline24hReachable ? 'not yet due' : 'window closed, never sent (expected — the tighter window takes over)'
  const status10h = sent10h ? 'sent' : 'still reachable'
  return {
    id: 'notifications',
    verdict: 'pass',
    reason: `gameweek ${gameweekId}, ${hoursRemaining.toFixed(1)}h remaining — deadline_24h: ${status24h}; deadline_10h: ${status10h}.`,
    values,
  }
}

// ----------------------------------------------------------------------------
// 10. Configuration — names and presence only. No value is ever read into
//     the result: `present`/`missing` carry variable NAMES, never
//     `process.env[name]` itself. See preflight-check.test.ts for the named
//     test proving this (DoD: "verifiable by test").
// ----------------------------------------------------------------------------

type EnvSeverity = 'fail' | 'warn'

interface EnvVarSpec {
  name: string
  ifMissing: EnvSeverity
}

/**
 * Every environment variable ANY job in this chain requires, not only this
 * job's own two (SUPABASE_URL / SUPABASE_SECRET_KEY). TELEGRAM_BOT_TOKEN and
 * TELEGRAM_CHAT_ID are FAIL if missing: scripts/send-telegram.ts and
 * scripts/notification-schedule.ts both exit zero and send nothing at all
 * when either is unset (by design, so the workflow is safe to run before
 * the bot exists) — but that same design means an unset Telegram credential
 * TODAY guarantees an absent notification, which is this ticket's own FAIL
 * criterion verbatim. FPL_ENTRY_ID is WARN: scripts/sync-squad.ts degrades
 * gracefully when it is unset (the squad can still be entered manually), so
 * this is a quality degradation, not a broken chain. Tier 2, logged in
 * decisions/ticket-69.md.
 */
export const REQUIRED_ENV_VAR_SPECS: readonly EnvVarSpec[] = [
  { name: 'SUPABASE_URL', ifMissing: 'fail' },
  { name: 'SUPABASE_SECRET_KEY', ifMissing: 'fail' },
  { name: 'TELEGRAM_BOT_TOKEN', ifMissing: 'fail' },
  { name: 'TELEGRAM_CHAT_ID', ifMissing: 'fail' },
  { name: 'FPL_ENTRY_ID', ifMissing: 'warn' },
]

export function checkConfiguration(
  env: Readonly<Record<string, string | undefined>>,
  specs: readonly EnvVarSpec[] = REQUIRED_ENV_VAR_SPECS,
): CheckResult {
  const present: string[] = []
  const missing: EnvVarSpec[] = []
  for (const spec of specs) {
    const value = env[spec.name]
    if (typeof value === 'string' && value.length > 0) {
      present.push(spec.name)
    } else {
      missing.push(spec)
    }
  }
  const values = { present, missing: missing.map((m) => m.name) }
  if (missing.length === 0) {
    return { id: 'configuration', verdict: 'pass', reason: `all ${specs.length} tracked environment variable(s) are set.`, values }
  }
  const verdict: Verdict = missing.some((m) => m.ifMissing === 'fail') ? 'fail' : 'warn'
  return { id: 'configuration', verdict, reason: `missing: ${missing.map((m) => m.name).join(', ')}.`, values }
}

// ============================================================================
// Report generation — pure formatting, not independently unit-tested (not a
// DoD item; the assertion logic above is), kept out of main() for the same
// reason every other job's report builder is.
// ============================================================================

const VERDICT_LABEL: Record<Verdict, string> = { pass: 'PASS', warn: 'WARN', fail: 'FAIL' }

const CHECK_ORDER: readonly string[] = [
  'next-gameweek',
  'squad',
  'projections',
  'recommendation',
  'solver',
  'team-ratings',
  'match-data',
  'job-freshness',
  'notifications',
  'configuration',
]

const CHECK_TITLES: Readonly<Record<string, string>> = {
  'next-gameweek': 'Next gameweek',
  squad: 'Squad',
  projections: 'Projections',
  recommendation: 'Recommendation',
  solver: 'Solver',
  'team-ratings': 'Team ratings',
  'match-data': 'Match data',
  'job-freshness': 'Job freshness',
  notifications: 'Notifications',
  configuration: 'Configuration',
}

function formatValues(values: JsonRecord): string {
  const entries = Object.entries(values)
  if (entries.length === 0) return '(no values)'
  return entries.map(([k, v]) => `${k}=${JSON.stringify(v)}`).join(', ')
}

interface ReportData {
  generatedAt: Date
  overallVerdict: Verdict
  targetGameweekName: string | null
  targetDeadlineMs: number | null
  nowMs: number
  checks: readonly CheckResult[]
}

function generateReportMarkdown(data: ReportData): string {
  const { generatedAt, overallVerdict, targetGameweekName, targetDeadlineMs, nowMs, checks } = data
  const sections: string[] = []

  const headlineHours = targetDeadlineMs !== null ? (targetDeadlineMs - nowMs) / MS_PER_HOUR : null
  const deadlineLine =
    targetGameweekName !== null && targetDeadlineMs !== null
      ? `${targetGameweekName} — deadline ${formatSyncTimestamp(new Date(targetDeadlineMs).toISOString())} (Asia/Singapore) — ` +
        `${headlineHours !== null ? headlineHours.toFixed(2) : 'n/a'}h remaining.`
      : 'No single gameweek is currently marked as next — see the "Next gameweek" check below.'

  sections.push(
    `# Preflight check\n\n**Overall: ${VERDICT_LABEL[overallVerdict]}**\n\n${deadlineLine}\n\nGenerated: ${generatedAt.toISOString()} · Job: \`${JOB_NAME}\``,
  )

  const summaryHeader = '| # | Check | Verdict | Reason |\n|---|---|---|---|'
  const summaryRows = CHECK_ORDER.map((id, i) => {
    const check = checks.find((c) => c.id === id)
    if (!check) return `| ${i + 1} | ${CHECK_TITLES[id]} | — | (not evaluated) |`
    return `| ${i + 1} | ${CHECK_TITLES[id]} | ${VERDICT_LABEL[check.verdict]} | ${check.reason.replace(/\|/g, '\\|')} |`
  })
  sections.push(['## Checks', summaryHeader, ...summaryRows].join('\n'))

  const detailSections = CHECK_ORDER.map((id, i) => {
    const check = checks.find((c) => c.id === id)
    if (!check) return `### ${i + 1}. ${CHECK_TITLES[id]} — NOT EVALUATED`
    return `### ${i + 1}. ${CHECK_TITLES[id]} — ${VERDICT_LABEL[check.verdict]}\n\n${check.reason}\n\nValues: ${formatValues(check.values)}`
  })
  sections.push(['## Details', ...detailSections].join('\n\n'))

  return `${sections.join('\n\n')}\n`
}

// ============================================================================
// Safe Supabase read wrappers — never throw. Every caller in main() turns a
// non-null `error` into a FAIL CheckResult for exactly the check(s) that
// depend on it; every other check keeps evaluating. See the file header's
// "Partial evaluation" section.
// ============================================================================

interface SafeRowsResult<T> {
  rows: T[]
  error: string | null
}

async function safeFetchAllPages<T>(
  tableName: string,
  fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: PostgrestLikeError | null }>,
  fetchExpectedCount: () => PromiseLike<{ count: number | null; error: PostgrestLikeError | null }>,
): Promise<SafeRowsResult<T>> {
  const { rows, error } = await fetchAllPages<T>(fetchPage)
  if (error) {
    return { rows: [], error: describeError(tableName, error) }
  }
  const { count, error: countError } = await fetchExpectedCount()
  if (countError) {
    return { rows: [], error: `cannot evaluate — "${tableName}" count check failed (${countError.message ?? countError.code ?? 'unknown error'}).` }
  }
  try {
    assertRowCountMatches(tableName, rows.length, count ?? 0)
  } catch (err) {
    return { rows: [], error: err instanceof Error ? err.message : String(err) }
  }
  return { rows, error: null }
}

interface SafeSingleResult<T> {
  row: T | null
  error: string | null
}

async function safeMaybeSingle<T>(
  tableName: string,
  run: () => PromiseLike<{ data: T | null; error: PostgrestLikeError | null }>,
): Promise<SafeSingleResult<T>> {
  const { data, error } = await run()
  if (error) {
    return { row: null, error: describeError(tableName, error) }
  }
  return { row: data ?? null, error: null }
}

interface SafeCountResult {
  count: number
  error: string | null
}

async function safeCount(tableName: string, run: () => PromiseLike<{ count: number | null; error: PostgrestLikeError | null }>): Promise<SafeCountResult> {
  const { count, error } = await run()
  if (error) {
    return { count: 0, error: describeError(tableName, error) }
  }
  return { count: count ?? 0, error: null }
}

// ============================================================================
// Row shapes read from Supabase — only the fields this job uses.
// ============================================================================

interface GameweekRow {
  id: number
  name: string
  deadline_time: string
  is_next: boolean
}

interface TeamRow {
  id: number
  elo: number | null
}

interface FixtureRow {
  team_h: number
  team_a: number
}

interface SquadPickRow {
  is_starting: boolean
  is_captain: boolean
  is_vice_captain: boolean
}

interface ProjectionRow {
  expected_points: number
  expected_minutes: number
}

interface SolverRunRow {
  gameweek_id: number
  solver_status: string
  created_at: string
}

interface RecommendationRow {
  plan_index: number
  updated_at: string
}

interface MatchStatsGroupRow {
  player_code: number | null
  season: string
}

interface NotificationRow {
  trigger: string
}

interface JobRunFreshnessRow {
  status: string
  started_at: string
}

// ============================================================================
// job_runs freshness targets — check 8. See the file header for why
// 'solver-run' and 'generate-recommendations' both filter job_name =
// 'solver-run' and are told apart by message prefix.
// ============================================================================

interface JobFreshnessTargetSpec {
  id: string
  jobName: string
  messagePrefix?: string
}

const JOB_FRESHNESS_TARGETS: readonly JobFreshnessTargetSpec[] = [
  { id: 'ingest-fpl', jobName: 'ingest-fpl' },
  { id: 'ingest-core-insights', jobName: 'ingest-core-insights' },
  { id: 'sync-squad', jobName: 'sync-squad' },
  { id: 'project-points', jobName: 'project-points' },
  { id: 'emit-projections-csv', jobName: 'emit-projections-csv' },
  { id: 'solver-run', jobName: 'solver-run' },
  { id: 'generate-recommendations', jobName: 'solver-run', messagePrefix: 'solver-run/generate-recommendations:' },
]

// ============================================================================
// Main
// ============================================================================

async function main(): Promise<void> {
  const startedAt = new Date()
  const nowMs = startedAt.getTime()
  const env = readSupabaseEnv()
  if (!env) {
    process.exit(1)
    return
  }
  const reportPath = readReportPath()
  const supabase = createClient(env.url, env.secretKey)
  const checks: CheckResult[] = []

  try {
    // --------------------------------------------------------------------
    // 1. gameweeks — resolves the ONE target gameweek every other check
    //    below reuses. See file header for the cascade rule.
    // --------------------------------------------------------------------
    const gwRead = await safeFetchAllPages<GameweekRow>(
      'gameweeks',
      (from, to) => supabase.from('gameweeks').select('id, name, deadline_time, is_next').order('id', { ascending: true }).range(from, to).returns<GameweekRow[]>(),
      () => supabase.from('gameweeks').select('*', { count: 'exact', head: true }),
    )

    let targetGameweekId: number | null = null
    let targetGameweekName: string | null = null
    let targetDeadlineMs: number | null = null
    let gwRowsSorted: GameweekRow[] = []

    if (gwRead.error) {
      checks.push({ id: 'next-gameweek', verdict: 'fail', reason: gwRead.error, values: {} })
    } else {
      gwRowsSorted = gwRead.rows
      const nextRows = gwRowsSorted
        .filter((g) => g.is_next)
        .map((g) => ({ id: g.id, name: g.name, deadlineTimeMs: new Date(g.deadline_time).getTime() }))
      checks.push(checkNextGameweek({ nextGameweeks: nextRows, nowMs }))
      if (nextRows.length === 1) {
        targetGameweekId = nextRows[0].id
        targetGameweekName = nextRows[0].name
        targetDeadlineMs = nextRows[0].deadlineTimeMs
      }
    }

    // --------------------------------------------------------------------
    // 2. Squad
    // --------------------------------------------------------------------
    let squadCheck: CheckResult
    if (targetGameweekId === null) {
      squadCheck = buildCannotEvaluateResult('squad', UNRESOLVED_GAMEWEEK_REASON)
    } else {
      const squadRead = await safeMaybeSingle<{ gameweek_id: number }>('squads', () =>
        supabase.from('squads').select('gameweek_id').eq('gameweek_id', targetGameweekId as number).maybeSingle<{ gameweek_id: number }>(),
      )
      if (squadRead.error) {
        squadCheck = buildCannotEvaluateResult('squad', squadRead.error)
      } else {
        const picksRead = await safeFetchAllPages<SquadPickRow>(
          'squad_picks',
          (from, to) =>
            supabase
              .from('squad_picks')
              .select('is_starting, is_captain, is_vice_captain')
              .eq('gameweek_id', targetGameweekId as number)
              .range(from, to)
              .returns<SquadPickRow[]>(),
          () => supabase.from('squad_picks').select('*', { count: 'exact', head: true }).eq('gameweek_id', targetGameweekId as number),
        )
        if (picksRead.error) {
          squadCheck = buildCannotEvaluateResult('squad', picksRead.error)
        } else {
          squadCheck = checkSquad({
            gameweekId: targetGameweekId,
            squadExists: squadRead.row !== null,
            picks: picksRead.rows.map((p) => ({ isStarting: p.is_starting, isCaptain: p.is_captain, isViceCaptain: p.is_vice_captain })),
          })
        }
      }
    }
    checks.push(squadCheck)

    // --------------------------------------------------------------------
    // 3. Projections
    // --------------------------------------------------------------------
    let projectionsCheck: CheckResult
    if (targetGameweekId === null) {
      projectionsCheck = buildCannotEvaluateResult('projections', UNRESOLVED_GAMEWEEK_REASON)
    } else {
      const projRead = await safeFetchAllPages<ProjectionRow>(
        'player_projections',
        (from, to) =>
          supabase
            .from('player_projections')
            .select('expected_points, expected_minutes')
            .eq('gameweek_id', targetGameweekId as number)
            .eq('model_version', MODEL_VERSION)
            .range(from, to)
            .returns<ProjectionRow[]>(),
        () =>
          supabase
            .from('player_projections')
            .select('*', { count: 'exact', head: true })
            .eq('gameweek_id', targetGameweekId as number)
            .eq('model_version', MODEL_VERSION),
      )
      const playersCountRead = await safeCount('players', () => supabase.from('players').select('*', { count: 'exact', head: true }))
      if (projRead.error) {
        projectionsCheck = buildCannotEvaluateResult('projections', projRead.error)
      } else if (playersCountRead.error) {
        projectionsCheck = buildCannotEvaluateResult('projections', playersCountRead.error)
      } else {
        const allZeroRowCount = projRead.rows.filter((r) => r.expected_points === 0 && r.expected_minutes === 0).length
        projectionsCheck = checkProjections({
          gameweekId: targetGameweekId,
          modelVersion: MODEL_VERSION,
          projectionRowCount: projRead.rows.length,
          playersCount: playersCountRead.count,
          allZeroRowCount,
          coverageWarnThreshold: PROJECTION_COVERAGE_WARN_THRESHOLD,
          coverageFailThreshold: PROJECTION_COVERAGE_FAIL_THRESHOLD,
        })
      }
    }
    checks.push(projectionsCheck)

    // --------------------------------------------------------------------
    // 4 & 5. Recommendation and solver share one read of the most recent
    //    solver_runs row — see file header, "checks 2-5 and 9 cascade".
    // --------------------------------------------------------------------
    const solverRunRead = await safeMaybeSingle<SolverRunRow>('solver_runs', () =>
      supabase.from('solver_runs').select('gameweek_id, solver_status, created_at').order('created_at', { ascending: false }).limit(1).maybeSingle<SolverRunRow>(),
    )
    const latestSolverRun =
      solverRunRead.error || !solverRunRead.row
        ? null
        : { gameweekId: solverRunRead.row.gameweek_id, solverStatus: solverRunRead.row.solver_status, createdAtMs: new Date(solverRunRead.row.created_at).getTime() }

    let recommendationCheck: CheckResult
    if (targetGameweekId === null) {
      recommendationCheck = buildCannotEvaluateResult('recommendation', UNRESOLVED_GAMEWEEK_REASON)
    } else if (solverRunRead.error) {
      recommendationCheck = buildCannotEvaluateResult('recommendation', solverRunRead.error)
    } else {
      const recRead = await safeMaybeSingle<RecommendationRow>('recommendations', () =>
        supabase
          .from('recommendations')
          .select('plan_index, updated_at')
          .eq('gameweek_id', targetGameweekId as number)
          .eq('plan_index', 0)
          .maybeSingle<RecommendationRow>(),
      )
      if (recRead.error) {
        recommendationCheck = buildCannotEvaluateResult('recommendation', recRead.error)
      } else {
        recommendationCheck = checkRecommendation({
          gameweekId: targetGameweekId,
          recommendation: recRead.row ? { planIndex: recRead.row.plan_index, updatedAtMs: new Date(recRead.row.updated_at).getTime() } : null,
          lastSolverRunAtMs: latestSolverRun?.createdAtMs ?? null,
          staleToleranceMs: RECOMMENDATION_STALE_TOLERANCE_MS,
        })
      }
    }
    checks.push(recommendationCheck)

    let solverCheck: CheckResult
    if (solverRunRead.error) {
      solverCheck = buildCannotEvaluateResult('solver', solverRunRead.error)
    } else if (targetGameweekId === null) {
      solverCheck = buildCannotEvaluateResult('solver', UNRESOLVED_GAMEWEEK_REASON)
    } else {
      solverCheck = checkSolver({ targetGameweekId, latestRun: latestSolverRun })
    }
    checks.push(solverCheck)

    // --------------------------------------------------------------------
    // 6. Team ratings
    // --------------------------------------------------------------------
    let teamRatingsCheck: CheckResult
    if (targetGameweekId === null) {
      teamRatingsCheck = buildCannotEvaluateResult('team-ratings', UNRESOLVED_GAMEWEEK_REASON)
    } else {
      const teamsRead = await safeFetchAllPages<TeamRow>(
        'teams',
        (from, to) => supabase.from('teams').select('id, elo').range(from, to).returns<TeamRow[]>(),
        () => supabase.from('teams').select('*', { count: 'exact', head: true }),
      )
      if (teamsRead.error) {
        teamRatingsCheck = buildCannotEvaluateResult('team-ratings', teamsRead.error)
      } else {
        const targetIndex = gwRowsSorted.findIndex((g) => g.id === targetGameweekId)
        const horizonIds = targetIndex >= 0 ? gwRowsSorted.slice(targetIndex, targetIndex + PREFLIGHT_HORIZON).map((g) => g.id) : []
        if (horizonIds.length === 0) {
          teamRatingsCheck = buildCannotEvaluateResult(
            'team-ratings',
            `cannot evaluate — could not determine the ${PREFLIGHT_HORIZON}-gameweek horizon starting at gameweek ${targetGameweekId}.`,
          )
        } else {
          const fixturesRead = await safeFetchAllPages<FixtureRow>(
            'fixtures',
            (from, to) => supabase.from('fixtures').select('team_h, team_a').in('event_id', horizonIds).range(from, to).returns<FixtureRow[]>(),
            () => supabase.from('fixtures').select('*', { count: 'exact', head: true }).in('event_id', horizonIds),
          )
          if (fixturesRead.error) {
            teamRatingsCheck = buildCannotEvaluateResult('team-ratings', fixturesRead.error)
          } else {
            const eloById = new Map(teamsRead.rows.map((t) => [t.id, t.elo]))
            const nullEloTeamsCount = teamsRead.rows.filter((t) => t.elo === null).length
            const fixturesFallbackCount = fixturesRead.rows.filter(
              (f) => (eloById.get(f.team_h) ?? null) === null || (eloById.get(f.team_a) ?? null) === null,
            ).length
            teamRatingsCheck = checkTeamRatings({
              nullEloTeamsCount,
              totalTeamsCount: teamsRead.rows.length,
              fixturesFallbackCount,
              totalFixturesInHorizon: fixturesRead.rows.length,
            })
          }
        }
      }
    }
    checks.push(teamRatingsCheck)

    // --------------------------------------------------------------------
    // 7. Match data — independent of the target gameweek.
    // --------------------------------------------------------------------
    const totalMatchStatsRead = await safeCount('player_match_stats', () => supabase.from('player_match_stats').select('*', { count: 'exact', head: true }))
    const nullCompetitionRead = await safeCount('player_match_stats', () =>
      supabase.from('player_match_stats').select('*', { count: 'exact', head: true }).is('competition', null),
    )
    let matchDataCheck: CheckResult
    if (totalMatchStatsRead.error) {
      matchDataCheck = buildCannotEvaluateResult('match-data', totalMatchStatsRead.error)
    } else if (nullCompetitionRead.error) {
      matchDataCheck = buildCannotEvaluateResult('match-data', nullCompetitionRead.error)
    } else {
      const premRowsRead = await safeFetchAllPages<MatchStatsGroupRow>(
        'player_match_stats',
        (from, to) =>
          supabase
            .from('player_match_stats')
            .select('player_code, season')
            .eq('competition', PREMIER_LEAGUE_COMPETITION)
            .range(from, to)
            .returns<MatchStatsGroupRow[]>(),
        () => supabase.from('player_match_stats').select('*', { count: 'exact', head: true }).eq('competition', PREMIER_LEAGUE_COMPETITION),
      )
      if (premRowsRead.error) {
        matchDataCheck = buildCannotEvaluateResult('match-data', premRowsRead.error)
      } else {
        const counts = new Map<string, { playerCode: number; season: string; count: number }>()
        for (const row of premRowsRead.rows) {
          if (row.player_code === null) continue
          const key = `${row.player_code}|${row.season}`
          const existing = counts.get(key)
          if (existing) existing.count++
          else counts.set(key, { playerCode: row.player_code, season: row.season, count: 1 })
        }
        let maxEntry: { playerCode: number; season: string; count: number } | null = null
        for (const entry of counts.values()) {
          if (!maxEntry || entry.count > maxEntry.count) maxEntry = entry
        }
        matchDataCheck = checkMatchData({
          totalRows: totalMatchStatsRead.count,
          nullCompetitionRows: nullCompetitionRead.count,
          maxMatchesForAnyPlayerSeason: maxEntry,
          maxAllowedMatchesPerSeason: MAX_PREMIER_LEAGUE_MATCHES_PER_SEASON,
        })
      }
    }
    checks.push(matchDataCheck)

    // --------------------------------------------------------------------
    // 8. Job freshness — independent of the target gameweek. Each of the
    //    seven targets is read independently so one job's own read failure
    //    only fails that one sub-entry (see checkOneJobFreshness's
    //    fetchError path).
    // --------------------------------------------------------------------
    const jobFreshnessTargets: JobFreshnessTarget[] = []
    for (const target of JOB_FRESHNESS_TARGETS) {
      const read = await safeMaybeSingle<JobRunFreshnessRow>(target.jobName, () => {
        const base = supabase.from('job_runs').select('status, started_at').eq('job_name', target.jobName)
        const filtered = target.messagePrefix ? base.ilike('message', `${target.messagePrefix}%`) : base
        return filtered.order('started_at', { ascending: false }).limit(1).maybeSingle<JobRunFreshnessRow>()
      })
      if (read.error) {
        jobFreshnessTargets.push({ id: target.id, row: null, fetchError: read.error })
      } else {
        jobFreshnessTargets.push({
          id: target.id,
          row: read.row ? { status: read.row.status, startedAtMs: new Date(read.row.started_at).getTime() } : null,
        })
      }
    }
    checks.push(checkJobFreshness(jobFreshnessTargets, nowMs, STALE_JOB_HOURS))

    // --------------------------------------------------------------------
    // 9. Notifications
    // --------------------------------------------------------------------
    let notificationsCheck: CheckResult
    if (targetGameweekId === null || targetDeadlineMs === null) {
      notificationsCheck = buildCannotEvaluateResult('notifications', UNRESOLVED_GAMEWEEK_REASON)
    } else {
      const notifRead = await safeFetchAllPages<NotificationRow>(
        'notifications',
        (from, to) =>
          supabase
            .from('notifications')
            .select('trigger')
            .eq('gameweek_id', targetGameweekId as number)
            .eq('outcome', 'sent')
            .in('trigger', SCHEDULED_TRIGGERS)
            .range(from, to)
            .returns<NotificationRow[]>(),
        () =>
          supabase
            .from('notifications')
            .select('*', { count: 'exact', head: true })
            .eq('gameweek_id', targetGameweekId as number)
            .eq('outcome', 'sent')
            .in('trigger', SCHEDULED_TRIGGERS),
      )
      if (notifRead.error) {
        notificationsCheck = buildCannotEvaluateResult('notifications', notifRead.error)
      } else {
        notificationsCheck = checkNotifications({
          gameweekId: targetGameweekId,
          deadlineMs: targetDeadlineMs,
          nowMs,
          sentTriggers: new Set(notifRead.rows.map((r) => r.trigger as ScheduledTrigger)),
        })
      }
    }
    checks.push(notificationsCheck)

    // --------------------------------------------------------------------
    // 10. Configuration — pure, no I/O, cannot fail to evaluate.
    // --------------------------------------------------------------------
    checks.push(checkConfiguration(process.env))

    // --------------------------------------------------------------------
    // Report + job_runs.
    // --------------------------------------------------------------------
    const overallVerdict = computeOverallVerdict(checks)
    const generatedAt = new Date()
    const reportMarkdown = generateReportMarkdown({ generatedAt, overallVerdict, targetGameweekName, targetDeadlineMs, nowMs, checks })

    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, reportMarkdown, 'utf8')

    const failCount = checks.filter((c) => c.verdict === 'fail').length
    const warnCount = checks.filter((c) => c.verdict === 'warn').length
    const passCount = checks.filter((c) => c.verdict === 'pass').length

    const details: JsonRecord = {
      overallVerdict,
      reportPath,
      targetGameweekId,
      targetGameweekName,
      checks: Object.fromEntries(checks.map((c) => [c.id, { verdict: c.verdict, reason: c.reason, values: c.values }])),
    }
    const message = `${JOB_NAME}: overall ${overallVerdict.toUpperCase()} — ${failCount} fail, ${warnCount} warn, ${passCount} pass. Report written to ${reportPath}.`
    console.log(message)
    await recordJobRun(supabase, { status: overallVerdict === 'fail' ? 'failure' : 'success', message, details, startedAt })

    if (overallVerdict === 'fail') {
      process.exit(1)
    }
  } catch (err) {
    const message =
      err instanceof PreflightCheckError ? err.message : err instanceof Error ? `unexpected failure: ${err.message}` : `unexpected failure: ${String(err)}`

    console.error(`${JOB_NAME}: failed: ${message}`)

    try {
      await recordJobRun(supabase, { status: 'failure', message, details: {} , startedAt })
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
