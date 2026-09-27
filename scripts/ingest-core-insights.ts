// FPL-Core-Insights ingest job — ticket #12, team-write matching fixed by
// ticket #32, stale-elo-on-unmatched-club fixed by ticket #63, #63's own
// nulling rule narrowed (never applied to a source gap) and opponent
// resolution given a slug fallback by ticket #176. Per-gameweek price/bonus/
// BPS history (public.player_gameweek_history, from a different source file,
// playerstats.csv) added by ticket #248 — see that section, below
// buildTeamCodeMap, for its own full header.
//
// TICKET #285: the #176 name/short_name fallback below only PARTIALLY resolved opponents (it
// cannot help a club whose `name` cell is already an abbreviation), which left
// player_match_stats.opponent_team_code null on 64.1% of current-season rows (preflight check
// 12, ticket #236). buildClubCodeBySlug now seeds its slug map from
// scripts/lib/coreClubSlugs.ts — a small, hand-built, hand-verified table read directly off
// FPL-Core-Insights' own fixtures.csv, ahead of teams.csv entirely — see that function's own
// "first resolver wins" comment, below.
//
// TICKET #63 FINDING (verified 18 Aug 2026, live data) — WHAT IT GOT RIGHT.
// A club whose `code` has no row in the ingested season's teams.csv — i.e.
// counted under `teamsCodesNotInCsv` below — used to be left with whatever
// `elo` value it last held, rather than having that value cleared. For three
// of this season's promoted clubs, what it last held was a ClubElo rating
// that belonged to an entirely different club, written during the pre-#32
// era when this job upserted teams.elo keyed on `id` rather than `code` (FPL
// team ids are not stable across seasons — see the #32 note below). Confirmed
// against the live public.teams table on 18 Aug 2026:
//   Coventry City (id 7)  was holding Chelsea's  rating
//   Hull City     (id 11) was holding Leeds's    rating
//   Ipswich Town  (id 12) was holding Liverpool's rating
// A promoted club rated like a top-four side inverts its projection in both
// directions: its own players are over-projected, and its opponents are
// under-projected on clean sheets. #63 was RIGHT to refuse to leave that
// specific stale-and-wrong value in place — that problem was real and #63's
// fix of it stands.
//
// TICKET #176 FINDING — THE CASE #63 DID NOT ANTICIPATE. #63's fix nulled
// `elo` on EVERY public.teams row this job cannot currently match to a CSV
// code, on every run, forever — not just the one time it cleared the
// pre-#32 mismatched values. That is correct for a club that has genuinely
// left the competition (see the "genuine removal" note below for why that
// case, in practice, never reaches this function at all). It is wrong for a
// club that is very much still in the competition but whose *season file*
// the source has not (yet) populated: data/2026-2027/teams.csv was checked
// again on 1 Sept 2026 (fresh, not trusted from an earlier note — see
// LEARNINGS-first-build-wave.md §5) and its `elo` AND `fotmob_name` columns
// are still empty for all 20 clubs. Every run of the 2025-2026-season ingest
// (this job's DEFAULT_SEASON, see .github/workflows/scheduled-jobs.yml)
// re-nulls the three promoted clubs' `elo` on that basis, and — because no
// season file has ever supplied a fresh value for them — nothing ever
// repopulates it. The rating is not gone from the world; the source simply
// has nothing to say about it *this run*. #63's own rule cannot tell those
// two cases apart, because it only ever sees one CSV snapshot at a time.
//
// GENUINE REMOVAL VS. A TEMPORARY SOURCE GAP — HOW (NOT) TOLD APART, AND WHY
// THAT'S SAFE. This job never inserts or deletes a public.teams row — see the
// #32 note below — it only reads back rows scripts/ingest-fpl.ts already
// wrote. That job upserts `teams` keyed on `id` from the CURRENT season's
// live bootstrap-static/, which always lists exactly the 20 clubs presently
// in the top flight; a relegated club's old id slot is overwritten with the
// promoted club that now holds it (identity columns included), not left
// behind as a separate row. So a club that has genuinely left the
// competition leaves no public.teams row for this job to ever see in the
// first place — there is nothing to null, because there is nothing to read.
// Every row `fetchTeamIdentities` returns is, by construction, a club
// scripts/ingest-fpl.ts confirms is CURRENTLY in the competition. That means
// every case `planTeamEloUpdates` below can actually encounter — code absent
// from the CSV, code present with a blank elo cell, code present with a
// malformed elo cell — is a source gap, never a genuine departure. The two
// cases #63 worried about telling apart turn out not to co-occur in this
// job's own input at all; genuine removal is already handled, silently, one
// layer up. This is reported as the ticket's own "if they cannot be [told
// apart], default to keeping the rating" case — except here the two cases
// are not merely indistinguishable, one of them structurally cannot occur.
//
// THE FIX: PRESERVE, NEVER NULL; RECORD STALENESS INSTEAD. A club absent
// from the season file, or present with a blank or malformed elo cell,
// now KEEPS its existing `teams.elo` — see `planTeamEloUpdates`'s
// `staleMarks` below, which replaces #63's `nulls`. So "we have a rating and
// it is current" and "we have a rating and the source stopped supplying it"
// stay distinguishable, every row this run cannot confirm fresh has
// `elo_stale_since` set (see
// supabase/migrations/20260901090000_teams_elo_stale_since.sql) the first
// time it goes stale, left untouched on every subsequent run so the ORIGINAL
// stale-since moment survives, and cleared back to NULL the moment a fresh
// CSV value updates it again. A stale rating is not silent, either: it is
// visible in `job_runs.details` (`teamsEloPreserved` below) and in the
// column itself — and it is strictly better than the FDR fallback
// `src/lib/projection/fixture.ts` reaches for on a genuinely null elo (see
// that module and `docs/projection-model-backlog.md` G8): a coarser
// instrument, reached for only when there truly is no rating at all to fall
// back on.
//
// Fetches CSVs over plain HTTPS from the FPL-Core-Insights repo (no
// credential, no clone — individual files only) and upserts:
//   - public.player_match_stats: per-player, per-match defensive/attacking
//     stats (tackles, interceptions, blocks, clearances, recoveries, xG, xA
//     and a few adjacent counting stats) — the raw inputs to later defcon
//     modelling. Nothing here is derived; see the ticket's out-of-scope list.
//   - public.teams.elo: ClubElo ratings, from the source's teams.csv.
//
// TEAM WRITES ARE MATCHED ON teams.code, NEVER teams.id (ticket #32).
// FPL team ids are not stable across seasons — the same failure already
// proven for player ids one level up, in #12/#22. This job ingests the
// 2025-2026 season file (see DEFAULT_SEASON below) while scripts/ingest-fpl.ts
// ingests the 2026/27 bootstrap-static/ into the same public.teams table, and
// the two season's ids disagree for most clubs. Verified live on 15 Aug 2026
// by fetching both season files directly from the source:
//   https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data/2025-2026/teams.csv
//   https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data/2026-2027/teams.csv
// Only 5 of the 20 team ids referred to the same club in both files — e.g.
// id 3 was Burnley (code 90) in 2025-2026 but Bournemouth (code 91) in
// 2026-2027; id 12 was Liverpool (code 14) then Ipswich Town (code 40).
// `teams.code`, by contrast, was identical for all 17 clubs present in both
// files, with the same `elo` value against that code in both. So this job
// never inserts a team row and never writes identity columns (name,
// short_name, code, pulse_id, any strength_*) — scripts/ingest-fpl.ts alone
// owns team identity (upserted on id, which is stable within one FPL
// season). This job only reads `id, code` off existing public.teams rows and
// updates `elo` on whichever row's `code` matches the CSV, exactly as
// player_match_stats.player_code already does one level up.
//
// One job_runs row per execution, matching the #10 heartbeat pattern: never
// upserted, so runs accumulate as an audit log. Reads exactly two
// environment variables — SUPABASE_URL and SUPABASE_SECRET_KEY — same as
// scripts/heartbeat.ts. No fallback names, no browser-bundle-prefixed
// variables: this runs in a GitHub Actions job, never in the browser.
//
// SEASON DIRECTORY NOT YET PUBLISHED IS A NORMAL STATE, NOT A FAILURE.
// The source publishes a season's directory only once that season exists.
// If the season-root manifest (players.csv) 404s, this job records that
// plainly in job_runs and exits 0 — it must not page anybody for a season
// that simply hasn't been published yet (true for 2026-2027 as of the
// ticket's writing; see the ticket #12 Builder report for what was actually
// observed live on 11 Aug 2026, which had moved on since the ticket was
// written — the source can and does change from day to day).
//
// A GENUINE FAILURE — an unreachable host, an unexpected non-200/404 HTTP
// status, or a file that exists but does not parse as CSV (or is missing an
// expected column, meaning the source's schema changed) — exits non-zero and
// writes a failed job_runs row naming the file.
//
// Per-gameweek data lives at
//   {season}/By Gameweek/GW{n}/playermatchstats.csv
// (note the literal space, percent-encoded below as %20 — the season root
// itself has no such file, see gameweekUrl()). Gameweeks are walked
// sequentially from 1; the first 404 stops the walk, since gameweeks are
// always published in order and a later ticket does not need this job to
// keep probing weeks that cannot exist yet. A 200 response with zero data
// rows (header only — a gameweek not yet played) is not an error either; the
// walk simply continues to the next gameweek.
//
// No FK from player_match_stats.player_id to players.id — see the migration
// file's header comment for why (FPL element ids are not stable across
// season boundaries, verified against real fetched data). This job stores
// player_id honestly and does not drop rows over it.
//
// player_code (ticket #22): players.csv carries both player_id and the
// source's stable player_code, so every match-stat row is stamped with the
// player_code for its player_id, built as a player_id -> player_code map
// from that same season's players.csv fetched below. This is the join key
// that survives a season boundary — see
// supabase/migrations/20260811180000_player_match_stats_player_code.sql's
// header for the "because". A row whose player_id has no entry in that
// map (source files are generated separately; a small gap is expected) is
// still written, with player_code left null — never skipped over this.
//
// competition (ticket #54): match_id carries the competition as a slug
// segment (e.g. "25-26-prem-arsenal-vs-chelsea"), decoded once per row by
// scripts/lib/competition.ts's parseCompetition() and written to every row,
// existing and new, via this same upsert — see
// supabase/migrations/20260818100000_player_match_stats_competition.sql's
// header for the "because" and every consumer's filtering obligation. A
// match_id whose competition token is not on that module's known list makes
// this job FAIL LOUDLY — parseCompetition() throws, the error propagates out
// of the per-row mapping straight to main()'s catch block below, which
// records a failed job_runs row (naming the match_id, via the thrown
// error's own message) and exits non-zero. It does not default to "prem"
// and does not store null and continue — see that module's header for why.
//
// team_goals_conceded (ticket #125): added to MATCH_STATS_REQUIRED_COLUMNS
// and written on every row via the same toInt() treatment as every other
// integer counting stat (goals_conceded, saves, etc.) — a blank/missing
// source cell maps to null, never 0. This is the team-level figure clean
// sheets must be read from; goals_conceded is a goalkeeper-only stat (74%
// populated on goalkeeper rows, 1.1% on outfield rows) and must never be
// substituted for it. supabase/README.md's row for the #54 migration
// (20260818100000_player_match_stats_competition.sql) wrongly claimed that
// migration already added this column — it did not; see
// supabase/migrations/20260828090000_player_match_stats_team_goals_conceded.sql
// (the migration that actually adds it) and the corrected README rows, both
// from ticket #125.
//
// element_type (ticket #146): players.csv's own "position" column (already
// required by PLAYERS_REQUIRED_COLUMNS, but never previously read past that
// validation) is now mapped to the plain FPL position code — 1 = goalkeeper,
// 2 = defender, 3 = midfielder, 4 = forward, matching src/lib/scoring/types.ts
// — and written to player_match_stats.element_type on every row, via the same
// player_id -> value map shape buildPlayerCodeMap already uses for
// player_code. WHY NOT THE LIVE public.players TABLE: that table holds only
// the CURRENT season's players (616 for 2026/27) and has no row at all for
// anyone who has since left the league (841 players in 2025-2026) — exactly
// the cross-season identity problem player_code already exists to solve one
// level up (deltas.md D9, tickets #22/#32). scripts/build-feature-history.ts
// (also ticket #146) copies this column onto feature_history.element_type so
// a backtest can know a player's position without that join.
// FAIL LOUDLY ON AN UNKNOWN POSITION STRING, same philosophy as
// parseCompetition() in scripts/lib/competition.ts: a non-blank position cell
// that does not match one of the four known words throws UnknownPositionError,
// which is deliberately NOT caught in buildElementTypeMap — it propagates to
// main()'s own catch block and fails the whole run, rather than silently
// mapping a schema change to null. A genuinely BLANK position cell, by
// contrast, is treated the same as player_code's own "small, expected gap":
// the player_id is simply left out of the map, and every row for it writes
// element_type = null, not skipped and not an error.

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { parse } from 'csv-parse/sync'
import { parseCompetition } from './lib/competition.js'
// Ticket #167. Kept as a SEPARATE import statement from parseCompetition's
// own line above, deliberately — this file's own tests grep that exact line
// (`import { parseCompetition } from './lib/competition.js'`) to prove
// parseCompetition is imported from the shared module rather than
// pattern-matched locally; widening that one import to a multi-name list
// would still be correct code but would break that grep for no real benefit.
import { parseMatchClubSlugs, type CompetitionToken } from './lib/competition.js'
// Ticket #285: the hand-built, verified-against-real-fixtures.csv slug -> team_code map — the
// FIRST resolver buildClubCodeBySlug consults, ahead of teams.csv's own fotmob_name/name
// fallback below. See scripts/lib/coreClubSlugs.ts's own header for the full "because".
import { CORE_CLUB_SLUG_TO_TEAM_CODE } from './lib/coreClubSlugs.ts'

