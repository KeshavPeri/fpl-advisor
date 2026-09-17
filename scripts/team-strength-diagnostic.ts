// Team-strength diagnostic — ticket #229's falsification gate.
//
// ============================================================================
// WHAT THIS IS AND WHY IT EXISTS.
// ============================================================================
// Ticket #229 replaces frozen ClubElo with a point-in-time team-strength
// construction (src/lib/projection/teamStrength.ts) whenever the elo table
// cannot be trusted. The premise behind that fix is a causal claim about a
// MEASURED number: that the model's stale ratings, not a real absence of
// fixture difference, produced the coin-flip Man Utd v Man City fixture the
// ticket's "Problem" section documents. This script is the instrument that
// checks that claim, before/after, on the SAME live fixtures — not by
// argument (docs/projection-model-backlog.md's G7/G8 "do not act from
// argument alone" precedent).
//
// For every fixture in the NEXT gameweek (gameweeks.is_next — the same
// convention scripts/project-points.ts uses, never a hardcoded gameweek
// number), it prints, from BOTH teams' own perspective:
//   - the FROZEN-ELO expectedScore — exactly the two-tier logic that shipped
//     before this ticket (fresh elo if both non-null, else the FDR fallback;
//     staleness was never consulted).
//   - the POINT-IN-TIME expectedScore AND which of the four new precedence
//     tiers produced it (src/lib/projection/expectedPoints.ts's
//     resolveFixtureExpectedScore) — this ticket's fix.
//
// ============================================================================
// REUSE, NOT REIMPLEMENTATION.
// ============================================================================
// This file reimplements nothing from project-points.ts or the pure
// projection modules. It imports project-points.ts's own buildFixtureContext
// (the exact wiring that decides teamElo/opponentElo/teamEloStale/
// opponentEloStale/teamStrength/opponentTeamStrength for one fixture),
// toFixtureResultRows and teamCodeByIdFrom (ticket #235's fixtures -> team
// -strength wiring), and src/lib/projection/teamStrength.ts's own
// buildTeamMatchRecordsFromFixtures/computeTeamStrengthAsOf/teamStrengthRate
// and src/lib/projection/expectedPoints.ts's own resolveFixtureExpectedScore
// — the SAME functions the live job runs. The only new logic here is
// `frozenEloExpectedScore`, a deliberate RECONSTRUCTION of the pre-#229
// two-tier logic (fresh elo, else FDR — never consulting staleness), kept
// here rather than in the shared library because it exists ONLY to answer
// "what would the OLD code have said", a question no other file needs to
// ask once this ticket ships.
//
// ============================================================================
// SCOPE — READ-ONLY, NOT SCHEDULED.
// ============================================================================
// This script makes no write to any table but its own job_runs row (ticket
// text: "Paste the report into the PR body either way"; it is a diagnostic,
// not a data producer). Per the ticket's own "Out of scope": this file is
// NOT added to .github/workflows/, and its job name is NOT added to
// scripts/preflight-check.ts's check-8 tracked-job list — scheduling it, and
// touching preflight-check.ts at all, are both explicitly out of scope here.
//
// ============================================================================
// THE FALSIFICATION GATE (ticket text, verbatim rule).
// ============================================================================
// Two figures must move, or this diagnosis was wrong:
//   1. The Man Utd v Man City fixture's point-in-time expectedScore for Man
//      Utd must be < 0.5 (not >= 0.5 — the reported defect would survive the
//      fix). If that exact fixture is not present in the next gameweek's
//      fixtures when this runs, this gate is reported NOT-APPLICABLE, never
//      guessed at or silently skipped.
//   2. The population standard deviation of the point-in-time expectedScore
//      across the horizon's fixtures must NOT be lower than that of the
//      frozen-elo expectedScore over the same fixtures — a flatter fixture
//      signal is a worse one, not a better one.
// Either failing STOPS the job (status 'failure', non-zero exit) exactly
// like scripts/run-backtest.ts's own sanity bounds — the report is still
// written either way, for diagnosis.
//
// ============================================================================
// TICKET #235 — the gate was defective, and #229's own record source never
// fired for the current season. Both fixed here.
// ============================================================================
// #229's diagnostic reported PASS on live data (15 Sept 2026, gameweek 5)
// while EVERY row resolved to `stale-elo` — the `team-strength` tier was
// never reached, because player_match_stats.opponent_team_code is NULL on
// every current-season row (FPL-Core-Insights publishes `fotmob_name` blank
// for all twenty clubs this season; see teamStrength.ts's own header). Gate
// 2 (the variance comparison) passed VACUOUSLY: with the new path never
// running, the "point-in-time" and "frozen-elo" populations were the exact
// same numbers, so their stdDevs matched exactly and the comparison could
// never fail. A gate that only compares a new path against an old one passes
// vacuously whenever the new path does not run — a gate design defect, not a
// data problem.
//
// This ticket fixes BOTH halves:
//   1. The RECORD SOURCE: teamMatchRecords is now built from
//      public.fixtures (real results: team_h/team_a/team_h_score/
//      team_a_score/finished), via project-points.ts's own
//      toFixtureResultRows/teamCodeByIdFrom and teamStrength.ts's own
//      buildTeamMatchRecordsFromFixtures — never reimplemented here, and no
//      player_match_stats read for this purpose any more.
//   2. The GATE: checkTeamStrengthSourceGate is a NEW, PRIMARY gate — at
//      least one examined fixture must resolve to source `team-strength`,
//      or the job exits non-zero regardless of what the other two gates
//      say. checkVarianceGate is extended to ALSO fail when every row's
//      point-in-time and frozen-elo columns are numerically identical
//      (`allRowsIdentical`) — identical columns are proof the new path did
//      nothing, not evidence that it preserved spread. The Man Utd v Man
//      City gate is unchanged in logic, re-ranked to a bonus check (it was
//      always one specific reported fixture, never the main gate). The
//      report additionally prints the full point-in-time strength table —
//      every club, matches, goals scored/conceded, teamStrengthRate, sorted
//      by rate — without which there is no way to see whether the ratings
//      are sensible, only whether they changed.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import {
  buildFixtureContext,
  latestOddsByFixtureId,
  teamCodeByIdFrom,
  toFixtureResultRows,
  type FixtureOddsRow,
  type FixtureRow,
  type TeamMetadata,
} from './project-points.ts'
import {
  buildTeamMatchRecordsFromFixtures,
  computeFixtureExpectedScore,
  computeTeamStrengthAsOf,
  HOME_EXPECTED_SCORE_BONUS,
  MIN_TEAM_PRIOR_MATCHES,
  NEUTRAL_EXPECTED_SCORE_VALUE,
  SCALE,
  teamStrengthRate,
  type TeamMatchRecord,
} from '../src/lib/projection/teamStrength.ts'
import { resolveFixtureExpectedScore, type FixtureContext, type FixtureSource } from '../src/lib/projection/expectedPoints.ts'
import { expectedScore, expectedScoreFromDifficulty } from '../src/lib/projection/fixture.ts'
import { OVERROUND_MAX_PLAUSIBLE, OVERROUND_MIN_PLAUSIBLE } from '../src/lib/projection/marketOdds.ts'

