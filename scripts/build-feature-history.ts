// Point-in-time feature history builder — ticket #121 (feature-list item 29,
// first slice).
//
// WHAT THIS BUILDS AND WHY. To ask "would this model have recommended well
// in a past gameweek?", a backtest needs to know what could have been known
// BEFORE that gameweek's deadline — not what is known now. Reading
// player_match_stats directly for a past gameweek is contaminated by every
// later match in the same season (lookahead): any rate computed that way
// reports a model better than it actually would have been. This job writes,
// for every player and every gameweek he has a Premier League match in an
// ingested season, the CUMULATIVE TOTALS of that player's Premier League
// matches STRICTLY BEFORE that gameweek — nothing from the gameweek itself,
// nothing later. See supabase/migrations/20260827090000_feature_history.sql
// for the table this writes to.
//
// RAW TOTALS, NEVER RATES (Tier 2, logged HIGH-IMPACT). The rate model has
// changed three times this month (#78 added CBI/recoveries, #113 made it
// two-stage, another ticket may be touching the position prior in this same
// batch) — storing a rate would freeze one version of a moving model into a
// table meant to outlive all of them. A raw prior-match total is a fact
// about football that never changes; any rate model, past or future, can be
// applied to it afterwards.
//
// POSITION + DEFCON COUNTERS (ticket #146). Two more columns, same "raw
// facts, never a moving model's output" reasoning as above:
//
//   - element_type: the FPL position code (1/2/3/4) as it was in the
//     ingested season, copied from player_match_stats.element_type (itself
//     populated by scripts/ingest-core-insights.ts from that season's own
//     players.csv — ticket #146's companion change) — NEVER from the live
//     public.players table, which holds only the current season's players
//     and has no row at all for anyone who has since left the league. This
//     is the same cross-season identity problem player_code already solves
//     one level up (deltas.md D9); see the migration file's header.
//   - prior_defcon_qualifying_matches / prior_defcon_hits: raw per-match
//     COUNTS (matches with 60+ minutes; of those, matches that reached the
//     player's position threshold), strictly before the row's gameweek —
//     never a stored rate. A hit rate cannot be recovered from
//     prior_clearances/prior_blocks/prior_interceptions/prior_tackles/
//     prior_recoveries: those are cumulative totals, and a player with 30
//     clearances over 10 matches might have hit the threshold three times or
//     never — the totals alone cannot say which. These two counts are
//     computed match by match, using isQualifyingMatch (imported from
//     src/lib/projection/defconRate.ts) for the 60-minute qualifying rule and
//     defensiveContributionPoints (imported from
//     src/lib/scoring/defensiveContribution.ts) for the position threshold
//     itself — NEITHER threshold value (60 minutes; 10 CBIT; 12 CBIRT) is
//     reimplemented here. This is the one deliberate, narrow exception to the
//     "nothing under src/lib/projection/ is imported" line ticket #121 wrote
//     above: only the pure per-match qualifying/threshold determination is
//     used, never any shrinkage or rate-estimation function from that
//     module, and never any hit-rate constant — the model itself is
//     untouched by this ticket (see its own scope).
//
// KEYED ON player_code, NEVER the FPL element id. 453 of 458 players changed
// element id between the 2025-2026 and 2026-2027 seasons (see the #12/#22
// migrations' header comments and scripts/project-points.ts's "THE JOIN") —
// a table meant to be read across season boundaries must not key on an
// identifier that does not survive one. A player_match_stats row whose
// per-player code is null (a small, expected gap — see
// scripts/ingest-core-insights.ts's header) cannot be attributed to anyone
// and is excluded from every total, counted under rowsExcludedFromTotals
// below.
//
// PREMIER LEAGUE ONLY (ticket #54). About 18% of player_match_stats rows are
// cup or European fixtures — they score no FPL points and carry a 34%
// higher xG per 90 than league form. Every total here counts only rows
// whose competition = PREMIER_LEAGUE_COMPETITION; every other row (a known
// non-Premier-League competition, or a not-yet-stamped null) is excluded
// from every total and counted, never assumed Premier League.
//
// TEAM_GOALS_CONCEDED — SCHEMA GAP CLOSED BY TICKET #125. Ticket #121's brief
// specified reading player_match_stats.team_goals_conceded — the pre-existing
// per-player conceded-goals column is a goalkeeper-only stat, ~1% populated
// for outfield rows, and using it would reproduce the #54 bias this repo
// already fixed once for clean sheets — but at that time no migration in
// this repository actually added the team_goals_conceded column, and
// scripts/ingest-core-insights.ts did not populate it — supabase/README.md's
// row for the #54 migration
// (20260818100000_player_match_stats_competition.sql) wrongly described it
// as already added; the migration file itself never did. Ticket #125 fixed
// both: supabase/migrations/20260828090000_player_match_stats_team_goals_conceded.sql
// adds the column (nullable, no default) and scripts/ingest-core-insights.ts
// now writes it on every row. This job's read below was already written to
// the correct spec — selecting team_goals_conceded, never the goalkeeper-only
// per-player column — and needed no change; the isMissingColumn guard stays
// as defence for a live database the #125 migration has not yet been
// applied to, which fails LOUDLY with a message naming the gap, rather than
// silently defaulting the totals to zero.
//
// DENSE ROWS (ticket #125). Ticket #121 emitted a row only for a
// (player, gameweek) pair where that player had a contributing match that
// gameweek — sparse output that pushed "what was the state as of a
// gameweek this player didn't play" onto every consumer. This job now
// emits one row per (player, gameweek) for EVERY gameweek from that
// player's first contributing match through the last gameweek present
// anywhere in the season's data (every row read for the season, contributing
// or not — see lastGameweekInData below), whether or not the player had a
// contributing match that gameweek. A gameweek with no contributing match
// carries the running totals unchanged from the gameweek before it — see
// buildFeatureHistory's own comment for how the loop guarantees this and
// still guarantees the strictly-before rule at every row, dense or not.
//
// Reads exactly two environment variables — SUPABASE_URL and
// SUPABASE_SECRET_KEY — same convention as every other scripts/*.ts job.
//
// SEASON IS A PARAMETER (FEATURE_HISTORY_SEASON), same convention as
// scripts/ingest-core-insights.ts's CORE_INSIGHTS_SEASON: trimmed, falls
// back to a documented default when unset or blank.
//
// Upsert only, never delete: this file issues no Supabase row-removal call
// anywhere. Every Supabase read pages through scripts/lib/paginate.ts and
// verifies its count against an independent count-only query — the same
// db-max-rows ceiling ticket #43 found already bit this app once.
//
// PRIOR_RECENT_MINUTES — THE TRUE LAST-FIVE-MATCH WINDOW (ticket #181).
// scripts/run-backtest.ts's buildRecentMinutes has been grading the model on
// a blurred version of its own inputs: an array of exactly one synthetic
// match, the player's average minutes across all prior matches. The live
// model instead calls estimateMinutes() (src/lib/projection/minutes.ts)
// with the player's last RECENT_MATCH_COUNT (5) actual match rows. This job
// now stores that same true window on feature_history — prior_recent_minutes,
// an integer[] — so a follow-up ticket can make the backtest read it
// instead of reconstructing an average. Built from the IDENTICAL
// contributing-row set and strictly-before cut-off the cumulative prior_*
// totals already use (see buildFeatureHistory below): never a
// separately-derived query that could admit a lookahead. Most-recent-first,
// capped at RECENT_MATCH_COUNT — imported from src/lib/projection/minutes.ts,
// never a locally reimplemented "5". NOT filtered by any minutes-played
// threshold (cameos count), matching estimateMinutes()'s own window — this
// is a different "qualifying" than isQualifyingMatch()'s 60-minute rule
// used two paragraphs up for the unrelated defcon counters. This ticket
// changes no other file: scripts/run-backtest.ts, scripts/project-points.ts
// and every other prior_* column are all untouched, and no backtest number
// moves when this merges.
//
// NOT WIRED INTO ANY WORKFLOW. Run by hand for now — see the ticket's scope.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'
import { PREMIER_LEAGUE_COMPETITION } from './lib/competition.ts'
import type { Position } from '../src/lib/scoring/types.ts'
import { defensiveContributionPoints } from '../src/lib/scoring/defensiveContribution.ts'
import { isQualifyingMatch } from '../src/lib/projection/defconRate.ts'
import { RECENT_MATCH_COUNT } from '../src/lib/projection/minutes.ts'

