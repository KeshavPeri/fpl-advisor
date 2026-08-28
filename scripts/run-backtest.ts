// Backtest harness — ticket #133 (feature-list item 32, first slice).
//
// ============================================================================
// WHAT THIS IS, AND WHY IT IS NOT scripts/calibration-report.ts.
// ============================================================================
// calibration-report.ts compares two DISTRIBUTIONS with full-season hindsight
// on both sides — its own caveats say plainly that this is invalid for
// judging any one prediction. A backtest asks a different question: for each
// gameweek of a past season, using ONLY what was knowable strictly before
// that gameweek, what would the model have projected — and what actually
// happened? public.feature_history (ticket #121, densified by #125) makes
// this possible: every row already carries the CUMULATIVE totals of a
// player's Premier League matches strictly before its gameweek_id, nothing
// from the gameweek itself and nothing later. This job's entire job is to
// not reach past that boundary — see "THE JOIN" below.
//
// ============================================================================
// SCOPE OF THIS FIRST SLICE — measures the PROJECTION, not the recommendation.
// ============================================================================
// No transfers, no captaincy, no solver, no season league position — that is
// item 32's remaining work. This slice reads feature_history, produces one
// projected-points figure per (player, gameweek) row from the existing pure
// modules under src/lib/projection/, reconstructs that gameweek's actual
// points from player_match_stats via src/lib/scoring/, and reports the
// signed error. Read-only: the only Supabase write anywhere in this file is
// its own job_runs row.
//
// ============================================================================
// THE JOIN. Never player_match_stats for features.
// ============================================================================
// feature_history is keyed on player_code, never the FPL element id — 453 of
// 458 element ids changed between the 2025-2026 and 2026-2027 seasons (see
// the #12/#22 migrations). This job selects no player_id from either table
// and resolves position via players.code = feature_history.player_code /
// player_match_stats.player_code exclusively. Actuals are filtered to
// competition = PREMIER_LEAGUE_COMPETITION (ticket #54) — cup and European
// rows score no FPL points and carry 34% higher xG per 90.
//
// RATE INPUTS COME FROM feature_history's prior_* TOTALS AND NOTHING ELSE.
// This job never reads player_match_stats to build a rate — that table is
// read here for exactly one purpose: reconstructing the TARGET gameweek's
// actual points. If a future edit finds itself computing a rate from
// player_match_stats, the lookahead has already happened (ticket text).
//
// ============================================================================
// HOW A PROJECTION IS BUILT FROM CUMULATIVE TOTALS (Tier 2 — logged
// HIGH-IMPACT; see the Builder report for the full "because").
// ============================================================================
// feature_history stores season-to-date CUMULATIVE totals, not a per-match
// history and not a last-five-match window — so the live pipeline's exact
// inputs (scripts/project-points.ts's recent-minutes list, per-match defcon
// hit/miss history, real fixture elo) do not exist here. This job builds the
// closest honest equivalent from what IS available, using every function
// unmodified:
//
//  - Rates (xG/xA/saves/CBI/recoveries per 90): rates.ts's own formula is
//    generic in the underlying count, so a player's PlayerRateHistory is
//    built directly from prior_minutes/prior_xg/prior_xa/prior_saves/
//    prior_clearances+blocks+interceptions/prior_recoveries — an exact,
//    non-approximated mapping. The POSITION prior each row shrinks toward is
//    computed by rates.ts's own positionPriorRates(), fed every OTHER
//    player's prior_* totals for that SAME gameweek and position — itself
//    entirely knowable before that gameweek, so the prior carries no
//    lookahead either.
//
//  - Minutes and defensive-contribution hit rate need PER-MATCH data
//    (minutes.ts's last-five list; defconRate.ts's per-match threshold
//    check) that a cumulative total cannot reconstruct exactly. This job
//    approximates a player's "typical match" — average minutes per prior
//    match, average CBIT/CBIRT per prior match — and feeds that single
//    averaged match into estimateMinutes()/estimateDefconHitRate()
//    unmodified. This is a real approximation (it answers "did the AVERAGE
//    match cross the threshold", not the true match-to-match distribution)
//    and is deliberately not hidden: see docs/projection-model-backlog.md's
//    new section for the "because" and the sanity bounds this file checks
//    partly guard against exactly this kind of harness error.
//
//  - Fixture difficulty does not exist in feature_history at all (no
//    opponent, no elo, no FDR). Every row is projected against a NEUTRAL
//    fixture — fplDifficulty = 3, teamElo/opponentElo = null — which
//    fixture.ts's own DIFFICULTY_EXPECTED_SCORE table resolves to exactly
//    expectedScore = 0.5, the same value real elo gives two evenly-matched
//    teams. At that value attackingMultiplier/defensiveMultiplier are both
//    exactly 1.0 and expectedGoalsConceded is exactly leagueBaselineGoals —
//    i.e. an honest "average fixture", not a hand-derived shortcut.
//
//  - Availability: feature_history carries no players.status/
//    chance_of_playing history for a past season, and reading TODAY's
//    players table for a historical gameweek would itself be a form of
//    lookahead (today's fitness says nothing about a gameweek two seasons
//    ago). Every row is projected as fully available (status 'a') — a row
//    with prior_matches > 0 already carries positive evidence the player was
//    selectable, which is the best signal this table can offer.
//
//  - Multi-fixture gameweeks: feature_history is one row per (player,
//    gameweek), not per fixture, so a naive projection would always project
//    exactly one fixture per gameweek even when a player's team played
//    twice — CLOSED by ticket #140 (Tier 2 — logged HIGH-IMPACT; see the
//    Builder report for the full "because"). This job has no independent
//    fixture-schedule table for a past season (the live `fixtures` table
//    carries no `season` column — it is the CURRENT season's schedule
//    only), so the fixture count fed to the projected side is the number of
//    player_match_stats ROWS FOUND for that (player, gameweek) — exactly
//    the count the actual side already sums (aggregateActualForGameweek's
//    own matchesFound). Two identical neutral fixture contexts are then
//    projected and summed via expectedPoints.ts's own projectPlayerGameweek
//    (unmodified — it already sums whatever fixture array it is given).
//    This is a real approximation: a player rotated out of ONE of his
//    team's two fixtures that gameweek is still projected for 1, not the
//    team's true 2, because this job has no signal of "team fixture count"
//    independent of this player's own appearances. Documented, not hidden.
//
//  - Blank gameweeks (a player's team had NO fixture that gameweek — a
//    postponement/rearrangement, not a benching) are a DIFFERENT case from
//    "didNotFeature" (team played, this player just didn't) and get their
//    own exclusion reason, `blankGameweek` — ticket #140. Distinguishing
//    the two needs *some* notion of team schedule, which player_match_stats
//    alone does not carry as a column — but match_id embeds it as text
//    (e.g. "25-26-prem-manchester-united-vs-arsenal"). This job infers each
//    player's team-for-the-season as the single team-slug appearing most
//    often across ALL of that player's own match_id rows that season (see
//    inferTeamSlug) — the player's own team appears in every one of his
//    matches, each opponent in at most a handful — and treats a gameweek as
//    "the team played" if that slug appears in ANY match_id, for ANY
//    player, in that season+gameweek (see buildTeamSlugsByGameweek). A
//    player with too little history to resolve a team-slug (or fewer than
//    two matches, where the modal slug can tie) defaults to hadFixture =
//    true — i.e. falls back to today's didNotFeature behaviour rather than
//    guessing blankGameweek. Fail open, not fail confident.
//
// ============================================================================
// THE MEASURED POPULATION (ticket text, verbatim rule).
// ============================================================================
// A feature_history row enters the headline MAE/MSE only if ALL of:
//   1. prior_matches > 0        — otherwise there is no point-in-time signal
//                                  at all (named test: "no prior matches").
//   2. the player actually featured that gameweek (minutes_played > 0 in at
//      least one matching player_match_stats row) — a player who did not
//      feature is a correct zero on both sides that would flatter the error
//      by diluting it with an easy case (named test: "did not feature").
//   3. that gameweek's actual reconstruction is not missing
//      team_goals_conceded (~2% of rows, ticket #125's known gap, carried
//      forward here rather than solved) — without it the clean-sheet/
//      goals-conceded reconstruction is a guess, not a measurement.
//   4. the player's team did have a fixture that gameweek (ticket #140) —
//      a genuine blank gameweek is excluded as `blankGameweek`, distinct
//      from a player who simply did not feature in a fixture his team did
//      play (`didNotFeature`). See "BLANK GAMEWEEKS" below.
// Every row read falls into EXACTLY one of: measured, or one of the five
// named exclusion reasons below — a strict partition, asserted in
// assertReconciles() and covered by a named test.
//
// ============================================================================
// team_goals_conceded, NOT the per-player goals_conceded column.
// ============================================================================
// player_match_stats.goals_conceded is a goalkeeper-only stat, ~1% populated
// for outfield rows (see build-feature-history.ts's own header) — using it
// for clean-sheet reconstruction on outfield players would silently default
// nearly every one of them to "0 conceded" and inflate the derived
// clean-sheet rate toward 100%, which is exactly the failure mode
// CLEAN_SHEET_RATE_UPPER_BOUND below exists to catch. This job reads
// team_goals_conceded (added by ticket #125's migration, ~98% populated for
// 2025-2026 — the other known gap carried forward, not solved here) for
// every position, matching feature_history's own prior_team_goals_conceded
// column and build-feature-history.ts's stated correction.
//
// ============================================================================
// BONUS — excluded from both sides, without extra bookkeeping.
// ============================================================================
// The actual side has no bonus column to read (verified, ticket #127 — no
// `bonus` column in the FPL-Core-Insights source, and it can never have one).
// The projected side here calls src/lib/projection/expectedPoints.ts's
// projectPlayerFixture() directly (never scripts/project-points.ts's SEPARATE
// bonus-allocation pass), whose own components.bonusPoints is hardcoded to
// exactly 0 — so bonus is absent from both sides by construction, with no
// subtract-back-out step needed (unlike calibration-report.ts, which compares
// against project-points.ts's bonus-carrying stored output and must undo it).
//
// ============================================================================
// SANITY BOUNDS — the report FAILS, naming the figure, rather than printing
// a number nobody checked.
// ============================================================================
// Mean absolute error outside [MAE_LOWER_BOUND, MAE_UPPER_BOUND] points per
// player-gameweek, or any position's derived clean-sheet rate above
// CLEAN_SHEET_RATE_UPPER_BOUND, means the HARNESS is wrong, not the model —
// see checkSanityBounds(). The report file is still written (useful for
// diagnosing which figure failed) but the job_runs row records status
// 'failure' and the process exits non-zero.
//
// ============================================================================
// RANKING SKILL — ticket #147 (feature-list item 32, next slice after #133/
// #140). A different question from everything above: not "how close are the
// model's numbers" but "does it put the right players at the top" — the
// only thing a recommendation actually depends on (the captain IS the
// squad's top-projected player; a transfer IS a claim one player will
// outscore another). Computed entirely from the SAME `measured: MeasuredRow[]`
// population #133/#140 already build — no new Supabase read, no change to
// the measured-population rule or its reconciliation.
//
//  - Spearman rank correlation between projected and actual points, per
//    gameweek and pooled across the season (mirroring how `overall` pools
//    every measured row for MAE above) — tied values share the AVERAGE of
//    the ranks they would occupy (the standard tie-correction; many rows
//    project identically at the position prior, so ties are common, not an
//    edge case). Implemented as the Pearson correlation of the two rank
//    sequences, which is exactly the tie-corrected Spearman's rho.
//
//  - Top-10 / top-20 overlap: within one set of same-gameweek rows, which
//    rows rank in the top N by PROJECTED points, which rank in the top N by
//    ACTUAL points, and how many rows are in both sets. Selecting the top N
//    by value uses a stable sort (ties broken by original row order) — a
//    different, explicit tie rule from Spearman's average-rank rule, because
//    "top 10" must select exactly 10 rows, not a fractional rank.
//
//  - Per-gameweek figures use the SAME MIN_BUCKET_SAMPLE_SIZE (50) threshold
//    #140's buckets already use — a gameweek under that is reported "too
//    small to read", never as a correlation (ticket text). Per-position
//    figures pool the whole season for Spearman (like the existing
//    by-position MAE table) and sum top-N overlaps across every gameweek for
//    that position (no 50-row gate there: a per-gameweek goalkeeper
//    population is often under 50 by construction — roughly one starting
//    keeper per club — so gating at 50 would silently zero out goalkeepers
//    entirely rather than reporting an honestly smaller sample size).
//
//  - Sanity bounds (ticket text, pre-answered): a Spearman correlation
//    outside [-0.2, 0.9], or a top-10 overlap fraction above 9/10, fails the
//    report — checked on the season aggregate and on each position,
//    mirroring checkSanityBounds' own overall-plus-by-position shape. The
//    upper bound matters more: a suspiciously good correlation is the shape
//    a lookahead leak takes.
//
// ============================================================================
// Wiring.
// ============================================================================
// Reads exactly SUPABASE_URL and SUPABASE_SECRET_KEY. Season is
// BACKTEST_SEASON, trimmed, falling back to DEFAULT_SEASON when unset or
// blank — matching scripts/build-feature-history.ts's FEATURE_HISTORY_SEASON
// convention exactly (a job-specific env var name, same trim-and-default
// behaviour, not a shared variable). Writes to no table but job_runs (one
// row, never upserted). Writes one file, to BACKTEST_REPORT_PATH. Issues no
// Supabase insert/update/upsert/delete anywhere except that one job_runs
// insert. NOT wired into any scheduled workflow — workflow_dispatch only,
// run by hand, deliberately (this reads a whole season).

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
import { positionPriorRates, type PlayerRateHistory, type PlayerRates, type RateHistoryMatch } from '../src/lib/projection/rates.ts'
import { positionPriorHitRate } from '../src/lib/projection/defconRate.ts'
import type { DefensiveContributionMatch } from '../src/lib/projection/types.ts'
import { LEAGUE_BASELINE_GOALS_PER_TEAM } from '../src/lib/projection/fixture.ts'
import {
  projectPlayerGameweek,
  type FixtureContext,
  type FixtureProjectionComponents,
  type GameweekProjection,
  type PlayerProjectionInput,
} from '../src/lib/projection/expectedPoints.ts'