const JOB_NAME = 'team-strength-diagnostic'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'
const DEFAULT_REPORT_PATH = './out/team-strength-diagnostic.md'

/** Fallback FPL FDR (1-5) when a fixture row's own difficulty column is null — same anchor project-points.ts and fixture.ts's own expectedScoreFromDifficulty(3) use. */
const DEFAULT_FPL_DIFFICULTY = 3

/**
 * Ticket #242. Gate 2's band — a window around SCALE's own 0.1701
 * calibration target (src/lib/projection/teamStrength.ts), replacing the
 * old one-sided floor (>= frozen-elo spread), which could only catch a
 * spread that was too NARROW and let a 74% over-dispersion (0.2957 against
 * the 0.1701 target) sail through on 16 Sept 2026's live run.
 */
const TEAM_STRENGTH_STDDEV_MIN = 0.14
const TEAM_STRENGTH_STDDEV_MAX = 0.2

/**
 * Ticket #242. Gate 4 — no examined fixture's point-in-time expectedScore
 * may fall outside this band. A guard on top of the aggregate stdDev check
 * (gate 2): a correctly shrunk population can still, in principle, hide one
 * pathological row behind an otherwise-healthy stdDev, and the ticket's own
 * "Problem" section reported exact certainties (1.0000 / 0.0000) this gate
 * exists to catch directly, row by row, rather than only in aggregate.
 * Matches src/lib/projection/teamStrength.ts's own MIN_EXPECTED_SCORE /
 * MAX_EXPECTED_SCORE clamp bounds' spirit, but is INTENTIONALLY a tighter,
 * independent band ([0.10, 0.90] vs. the clamp's [0.05, 0.95]) — the clamp
 * is a last-resort guard against certainty, this gate is the falsification
 * check that the shrinkage upstream of it is actually doing its job, so it
 * must fail before a fixture ever gets anywhere near the clamp's own
 * boundary.
 */
const EXPECTED_SCORE_BOUND_MIN = 0.1
const EXPECTED_SCORE_BOUND_MAX = 0.9

/**
 * FPL's own stable short names for the two clubs the falsification gate
 * names explicitly — Tier 3, matching FPL's bootstrap-static convention
 * (never a numeric team id, which is not stable across seasons the way the
 * short name is for an established club).
 */
export const MAN_UTD_SHORT_NAME = 'MUN'
export const MAN_CITY_SHORT_NAME = 'MCI'

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
  return process.env.TEAM_STRENGTH_DIAGNOSTIC_REPORT_PATH ?? DEFAULT_REPORT_PATH
}

// ============================================================================
// Errors
// ============================================================================

export class TeamStrengthDiagnosticError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'TeamStrengthDiagnosticError'
    this.context = context
  }
}

export class TeamStrengthDiagnosticGateError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'TeamStrengthDiagnosticGateError'
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
// Row shapes read from Supabase — only the fields this script uses.
// ============================================================================

interface GameweekRow {
  id: number
  is_next: boolean
}

export interface DiagnosticTeamRow {
  id: number
  name: string
  short_name: string
  code: number | null
  elo: number | null
  elo_stale_since: string | null
}

// Ticket #235: FixtureRow is now imported from project-points.ts (see the
// top-of-file import) rather than re-declared here — this script's own
// fixtures read needs the SAME wider shape (team_h_score/team_a_score/
// finished, not just the difficulty columns) to build the point-in-time
// team-strength table the same way project-points.ts does, and a second,
// narrower local copy would be exactly the kind of drift this ticket exists
// to prevent (its own file header: "REUSE, NOT REIMPLEMENTATION").

// ============================================================================
// Pure computation — no I/O. Unit-tested against constructed rows.
// ============================================================================

/**
 * The EXACT two-tier logic that shipped BEFORE ticket #229: fresh-or-stale
 * made no difference — a non-null elo on both sides was always trusted, and
 * only a null elo fell back to FPL's FDR. This is a deliberate
 * reconstruction of the OLD behaviour (never consulting `elo_stale_since`),
 * kept here — and ONLY here — because no other file in this repo needs to
 * answer "what would the pre-#229 code have said" once the fix ships.
 */
export function frozenEloExpectedScore(teamElo: number | null, opponentElo: number | null, isHome: boolean, fplDifficulty: number): number {
  if (teamElo === null || opponentElo === null) return expectedScoreFromDifficulty(fplDifficulty)
  return expectedScore(teamElo, opponentElo, isHome)
}

/**
 * One team's own perspective on one fixture — the report's own row shape.
 *
 * Ticket #238 adds THREE columns so the report shows frozen-elo, team-strength and market-odds
 * side by side (ticket text, verbatim), independent of which tier the LIVE precedence actually
 * picked (`pointInTimeExpectedScore`/`fixtureSource`, unchanged in meaning — now potentially
 * `'market-odds'`):
 *   - `teamStrengthExpectedScore` is ALWAYS computed directly (via `computeFixtureExpectedScore`,
 *     which already falls back to `NEUTRAL_EXPECTED_SCORE_VALUE` for insufficient history) —
 *     regardless of whether team-strength is the tier the live precedence actually chose.
 *   - `marketOddsExpectedScore`/`marketOddsBookCount`/`marketOddsOverround` are the RAW reading
 *     from this fixture's most recent `fixture_odds` row, `null` when none exists — also
 *     independent of the freshness/book-count gate `resolveFixtureExpectedScore` applies for
 *     production use, since the falsification gate needs to see what the instrument WOULD say
 *     even when it isn't (yet) trusted for the live projection.
 */
export interface DiagnosticRow {
  fixtureId: number
  gameweekId: number
  teamId: number
  teamName: string
  teamShortName: string
  opponentId: number
  opponentName: string
  opponentShortName: string
  isHome: boolean
  frozenEloExpectedScore: number
  teamStrengthExpectedScore: number
  marketOddsExpectedScore: number | null
  marketOddsBookCount: number | null
  marketOddsOverround: number | null
  pointInTimeExpectedScore: number
  fixtureSource: FixtureSource
}

/**
 * Builds BOTH teams' own perspective rows for one fixture, reusing
 * project-points.ts's own `buildFixtureContext` (the exact live wiring) and
 * expectedPoints.ts's own `resolveFixtureExpectedScore` (the exact live
 * precedence) — nothing about how a fixture's expectedScore is decided is
 * reimplemented here. Ticket #238: `oddsRow`/`nowMs` thread through the SAME
 * `buildFixtureContext` params the live job now takes — no second market-odds
 * wiring invented for the diagnostic.
 */
