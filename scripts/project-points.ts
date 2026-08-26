// Baseline projection job — ticket #33.
//
// Reads players, teams, fixtures, gameweeks and player_match_stats from
// Supabase, maps their rows onto the pure input types the
// src/lib/projection/ modules expect, computes expected points for the next
// PROJECTION_HORIZON gameweeks, and upserts the results into
// public.player_projections. This is the ONLY file that bridges the
// database and the pure projection model — src/lib/projection/ itself does
// no I/O of any kind (see that module's own header comments).
//
// Reads exactly two environment variables — SUPABASE_URL and
// SUPABASE_SECRET_KEY — same convention as every other scripts/*.ts job. No
// VITE_-prefixed variable appears in this file.
//
// THE JOIN. player_match_stats holds last season's rows, keyed by that
// season's player_id — meaningless against the current players table (see
// the #12/#22 migrations' header comments: 453 of 458 players changed id
// across the season boundary). Every join in this file goes through
// player_match_stats.player_code = players.code, never player_id = id.
//
// PREMIER LEAGUE ONLY (ticket #54). player_match_stats holds every
// competition the source publishes — cup and European matches score zero
// FPL points and their rates are measurably different (34% higher xG per 90
// in cup/European rows — see the ticket). The single player_match_stats read
// below (section 4) is filtered to competition = PREMIER_LEAGUE_COMPETITION
// IN THE QUERY, not in memory after fetching, and every downstream use of
// its result — the per-90 rate history, the last-five-matches minutes
// window, and the defensive-contribution match set — derives from that same
// filtered fetch, so one filter covers all three. A row whose competition is
// NULL (not yet re-stamped by scripts/ingest-core-insights.ts since the
// #54 migration added the column) is excluded, same as a known
// non-Premier-League row, and both are counted separately in job_runs.details
// — see the exclusion-count queries in section 4 below.
//
// Upsert only, never delete: this file issues no Supabase row-removal call
// anywhere. A row this run doesn't touch (a gameweek that's fallen out of the
// horizon, a player who has left the league) is simply left as it was.
//
// The sentence above deliberately avoids naming the client method it is
// promising not to call. An earlier version spelled it out as an
// illustration, which meant a grep-checkable "this file never removes rows"
// definition-of-done item matched the comment saying so and had to be
// special-cased by hand. A guarantee written in a form that defeats the check
// meant to verify it is worse than no comment.
//
// BONUS (ticket #78). Bonus needs every player projected for the SAME
// fixture at once -- a different shape of input than a single player's
// gameweek total -- so it cannot be computed inline in the main player loop
// the way every other component is. This job therefore runs in two passes:
// (5) stage a per-(player, gameweek, fixture) FixtureProjection for every
// player and every fixture in the horizon, calling projectPlayerFixture
// directly rather than projectPlayerGameweek; then (5b) group the staged
// fixtures by fixtureId, call allocateFixtureBonus across each group, write
// the result into that fixture's components.bonusPoints, and RECOMPUTE that
// fixture's expectedPoints via totalMatchPoints -- never by hand-adding the
// bonus figure onto a total computed before bonus existed. Only after both
// passes does (6) aggregate the (now bonus-corrected) per-fixture rows back
// to one row per (player, gameweek) for the upsert, unchanged in shape from
// before this ticket.
//
// TWO-STAGE SHRINKAGE (ticket #113). player_match_stats now carries rows
// from more than one season (see the season column, populated per row at
// ingest time). Every match read below is split, per player, into
// CURRENT_SEASON rows and everything else ("historical"). The rate and
// defcon estimators are then applied twice: first the player's historical
// rate shrunk toward the position prior (his "personal prior"), then his
// current-season rate shrunk toward that personal prior -- see
// src/lib/projection/rates.ts's header for the one-line rule this
// implements. computePlayerRates and estimateDefconHitRate (the
// single-stage functions expectedPoints.ts calls directly) are unchanged
// and out of scope for this ticket, so the per-fixture projection gets the
// two-stage effect by construction rather than by editing that file: the
// PlayerProjectionInput fed to projectPlayerFixture below carries the
// CURRENT-SEASON history as its "rateHistory"/"defconMatches" and the
// PERSONAL PRIOR (the historical-vs-position-prior result) as its
// "ratePositionPrior"/"defconPositionPrior". expectedPoints.ts's own
// single-stage shrink of (current season, personal prior) is then
// mathematically identical to calling the two-stage functions directly --
// which this file also does, for the components.playerLevel figures
// surfaced in job_runs and player_projections, so the two never disagree.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'
import { PREMIER_LEAGUE_COMPETITION } from './lib/competition.ts'
import type { Position } from '../src/lib/scoring/types.ts'
import { GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD } from '../src/lib/scoring/types.ts'
import type { MatchPointComponents } from '../src/lib/scoring/totalMatchPoints.ts'
import { totalMatchPoints } from '../src/lib/scoring/totalMatchPoints.ts'
import {
  availabilityFactor,
  estimateMinutes,
  computePlayerRates,
  computeTwoStagePlayerRates,
  positionPriorRates,
  positionPriorHitRate,
  estimateDefconHitRate,
  estimateTwoStageDefconHitRate,
  LEAGUE_BASELINE_GOALS_PER_TEAM,
  projectPlayerFixture,
  allocateFixtureBonus,
  type PlayerRates,
  type PlayerRateHistory,
  type RateHistoryMatch,
  type PlayerProjectionInput,
  type FixtureContext,
  type FixtureProjection,
  type FixtureProjectionComponents,
  type FixtureBonusEntry,
} from '../src/lib/projection/index.ts'
import type { DefensiveContributionMatch } from '../src/lib/projection/types.ts'

