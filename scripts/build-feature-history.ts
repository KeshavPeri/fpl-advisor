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
// applied to it afterwards. Nothing under src/lib/projection/ is imported or
// read here — this file computes nothing beyond arithmetic sums.
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
// TEAM_GOALS_CONCEDED — A SCHEMA GAP FLAGGED, NOT WORKED AROUND. This
// ticket's brief specifies reading player_match_stats.team_goals_conceded
// (goals_conceded is a goalkeeper-only stat, ~1% populated for outfield
// rows — using it would reproduce the #54 bias this repo already fixed once
// for clean sheets). As of this ticket, no migration in this repository
// actually adds that column to player_match_stats, and
// scripts/ingest-core-insights.ts's MATCH_STATS_REQUIRED_COLUMNS does not
// populate it — confirmed by reading both files directly. supabase/README.md's
// row for the #54 migration (20260818100000_player_match_stats_competition.sql)
// currently describes it as already added; the migration file itself does
// not do so. This job is written to the spec regardless — selecting
// team_goals_conceded from player_match_stats — because substituting a
// different column would silently reintroduce the exact bias #54 exists to
// prevent. If the live database does not yet have this column, the read
// below fails LOUDLY with a message naming the gap (see isMissingColumn),
// rather than silently defaulting the totals to zero. See this ticket's
// Builder report for the full flag raised to the orchestrator.
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
// NOT WIRED INTO ANY WORKFLOW. Run by hand for now — see the ticket's scope.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'
import { PREMIER_LEAGUE_COMPETITION } from './lib/competition.ts'

const JOB_NAME = 'build-feature-history'
const PLAYER_MATCH_STATS_MIGRATION = 'supabase/migrations/20260811170000_player_match_stats.sql'
const FEATURE_HISTORY_MIGRATION = 'supabase/migrations/20260827090000_feature_history.sql'

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

/** The columns this job reads off player_match_stats — only what it sums. */
export interface SourceMatchRow {
  player_code: number | null
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
  gameweeksCovered: number
}

/**
 * Builds one feature_history row per (player, gameweek) for every gameweek
 * in which that player has at least one contributing (Premier League,
 * player_code-resolved) match — the same per-player-per-gameweek density
 * player_match_stats itself has. A gameweek where a player's only match was
 * excluded (a cup tie, say) gets no row of its own; that is correct, not a
 * gap — the STRICTLY BEFORE rule only needs a row wherever there is a
 * meaningful "as of this gameweek" moment to ask about, and this job's sole
 * consumer-to-be will read the most recent row at or before whatever
 * gameweek it cares about (a later ticket's concern, not this one's).
 *
 * THE STRICTLY-BEFORE RULE, verified by construction: rows are processed in
 * ascending gameweek order, and for each of a player's distinct gameweeks a
 * row is emitted using the running totals accumulated so far — BEFORE that
 * gameweek's own match(es) are folded in. Every match up to and including a
 * double-gameweek's second fixture is folded in only once the loop reaches
 * the NEXT distinct gameweek, so a double gameweek is handled correctly
 * without special-casing it.
 */
export function buildFeatureHistory(rows: readonly SourceMatchRow[], season: string, computedAt: string): BuildFeatureHistoryResult {
  let rowsContributingToTotals = 0
  let nonPremierLeagueRowsExcluded = 0
  const matchesByPlayerCode = new Map<number, SourceMatchRow[]>()
  const gameweeksSeen = new Set<number>()

  for (const row of rows) {
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
    const distinctGameweeks = [...new Set(sorted.map((m) => m.gameweek))].sort((a, b) => a - b)

    let runningTotals: FeatureTotals = ZERO_TOTALS
    let matchIndex = 0

    for (const gameweekId of distinctGameweeks) {
      // Fold in every match strictly before this gameweek that has not
      // already been folded in. Matches AT this gameweek (there may be more
      // than one, in a double gameweek) are deliberately left for the next
      // iteration of this outer loop — see the "STRICTLY-BEFORE" note above.
      while (matchIndex < sorted.length && sorted[matchIndex].gameweek < gameweekId) {
        runningTotals = addMatch(runningTotals, sorted[matchIndex])
        matchIndex++
      }
      outputRows.push({
        season,
        gameweek_id: gameweekId,
        player_code: playerCode,
        ...runningTotals,
        computed_at: computedAt,
      })
    }
  }

  return {
    rows: outputRows,
    sourceRowsRead: rows.length,
    rowsContributingToTotals,
    nonPremierLeagueRowsExcluded,
    playersCovered: matchesByPlayerCode.size,
    gameweeksCovered: gameweeksSeen.size,
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
          'player_code, competition, gameweek, minutes_played, xg, xa, saves, clearances, blocks, interceptions, tackles, recoveries, team_goals_conceded',
        )
        .eq('season', season)
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
          'player_match_stats.team_goals_conceded does not exist in this database. This job requires it ' +
            '(goals_conceded is a goalkeeper-only stat and must not be substituted — see this file\'s header). ' +
            'No migration in this repository currently adds that column and scripts/ingest-core-insights.ts ' +
            'does not populate it. Add and backfill it in a separate ticket before running this job.',
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
      playersCovered: result.playersCovered,
      gameweeksCovered: result.gameweeksCovered,
    }
    const message =
      `${JOB_NAME}: season ${season} — ${result.sourceRowsRead} source row(s) read ` +
      `(${result.rowsContributingToTotals} Premier League row(s) contributing to totals, ` +
      `${result.nonPremierLeagueRowsExcluded} row(s) excluded), ${result.rows.length} feature_history row(s) ` +
      `written across ${result.playersCovered} player(s) and ${result.gameweeksCovered} gameweek(s).`
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