export function buildDiagnosticRows(params: {
  fixture: Pick<FixtureRow, 'id' | 'team_h' | 'team_a' | 'team_h_difficulty' | 'team_a_difficulty'>
  gameweekId: number
  teamsById: ReadonlyMap<number, DiagnosticTeamRow>
  eloByTeamId: ReadonlyMap<number, number | null>
  teamMetadataById: ReadonlyMap<number, TeamMetadata>
  teamMatchRecords: readonly TeamMatchRecord[]
  /** Ticket #238. This fixture's most recent `fixture_odds` row, if any. */
  oddsRow?: FixtureOddsRow
  /** Ticket #238. Required whenever `oddsRow` is supplied — see buildFixtureContext's own doc. */
  nowMs?: number
}): DiagnosticRow[] {
  const { fixture, gameweekId, teamsById, eloByTeamId, teamMetadataById, teamMatchRecords, oddsRow, nowMs } = params
  const homeTeam = teamsById.get(fixture.team_h)
  const awayTeam = teamsById.get(fixture.team_a)
  if (homeTeam === undefined || awayTeam === undefined) return []

  const perspectives: { own: DiagnosticTeamRow; opponent: DiagnosticTeamRow; isHome: boolean; fplDifficulty: number }[] = [
    { own: homeTeam, opponent: awayTeam, isHome: true, fplDifficulty: fixture.team_h_difficulty ?? DEFAULT_FPL_DIFFICULTY },
    { own: awayTeam, opponent: homeTeam, isHome: false, fplDifficulty: fixture.team_a_difficulty ?? DEFAULT_FPL_DIFFICULTY },
  ]

  return perspectives.map(({ own, opponent, isHome, fplDifficulty }) => {
    const ctx: FixtureContext = buildFixtureContext({
      fixtureId: fixture.id,
      isHome,
      fplDifficulty,
      leagueBaselineGoals: 1, // irrelevant to expectedScore itself — see resolveFixtureExpectedScore, which never reads it.
      ownTeamId: own.id,
      opponentTeamId: opponent.id,
      eloByTeamId,
      teamMetadataById,
      teamMatchRecords,
      gameweekId,
      oddsRow,
      nowMs,
    })
    const { expectedScoreValue, fixtureSource } = resolveFixtureExpectedScore(ctx)
    const teamStrengthExpectedScore =
      ctx.teamStrength !== undefined && ctx.opponentTeamStrength !== undefined
        ? computeFixtureExpectedScore(ctx.teamStrength, ctx.opponentTeamStrength, SCALE, isHome ? HOME_EXPECTED_SCORE_BONUS : -HOME_EXPECTED_SCORE_BONUS)
        : NEUTRAL_EXPECTED_SCORE_VALUE
    return {
      fixtureId: fixture.id,
      gameweekId,
      teamId: own.id,
      teamName: own.name,
      teamShortName: own.short_name,
      opponentId: opponent.id,
      opponentName: opponent.name,
      opponentShortName: opponent.short_name,
      isHome,
      frozenEloExpectedScore: frozenEloExpectedScore(ctx.teamElo, ctx.opponentElo, isHome, fplDifficulty),
      teamStrengthExpectedScore,
      marketOddsExpectedScore: ctx.marketOdds?.expectedScoreValue ?? null,
      marketOddsBookCount: ctx.marketOdds?.bookCount ?? null,
      marketOddsOverround: ctx.marketOdds?.overround ?? null,
      pointInTimeExpectedScore: expectedScoreValue,
      fixtureSource,
    }
  })
}

/** Population (not sample) standard deviation — matches SCALE's own calibration convention (teamStrength.ts's header). Empty input returns 0, never NaN. */
export function populationStandardDeviation(values: readonly number[]): number {
  if (values.length === 0) return 0
  const mean = values.reduce((sum, v) => sum + v, 0) / values.length
  const variance = values.reduce((sum, v) => sum + (v - mean) ** 2, 0) / values.length
  return Math.sqrt(variance)
}

export interface VarianceGateResult {
  frozenStdDev: number
  pointInTimeStdDev: number
  /**
   * Ticket #235. True when the point-in-time expectedScore is numerically
   * IDENTICAL to the frozen-elo expectedScore for EVERY row examined — the
   * exact condition that let #229's own diagnostic pass vacuously (all
   * twenty rows resolved to `stale-elo`, so the "new" and "old" populations
   * were literally the same numbers, and their stdDevs matched exactly).
   * Identical columns are proof the new path did nothing, not evidence that
   * it preserved spread (ticket text, verbatim) — retained by ticket #242
   * as a second, independent defect signal alongside the new band check
   * below (see `passed`).
   */
  allRowsIdentical: boolean
  /** True (PASS) when `pointInTimeStdDev` falls within [TEAM_STRENGTH_STDDEV_MIN, TEAM_STRENGTH_STDDEV_MAX] AND the two columns are not identical on every row (ticket #235 — see `allRowsIdentical`). */
  passed: boolean
}

/**
 * Falsification gate #2 — ticket #235 made this non-vacuous (fails when
 * every row is identical to the frozen-elo column); ticket #242 makes it a
 * BAND, not a floor. The original ">= frozen-elo spread" comparison was
 * one-sided — it could only catch a point-in-time spread that was too
 * NARROW, never one that was too WIDE. On 16 Sept 2026 live data it let a
 * 74% over-dispersion (point-in-time population stdDev 0.2957 against
 * SCALE's own 0.1701 calibration target — src/lib/projection/teamStrength.ts)
 * sail straight through, because 0.2957 >= the frozen-elo comparison stdDev.
 * The fix: check the point-in-time stdDev directly against a band around
 * the 0.1701 target ([TEAM_STRENGTH_STDDEV_MIN, TEAM_STRENGTH_STDDEV_MAX] =
 * [0.14, 0.20]) instead of against the frozen-elo column at all — a
 * construction with the right amount of spread does not need to be
 * compared to the (unrelated, and itself none too precise) old elo figure
 * to be judged correct.
 */
export function checkVarianceGate(rows: readonly Pick<DiagnosticRow, 'frozenEloExpectedScore' | 'pointInTimeExpectedScore'>[]): VarianceGateResult {
  const frozenStdDev = populationStandardDeviation(rows.map((r) => r.frozenEloExpectedScore))
  const pointInTimeStdDev = populationStandardDeviation(rows.map((r) => r.pointInTimeExpectedScore))
  const allRowsIdentical = rows.length > 0 && rows.every((r) => r.frozenEloExpectedScore === r.pointInTimeExpectedScore)
  const withinBand = pointInTimeStdDev >= TEAM_STRENGTH_STDDEV_MIN && pointInTimeStdDev <= TEAM_STRENGTH_STDDEV_MAX
  return { frozenStdDev, pointInTimeStdDev, allRowsIdentical, passed: withinBand && !allRowsIdentical }
}