const JOB_NAME = 'project-points'
const PLAYER_PROJECTIONS_MIGRATION = 'supabase/migrations/20260815120000_player_projections.sql'
const REFERENCE_SCHEMA_MIGRATION = 'supabase/migrations/20260811100000_reference_schema.sql'

/**
 * The season CORE_INSIGHTS_SEASON is set to for the "current" ingest step
 * (ticket #113) -- player_match_stats rows carrying this value in their
 * `season` column are this player's OBSERVED side of the two-stage shrink;
 * every other season's rows are historical, his personal prior's input.
 * Deliberately a literal, not read from an env var here: this job never
 * runs the ingest itself, and the boundary between "this season" and
 * "last season" is a modelling decision, not a deployment parameter --
 * see docs/projection-model-backlog.md G6.
 */
export const CURRENT_SEASON = '2026-2027'

/** How many gameweeks ahead this job projects — see ticket Notes: the solver's default horizon is 3, projecting 5 lets a later ticket raise its horizon without touching this job. */
export const PROJECTION_HORIZON = 5

/** Written to every row's model_version column. Exists so a future replacement model can be written alongside this one rather than over it. */
export const MODEL_VERSION = 'baseline-v1'

/** Minimum finished fixtures required before trusting a runtime-computed league baseline over the placeholder constant — see fixture.ts's LEAGUE_BASELINE_GOALS_PER_TEAM comment. */
const MIN_FINISHED_FIXTURES_FOR_BASELINE = 20

/** Fallback FPL FDR (1-5) when a fixture row's own difficulty column is null — the neutral middle value, same anchor fixture.ts's expectedScoreFromDifficulty uses for FDR 3. */
const DEFAULT_FPL_DIFFICULTY = 3

/** Rows written per upsert call — keeps the payload well under any PostgREST/Supabase request-size limit for a full ~600-player x 5-gameweek run. */
const UPSERT_BATCH_SIZE = 500

const POSITIONS: readonly Position[] = [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD]

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

class ProjectionError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'ProjectionError'
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
  status: 'success' | 'failure'
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
// Row shapes read from Supabase — only the fields this job uses.
// ============================================================================

interface GameweekRow {
  id: number
  is_next: boolean
}

interface TeamRow {
  id: number
  elo: number | null
}

interface PlayerRow {
  id: number
  code: number | null
  team_id: number
  element_type: number
  status: string
  chance_of_playing_next_round: number | null
}

interface FixtureRow {
  id: number
  event_id: number | null
  team_h: number
  team_a: number
  team_h_difficulty: number | null
  team_a_difficulty: number | null
}

interface FinishedFixtureRow {
  team_h_score: number | null
  team_a_score: number | null
}

interface MatchStatsRow {
  player_code: number | null
  season: string
  gameweek: number
  minutes_played: number | null
  xg: number | null
  xa: number | null
  saves: number | null
  clearances: number | null
  blocks: number | null
  interceptions: number | null
  tackles: number | null
  recoveries: number | null
}

// ============================================================================
// Ticket #113 — season-split pure helpers.
//
// Pulled out as small, independently-testable functions (this job's
// Supabase reads can't be exercised without a live project — see
// project-points.test.ts's own header) rather than left inline in the
// per-player loop in main() below, which is where every one of them is
// actually used.
// ============================================================================

/**
 * Sorts match rows so every CURRENT_SEASON row sorts ahead of every other
 * season's rows, and within each group, most recent gameweek first. This
 * is the "recentMinutes prefers the current season" requirement — a sort
 * change here, deliberately NOT in minutes.ts, which stays season-agnostic
 * and just averages whatever array of minutes it is handed.
 */
export function sortRecentFirst<T extends { season: string; gameweek: number }>(
  matches: readonly T[],
  currentSeason: string = CURRENT_SEASON,
): T[] {
  return [...matches].sort((a, b) => {
    const aCurrent = a.season === currentSeason
    const bCurrent = b.season === currentSeason
    if (aCurrent !== bCurrent) return aCurrent ? -1 : 1
    return b.gameweek - a.gameweek
  })
}

/**
 * Splits a player's match rows into this season's rows (the observed side
 * of stage 2) and every other season's rows (historical — the observed
 * side of stage 1, whose result becomes the player's personal prior). See
 * this file's header for how the two sets feed the two-stage shrink.
 */
