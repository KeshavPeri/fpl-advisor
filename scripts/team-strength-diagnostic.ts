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
// opponentEloStale/teamStrength/opponentTeamStrength for one fixture) and
// CURRENT_SEASON, and src/lib/projection/teamStrength.ts's own
// buildTeamMatchRecords/computeTeamStrengthAsOf and
// src/lib/projection/expectedPoints.ts's own resolveFixtureExpectedScore —
// the SAME functions the live job runs. The only new logic here is
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

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { fetchAllPages, assertRowCountMatches } from './lib/paginate.ts'
import { PREMIER_LEAGUE_COMPETITION } from './lib/competition.ts'
import { buildFixtureContext, CURRENT_SEASON, type TeamMetadata } from './project-points.ts'
import { buildTeamMatchRecords, type TeamMatchRecord } from '../src/lib/projection/teamStrength.ts'
import { resolveFixtureExpectedScore, type FixtureContext, type FixtureSource } from '../src/lib/projection/expectedPoints.ts'
import { expectedScore, expectedScoreFromDifficulty } from '../src/lib/projection/fixture.ts'

const JOB_NAME = 'team-strength-diagnostic'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'
const DEFAULT_REPORT_PATH = './out/team-strength-diagnostic.md'

/** Fallback FPL FDR (1-5) when a fixture row's own difficulty column is null — same anchor project-points.ts and fixture.ts's own expectedScoreFromDifficulty(3) use. */
const DEFAULT_FPL_DIFFICULTY = 3

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

interface FixtureRow {
  id: number
  event_id: number | null
  team_h: number
  team_a: number
  team_h_difficulty: number | null
  team_a_difficulty: number | null
}

/** The minimal player_match_stats shape this script needs — team-strength construction only, unlike project-points.ts's much wider select. */
export interface DiagnosticMatchStatsRow {
  season: string
  gameweek: number
  match_id: string
  team_code: number | null
  opponent_team_code: number | null
  team_goals_conceded: number | null
}

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

/** One team's own perspective on one fixture — the report's own row shape. */
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
  pointInTimeExpectedScore: number
  fixtureSource: FixtureSource
}

/**
 * Builds BOTH teams' own perspective rows for one fixture, reusing
 * project-points.ts's own `buildFixtureContext` (the exact live wiring) and
 * expectedPoints.ts's own `resolveFixtureExpectedScore` (the exact live
 * precedence) — nothing about how a fixture's expectedScore is decided is
 * reimplemented here.
 */
export function buildDiagnosticRows(params: {
  fixture: Pick<FixtureRow, 'id' | 'team_h' | 'team_a' | 'team_h_difficulty' | 'team_a_difficulty'>
  gameweekId: number
  teamsById: ReadonlyMap<number, DiagnosticTeamRow>
  eloByTeamId: ReadonlyMap<number, number | null>
  teamMetadataById: ReadonlyMap<number, TeamMetadata>
  teamMatchRecords: readonly TeamMatchRecord[]
}): DiagnosticRow[] {
  const { fixture, gameweekId, teamsById, eloByTeamId, teamMetadataById, teamMatchRecords } = params
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
    })
    const { expectedScoreValue, fixtureSource } = resolveFixtureExpectedScore(ctx)
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
  /** True (PASS) when the point-in-time spread is AT LEAST as wide as the frozen-elo spread — never narrower. */
  passed: boolean
}

/** Falsification gate #2 (ticket text, verbatim): the point-in-time expectedScore's spread must not be LOWER than the frozen-elo expectedScore's, over the same fixtures. */
export function checkVarianceGate(rows: readonly Pick<DiagnosticRow, 'frozenEloExpectedScore' | 'pointInTimeExpectedScore'>[]): VarianceGateResult {
  const frozenStdDev = populationStandardDeviation(rows.map((r) => r.frozenEloExpectedScore))
  const pointInTimeStdDev = populationStandardDeviation(rows.map((r) => r.pointInTimeExpectedScore))
  return { frozenStdDev, pointInTimeStdDev, passed: pointInTimeStdDev >= frozenStdDev }
}

export type ManUtdGateStatus = 'pass' | 'fail' | 'not-applicable'

export interface ManUtdGateResult {
  status: ManUtdGateStatus
  manUtdPointInTimeExpectedScore: number | null
}

/**
 * Falsification gate #1 (ticket text, verbatim): the Man Utd v Man City
 * fixture's point-in-time expectedScore for Man Utd must be < 0.5. Searched
 * by FPL short name, not by assuming it is gameweek 4 or any particular
 * fixture id — if that exact pairing is not among the rows this run
 * examined (e.g. a later dispatch, once gameweek 4 is no longer next),
 * 'not-applicable' is reported explicitly rather than a guessed pass/fail.
 */