export interface ExpectedScoreBoundGateResult {
  /** Every row whose point-in-time expectedScore fell outside [EXPECTED_SCORE_BOUND_MIN, EXPECTED_SCORE_BOUND_MAX] — never just a count, so the report can name the offending fixture(s) directly. */
  outOfBoundRows: DiagnosticRow[]
  /** True (PASS) when `outOfBoundRows` is empty. */
  passed: boolean
}

/**
 * Falsification gate #4 (ticket #242, new). No examined fixture's
 * point-in-time expectedScore may fall outside [EXPECTED_SCORE_BOUND_MIN,
 * EXPECTED_SCORE_BOUND_MAX] = [0.10, 0.90]. If any does, the shrinkage
 * upstream (src/lib/projection/teamStrength.ts's TEAM_STRENGTH_SHRINKAGE_K)
 * is insufficient regardless of what the aggregate stdDev (gate 2) says —
 * an aggregate check can hide one pathological row behind an otherwise
 * healthy population; this gate catches it directly. Specifically named in
 * the ticket text: Nott'm Forest v Coventry City must no longer resolve to
 * 1.0000 / 0.0000.
 */
export function checkExpectedScoreBoundGate(rows: readonly DiagnosticRow[]): ExpectedScoreBoundGateResult {
  const outOfBoundRows = rows.filter((r) => r.pointInTimeExpectedScore < EXPECTED_SCORE_BOUND_MIN || r.pointInTimeExpectedScore > EXPECTED_SCORE_BOUND_MAX)
  return { outOfBoundRows, passed: outOfBoundRows.length === 0 }
}

export interface TeamStrengthSourceGateResult {
  /** How many of the examined rows resolved to fixtureSource === 'team-strength'. */
  count: number
  /** True (PASS) when count > 0. */
  passed: boolean
}

/**
 * Ticket #235 — NEW gate, and the PRIMARY one (ticket text, verbatim): at
 * least one fixture in the examined gameweek must resolve to source
 * `team-strength`. This is the condition whose absence let #229's own
 * diagnostic pass: all twenty rows resolved to `stale-elo`, the
 * `team-strength` tier was never reached, and neither pre-existing gate
 * (Man Utd v Man City; the variance comparison) was actually checking for
 * that. If NO row resolves to `team-strength`, the fix is not running and
 * the job must exit non-zero, regardless of what the other two gates say.
 */
export function checkTeamStrengthSourceGate(rows: readonly Pick<DiagnosticRow, 'fixtureSource'>[]): TeamStrengthSourceGateResult {
  const count = rows.filter((r) => r.fixtureSource === 'team-strength').length
  return { count, passed: count > 0 }
}

export type ManUtdGateStatus = 'pass' | 'fail' | 'not-applicable'

export interface ManUtdGateResult {
  status: ManUtdGateStatus
  manUtdPointInTimeExpectedScore: number | null
}

/**
 * Falsification gate (ticket text, verbatim): the Man Utd v Man City
 * fixture's point-in-time expectedScore for Man Utd must be < 0.5. Searched
 * by FPL short name, not by assuming it is gameweek 4 or any particular
 * fixture id — if that exact pairing is not among the rows this run
 * examined (e.g. a later dispatch, once gameweek 4 is no longer next),
 * 'not-applicable' is reported explicitly rather than a guessed pass/fail.
 *
 * Ticket #235, point 3 of "Fix the gate": unchanged logic, but re-ranked —
 * this was always a BONUS check (one specific reported fixture), never the
 * primary one. `checkTeamStrengthSourceGate` above is now the primary gate.
 */
export function checkManUtdVsManCityGate(rows: readonly DiagnosticRow[]): ManUtdGateResult {
  const row = rows.find((r) => r.teamShortName === MAN_UTD_SHORT_NAME && r.opponentShortName === MAN_CITY_SHORT_NAME)
  if (row === undefined) return { status: 'not-applicable', manUtdPointInTimeExpectedScore: null }
  return { status: row.pointInTimeExpectedScore < 0.5 ? 'pass' : 'fail', manUtdPointInTimeExpectedScore: row.pointInTimeExpectedScore }
}

// ============================================================================
// Ticket #238's OWN falsification gate — three NEW conditions, additive to the
// four #229/#235/#242 gates above (which keep answering a different question:
// whether the TEAM-STRENGTH wiring itself still works). All three below must
// hold before this ticket may be merged (ticket text, verbatim: "Stop and
// report — do not merge — unless all three hold").
// ============================================================================

export interface MarketOddsLivenessGateResult {
  /** How many of the examined rows resolved to fixtureSource === 'market-odds'. */
  count: number
  /** True (PASS) when count > 0. */
  passed: boolean
}

/**
 * Falsification-gate item 1 (ticket text, verbatim): "At least one fixture in the next gameweek
 * resolves to source 'market-odds'... assert the new path ran before comparing anything" (the
 * liveness condition, per LEARNINGS-second-build-wave.md §21 — same discipline
 * checkTeamStrengthSourceGate above already applies to the team-strength tier).
 */
export function checkMarketOddsLivenessGate(rows: readonly Pick<DiagnosticRow, 'fixtureSource'>[]): MarketOddsLivenessGateResult {
  const count = rows.filter((r) => r.fixtureSource === 'market-odds').length
  return { count, passed: count > 0 }
}

export interface MarketOddsVsTeamStrengthGateResult {
  /** The largest observed |marketOddsExpectedScore - teamStrengthExpectedScore| across every row with an odds reading. Null when no row carries a market-odds reading at all. */
  maxAbsoluteDifference: number | null
  /** True (PASS) when maxAbsoluteDifference exceeds 0.02. */
  passed: boolean
}

/**
 * Falsification-gate item 2 (ticket text, verbatim): "At least one fixture's odds-derived
 * expectedScore differs from its team-strength expectedScore by more than 0.02. Identical columns
 * mean the new path did nothing." Compares the RAW `marketOddsExpectedScore` (ungated by
 * freshness/book-count — see DiagnosticRow's own doc) against `teamStrengthExpectedScore`, over
 * every row that has an odds reading at all.
 */
export function checkMarketOddsVsTeamStrengthGate(rows: readonly Pick<DiagnosticRow, 'marketOddsExpectedScore' | 'teamStrengthExpectedScore'>[]): MarketOddsVsTeamStrengthGateResult {
  const differences = rows
    .filter((r): r is typeof r & { marketOddsExpectedScore: number } => r.marketOddsExpectedScore !== null)
    .map((r) => Math.abs(r.marketOddsExpectedScore - r.teamStrengthExpectedScore))
  if (differences.length === 0) return { maxAbsoluteDifference: null, passed: false }
  const maxAbsoluteDifference = Math.max(...differences)
  return { maxAbsoluteDifference, passed: maxAbsoluteDifference > 0.02 }
}