const JOB_NAME = 'ingest-core-insights'

// The season identifier appears exactly once as a configurable default,
// here — every URL is built from this (or the CORE_INSIGHTS_SEASON env
// override), never hardcoded again below.
const DEFAULT_SEASON = '2025-2026'

const SOURCE_BASE_URL = 'https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data'
const MAX_GAMEWEEKS = 38 // a Premier League season is 38 gameweeks; the walk stops at the first 404 well before this in practice
const PLAYER_MATCH_STATS_MIGRATION = 'supabase/migrations/20260811170000_player_match_stats.sql'
// Ticket #248.
const PLAYER_GAMEWEEK_HISTORY_MIGRATION = 'supabase/migrations/20260917100000_player_gameweek_history.sql'
// Batched the same way ingest-gameweek-live-stats.ts batches its own upsert — a full season is up
// to ~30,000 rows (verified: 29,978 for 2025-2026 on 17 Sept 2026), too many for one PostgREST call.
const PLAYER_GAMEWEEK_HISTORY_UPSERT_BATCH_SIZE = 500

function seasonRootUrl(season: string, file: string): string {
  return `${SOURCE_BASE_URL}/${encodeURIComponent(season)}/${file}`
}

function gameweekUrl(season: string, gameweek: number): string {
  // "By Gameweek" is a fixed path segment (not derived from configuration),
  // so its %20 encoding is written once, here, rather than computed.
  return `${SOURCE_BASE_URL}/${encodeURIComponent(season)}/By%20Gameweek/GW${gameweek}/playermatchstats.csv`
}

// Ticket #248: playerstats.csv lives at the season ROOT (one file covering every gameweek), unlike
// playermatchstats.csv above which is walked per-gameweek under "By Gameweek/GW{n}/".
function playerStatsUrl(season: string): string {
  return seasonRootUrl(season, 'playerstats.csv')
}

// ============================================================================
// Supabase env — identical contract to scripts/heartbeat.ts.
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
        `(missing: ${missing.join(', ')}). Making no network call.`
    )
    return null
  }

  return { url: url as string, secretKey: secretKey as string }
}

interface PostgrestLikeError {
  code?: string
  message?: string
}

// See scripts/heartbeat.ts for why both error shapes are checked: PGRST205
// is PostgREST's own code for "relation not in schema cache" (hosted
// Supabase, table not migrated yet); 42P01 is bare Postgres's undefined_table.
function isMissingTable(error: PostgrestLikeError, tableName: string): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const message = error.message ?? ''
  return new RegExp(tableName).test(message) && /schema cache|does not exist|relation.*does not exist/i.test(message)
}

// ============================================================================
// job_runs
// ============================================================================