const JOB_NAME = 'run-backtest'
const FEATURE_HISTORY_MIGRATION = 'supabase/migrations/20260827090000_feature_history.sql'
const PLAYER_MATCH_STATS_MIGRATION = 'supabase/migrations/20260811170000_player_match_stats.sql'
const TEAM_GOALS_CONCEDED_MIGRATION = 'supabase/migrations/20260828090000_player_match_stats_team_goals_conceded.sql'

/**
 * Season this job backtests, read from BACKTEST_SEASON — trimmed, falling
 * back to this default when unset or blank. Matches
 * scripts/build-feature-history.ts's FEATURE_HISTORY_SEASON convention
 * exactly (job-specific env var, same trim-and-default rule), not a shared
 * variable — this job can be pointed at a different season than that job's
 * own default without the two fighting over one env var.
 */
export const DEFAULT_SEASON = '2025-2026'

const DEFAULT_REPORT_PATH = './out/backtest-report.md'

/**
 * Assumed availability for every projected row (Tier 3 — see file header).
 * No historical daily fitness signal exists in feature_history for a past
 * season, and today's players.status says nothing about a gameweek in an
 * earlier season, so this is the deliberate, documented substitute.
 */
const ASSUMED_AVAILABILITY_STATUS = 'a'

/**
 * The neutral FPL difficulty rating (1 = easiest, 5 = hardest) fed to
 * fixture.ts when no real fixture exists to project against. fixture.ts's
 * own DIFFICULTY_EXPECTED_SCORE table resolves 3 to exactly 0.5 — the same
 * expectedScore two elo-even teams produce — so every multiplier derived
 * from it below is exactly 1.0 (no adjustment). Tier 3.
 */
const NEUTRAL_FIXTURE_DIFFICULTY = 3

/**
 * Sanity bounds (ticket text, pre-answered — not fitted here). Outside these,
 * the HARNESS is wrong, not the model — see checkSanityBounds().
 */
export const MAE_LOWER_BOUND = 1.0
export const MAE_UPPER_BOUND = 3.5
export const CLEAN_SHEET_RATE_UPPER_BOUND = 0.6

/**
 * Ranking-skill sanity bounds (ticket #147, ticket text verbatim). Outside
 * these, the HARNESS is wrong, not the model — see checkRankingSanityBounds().
 * The upper bound matters more than the lower one: a suspiciously good
 * correlation is the shape a lookahead leak takes.
 */
export const SPEARMAN_LOWER_BOUND = -0.2
export const SPEARMAN_UPPER_BOUND = 0.9
/** "a top-10 overlap above 9 of 10" — expressed as the fraction 9/10 so it applies regardless of the exact denominator an aggregate figure carries. */
export const TOP10_OVERLAP_UPPER_BOUND_FRACTION = 0.9

/** A clean sheet requires 60+ minutes, same gate pointValues.ts's appearance-points split uses. */
const CLEAN_SHEET_QUALIFYING_MINUTES = 60

/**
 * Ticket #140. A bucket (prior_matches range, or the multi-fixture
 * diagnostic) with fewer than this many measured rows is reported as "too
 * small to read" rather than as a figure — same threshold and same rule
 * `src/lib/accuracy/derive.ts`'s `MIN_SAMPLE_SIZE` uses for the in-app
 * rolling accuracy display (ticket #123). Defined locally rather than
 * imported: this file's own documented convention is small, self-contained
 * constants with a comment naming the ticket, not a cross-import into the
 * display layer for one shared number.
 */
export const MIN_BUCKET_SAMPLE_SIZE = 50

/**
 * The `prior_matches` buckets the defcon and overall signed-error
 * diagnostics report by, ticket text verbatim. A measured row always has
 * `priorMatches >= 1` (rows with `prior_matches <= 0` are excluded as
 * `noPriorMatches` before ever reaching the measured population), so these
 * four buckets partition every measured row exactly once.
 */
export const PRIOR_MATCHES_BUCKETS: readonly { label: string; min: number; max: number }[] = [
  { label: '1–4', min: 1, max: 4 },
  { label: '5–9', min: 5, max: 9 },
  { label: '10–19', min: 10, max: 19 },
  { label: '20+', min: 20, max: Infinity },
]

/**
 * The multi-fixture-headline sanity threshold from the ticket text
 * verbatim: "if excluding [multi-fixture player-gameweeks] moves the season
 * headline by more than 0.05, say so prominently." Applied to mean absolute
 * error, the report's own headline figure.
 */
export const MULTI_FIXTURE_HEADLINE_THRESHOLD = 0.05

const POSITIONS: readonly Position[] = [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD]
const POSITION_NAMES: Readonly<Record<Position, string>> = {
  1: 'Goalkeeper',
  2: 'Defender',
  3: 'Midfielder',
  4: 'Forward',
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

function readSeason(): string {
  return (process.env.BACKTEST_SEASON ?? '').trim() || DEFAULT_SEASON
}

function readReportPath(): string {
  return process.env.BACKTEST_REPORT_PATH ?? DEFAULT_REPORT_PATH
}

// ============================================================================
// Errors
// ============================================================================

export class BacktestError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'BacktestError'
    this.context = context
  }
}