export interface OverroundPlausibilityGateResult {
  /** Every examined row's own overround, paired with its fixture/team names, that fell outside [OVERROUND_MIN_PLAUSIBLE, OVERROUND_MAX_PLAUSIBLE]. */
  outOfRangeRows: DiagnosticRow[]
  /** How many DISTINCT fixtures carried an overround reading at all (a fixture contributes the SAME overround from both team perspectives, so this is rows.length / 2 among odds-bearing rows, reported for readability). */
  fixturesWithOverround: number
  /** True (PASS) when outOfRangeRows is empty AND at least one row carried an overround reading — an overround gate with nothing to check is not evidence the prices are sane. */
  passed: boolean
}

/**
 * Falsification-gate item 3 (ticket text, verbatim): "Every fetched fixture's overround is
 * between 1.00 and 1.15. Outside that range the prices were misparsed." Scoped to the fixtures
 * this diagnostic itself examined (the next gameweek) — the same "examined gameweek" boundary
 * every other gate in this file already uses.
 */
export function checkOverroundPlausibilityGate(rows: readonly DiagnosticRow[]): OverroundPlausibilityGateResult {
  const withOverround = rows.filter((r) => r.marketOddsOverround !== null)
  const outOfRangeRows = withOverround.filter((r) => (r.marketOddsOverround as number) < OVERROUND_MIN_PLAUSIBLE || (r.marketOddsOverround as number) > OVERROUND_MAX_PLAUSIBLE)
  return { outOfRangeRows, fixturesWithOverround: withOverround.length, passed: outOfRangeRows.length === 0 && withOverround.length > 0 }
}

function fmtEs(value: number): string {
  return value.toFixed(4)
}

function fmtGateStatus(status: ManUtdGateStatus): string {
  return status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'NOT APPLICABLE (fixture not found in this run\'s population)'
}

/** Ticket #235, point 4 of "Fix the gate": one club's point-in-time strength, for the full report table — every club, its matches, goals scored, goals conceded and teamStrengthRate. */
export interface TeamStrengthTableRow {
  teamId: number
  teamName: string
  teamShortName: string
  matches: number
  goalsScored: number
  goalsConceded: number
  rate: number
  /** True when `matches >= MIN_TEAM_PRIOR_MATCHES` — this club's `rate` reflects a REAL comparison (`fixtureHasSufficientHistory`'s own gate, teamStrength.ts), not just an insufficient early-season sample. The ticket's falsification-gate item 3 ("every club has at least 3 matches") is read off this column, row by row. */
  meetsMinimum: boolean
}

/**
 * Ticket #235, point 4 of "Fix the gate": the full point-in-time strength
 * table, one row per club with a resolvable `teams.code` (a club with none
 * cannot have a strength record built at all — never guessed, never
 * silently skipped without being excluded here for a stated reason), sorted
 * by `rate` descending (strongest first) — "without it there is no way to
 * see whether the ratings are sensible, only whether they changed" (ticket
 * text, verbatim).
 */
export function buildTeamStrengthTable(params: {
  teamsById: ReadonlyMap<number, DiagnosticTeamRow>
  teamMatchRecords: readonly TeamMatchRecord[]
  beforeGameweek: number
}): TeamStrengthTableRow[] {
  const { teamsById, teamMatchRecords, beforeGameweek } = params
  const rows: TeamStrengthTableRow[] = []
  for (const team of teamsById.values()) {
    if (team.code === null) continue // no resolvable teams.code -- cannot build a strength record, never guessed
    const record = computeTeamStrengthAsOf(teamMatchRecords, team.code, beforeGameweek)
    rows.push({
      teamId: team.id,
      teamName: team.name,
      teamShortName: team.short_name,
      matches: record.matches,
      goalsScored: record.goalsScored,
      goalsConceded: record.goalsConceded,
      rate: teamStrengthRate(record),
      meetsMinimum: record.matches >= MIN_TEAM_PRIOR_MATCHES,
    })
  }
  return rows.sort((a, b) => b.rate - a.rate)
}

export interface ReportData {
  generatedAt: Date
  gameweekId: number
  rows: DiagnosticRow[]
  teamStrengthSourceGate: TeamStrengthSourceGateResult
  manUtdGate: ManUtdGateResult
  varianceGate: VarianceGateResult
  expectedScoreBoundGate: ExpectedScoreBoundGateResult
  marketOddsLivenessGate: MarketOddsLivenessGateResult
  marketOddsVsTeamStrengthGate: MarketOddsVsTeamStrengthGateResult
  overroundPlausibilityGate: OverroundPlausibilityGateResult
  strengthTable: TeamStrengthTableRow[]
}