export function checkManUtdVsManCityGate(rows: readonly DiagnosticRow[]): ManUtdGateResult {
  const row = rows.find((r) => r.teamShortName === MAN_UTD_SHORT_NAME && r.opponentShortName === MAN_CITY_SHORT_NAME)
  if (row === undefined) return { status: 'not-applicable', manUtdPointInTimeExpectedScore: null }
  return { status: row.pointInTimeExpectedScore < 0.5 ? 'pass' : 'fail', manUtdPointInTimeExpectedScore: row.pointInTimeExpectedScore }
}

function fmtEs(value: number): string {
  return value.toFixed(4)
}

function fmtGateStatus(status: ManUtdGateStatus): string {
  return status === 'pass' ? 'PASS' : status === 'fail' ? 'FAIL' : 'NOT APPLICABLE (fixture not found in this run\'s population)'
}

export interface ReportData {
  generatedAt: Date
  gameweekId: number
  rows: DiagnosticRow[]
  manUtdGate: ManUtdGateResult

  varianceGate: VarianceGateResult
}

export function generateReportMarkdown(data: ReportData): string {
  const lines: string[] = []
  lines.push('# Team-strength diagnostic — ticket #229')
  lines.push('')
  lines.push(`Generated: ${data.generatedAt.toISOString()} · Job: \`${JOB_NAME}\` · Gameweek examined: ${data.gameweekId}`)
  lines.push('')
  lines.push('## Falsification gate')
  lines.push('')
  lines.push(
    `1. **Man Utd v Man City, point-in-time expectedScore for Man Utd < 0.5:** ${fmtGateStatus(data.manUtdGate.status)}` +
      (data.manUtdGate.manUtdPointInTimeExpectedScore === null
        ? ''
        : ` (value: ${fmtEs(data.manUtdGate.manUtdPointInTimeExpectedScore)})`),
  )
  lines.push(
    `2. **Point-in-time expectedScore spread >= frozen-elo expectedScore spread:** ${data.varianceGate.passed ? 'PASS' : 'FAIL'} ` +
      `(frozen-elo population stdDev: ${fmtEs(data.varianceGate.frozenStdDev)}; point-in-time population stdDev: ${fmtEs(data.varianceGate.pointInTimeStdDev)})`,
  )
  lines.push('')
  const overallVerdict = data.manUtdGate.status !== 'fail' && data.varianceGate.passed
  lines.push(
    overallVerdict
      ? '**Overall: PASS.** Both conditions of the falsification gate are satisfied (or not applicable). Proceed.'
      : '**Overall: STOP.** At least one falsification condition failed — the diagnosis needs revisiting before this fix is merged.',
  )
  lines.push('')
  lines.push('## Fixture-by-fixture comparison')
  lines.push('')
  lines.push('| Team | Opponent | H/A | Frozen-elo expectedScore | Point-in-time expectedScore | Source |')
  lines.push('|---|---|---|---|---|---|')
  for (const row of data.rows) {
    lines.push(
      `| ${row.teamName} | ${row.opponentName} | ${row.isHome ? 'H' : 'A'} | ${fmtEs(row.frozenEloExpectedScore)} | ` +
        `${fmtEs(row.pointInTimeExpectedScore)} | ${row.fixtureSource} |`,
    )
  }
  lines.push('')
  lines.push(
    '**Reading this table.** "Frozen-elo expectedScore" is exactly what shipped before ticket #229 — a non-null `teams.elo` on both ' +
      'sides was always trusted, staleness never consulted. "Point-in-time expectedScore" is this ticket\'s new four-tier precedence ' +
      '(`src/lib/projection/expectedPoints.ts`\'s `resolveFixtureExpectedScore`); "Source" names which tier supplied it — `elo` (fresh, ' +
      'unchanged behaviour), `team-strength` (this ticket\'s fix), `stale-elo` (better than nothing early season), or `fdr` (the ' +
      'pre-existing coarse fallback, unchanged).',
  )
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
    // 3. Fixtures for the next gameweek only — "the next gameweek's
    //    fixtures", ticket text verbatim, not a multi-gameweek horizon.
    // --------------------------------------------------------------------
    const { data: fixtureRows, error: fixturesError } = await supabase
      .from('fixtures')
      .select('id, event_id, team_h, team_a, team_h_difficulty, team_a_difficulty')
      .eq('event_id', gameweekId)
      .returns<FixtureRow[]>()
    if (fixturesError) {
      throw new TeamStrengthDiagnosticError(`fixtures lookup failed: ${fixturesError.message}`, 'fixtures')
    }
    if (!fixtureRows || fixtureRows.length === 0) {
      throw new TeamStrengthDiagnosticError(`no fixtures found for gameweek ${gameweekId} (is_next). Run scripts/ingest-fpl.ts first.`, 'fixtures')
    }

    // --------------------------------------------------------------------
    // 4. player_match_stats — CURRENT_SEASON, Premier League only, filtered
    //    IN THE QUERY (this script needs no other season's rows at all, so,
    //    unlike project-points.ts, the season filter belongs in the query
    //    itself, not applied in memory afterward). Paginated and
    //    count-verified, same convention as every other job in scripts/.
    // --------------------------------------------------------------------
    const {
      rows: matchStatsRows,
      error: matchStatsError,
      pages: matchStatsPagesFetched,
    } = await fetchAllPages<DiagnosticMatchStatsRow>((from, to) =>
      supabase
        .from('player_match_stats')
        .select('season, gameweek, match_id, team_code, opponent_team_code, team_goals_conceded')
        .eq('competition', PREMIER_LEAGUE_COMPETITION)
        .eq('season', CURRENT_SEASON)
        .order('match_id', { ascending: true })
        .range(from, to)
        .returns<DiagnosticMatchStatsRow[]>(),
    )
    if (matchStatsError) {
      if (isMissingTable(matchStatsError, 'player_match_stats')) {
        throw new TeamStrengthDiagnosticError(
          'the "player_match_stats" table does not exist. Apply supabase/migrations/20260811170000_player_match_stats.sql first.',
          'player_match_stats',
        )
      }
      throw new TeamStrengthDiagnosticError(`player_match_stats lookup failed: ${matchStatsError.message}`, 'player_match_stats')
    }
    const { count: matchStatsRowsExpectedByCount, error: matchStatsCountError } = await supabase
      .from('player_match_stats')
      .select('*', { count: 'exact', head: true })
      .eq('competition', PREMIER_LEAGUE_COMPETITION)
      .eq('season', CURRENT_SEASON)
    if (matchStatsCountError) {
      throw new TeamStrengthDiagnosticError(`player_match_stats count check failed: ${matchStatsCountError.message}`, 'player_match_stats')
    }
    assertRowCountMatches('player_match_stats', matchStatsRows.length, matchStatsRowsExpectedByCount ?? 0)

    const teamMatchRecords = buildTeamMatchRecords(
      matchStatsRows.map((row) => ({
        matchId: row.match_id,
        gameweek: row.gameweek,
        teamCode: row.team_code,
        opponentTeamCode: row.opponent_team_code,
        teamGoalsConceded: row.team_goals_conceded,
      })),
    )

    // --------------------------------------------------------------------
    // 5. Build the comparison rows, both team perspectives per fixture.
    // --------------------------------------------------------------------
    const rows: DiagnosticRow[] = fixtureRows.flatMap((fixture) =>
      buildDiagnosticRows({ fixture, gameweekId, teamsById, eloByTeamId, teamMetadataById, teamMatchRecords }),
    )

    // --------------------------------------------------------------------
    // 6. The falsification gate.
    // --------------------------------------------------------------------
    const manUtdGate = checkManUtdVsManCityGate(rows)
    const varianceGate = checkVarianceGate(rows)

    // --------------------------------------------------------------------
    // 7. Report + job_runs.
    // --------------------------------------------------------------------
    const reportData: ReportData = { generatedAt: new Date(), gameweekId, rows, manUtdGate, varianceGate }
    const reportMarkdown = generateReportMarkdown(reportData)
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, reportMarkdown, 'utf8')

    details = {
      gameweekId,
      fixturesExamined: fixtureRows.length,
      rowsCompared: rows.length,
      matchStatsRowsRead: matchStatsRows.length,
      matchStatsPagesFetched,
      manUtdGate,
      varianceGate,
      reportPath,
    }

    if (manUtdGate.status === 'fail' || !varianceGate.passed) {
      const message =
        `${JOB_NAME}: falsification gate FAILED for gameweek ${gameweekId} — ` +
        `Man Utd/Man City gate: ${manUtdGate.status}; variance gate: ${varianceGate.passed ? 'pass' : 'fail'} ` +
        `(frozen stdDev ${fmtEs(varianceGate.frozenStdDev)}, point-in-time stdDev ${fmtEs(varianceGate.pointInTimeStdDev)}). ` +
        `Report written to ${reportPath} for diagnosis.`
      console.error(message)
      await recordJobRun(supabase, { status: 'failure', message, details, startedAt })
      process.exit(1)
      return
    }

    const message =
      `${JOB_NAME}: gameweek ${gameweekId} — ${rows.length} row(s) compared across ${fixtureRows.length} fixture(s). ` +
      `Falsification gate PASSED. Report written to ${reportPath}.`
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
