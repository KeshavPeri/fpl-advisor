// Learned-model training-feature assembly — ticket #203 (R6's first slice,
// feature-list items 30/31 reshaped).
//
// THIS TICKET CHANGES NOTHING USER-VISIBLE. No model is trained here, no
// model is evaluated here, and baseline-v1 (src/lib/projection/,
// scripts/project-points.ts, scripts/run-backtest.ts) is untouched. This
// job writes public.training_features — see
// supabase/migrations/20260904090000_training_features.sql for the table
// and the FULL reasoning behind every column (not restated here beyond what
// this file's own logic needs). This mirrors the #146 → #154 pattern
// exactly: store the substrate in one ticket, consume it (train + evaluate)
// in the next.
//
// WHAT THIS BUILDS AND WHY. docs/model-review-2026-09-02.md's question 4
// and docs/projection-model-backlog.md's R6 both name the same next step: a
// small learned model on the columns this repo already ingests, trained on
// point-in-time aggregates — never OpenFPL's 196-206 undocumented features
// (product-brief.md §6d: "the ticket shape this pipeline handles worst").
// This job assembles those training rows, one per (season, gameweek_id,
// player_code), from public.feature_history (already point-in-time,
// strictly-before) plus a small amount of NEW strictly-before computation
// of its own (shots_on_target, team strength, fixture schedule) read
// directly from public.player_match_stats.
//
// FOUR NAMED COLUMNS DROPPED — NOT INGESTED ANYWHERE IN THIS REPO. The
// ticket named five "shots/chances/touches" columns as candidates: total
// shots, shots on target, chances created, big chances missed, and touches
// in the opposition box. Checked directly against
// public.player_match_stats's actual schema (every migration under
// supabase/migrations/ through 20260902090000): only shots_on_target
// exists. There is no total-shots column (only shots_on_target), and no
// chances_created / big_chances_missed / touches_in_opposition_box column
// at all — confirmed also by scripts/ingest-core-insights.ts's own
// MATCH_STATS_REQUIRED_COLUMNS and MatchStatRow, and by
// tickets/drafts/58-complete-match-stats-and-dense-history.md's own explicit
// list of source columns this repo has deliberately never ingested. Per the
// ticket's own instruction ("if a column named above turns out not to be
// ingested, drop it and say so rather than adding an ingest"), those four
// are simply absent from this job's output — no new ingest was added. See
// docs/projection-model-backlog.md for the recorded column list.
//
// RATES/SHARES, NOT RAW TOTALS — WHY THIS JOB DIFFERS FROM
// build-feature-history.ts (Tier 2, logged HIGH-IMPACT on this ticket).
// feature_history stores raw cumulative totals only, on purpose — see that
// table's own migration header. This job computes plain, UNSHRUNK per-90
// rates (xg_rate_per90, xa_rate_per90) and a season-long minutes share
// (season_avg_minutes) directly from feature_history's own prior_xg/
// prior_xa/prior_minutes/prior_matches — never by importing
// src/lib/projection/rates.ts's shrinkage (computePlayerRates /
// computeTwoStagePlayerRates), which needs a position prior and a
// shrinkage constant (SHRINKAGE_K) that are baseline-v1-specific, moving
// modelling choices. Baking baseline-v1's own shrinkage into the training
// substrate would tie every future learned-model attempt to baseline-v1's
// current tuning, and would make a "learned" model largely a re-weighting
// of baseline-v1 rather than a model that can see the raw signal and find
// its own weighting. See the migration file's own header for the fuller
// "because".
//
// NO ROW FOR prior_matches = 0 — UNLIKE feature_history, WHICH DELIBERATELY
// WRITES ONE. feature_history's job is "what was true as of every
// gameweek", including "nothing yet" (a debut gameweek gets a real
// zero-totals row). This job's admission rule is different: a
// zero-evidence row carries no real training signal (every rate/share on it
// would be null or a bare position-code prior) and baseline-v1 already
// handles that population honestly via the position prior
// (docs/projection-model-backlog.md G2). A feature_history row with
// prior_matches = 0 is skipped here, not written as a row of nulls/zeros —
// see buildTrainingFeatures's own DoD-named test.
//
// TEAM STRENGTH AND OPPONENT SCHEDULE ARE REUSED, NOT REIMPLEMENTED
// (Tier 2, logged HIGH-IMPACT on this ticket). buildTeamMatchRecords,
// computeTeamStrengthAsOf, buildClubFixtureSchedule and
// lookupClubFixtureSchedule are imported UNMODIFIED from
// scripts/run-backtest.ts (all already exported for that file's own tests)
// rather than re-derived here. Because: those four functions are already
// reviewed, tested, and exercised at the 15,000+-row scale this job
// operates at (tickets #175/#193), and reusing them byte-for-byte
// guarantees this table's team_strength_*/opponent_team_codes columns are
// computed identically to how scripts/run-backtest.ts itself would compute
// them for the same row — a second, hand-written implementation of the
// same point-in-time strictly-before logic is a second thing that could
// silently drift from the first with no test to catch it. This job never
// imports run-backtest.ts's main()/I/O; only its pure, already-exported
// computation functions and types — importing them does not modify
// scripts/run-backtest.ts and does not change anything that file does.
//
// prior_shots_on_target IS THE ONE GENUINELY NEW STRICTLY-BEFORE
// COMPUTATION IN THIS FILE. feature_history has no shots_on_target column
// (it isn't one of the totals #121/#146/#167/#181 chose to store), so this
// job computes it itself: for each feature_history row's (player_code,
// gameweek_id), sum player_match_stats.shots_on_target across that
// player's OWN Premier-League rows with gameweek < gameweek_id — the
// identical "strictly before, sum, never <=" rule feature_history's own
// prior_* totals use (see computePriorShotsOnTarget below). Grouped by
// player_code first (matchStatsByPlayerCode) so each lookup scans one
// player's own ~38-row history, not the whole season's rows.
//
// KEYED ON player_code, NEVER the per-season element id — same reasoning
// as feature_history and every cross-season table in this repo
// (deltas.md D9).
//
// PREMIER LEAGUE ONLY, FILTERED AT THE QUERY LEVEL. Every
// player_match_stats read below is `.eq('competition', PREMIER_LEAGUE_COMPETITION)`
// — never fetched unfiltered and filtered client-side — matching
// scripts/run-backtest.ts's own convention (ticket #203's own Notes: "Filter
// to competition = 'prem' on every read of player_match_stats").
//
// Reads exactly two environment variables — SUPABASE_URL and
// SUPABASE_SECRET_KEY — same convention as every other scripts/*.ts job.
//
// SEASON IS A PARAMETER (TRAINING_FEATURES_SEASON), same convention as
// FEATURE_HISTORY_SEASON: trimmed, falls back to a documented default when
// unset or blank. Its own env var name, not shared with FEATURE_HISTORY_SEASON
// or CORE_INSIGHTS_SEASON, so this job can be pointed at a different season
// without the three fighting over one variable.
//
// Upsert only, never delete: this file issues no Supabase row-removal call
// anywhere. Every Supabase read pages through scripts/lib/paginate.ts and
// verifies its count against an independent count-only query, same
// discipline every other job in this repo already follows.
//
// NOT WIRED INTO ANY WORKFLOW. Run by hand for now — see the ticket's
// scope, matching build-feature-history.ts.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'
import { PREMIER_LEAGUE_COMPETITION } from './lib/competition.ts'
import {
  buildClubFixtureSchedule,
  buildTeamMatchRecords,
  computeTeamStrengthAsOf,
  lookupClubFixtureSchedule,
  type MatchStatsForTeamStrength,
  type TeamMatchRecord,
  type TeamStrengthRecord,
} from './run-backtest.ts'