const JOB_NAME = 'build-feature-history'
const PLAYER_MATCH_STATS_MIGRATION = 'supabase/migrations/20260811170000_player_match_stats.sql'
const FEATURE_HISTORY_MIGRATION = 'supabase/migrations/20260827090000_feature_history.sql'
const POSITION_AND_DEFCON_MIGRATION = 'supabase/migrations/20260829090000_feature_history_position_and_defcon.sql'
const TEAM_AND_OPPONENT_MIGRATION = 'supabase/migrations/20260831090000_team_and_opponent.sql'
const RECENT_MINUTES_MIGRATION = 'supabase/migrations/20260902090000_feature_history_recent_minutes.sql'

/** The four FPL position codes this job ever sees on a resolved element_type — see src/lib/scoring/types.ts. Guards the cast into `Position` below without reimplementing what a valid code is. */
function isPosition(value: number): value is Position {
  return value === 1 || value === 2 || value === 3 || value === 4
}

/**
 * The season this job builds feature history for, read the same way
 * scripts/ingest-core-insights.ts reads CORE_INSIGHTS_SEASON: trimmed env
 * var, falling back to this documented default when unset or blank. Kept as
 * its own variable name (not CORE_INSIGHTS_SEASON itself) because this job
 * can be pointed at a different season than the ingest job's own default
 * without the two fighting over one env var.
 */