export class BacktestSanityError extends Error {
  failures: string[]
  constructor(failures: string[]) {
    super(`sanity bounds failed: ${failures.join('; ')}`)
    this.name = 'BacktestSanityError'
    this.failures = failures
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

// Same pattern as build-feature-history.ts's own guard: a missing
// team_goals_conceded column (the #125 migration not yet applied) fails
// loudly with a message naming the gap, rather than silently defaulting
// every clean-sheet reconstruction to "conceded nothing".
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
// Pure computation — projection side. No I/O below this point in either
// section; every case is testable on constructed rows with no live database.
// ============================================================================

/** The prior_* fields this job reads off feature_history — only what it needs. */
export interface FeatureHistoryPriorFields {
  prior_matches: number
  prior_minutes: number
  prior_xg: number
  prior_xa: number
  prior_saves: number
  prior_clearances: number
  prior_blocks: number
  prior_interceptions: number
  prior_tackles: number
  prior_recoveries: number
}

export interface FeatureHistoryRow extends FeatureHistoryPriorFields {
  gameweek_id: number
  player_code: number
}

/** Exact, non-approximated mapping — rates.ts's shrinkage formula is generic in the underlying count. */
export function buildPlayerRateHistory(row: FeatureHistoryPriorFields): PlayerRateHistory {
  return {
    minutesPlayed: row.prior_minutes,
    totalXg: row.prior_xg,
    totalXa: row.prior_xa,
    totalSaves: row.prior_saves,
    totalCbi: row.prior_clearances + row.prior_blocks + row.prior_interceptions,
    totalRecoveries: row.prior_recoveries,
  }
}

/** Same mapping, shaped for positionPriorRates() — one entry per player, summed exactly like buildPlayerRateHistory's own totals. */
export function buildRateHistoryMatch(row: FeatureHistoryPriorFields): RateHistoryMatch {
  return {
    minutesPlayed: row.prior_minutes,
    xg: row.prior_xg,
    xa: row.prior_xa,
    saves: row.prior_saves,
    cbi: row.prior_clearances + row.prior_blocks + row.prior_interceptions,
    recoveries: row.prior_recoveries,
  }
}

/** A player's average minutes per prior match — 0 with no prior matches (never divides by zero). */
export function averageMinutesPerMatch(row: Pick<FeatureHistoryPriorFields, 'prior_matches' | 'prior_minutes'>): number {
  return row.prior_matches > 0 ? row.prior_minutes / row.prior_matches : 0
}

/**
 * The single-averaged-match approximation this file's header documents —
 * feature_history has no last-five-match list, so this feeds minutes.ts's
 * estimateMinutes() one "typical match" (average minutes per prior match)
 * rather than a true recent-form window. Empty for a player with no prior
 * matches — minutes.ts's own no-history baseline applies unmodified.
 */
export function buildRecentMinutes(row: Pick<FeatureHistoryPriorFields, 'prior_matches' | 'prior_minutes'>): number[] {
  return row.prior_matches > 0 ? [averageMinutesPerMatch(row)] : []
}

/**
 * The same single-averaged-match approximation, for defconRate.ts's
 * estimateDefconHitRate() — average clearances/blocks/interceptions/tackles/
 * recoveries per prior match, checked once against the position's threshold
 * rather than per real match. Empty for a player with no prior matches.
 */
export function buildDefconMatches(row: FeatureHistoryPriorFields): DefensiveContributionMatch[] {
  if (row.prior_matches <= 0) return []
  const n = row.prior_matches
  return [
    {
      minutesPlayed: averageMinutesPerMatch(row),
      clearances: row.prior_clearances / n,
      blocks: row.prior_blocks / n,
      interceptions: row.prior_interceptions / n,
      tackles: row.prior_tackles / n,
      recoveries: row.prior_recoveries / n,
    },
  ]
}

export interface PositionPrior {
  rate: PlayerRates
  defconHitRate: number
}

function positionPriorKey(gameweekId: number, position: Position): string {
  return `${gameweekId}:${position}`
}

/**
 * Position priors, one per (gameweek, position), built ONLY from that same
 * gameweek's feature_history rows (every player's prior_* totals — already
 * strictly-before that gameweek by feature_history's own construction, so
 * the prior itself carries no lookahead). A row with prior_matches = 0
 * contributes nothing (its totals are all zero, so positionPriorRates'/
 * positionPriorHitRate's own empty-input handling applies unchanged) — see
 * this file's tests for the case that matters: a gameweek/position pair
 * where every contributing player is excluded still resolves to a defined,
 * non-throwing prior via those functions' own neutral defaults.
 */
export function computePositionPriors(
  rows: readonly FeatureHistoryRow[],
  positionOf: (playerCode: number) => Position | undefined,
): Map<string, PositionPrior> {
  const rateMatchesByKey = new Map<string, RateHistoryMatch[]>()
  const defconMatchesByKey = new Map<string, DefensiveContributionMatch[]>()
  const positionsByKey = new Map<string, Position>()

  for (const row of rows) {
    if (row.prior_matches <= 0) continue
    const position = positionOf(row.player_code)
    if (position === undefined) continue
    const key = positionPriorKey(row.gameweek_id, position)
    positionsByKey.set(key, position)

    const rateList = rateMatchesByKey.get(key) ?? []
    rateList.push(buildRateHistoryMatch(row))
    rateMatchesByKey.set(key, rateList)

    const defconList = defconMatchesByKey.get(key) ?? []
    defconList.push(...buildDefconMatches(row))
    defconMatchesByKey.set(key, defconList)
  }

  const result = new Map<string, PositionPrior>()
  for (const [key, position] of positionsByKey) {
    result.set(key, {
      rate: positionPriorRates(rateMatchesByKey.get(key) ?? []),
      defconHitRate: positionPriorHitRate(position, defconMatchesByKey.get(key) ?? []),
    })
  }
  return result
}

/** Fallback prior for a (gameweek, position) key with no contributing rows — should not occur for a row with prior_matches > 0 (it would have contributed to its own key), kept as a defensive, non-throwing default rather than an assumption the map is always populated. */
export function fallbackPositionPrior(position: Position): PositionPrior {
  return { rate: positionPriorRates([]), defconHitRate: positionPriorHitRate(position, []) }
}

/** Neutral fixture — see file header. At fplDifficulty 3, every fixture.ts multiplier this produces is exactly 1.0. */
function buildNeutralFixtureContext(gameweekId: number): FixtureContext {
  return {
    fixtureId: gameweekId,
    isHome: true,
    teamElo: null,
    opponentElo: null,
    fplDifficulty: NEUTRAL_FIXTURE_DIFFICULTY,
    leagueBaselineGoals: LEAGUE_BASELINE_GOALS_PER_TEAM,
  }
}

/**
 * Projects one feature_history row via src/lib/projection/expectedPoints.ts's
 * own combiner, imported and never reimplemented. Every input is built ONLY
 * from this row's prior_* totals (rate history, recent-minutes/defcon
 * approximations) and a position prior computed from the SAME gameweek's
 * data (computePositionPriors) — nothing here reads any later gameweek.
 *
 * `fixtureCount` (ticket #140) — how many fixtures the player's team held
 * this gameweek, defaulting to 1 so every existing call site (and every
 * pre-#140 test) is an EXACT no-op: one neutral fixture context, identical
 * to this function's behaviour before this ticket. For fixtureCount > 1,
 * the SAME neutral context (see buildNeutralFixtureContext's own header —
 * expectedScore is exactly 0.5, the neutral value) is repeated and summed
 * by projectPlayerGameweek, unmodified — never reimplemented here. A
 * negative or fractional count is truncated at 0, defensively; main() never
 * passes one (fixtureCount is always a real row count from the actual
 * side).
 */
export function projectRow(row: FeatureHistoryRow, position: Position, prior: PositionPrior, fixtureCount = 1): GameweekProjection {
  const input: PlayerProjectionInput = {
    position,
    status: ASSUMED_AVAILABILITY_STATUS,
    chanceOfPlayingNextRound: null,
    recentMinutes: buildRecentMinutes(row),
    rateHistory: buildPlayerRateHistory(row),
    ratePositionPrior: prior.rate,
    defconMatches: buildDefconMatches(row),
    defconPositionPrior: prior.defconHitRate,
  }
  const count = Math.max(0, Math.trunc(fixtureCount))
  const fixtures: FixtureContext[] = Array.from({ length: count }, () => buildNeutralFixtureContext(row.gameweek_id))
  return projectPlayerGameweek(input, fixtures)
}

/** The 7 point components this job compares — bonus is deliberately absent (see file header); projectPlayerFixture's own bonusPoints is always exactly 0. */
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

function addComponentTotals(a: ComponentTotals, b: ComponentTotals): ComponentTotals {
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

export function sumComponentTotals(list: readonly ComponentTotals[]): ComponentTotals {
  return list.reduce(addComponentTotals, emptyComponentTotals())
}

/** Picks the 7 comparable components out of expectedPoints.ts's own component shape, dropping bonusPoints (always 0 — see file header). */
export function pickProjectedComponents(components: FixtureProjectionComponents): ComponentTotals {
  return {
    appearancePoints: components.appearancePoints,
    goalPoints: components.goalPoints,
    assistPoints: components.assistPoints,
    cleanSheetPoints: components.cleanSheetPoints,
    goalsConcededPoints: components.goalsConcededPoints,
    savePoints: components.savePoints,
    defensiveContributionPoints: components.defensiveContributionPoints,
  }
}

// ============================================================================
// Pure computation — actual side. Reconstructs one match's real FPL points
// from src/lib/scoring/'s own functions, never reimplemented. Mirrors
// scripts/calibration-report.ts's reconstructActualMatchPoints in shape, with
// one deliberate difference: goals conceded/clean sheet are read from
// team_goals_conceded (the team-level figure), never the per-player
// goals_conceded column — see file header.
// ============================================================================

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

export interface ReconstructedMatch {
  minutes: number
  totalPoints: number
  components: ComponentTotals
}

export function reconstructActualMatchPoints(position: Position, stats: ActualMatchStatsInput): ReconstructedMatch {
  const minutes = stats.minutesPlayed ?? 0
  const goals = stats.goals ?? 0
  const assists = stats.assists ?? 0
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
  const isCleanSheet = minutes >= CLEAN_SHEET_QUALIFYING_MINUTES && teamGoalsConceded === 0

  const components: ComponentTotals = {
    appearancePoints,
    goalPoints: goals * goalPoints(position),
    assistPoints: assists * ASSIST_POINTS,
    cleanSheetPoints: isCleanSheet ? cleanSheetPoints(position) : 0,
    goalsConcededPoints: goalsConcededPointsApply(position)
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
    // Bonus deliberately excluded from both sides — see file header. Never
    // set to anything but 0 here.
    bonusPoints: 0,
  }

  return { minutes, totalPoints: totalMatchPoints(fullComponents), components }
}

export interface ActualGameweekOutcome {
  /** True if any matching row has minutes_played > 0 — the "did the player feature" gate. */
  featured: boolean
  /** False if any matching row is missing team_goals_conceded — the "actual data incomplete" gate. Vacuously true for zero rows. */
  teamGoalsConcededKnown: boolean
  totalPoints: number
  components: ComponentTotals
  minutes: number
  matchesFound: number
}

/**
 * Aggregates every player_match_stats row found for one (player, gameweek)
 * into one outcome. Each row is reconstructed independently and SUMMED
 * (never averaged or merged first) — the correct behaviour for a genuine
 * double gameweek, where FPL scores each match separately. Zero rows is the
 * "no data found at all" case: featured = false, an empty ComponentTotals,
 * teamGoalsConcededKnown = true (vacuous — nothing to be missing).
 */
export function aggregateActualForGameweek(position: Position, rows: readonly ActualMatchStatsInput[]): ActualGameweekOutcome {
  const featured = rows.some((r) => (r.minutesPlayed ?? 0) > 0)
  const teamGoalsConcededKnown = rows.every((r) => r.teamGoalsConceded !== null && r.teamGoalsConceded !== undefined)
  const reconstructed = rows.map((r) => reconstructActualMatchPoints(position, r))
  return {
    featured,
    teamGoalsConcededKnown,
    totalPoints: reconstructed.reduce((sum, r) => sum + r.totalPoints, 0),
    components: sumComponentTotals(reconstructed.map((r) => r.components)),
    minutes: reconstructed.reduce((sum, r) => sum + r.minutes, 0),
    matchesFound: rows.length,
  }
}

/** The five named exclusion reasons — see classifyRow. `blankGameweek` added by ticket #140. */
export type ExclusionReason = 'noPriorMatches' | 'didNotFeature' | 'actualDataIncomplete' | 'unresolvedPlayerCode' | 'blankGameweek'

export type RowClassification =
  | { kind: 'excluded'; reason: ExclusionReason }
  | { kind: 'measured'; position: Position; outcome: ActualGameweekOutcome }

/**
 * Classifies one feature_history row into the measured population or exactly
 * one named exclusion reason — the single source of truth main() and this
 * file's tests both use, so the exclusion rule proven by test is the exact
 * rule the job runs. See this file's header, "THE MEASURED POPULATION".
 *
 * `hadFixture` (ticket #140) defaults to `true` so every existing 3-arg call
 * site — every pre-#140 test included — is an EXACT no-op: unfeatured stays
 * `didNotFeature`, unchanged. Only when the caller can positively determine
 * the player's team had no fixture this gameweek (see file header, "BLANK
 * GAMEWEEKS") does `hadFixture = false` redirect an unfeatured row to the
 * new `blankGameweek` reason instead.
 */
export function classifyRow(
  row: FeatureHistoryRow,
  position: Position | undefined,
  actualRows: readonly ActualMatchStatsInput[],
  hadFixture = true,
): RowClassification {
  if (position === undefined) return { kind: 'excluded', reason: 'unresolvedPlayerCode' }
  if (row.prior_matches <= 0) return { kind: 'excluded', reason: 'noPriorMatches' }

  const outcome = aggregateActualForGameweek(position, actualRows)
  if (!outcome.featured) return { kind: 'excluded', reason: hadFixture ? 'didNotFeature' : 'blankGameweek' }
  if (!outcome.teamGoalsConcededKnown) return { kind: 'excluded', reason: 'actualDataIncomplete' }

  return { kind: 'measured', position, outcome }
}

// ============================================================================
// Pure computation — error, aggregation, sanity bounds, reconciliation.
// ============================================================================

export interface MeasuredRow {
  gameweekId: number
  position: Position
  projectedPoints: number
  actualPoints: number
  /** projected - actual. Positive = the model over-projected; negative = under-projected. */
  signedError: number
  absError: number
  projectedComponents: ComponentTotals
  actualComponents: ComponentTotals
  actualMinutes: number
  /**
   * Ticket #140. How many fixtures this player's team held this gameweek —
   * taken directly from the actual side's own `matchesFound` (the count of
   * `player_match_stats` rows found for this player, this gameweek), the
   * same count `projectRow` was given to build the matching number of
   * projected fixtures. 1 for the ordinary case; >1 identifies a
   * multi-fixture player-gameweek for the diagnostic below.
   */
  fixtureCount: number
  /** Ticket #140. `feature_history.prior_matches` at classification time — the bucketing key for the defcon and overall signed-error diagnostics. */
  priorMatches: number
}

export function buildMeasuredRow(
  gameweekId: number,
  position: Position,
  projectedPoints: number,
  projectedComponents: ComponentTotals,
  actual: ActualGameweekOutcome,
  priorMatches = 0,
): MeasuredRow {
  const signedError = projectedPoints - actual.totalPoints
  return {
    gameweekId,
    position,
    projectedPoints,
    actualPoints: actual.totalPoints,
    signedError,
    absError: Math.abs(signedError),
    projectedComponents,
    actualComponents: actual.components,
    actualMinutes: actual.minutes,
    fixtureCount: actual.matchesFound,
    priorMatches,
  }
}

export interface ErrorSummary {
  n: number
  meanAbsoluteError: number | null
  meanSignedError: number | null
}

export function summarizeErrors(rows: readonly MeasuredRow[]): ErrorSummary {
  const n = rows.length
  if (n === 0) return { n: 0, meanAbsoluteError: null, meanSignedError: null }
  return {
    n,
    meanAbsoluteError: rows.reduce((sum, r) => sum + r.absError, 0) / n,
    meanSignedError: rows.reduce((sum, r) => sum + r.signedError, 0) / n,
  }
}

export function summarizeByPosition(rows: readonly MeasuredRow[]): Record<Position, ErrorSummary> {
  const result = {} as Record<Position, ErrorSummary>
  for (const position of POSITIONS) {
    result[position] = summarizeErrors(rows.filter((r) => r.position === position))
  }
  return result
}

export function summarizeByGameweek(rows: readonly MeasuredRow[]): Map<number, ErrorSummary> {
  const gameweekIds = [...new Set(rows.map((r) => r.gameweekId))].sort((a, b) => a - b)
  const result = new Map<number, ErrorSummary>()
  for (const gameweekId of gameweekIds) {
    result.set(
      gameweekId,
      summarizeErrors(rows.filter((r) => r.gameweekId === gameweekId)),
    )
  }
  return result
}

/**
 * States the mean signed error in words — the most important sentence in the
 * report, per the ticket ("this sign is easy to invert and impossible to
 * spot once rendered"). signedError = projected - actual throughout this
 * file, so a POSITIVE mean means the model projects MORE than what actually
 * happened (over-projecting); NEGATIVE means it projects less
 * (under-projecting).
 */
export function describeSignedError(meanSignedError: number | null): string {
  if (meanSignedError === null) return 'no measured rows to describe'
  if (meanSignedError > 0) {
    return `the model is OVER-projecting by ${meanSignedError.toFixed(3)} points per player-gameweek on average`
  }
  if (meanSignedError < 0) {
    return `the model is UNDER-projecting by ${Math.abs(meanSignedError).toFixed(3)} points per player-gameweek on average`
  }
  return 'the model is exactly calibrated on average (mean signed error is precisely 0)'
}

/** Fraction of qualifying (60+ actual minutes) rows, by position, whose ACTUAL reconstruction registered a clean sheet. Null with no qualifying rows for that position — "no data", not "0%". */
export function derivedCleanSheetRate(rows: readonly MeasuredRow[], position: Position): number | null {
  const qualifying = rows.filter((r) => r.position === position && r.actualMinutes >= CLEAN_SHEET_QUALIFYING_MINUTES)
  if (qualifying.length === 0) return null
  const hits = qualifying.filter((r) => r.actualComponents.cleanSheetPoints > 0).length
  return hits / qualifying.length
}

export interface SanityCheckResult {
  ok: boolean
  failures: string[]
}

/**
 * The report FAILS, naming the figure, rather than printing a number nobody
 * checked (ticket text). Outside these bounds means the HARNESS is wrong,
 * not the model.
 */
export function checkSanityBounds(overallMae: number | null, cleanSheetRateByPosition: Partial<Record<Position, number | null>>): SanityCheckResult {
  const failures: string[] = []

  if (overallMae !== null && (overallMae < MAE_LOWER_BOUND || overallMae > MAE_UPPER_BOUND)) {
    failures.push(
      `overall mean absolute error ${overallMae.toFixed(3)} is outside the sane bound [${MAE_LOWER_BOUND}, ${MAE_UPPER_BOUND}] points per player-gameweek`,
    )
  }

  for (const position of POSITIONS) {
    const rate = cleanSheetRateByPosition[position]
    if (rate !== null && rate !== undefined && rate > CLEAN_SHEET_RATE_UPPER_BOUND) {
      failures.push(
        `${POSITION_NAMES[position]} derived clean-sheet rate ${(rate * 100).toFixed(1)}% exceeds the sane bound ${(CLEAN_SHEET_RATE_UPPER_BOUND * 100).toFixed(0)}%`,
      )
    }
  }

  return { ok: failures.length === 0, failures }
}

/** The five named exclusion reasons — a strict partition of every feature_history row read, alongside measuredCount. See assertReconciles. `blankGameweek` added by ticket #140. */
export interface ExclusionCounts {
  noPriorMatches: number
  didNotFeature: number
  actualDataIncomplete: number
  unresolvedPlayerCode: number
  blankGameweek: number
}

export function emptyExclusionCounts(): ExclusionCounts {
  return { noPriorMatches: 0, didNotFeature: 0, actualDataIncomplete: 0, unresolvedPlayerCode: 0, blankGameweek: 0 }
}

/** Mutates counts in place, incrementing the named reason by 1 — the one place a classifyRow exclusion reason is turned into a count. */
export function incrementExclusion(counts: ExclusionCounts, reason: ExclusionReason): void {
  counts[reason]++
}

export function totalExcluded(counts: ExclusionCounts): number {
  return counts.noPriorMatches + counts.didNotFeature + counts.actualDataIncomplete + counts.unresolvedPlayerCode + counts.blankGameweek
}

/** rows read = rows measured + rows excluded, by reason, exactly — throws naming both sides on any mismatch. */
export function assertReconciles(rowsRead: number, measuredCount: number, counts: ExclusionCounts): void {
  const excluded = totalExcluded(counts)
  const total = measuredCount + excluded
  if (total !== rowsRead) {
    throw new BacktestError(
      `reconciliation failed: ${rowsRead} feature_history row(s) read, but measured (${measuredCount}) + excluded (${excluded}) = ${total}. ` +
        `Exclusion breakdown: ${JSON.stringify(counts)}.`,
      'reconciliation',
    )
  }
}

// ============================================================================
// Team-slug inference — ticket #140, blank-gameweek detection. Pure text
// parsing over match_id, no I/O. See file header, "BLANK GAMEWEEKS".
// ============================================================================

/** Every match_id this job reads is already filtered to competition = prem at the query level (see main()). */
const MATCH_ID_PREM_PREFIX_RE = /^\d{2}-\d{2}-prem-/

/**
 * Splits a Premier League match_id into its two team slugs, e.g.
 * "25-26-prem-manchester-united-vs-arsenal" -> ["manchester-united",
 * "arsenal"]. Returns null for anything that does not match the expected
 * "<season>-prem-<home>-vs-<away>" shape — never guesses.
 */
export function parseMatchIdTeamSlugs(matchId: string): readonly [string, string] | null {
  if (!MATCH_ID_PREM_PREFIX_RE.test(matchId)) return null
  const remainder = matchId.replace(MATCH_ID_PREM_PREFIX_RE, '')
  const parts = remainder.split('-vs-')
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return null
  return [parts[0], parts[1]]
}

/**
 * Infers a player's team-for-the-season as the single team-slug appearing
 * MOST OFTEN across all of the match_ids passed in — a player's own team
 * appears in every one of his matches, while any one opponent appears at
 * most a handful of times (home leg, away leg, and rarely more via
 * rearranged fixtures), so the modal slug is the player's team. Returns
 * null with no parseable match_id at all. A player with exactly one
 * parseable match can tie between his own team and that match's single
 * opponent — this function returns whichever slug it encounters first in
 * that case, which is why callers (see buildTeamSlugsByGameweek's caller in
 * main()) treat an unresolved-or-unreliable team as hadFixture = true
 * (fail open to today's didNotFeature behaviour) rather than trusting a
 * single-match inference.
 */
export function inferTeamSlug(matchIds: readonly string[]): string | null {
  const counts = new Map<string, number>()
  for (const matchId of matchIds) {
    const pair = parseMatchIdTeamSlugs(matchId)
    if (pair === null) continue
    for (const slug of pair) counts.set(slug, (counts.get(slug) ?? 0) + 1)
  }
  let bestSlug: string | null = null
  let bestCount = 0
  for (const [slug, count] of counts) {
    if (count > bestCount) {
      bestSlug = slug
      bestCount = count
    }
  }
  return bestSlug
}

/**
 * The set of team-slugs that played at all in each gameweek, from every
 * match_id across every player — the "did this team have a fixture this
 * gameweek" lookup blankGameweek detection needs. Built once per run from
 * the SAME player_match_stats rows already fetched for actuals, so it costs
 * no extra Supabase round trip.
 */
export function buildTeamSlugsByGameweek(rows: readonly { gameweek: number; matchId: string }[]): Map<number, Set<string>> {
  const result = new Map<number, Set<string>>()
  for (const row of rows) {
    const pair = parseMatchIdTeamSlugs(row.matchId)
    if (pair === null) continue
    const set = result.get(row.gameweek) ?? new Set<string>()
    set.add(pair[0])
    set.add(pair[1])
    result.set(row.gameweek, set)
  }
  return result
}

// ============================================================================
// Diagnostics — ticket #140. Pure, over the already-built measured
// population, no I/O.
// ============================================================================

export interface BucketSummary {
  label: string
  n: number
  /** null when n < MIN_BUCKET_SAMPLE_SIZE — "too small to read", not a guessed figure. */
  meanSignedError: number | null
  tooSmallToRead: boolean
}

/**
 * Buckets measured rows by `priorMatches` into PRIOR_MATCHES_BUCKETS and
 * reports the mean of whatever signed-error quantity `valueOf` picks off
 * each row — used for both the defcon-only breakdown and the overall
 * signed-error breakdown (ticket text: "the same bucketing"), so the
 * bucketing logic itself is written once.
 */
export function bucketByPriorMatches(rows: readonly MeasuredRow[], valueOf: (row: MeasuredRow) => number): BucketSummary[] {
  return PRIOR_MATCHES_BUCKETS.map(({ label, min, max }) => {
    const bucketRows = rows.filter((r) => r.priorMatches >= min && r.priorMatches <= max)
    const n = bucketRows.length
    const tooSmallToRead = n < MIN_BUCKET_SAMPLE_SIZE
    const meanSignedError = tooSmallToRead ? null : bucketRows.reduce((sum, r) => sum + valueOf(r), 0) / n
    return { label, n, meanSignedError, tooSmallToRead }
  })
}

/** The defcon-only signed error for one measured row: projected defcon points minus actual defcon points. */
export function defconSignedError(row: MeasuredRow): number {
  return row.projectedComponents.defensiveContributionPoints - row.actualComponents.defensiveContributionPoints
}

export interface MultiFixtureDiagnostic {
  /** Player-gameweeks with fixtureCount > 1 — the population the diagnostic isolates. */
  multiFixtureCount: number
  /** The season headline (every measured row) — identical to ReportData.overall, repeated here so the "with"/"without" comparison is self-contained. */
  withMultiFixture: ErrorSummary
  /** The headline recomputed excluding multi-fixture player-gameweeks. */
  withoutMultiFixture: ErrorSummary
  /** withMultiFixture.MAE - withoutMultiFixture.MAE. Null if either side has no rows. */
  maeDelta: number | null
  /** Ticket text: "if excluding them moves the season headline by more than 0.05, say so prominently." */
  movesHeadlineSignificantly: boolean
}

export function buildMultiFixtureDiagnostic(rows: readonly MeasuredRow[]): MultiFixtureDiagnostic {
  const multiFixtureRows = rows.filter((r) => r.fixtureCount > 1)
  const withMultiFixture = summarizeErrors(rows)
  const withoutMultiFixture = summarizeErrors(rows.filter((r) => r.fixtureCount <= 1))
  const maeDelta =
    withMultiFixture.meanAbsoluteError !== null && withoutMultiFixture.meanAbsoluteError !== null
      ? withMultiFixture.meanAbsoluteError - withoutMultiFixture.meanAbsoluteError
      : null
  return {
    multiFixtureCount: multiFixtureRows.length,
    withMultiFixture,
    withoutMultiFixture,
    maeDelta,
    movesHeadlineSignificantly: maeDelta !== null && Math.abs(maeDelta) > MULTI_FIXTURE_HEADLINE_THRESHOLD,
  }
}

/** Count of measured rows with fixtureCount > 1, per gameweek — the fixture-count column the by-gameweek table carries (ticket text). */
export function countMultiFixtureRowsByGameweek(rows: readonly MeasuredRow[]): Map<number, number> {
  const result = new Map<number, number>()
  for (const row of rows) {
    if (row.fixtureCount <= 1) continue
    result.set(row.gameweekId, (result.get(row.gameweekId) ?? 0) + 1)
  }
  return result
}

/** "4,209 of 18,243 is 23%" — ticket text verbatim. Rounds to the nearest whole percentage point, and is 0% (never NaN) with zero rows read. */
export function formatExclusionPercentage(count: number, rowsRead: number): string {
  if (rowsRead <= 0) return '0%'
  return `${Math.round((count / rowsRead) * 100)}%`
}

// ============================================================================
// RANKING SKILL — ticket #147. Pure, over the already-built measured
// population (the SAME `MeasuredRow[]` #133/#140 build), no I/O. See file
// header, "RANKING SKILL".
// ============================================================================

/** The two comparable values one measured row contributes to a ranking — projected and actual points, paired by construction (one row IS one player-gameweek on both sides). */
export interface RankingPair {
  projected: number
  actual: number
}

export function toRankingPair(row: Pick<MeasuredRow, 'projectedPoints' | 'actualPoints'>): RankingPair {
  return { projected: row.projectedPoints, actual: row.actualPoints }
}

/**
 * 1-based ranks, descending (rank 1 = the highest value), with the STANDARD
 * average-rank tie correction: values tied for positions i..j (0-based, so
 * ranks i+1..j+1) all receive the mean of those ranks. This is the tie rule
 * Spearman's rho is defined against (ticket text: "average ranks is
 * standard") — ties are common here, not an edge case, since many rows
 * project identically at the position prior.
 */
export function rankDescending(values: readonly number[]): number[] {
  const n = values.length
  const order = values.map((_, i) => i).sort((a, b) => values[b] - values[a])
  const ranks = new Array<number>(n)
  let i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && values[order[j + 1]] === values[order[i]]) j++
    // Positions i..j (0-based) occupy ranks i+1..j+1 (1-based) — their average is the tied rank every one of them receives.
    const averageRank = (i + 1 + (j + 1)) / 2
    for (let k = i; k <= j; k++) ranks[order[k]] = averageRank
    i = j + 1
  }
  return ranks
}

/** Pearson correlation of two equal-length numeric sequences. Null (never NaN) when either side has zero variance — a correlation is undefined, not zero, when one side is constant. */
function pearsonCorrelation(a: readonly number[], b: readonly number[]): number | null {
  const n = a.length
  const meanA = a.reduce((sum, x) => sum + x, 0) / n
  const meanB = b.reduce((sum, x) => sum + x, 0) / n
  let covariance = 0
  let varianceA = 0
  let varianceB = 0
  for (let i = 0; i < n; i++) {
    const deviationA = a[i] - meanA
    const deviationB = b[i] - meanB
    covariance += deviationA * deviationB
    varianceA += deviationA * deviationA
    varianceB += deviationB * deviationB
  }
  if (varianceA === 0 || varianceB === 0) return null
  return covariance / Math.sqrt(varianceA * varianceB)
}

/**
 * Spearman rank correlation between projected and actual points, over
 * whatever set of pairs is passed in (a single gameweek, a position pooled
 * across the season, or the whole season) — implemented as the Pearson
 * correlation of the two rank sequences (rankDescending's average-rank tie
 * correction), which IS the tie-corrected Spearman's rho, not an
 * approximation of it. Null with fewer than 2 pairs, or when either side's
 * ranks carry no variance at all (every value tied) — undefined, not 0.
 */
export function spearmanCorrelation(pairs: readonly RankingPair[]): number | null {
  if (pairs.length < 2) return null
  const projectedRanks = rankDescending(pairs.map((p) => p.projected))
  const actualRanks = rankDescending(pairs.map((p) => p.actual))
  return pearsonCorrelation(projectedRanks, actualRanks)
}

/** One top-N overlap figure: how many of the N pairs selected by projected value are ALSO among the N pairs selected by actual value, and the N actually used (== min(requested N, population) — never claims a top-10 out of a population of 4). */
export interface TopNOverlap {
  overlap: number
  n: number
}

/**
 * Selects the top `topN` pairs by projected value and the top `topN` pairs
 * by actual value — from the SAME set of pairs, so "overlap" means the same
 * row ranks highly on both sides, no player identity needed — and counts how
 * many rows are in both sets. Selection uses a stable sort (Array.prototype.sort
 * is stable per the ES2019 spec, and Node's V8 engine implements it), so ties
 * at the selection boundary are broken by original row order — a DIFFERENT,
 * explicit tie rule from spearmanCorrelation's average-rank rule, because a
 * top-N selection must choose exactly N rows, not award a fractional slot to
 * every tied row (ticket text: "decide the tie rule explicitly").
 */
export function topNOverlap(pairs: readonly RankingPair[], topN: number): TopNOverlap {
  const n = Math.min(topN, pairs.length)
  if (n <= 0) return { overlap: 0, n: 0 }
  const indices = pairs.map((_, i) => i)
  const byProjected = [...indices].sort((a, b) => pairs[b].projected - pairs[a].projected).slice(0, n)
  const byActual = new Set([...indices].sort((a, b) => pairs[b].actual - pairs[a].actual).slice(0, n))
  const overlap = byProjected.filter((idx) => byActual.has(idx)).length
  return { overlap, n }
}

export interface GameweekRankingSummary {
  gameweekId: number
  n: number
  /** Ticket text: a gameweek under MIN_BUCKET_SAMPLE_SIZE is "too small to read", never a correlation — spearman/top10/top20 are all null when this is true. */
  tooSmallToRead: boolean
  spearman: number | null
  top10: TopNOverlap | null
  top20: TopNOverlap | null
}

/** Per-gameweek Spearman + top-10/20 overlap, gated by the same MIN_BUCKET_SAMPLE_SIZE #140's buckets already use. */
export function summarizeRankingByGameweek(rows: readonly MeasuredRow[]): Map<number, GameweekRankingSummary> {
  const gameweekIds = [...new Set(rows.map((r) => r.gameweekId))].sort((a, b) => a - b)
  const result = new Map<number, GameweekRankingSummary>()
  for (const gameweekId of gameweekIds) {
    const gameweekRows = rows.filter((r) => r.gameweekId === gameweekId)
    const n = gameweekRows.length
    const tooSmallToRead = n < MIN_BUCKET_SAMPLE_SIZE
    const pairs = gameweekRows.map(toRankingPair)
    result.set(gameweekId, {
      gameweekId,
      n,
      tooSmallToRead,
      spearman: tooSmallToRead ? null : spearmanCorrelation(pairs),
      top10: tooSmallToRead ? null : topNOverlap(pairs, 10),
      top20: tooSmallToRead ? null : topNOverlap(pairs, 20),
    })
  }
  return result
}

export interface SeasonRankingSummary {
  n: number
  /** Pooled across every measured row, regardless of gameweek — mirrors how `overall` pools every row for MAE. */
  spearman: number | null
  /** Sum of each non-too-small gameweek's overlap and N — a season overlap RATE, not a single top-10 selection over 8,000+ pooled rows (which "top 10 of the season" would not sensibly mean). */
  top10: TopNOverlap
  top20: TopNOverlap
}

export function summarizeSeasonRanking(rows: readonly MeasuredRow[], byGameweek: ReadonlyMap<number, GameweekRankingSummary>): SeasonRankingSummary {
  const spearman = spearmanCorrelation(rows.map(toRankingPair))
  let overlap10 = 0
  let n10 = 0
  let overlap20 = 0
  let n20 = 0
  for (const summary of byGameweek.values()) {
    if (summary.tooSmallToRead || summary.top10 === null || summary.top20 === null) continue
    overlap10 += summary.top10.overlap
    n10 += summary.top10.n
    overlap20 += summary.top20.overlap
    n20 += summary.top20.n
  }
  return { n: rows.length, spearman, top10: { overlap: overlap10, n: n10 }, top20: { overlap: overlap20, n: n20 } }
}

export interface PositionRankingSummary {
  position: Position
  n: number
  /** Pooled across the whole season for this position — mirrors summarizeByPosition's season-level MAE, not a per-gameweek figure. */
  spearman: number | null
  /**
   * Summed across every gameweek this position appears in — NOT gated by
   * MIN_BUCKET_SAMPLE_SIZE (unlike the by-gameweek table above). A
   * per-gameweek goalkeeper population is often under 50 by construction —
   * roughly one starting keeper per club, ~20 at most — so a 50-row gate
   * would silently zero out goalkeepers' top-N figures entirely rather than
   * reporting an honestly smaller sample size. topNOverlap already caps N at
   * the population size, so a thin gameweek just contributes a smaller N,
   * never a wrong one.
   */
  top10: TopNOverlap
  top20: TopNOverlap
}

export function summarizeRankingByPosition(rows: readonly MeasuredRow[]): Record<Position, PositionRankingSummary> {
  const result = {} as Record<Position, PositionRankingSummary>
  for (const position of POSITIONS) {
    const positionRows = rows.filter((r) => r.position === position)
    const spearman = spearmanCorrelation(positionRows.map(toRankingPair))

    const gameweekIds = [...new Set(positionRows.map((r) => r.gameweekId))]
    let overlap10 = 0
    let n10 = 0
    let overlap20 = 0
    let n20 = 0
    for (const gameweekId of gameweekIds) {
      const pairs = positionRows.filter((r) => r.gameweekId === gameweekId).map(toRankingPair)
      const t10 = topNOverlap(pairs, 10)
      const t20 = topNOverlap(pairs, 20)
      overlap10 += t10.overlap
      n10 += t10.n
      overlap20 += t20.overlap
      n20 += t20.n
    }

    result[position] = {
      position,
      n: positionRows.length,
      spearman,
      top10: { overlap: overlap10, n: n10 },
      top20: { overlap: overlap20, n: n20 },
    }
  }
  return result
}

export interface RankingSanityCheckResult {
  ok: boolean
  failures: string[]
}

/**
 * The report FAILS, naming the figure, rather than printing a number nobody
 * checked (ticket text) — mirrors checkSanityBounds' own shape exactly
 * (overall, then each position). Checked here: the season aggregate and each
 * position's Spearman correlation and top-10 overlap fraction. The upper
 * bound matters more than the lower one: a suspiciously good correlation is
 * the shape a lookahead leak takes.
 */
export function checkRankingSanityBounds(
  seasonSpearman: number | null,
  seasonTop10: TopNOverlap,
  byPosition: Record<Position, PositionRankingSummary>,
): RankingSanityCheckResult {
  const failures: string[] = []

  const checkSpearman = (label: string, value: number | null): void => {
    if (value !== null && (value < SPEARMAN_LOWER_BOUND || value > SPEARMAN_UPPER_BOUND)) {
      failures.push(
        `${label} Spearman rank correlation ${value.toFixed(3)} is outside the sane bound [${SPEARMAN_LOWER_BOUND}, ${SPEARMAN_UPPER_BOUND}]`,
      )
    }
  }
  const checkTop10 = (label: string, top10: TopNOverlap): void => {
    if (top10.n > 0 && top10.overlap / top10.n > TOP10_OVERLAP_UPPER_BOUND_FRACTION) {
      failures.push(
        `${label} top-10 overlap ${top10.overlap} of ${top10.n} (${((top10.overlap / top10.n) * 100).toFixed(1)}%) exceeds the sane bound of 9 of 10 (90%)`,
      )
    }
  }

  checkSpearman('season', seasonSpearman)
  checkTop10('season', seasonTop10)
  for (const position of POSITIONS) {
    checkSpearman(POSITION_NAMES[position], byPosition[position].spearman)
    checkTop10(POSITION_NAMES[position], byPosition[position].top10)
  }

  return { ok: failures.length === 0, failures }
}

// ============================================================================
// Report generation.
// ============================================================================

function fmt(n: number | null, decimals = 3): string {
  return n === null ? 'n/a' : n.toFixed(decimals)
}

interface ReportData {
  generatedAt: Date
  season: string
  measured: MeasuredRow[]
  overall: ErrorSummary
  byPosition: Record<Position, ErrorSummary>
  byGameweek: Map<number, ErrorSummary>
  cleanSheetRateByPosition: Partial<Record<Position, number | null>>
  sanity: SanityCheckResult
  exclusions: ExclusionCounts
  featureHistoryRowsRead: number
  actualRowsMatched: number
  playersRowCount: number
  matchStatsRowCount: number
  /** Ticket #140. */
  multiFixtureByGameweek: Map<number, number>
  multiFixtureDiagnostic: MultiFixtureDiagnostic
  defconBuckets: BucketSummary[]
  overallBuckets: BucketSummary[]
  /** Ticket #147. */
  rankingSeason: SeasonRankingSummary
  rankingByPosition: Record<Position, PositionRankingSummary>
  rankingByGameweek: Map<number, GameweekRankingSummary>
  rankingSanity: RankingSanityCheckResult
}

function buildPositionTable(byPosition: Record<Position, ErrorSummary>, cleanSheetRateByPosition: Partial<Record<Position, number | null>>): string {
  const header = '| Position | n | Mean absolute error | Mean signed error | Derived clean-sheet rate |\n|---|---|---|---|---|'
  const rows = POSITIONS.map((position) => {
    const s = byPosition[position]
    const rate = cleanSheetRateByPosition[position] ?? null
    return `| ${POSITION_NAMES[position]} | ${s.n} | ${fmt(s.meanAbsoluteError)} | ${fmt(s.meanSignedError)} | ${rate === null ? 'n/a' : `${(rate * 100).toFixed(1)}%`} |`
  })
  return [header, ...rows].join('\n')
}

/** The fixture-count column (ticket text) is how many of that gameweek's measured player-gameweeks had more than one fixture — 0 for an ordinary gameweek, >0 flags a candidate double gameweek. */
function buildGameweekTable(byGameweek: Map<number, ErrorSummary>, multiFixtureByGameweek: Map<number, number>): string {
  const header = '| Gameweek | n | Mean absolute error | Mean signed error | Multi-fixture rows |\n|---|---|---|---|---|'
  const rows = [...byGameweek.entries()].map(
    ([gw, s]) => `| ${gw} | ${s.n} | ${fmt(s.meanAbsoluteError)} | ${fmt(s.meanSignedError)} | ${multiFixtureByGameweek.get(gw) ?? 0} |`,
  )
  return [header, ...rows].join('\n')
}

function buildBucketTable(buckets: readonly BucketSummary[]): string {
  const header = '| prior_matches | n | Mean signed error |\n|---|---|---|'
  const rows = buckets.map((b) => `| ${b.label} | ${b.n} | ${b.tooSmallToRead ? 'too small to read' : fmt(b.meanSignedError)} |`)
  return [header, ...rows].join('\n')
}

// Ticket #147 — ranking-skill formatting.

function fmtSpearman(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(3)
}

function fmtTopN(topN: TopNOverlap | null): string {
  if (topN === null || topN.n === 0) return 'n/a'
  return `${topN.overlap} of ${topN.n} (${((topN.overlap / topN.n) * 100).toFixed(1)}%)`
}

function buildRankingPositionTable(byPosition: Record<Position, PositionRankingSummary>): string {
  const header = '| Position | n | Spearman | Top-10 overlap | Top-20 overlap |\n|---|---|---|---|---|'
  const rows = POSITIONS.map((position) => {
    const s = byPosition[position]
    return `| ${POSITION_NAMES[position]} | ${s.n} | ${fmtSpearman(s.spearman)} | ${fmtTopN(s.top10)} | ${fmtTopN(s.top20)} |`
  })
  return [header, ...rows].join('\n')
}

function buildRankingGameweekTable(byGameweek: Map<number, GameweekRankingSummary>): string {
  const header = '| Gameweek | n | Spearman | Top-10 overlap | Top-20 overlap |\n|---|---|---|---|---|'
  const rows = [...byGameweek.entries()].map(([gameweekId, s]) =>
    s.tooSmallToRead
      ? `| ${gameweekId} | ${s.n} | too small to read | too small to read | too small to read |`
      : `| ${gameweekId} | ${s.n} | ${fmtSpearman(s.spearman)} | ${fmtTopN(s.top10)} | ${fmtTopN(s.top20)} |`,
  )
  return [header, ...rows].join('\n')
}

function componentMean(rows: readonly MeasuredRow[], pick: (c: ComponentTotals) => number, source: 'projected' | 'actual'): number | null {
  if (rows.length === 0) return null
  const total = rows.reduce((sum, r) => sum + pick(source === 'projected' ? r.projectedComponents : r.actualComponents), 0)
  return total / rows.length
}

function buildComponentTable(rows: readonly MeasuredRow[]): string {
  const labels: Array<[keyof ComponentTotals, string]> = [
    ['appearancePoints', 'Appearance'],
    ['goalPoints', 'Goals'],
    ['assistPoints', 'Assists'],
    ['cleanSheetPoints', 'Clean sheets'],
    ['goalsConcededPoints', 'Goals conceded'],
    ['savePoints', 'Saves'],
    ['defensiveContributionPoints', 'Defensive contribution'],
  ]
  const header = '| Component | Mean actual | Mean projected | Mean signed error |\n|---|---|---|---|'
  const body = labels
    .map(([key, label]) => {
      const actual = componentMean(rows, (c) => c[key], 'actual')
      const projected = componentMean(rows, (c) => c[key], 'projected')
      const signed = actual === null || projected === null ? null : projected - actual
      return `| ${label} | ${fmt(actual)} | ${fmt(projected)} | ${fmt(signed)} |`
    })
    .join('\n')
  return [header, body].join('\n')
}

function generateReportMarkdown(data: ReportData): string {
  const sections: string[] = []

  sections.push(
    '# Backtest report — point-in-time projection vs actual\n\n' +
      `Generated: ${data.generatedAt.toISOString()} · Job: \`${JOB_NAME}\` · Season: \`${data.season}\`\n\n` +
      'Measures the projection only — no transfers, captaincy, solver, or league position (item 32\'s remaining ' +
      'work). Every projected figure below is built strictly from `feature_history` prior-gameweek totals — no ' +
      'later gameweek, no live current-season data. See `scripts/run-backtest.ts`\'s file header for the full ' +
      'method and its documented approximations, and `docs/projection-model-backlog.md` for what this slice does ' +
      'and does not settle.',
  )

  sections.push(
    (data.sanity.ok ? '## Sanity check: PASSED\n\n' : '## Sanity check: FAILED\n\n') +
      (data.sanity.ok
        ? 'Overall mean absolute error and every position\'s derived clean-sheet rate are within their sane bounds.'
        : `**${data.sanity.failures.length} bound(s) failed — this means the HARNESS is wrong, not necessarily the model:**\n\n` +
          data.sanity.failures.map((f) => `- ${f}`).join('\n')),
  )

  sections.push(
    '## Headline\n\n' +
      `Measured population: **${data.overall.n}** player-gameweek row(s). Mean absolute error: **${fmt(data.overall.meanAbsoluteError)}**. ` +
      `Mean signed error: **${fmt(data.overall.meanSignedError)}** — ${describeSignedError(data.overall.meanSignedError)}.`,
  )

  sections.push(
    '## The measured population, and what is excluded\n\n' +
      `- \`feature_history\` rows read (season=${data.season}): ${data.featureHistoryRowsRead}\n` +
      `- rows with a matching \`player_match_stats\` actual gameweek entry found: ${data.actualRowsMatched}\n` +
      `- **rows measured (headline population)**: ${data.measured.length}\n` +
      `- excluded — no prior matches (\`prior_matches = 0\`, no point-in-time signal): ${data.exclusions.noPriorMatches}\n` +
      `- excluded — player did not feature this gameweek (a correct zero that would flatter the error): ${data.exclusions.didNotFeature}\n` +
      `- excluded — blank gameweek (player's team had no fixture at all, ticket #140): ${data.exclusions.blankGameweek}\n` +
      `- excluded — actual data incomplete (\`team_goals_conceded\` null, ~2% known gap, ticket #125): ${data.exclusions.actualDataIncomplete}\n` +
      `- excluded — unresolved \`player_code\` (no matching \`players\` row): ${data.exclusions.unresolvedPlayerCode} ` +
      `(${formatExclusionPercentage(data.exclusions.unresolvedPlayerCode, data.featureHistoryRowsRead)} of rows read)\n\n` +
      `Reconciliation: ${data.measured.length} measured + ${totalExcluded(data.exclusions)} excluded = ` +
      `${data.measured.length + totalExcluded(data.exclusions)}, against ${data.featureHistoryRowsRead} rows read.`,
  )

  sections.push('## By position\n\n' + buildPositionTable(data.byPosition, data.cleanSheetRateByPosition))

  sections.push(
    '## By gameweek\n\n' +
      'A bad week is visible here rather than averaged away into the season figure above. "Multi-fixture rows" is ' +
      'how many of that gameweek\'s measured player-gameweeks had more than one fixture (ticket #140) — a nonzero ' +
      'value flags a candidate double gameweek.\n\n' +
      buildGameweekTable(data.byGameweek, data.multiFixtureByGameweek),
  )

  sections.push(
    '## Multi-fixture gameweeks (ticket #140)\n\n' +
      `Player-gameweeks with more than one fixture: **${data.multiFixtureDiagnostic.multiFixtureCount}** of ${data.measured.length} measured.\n\n` +
      `- Season headline WITH multi-fixture rows (the figure above): n=${data.multiFixtureDiagnostic.withMultiFixture.n}, ` +
      `MAE=${fmt(data.multiFixtureDiagnostic.withMultiFixture.meanAbsoluteError)}, ` +
      `mean signed error=${fmt(data.multiFixtureDiagnostic.withMultiFixture.meanSignedError)}\n` +
      `- Season headline WITHOUT multi-fixture rows: n=${data.multiFixtureDiagnostic.withoutMultiFixture.n}, ` +
      `MAE=${fmt(data.multiFixtureDiagnostic.withoutMultiFixture.meanAbsoluteError)}, ` +
      `mean signed error=${fmt(data.multiFixtureDiagnostic.withoutMultiFixture.meanSignedError)}\n\n` +
      (data.multiFixtureDiagnostic.movesHeadlineSignificantly
        ? `**Excluding multi-fixture player-gameweeks moves the season MAE by ${fmt(data.multiFixtureDiagnostic.maeDelta)} — ` +
          `more than the ${MULTI_FIXTURE_HEADLINE_THRESHOLD} threshold. This is worth reading before trusting the headline as-is.**`
        : `Excluding multi-fixture player-gameweeks moves the season MAE by ${fmt(data.multiFixtureDiagnostic.maeDelta)} — ` +
          `within the ${MULTI_FIXTURE_HEADLINE_THRESHOLD} threshold, not a material driver of the headline on its own.`),
  )

  sections.push(
    '## Defensive-contribution signed error, by prior_matches bucket (ticket #140)\n\n' +
      'Full-season calibration can look correct while point-in-time estimation shrinks hard toward the position ' +
      'prior early in a player\'s history — this table is what tells a cold-start problem (shrinks toward 0 as the ' +
      'bucket rises) apart from a level problem (stays flat). A bucket under ' +
      `${MIN_BUCKET_SAMPLE_SIZE} measured rows is reported as "too small to read", never as a number nobody checked.\n\n` +
      buildBucketTable(data.defconBuckets),
  )

  sections.push(
    '## Overall signed error, by prior_matches bucket (ticket #140)\n\n' +
      'The same bucketing applied to the overall signed error, for comparison against the defcon-only breakdown ' +
      'above.\n\n' +
      buildBucketTable(data.overallBuckets),
  )

  sections.push(
    '## By component\n\n' +
      'Mean actual vs mean projected per component, across the measured population — attributes a gap in the ' +
      'headline to a specific term rather than leaving it only visible in aggregate. Bonus is absent from both ' +
      'sides (see file header) rather than shown as an always-zero row.\n\n' +
      buildComponentTable(data.measured),
  )

  sections.push(
    '## Ranking skill (ticket #147)\n\n' +
      'The metrics above measure how close the model\'s numbers are; this measures whether it puts ' +
      'the right players at the top — the only thing a recommendation actually depends on (the ' +
      'captain IS the squad\'s top-projected player; a transfer IS a claim one player will outscore ' +
      'another). Same measured population as above, no new Supabase read. **Spearman rank ' +
      'correlation** ranks projected and actual points among the same set of rows (tied values share ' +
      'the average rank they would occupy) and reports how well the two orderings agree — 1 is ' +
      'perfect agreement, −1 is perfect reversal, 0 is no relationship. **Top-N overlap** is closer to ' +
      'what the app actually does: of the players ranked in the model\'s top 10 (or top 20) that ' +
      'gameweek, how many were also in the actual top 10 (or top 20). See ' +
      '`docs/projection-model-backlog.md` for what this section does and does not settle — no ' +
      'conclusion about whether the ranking is good is drawn here.',
  )

  sections.push(
    (data.rankingSanity.ok ? '### Ranking sanity check: PASSED\n\n' : '### Ranking sanity check: FAILED\n\n') +
      (data.rankingSanity.ok
        ? 'The season aggregate and every position\'s Spearman correlation and top-10 overlap are within their sane bounds.'
        : `**${data.rankingSanity.failures.length} bound(s) failed — this means the HARNESS is wrong, not necessarily the model ` +
          `(a suspiciously good correlation is the shape a lookahead leak takes):**\n\n` +
          data.rankingSanity.failures.map((f) => `- ${f}`).join('\n')),
  )

  sections.push(
    '### Season aggregate\n\n' +
      `- Spearman rank correlation: **${fmtSpearman(data.rankingSeason.spearman)}** (n=${data.rankingSeason.n})\n` +
      `- Top-10 overlap: **${fmtTopN(data.rankingSeason.top10)}**\n` +
      `- Top-20 overlap: **${fmtTopN(data.rankingSeason.top20)}**\n\n` +
      'Top-10/20 figures are summed across every gameweek with at least ' +
      `${MIN_BUCKET_SAMPLE_SIZE} measured rows (the same threshold the by-gameweek table below applies) — ` +
      'a season-wide overlap RATE, not a single top-10 selected from the whole season pooled together.',
  )

  sections.push(
    '### By position\n\n' +
      'A captain is chosen across positions, but a transfer is usually within one — Spearman is ' +
      'pooled across the whole season for that position (like the by-position table above); top-N ' +
      'overlap is summed across every gameweek that position appears in, uncapped by the 50-row ' +
      'gameweek gate (a per-gameweek goalkeeper population is often under 50 by construction).\n\n' +
      buildRankingPositionTable(data.rankingByPosition),
  )

  sections.push(
    '### By gameweek\n\n' +
      `A gameweek with fewer than ${MIN_BUCKET_SAMPLE_SIZE} measured rows is reported "too small to ` +
      'read" rather than as a correlation nobody could trust.\n\n' +
      buildRankingGameweekTable(data.rankingByGameweek),
  )

  sections.push(
    '## Provenance\n\n' +
      `- players rows fetched: ${data.playersRowCount}\n` +
      `- feature_history rows fetched (season=${data.season}): ${data.featureHistoryRowsRead}\n` +
      `- player_match_stats rows fetched (season=${data.season}, competition=${PREMIER_LEAGUE_COMPETITION}): ${data.matchStatsRowCount}\n` +
      `- sanity bounds: mean absolute error in [${MAE_LOWER_BOUND}, ${MAE_UPPER_BOUND}]; derived clean-sheet rate ≤ ${(CLEAN_SHEET_RATE_UPPER_BOUND * 100).toFixed(0)}% per position\n` +
      `- ranking sanity bounds (#147): Spearman rank correlation in [${SPEARMAN_LOWER_BOUND}, ${SPEARMAN_UPPER_BOUND}]; top-10 overlap ≤ ${(TOP10_OVERLAP_UPPER_BOUND_FRACTION * 100).toFixed(0)}%\n`,
  )

  return sections.join('\n\n') + '\n'
}

// ============================================================================
// Main
// ============================================================================

interface PlayerRow {
  code: number | null
  element_type: number
}

interface ActualSourceRow {
  player_code: number | null
  /** Ticket #140 — read only for team-slug inference (blank-gameweek detection); never used for point reconstruction. See file header, "BLANK GAMEWEEKS". */
  match_id: string
  gameweek: number
  minutes_played: number | null
  goals: number | null
  assists: number | null
  team_goals_conceded: number | null
  saves: number | null
  clearances: number | null
  blocks: number | null
  interceptions: number | null
  tackles: number | null
  recoveries: number | null
}

function toActualMatchStatsInput(row: ActualSourceRow): ActualMatchStatsInput {
  return {
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
  }
}

async function main(): Promise<void> {
  const startedAt = new Date()
  const env = readSupabaseEnv()
  if (!env) {
    process.exit(1)
    return
  }
  const season = readSeason()
  const reportPath = readReportPath()
  const supabase = createClient(env.url, env.secretKey)

  try {
    // --------------------------------------------------------------------
    // 1. players — resolves position for both sides' joins, via .code only.
    // --------------------------------------------------------------------
    const {
      rows: playerRows,
      error: playersError,
      pages: playersPagesFetched,
    } = await fetchAllPages<PlayerRow>((from, to) =>
      supabase.from('players').select('code, element_type').range(from, to).returns<PlayerRow[]>(),
    )
    if (playersError) {
      throw new BacktestError(`players lookup failed: ${playersError.message}`, 'players')
    }
    const { count: playersExpectedCount, error: playersCountError } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true })
    if (playersCountError) {
      throw new BacktestError(`players count check failed: ${playersCountError.message}`, 'players')
    }
    assertRowCountMatches('players', playerRows.length, playersExpectedCount ?? 0)