export function generateReportMarkdown(data: ReportData): string {
  const lines: string[] = []
  lines.push('# Team-strength diagnostic — tickets #229 / #235 / #238')
  lines.push('')
  lines.push(`Generated: ${data.generatedAt.toISOString()} · Job: \`${JOB_NAME}\` · Gameweek examined: ${data.gameweekId}`)
  lines.push('')
  lines.push('## Falsification gate — tickets #229/#235/#242 (team-strength wiring)')
  lines.push('')
  // Ticket #235: the team-strength-source gate is listed FIRST and labelled
  // the PRIMARY gate ("Fix the gate", point 1) -- it is the condition whose
  // absence let #229's own diagnostic pass vacuously.
  lines.push(
    `1. **PRIMARY — at least one fixture resolves to source \`team-strength\`:** ${data.teamStrengthSourceGate.passed ? 'PASS' : 'FAIL'} ` +
      `(${data.teamStrengthSourceGate.count} of ${data.rows.length} row(s))`,
  )
  lines.push(
    `2. **Point-in-time expectedScore population stdDev falls within [${TEAM_STRENGTH_STDDEV_MIN}, ${TEAM_STRENGTH_STDDEV_MAX}] ` +
      `(ticket #242 — a band around SCALE's own 0.1701 calibration target, not a floor against frozen-elo any more), ` +
      `AND the two columns are not identical on every row:** ${data.varianceGate.passed ? 'PASS' : 'FAIL'} ` +
      `(point-in-time population stdDev: ${fmtEs(data.varianceGate.pointInTimeStdDev)}; ` +
      `frozen-elo population stdDev, for reference only: ${fmtEs(data.varianceGate.frozenStdDev)}; ` +
      `all rows identical: ${data.varianceGate.allRowsIdentical})`,
  )
  lines.push(
    `3. **No fixture's point-in-time expectedScore falls outside [${EXPECTED_SCORE_BOUND_MIN}, ${EXPECTED_SCORE_BOUND_MAX}] (ticket #242, gate 4):** ` +
      `${data.expectedScoreBoundGate.passed ? 'PASS' : 'FAIL'} (${data.expectedScoreBoundGate.outOfBoundRows.length} of ${data.rows.length} row(s) out of bound` +
      (data.expectedScoreBoundGate.outOfBoundRows.length > 0
        ? `: ${data.expectedScoreBoundGate.outOfBoundRows.map((r) => `${r.teamName} v ${r.opponentName} (${fmtEs(r.pointInTimeExpectedScore)})`).join('; ')}`
        : '') +
      ')',
  )
  lines.push(
    `4. **Bonus check — Man Utd v Man City, point-in-time expectedScore for Man Utd < 0.5:** ${fmtGateStatus(data.manUtdGate.status)}` +
      (data.manUtdGate.manUtdPointInTimeExpectedScore === null
        ? ''
        : ` (value: ${fmtEs(data.manUtdGate.manUtdPointInTimeExpectedScore)})`),
  )
  lines.push('')
  lines.push('## Falsification gate — ticket #238 (market odds). All three must hold before this ticket may be merged.')
  lines.push('')
  lines.push(
    `5. **Liveness — at least one fixture in the next gameweek resolves to source \`market-odds\`:** ` +
      `${data.marketOddsLivenessGate.passed ? 'PASS' : 'FAIL'} (${data.marketOddsLivenessGate.count} of ${data.rows.length} row(s))`,
  )
  lines.push(
    `6. **Divergence — at least one fixture's odds-derived expectedScore differs from its team-strength expectedScore by more than 0.02:** ` +
      `${data.marketOddsVsTeamStrengthGate.passed ? 'PASS' : 'FAIL'} (largest observed |difference|: ` +
      `${data.marketOddsVsTeamStrengthGate.maxAbsoluteDifference === null ? 'n/a — no row carries a market-odds reading' : fmtEs(data.marketOddsVsTeamStrengthGate.maxAbsoluteDifference)})`,
  )
  lines.push(
    `7. **Plausibility — every fetched fixture's overround is between ${OVERROUND_MIN_PLAUSIBLE.toFixed(2)} and ${OVERROUND_MAX_PLAUSIBLE.toFixed(2)}:** ` +
      `${data.overroundPlausibilityGate.passed ? 'PASS' : 'FAIL'} (${data.overroundPlausibilityGate.fixturesWithOverround} row(s) with an overround reading` +
      (data.overroundPlausibilityGate.outOfRangeRows.length > 0
        ? `, ${data.overroundPlausibilityGate.outOfRangeRows.length} out of range: ${data.overroundPlausibilityGate.outOfRangeRows.map((r) => `${r.teamName} v ${r.opponentName} (${r.marketOddsOverround?.toFixed(4)})`).join('; ')}`
        : '') +
      ')',
  )
  lines.push('')
  const teamStrengthVerdict =
    data.teamStrengthSourceGate.passed && data.varianceGate.passed && data.expectedScoreBoundGate.passed && data.manUtdGate.status !== 'fail'
  const marketOddsVerdict = data.marketOddsLivenessGate.passed && data.marketOddsVsTeamStrengthGate.passed && data.overroundPlausibilityGate.passed
  const overallVerdict = teamStrengthVerdict && marketOddsVerdict
  lines.push(
    overallVerdict
      ? '**Overall: PASS.** Every condition of both falsification gates is satisfied (or not applicable). Proceed.'
      : '**Overall: STOP.** At least one falsification condition failed — the diagnosis needs revisiting before this fix is merged.',
  )
  lines.push('')
  lines.push('## Fixture-by-fixture comparison')
  lines.push('')
  lines.push('| Team | Opponent | H/A | Frozen-elo | Team-strength | Market-odds | Books | Overround | Live (resolved) | Source |')
  lines.push('|---|---|---|---|---|---|---|---|---|---|')
  for (const row of data.rows) {
    lines.push(
      `| ${row.teamName} | ${row.opponentName} | ${row.isHome ? 'H' : 'A'} | ${fmtEs(row.frozenEloExpectedScore)} | ` +
        `${fmtEs(row.teamStrengthExpectedScore)} | ${row.marketOddsExpectedScore === null ? '—' : fmtEs(row.marketOddsExpectedScore)} | ` +
        `${row.marketOddsBookCount ?? '—'} | ${row.marketOddsOverround === null ? '—' : row.marketOddsOverround.toFixed(4)} | ` +
        `${fmtEs(row.pointInTimeExpectedScore)} | ${row.fixtureSource} |`,
    )
  }
  lines.push('')
  lines.push(
    '**Reading this table.** "Frozen-elo" is exactly what shipped before ticket #229 — a non-null `teams.elo` on both sides was ' +
      'always trusted, staleness never consulted. "Team-strength" is `computeFixtureExpectedScore` evaluated DIRECTLY (ticket #238), ' +
      'regardless of whether team-strength is the tier the live precedence actually picked. "Market-odds" is the RAW reading from ' +
      'this fixture\'s most recent `fixture_odds` row (ticket #238) — also independent of the freshness/book-count gate the live ' +
      'precedence applies; "—" means no odds row exists for this fixture. "Live (resolved)"/"Source" is the actual four-tier ' +
      'precedence output (`src/lib/projection/expectedPoints.ts`\'s `resolveFixtureExpectedScore`) — `market-odds` (new top tier), ' +
      '`team-strength` (built from `public.fixtures`\' real results), `stale-elo` (any usable, non-null elo — fresh ClubElo has ' +
      'been removed from the precedence entirely), or `fdr` (the pre-existing coarse fallback).',
  )
  lines.push('')
  lines.push('## Point-in-time team strength — every club, sorted by rate')
  lines.push('')
  lines.push(
    'Ticket #235, point 4 of "Fix the gate": without this table there is no way to see whether the ratings are sensible, ' +
      `only whether they changed. "Meets minimum" is \`matches >= MIN_TEAM_PRIOR_MATCHES\` (${MIN_TEAM_PRIOR_MATCHES}) — a ` +
      'club below it is still shown, but its rate is not yet trusted by resolveFixtureExpectedScore (falsification-gate item 3).',
  )
  lines.push('')
  lines.push('| Team | Matches | Goals scored | Goals conceded | teamStrengthRate | Meets minimum |')
  lines.push('|---|---|---|---|---|---|')
  for (const row of data.strengthTable) {
    lines.push(
      `| ${row.teamName} | ${row.matches} | ${row.goalsScored} | ${row.goalsConceded} | ${row.rate.toFixed(4)} | ` +
        `${row.meetsMinimum ? 'yes' : 'NO'} |`,
    )
  }
  lines.push('')
  return lines.join('\n')
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
  const reportPath = readReportPath()
  let details: JsonRecord = {}

  try {
    // --------------------------------------------------------------------
    // 1. The next gameweek — same convention as scripts/project-points.ts.
    // --------------------------------------------------------------------
    const { data: gwRows, error: gwError } = await supabase
      .from('gameweeks')
      .select('id, is_next')
      .order('id', { ascending: true })
      .returns<GameweekRow[]>()
    if (gwError) {
      if (isMissingTable(gwError, 'gameweeks')) {
        throw new TeamStrengthDiagnosticError(`the "gameweeks" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'gameweeks')
      }
      throw new TeamStrengthDiagnosticError(`gameweeks lookup failed: ${gwError.message}`, 'gameweeks')
    }
    const nextGameweek = (gwRows ?? []).find((gw) => gw.is_next)
    if (nextGameweek === undefined) {
      throw new TeamStrengthDiagnosticError(
        'no gameweek has is_next = true. Run scripts/ingest-fpl.ts to refresh gameweeks, or the season has ended.',
        'gameweeks',
      )
    }
    const gameweekId = nextGameweek.id

    // --------------------------------------------------------------------
    // 2. Teams — elo, elo_stale_since, code, name, short_name. Not
    //    paginated: ~20 rows, same as project-points.ts's own teams read.
    // --------------------------------------------------------------------
    const { data: teamRows, error: teamsError } = await supabase
      .from('teams')
      .select('id, name, short_name, code, elo, elo_stale_since')
      .returns<DiagnosticTeamRow[]>()
    if (teamsError) {
      throw new TeamStrengthDiagnosticError(`teams lookup failed: ${teamsError.message}`, 'teams')
    }
    const teamsById = new Map<number, DiagnosticTeamRow>((teamRows ?? []).map((t) => [t.id, t]))
    const eloByTeamId = new Map<number, number | null>((teamRows ?? []).map((t) => [t.id, t.elo]))
    const teamMetadataById = new Map<number, TeamMetadata>(
      (teamRows ?? []).map((t) => [t.id, { eloStale: t.elo_stale_since !== null, code: t.code }]),
    )

    // --------------------------------------------------------------------
    // 3. Fixtures — ticket #235: ONE unfiltered read of the whole table
    //    (the per-gameweek filter this query used to carry is gone), same
    //    shape and same "no additional Supabase round trip" reasoning as
    //    project-points.ts's own fixtures read (see that file's section
    //    2/3 comment) — this now serves TWO purposes that used to need two
    //    separate reads: (a) the next gameweek's own fixtures, for the
    //    fixture-by-fixture comparison table (unchanged in substance from
    //    before this ticket — "the next gameweek's fixtures", ticket #229
    //    text verbatim), and (b) the point-in-time team-strength table,
    //    which needs the WHOLE season's results, not just the next
    //    gameweek's (not-yet-played) fixtures. Not paginated: up to 380
    //    rows, same bound as project-points.ts's own unpaginated fixtures
    //    read (decisions/ticket-43.md).
    // --------------------------------------------------------------------
    const { data: allFixtureRowsData, error: fixturesError } = await supabase
      .from('fixtures')
      .select('id, event_id, team_h, team_a, team_h_difficulty, team_a_difficulty, team_h_score, team_a_score, finished')
      .returns<FixtureRow[]>()
    if (fixturesError) {
      throw new TeamStrengthDiagnosticError(`fixtures lookup failed: ${fixturesError.message}`, 'fixtures')
    }
    const allFixtureRows = allFixtureRowsData ?? []
    const gameweekFixtureRows = allFixtureRows.filter((f) => f.event_id === gameweekId)
    if (gameweekFixtureRows.length === 0) {
      throw new TeamStrengthDiagnosticError(`no fixtures found for gameweek ${gameweekId} (is_next). Run scripts/ingest-fpl.ts first.`, 'fixtures')
    }

    // --------------------------------------------------------------------
    // 4. The point-in-time team-strength table — ticket #235: built from
    //    `public.fixtures` (real results), via the SAME wiring
    //    project-points.ts uses (toFixtureResultRows/teamCodeByIdFrom/
    //    buildTeamMatchRecordsFromFixtures), never reimplemented here. No
    //    player_match_stats read at all any more for this purpose — see the
    //    file header's "REUSE, NOT REIMPLEMENTATION" and
    //    teamStrength.ts's own header for the "because" (blank
    //    fotmob_name -> the player_match_stats path never fires for the
    //    current season).
    // --------------------------------------------------------------------
    const teamCodeById = teamCodeByIdFrom(teamMetadataById)
    const { records: teamMatchRecords } = buildTeamMatchRecordsFromFixtures(toFixtureResultRows(allFixtureRows), teamCodeById)

    // --------------------------------------------------------------------
    // 4b. Ticket #238 — market odds for the next gameweek's own fixtures
    //    only (a small, bounded set, ~10 fixtures — unlike
    //    project-points.ts's 5-gameweek horizon this stays comfortably under
    //    the 1,000-row db-max-rows ceiling even as fixture_odds accumulates
    //    daily rows over a fixture's lifetime, so this read is left
    //    unpaginated, same "small and bounded" precedent as the teams/
    //    fixtures reads above). A missing fixture_odds table (migration not
    //    yet applied) degrades gracefully — gate 5 below will simply FAIL,
    //    correctly reporting "the new path did not run", rather than this
    //    script throwing.
    // --------------------------------------------------------------------
    const gameweekFixtureIds = gameweekFixtureRows.map((f) => f.id)
    const { data: oddsRowsData, error: oddsError } = await supabase
      .from('fixture_odds')
      .select('fixture_id, fetched_at, book_count, p_home, p_draw, p_away, overround')
      .in('fixture_id', gameweekFixtureIds)
      .order('fetched_at', { ascending: false })
      .returns<FixtureOddsRow[]>()
    if (oddsError && !isMissingTable(oddsError, 'fixture_odds')) {
      throw new TeamStrengthDiagnosticError(`fixture_odds lookup failed: ${oddsError.message}`, 'fixture_odds')
    }
    if (oddsError) {
      console.error(`${JOB_NAME}: the "fixture_odds" table does not exist yet — gate 5 (liveness) will report FAIL.`)
    }
    const latestOdds = latestOddsByFixtureId(oddsRowsData ?? [])
    const nowMs = Date.now()

    // --------------------------------------------------------------------
    // 5. Build the comparison rows, both team perspectives per fixture in
    //    the next gameweek only. Ticket #238: threads each fixture's latest
    //    odds row (if any) and `nowMs` through — the SAME buildFixtureContext
    //    params the live job (project-points.ts) now takes.
    // --------------------------------------------------------------------
    const rows: DiagnosticRow[] = gameweekFixtureRows.flatMap((fixture) =>
      buildDiagnosticRows({
        fixture,
        gameweekId,
        teamsById,
        eloByTeamId,
        teamMetadataById,
        teamMatchRecords,
        oddsRow: latestOdds.get(fixture.id),
        nowMs,
      }),
    )

    // --------------------------------------------------------------------
    // 6. The falsification gate — ticket #235: the team-strength-source gate
    //    is the PRIMARY one; the variance gate is non-vacuous (also fails
    //    when every row is identical); the Man Utd v Man City gate is a
    //    bonus check. Ticket #242: the variance gate is now a BAND (not a
    //    floor against frozen-elo), and a new gate 4 checks every row's own
    //    bound directly, not just the aggregate. Ticket #238 adds three MORE
    //    gates (5-7), its own falsification requirement, additive to these
    //    four. ANY of the seven failing stops the job.
    // --------------------------------------------------------------------
    const teamStrengthSourceGate = checkTeamStrengthSourceGate(rows)
    const manUtdGate = checkManUtdVsManCityGate(rows)
    const varianceGate = checkVarianceGate(rows)
    const expectedScoreBoundGate = checkExpectedScoreBoundGate(rows)
    const marketOddsLivenessGate = checkMarketOddsLivenessGate(rows)
    const marketOddsVsTeamStrengthGate = checkMarketOddsVsTeamStrengthGate(rows)
    const overroundPlausibilityGate = checkOverroundPlausibilityGate(rows)

    // --------------------------------------------------------------------
    // 7. The full point-in-time strength table (ticket #235, point 4 of "Fix
    //    the gate") — every club, sorted by rate, evaluated AS OF the
    //    examined gameweek (the same point in time buildDiagnosticRows
    //    itself queries for each fixture above).
    // --------------------------------------------------------------------
    const strengthTable = buildTeamStrengthTable({ teamsById, teamMatchRecords, beforeGameweek: gameweekId })

    // --------------------------------------------------------------------
    // 8. Report + job_runs.
    // --------------------------------------------------------------------
    const reportData: ReportData = {
      generatedAt: new Date(),
      gameweekId,
      rows,
      teamStrengthSourceGate,
      manUtdGate,
      varianceGate,
      expectedScoreBoundGate,
      marketOddsLivenessGate,
      marketOddsVsTeamStrengthGate,
      overroundPlausibilityGate,
      strengthTable,
    }
    const reportMarkdown = generateReportMarkdown(reportData)
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, reportMarkdown, 'utf8')

    details = {
      gameweekId,
      fixturesExamined: gameweekFixtureRows.length,
      rowsCompared: rows.length,
      teamMatchRecordsBuilt: teamMatchRecords.length,
      teamStrengthSourceGate,
      manUtdGate,
      varianceGate,
      expectedScoreBoundGate,
      marketOddsLivenessGate,
      marketOddsVsTeamStrengthGate,
      overroundPlausibilityGate,
      reportPath,
    }

    // Ticket #235: the team-strength-source gate is the PRIMARY condition —
    // "if none does, the fix is not running and the job must exit non-zero"
    // (ticket text, verbatim). Ticket #242 adds the per-row bound gate.
    // Ticket #238 adds its own three-condition falsification gate, additive
    // to these four — "Stop and report — do not merge — unless all three
    // hold" (ticket text, verbatim). ANY of the seven failing stops the job.
    if (
      !teamStrengthSourceGate.passed ||
      manUtdGate.status === 'fail' ||
      !varianceGate.passed ||
      !expectedScoreBoundGate.passed ||
      !marketOddsLivenessGate.passed ||
      !marketOddsVsTeamStrengthGate.passed ||
      !overroundPlausibilityGate.passed
    ) {
      const message =
        `${JOB_NAME}: falsification gate FAILED for gameweek ${gameweekId} — ` +
        `team-strength-source gate: ${teamStrengthSourceGate.passed ? 'pass' : 'fail'} (${teamStrengthSourceGate.count} row(s)); ` +
        `Man Utd/Man City gate: ${manUtdGate.status}; variance gate: ${varianceGate.passed ? 'pass' : 'fail'} ` +
        `(point-in-time stdDev ${fmtEs(varianceGate.pointInTimeStdDev)}, band [${TEAM_STRENGTH_STDDEV_MIN}, ${TEAM_STRENGTH_STDDEV_MAX}], ` +
        `frozen stdDev for reference ${fmtEs(varianceGate.frozenStdDev)}, all rows identical: ${varianceGate.allRowsIdentical}); ` +
        `expectedScore-bound gate: ${expectedScoreBoundGate.passed ? 'pass' : 'fail'} (${expectedScoreBoundGate.outOfBoundRows.length} row(s) outside ` +
        `[${EXPECTED_SCORE_BOUND_MIN}, ${EXPECTED_SCORE_BOUND_MAX}]); market-odds liveness gate: ` +
        `${marketOddsLivenessGate.passed ? 'pass' : 'fail'} (${marketOddsLivenessGate.count} row(s)); market-odds-vs-team-strength ` +
        `divergence gate: ${marketOddsVsTeamStrengthGate.passed ? 'pass' : 'fail'} (max |difference| ` +
        `${marketOddsVsTeamStrengthGate.maxAbsoluteDifference === null ? 'n/a' : fmtEs(marketOddsVsTeamStrengthGate.maxAbsoluteDifference)}); ` +
        `overround plausibility gate: ${overroundPlausibilityGate.passed ? 'pass' : 'fail'} (${overroundPlausibilityGate.outOfRangeRows.length} of ` +
        `${overroundPlausibilityGate.fixturesWithOverround} row(s) with an overround reading out of range). Report written to ${reportPath} for diagnosis.`
      console.error(message)
      await recordJobRun(supabase, { status: 'failure', message, details, startedAt })
      process.exit(1)
      return
    }

    const message =
      `${JOB_NAME}: gameweek ${gameweekId} — ${rows.length} row(s) compared across ${gameweekFixtureRows.length} fixture(s), ` +
      `${teamMatchRecords.length} team-match record(s) built from public.fixtures. Falsification gate PASSED ` +
      `(${teamStrengthSourceGate.count} row(s) resolved to team-strength, ${marketOddsLivenessGate.count} to market-odds). ` +
      `Report written to ${reportPath}.`
    console.log(message)
    await recordJobRun(supabase, { status: 'success', message, details, startedAt })
  } catch (err) {
    const message =
      err instanceof TeamStrengthDiagnosticError || err instanceof TeamStrengthDiagnosticGateError
        ? err.message
        : err instanceof Error
          ? `unexpected failure: ${err.message}`
          : `unexpected failure: ${String(err)}`

    console.error(`${JOB_NAME}: failed: ${message}`)

    try {
      await recordJobRun(supabase, { status: 'failure', message, details, startedAt })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}: additionally failed to record the failed job_runs row: ${recordMessage}`)
    }

    process.exit(1)
  }
}

// Guarded, matching every other job in scripts/: importing this module (e.g.
// from a test) never triggers a real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