export const DEFAULT_SEASON = '2025-2026'

/** Rows written per upsert call — keeps the payload well under any PostgREST/Supabase request-size limit. */
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

class FeatureHistoryError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'FeatureHistoryError'
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

// See this file's header ("TEAM_GOALS_CONCEDED — A SCHEMA GAP FLAGGED, NOT
// WORKED AROUND"): 42703 is Postgres's own undefined_column code; PostgREST
// surfaces the same fact as a message naming the column. Checked BEFORE
// isMissingTable is asked about the column name below, since a missing
// column and a missing table look similar in prose but need different fixes.
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
// build-feature-history.test.ts.
// ============================================================================

/** The columns this job reads off player_match_stats — everything it sums, plus (ticket #146) element_type, which it copies rather than sums. */
export interface SourceMatchRow {
  player_code: number | null
  // Ticket #146. NOT summed like the fields below — copied as-is onto the
  // player's own dense rows (see resolveElementType). NULL is a real, expected
  // value (see player_match_stats.element_type's own COMMENT ON COLUMN).
  element_type: number | null
  // Ticket #167. Same treatment as element_type immediately above — a
  // single value per player per season, copied as-is (see resolveTeamCode),
  // never summed. NULL is a real, expected value (see
  // player_match_stats.team_code's own COMMENT ON COLUMN).
  team_code: number | null
  competition: string | null
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
  team_goals_conceded: number | null
}

/** The cumulative sums this job stores. Every field always a real number — never null. */
export interface FeatureTotals {
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
  prior_team_goals_conceded: number
}

export const ZERO_TOTALS: Readonly<FeatureTotals> = Object.freeze({
  prior_matches: 0,
  prior_minutes: 0,
  prior_xg: 0,
  prior_xa: 0,
  prior_saves: 0,
  prior_clearances: 0,
  prior_blocks: 0,
  prior_interceptions: 0,
  prior_tackles: 0,
  prior_recoveries: 0,
  prior_team_goals_conceded: 0,
})

/** One feature_history row, matching the migration's columns exactly. */
export interface FeatureHistoryRow extends FeatureTotals {
  season: string
  gameweek_id: number
  player_code: number
  // Ticket #146. A single value per player per season (see
  // resolveElementType) — not itself a "prior" quantity, so it is not
  // recomputed per gameweek the way the counters below are. NULL when this
  // player's position could not be resolved at ingest time (see
  // player_match_stats.element_type's own COMMENT ON COLUMN).
  element_type: number | null
  // Ticket #167. Same "single value per player per season" treatment as
  // element_type immediately above (see resolveTeamCode). NULL when this
  // player's team_code could not be resolved at ingest time (see
  // player_match_stats.team_code's own COMMENT ON COLUMN).
  team_code: number | null
  // Ticket #146. Raw per-match counts, strictly before gameweek_id — see
  // this file's header. Always real numbers, never null, exactly like every
  // prior_* total above: a player's first gameweek carries 0 for both, not
  // an absent value.
  prior_defcon_qualifying_matches: number
  prior_defcon_hits: number
  // Ticket #181. This player's minutes played in his most recent
  // (contributing, i.e. Premier League + resolvable player_code) matches,
  // strictly before gameweek_id, most-recent-first, capped at
  // RECENT_MATCH_COUNT. Always a real array, never null, exactly like every
  // prior_* total above: a player's first gameweek carries [], not an
  // absent value. Length is always min(prior_matches, RECENT_MATCH_COUNT) —
  // see buildFeatureHistory's own comment for why that holds by
  // construction, not by coincidence.
  prior_recent_minutes: number[]
  computed_at: string
}