export function splitBySeason<T extends { season: string }>(
  matches: readonly T[],
  currentSeason: string = CURRENT_SEASON,
): { current: T[]; historical: T[] } {
  const current: T[] = []
  const historical: T[] = []
  for (const m of matches) {
    if (m.season === currentSeason) current.push(m)
    else historical.push(m)
  }
  return { current, historical }
}

/** One of the three job_runs.details buckets a player falls into — always exactly one, so the three counters sum to the total player count by construction. */
export type PlayerSeasonCoverage = 'current' | 'historicalOnly' | 'neither'

/** Classifies one player's match coverage for the job_runs.details counters (ticket #113). */
export function classifySeasonCoverage(hasCurrentSeasonRows: boolean, hasHistoricalRows: boolean): PlayerSeasonCoverage {
  if (hasCurrentSeasonRows) return 'current'
  if (hasHistoricalRows) return 'historicalOnly'
  return 'neither'
}

/** Reduces one season's worth of a player's match rows into the totals `computePlayerRates`/`computeTwoStagePlayerRates` expect. */
function aggregateRateHistory(matches: readonly MatchStatsRow[]): PlayerRateHistory {
  return matches.reduce(
    (totals, m) => ({
      minutesPlayed: totals.minutesPlayed + (m.minutes_played ?? 0),
      totalXg: totals.totalXg + (m.xg ?? 0),
      totalXa: totals.totalXa + (m.xa ?? 0),
      totalSaves: totals.totalSaves + (m.saves ?? 0),
      // CBI = clearances + blocks + interceptions -- NOT tackles, same
      // definition src/lib/scoring/bps.ts uses (ticket #78).
      totalCbi: totals.totalCbi + (m.clearances ?? 0) + (m.blocks ?? 0) + (m.interceptions ?? 0),
      totalRecoveries: totals.totalRecoveries + (m.recoveries ?? 0),
    }),
    { minutesPlayed: 0, totalXg: 0, totalXa: 0, totalSaves: 0, totalCbi: 0, totalRecoveries: 0 },
  )
}