const JOB_NAME = 'build-training-features'
const FEATURE_HISTORY_MIGRATION = 'supabase/migrations/20260827090000_feature_history.sql'
const TRAINING_FEATURES_MIGRATION = 'supabase/migrations/20260904090000_training_features.sql'
const PLAYER_MATCH_STATS_MIGRATION = 'supabase/migrations/20260811170000_player_match_stats.sql'

/**
 * The season this job builds training features for, read the same way
 * scripts/build-feature-history.ts reads FEATURE_HISTORY_SEASON: trimmed
 * env var, falling back to this documented default when unset or blank.
 * Its own variable name (not shared with any sibling job's own default) so
 * this job can be pointed at a different season independently.
 */
export const DEFAULT_SEASON = '2025-2026'

/** Rows written per upsert call — keeps the payload well under any PostgREST/Supabase request-size limit. Matches build-feature-history.ts's own batch size. */
const UPSERT_BATCH_SIZE = 500

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
        `Both SUPABASE_URL and SUPABASE_SECRET_KEY must be set (missing: ${missing.join(', ')}). Making no network call.`,
    )
    return null
  }

  return { url: url as string, secretKey: secretKey as string }
}

// ============================================================================
// Errors
// ============================================================================

class TrainingFeaturesError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'TrainingFeaturesError'
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