    const codeToPosition = new Map<number, Position>()
    for (const player of playerRows) {
      if (player.code !== null) codeToPosition.set(player.code, player.element_type as Position)
    }

    // --------------------------------------------------------------------
    // 2. feature_history — 18,243+ rows for one season. Paginated,
    //    count-verified against the identical season filter.
    // --------------------------------------------------------------------
    const {
      rows: featureHistoryRows,
      error: featureHistoryError,
      pages: featureHistoryPagesFetched,
    } = await fetchAllPages<FeatureHistoryRow>((from, to) =>
      supabase
        .from('feature_history')
        .select(
          'gameweek_id, player_code, prior_matches, prior_minutes, prior_xg, prior_xa, prior_saves, prior_clearances, prior_blocks, prior_interceptions, prior_tackles, prior_recoveries',
        )
        .eq('season', season)
        .range(from, to)
        .returns<FeatureHistoryRow[]>(),
    )
    if (featureHistoryError) {
      if (isMissingTable(featureHistoryError, 'feature_history')) {
        throw new BacktestError(`the "feature_history" table does not exist. Apply ${FEATURE_HISTORY_MIGRATION} first.`, 'feature_history')
      }
      throw new BacktestError(`feature_history lookup failed: ${featureHistoryError.message}`, 'feature_history')
    }
    const { count: featureHistoryExpectedCount, error: featureHistoryCountError } = await supabase
      .from('feature_history')
      .select('*', { count: 'exact', head: true })
      .eq('season', season)
    if (featureHistoryCountError) {
      throw new BacktestError(`feature_history count check failed: ${featureHistoryCountError.message}`, 'feature_history')
    }
    assertRowCountMatches(`feature_history (season=${season})`, featureHistoryRows.length, featureHistoryExpectedCount ?? 0)