/** Maps one match row onto the defcon estimator's input shape. */
function toDefconMatch(m: MatchStatsRow): DefensiveContributionMatch {
  return {
    minutesPlayed: m.minutes_played ?? 0,
    clearances: m.clearances ?? 0,
    blocks: m.blocks ?? 0,
    interceptions: m.interceptions ?? 0,
    tackles: m.tackles ?? 0,
    recoveries: m.recoveries ?? 0,
  }
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
    // 1. Horizon: gameweeks.is_next plus the four following ids.
    //
    //    Not paginated: a season has 38 gameweeks, well under the
    //    1,000-row db-max-rows ceiling — see decisions/ticket-43.md.
    // --------------------------------------------------------------------
    const { data: gwRows, error: gwError } = await supabase
      .from('gameweeks')
      .select('id, is_next')
      .order('id', { ascending: true })
      .returns<GameweekRow[]>()

    if (gwError) {
      if (isMissingTable(gwError, 'gameweeks')) {
        throw new ProjectionError(
          `the "gameweeks" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`,
          'gameweeks',
        )
      }
      throw new ProjectionError(`gameweeks lookup failed: ${gwError.message}`, 'gameweeks')
    }
    if (!gwRows || gwRows.length === 0) {
      throw new ProjectionError(
        'the gameweeks table is empty. Run scripts/ingest-fpl.ts before projecting points.',
        'gameweeks',
      )
    }

    const nextIndex = gwRows.findIndex((gw) => gw.is_next)
    if (nextIndex === -1) {
      throw new ProjectionError(
        'no gameweek has is_next = true. Run scripts/ingest-fpl.ts to refresh gameweeks, or the season has ended.',
        'gameweeks',
      )
    }
    const horizonGameweeks = gwRows.slice(nextIndex, nextIndex + PROJECTION_HORIZON)
    const horizonGwIds = horizonGameweeks.map((gw) => gw.id)

    // --------------------------------------------------------------------
    // 2. Reference data: players, teams, fixtures in the horizon.
    //
    //    players is paginated (587 rows today, close to the 1,000-row
    //    db-max-rows ceiling and will cross it as FPL adds players through
    //    the season — see scripts/lib/paginate.ts) and its result verified
    //    against an independent count query. teams (~20 rows) and fixtures
    //    filtered to a 5-gameweek horizon (~50 rows) are not paginated —
    //    see decisions/ticket-43.md for the full audit of every read in
    //    this file.
    // --------------------------------------------------------------------
    const {
      rows: playerRows,
      error: playersError,
      pages: playersPagesFetched,
    } = await fetchAllPages<PlayerRow>((from, to) =>
      supabase
        .from('players')
        .select('id, code, team_id, element_type, status, chance_of_playing_next_round')
        .range(from, to)
        .returns<PlayerRow[]>(),
    )
    if (playersError) {
      if (isMissingTable(playersError, 'players')) {
        throw new ProjectionError(`the "players" table does not exist. Apply ${REFERENCE_SCHEMA_MIGRATION} first.`, 'players')
      }
      throw new ProjectionError(`players lookup failed: ${playersError.message}`, 'players')
    }
    if (playerRows.length === 0) {
      throw new ProjectionError('the players table is empty. Run scripts/ingest-fpl.ts before projecting points.', 'players')
    }

    const { count: playersRowsExpectedByCount, error: playersCountError } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true })
    if (playersCountError) {
      throw new ProjectionError(`players count check failed: ${playersCountError.message}`, 'players')
    }
    assertRowCountMatches('players', playerRows.length, playersRowsExpectedByCount ?? 0)

    const { data: teamRows, error: teamsError } = await supabase.from('teams').select('id, elo').returns<TeamRow[]>()
    if (teamsError) {
      throw new ProjectionError(`teams lookup failed: ${teamsError.message}`, 'teams')
    }
    const eloByTeamId = new Map<number, number | null>((teamRows ?? []).map((t) => [t.id, t.elo]))

    const { data: fixtureRows, error: fixturesError } = await supabase
      .from('fixtures')
      .select('id, event_id, team_h, team_a, team_h_difficulty, team_a_difficulty')
      .in('event_id', horizonGwIds)
      .returns<FixtureRow[]>()
    if (fixturesError) {
      throw new ProjectionError(`fixtures lookup failed: ${fixturesError.message}`, 'fixtures')
    }
    const fixturesByGw = new Map<number, FixtureRow[]>()
    for (const fixture of fixtureRows ?? []) {
      if (fixture.event_id === null) continue
      const list = fixturesByGw.get(fixture.event_id) ?? []
      list.push(fixture)
      fixturesByGw.set(fixture.event_id, list)
    }

    // --------------------------------------------------------------------
    // 3. League baseline goals: computed from finished fixtures at runtime
    //    when enough exist, else the named placeholder constant.
    //
    //    Not paginated: a 20-team season plays 380 fixtures total, well
    //    under the 1,000-row db-max-rows ceiling, and that total cannot
    //    grow mid-season — see decisions/ticket-43.md for the full audit.
    // --------------------------------------------------------------------
    const { data: finishedFixtures, error: finishedError } = await supabase
      .from('fixtures')
      .select('team_h_score, team_a_score')
      .eq('finished', true)
      .returns<FinishedFixtureRow[]>()
    if (finishedError) {
      throw new ProjectionError(`finished-fixtures lookup failed: ${finishedError.message}`, 'fixtures')
    }
    const scoredFinished = (finishedFixtures ?? []).filter(
      (f): f is { team_h_score: number; team_a_score: number } => f.team_h_score !== null && f.team_a_score !== null,
    )

    let leagueBaselineGoals: number
    let leagueBaselineGoalsSource: 'computed' | 'fallback'
    if (scoredFinished.length >= MIN_FINISHED_FIXTURES_FOR_BASELINE) {
      const totalAverageGoals = scoredFinished.reduce((sum, f) => sum + (f.team_h_score + f.team_a_score) / 2, 0)
      leagueBaselineGoals = totalAverageGoals / scoredFinished.length
      leagueBaselineGoalsSource = 'computed'
    } else {
      leagueBaselineGoals = LEAGUE_BASELINE_GOALS_PER_TEAM
      leagueBaselineGoalsSource = 'fallback'
    }

    // --------------------------------------------------------------------
    // 4. player_match_stats — THE JOIN is player_code = players.code, never
    //    player_id = players.id (see file header).
    //
    //    Over 15,000 rows in the live table — far past the 1,000-row
    //    db-max-rows ceiling. This is the read the ticket #43 audit named
    //    explicitly. Paginated and count-verified, same as players above.
    //
    //    PREMIER LEAGUE ONLY (ticket #54): filtered to
    //    competition = PREMIER_LEAGUE_COMPETITION IN THE QUERY on both the
    //    data fetch and the count-check below, so the two use the exact same
    //    filter (see scripts/project-points.test.ts's grep-based test for
    //    that identity) and the pagination/row-count guard above still
    //    composes correctly. A row whose competition is NULL or a known
    //    non-Premier-League value is excluded here and counted separately
    //    below — never assumed Premier League.
    // --------------------------------------------------------------------
    const {
      rows: matchStatsRows,
      error: matchStatsError,
      pages: matchStatsPagesFetched,
    } = await fetchAllPages<MatchStatsRow>((from, to) =>
      supabase
        .from('player_match_stats')
        .select(
          'player_code, season, gameweek, minutes_played, xg, xa, saves, clearances, blocks, interceptions, tackles, recoveries',
        )
        .eq('competition', PREMIER_LEAGUE_COMPETITION)
        .range(from, to)
        .returns<MatchStatsRow[]>(),
    )
    if (matchStatsError) {
      if (isMissingTable(matchStatsError, 'player_match_stats')) {
        throw new ProjectionError(
          'the "player_match_stats" table does not exist. Apply supabase/migrations/20260811170000_player_match_stats.sql first.',
          'player_match_stats',
        )
      }
      throw new ProjectionError(`player_match_stats lookup failed: ${matchStatsError.message}`, 'player_match_stats')
    }

    const { count: matchStatsRowsExpectedByCount, error: matchStatsCountError } = await supabase
      .from('player_match_stats')
      .select('*', { count: 'exact', head: true })
      .eq('competition', PREMIER_LEAGUE_COMPETITION)
    if (matchStatsCountError) {
      throw new ProjectionError(`player_match_stats count check failed: ${matchStatsCountError.message}`, 'player_match_stats')
    }
    assertRowCountMatches('player_match_stats', matchStatsRows.length, matchStatsRowsExpectedByCount ?? 0)

    // Exclusion counts — informational only, never used to filter anything
    // above; two independent count-only queries so a null competition (not
    // yet re-stamped since the #54 migration added the column) is reported
    // separately from a known non-Premier-League competition, per the
    // ticket's robustness requirement.
    const { count: matchStatsRowsNullCompetition, error: nullCompetitionError } = await supabase
      .from('player_match_stats')
      .select('*', { count: 'exact', head: true })
      .is('competition', null)
    if (nullCompetitionError) {
      throw new ProjectionError(
        `player_match_stats null-competition count check failed: ${nullCompetitionError.message}`,
        'player_match_stats',
      )
    }

    const { count: matchStatsRowsExcludedNonPremierLeague, error: nonPremierLeagueError } = await supabase
      .from('player_match_stats')
      .select('*', { count: 'exact', head: true })
      .not('competition', 'is', null)
      .neq('competition', PREMIER_LEAGUE_COMPETITION)
    if (nonPremierLeagueError) {
      throw new ProjectionError(
        `player_match_stats non-Premier-League count check failed: ${nonPremierLeagueError.message}`,
        'player_match_stats',
      )
    }

    const codeToPlayer = new Map<number, PlayerRow>()
    for (const player of playerRows) {
      if (player.code !== null) codeToPlayer.set(player.code, player)
    }

    const matchesByPlayerCode = new Map<number, MatchStatsRow[]>()
    const rateMatchesByPosition: Record<Position, RateHistoryMatch[]> = { 1: [], 2: [], 3: [], 4: [] }
    const defconMatchesByPosition: Record<Position, DefensiveContributionMatch[]> = { 1: [], 2: [], 3: [], 4: [] }

    for (const row of matchStatsRows) {
      if (row.player_code === null) continue // no join key on this row -- see #22 migration, a small gap is expected

      const list = matchesByPlayerCode.get(row.player_code) ?? []
      list.push(row)
      matchesByPlayerCode.set(row.player_code, list)

      const player = codeToPlayer.get(row.player_code)
      if (!player) continue // this historical player_code is not among the currently-ingested players -- contributes no position prior

      const position = player.element_type as Position
      rateMatchesByPosition[position].push({
        minutesPlayed: row.minutes_played ?? 0,
        xg: row.xg ?? 0,
        xa: row.xa ?? 0,
        saves: row.saves ?? 0,
        // CBI = clearances + blocks + interceptions -- NOT tackles, same
        // definition src/lib/scoring/bps.ts uses (ticket #78).
        cbi: (row.clearances ?? 0) + (row.blocks ?? 0) + (row.interceptions ?? 0),
        recoveries: row.recoveries ?? 0,
      })
      defconMatchesByPosition[position].push({
        minutesPlayed: row.minutes_played ?? 0,
        clearances: row.clearances ?? 0,
        blocks: row.blocks ?? 0,
        interceptions: row.interceptions ?? 0,
        tackles: row.tackles ?? 0,
        recoveries: row.recoveries ?? 0,
      })
    }

    const ratePriorByPosition = Object.fromEntries(
      POSITIONS.map((position) => [position, positionPriorRates(rateMatchesByPosition[position])]),
    ) as Record<Position, PlayerRates>

    const defconPriorByPosition = Object.fromEntries(
      POSITIONS.map((position) => [position, positionPriorHitRate(position, defconMatchesByPosition[position])]),
    ) as Record<Position, number>

    // --------------------------------------------------------------------
    // 5. Per player: build the pure model's input and stage a
    //    per-(player, gameweek, fixture) FixtureProjection for every fixture
    //    in the horizon, via projectPlayerFixture directly. Bonus cannot be
    //    finalised here -- it needs every player projected for the SAME
    //    fixture, which this per-player loop does not have visibility into
    //    -- so it is allocated in pass 5b below, after every player has been
    //    staged. See the BONUS note in this file's header (ticket #78).
    // --------------------------------------------------------------------
    // Ticket #113 counters -- exactly one of the first three increments per
    // player, by construction of classifySeasonCoverage, so they sum to
    // playerRows.length. currentSeasonRowsRead is a straight count of the
    // player_match_stats rows read above whose season is CURRENT_SEASON.
    let playersWithCurrentSeasonRows = 0
    let playersWithHistoricalOnlyRows = 0
    let playersWithNeitherSeasonRows = 0
    const currentSeasonRowsRead = matchStatsRows.filter((row) => row.season === CURRENT_SEASON).length

    interface StagedFixture {
      playerId: number
      position: Position
      gameweekId: number
      fixture: FixtureProjection
    }

    interface PlayerLevelInputs {
      pAppears: number
      pSixtyPlus: number
      xgPer90: number
      xaPer90: number
      savesPer90: number
      defconHitRate: number
    }

    interface PlayerGwKey {
      playerId: number
      playerCode: number | null
      gameweekId: number
      playerLevel: PlayerLevelInputs
    }

    const stagedFixtures: StagedFixture[] = []
    const playerGwKeys: PlayerGwKey[] = []

    for (const player of playerRows) {
      const position = player.element_type as Position
      const allMatches = player.code !== null ? (matchesByPlayerCode.get(player.code) ?? []) : []
      const { current: currentMatches, historical: historicalMatches } = splitBySeason(allMatches)

      const coverage = classifySeasonCoverage(currentMatches.length > 0, historicalMatches.length > 0)
      if (coverage === 'current') playersWithCurrentSeasonRows++
      else if (coverage === 'historicalOnly') playersWithHistoricalOnlyRows++
      else playersWithNeitherSeasonRows++

      // Ticket #113: current-season matches lead the recent-minutes window,
      // historical ones only fill in behind them -- a sort change here, not
      // in minutes.ts (see this file's header).
      const recentMatches = sortRecentFirst(allMatches).slice(0, 5)
      const recentMinutes = recentMatches.map((m) => m.minutes_played ?? 0)

      // Ticket #113: two-stage shrinkage. Stage 1 -- the player's own
      // historical rate/defcon-hit-rate, shrunk toward the position prior --
      // becomes his personal prior. Stage 2 -- his current-season rate,
      // shrunk toward that personal prior -- is what actually feeds the
      // projection. See this file's header for how `personalPrior` below
      // (rather than the raw position prior) gets threaded into
      // `projectionInput` so `projectPlayerFixture`'s own single-stage call
      // to `computePlayerRates`/`estimateDefconHitRate` reproduces stage 2
      // exactly, without expectedPoints.ts (out of scope) ever changing.
      const currentRateHistory = aggregateRateHistory(currentMatches)
      const historicalRateHistory = aggregateRateHistory(historicalMatches)
      const currentDefconMatches: DefensiveContributionMatch[] = currentMatches.map(toDefconMatch)
      const historicalDefconMatches: DefensiveContributionMatch[] = historicalMatches.map(toDefconMatch)

      const personalRatePrior = computePlayerRates(historicalRateHistory, ratePriorByPosition[position])
      const personalDefconPrior = estimateDefconHitRate(position, historicalDefconMatches, defconPriorByPosition[position])

      const projectionInput: PlayerProjectionInput = {
        position,
        status: player.status,
        chanceOfPlayingNextRound: player.chance_of_playing_next_round,
        recentMinutes,
        rateHistory: currentRateHistory,
        ratePositionPrior: personalRatePrior,
        defconMatches: currentDefconMatches,
        defconPositionPrior: personalDefconPrior,
      }

      // Player-level model inputs (fixture-invariant), computed directly
      // once per player rather than read off an arbitrary fixture -- stays
      // meaningful even for a player with zero fixtures this gameweek.
      const availability = availabilityFactor(player.status, player.chance_of_playing_next_round)
      const minutesEstimate = estimateMinutes(recentMinutes, availability)
      const playerRates = computeTwoStagePlayerRates(currentRateHistory, historicalRateHistory, ratePriorByPosition[position])
      const defconHitRate = estimateTwoStageDefconHitRate(
        position,
        currentDefconMatches,
        historicalDefconMatches,
        defconPriorByPosition[position],
      )

      for (const gw of horizonGameweeks) {
        const gwFixtures = fixturesByGw.get(gw.id) ?? []
        const teamFixtures = gwFixtures.filter((f) => f.team_h === player.team_id || f.team_a === player.team_id)

        const fixtureContexts: FixtureContext[] = teamFixtures.map((f) => {
          const isHome = f.team_h === player.team_id
          const opponentTeamId = isHome ? f.team_a : f.team_h
          const fplDifficulty = (isHome ? f.team_h_difficulty : f.team_a_difficulty) ?? DEFAULT_FPL_DIFFICULTY
          return {
            fixtureId: f.id,
            isHome,
            teamElo: eloByTeamId.get(player.team_id) ?? null,
            opponentElo: eloByTeamId.get(opponentTeamId) ?? null,
            fplDifficulty,
            leagueBaselineGoals,
          }
        })

        for (const fixtureContext of fixtureContexts) {
          stagedFixtures.push({
            playerId: player.id,
            position,
            gameweekId: gw.id,
            fixture: projectPlayerFixture(projectionInput, fixtureContext),
          })
        }

        playerGwKeys.push({
          playerId: player.id,
          playerCode: player.code,
          gameweekId: gw.id,
          playerLevel: {
            pAppears: minutesEstimate.pAppears,
            pSixtyPlus: minutesEstimate.pSixtyPlus,
            xgPer90: playerRates.xgPer90,
            xaPer90: playerRates.xaPer90,
            savesPer90: playerRates.savesPer90,
            defconHitRate,
          },
        })
      }
    }

    // --------------------------------------------------------------------
    // 5b. Bonus allocation (ticket #78) -- grouped by fixture, across every
    //     player staged for that fixture (both clubs, ~50 players -- see the
    //     ticket's Notes on why no "predicted starting eleven" filter is
    //     applied). Recomputes each fixture's expectedPoints via
    //     totalMatchPoints once bonusPoints is filled in -- never hand-added
    //     onto the total computed in pass 5, before bonus existed.
    // --------------------------------------------------------------------
    const stagedByFixtureId = new Map<number, StagedFixture[]>()
    for (const staged of stagedFixtures) {
      const list = stagedByFixtureId.get(staged.fixture.fixtureId) ?? []
      list.push(staged)
      stagedByFixtureId.set(staged.fixture.fixtureId, list)
    }

    let fixturesBonusAllocated = 0
    let fixturesZeroExcess = 0
    let playerFixturesBonusClamped = 0
    let maxProjectedBonusPerPlayerFixture = 0
    const likelyStarterBonusValues: number[] = []

    for (const group of stagedByFixtureId.values()) {
      const entries: FixtureBonusEntry<number>[] = group.map((staged, index) => ({
        id: index,
        position: staged.position,
        events: staged.fixture.expectedEvents,
      }))
      const results = allocateFixtureBonus(entries)
      const totalAllocated = results.reduce((sum, r) => sum + r.bonusPoints, 0)
      if (totalAllocated > 0) {
        fixturesBonusAllocated++
      } else {
        fixturesZeroExcess++
      }

      for (let i = 0; i < group.length; i++) {
        const staged = group[i]
        const result = results[i]

        if (result.clamped) playerFixturesBonusClamped++
        maxProjectedBonusPerPlayerFixture = Math.max(maxProjectedBonusPerPlayerFixture, result.bonusPoints)
        if (staged.fixture.expectedEvents.pSixtyPlus >= 0.5) {
          likelyStarterBonusValues.push(result.bonusPoints)
        }

        const updatedComponents: FixtureProjectionComponents = {
          ...staged.fixture.components,
          bonusPoints: result.bonusPoints,
        }
        const fullComponents: MatchPointComponents = {
          ...updatedComponents,
          penaltySavePoints: 0,
          penaltyMissPoints: 0,
          yellowCardPoints: 0,
          redCardPoints: 0,
          ownGoalPoints: 0,
        }

        staged.fixture = {
          ...staged.fixture,
          components: updatedComponents,
          expectedPoints: totalMatchPoints(fullComponents),
        }
      }
    }

    const meanProjectedBonusAmongLikelyStarters =
      likelyStarterBonusValues.length > 0
        ? likelyStarterBonusValues.reduce((sum, v) => sum + v, 0) / likelyStarterBonusValues.length
        : 0

    // --------------------------------------------------------------------
    // 6. Aggregate the (now bonus-corrected) per-fixture projections back to
    //    one row per (player, gameweek) -- same shape as before ticket #78,
    //    now running on corrected values. A player-gameweek with no fixture
    //    (a blank gameweek) still gets a row: playerGwKeys records every
    //    (player, gameweek) pair regardless of fixture count, and an empty
    //    fixture group reduces to 0 expected points / 0 expected minutes.
    // --------------------------------------------------------------------
    const stagedByPlayerGw = new Map<string, StagedFixture[]>()
    for (const staged of stagedFixtures) {
      const key = `${staged.playerId}:${staged.gameweekId}`
      const list = stagedByPlayerGw.get(key) ?? []
      list.push(staged)
      stagedByPlayerGw.set(key, list)
    }

    let fixtureEloFallbackCount = 0
    const rowsToUpsert: JsonRecord[] = []

    for (const key of playerGwKeys) {
      const group = stagedByPlayerGw.get(`${key.playerId}:${key.gameweekId}`) ?? []
      const fixtureProjections = group.map((g) => g.fixture)

      for (const fp of fixtureProjections) {
        if (fp.modelInputs.eloFallbackUsed) fixtureEloFallbackCount++
      }

      const expectedPoints = fixtureProjections.reduce((sum, fp) => sum + fp.expectedPoints, 0)
      const expectedMinutes = fixtureProjections.reduce((sum, fp) => sum + fp.expectedMinutes, 0)

      const components = fixtureProjections.reduce(
        (totals, fp) => ({
          appearancePoints: totals.appearancePoints + fp.components.appearancePoints,
          goalPoints: totals.goalPoints + fp.components.goalPoints,
          assistPoints: totals.assistPoints + fp.components.assistPoints,
          cleanSheetPoints: totals.cleanSheetPoints + fp.components.cleanSheetPoints,
          goalsConcededPoints: totals.goalsConcededPoints + fp.components.goalsConcededPoints,
          savePoints: totals.savePoints + fp.components.savePoints,
          defensiveContributionPoints: totals.defensiveContributionPoints + fp.components.defensiveContributionPoints,
          bonusPoints: totals.bonusPoints + fp.components.bonusPoints,
        }),
        {
          appearancePoints: 0,
          goalPoints: 0,
          assistPoints: 0,
          cleanSheetPoints: 0,
          goalsConcededPoints: 0,
          savePoints: 0,
          defensiveContributionPoints: 0,
          bonusPoints: 0,
        },
      )

      rowsToUpsert.push({
        gameweek_id: key.gameweekId,
        player_id: key.playerId,
        player_code: key.playerCode,
        model_version: MODEL_VERSION,
        expected_points: expectedPoints,
        expected_minutes: expectedMinutes,
        components: {
          playerLevel: key.playerLevel,
          points: components,
          fixtures: fixtureProjections.map((fp) => fp.modelInputs),
        },
        computed_at: new Date().toISOString(),
      })
    }

    // --------------------------------------------------------------------
    // 7. Upsert, batched. Never deletes.
    // --------------------------------------------------------------------
    for (let i = 0; i < rowsToUpsert.length; i += UPSERT_BATCH_SIZE) {
      const batch = rowsToUpsert.slice(i, i + UPSERT_BATCH_SIZE)
      const { error } = await supabase
        .from('player_projections')
        .upsert(batch, { onConflict: 'gameweek_id,player_id,model_version' })
      if (error) {
        if (isMissingTable(error, 'player_projections')) {
          throw new ProjectionError(
            `the "player_projections" table does not exist. Apply ${PLAYER_PROJECTIONS_MIGRATION} first.`,
            'player_projections',
          )
        }
        throw new ProjectionError(`upsert into "player_projections" failed: ${error.message}`, 'player_projections')
      }
    }

    const details: JsonRecord = {
      gameweeksProjected: horizonGameweeks.map((gw) => gw.id),
      rowsWritten: rowsToUpsert.length,
      // Ticket #113 -- these three sum exactly to playerRows.length,
      // by construction of classifySeasonCoverage (every player falls
      // into exactly one bucket). currentSeasonRowsRead is a straight
      // count of the player_match_stats rows read above whose season is
      // CURRENT_SEASON, not a per-player count. See docs/projection-model-backlog.md
      // G2 and G6.
      playersWithCurrentSeasonRows,
      playersWithHistoricalOnlyRows,
      playersWithNeitherSeasonRows,
      currentSeasonRowsRead,
      fixtureEloFallbackCount,
      leagueBaselineGoalsSource,
      leagueBaselineGoals,
      playersRowsFetched: playerRows.length,
      playersRowsExpectedByCount: playersRowsExpectedByCount ?? 0,
      playersPagesFetched,
      matchStatsRowsFetched: matchStatsRows.length,
      matchStatsRowsExpectedByCount: matchStatsRowsExpectedByCount ?? 0,
      matchStatsPagesFetched,
      // Ticket #54: rows read is the Premier-League-filtered count above;
      // excluded rows are reported as two separate named counts (known
      // non-Premier-League vs not-yet-stamped null), never combined.
      matchStatsRowsRead: matchStatsRows.length,
      matchStatsRowsExcludedNonPremierLeague: matchStatsRowsExcludedNonPremierLeague ?? 0,
      matchStatsRowsExcludedNullCompetition: matchStatsRowsNullCompetition ?? 0,
      // Ticket #78 -- bonus allocation. fixturesBonusAllocated + fixturesZeroExcess ==
      // the total number of distinct fixtures staged. See docs/projection-model-backlog.md
      // G3 for what these mean and the expected range for the last one.
      fixturesBonusAllocated,
      fixturesZeroExcess,
      playerFixturesBonusClamped,
      maxProjectedBonusPerPlayerFixture,
      meanProjectedBonusAmongLikelyStarters,
    }
    const message =
      `${JOB_NAME}: projected ${horizonGameweeks.length} gameweek(s) ` +
      `(${horizonGameweeks.map((gw) => gw.id).join(', ')}) for ${playerRows.length} players ` +
      `(${rowsToUpsert.length} rows written). player_match_stats: ${matchStatsRows.length} Premier League row(s) read, ` +
      `${matchStatsRowsExcludedNonPremierLeague ?? 0} non-Premier-League row(s) excluded, ` +
      `${matchStatsRowsNullCompetition ?? 0} null-competition row(s) excluded, ${currentSeasonRowsRead} of them ` +
      `current-season (${CURRENT_SEASON}). Coverage: ${playersWithCurrentSeasonRows} player(s) with current-season rows, ` +
      `${playersWithHistoricalOnlyRows} historical-only, ${playersWithNeitherSeasonRows} with neither. ` +
      `Bonus: ${fixturesBonusAllocated} fixture(s) ` +
      `allocated, ${fixturesZeroExcess} zero-excess, ${playerFixturesBonusClamped} player-fixture(s) clamped, mean ` +
      `${meanProjectedBonusAmongLikelyStarters.toFixed(2)} among likely starters.`
    console.log(message)
    await recordJobRun(supabase, { status: 'success', message, details, startedAt })
  } catch (err) {
    const message =
      err instanceof ProjectionError
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

// Guarded, matching scripts/sync-squad.ts: importing this module (e.g. from
// a future test file) must not trigger a real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