interface JobRunInput {
  status: 'success' | 'failure' | 'skipped'
  message: string
  details: Record<string, unknown>
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
// Fetching and parsing
// ============================================================================

class IngestError extends Error {}

async function fetchCsv(url: string): Promise<{ status: number; text: string }> {
  let response: Response
  try {
    response = await fetch(url)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new IngestError(`could not reach ${url}: ${message}`)
  }
  const text = await response.text()
  return { status: response.status, text }
}

function parseCsvRecords(text: string, url: string, requiredColumns: string[]): Array<Record<string, string>> {
  let records: Array<Record<string, string>>
  try {
    records = parse(text, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, string>>
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new IngestError(`${url} exists but does not parse as CSV: ${message}`)
  }

  if (records.length === 0) {
    if (text.trim().length === 0) {
      throw new IngestError(`${url} exists but is empty (no header row)`)
    }
    // Header row present, zero data rows — a gameweek not yet played, or an
    // aggregate file legitimately empty. Not a parse failure.
    return records
  }

  const columns = Object.keys(records[0])
  const missing = requiredColumns.filter((c) => !columns.includes(c))
  if (missing.length > 0) {
    throw new IngestError(
      `${url} exists but is missing expected column(s) [${missing.join(', ')}] — the source's schema may have changed`
    )
  }
  return records
}

const PLAYERS_REQUIRED_COLUMNS = ['player_code', 'player_id', 'first_name', 'second_name', 'web_name', 'team_code', 'position']
// The columns this job actually reads: `code`/`elo` since ticket #32, plus
// `fotmob_name` since ticket #167, which builds the club-slug -> team_code
// map opponent resolution needs from this same column — see
// buildClubCodeBySlug below. `name` and `short_name` were added back to this
// list by ticket #176: they were never WRITTEN to public.teams (still true —
// identity stays scripts/ingest-fpl.ts's alone, see the #32 note below), but
// they are now READ, as the fallback slug source when fotmob_name is blank —
// see buildClubCodeBySlug. Requiring them here means a future schema change
// that drops either column fails this job loudly rather than silently
// leaving the fallback permanently empty with no explanation.
export const TEAMS_REQUIRED_COLUMNS = ['code', 'elo', 'fotmob_name', 'name', 'short_name']
const MATCH_STATS_REQUIRED_COLUMNS = [
  'player_id',
  'match_id',
  'minutes_played',
  'goals',
  'assists',
  'xg',
  'xa',
  'xgot',
  'shots_on_target',
  'tackles',
  'tackles_won',
  'interceptions',
  'recoveries',
  'blocks',
  'clearances',
  'headed_clearances',
  'saves',
  'goals_conceded',
  'goals_prevented',
  'team_goals_conceded',
]
// Ticket #248. playerstats.csv is a DIFFERENT file from playermatchstats.csv above — one row per
// player per GAMEWEEK (a season-cumulative snapshot at that point in time), not per match. See
// this file's "player_gameweek_history" section, below buildTeamCodeMap, for the full "because".
const PLAYERSTATS_REQUIRED_COLUMNS = ['id', 'now_cost', 'bonus', 'bps', 'ep_next', 'gw', 'starts']

function toInt(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function toNumeric(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? n : null
}

// ============================================================================
// teams.elo — matched on code, never id (ticket #32). See the file header
// for the "because". This job never inserts a team row and writes exactly
// one column (elo, plus updated_at) on rows that already exist.
// ============================================================================

// A row read back from public.teams — just enough to join the CSV's code
// onto the table's id, which is what the update is actually keyed on, plus
// (ticket #176) elo_stale_since, so planTeamEloUpdates can tell "this row
// just went stale this run" from "this row has been stale since an earlier
// run" and avoid re-stamping the timestamp on every re-run.
export interface TeamIdentityRow {
  id: number
  code: number | null
  elo_stale_since: string | null
}

export interface EloByCodeResult {
  // code -> elo, built only from rows whose elo cell parses as a number.
  eloByCode: Map<number, number>
  // Every code seen in the CSV, regardless of whether its elo parsed —
  // used to distinguish "code present but elo malformed" from "code not in
  // the CSV at all" when classifying public.teams rows below.
  seenCodes: Set<number>
  // Rows whose code parsed but whose elo cell was empty or non-numeric —
  // skipped rather than writing null over an existing rating.
  malformedElo: number
}

export function buildEloByCode(records: Array<Record<string, string>>): EloByCodeResult {
  const eloByCode = new Map<number, number>()
  const seenCodes = new Set<number>()
  let malformedElo = 0
  for (const record of records) {
    const code = toInt(record.code)
    if (code === null) continue // can't join this row onto anything; not a countable DoD case
    seenCodes.add(code)
    const elo = toNumeric(record.elo)
    if (elo === null) {
      malformedElo++
      continue
    }
    eloByCode.set(code, elo)
  }
  return { eloByCode, seenCodes, malformedElo }
}

// ============================================================================
// Club slug -> team_code — ticket #167, superseded as the PRIMARY source by ticket #285.
//
// TICKET #285: buildClubCodeBySlug now seeds codeBySlug from scripts/lib/coreClubSlugs.ts's
// hand-built, verified-against-fixtures.csv map FIRST — see that file's own header and
// buildClubCodeBySlug's "first resolver wins" comment below. That map alone resolves all 20
// current clubs regardless of what teams.csv's own fotmob_name/name/short_name columns say. The
// two teams.csv-derived paths documented below are now a FALLBACK for a slug the literal map does
// not (yet) cover — e.g. a newly-promoted club before this file's map is updated — not the
// primary path any more. They are left in place rather than deleted, per the ticket's own scope
// ("Keep skip-and-count for anything still unmapped").
//
// Built from the SAME teams.csv already fetched for elo above, off its fotmob_name column, which
// was verified directly against real fetched data (2025-2026, 17 Aug 2026) to slugify EXACTLY to
// the club-name segments FPL-Core-Insights uses in match_id: "Brighton & Hove Albion" ->
// "brighton-hove-albion", "AFC Bournemouth" -> "afc-bournemouth", "Manchester United" ->
// "manchester-united" -- all confirmed against real GW1 match_id values.
// teams.csv's OTHER name columns do not: "name" holds abbreviations like
// "Man Utd" / "Nott'm Forest" / "Spurs" that do not match match_id at all.
//
// A SEASON WHOSE teams.csv HAS A BLANK fotmob_name FOR EVERY CLUB IS A REAL,
// OBSERVED CASE, NOT A HYPOTHETICAL: verified directly against
// data/2026-2027/teams.csv on 31 Aug 2026, and again on 1 Sept 2026 (ticket
// #176, fresh check, not trusted from the earlier note) -- every one of its
// 20 rows has an empty fotmob_name cell, AND an empty elo cell (unlike 31 Aug
// when elo was reported populated -- the two columns' gaps are independent
// and can each change run to run; see the elo section above for that half).
//
// TICKET #176: A NAME/short_name FALLBACK WHEN fotmob_name IS BLANK. Rather
// than leave opponent resolution permanently empty for a season whose source
// has not (yet) published fotmob_name, a club whose fotmob_name cell is
// blank now gets its slug derived from the SAME row's own `name` column (or
// `short_name` if `name` is also blank), through the exact same
// slugifyClubName() convention. This is a REAL but PARTIAL fix, verified
// directly against real fetched data (2026-2027 teams.csv + GW1
// playermatchstats.csv, 1 Sept 2026): teams.csv's `name` column carries the
// club's full name for some clubs ("Arsenal", "Crystal Palace", "Everton")
// but a shortened form for others ("Man Utd", "Spurs", "Brighton",
// "Nott'm Forest", "Newcastle", "Leeds") that does NOT match match_id's own
// full-name slug ("manchester-united", "tottenham-hotspur",
// "brighton-hove-albion", "nottingham-forest", "newcastle-united",
// "leeds-united"). A derived slug that matches no fixture is NEVER
// fuzzy-matched or corrected — it is left out of resolution entirely and
// falls through to resolveOpponentTeamCode's existing "club slug not found
// among known team codes" reason below, counted honestly like every other
// unresolvable case in this file. `slugSource` records which of the two
// paths produced each slug, so `countOpponentsResolvedViaFallback` can
// report, separately from `matchRowsWithOpponentTeamCode`, how many
// resolved opponents came from this fallback rather than fotmob_name.
// ============================================================================

/** Lowercases, drops "&" and any other punctuation, and hyphenates whitespace — matching FPL-Core-Insights' own match_id club-slug convention exactly (verified against real fetched data, see section header above). "Brighton & Hove Albion" -> "brighton-hove-albion". */
export function slugifyClubName(name: string): string {
  return name
    .toLowerCase()
    .replace(/&/g, ' ')
    .replace(/[^a-z0-9\s-]/g, '')
    .trim()
    .replace(/\s+/g, '-')
}

// Ticket #176 (fotmob_name / name_or_short_name_fallback): which of the two teams.csv columns a
// codeBySlug entry's slug was built from — lets countOpponentsResolvedViaFallback (below) report
// how many resolved opponents came from the fallback specifically, separately from the
// pre-existing matchRowsWithOpponentTeamCode total.
// Ticket #285: 'core_club_slugs' marks an entry seeded from the hand-built, verified
// scripts/lib/coreClubSlugs.ts map — the first resolver, consulted before either teams.csv path.
export type ClubSlugSource = 'core_club_slugs' | 'fotmob_name' | 'name_or_short_name_fallback'

export interface ClubCodeBySlugResult {
  // slug -> team_code. Seeded FIRST (ticket #285) from the hand-built
  // scripts/lib/coreClubSlugs.ts map, then filled in from teams.csv rows with a parseable code
  // and EITHER a non-blank fotmob_name, OR (ticket #176, when fotmob_name is blank) a slug
  // derived from that same row's name or short_name — but only for a slug the literal map does
  // not already cover; see buildClubCodeBySlug's own "first resolver wins" comment.
  codeBySlug: Map<string, number>
  // Ticket #176: slug -> which column produced it. Has exactly the same
  // keys as codeBySlug (an entry removed from codeBySlug for being a
  // duplicate is also removed here).
  slugSource: Map<string, ClubSlugSource>
  // teams.csv rows whose code parsed but whose fotmob_name cell was blank —
  // counted regardless of whether the name/short_name fallback below went on
  // to resolve a usable slug for that row (see fallbackSlugsResolved /
  // fallbackSlugUnresolvable for that breakdown). An entire season's
  // teams.csv being blank here, as observed for 2026-2027, is the expected
  // shape of this count, not a bug (see section header).
  blankFotmobName: number
  // Ticket #176. Of the blankFotmobName rows above, how many produced a
  // non-empty slug from name (or short_name, if name was also blank) and
  // were added to codeBySlug. blankFotmobName === fallbackSlugsResolved +
  // fallbackSlugUnresolvable (duplicates aside — see duplicateSlugs).
  fallbackSlugsResolved: number
  // Ticket #176. Of the blankFotmobName rows above, how many had BOTH name
  // and short_name blank too — no slug could be derived for that club at
  // all this run. Left out of codeBySlug entirely, counted here, never
  // guessed.
  fallbackSlugUnresolvable: number
  // A slug shared by more than one code — ambiguous, so NEITHER code is
  // kept in codeBySlug for that slug (removed, not guessed at), regardless
  // of which column(s) produced the colliding slugs. Distinct from
  // planTeamEloUpdates' duplicateCodeConflicts, which is about public.teams
  // rows, not this CSV-only map.
  duplicateSlugs: number
}

export function buildClubCodeBySlug(
  teamRecords: Array<Record<string, string>>,
  // Ticket #285. Defaulted, not required — every existing 1-argument call site (including every
  // test written before this ticket) keeps working unchanged; a test wanting to isolate the
  // teams.csv fallback path in miniature can still pass a smaller map.
  coreClubSlugToTeamCode: ReadonlyMap<string, number> = CORE_CLUB_SLUG_TO_TEAM_CODE
): ClubCodeBySlugResult {
  const codeBySlug = new Map<string, number>()
  const slugSource = new Map<string, ClubSlugSource>()
  const seenSlugs = new Set<string>()
  let blankFotmobName = 0
  let fallbackSlugsResolved = 0
  let fallbackSlugUnresolvable = 0
  let duplicateSlugs = 0

  // Ticket #285: seed the FIRST resolver before touching teams.csv at all. Every entry here is
  // hand-verified against Core's own fixtures.csv (scripts/lib/coreClubSlugs.ts's own header) —
  // it does not depend on teams.csv's fotmob_name column being populated, which is exactly the
  // column that has been blank for the whole 2026-27 season (#167/#176).
  for (const [slug, code] of coreClubSlugToTeamCode) {
    seenSlugs.add(slug)
    codeBySlug.set(slug, code)
    slugSource.set(slug, 'core_club_slugs')
  }

  const register = (slug: string, code: number, source: ClubSlugSource): void => {
    if (seenSlugs.has(slug)) {
      if (slugSource.get(slug) === 'core_club_slugs') {
        // Ticket #285: the literal map already resolved this slug — first resolver wins.
        // teams.csv's own guess (right or wrong) is silently discarded, not treated as an
        // ambiguous duplicate — an ambiguous duplicate is two candidates this file cannot choose
        // between; this is one already-chosen answer and one lower-priority opinion.
        return
      }
      duplicateSlugs++
      codeBySlug.delete(slug) // ambiguous — neither candidate code is kept, never guessed
      slugSource.delete(slug)
      return
    }
    seenSlugs.add(slug)
    codeBySlug.set(slug, code)
    slugSource.set(slug, source)
  }

  for (const record of teamRecords) {
    const code = toInt(record.code)
    if (code === null) continue // can't join this row onto anything, same as buildEloByCode's own skip
    const fotmobName = (record.fotmob_name ?? '').trim()
    if (fotmobName !== '') {
      register(slugifyClubName(fotmobName), code, 'fotmob_name')
      continue
    }
    blankFotmobName++
    // Ticket #176: fotmob_name is blank — fall back to this same row's own
    // name, then short_name, through the identical slugify convention. See
    // the section header for why this only PARTIALLY resolves opponents
    // (some clubs' `name` cell is already a shortened form that does not
    // match match_id) — the unresolved remainder falls through to
    // resolveOpponentTeamCode's existing named-reason counting below, never
    // guessed at here.
    const name = (record.name ?? '').trim()
    const shortName = (record.short_name ?? '').trim()
    const fallbackName = name !== '' ? name : shortName
    if (fallbackName === '') {
      // Neither name nor short_name is usable — no slug can be derived for
      // this club at all this run.
      fallbackSlugUnresolvable++
      continue
    }
    const slug = slugifyClubName(fallbackName)
    if (slug === '') {
      fallbackSlugUnresolvable++
      continue
    }
    fallbackSlugsResolved++
    register(slug, code, 'name_or_short_name_fallback')
  }
  return { codeBySlug, slugSource, blankFotmobName, fallbackSlugsResolved, fallbackSlugUnresolvable, duplicateSlugs }
}

async function fetchTeamIdentities(supabase: SupabaseClient): Promise<TeamIdentityRow[]> {
  const { data, error } = await supabase.from('teams').select('id, code, elo_stale_since')
  if (error) {
    if (isMissingTable(error, 'teams')) {
      throw new IngestError('table "teams" does not exist — apply the #9 reference-schema migration first')
    }
    throw new IngestError(`reading teams failed: ${error.message}`)
  }
  return (data ?? []) as TeamIdentityRow[]
}

// A public.teams row queued to be marked stale rather than nulled (ticket
// #176, replacing #63's `nulls`). `alreadyStale` is true when this row's
// elo_stale_since was already non-null coming into this run — see
// applyTeamEloStaleMarks, which uses it to avoid re-stamping (and thereby
// losing) the moment a rating first went stale.
export interface StaleMark {
  id: number
  alreadyStale: boolean
}

export interface TeamEloUpdatePlan {
  updates: Array<{ id: number; elo: number }>
  // public.teams rows to PRESERVE (never null — ticket #176) and mark stale:
  // every row this run has no fresh, confirmed rating for. Three shapes feed
  // this, all given the identical treatment per the DoD: a code absent from
  // the CSV entirely (also counted in teamsCodesNotInCsv below), a null
  // `code` on the table row itself (folded into teamsCodesNotInCsv, same as
  // before #176), and a code present in the CSV whose elo cell was blank or
  // malformed (counted in teamsCodeInCsvNoUsableElo below — this bucket did
  // NOT exist under #63; those rows were already left untouched, just
  // uncounted and unmarked). NOT the same rows as codesNotInTeams (a CSV
  // code with no matching public.teams row — nothing to preserve there,
  // there is no row) nor duplicateCodeConflicts (the code DID match the CSV,
  // just ambiguously — left alone, same as before).
  staleMarks: StaleMark[]
  // CSV codes with a parsed elo but no matching row in public.teams — a club
  // relegated out of the current season. Skipped, not inserted.
  codesNotInTeams: number
  // public.teams rows whose code has no entry anywhere in the CSV (or whose
  // code is null). Every row counted here is also queued in `staleMarks` —
  // see that field's own comment for why preserving (not nulling) is now the
  // only behaviour this job implements for it.
  teamsCodesNotInCsv: number
  // Ticket #176, NEW bucket. public.teams rows whose code WAS found in the
  // CSV, but the elo cell was blank or malformed this run — a different
  // reason from teamsCodesNotInCsv (the code matched fine; only the value
  // didn't), but given the identical preserve-and-mark-stale treatment. Under
  // #63 these rows were silently left alone with no counter at all; #176
  // makes that visible.
  teamsCodeInCsvNoUsableElo: number
  // A code shared by more than one public.teams row. Ambiguous — neither row
  // is updated (nor preserved-and-marked — the code matched the CSV fine;
  // only the table is at fault), and this is not the same bucket as
  // codesNotInTeams/teamsCodesNotInCsv since it's a fault in the table, not a
  // set mismatch.
  duplicateCodeConflicts: number
}

export function planTeamEloUpdates(existingTeams: TeamIdentityRow[], elo: EloByCodeResult): TeamEloUpdatePlan {
  const teamsByCode = new Map<number, TeamIdentityRow[]>()
  const staleMarks: StaleMark[] = []
  let teamsCodesNotInCsv = 0 // seeded below with null-code rows, then added to per-code below
  for (const team of existingTeams) {
    if (team.code === null) {
      teamsCodesNotInCsv++
      staleMarks.push({ id: team.id, alreadyStale: team.elo_stale_since !== null })
      continue
    }
    const existing = teamsByCode.get(team.code)
    if (existing) existing.push(team)
    else teamsByCode.set(team.code, [team])
  }

  const updates: Array<{ id: number; elo: number }> = []
  let codesNotInTeams = 0
  let duplicateCodeConflicts = 0
  let teamsCodeInCsvNoUsableElo = 0

  const allCodes = new Set<number>([...teamsByCode.keys(), ...elo.seenCodes])
  for (const code of allCodes) {
    const teams = teamsByCode.get(code) ?? []
    const inCsv = elo.seenCodes.has(code)

    if (teams.length === 0) {
      if (inCsv) codesNotInTeams++
      continue
    }
    if (!inCsv) {
      teamsCodesNotInCsv += teams.length
      for (const t of teams) staleMarks.push({ id: t.id, alreadyStale: t.elo_stale_since !== null })
      continue
    }
    if (teams.length > 1) {
      duplicateCodeConflicts++
      continue
    }
    const value = elo.eloByCode.get(code)
    if (value !== undefined) {
      updates.push({ id: teams[0].id, elo: value })
    } else {
      // code is in the CSV but its elo cell was blank or malformed — already
      // counted in elo.malformedElo above. Ticket #176: preserve the existing
      // rating (never null it) and queue it to be marked stale, same as an
      // absent code — a good stored rating survives a one-off source glitch,
      // visibly.
      teamsCodeInCsvNoUsableElo++
      staleMarks.push({ id: teams[0].id, alreadyStale: teams[0].elo_stale_since !== null })
    }
  }

  return { updates, staleMarks, codesNotInTeams, teamsCodesNotInCsv, teamsCodeInCsvNoUsableElo, duplicateCodeConflicts }
}

// One UPDATE per matched row, never an upsert — every id here was just read
// back from public.teams, so there is never a row to insert, only rows to
// leave alone or correct. `code`, `name`, `short_name`, `pulse_id` and every
// `strength_*` column are never referenced past this point.
//
// Ticket #176: also clears elo_stale_since back to NULL — a fresh CSV value
// arriving this run means the rating is current again, however long it was
// stale before.
async function applyTeamEloUpdates(
  supabase: SupabaseClient,
  updates: Array<{ id: number; elo: number }>
): Promise<number> {
  const updatedAt = new Date().toISOString()
  for (const update of updates) {
    const { error } = await supabase
      .from('teams')
      .update({ elo: update.elo, elo_stale_since: null, updated_at: updatedAt })
      .eq('id', update.id)
    if (error) {
      if (isMissingTable(error, 'teams')) {
        throw new IngestError('table "teams" does not exist — apply the #9 reference-schema migration first')
      }
      throw new IngestError(`update of teams.elo failed for team id ${update.id}: ${error.message}`)
    }
  }
  return updates.length
}

// Ticket #176, replacing #63's applyTeamEloNulls: one UPDATE per row this
// run cannot confirm a fresh elo for, setting elo_stale_since (never elo
// itself — the existing rating is PRESERVED, never nulled; see the file
// header for why). Rows already stale from an earlier run (`alreadyStale`)
// are skipped entirely — not re-written — so the timestamp records the
// MOMENT THE RATING FIRST WENT STALE, not the moment this job last checked.
// Returns the count of rows NEWLY marked this run (a subset of
// `staleMarks.length`, which is what job_runs.details reports as the total
// preserved-this-run count — see main()).
async function applyTeamEloStaleMarks(supabase: SupabaseClient, staleMarks: StaleMark[]): Promise<number> {
  const staleSince = new Date().toISOString()
  let newlyMarked = 0
  for (const mark of staleMarks) {
    if (mark.alreadyStale) continue
    const { error } = await supabase.from('teams').update({ elo_stale_since: staleSince }).eq('id', mark.id)
    if (error) {
      if (isMissingTable(error, 'teams')) {
        throw new IngestError('table "teams" does not exist — apply the #9 reference-schema migration first')
      }
      throw new IngestError(`marking teams.elo_stale_since failed for team id ${mark.id}: ${error.message}`)
    }
    newlyMarked++
  }
  return newlyMarked
}

// ============================================================================
// player_match_stats
// ============================================================================

// Exported (ticket #167) alongside toMatchStatRow so tallyOpponentResolution
// below is directly unit-testable on constructed rows.
export interface MatchStatRow {
  player_id: number
  player_code: number | null
  // Ticket #146: the FPL position code as it was in this ingested season,
  // from players.csv's own "position" column -- see buildElementTypeMap and
  // this file's header. NULL means the player_id had no resolvable position
  // in that season's players.csv, same "small, expected gap" treatment as
  // player_code above.
  element_type: number | null
  // Ticket #167: the player's OWN club code for this row, from players.csv's
  // own team_code column (already required, previously unread past
  // validation) -- see buildTeamCodeMap and this file's header. NULL means
  // the player_id had no resolvable team_code in that season's players.csv,
  // same "small, expected gap" treatment as player_code/element_type above.
  team_code: number | null
  // Ticket #167: the OTHER club named in match_id's slug, given team_code
  // above -- see resolveOpponentTeamCode. NULL means it could not be
  // resolved (a genuinely unrecognized club slug, or team_code itself
  // unresolved) -- counted and reported in job_runs.details, never guessed.
  opponent_team_code: number | null
  match_id: string
  competition: string
  season: string
  gameweek: number
  minutes_played: number | null
  goals: number | null
  assists: number | null
  xg: number | null
  xa: number | null
  xgot: number | null
  shots_on_target: number | null
  tackles: number | null
  tackles_won: number | null
  interceptions: number | null
  recoveries: number | null
  blocks: number | null
  clearances: number | null
  headed_clearances: number | null
  saves: number | null
  goals_conceded: number | null
  goals_prevented: number | null
  // Ticket #125: the team-level figure clean sheets must be read from --
  // goals_conceded above is a goalkeeper-only stat (74% populated on
  // goalkeeper rows, 1.1% on outfield rows) and must never be substituted
  // for this one. Same toInt() treatment as every other integer counting
  // stat in this row: an empty/missing cell maps to null, never 0 -- a row
  // this job has genuinely never observed a value for is a different fact
  // from "this team conceded zero goals in this match".
  team_goals_conceded: number | null
  updated_at: string
}

// ============================================================================
// Opponent resolution — ticket #167. See this file's header and the
// migration's own comment for the full "because"; this is the piece that
// turns a match_id slug + a player's own team_code into the OTHER club's
// team_code, or an honest, named reason it could not be done.
// ============================================================================

export interface OpponentResolution {
  opponentTeamCode: number | null
  // Set exactly when opponentTeamCode is null; one of a small, fixed set of
  // named strings (never a formatted/interpolated message — these are meant
  // to be tallied as job_runs.details keys, see
  // matchRowsOpponentUnresolvedByReason below).
  reason: string | null
}

/**
 * Resolves the opponent's team_code from a match_id slug, given the
 * player's own team_code and the season's club-slug -> team_code map (see
 * buildClubCodeBySlug).
 *
 * Calls parseMatchClubSlugs (scripts/lib/competition.ts) UNCAUGHT — a
 * genuine match_id SHAPE failure (no "-vs-" in the remainder — see that
 * function's own doc comment) propagates out of this function and, via
 * toMatchStatRow below, all the way to main()'s catch block, exactly like
 * parseCompetition's own UnknownCompetitionError does one call earlier.
 *
 * Every OTHER way this can fail to resolve an opponent is a semantic,
 * EXPECTED-to-happen gap (an unrecognized club name, a season whose
 * teams.csv has no fotmob_name at all — see buildClubCodeBySlug's own
 * header) — never thrown, always returned as a named `reason` and tallied
 * by the caller. This is the DoD's own "counted and reported, never
 * guessed" line: a slug this function cannot map onto exactly two known
 * clubs, or whose own-club match is ambiguous, gets a reason, not a guess.
 */
export function resolveOpponentTeamCode(
  matchId: string,
  competition: CompetitionToken,
  ownTeamCode: number | null,
  codeBySlug: ReadonlyMap<string, number>
): OpponentResolution {
  const clubSlugs = parseMatchClubSlugs(matchId, competition)
  if (ownTeamCode === null) {
    return { opponentTeamCode: null, reason: 'own team_code not resolved from players.csv' }
  }
  const codeA = codeBySlug.get(clubSlugs[0]) ?? null
  const codeB = codeBySlug.get(clubSlugs[1]) ?? null
  if (codeA === null || codeB === null) {
    return { opponentTeamCode: null, reason: 'club slug not found among known team codes' }
  }
  if (codeA === ownTeamCode) return { opponentTeamCode: codeB, reason: null }
  if (codeB === ownTeamCode) return { opponentTeamCode: codeA, reason: null }
  return { opponentTeamCode: null, reason: "own team_code not found among the match_id's two club slugs" }
}

// Exported (ticket #125) so its null-vs-zero handling for team_goals_conceded
// is directly unit-testable — see ingest-core-insights.test.ts — the same
// reasoning buildEloByCode/planTeamEloUpdates above are exported for.
export function toMatchStatRow(
  record: Record<string, string>,
  season: string,
  gameweek: number,
  playerCodeByPlayerId: Map<number, number>,
  // Ticket #146. Defaulted to an empty map (not made required) so every
  // existing call site/test written before this ticket keeps writing
  // element_type: null without needing to pass one — the same reasoning
  // playerCodeByPlayerId itself would get if it were added today.
  elementTypeByPlayerId: Map<number, number> = new Map(),
  // Ticket #167. Same "defaulted, not required" reasoning as
  // elementTypeByPlayerId above — every existing 4- and 5-argument call site
  // keeps writing team_code/opponent_team_code: null without changes.
  teamCodeByPlayerId: Map<number, number> = new Map(),
  codeBySlug: ReadonlyMap<string, number> = new Map()
): MatchStatRow | null {
  const playerId = toInt(record.player_id)
  const matchId = record.match_id?.trim()
  if (playerId === null || !matchId) return null
  // Throws UnknownCompetitionError on a token outside the known list — see
  // this file's header and scripts/lib/competition.ts. Deliberately NOT
  // caught here: it must propagate out of the per-row loop in
  // upsertPlayerMatchStats and all the way to main()'s catch block, so an
  // unrecognized competition fails the whole run rather than skipping one row.
  const competition = parseCompetition(matchId)
  const teamCode = teamCodeByPlayerId.get(playerId) ?? null
  // resolveOpponentTeamCode calls parseMatchClubSlugs uncaught too (see its
  // own doc comment) — same propagate-to-main() treatment as
  // parseCompetition immediately above.
  const { opponentTeamCode } = resolveOpponentTeamCode(matchId, competition, teamCode, codeBySlug)
  return {
    player_id: playerId,
    player_code: playerCodeByPlayerId.get(playerId) ?? null,
    element_type: elementTypeByPlayerId.get(playerId) ?? null,
    team_code: teamCode,
    opponent_team_code: opponentTeamCode,
    match_id: matchId,
    competition,
    season,
    gameweek,
    minutes_played: toInt(record.minutes_played),
    goals: toInt(record.goals),
    assists: toInt(record.assists),
    xg: toNumeric(record.xg),
    xa: toNumeric(record.xa),
    xgot: toNumeric(record.xgot),
    shots_on_target: toInt(record.shots_on_target),
    tackles: toInt(record.tackles),
    tackles_won: toInt(record.tackles_won),
    interceptions: toInt(record.interceptions),
    recoveries: toInt(record.recoveries),
    blocks: toInt(record.blocks),
    clearances: toInt(record.clearances),
    headed_clearances: toInt(record.headed_clearances),
    saves: toInt(record.saves),
    goals_conceded: toInt(record.goals_conceded),
    goals_prevented: toNumeric(record.goals_prevented),
    team_goals_conceded: toInt(record.team_goals_conceded),
    updated_at: new Date().toISOString(),
  }
}

interface PlayerMatchStatsUpsertResult {
  written: number
  // Rows written whose player_id had no entry in the season's players.csv
  // (ticket #22) — written with player_code left null, never skipped over
  // this. Reported in the run's job_runs row so the gap is visible.
  missingPlayerCode: number
  // Rows written whose competition parsed successfully (ticket #54). In
  // practice this always equals `written`: parseCompetition() either
  // returns a token or throws, and a throw aborts the whole run before any
  // row from this file is upserted (see toMatchStatRow). Computed
  // defensively, the same way missingPlayerCode is above, rather than
  // assumed equal to `written` by construction.
  withCompetition: number
  // Rows written carrying a non-null team_goals_conceded (ticket #125).
  // Unlike withCompetition above, this is NOT expected to equal `written`
  // on every run: a source row with a genuinely blank cell writes null
  // (see toMatchStatRow), so this count only reaches `written` once every
  // row this job has ever seen has a real value for the column — the DoD's
  // own "must equal rows written once a full re-ingest has run" is a
  // statement about the source data being complete, not about this job's
  // logic.
  withTeamGoalsConceded: number
  // Rows written carrying a non-null element_type (ticket #146). Same
  // "not expected to equal `written` until every player_id this job has ever
  // seen has a resolvable position" caveat as withTeamGoalsConceded above.
  withElementType: number
  // Rows written carrying a non-null team_code (ticket #167). Same
  // "small, expected gap" caveat as withElementType above — this uses the
  // exact same players.csv source column.
  withTeamCode: number
  // Rows written carrying a non-null opponent_team_code (ticket #167). NOT
  // expected to equal `written` for every season — see buildClubCodeBySlug's
  // header (a season whose teams.csv has no fotmob_name at all, like
  // 2026-2027 as observed 31 Aug 2026, resolves 0 of these by construction,
  // not by a bug in this job).
  withOpponentTeamCode: number
  // Named reason -> count, for every row whose opponent_team_code is null
  // (ticket #167's own "counted and reported, never guessed" requirement).
  // Keys are the fixed set of strings resolveOpponentTeamCode returns —
  // never a formatted message — so this object's keys are stable across runs
  // and safe to read programmatically. Sums to written - withOpponentTeamCode.
  opponentUnresolvedByReason: Record<string, number>
  // Ticket #176. Rows written whose opponent_team_code resolved via a club
  // slug that came from the name/short_name fallback rather than
  // fotmob_name — a subset of withOpponentTeamCode above, never exceeding it.
  withOpponentTeamCodeViaFallback: number
}

export interface OpponentResolutionTally {
  withOpponentTeamCode: number
  opponentUnresolvedByReason: Record<string, number>
}

/**
 * Reconciliation tally over an already-built batch of MatchStatRow's own
 * opponent_team_code column: how many resolved, and — for the rest — a
 * named-reason breakdown (ticket #167's own "counted and reported, never
 * guessed" requirement). By construction, withOpponentTeamCode + the sum of
 * every value in opponentUnresolvedByReason always equals rows.length: every
 * row falls into the resolved branch or exactly one reason bucket, never
 * both, never neither.
 *
 * resolveOpponentTeamCode is recomputed here (cheap, pure, deterministic)
 * rather than threaded out of toMatchStatRow's own return value, which only
 * carries the columns actually upserted. This never re-triggers a shape
 * throw: every row here already came back successfully from toMatchStatRow,
 * which means parseMatchClubSlugs already succeeded for its match_id (see
 * resolveOpponentTeamCode's own doc comment for why a shape failure
 * propagates before a row ever reaches this point).
 */
export function tallyOpponentResolution(rows: readonly MatchStatRow[], codeBySlug: ReadonlyMap<string, number>): OpponentResolutionTally {
  const withOpponentTeamCode = rows.filter((r) => r.opponent_team_code !== null).length
  const opponentUnresolvedByReason: Record<string, number> = {}
  for (const row of rows) {
    if (row.opponent_team_code !== null) continue
    const { reason } = resolveOpponentTeamCode(row.match_id, row.competition as CompetitionToken, row.team_code, codeBySlug)
    const key = reason ?? 'unknown'
    opponentUnresolvedByReason[key] = (opponentUnresolvedByReason[key] ?? 0) + 1
  }
  return { withOpponentTeamCode, opponentUnresolvedByReason }
}

/**
 * Ticket #176's own new counter: among an already-built batch of
 * MatchStatRow's own opponent_team_code column, how many resolved via a club
 * slug that came from the name/short_name fallback (buildClubCodeBySlug)
 * rather than fotmob_name. A strict subset of tallyOpponentResolution's own
 * `withOpponentTeamCode` — every row counted here is also counted there
 * (never the reverse) — which is the reconciliation this counter is checked
 * against, both in tests and in job_runs.details.
 *
 * Recomputes the match's two club slugs the same way tallyOpponentResolution
 * does above (cheap, pure, deterministic, and every row here already parsed
 * successfully via toMatchStatRow — see that function's own doc comment for
 * why this never re-triggers a shape throw).
 */
export function countOpponentsResolvedViaFallback(
  rows: readonly MatchStatRow[],
  codeBySlug: ReadonlyMap<string, number>,
  slugSource: ReadonlyMap<string, ClubSlugSource>
): number {
  let count = 0
  for (const row of rows) {
    if (row.opponent_team_code === null) continue
    const clubSlugs = parseMatchClubSlugs(row.match_id, row.competition as CompetitionToken)
    const opponentSlug = clubSlugs.find((slug) => codeBySlug.get(slug) === row.opponent_team_code)
    if (opponentSlug !== undefined && slugSource.get(opponentSlug) === 'name_or_short_name_fallback') {
      count++
    }
  }
  return count
}

async function upsertPlayerMatchStats(
  supabase: SupabaseClient,
  url: string,
  season: string,
  gameweek: number,
  records: Array<Record<string, string>>,
  playerCodeByPlayerId: Map<number, number>,
  elementTypeByPlayerId: Map<number, number>,
  teamCodeByPlayerId: Map<number, number>,
  codeBySlug: ReadonlyMap<string, number>,
  slugSource: ReadonlyMap<string, ClubSlugSource>
): Promise<PlayerMatchStatsUpsertResult> {
  const rows: MatchStatRow[] = []
  let skipped = 0
  for (const record of records) {
    const row = toMatchStatRow(record, season, gameweek, playerCodeByPlayerId, elementTypeByPlayerId, teamCodeByPlayerId, codeBySlug)
    if (row) {
      rows.push(row)
    } else {
      skipped++
    }
  }
  if (skipped > 0) {
    console.warn(`${JOB_NAME}: skipped ${skipped} row(s) in ${url} missing player_id or match_id`)
  }
  const missingPlayerCode = rows.filter((r) => r.player_code === null).length
  const withCompetition = rows.filter((r) => r.competition !== null && r.competition !== undefined && r.competition !== '').length
  const withTeamGoalsConceded = rows.filter((r) => r.team_goals_conceded !== null).length
  const withElementType = rows.filter((r) => r.element_type !== null).length
  const withTeamCode = rows.filter((r) => r.team_code !== null).length
  const { withOpponentTeamCode, opponentUnresolvedByReason } = tallyOpponentResolution(rows, codeBySlug)
  const withOpponentTeamCodeViaFallback = countOpponentsResolvedViaFallback(rows, codeBySlug, slugSource)
  if (rows.length === 0) {
    return {
      written: 0,
      missingPlayerCode: 0,
      withCompetition: 0,
      withTeamGoalsConceded: 0,
      withElementType: 0,
      withTeamCode: 0,
      withOpponentTeamCode: 0,
      opponentUnresolvedByReason: {},
      withOpponentTeamCodeViaFallback: 0,
    }
  }

  const { error } = await supabase.from('player_match_stats').upsert(rows, { onConflict: 'player_id,match_id' })
  if (error) {
    if (isMissingTable(error, 'player_match_stats')) {
      throw new IngestError(`table "player_match_stats" does not exist — apply ${PLAYER_MATCH_STATS_MIGRATION} first`)
    }
    throw new IngestError(`upsert into player_match_stats failed for ${url}: ${error.message}`)
  }
  return {
    written: rows.length,
    missingPlayerCode,
    withCompetition,
    withTeamGoalsConceded,
    withElementType,
    withTeamCode,
    withOpponentTeamCode,
    opponentUnresolvedByReason,
    withOpponentTeamCodeViaFallback,
  }
}

// ============================================================================
// player_code map — ticket #22. Built once per run from the same season's
// players.csv already fetched for logPlayerIdAlignmentNote(). player_code
// entries that fail to parse as an integer are skipped (not mapped), same as
// any other malformed numeric field in this file; the columns are already
// validated present by PLAYERS_REQUIRED_COLUMNS before this is called.
// ============================================================================

function buildPlayerCodeMap(playerRecords: Array<Record<string, string>>): Map<number, number> {
  const map = new Map<number, number>()
  for (const record of playerRecords) {
    const playerId = toInt(record.player_id)
    const playerCode = toInt(record.player_code)
    if (playerId !== null && playerCode !== null) {
      map.set(playerId, playerCode)
    }
  }
  return map
}

// ============================================================================
// element_type map — ticket #146. Same shape and same players.csv source as
// buildPlayerCodeMap above, mapping player_id -> the plain FPL position code
// (1 = goalkeeper, 2 = defender, 3 = midfielder, 4 = forward — matching
// src/lib/scoring/types.ts) instead of player_code. See this file's header
// for why the live public.players table is never used for this.
// ============================================================================

/**
 * Every position word FPL-Core-Insights is known to publish in players.csv's
 * "position" column, verified directly against the source on 28 Aug 2026
 * (data/2025-2026/players.csv). Values, never keys, are the plain FPL
 * position code every other module in this repo already uses.
 */
const POSITION_TO_ELEMENT_TYPE: Readonly<Record<string, number>> = Object.freeze({
  Goalkeeper: 1,
  Defender: 2,
  Midfielder: 3,
  Forward: 4,
})

export class UnknownPositionError extends Error {
  playerId: number
  position: string
  constructor(playerId: number, position: string) {
    super(
      `unrecognized position "${position}" for player_id ${playerId} in players.csv — expected one of ` +
        `${Object.keys(POSITION_TO_ELEMENT_TYPE).join(', ')}. This is a new or unexpected position at the ` +
        'source and must be mapped deliberately, not defaulted past.',
    )
    this.name = 'UnknownPositionError'
    this.playerId = playerId
    this.position = position
  }
}

/**
 * Throws UnknownPositionError — never defaults to a guessed position, never
 * writes it as-is — on a non-blank position cell outside POSITION_TO_ELEMENT_TYPE,
 * the same "fail loudly on a schema change" philosophy scripts/lib/competition.ts's
 * parseCompetition() applies to match_id. A genuinely BLANK cell is not an
 * error: the player_id is simply left out of the map (same "small, expected
 * gap" treatment buildPlayerCodeMap gives an unparseable player_code).
 */
export function buildElementTypeMap(playerRecords: Array<Record<string, string>>): Map<number, number> {
  const map = new Map<number, number>()
  for (const record of playerRecords) {
    const playerId = toInt(record.player_id)
    if (playerId === null) continue
    const position = (record.position ?? '').trim()
    if (position === '') continue
    const elementType = POSITION_TO_ELEMENT_TYPE[position]
    if (elementType === undefined) {
      throw new UnknownPositionError(playerId, position)
    }
    map.set(playerId, elementType)
  }
  return map
}

// ============================================================================
// team_code map — ticket #167. Same shape and same players.csv source as
// buildPlayerCodeMap/buildElementTypeMap above, mapping player_id -> the
// player's OWN club's stable team_code, read from players.csv's own
// team_code column (already required by PLAYERS_REQUIRED_COLUMNS, previously
// unread past that validation). "Small, expected gap" treatment, same as
// buildPlayerCodeMap: a row whose team_code cell does not parse is simply
// left out of the map, never an error.
// ============================================================================

export function buildTeamCodeMap(playerRecords: Array<Record<string, string>>): Map<number, number> {
  const map = new Map<number, number>()
  for (const record of playerRecords) {
    const playerId = toInt(record.player_id)
    const teamCode = toInt(record.team_code)
    if (playerId !== null && teamCode !== null) {
      map.set(playerId, teamCode)
    }
  }
  return map
}

// ============================================================================
// player_gameweek_history — ticket #248. Per-gameweek price/bonus/BPS history, from a DIFFERENT
// source file than player_match_stats above: playerstats.csv, one row per player per GAMEWEEK,
// covering full past seasons (this is what unblocks a future season replay — G19 — and full-scale
// bonus/BPS validation — G3 — neither of which gameweek_live_stats/ticket #224 can do, since that
// table's source endpoint serves the CURRENT season only).
//
// ID RESOLUTION — same mechanism as player_match_stats.player_code, one section up.
// playerstats.csv's own "id" column is that season's own FPL element id (NOT a stable cross-season
// key — see the #12/#22 migration headers). It is resolved to player_code through the SAME
// playerCodeByPlayerId map already built from that season's players.csv (buildPlayerCodeMap) —
// no second map, no separate fetch. An id that does not resolve is skipped and counted by reason,
// never guessed (this ticket's own DoD): 'invalid_or_missing_id' (the cell itself did not parse as
// a number) or 'player_code_not_found' (it parsed, but that season's players.csv has no matching
// player_code — the identical "small, expected gap" shape as player_match_stats.player_code).
//
// now_cost — VERIFIED 17 Sept 2026, and NOT what the ticket text assumed. playerstats.csv's own
// now_cost column is already expressed in decimal million-pounds (e.g. "5.8" = £5.8m), NOT FPL's
// raw integer-tenths-of-a-million format that public.players.now_cost carries — cross-checked
// directly against a live bootstrap-static/ fetch the same day (the same player class of price
// reads as a plain integer there, e.g. 60 for £6.0m, never 6.0). This is a Tier 2 finding, not a
// guess: fetched both https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data/
// 2025-2026/playerstats.csv and .../2026-2027/playerstats.csv directly (29,978 and 2,583 data
// rows respectively) and confirmed now_cost's full observed range (3.7-15.1 and 3.9-15.5) is only
// sane as decimal millions, never as tenths. Stored here EXACTLY as the source provides it — no
// multiplication, no division, in either direction — see the column comment in the migration file
// for the consequence this has for a consumer joining against public.players.now_cost.
//
// NOT PER-GAMEWEEK DELTAS: bonus / bps / starts are CUMULATIVE SEASON-TO-DATE TOTALS as of this
// gameweek, NEVER this gameweek's own award — verified directly by tracing one player's rows
// across consecutive gameweeks (17 Sept 2026): starts rises exactly 1 per gameweek for a nailed
// starter, bonus and bps rise monotonically (bps can occasionally move by ±1 between gameweeks, a
// small post-hoc BPS correction FPL itself sometimes applies). This is the same season-cumulative
// semantics FPL's own bootstrap-static top-level element.bonus/element.bps/element.starts fields
// have — playerstats.csv is a per-gameweek SNAPSHOT of those cumulative figures, not a
// per-gameweek delta. A future consumer wanting a single gameweek's own bonus/bps/start MUST
// DIFFERENCE CONSECUTIVE ROWS for the same player_code — not attempted by this ticket (substrate
// only, no validation-report change). See the migration's own column comments (same warning,
// same wording) before writing that consumer.
//
// STORE-VERBATIM, NEVER GUESS, EXTENDED TO THE OTHER NUMERIC COLUMNS TOO. gw/now_cost/bonus/bps/
// starts were all observed fully populated across both ingested seasons (0 blanks in 29,978 +
// 2,583 rows) — but a row whose cell fails to parse anyway (a genuine, unobserved source anomaly)
// is skipped and counted under 'invalid_numeric_field' rather than writing a guessed value into a
// NOT NULL column. ep_next is the one column genuinely observed blank in real data (1 of 29,978
// rows) and is nullable here for exactly that reason — never a fabricated 0.
// ============================================================================

export interface PlayerGameweekHistoryRow {
  season: string
  gameweek: number
  player_code: number
  now_cost: number
  bonus: number
  bps: number
  starts: number
  ep_next: number | null
  updated_at: string
}

export interface PlayerStatsRowResult {
  row: PlayerGameweekHistoryRow | null
  // Set exactly when row is null — one of a small, fixed set of named strings (never a formatted
  // message), matching resolveOpponentTeamCode's own "counted and reported, never guessed" shape.
  skipReason: string | null
}

/**
 * Maps one playerstats.csv record to a player_gameweek_history row, or an explicit named skip
 * reason. PURE — no I/O, unit-testable on constructed records (see this file's header and the
 * section comment above for the full "because" behind every branch here).
 */
export function toPlayerGameweekHistoryRow(
  record: Record<string, string>,
  season: string,
  playerCodeByPlayerId: ReadonlyMap<number, number>
): PlayerStatsRowResult {
  const playerId = toInt(record.id)
  if (playerId === null) {
    return { row: null, skipReason: 'invalid_or_missing_id' }
  }
  const playerCode = playerCodeByPlayerId.get(playerId)
  if (playerCode === undefined) {
    return { row: null, skipReason: 'player_code_not_found' }
  }
  const gameweek = toInt(record.gw)
  const nowCost = toNumeric(record.now_cost) // verbatim — see section header, do not scale
  const bonus = toInt(record.bonus)
  const bps = toInt(record.bps)
  const starts = toInt(record.starts)
  if (gameweek === null || nowCost === null || bonus === null || bps === null || starts === null) {
    return { row: null, skipReason: 'invalid_numeric_field' }
  }
  return {
    row: {
      season,
      gameweek,
      player_code: playerCode,
      now_cost: nowCost,
      bonus,
      bps,
      starts,
      ep_next: toNumeric(record.ep_next), // nullable — see section header
      updated_at: new Date().toISOString(),
    },
    skipReason: null,
  }
}

export interface BuildPlayerGameweekHistoryRowsResult {
  rows: PlayerGameweekHistoryRow[]
  // Named reason -> count, summing to records.length - rows.length. Reported verbatim as
  // job_runs.details.playerStatsRowsUnresolvedByReason; the total is playerStatsRowsUnresolved.
  unresolvedByReason: Record<string, number>
}

export function buildPlayerGameweekHistoryRows(
  records: Array<Record<string, string>>,
  season: string,
  playerCodeByPlayerId: ReadonlyMap<number, number>
): BuildPlayerGameweekHistoryRowsResult {
  const rows: PlayerGameweekHistoryRow[] = []
  const unresolvedByReason: Record<string, number> = {}
  for (const record of records) {
    const { row, skipReason } = toPlayerGameweekHistoryRow(record, season, playerCodeByPlayerId)
    if (row) {
      rows.push(row)
    } else if (skipReason) {
      unresolvedByReason[skipReason] = (unresolvedByReason[skipReason] ?? 0) + 1
    }
  }
  return { rows, unresolvedByReason }
}

// Batched upsert, keyed on the table's own primary key (season, gameweek, player_code) — the same
// key makes a re-run idempotent: an identical re-ingest recomputes byte-identical rows (see
// buildPlayerGameweekHistoryRows' determinism, proven in the test file) and overwrites the same
// primary-key rows in place rather than inserting duplicates, exactly like every other upsert in
// this file.
async function upsertPlayerGameweekHistory(supabase: SupabaseClient, rows: readonly PlayerGameweekHistoryRow[]): Promise<number> {
  for (let i = 0; i < rows.length; i += PLAYER_GAMEWEEK_HISTORY_UPSERT_BATCH_SIZE) {
    const batch = rows.slice(i, i + PLAYER_GAMEWEEK_HISTORY_UPSERT_BATCH_SIZE)
    const { error } = await supabase.from('player_gameweek_history').upsert(batch, { onConflict: 'season,gameweek,player_code' })
    if (error) {
      if (isMissingTable(error, 'player_gameweek_history')) {
        throw new IngestError(`table "player_gameweek_history" does not exist — apply ${PLAYER_GAMEWEEK_HISTORY_MIGRATION} first`)
      }
      throw new IngestError(`upsert into player_gameweek_history failed: ${error.message}`)
    }
  }
  return rows.length
}

// ============================================================================
// player_id alignment — informational only, per the ticket. Logged so it is
// visible in every run's output; never used to filter or drop rows. See the
// migration file's header comment and the ticket #12 Builder report for what
// this looked like against real fetched data.
// ============================================================================

function logPlayerIdAlignmentNote(playerRecords: Array<Record<string, string>>): void {
  console.log(
    `${JOB_NAME}: fetched ${playerRecords.length} player row(s) from players.csv. ` +
      'player_match_stats.player_id is stored as-is with no FK to players.id — FPL element ids ' +
      'are not stable across season boundaries (verified against real data; see the migration file header).'
  )
}

// ============================================================================
// main
// ============================================================================

async function main(): Promise<void> {
  const startedAt = new Date()
  const env = readSupabaseEnv()
  if (!env) {
    process.exit(1)
    return
  }
  const supabase = createClient(env.url, env.secretKey)
  const season = (process.env.CORE_INSIGHTS_SEASON ?? '').trim() || DEFAULT_SEASON

  try {
    const playersUrl = seasonRootUrl(season, 'players.csv')
    const playersResp = await fetchCsv(playersUrl)

    if (playersResp.status === 404) {
      const message =
        `${JOB_NAME}: season directory not found for season "${season}" (404 fetching ${playersUrl}). ` +
        'A not-yet-published season is a normal state, not a failure — nothing was written.'
      console.log(message)
      await recordJobRun(supabase, {
        status: 'skipped',
        message,
        details: {
          season,
          reason: 'season_directory_not_found',
          playersRows: 0,
          teamsUpdated: 0,
          teamsEloPreserved: 0,
          codesNotInTeams: 0,
          teamsCodesNotInCsv: 0,
          teamsCodeInCsvNoUsableElo: 0,
          duplicateCodeConflicts: 0,
          malformedEloRows: 0,
          gameweeksFound: 0,
          matchRowsWritten: 0,
          matchRowsWithoutPlayerCode: 0,
          matchRowsWithCompetition: 0,
          matchRowsWithTeamGoalsConceded: 0,
          matchRowsWithElementType: 0,
          matchRowsWithTeamCode: 0,
          matchRowsWithOpponentTeamCode: 0,
          matchRowsWithOpponentTeamCodeViaFallback: 0,
          matchRowsOpponentUnresolvedByReason: {},
          // Ticket #248.
          playerStatsRowsRead: 0,
          playerStatsRowsWritten: 0,
          playerStatsRowsUnresolved: 0,
          playerStatsRowsUnresolvedByReason: {},
        },
        startedAt,
      })
      return
    }
    if (playersResp.status !== 200) {
      throw new IngestError(`unexpected HTTP ${playersResp.status} fetching ${playersUrl}`)
    }

    const playerRecords = parseCsvRecords(playersResp.text, playersUrl, PLAYERS_REQUIRED_COLUMNS)
    logPlayerIdAlignmentNote(playerRecords)
    const playerCodeByPlayerId = buildPlayerCodeMap(playerRecords)
    // Throws UnknownPositionError on a position word outside
    // POSITION_TO_ELEMENT_TYPE — deliberately NOT caught here, same as
    // parseCompetition() elsewhere in this file; it propagates to this
    // function's own catch block below and fails the whole run (ticket #146).
    const elementTypeByPlayerId = buildElementTypeMap(playerRecords)
    // Ticket #167: the player's own club — see buildTeamCodeMap.
    const teamCodeByPlayerId = buildTeamCodeMap(playerRecords)

    // Ticket #248: per-gameweek price/bonus/BPS history, from playerstats.csv — a DIFFERENT
    // season-root file from players.csv/teams.csv above. Reuses playerCodeByPlayerId (just built
    // from this same season's players.csv) rather than a second id-resolution map. Non-200
    // (including 404) fails the run loudly, same treatment as teams.csv below — this file living
    // inside an already-published season directory (players.csv already succeeded, above) is a
    // different case from "season not published at all", which players.csv's own 404 branch
    // already handles.
    const playerStatsUrlStr = playerStatsUrl(season)
    const playerStatsResp = await fetchCsv(playerStatsUrlStr)
    if (playerStatsResp.status !== 200) {
      throw new IngestError(`unexpected HTTP ${playerStatsResp.status} fetching ${playerStatsUrlStr}`)
    }
    const playerStatsRecords = parseCsvRecords(playerStatsResp.text, playerStatsUrlStr, PLAYERSTATS_REQUIRED_COLUMNS)
    const playerStatsRowsRead = playerStatsRecords.length
    const playerGameweekHistoryResult = buildPlayerGameweekHistoryRows(playerStatsRecords, season, playerCodeByPlayerId)
    const playerStatsRowsUnresolvedByReason = playerGameweekHistoryResult.unresolvedByReason
    const playerStatsRowsUnresolved = Object.values(playerStatsRowsUnresolvedByReason).reduce((a, b) => a + b, 0)
    const playerStatsRowsWritten = await upsertPlayerGameweekHistory(supabase, playerGameweekHistoryResult.rows)
    // Reconciliation, checked, not just reported — same discipline #224's ingest job uses: every
    // row read must land in exactly one bucket, written or unresolved (by reason), never neither.
    if (playerStatsRowsWritten + playerStatsRowsUnresolved !== playerStatsRowsRead) {
      throw new IngestError(
        `playerstats.csv reconciliation failed for season ${season} — ${playerStatsRowsRead} row(s) read but ` +
          `${playerStatsRowsWritten} written + ${playerStatsRowsUnresolved} unresolved = ` +
          `${playerStatsRowsWritten + playerStatsRowsUnresolved}. This should be impossible.`
      )
    }

    const teamsUrl = seasonRootUrl(season, 'teams.csv')
    const teamsResp = await fetchCsv(teamsUrl)
    if (teamsResp.status !== 200) {
      throw new IngestError(`unexpected HTTP ${teamsResp.status} fetching ${teamsUrl}`)
    }
    const teamRecords = parseCsvRecords(teamsResp.text, teamsUrl, TEAMS_REQUIRED_COLUMNS)
    const eloResult = buildEloByCode(teamRecords)
    // Ticket #167: club-name slug -> team_code, off this same teams.csv's
    // fotmob_name column — see buildClubCodeBySlug's own header for why a
    // season whose teams.csv has no fotmob_name at all (2026-2027, as
    // observed 31 Aug 2026) resolves zero opponents by construction, not a bug.
    const clubCodeBySlugResult = buildClubCodeBySlug(teamRecords)
    if (clubCodeBySlugResult.duplicateSlugs > 0) {
      console.warn(
        `${JOB_NAME}: ${clubCodeBySlugResult.duplicateSlugs} club slug(s) matched more than one ` +
          'team code in teams.csv — left out of the opponent-resolution map rather than guessing which was meant'
      )
    }
    const existingTeams = await fetchTeamIdentities(supabase)
    const teamEloPlan = planTeamEloUpdates(existingTeams, eloResult)
    const teamsUpdated = await applyTeamEloUpdates(supabase, teamEloPlan.updates)
    // Ticket #176: preserve, never null — see applyTeamEloStaleMarks and the
    // file header. teamsEloPreserved is the total count of rows this run
    // could not confirm a fresh rating for (reported in job_runs.details);
    // applyTeamEloStaleMarks's own return value is the smaller subset newly
    // marked stale THIS run (rows already stale from an earlier run are left
    // untouched so their original stale-since moment survives).
    const teamsEloPreserved = teamEloPlan.staleMarks.length
    await applyTeamEloStaleMarks(supabase, teamEloPlan.staleMarks)
    if (teamEloPlan.duplicateCodeConflicts > 0) {
      console.warn(
        `${JOB_NAME}: ${teamEloPlan.duplicateCodeConflicts} team code(s) matched more than one ` +
          'public.teams row — left unchanged rather than guessing which row was meant'
      )
    }

    let gameweeksFound = 0
    let matchRowsWritten = 0
    let matchRowsWithoutPlayerCode = 0
    let matchRowsWithCompetition = 0
    let matchRowsWithTeamGoalsConceded = 0
    let matchRowsWithElementType = 0
    let matchRowsWithTeamCode = 0
    let matchRowsWithOpponentTeamCode = 0
    let matchRowsWithOpponentTeamCodeViaFallback = 0
    const matchRowsOpponentUnresolvedByReason: Record<string, number> = {}
    for (let gw = 1; gw <= MAX_GAMEWEEKS; gw++) {
      const url = gameweekUrl(season, gw)
      const resp = await fetchCsv(url)
      if (resp.status === 404) {
        break
      }
      if (resp.status !== 200) {
        throw new IngestError(`unexpected HTTP ${resp.status} fetching ${url}`)
      }
      gameweeksFound++
      const records = parseCsvRecords(resp.text, url, MATCH_STATS_REQUIRED_COLUMNS)
      if (records.length === 0) {
        console.log(`${JOB_NAME}: GW${gw} playermatchstats.csv has no rows yet (season ${season}) — skipping`)
        continue
      }
      // upsertPlayerMatchStats -> toMatchStatRow -> parseCompetition() /
      // parseMatchClubSlugs() throw UnknownCompetitionError /
      // UnknownMatchSlugError on an unrecognized shape, which is
      // deliberately NOT caught here — it propagates to this function's own
      // try/catch below, failing the whole run loudly rather than skipping
      // the offending gameweek file. See scripts/lib/competition.ts.
      const result = await upsertPlayerMatchStats(
        supabase,
        url,
        season,
        gw,
        records,
        playerCodeByPlayerId,
        elementTypeByPlayerId,
        teamCodeByPlayerId,
        clubCodeBySlugResult.codeBySlug,
        clubCodeBySlugResult.slugSource
      )
      matchRowsWritten += result.written
      matchRowsWithoutPlayerCode += result.missingPlayerCode
      matchRowsWithCompetition += result.withCompetition
      matchRowsWithTeamGoalsConceded += result.withTeamGoalsConceded
      matchRowsWithElementType += result.withElementType
      matchRowsWithTeamCode += result.withTeamCode
      matchRowsWithOpponentTeamCode += result.withOpponentTeamCode
      matchRowsWithOpponentTeamCodeViaFallback += result.withOpponentTeamCodeViaFallback
      for (const [reason, count] of Object.entries(result.opponentUnresolvedByReason)) {
        matchRowsOpponentUnresolvedByReason[reason] = (matchRowsOpponentUnresolvedByReason[reason] ?? 0) + count
      }
    }

    const message =
      `${JOB_NAME}: season ${season} — ${teamsUpdated} team(s) updated (elo, matched on code), ` +
      `${teamEloPlan.codesNotInTeams} CSV code(s) not in public.teams, ` +
      `${teamsEloPreserved} public.teams row(s) preserved rather than nulled ` +
      `(${teamEloPlan.teamsCodesNotInCsv} with no matching CSV code, ` +
      `${teamEloPlan.teamsCodeInCsvNoUsableElo} with a blank/malformed elo cell — ticket #176, replacing #63's nulling), ` +
      `${teamEloPlan.duplicateCodeConflicts} duplicate-code conflict(s), ` +
      `${eloResult.malformedElo} row(s) with a malformed elo cell skipped, ` +
      `${clubCodeBySlugResult.blankFotmobName} team(s) with a blank fotmob_name ` +
      `(${clubCodeBySlugResult.fallbackSlugsResolved} resolved via the name/short_name fallback, ` +
      `${clubCodeBySlugResult.fallbackSlugUnresolvable} unresolvable — ticket #176), ` +
      `${clubCodeBySlugResult.duplicateSlugs} duplicate club-slug conflict(s), ` +
      `${gameweeksFound} gameweek file(s) found, ${matchRowsWritten} player_match_stats row(s) upserted ` +
      `(${matchRowsWithoutPlayerCode} without a matching player_code in players.csv, ` +
      `${matchRowsWithCompetition} carrying a non-null competition, ` +
      `${matchRowsWithTeamGoalsConceded} carrying a non-null team_goals_conceded, ` +
      `${matchRowsWithElementType} carrying a non-null element_type, ` +
      `${matchRowsWithTeamCode} carrying a non-null team_code, ` +
      `${matchRowsWithOpponentTeamCode} carrying a non-null opponent_team_code, ` +
      `${matchRowsWithOpponentTeamCodeViaFallback} of those resolved via the name/short_name fallback), ` +
      `${playerStatsRowsRead} playerstats.csv row(s) read, ${playerStatsRowsWritten} player_gameweek_history row(s) upserted, ` +
      `${playerStatsRowsUnresolved} unresolved (ticket #248)`
    console.log(message)
    await recordJobRun(supabase, {
      status: 'success',
      message,
      details: {
        season,
        playersRows: playerRecords.length,
        teamsUpdated,
        teamsEloPreserved,
        codesNotInTeams: teamEloPlan.codesNotInTeams,
        teamsCodesNotInCsv: teamEloPlan.teamsCodesNotInCsv,
        teamsCodeInCsvNoUsableElo: teamEloPlan.teamsCodeInCsvNoUsableElo,
        duplicateCodeConflicts: teamEloPlan.duplicateCodeConflicts,
        malformedEloRows: eloResult.malformedElo,
        blankFotmobNameRows: clubCodeBySlugResult.blankFotmobName,
        fallbackSlugsResolved: clubCodeBySlugResult.fallbackSlugsResolved,
        fallbackSlugUnresolvable: clubCodeBySlugResult.fallbackSlugUnresolvable,
        duplicateClubSlugs: clubCodeBySlugResult.duplicateSlugs,
        gameweeksFound,
        matchRowsWritten,
        matchRowsWithoutPlayerCode,
        matchRowsWithCompetition,
        matchRowsWithTeamGoalsConceded,
        matchRowsWithElementType,
        matchRowsWithTeamCode,
        matchRowsWithOpponentTeamCode,
        matchRowsWithOpponentTeamCodeViaFallback,
        matchRowsOpponentUnresolvedByReason,
        // Ticket #248.
        playerStatsRowsRead,
        playerStatsRowsWritten,
        playerStatsRowsUnresolved,
        playerStatsRowsUnresolvedByReason,
      },
      startedAt,
    })
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: ${message}`)
    try {
      await recordJobRun(supabase, {
        status: 'failure',
        message: `${JOB_NAME}: ${message}`,
        details: { season },
        startedAt,
      })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}: additionally failed to record the failed job_runs row: ${recordMessage}`)
    }
    process.exit(1)
  }
}

// Guarded, matching scripts/sync-squad.ts: this file also exports its pure
// team-elo join functions (scripts/ingest-core-insights.test.ts, ticket #32)
// so they are unit-testable without a live Supabase project. Importing the
// module for that must not trigger a real run — only running it directly
// (`npx tsx scripts/ingest-core-insights.ts`) should.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected failure: ${message}`)
    process.exit(1)
  })
}