    if (featureHistoryRows.length === 0) {
      const message =
        `${JOB_NAME}: feature_history is empty for season=${season}. Nothing to backtest — writing no report. ` +
        'Run scripts/build-feature-history.ts for this season first.'
      console.log(message)
      await recordJobRun(supabase, { status: 'skipped', message, details: { season }, startedAt })
      process.exit(0)
      return
    }

    // --------------------------------------------------------------------
    // 3. player_match_stats — actuals only, filtered to season + Premier
    //    League (ticket #54). 15,000+ rows. Paginated, count-verified
    //    against the identical filter on both queries.
    // --------------------------------------------------------------------
    const {
      rows: matchStatsRows,
      error: matchStatsError,
      pages: matchStatsPagesFetched,
    } = await fetchAllPages<ActualSourceRow>((from, to) =>
      supabase
        .from('player_match_stats')
        .select(
          'player_code, match_id, gameweek, minutes_played, goals, assists, team_goals_conceded, saves, clearances, blocks, interceptions, tackles, recoveries',
        )
        .eq('season', season)
        .eq('competition', PREMIER_LEAGUE_COMPETITION)
        .range(from, to)
        .returns<ActualSourceRow[]>(),
    )
    if (matchStatsError) {
      if (isMissingTable(matchStatsError, 'player_match_stats')) {
        throw new BacktestError(`the "player_match_stats" table does not exist. Apply ${PLAYER_MATCH_STATS_MIGRATION} first.`, 'player_match_stats')
      }
      if (isMissingColumn(matchStatsError, 'team_goals_conceded')) {
        throw new BacktestError(
          `player_match_stats.team_goals_conceded does not exist in this database yet. Apply ${TEAM_GOALS_CONCEDED_MIGRATION} first.`,
          'player_match_stats',
        )
      }
      throw new BacktestError(`player_match_stats lookup failed: ${matchStatsError.message}`, 'player_match_stats')
    }
    const { count: matchStatsExpectedCount, error: matchStatsCountError } = await supabase
      .from('player_match_stats')
      .select('*', { count: 'exact', head: true })
      .eq('season', season)
      .eq('competition', PREMIER_LEAGUE_COMPETITION)
    if (matchStatsCountError) {
      throw new BacktestError(`player_match_stats count check failed: ${matchStatsCountError.message}`, 'player_match_stats')
    }
    assertRowCountMatches(`player_match_stats (season=${season}, competition=${PREMIER_LEAGUE_COMPETITION})`, matchStatsRows.length, matchStatsExpectedCount ?? 0)