/**
 * A source row contributes to a player's totals only if it is a Premier
 * League match (ticket #54) AND carries a resolvable player_code (ticket
 * #22's "small gap is expected" — a row with no player_code cannot be
 * attributed to anyone). Every other row is excluded — see this file's
 * header for why the two buckets are deliberately a strict complement of
 * each other rather than three or more named categories: it is what makes
 * the "source rows read = rows contributing to totals + rows excluded"
 * reconciliation exact by construction, not by coincidence of the input.
 */
function isContributingRow(row: SourceMatchRow): row is SourceMatchRow & { player_code: number } {
  return row.competition === PREMIER_LEAGUE_COMPETITION && row.player_code !== null
}

/** Folds one contributing match's stats into a running totals accumulator. */
function addMatch(totals: FeatureTotals, row: SourceMatchRow): FeatureTotals {
  return {
    prior_matches: totals.prior_matches + 1,
    prior_minutes: totals.prior_minutes + (row.minutes_played ?? 0),
    prior_xg: totals.prior_xg + (row.xg ?? 0),
    prior_xa: totals.prior_xa + (row.xa ?? 0),
    prior_saves: totals.prior_saves + (row.saves ?? 0),
    prior_clearances: totals.prior_clearances + (row.clearances ?? 0),
    prior_blocks: totals.prior_blocks + (row.blocks ?? 0),
    prior_interceptions: totals.prior_interceptions + (row.interceptions ?? 0),
    prior_tackles: totals.prior_tackles + (row.tackles ?? 0),
    prior_recoveries: totals.prior_recoveries + (row.recoveries ?? 0),
    prior_team_goals_conceded: totals.prior_team_goals_conceded + (row.team_goals_conceded ?? 0),
  }
}

/**
 * A player's element_type for the whole season: the first non-null value
 * seen across his contributing matches. In practice every one of a player's
 * rows carries the identical value — element_type is stamped once per
 * ingest run from that run's single players.csv snapshot (ticket #146) — so
 * this is a single lookup, not a per-gameweek computation. Returns null only
 * when none of the player's matches carry a resolved position (the source's
 * own "small, expected gap" — see player_match_stats.element_type's COMMENT
 * ON COLUMN).
 */
function resolveElementType(matches: readonly SourceMatchRow[]): number | null {
  for (const match of matches) {
    if (match.element_type !== null && match.element_type !== undefined) return match.element_type
  }
  return null
}

/**
 * A player's team_code for the whole season — same "first non-null value
 * across his contributing matches" lookup as resolveElementType above, and
 * for the same reason: team_code is stamped once per ingest run from that
 * run's single players.csv snapshot (ticket #167), so every one of a
 * player's rows carries the identical value in practice. Returns null only
 * when none of the player's matches carry a resolved team_code (the same
 * "small, expected gap" — see player_match_stats.team_code's COMMENT ON
 * COLUMN).
 */
function resolveTeamCode(matches: readonly SourceMatchRow[]): number | null {
  for (const match of matches) {
    if (match.team_code !== null && match.team_code !== undefined) return match.team_code
  }
  return null
}

/**
 * Did this one match reach the player's position's defensive-contribution
 * threshold? Delegates entirely to defensiveContributionPoints (imported,
 * never reimplemented — see this file's header) with the same
 * DefensiveActionStats shape it already expects; null stat cells map to 0,
 * matching addMatch's own null-handling above. Returns false, never throws,
 * when elementType is not a valid Position (null, or an out-of-range value) —
 * a match this job cannot score a hit for still counts toward
 * prior_defcon_qualifying_matches (that check is position-independent, see
 * isQualifyingMatch), it just never counts as a hit.
 */
function reachedDefconThreshold(elementType: number | null, match: SourceMatchRow): boolean {
  if (elementType === null || !isPosition(elementType)) return false
  return (
    defensiveContributionPoints(elementType, {
      clearances: match.clearances ?? 0,
      blocks: match.blocks ?? 0,
      interceptions: match.interceptions ?? 0,
      tackles: match.tackles ?? 0,
      recoveries: match.recoveries ?? 0,
    }) > 0
  )
}