// Same 42703/undefined_column recognition as build-feature-history.ts.
function isMissingColumn(error: PostgrestLikeError, columnName: string): boolean {
  if (error.code === '42703') return true
  const message = error.message ?? ''
  return new RegExp(columnName).test(message) && /does not exist/i.test(message)
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
// Pure computation — no I/O below this point, so every case here is
// testable on constructed rows with no live Supabase project. See
// build-training-features.test.ts.
// ============================================================================

/** The columns this job reads off feature_history — exactly what it needs, nothing summed here (already strictly-before by construction of that table). */
export interface FeatureHistorySourceRow {
  gameweek_id: number
  player_code: number
  element_type: number | null
  team_code: number | null
  prior_matches: number
  prior_minutes: number
  prior_xg: number
  prior_xa: number
  prior_recent_minutes: number[] | null
  prior_defcon_qualifying_matches: number | null
  prior_defcon_hits: number | null
}

/** The columns this job reads off player_match_stats — already filtered to `competition = 'prem'` at the query level, so this type carries no competition field at all. */
export interface MatchStatsSourceRow {
  player_code: number | null
  match_id: string
  gameweek: number
  shots_on_target: number | null
  team_code: number | null
  opponent_team_code: number | null
  team_goals_conceded: number | null
}

/** One public.training_features row, matching the migration's columns exactly. */
export interface TrainingFeatureRow {
  season: string
  gameweek_id: number
  player_code: number
  element_type: number | null
  team_code: number | null
  prior_matches: number
  xg_rate_per90: number | null
  xa_rate_per90: number | null
  prior_recent_minutes: number[] | null
  season_avg_minutes: number | null
  prior_shots_on_target: number
  prior_defcon_qualifying_matches: number | null
  prior_defcon_hits: number | null
  opponent_team_codes: (number | null)[]
  team_strength_matches: number
  team_strength_goals_scored: number
  team_strength_goals_conceded: number
  computed_at: string
}

/**
 * Sums `shots_on_target` across `playerMatches` (already this one player's
 * own contributing rows — see main()'s `matchStatsByPlayerCode` grouping)
 * strictly before `beforeGameweek` — THE LOOKAHEAD GUARD for this job's one
 * genuinely new strictly-before computation, mirroring
 * feature_history's own "gameweek < beforeGameweek, never <=" rule
 * (build-feature-history.ts) and scripts/run-backtest.ts's own
 * computeTeamStrengthAsOf. A null shots_on_target cell contributes 0, same
 * treatment every prior_* total in feature_history already gives a missing
 * cell.
 */
export function computePriorShotsOnTarget(playerMatches: readonly MatchStatsSourceRow[], beforeGameweek: number): number {
  return playerMatches.filter((m) => m.gameweek < beforeGameweek).reduce((sum, m) => sum + (m.shots_on_target ?? 0), 0)
}

/** Plain, UNSHRUNK per-90 rate: `total / (minutes / 90)`. Null when `minutes <= 0` — a genuine "no rate can be computed" case (e.g. every prior "match" was a 0-minute unused-substitute row), never a fabricated 0. See migration file header, "RATES AND SHARES". */
export function computeRatePer90(total: number, minutes: number): number | null {
  if (minutes <= 0) return null
  return total / (minutes / 90)
}

/** Average minutes per Premier League match so far this season: `minutes / matches`. Null when `matches <= 0` — in practice never reached by a row this job writes, since `buildTrainingFeatures` skips `prior_matches <= 0` before this is ever called; guarded anyway rather than assumed. */
export function computeSeasonAvgMinutes(minutes: number, matches: number): number | null {
  if (matches <= 0) return null
  return minutes / matches
}

/** This player's own club's point-in-time TeamStrengthRecord, strictly before `beforeGameweek` — `computeTeamStrengthAsOf` (imported, never reimplemented) requires a `number` team code; a null `teamCode` (feature_history could not resolve it) returns the same all-zero shape that function returns for a club with no resolvable prior matches, rather than throwing or guessing. */
export function resolveTeamStrength(teamMatchRecords: readonly TeamMatchRecord[], teamCode: number | null, beforeGameweek: number): TeamStrengthRecord {
  if (teamCode === null) return { matches: 0, goalsScored: 0, goalsConceded: 0 }
  return computeTeamStrengthAsOf(teamMatchRecords, teamCode, beforeGameweek)
}

/** This gameweek's own scheduled opponent(s) for `teamCode` — schedule, not result (see migration file header). A null `teamCode` returns `[]`, the same "nothing to look up" shape `lookupClubFixtureSchedule` returns for a club with no schedule entry that gameweek. */
export function resolveOpponentTeamCodes(schedule: ReadonlyMap<string, readonly (number | null)[]>, teamCode: number | null, gameweek: number): (number | null)[] {
  if (teamCode === null) return []
  return [...lookupClubFixtureSchedule(schedule, teamCode, gameweek)]
}

function toTeamStrengthInput(rows: readonly MatchStatsSourceRow[]): MatchStatsForTeamStrength[] {
  return rows.map((r) => ({
    matchId: r.match_id,
    gameweek: r.gameweek,
    teamCode: r.team_code,
    opponentTeamCode: r.opponent_team_code,
    teamGoalsConceded: r.team_goals_conceded,
  }))
}

export interface BuildTrainingFeaturesResult {
  rows: TrainingFeatureRow[]
  // Reconciliation identity, exact by construction (every feature_history
  // row is either skipped or written, no third path):
  //   featureHistoryRowsRead === rowsWritten + rowsExcludedNoPriorMatches
  featureHistoryRowsRead: number
  rowsExcludedNoPriorMatches: number
  rowsWritten: number
  // player_match_stats rows read for this season (already Premier-League-
  // only — filtered at the query level, see main()). A strict partition:
  //   matchStatsRowsRead === matchStatsRowsWithResolvedPlayerCode + matchStatsRowsWithUnresolvedPlayerCode
  matchStatsRowsRead: number
  matchStatsRowsWithUnresolvedPlayerCode: number
  // Diagnostics surfaced in job_runs.details — not asserted equal to
  // rowsWritten, computed independently, same discipline
  // build-feature-history.ts's own rowsWithElementType etc. use.
  rowsWithXgRate: number
  rowsWithXaRate: number
  // Strict partition of rowsWritten by whether this gameweek had a
  // resolvable scheduled fixture at all:
  //   rowsWithScheduledFixture + rowsWithBlankGameweek === rowsWritten
  rowsWithScheduledFixture: number
  rowsWithBlankGameweek: number
}

/**
 * Builds one public.training_features row per feature_history row with
 * `prior_matches > 0` (see this file's header, "NO ROW FOR
 * prior_matches = 0") — reads feature_history's own already-point-in-time
 * columns straight through, computes xg_rate_per90/xa_rate_per90/
 * season_avg_minutes from them, and adds three genuinely new pieces built
 * from `matchStatsRows` (already Premier-League-only): a strictly-before
 * `prior_shots_on_target` accumulation (this file's own), and the reused,
 * unmodified `computeTeamStrengthAsOf`/`lookupClubFixtureSchedule` from
 * scripts/run-backtest.ts for `team_strength_*`/`opponent_team_codes`.
 */
export function buildTrainingFeatures(
  featureHistoryRows: readonly FeatureHistorySourceRow[],
  matchStatsRows: readonly MatchStatsSourceRow[],
  season: string,
  computedAt: string,
): BuildTrainingFeaturesResult {
  let matchStatsRowsWithUnresolvedPlayerCode = 0
  const matchStatsByPlayerCode = new Map<number, MatchStatsSourceRow[]>()
  for (const row of matchStatsRows) {
    if (row.player_code === null) {
      matchStatsRowsWithUnresolvedPlayerCode++
      continue
    }
    const list = matchStatsByPlayerCode.get(row.player_code) ?? []
    list.push(row)
    matchStatsByPlayerCode.set(row.player_code, list)
  }

  // Team strength and the fixture schedule are built once from EVERY
  // matchStatsRows row (not filtered by resolvable player_code — these are
  // team-level constructions, keyed on team_code, exactly matching how
  // scripts/run-backtest.ts itself feeds its own unfiltered matchStatsRows
  // into these same two functions).
  const teamMatchRecords = buildTeamMatchRecords(toTeamStrengthInput(matchStatsRows))
  const clubFixtureSchedule = buildClubFixtureSchedule(toTeamStrengthInput(matchStatsRows))

  let rowsExcludedNoPriorMatches = 0
  const rows: TrainingFeatureRow[] = []

  for (const fh of featureHistoryRows) {
    if (fh.prior_matches <= 0) {
      rowsExcludedNoPriorMatches++
      continue
    }

    const playerMatches = matchStatsByPlayerCode.get(fh.player_code) ?? []
    const priorShotsOnTarget = computePriorShotsOnTarget(playerMatches, fh.gameweek_id)
    const teamStrength = resolveTeamStrength(teamMatchRecords, fh.team_code, fh.gameweek_id)
    const opponentTeamCodes = resolveOpponentTeamCodes(clubFixtureSchedule, fh.team_code, fh.gameweek_id)

    rows.push({
      season,
      gameweek_id: fh.gameweek_id,
      player_code: fh.player_code,
      element_type: fh.element_type,
      team_code: fh.team_code,
      prior_matches: fh.prior_matches,
      xg_rate_per90: computeRatePer90(fh.prior_xg, fh.prior_minutes),
      xa_rate_per90: computeRatePer90(fh.prior_xa, fh.prior_minutes),
      prior_recent_minutes: fh.prior_recent_minutes,
      season_avg_minutes: computeSeasonAvgMinutes(fh.prior_minutes, fh.prior_matches),
      prior_shots_on_target: priorShotsOnTarget,
      prior_defcon_qualifying_matches: fh.prior_defcon_qualifying_matches,
      prior_defcon_hits: fh.prior_defcon_hits,
      opponent_team_codes: opponentTeamCodes,
      team_strength_matches: teamStrength.matches,
      team_strength_goals_scored: teamStrength.goalsScored,
      team_strength_goals_conceded: teamStrength.goalsConceded,
      computed_at: computedAt,
    })
  }

  const rowsWithXgRate = rows.filter((r) => r.xg_rate_per90 !== null).length
  const rowsWithXaRate = rows.filter((r) => r.xa_rate_per90 !== null).length
  const rowsWithScheduledFixture = rows.filter((r) => r.opponent_team_codes.length > 0).length
  const rowsWithBlankGameweek = rows.filter((r) => r.opponent_team_codes.length === 0).length

  return {
    rows,
    featureHistoryRowsRead: featureHistoryRows.length,
    rowsExcludedNoPriorMatches,
    rowsWritten: rows.length,
    matchStatsRowsRead: matchStatsRows.length,
    matchStatsRowsWithUnresolvedPlayerCode,
    rowsWithXgRate,
    rowsWithXaRate,
    rowsWithScheduledFixture,
    rowsWithBlankGameweek,
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
  const season = (process.env.TRAINING_FEATURES_SEASON ?? '').trim() || DEFAULT_SEASON

  try {
    // ------------------------------------------------------------------
    // 1. feature_history — the backbone every training row is built
    //    against. Paginated and count-verified, same discipline as every
    //    other job in this repo.
    // ------------------------------------------------------------------
    const {
      rows: featureHistoryRows,
      error: featureHistoryError,
      pages: featureHistoryPagesFetched,
    } = await fetchAllPages<FeatureHistorySourceRow>((from, to) =>
      supabase
        .from('feature_history')
        .select(
          'gameweek_id, player_code, element_type, team_code, prior_matches, prior_minutes, prior_xg, prior_xa, prior_recent_minutes, prior_defcon_qualifying_matches, prior_defcon_hits',
        )
        .eq('season', season)
        .order('gameweek_id', { ascending: true })
        .order('player_code', { ascending: true })
        .range(from, to)
        .returns<FeatureHistorySourceRow[]>(),
    )
    if (featureHistoryError) {
      if (isMissingTable(featureHistoryError, 'feature_history')) {
        throw new TrainingFeaturesError(`the "feature_history" table does not exist. Apply ${FEATURE_HISTORY_MIGRATION} first.`, 'feature_history')
      }
      throw new TrainingFeaturesError(`feature_history lookup failed: ${featureHistoryError.message}`, 'feature_history')
    }
    const { count: featureHistoryExpectedCount, error: featureHistoryCountError } = await supabase
      .from('feature_history')
      .select('*', { count: 'exact', head: true })
      .eq('season', season)
    if (featureHistoryCountError) {
      throw new TrainingFeaturesError(`feature_history count check failed: ${featureHistoryCountError.message}`, 'feature_history')
    }
    assertRowCountMatches(`feature_history (season=${season})`, featureHistoryRows.length, featureHistoryExpectedCount ?? 0)

    if (featureHistoryRows.length === 0) {
      const message =
        `${JOB_NAME}: feature_history is empty for season=${season}. Nothing to build training features from. ` +
        'Run scripts/build-feature-history.ts for this season first.'
      console.log(message)
      await recordJobRun(supabase, { status: 'failure', message, details: { season }, startedAt })
      process.exit(1)
      return
    }

    // ------------------------------------------------------------------
    // 2. player_match_stats — Premier League only, filtered at the query
    //    level (see file header). 15,000+ rows for one season.
    // ------------------------------------------------------------------
    const {
      rows: matchStatsRows,
      error: matchStatsError,
      pages: matchStatsPagesFetched,
    } = await fetchAllPages<MatchStatsSourceRow>((from, to) =>
      supabase
        .from('player_match_stats')
        .select('player_code, match_id, gameweek, shots_on_target, team_code, opponent_team_code, team_goals_conceded')
        .eq('season', season)
        .eq('competition', PREMIER_LEAGUE_COMPETITION)
        .order('player_id', { ascending: true })
        .order('match_id', { ascending: true })
        .range(from, to)
        .returns<MatchStatsSourceRow[]>(),
    )
    if (matchStatsError) {
      if (isMissingTable(matchStatsError, 'player_match_stats')) {
        throw new TrainingFeaturesError(`the "player_match_stats" table does not exist. Apply ${PLAYER_MATCH_STATS_MIGRATION} first.`, 'player_match_stats')
      }
      if (isMissingColumn(matchStatsError, 'shots_on_target')) {
        throw new TrainingFeaturesError(
          `player_match_stats.shots_on_target does not exist in this database yet. Apply ${PLAYER_MATCH_STATS_MIGRATION} first.`,
          'player_match_stats',
        )
      }
      throw new TrainingFeaturesError(`player_match_stats lookup failed: ${matchStatsError.message}`, 'player_match_stats')
    }
    const { count: matchStatsExpectedCount, error: matchStatsCountError } = await supabase
      .from('player_match_stats')
      .select('*', { count: 'exact', head: true })
      .eq('season', season)
      .eq('competition', PREMIER_LEAGUE_COMPETITION)
    if (matchStatsCountError) {
      throw new TrainingFeaturesError(`player_match_stats count check failed: ${matchStatsCountError.message}`, 'player_match_stats')
    }
    assertRowCountMatches(`player_match_stats (season=${season}, competition=${PREMIER_LEAGUE_COMPETITION})`, matchStatsRows.length, matchStatsExpectedCount ?? 0)

    // ------------------------------------------------------------------
    // Pure computation — see buildTrainingFeatures above.
    // ------------------------------------------------------------------
    const computedAt = new Date().toISOString()
    const result = buildTrainingFeatures(featureHistoryRows, matchStatsRows, season, computedAt)

    // ------------------------------------------------------------------
    // Upsert, batched. Never deletes.
    // ------------------------------------------------------------------
    for (let i = 0; i < result.rows.length; i += UPSERT_BATCH_SIZE) {
      const batch = result.rows.slice(i, i + UPSERT_BATCH_SIZE)
      const { error } = await supabase.from('training_features').upsert(batch, { onConflict: 'season,gameweek_id,player_code' })
      if (error) {
        if (isMissingTable(error, 'training_features')) {
          throw new TrainingFeaturesError(`the "training_features" table does not exist. Apply ${TRAINING_FEATURES_MIGRATION} first.`, 'training_features')
        }
        throw new TrainingFeaturesError(`upsert into "training_features" failed: ${error.message}`, 'training_features')
      }
    }

    const details: JsonRecord = {
      season,
      featureHistoryRowsRead: result.featureHistoryRowsRead,
      featureHistoryPagesFetched,
      rowsExcludedNoPriorMatches: result.rowsExcludedNoPriorMatches,
      rowsWritten: result.rowsWritten,
      matchStatsRowsRead: result.matchStatsRowsRead,
      matchStatsPagesFetched,
      matchStatsRowsWithUnresolvedPlayerCode: result.matchStatsRowsWithUnresolvedPlayerCode,
      rowsWithXgRate: result.rowsWithXgRate,
      rowsWithXaRate: result.rowsWithXaRate,
      rowsWithScheduledFixture: result.rowsWithScheduledFixture,
      rowsWithBlankGameweek: result.rowsWithBlankGameweek,
    }
    const message =
      `${JOB_NAME}: season ${season} — ${result.featureHistoryRowsRead} feature_history row(s) read, ` +
      `${result.rowsExcludedNoPriorMatches} excluded (prior_matches = 0), ${result.rowsWritten} training_features row(s) written. ` +
      `${result.matchStatsRowsRead} player_match_stats row(s) read (${result.matchStatsRowsWithUnresolvedPlayerCode} with an unresolved player_code). ` +
      `${result.rowsWithXgRate} row(s) carrying a real xg_rate_per90, ${result.rowsWithXaRate} carrying a real xa_rate_per90, ` +
      `${result.rowsWithScheduledFixture} carrying a scheduled fixture, ${result.rowsWithBlankGameweek} carrying a blank gameweek.`
    console.log(message)
    await recordJobRun(supabase, { status: 'success', message, details, startedAt })
  } catch (err) {
    const message =
      err instanceof TrainingFeaturesError
        ? err.message
        : err instanceof Error
          ? `unexpected failure: ${err.message}`
          : `unexpected failure: ${String(err)}`

    console.error(`${JOB_NAME}: failed: ${message}`)

    try {
      await recordJobRun(supabase, { status: 'failure', message, details: { season }, startedAt })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}: additionally failed to record the failed job_runs row: ${recordMessage}`)
    }

    process.exit(1)
  }
}

// Guarded, matching every other job in scripts/: importing this module (e.g.
// from its test file) must not trigger a real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