    // --------------------------------------------------------------------
    // 4. Index actuals by (player_code, gameweek).
    // --------------------------------------------------------------------
    const actualByPlayerGameweek = new Map<string, ActualSourceRow[]>()
    const matchIdsByPlayerCode = new Map<number, string[]>()
    for (const row of matchStatsRows) {
      if (row.player_code === null) continue
      const key = `${row.player_code}:${row.gameweek}`
      const list = actualByPlayerGameweek.get(key) ?? []
      list.push(row)
      actualByPlayerGameweek.set(key, list)

      const matchIds = matchIdsByPlayerCode.get(row.player_code) ?? []
      matchIds.push(row.match_id)
      matchIdsByPlayerCode.set(row.player_code, matchIds)
    }

    // --------------------------------------------------------------------
    // 4b. Team-slug inference for blank-gameweek detection (ticket #140) —
    //     see file header, "BLANK GAMEWEEKS". Built once from the SAME
    //     matchStatsRows already fetched above; no extra Supabase call.
    // --------------------------------------------------------------------
    const teamSlugByPlayerCode = new Map<number, string>()
    for (const [playerCode, matchIds] of matchIdsByPlayerCode) {
      const slug = inferTeamSlug(matchIds)
      if (slug !== null) teamSlugByPlayerCode.set(playerCode, slug)
    }
    const teamSlugsByGameweek = buildTeamSlugsByGameweek(matchStatsRows.map((r) => ({ gameweek: r.gameweek, matchId: r.match_id })))