export interface BuildFeatureHistoryResult {
  rows: FeatureHistoryRow[]
  sourceRowsRead: number
  rowsContributingToTotals: number
  // Named to match the ticket's own wording exactly. Strict complement of
  // rowsContributingToTotals — see isContributingRow's comment — so
  // sourceRowsRead === rowsContributingToTotals + nonPremierLeagueRowsExcluded
  // holds by construction for ANY input, not just well-formed ones.
  nonPremierLeagueRowsExcluded: number
  playersCovered: number
  // Distinct gameweeks with at least one CONTRIBUTING match — a reporting
  // count, not the number of rows written. Ticket #125 made row output
  // dense (see buildFeatureHistory below); this field keeps its #121
  // meaning ("how many gameweeks actually had Premier League action")
  // rather than being redefined to match the (much larger) dense row count,
  // which playersCovered * (span of gameweeks) already implies.
  gameweeksCovered: number
  // The last gameweek number seen anywhere in `rows` (contributing or not)
  // — the upper bound every player's dense row range is built out to. 0 when
  // `rows` is empty. Ticket #125.
  lastGameweekInData: number
  // Ticket #146 — surfaced in job_runs.details. Count of `rows` carrying a
  // non-null element_type. Expected to equal rows.length once every player
  // this job has ever seen has a resolvable position (see resolveElementType);
  // not assumed equal to it here, computed independently instead.
  rowsWithElementType: number
  // Ticket #146 — surfaced in job_runs.details. Count of `rows` carrying
  // non-null prior_defcon_qualifying_matches AND prior_defcon_hits. Both
  // fields are always real numbers by construction (see FeatureHistoryRow),
  // so this is expected to equal rows.length on every run; computed
  // independently rather than assumed, same reasoning as rowsWithElementType.
  rowsWithDefconCounters: number
  // Ticket #167 — surfaced in job_runs.details. Count of `rows` carrying a
  // non-null team_code. Same "not assumed equal to rows.length" caveat as
  // rowsWithElementType above — a season whose player_match_stats rows have
  // no resolved team_code yet (predates the #167 ingest change, or a re-run
  // has not happened) reports this honestly below rows.length.
  rowsWithTeamCode: number
  // Ticket #181 — surfaced in job_runs.details, four counters that must
  // reconcile arithmetically. prior_recent_minutes is always a real array by
  // construction (see FeatureHistoryRow), so rowsWithRecentMinutes is
  // expected to equal rows.length on every run — computed independently
  // rather than assumed, same reasoning as rowsWithDefconCounters. The other
  // three are a strict partition of it by window length: every row has
  // EITHER a full RECENT_MATCH_COUNT-length window, OR a shorter
  // (1..RECENT_MATCH_COUNT-1) one, OR an empty one (a player with no prior
  // matches at all) — never more than one of the three.
  rowsWithRecentMinutes: number
  rowsWithFullRecentMinutesWindow: number
  rowsWithShortRecentMinutesWindow: number
  rowsWithEmptyRecentMinutesWindow: number
}

/**
 * Builds one feature_history row per (player, gameweek) for EVERY gameweek
 * from that player's first contributing (Premier League,
 * player_code-resolved) match through `lastGameweekInData` — the highest
 * gameweek number present anywhere in this season's input, whether or not
 * that particular row is itself a contributing one. This is DENSE output
 * (ticket #125): a gameweek where a player had no contributing match still
 * gets a row, carrying the running totals unchanged from the gameweek
 * before it. A backtest asking "what was knowable before gameweek 12" must
 * get an answer for a player who was injured or rotated that week, not a
 * gap it has to carry forward itself.
 *
 * THE STRICTLY-BEFORE RULE, verified by construction and unaffected by
 * density: for each gameweek in a player's dense range, the loop below
 * folds in every one of that player's contributing matches with
 * `gameweek < gameweekId` — never `<=` — before emitting that gameweek's
 * row. A gameweek with no contributing match simply folds in nothing new,
 * so its row is byte-for-byte the same totals as the gameweek before it
 * (the "carries the totals unchanged" requirement). A double gameweek's
 * second fixture is folded in only once the loop reaches the NEXT distinct
 * gameweek, exactly as under #121's sparse output — density does not change
 * how or when a match is folded in, only how many rows get written between
 * matches.
 */