    // --------------------------------------------------------------------
    // 5. Position priors, one per (gameweek, position) — see
    //    computePositionPriors' own comment for why this carries no
    //    lookahead.
    // --------------------------------------------------------------------
    const positionPriors = computePositionPriors(featureHistoryRows, (code) => codeToPosition.get(code))

    // --------------------------------------------------------------------
    // 6. Classify every row, project + reconstruct the measured population.
    // --------------------------------------------------------------------
    const exclusions = emptyExclusionCounts()
    const measured: MeasuredRow[] = []
    let actualRowsMatched = 0

    for (const row of featureHistoryRows) {
      const position = codeToPosition.get(row.player_code)
      const actualRowsRaw = actualByPlayerGameweek.get(`${row.player_code}:${row.gameweek_id}`) ?? []
      if (actualRowsRaw.length > 0) actualRowsMatched++

      const teamSlug = teamSlugByPlayerCode.get(row.player_code) ?? null
      // Fail open to today's didNotFeature behaviour when the team cannot be
      // resolved — see inferTeamSlug's own comment on the single-match tie.
      const hadFixture = teamSlug === null ? true : (teamSlugsByGameweek.get(row.gameweek_id)?.has(teamSlug) ?? false)

      const classification = classifyRow(row, position, actualRowsRaw.map(toActualMatchStatsInput), hadFixture)
      if (classification.kind === 'excluded') {
        incrementExclusion(exclusions, classification.reason)
        continue
      }

      // Ticket #140: project as many neutral fixtures as the actual side
      // found rows for (classification.outcome.matchesFound) — the same
      // count aggregateActualForGameweek summed on the actual side.
      const prior = positionPriors.get(positionPriorKey(row.gameweek_id, classification.position)) ?? fallbackPositionPrior(classification.position)
      const projection = projectRow(row, classification.position, prior, classification.outcome.matchesFound)
      const projectedComponents = sumComponentTotals(projection.fixtures.map((f) => pickProjectedComponents(f.components)))

      measured.push(
        buildMeasuredRow(row.gameweek_id, classification.position, projection.expectedPoints, projectedComponents, classification.outcome, row.prior_matches),
      )
    }