export function buildFeatureHistory(rows: readonly SourceMatchRow[], season: string, computedAt: string): BuildFeatureHistoryResult {
  let rowsContributingToTotals = 0
  let nonPremierLeagueRowsExcluded = 0
  const matchesByPlayerCode = new Map<number, SourceMatchRow[]>()
  const gameweeksSeen = new Set<number>()
  let lastGameweekInData = 0

  for (const row of rows) {
    if (row.gameweek > lastGameweekInData) lastGameweekInData = row.gameweek
    if (isContributingRow(row)) {
      rowsContributingToTotals++
      gameweeksSeen.add(row.gameweek)
      const list = matchesByPlayerCode.get(row.player_code) ?? []
      list.push(row)
      matchesByPlayerCode.set(row.player_code, list)
    } else {
      nonPremierLeagueRowsExcluded++
    }
  }

  const outputRows: FeatureHistoryRow[] = []
  for (const [playerCode, matches] of matchesByPlayerCode) {
    const sorted = [...matches].sort((a, b) => a.gameweek - b.gameweek)
    const firstGameweek = sorted[0].gameweek
    const elementType = resolveElementType(sorted)
    const teamCode = resolveTeamCode(sorted)

    let runningTotals: FeatureTotals = ZERO_TOTALS
    let matchIndex = 0
    // Ticket #146: the same strictly-before accumulators as runningTotals
    // above, folded in the SAME while loop below so they share exactly one
    // "strictly before this gameweek" boundary — there is no way for the
    // counters to disagree with the totals about which matches are prior.
    let defconQualifyingMatches = 0
    let defconHits = 0
    // Ticket #181: the recent-minutes window, folded in the SAME while loop
    // as runningTotals/the defcon counters above — same "cannot disagree
    // about which matches are prior" guarantee. Held oldest-first internally
    // (push, then shift once past RECENT_MATCH_COUNT — an O(1) amortized cap
    // at this size) and reversed only at emission time into the
    // most-recent-first order the column actually stores.
    let recentMinutesWindow: number[] = []

    // Every integer gameweek from this player's first contributing match
    // through the last gameweek present anywhere in the season's data —
    // dense by construction, since nothing here skips a gameweek number.
    for (let gameweekId = firstGameweek; gameweekId <= lastGameweekInData; gameweekId++) {
      // Fold in every contributing match strictly before this gameweek that
      // has not already been folded in. A gameweek with no match here folds
      // in nothing, leaving runningTotals — and therefore this row —
      // identical to the previous gameweek's row.
      while (matchIndex < sorted.length && sorted[matchIndex].gameweek < gameweekId) {
        const match = sorted[matchIndex]
        runningTotals = addMatch(runningTotals, match)
        if (isQualifyingMatch({ minutesPlayed: match.minutes_played ?? 0 })) {
          defconQualifyingMatches++
          if (reachedDefconThreshold(elementType, match)) defconHits++
        }
        // Ticket #181: NOT gated behind isQualifyingMatch above — every
        // contributing match's minutes count here, cameos included, matching
        // estimateMinutes()'s own window (see this file's header).
        recentMinutesWindow.push(match.minutes_played ?? 0)
        if (recentMinutesWindow.length > RECENT_MATCH_COUNT) recentMinutesWindow.shift()
        matchIndex++
      }
      outputRows.push({
        season,
        gameweek_id: gameweekId,
        player_code: playerCode,
        element_type: elementType,
        team_code: teamCode,
        prior_defcon_qualifying_matches: defconQualifyingMatches,
        prior_defcon_hits: defconHits,
        prior_recent_minutes: [...recentMinutesWindow].reverse(),
        ...runningTotals,
        computed_at: computedAt,
      })
    }
  }

  const rowsWithElementType = outputRows.filter((r) => r.element_type !== null).length
  const rowsWithDefconCounters = outputRows.filter(
    (r) => r.prior_defcon_qualifying_matches !== null && r.prior_defcon_hits !== null,
  ).length
  const rowsWithTeamCode = outputRows.filter((r) => r.team_code !== null).length
  // Ticket #181 — a strict partition of rowsWithRecentMinutes by window
  // length; see BuildFeatureHistoryResult's own comment for why the four
  // reconcile arithmetically.
  const rowsWithRecentMinutes = outputRows.filter((r) => r.prior_recent_minutes !== null).length
  const rowsWithFullRecentMinutesWindow = outputRows.filter((r) => r.prior_recent_minutes.length === RECENT_MATCH_COUNT).length
  const rowsWithShortRecentMinutesWindow = outputRows.filter(
    (r) => r.prior_recent_minutes.length > 0 && r.prior_recent_minutes.length < RECENT_MATCH_COUNT,
  ).length
  const rowsWithEmptyRecentMinutesWindow = outputRows.filter((r) => r.prior_recent_minutes.length === 0).length

  return {
    rows: outputRows,
    sourceRowsRead: rows.length,
    rowsContributingToTotals,
    nonPremierLeagueRowsExcluded,
    playersCovered: matchesByPlayerCode.size,
    gameweeksCovered: gameweeksSeen.size,
    lastGameweekInData,
    rowsWithTeamCode,
    rowsWithElementType,
    rowsWithDefconCounters,
    rowsWithRecentMinutes,
    rowsWithFullRecentMinutesWindow,
    rowsWithShortRecentMinutesWindow,
    rowsWithEmptyRecentMinutesWindow,
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
  const season = (process.env.FEATURE_HISTORY_SEASON ?? '').trim() || DEFAULT_SEASON

  try {
    // ------------------------------------------------------------------
    // Read every player_match_stats row for the configured season — every
    // competition, not just Premier League, so nonPremierLeagueRowsExcluded
    // below is a real exclusion count against the true source total, not a
    // count that has already had the excluded rows filtered out of it.
    // Paginated and count-verified: 15,000+ rows for one season, far past
    // the 1,000-row db-max-rows ceiling (scripts/lib/paginate.ts).
    // ------------------------------------------------------------------
    const {
      rows: sourceRows,
      error: sourceError,
      pages: sourcePagesFetched,
    } = await fetchAllPages<SourceMatchRow>((from, to) =>
      supabase
        .from('player_match_stats')
        .select(
          'player_code, element_type, team_code, competition, gameweek, minutes_played, xg, xa, saves, clearances, blocks, interceptions, tackles, recoveries, team_goals_conceded',
        )
        .eq('season', season)
        .order('player_id', { ascending: true })
        .order('match_id', { ascending: true })
        .range(from, to)
        .returns<SourceMatchRow[]>(),
    )
    if (sourceError) {
      if (isMissingTable(sourceError, 'player_match_stats')) {
        throw new FeatureHistoryError(
          `the "player_match_stats" table does not exist. Apply ${PLAYER_MATCH_STATS_MIGRATION} first.`,
          'player_match_stats',
        )
      }
      if (isMissingColumn(sourceError, 'team_goals_conceded')) {
        throw new FeatureHistoryError(
          'player_match_stats.team_goals_conceded does not exist in this database yet. This job requires it ' +
            '(the pre-existing per-player conceded-goals column is a goalkeeper-only stat and must never be ' +
            'substituted — see this file\'s header). Apply ' +
            'supabase/migrations/20260828090000_player_match_stats_team_goals_conceded.sql (ticket #125) ' +
            'before running this job.',
          'player_match_stats',
        )
      }
      if (isMissingColumn(sourceError, 'element_type')) {
        throw new FeatureHistoryError(
          'player_match_stats.element_type does not exist in this database yet. This job requires it ' +
            `(see this file's header). Apply ${POSITION_AND_DEFCON_MIGRATION} (ticket #146) before running this job.`,
          'player_match_stats',
        )
      }
      if (isMissingColumn(sourceError, 'team_code')) {
        throw new FeatureHistoryError(
          'player_match_stats.team_code does not exist in this database yet. This job requires it ' +
            `(see this file's header). Apply ${TEAM_AND_OPPONENT_MIGRATION} (ticket #167) before running this job.`,
          'player_match_stats',
        )
      }
      throw new FeatureHistoryError(`player_match_stats lookup failed: ${sourceError.message}`, 'player_match_stats')
    }

    const { count: sourceRowsExpectedByCount, error: countError } = await supabase
      .from('player_match_stats')
      .select('*', { count: 'exact', head: true })
      .eq('season', season)
    if (countError) {
      throw new FeatureHistoryError(`player_match_stats count check failed: ${countError.message}`, 'player_match_stats')
    }
    assertRowCountMatches(`player_match_stats (season=${season})`, sourceRows.length, sourceRowsExpectedByCount ?? 0)

    // ------------------------------------------------------------------
    // Pure computation — see buildFeatureHistory above.
    // ------------------------------------------------------------------
    const computedAt = new Date().toISOString()
    const result = buildFeatureHistory(sourceRows, season, computedAt)

    // ------------------------------------------------------------------
    // Upsert, batched. Never deletes.
    // ------------------------------------------------------------------
    for (let i = 0; i < result.rows.length; i += UPSERT_BATCH_SIZE) {
      const batch = result.rows.slice(i, i + UPSERT_BATCH_SIZE)
      const { error } = await supabase
        .from('feature_history')
        .upsert(batch, { onConflict: 'season,gameweek_id,player_code' })
      if (error) {
        if (isMissingTable(error, 'feature_history')) {
          throw new FeatureHistoryError(
            `the "feature_history" table does not exist. Apply ${FEATURE_HISTORY_MIGRATION} first.`,
            'feature_history',
          )
        }
        if (
          isMissingColumn(error, 'element_type') ||
          isMissingColumn(error, 'prior_defcon_qualifying_matches') ||
          isMissingColumn(error, 'prior_defcon_hits')
        ) {
          throw new FeatureHistoryError(
            'feature_history is missing one of element_type / prior_defcon_qualifying_matches / ' +
              `prior_defcon_hits. Apply ${POSITION_AND_DEFCON_MIGRATION} (ticket #146) before running this job.`,
            'feature_history',
          )
        }
        if (isMissingColumn(error, 'team_code')) {
          throw new FeatureHistoryError(
            `feature_history is missing team_code. Apply ${TEAM_AND_OPPONENT_MIGRATION} (ticket #167) before ` +
              'running this job.',
            'feature_history',
          )
        }
        if (isMissingColumn(error, 'prior_recent_minutes')) {
          throw new FeatureHistoryError(
            `feature_history is missing prior_recent_minutes. Apply ${RECENT_MINUTES_MIGRATION} (ticket #181) ` +
              'before running this job.',
            'feature_history',
          )
        }
        throw new FeatureHistoryError(`upsert into "feature_history" failed: ${error.message}`, 'feature_history')
      }
    }

    const details: JsonRecord = {
      season,
      sourceRowsRead: result.sourceRowsRead,
      sourceRowsExpectedByCount: sourceRowsExpectedByCount ?? 0,
      sourcePagesFetched,
      rowsContributingToTotals: result.rowsContributingToTotals,
      nonPremierLeagueRowsExcluded: result.nonPremierLeagueRowsExcluded,
      rowsWritten: result.rows.length,
      rowsWithElementType: result.rowsWithElementType,
      rowsWithDefconCounters: result.rowsWithDefconCounters,
      rowsWithTeamCode: result.rowsWithTeamCode,
      rowsWithRecentMinutes: result.rowsWithRecentMinutes,
      rowsWithFullRecentMinutesWindow: result.rowsWithFullRecentMinutesWindow,
      rowsWithShortRecentMinutesWindow: result.rowsWithShortRecentMinutesWindow,
      rowsWithEmptyRecentMinutesWindow: result.rowsWithEmptyRecentMinutesWindow,
      playersCovered: result.playersCovered,
      gameweeksCovered: result.gameweeksCovered,
      lastGameweekInData: result.lastGameweekInData,
    }
    const message =
      `${JOB_NAME}: season ${season} — ${result.sourceRowsRead} source row(s) read ` +
      `(${result.rowsContributingToTotals} Premier League row(s) contributing to totals, ` +
      `${result.nonPremierLeagueRowsExcluded} row(s) excluded), ${result.rows.length} dense feature_history row(s) ` +
      `written across ${result.playersCovered} player(s), through gameweek ${result.lastGameweekInData} ` +
      `(${result.rowsWithElementType} carrying a non-null element_type, ` +
      `${result.rowsWithDefconCounters} carrying non-null defcon counters, ` +
      `${result.rowsWithTeamCode} carrying a non-null team_code, ` +
      `${result.rowsWithRecentMinutes} carrying a non-null prior_recent_minutes array: ` +
      `${result.rowsWithFullRecentMinutesWindow} full, ${result.rowsWithShortRecentMinutesWindow} short, ` +
      `${result.rowsWithEmptyRecentMinutesWindow} empty).`
    console.log(message)
    await recordJobRun(supabase, { status: 'success', message, details, startedAt })
  } catch (err) {
    const message =
      err instanceof FeatureHistoryError
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