    assertReconciles(featureHistoryRows.length, measured.length, exclusions)

    // --------------------------------------------------------------------
    // 7. Aggregate, sanity-check, report.
    // --------------------------------------------------------------------
    const overall = summarizeErrors(measured)
    const byPosition = summarizeByPosition(measured)
    const byGameweek = summarizeByGameweek(measured)
    const cleanSheetRateByPosition: Partial<Record<Position, number | null>> = {}
    for (const position of POSITIONS) cleanSheetRateByPosition[position] = derivedCleanSheetRate(measured, position)
    const sanity = checkSanityBounds(overall.meanAbsoluteError, cleanSheetRateByPosition)
    const multiFixtureByGameweek = countMultiFixtureRowsByGameweek(measured)
    const multiFixtureDiagnostic = buildMultiFixtureDiagnostic(measured)
    const defconBuckets = bucketByPriorMatches(measured, defconSignedError)
    const overallBuckets = bucketByPriorMatches(measured, (r) => r.signedError)

    // Ticket #147 — ranking skill. Computed entirely from `measured`, the
    // same population above; no new Supabase read.
    const rankingByGameweek = summarizeRankingByGameweek(measured)
    const rankingSeason = summarizeSeasonRanking(measured, rankingByGameweek)
    const rankingByPosition = summarizeRankingByPosition(measured)
    const rankingSanity = checkRankingSanityBounds(rankingSeason.spearman, rankingSeason.top10, rankingByPosition)

    const reportData: ReportData = {
      generatedAt: new Date(),
      season,
      measured,
      overall,
      byPosition,
      byGameweek,
      cleanSheetRateByPosition,
      sanity,
      exclusions,
      featureHistoryRowsRead: featureHistoryRows.length,
      actualRowsMatched,
      playersRowCount: playerRows.length,
      matchStatsRowCount: matchStatsRows.length,
      multiFixtureByGameweek,
      multiFixtureDiagnostic,
      defconBuckets,
      overallBuckets,
      rankingSeason,
      rankingByPosition,
      rankingByGameweek,
      rankingSanity,
    }
    const reportMarkdown = generateReportMarkdown(reportData)
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, reportMarkdown, 'utf8')

    const details: JsonRecord = {
      season,
      featureHistoryRowsRead: featureHistoryRows.length,
      featureHistoryPagesFetched,
      playersRowsFetched: playerRows.length,
      playersPagesFetched,
      matchStatsRowsFetched: matchStatsRows.length,
      matchStatsPagesFetched,
      actualRowsMatched,
      rowsMeasured: measured.length,
      exclusions,
      overallMeanAbsoluteError: overall.meanAbsoluteError,
      overallMeanSignedError: overall.meanSignedError,
      byPosition: Object.fromEntries(POSITIONS.map((p) => [POSITION_NAMES[p], byPosition[p]])),
      cleanSheetRateByPosition: Object.fromEntries(POSITIONS.map((p) => [POSITION_NAMES[p], cleanSheetRateByPosition[p]])),
      sanity,
      multiFixtureDiagnostic,
      defconBuckets,
      overallBuckets,
      rankingSeason,
      rankingByPosition: Object.fromEntries(POSITIONS.map((p) => [POSITION_NAMES[p], rankingByPosition[p]])),
      rankingSanity,
      reportPath,
    }

    // Ticket #147: the ranking-skill bounds fail the job exactly like the
    // existing sanity bounds above — added to the existing check, neither
    // bound's own logic touched.
    if (!sanity.ok || !rankingSanity.ok) {
      const combinedFailures = [...sanity.failures, ...rankingSanity.failures]
      const message = `${JOB_NAME}: sanity bounds FAILED for season=${season}: ${combinedFailures.join('; ')}. Report written to ${reportPath} for diagnosis.`
      console.error(message)
      await recordJobRun(supabase, { status: 'failure', message, details, startedAt })
      process.exit(1)
      return
    }

    const message =
      `${JOB_NAME}: season ${season} — ${measured.length} player-gameweek row(s) measured ` +
      `(of ${featureHistoryRows.length} feature_history row(s) read). Mean absolute error ${fmt(overall.meanAbsoluteError)}, ` +
      `mean signed error ${fmt(overall.meanSignedError)} — ${describeSignedError(overall.meanSignedError)}. ` +
      `Ranking skill: Spearman ${fmtSpearman(rankingSeason.spearman)}, top-10 overlap ${fmtTopN(rankingSeason.top10)}. ` +
      `Report written to ${reportPath}.`
    console.log(message)
    await recordJobRun(supabase, { status: 'success', message, details, startedAt })
  } catch (err) {
    const message =
      err instanceof BacktestError || err instanceof BacktestSanityError
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
