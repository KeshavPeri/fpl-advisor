// Offline bonus-ALPHA full-season re-fit — ticket #253.
//
// ============================================================================
// WHY THIS IS A SEPARATE FILE FROM scripts/bonus-validation-report.ts.
// ============================================================================
// Ticket #253's own Definition of Done: "The fit itself runs offline against the two public
// FPL-Core-Insights CSVs (playerstats.csv and per-gameweek playermatchstats.csv), fetched directly
// — the same route #248 used. It must NOT read Supabase." bonus-validation-report.ts's main() is
// gated on SUPABASE_URL/SUPABASE_SECRET_KEY from its very first line (readSupabaseEnv(), matching
// every other scripts/*.ts job's convention) and its whole reason to exist is comparing against
// LIVE data. Splicing a "sometimes doesn't touch Supabase at all" mode into that same entry point
// would contradict its own established contract. This file is a genuinely separate concern: it
// makes ZERO Supabase calls, ZERO calls to any other scripts/*.ts job's main(), and reads exactly
// two kinds of network resource — FPL-Core-Insights' players.csv/playerstats.csv (season root) and
// its per-gameweek playermatchstats.csv — both fetched with the plain, unauthenticated `fetch()`
// scripts/ingest-core-insights.ts already uses for the identical files (ticket #248's "same route").
//
// This is a deviation from ticket #253's literal "Files you're expected to touch" list, which does
// not name a new script — flagged explicitly in the Builder report, because the "must not read
// Supabase" DoD item cannot be satisfied any other way without weakening
// bonus-validation-report.ts's own architecture.
//
// ============================================================================
// WHAT THIS RE-FITS, AND WHY THIS METHOD.
// ============================================================================
// `src/lib/projection/bonus.ts`'s ALPHA sharpens allocateFixtureBonus's share of a fixture's 6
// bonus points: `share_i = excess_i^ALPHA / sum_j(excess_j^ALPHA) * 6`. Ticket #237 fitted it on a
// single gameweek (2025/26... no — 2026/27 GW2, n=616) and scored it on GW3 (n=652) held out,
// because `gameweek_live_stats` (current-season-only) was the entire universe of real bonus/BPS
// data available at the time. `public.player_gameweek_history` (ticket #248) now carries real
// per-gameweek bonus/BPS for the COMPLETE 2025-2026 season (~29,978 player-gameweek rows) — a
// one-parameter fit on one gameweek, when 38 are available, should not ship.
//
// FIT on 2025-2026 gameweeks 1-28. SCORE on gameweeks 29-38, held out and never touched by the fit
// — see FIT_RANGE/HOLDOUT_RANGE and assertNoRangeOverlap below. The objective is IDENTICAL to
// #237's own: minimise the ABSOLUTE mean signed error on the top-20-projected-by-expected-points
// population, pooled across the fit range's gameweeks (never a mean of each gameweek's own mean —
// see bonus-validation-report.ts's own "Pooling across gameweeks" convention, reused here via
// poolGameweekReports, imported unmodified).
//
// ============================================================================
// PROJECTED BONUS IS RECONSTRUCTED POINT-IN-TIME — NEVER READ FROM player_projections.
// ============================================================================
// `player_projections` holds 2026/27 only; a past season's projected bonus does not exist anywhere
// in this repo and must be rebuilt from what was knowable strictly before each gameweek, following
// EXACTLY the pattern scripts/run-backtest.ts already established for the rest of the model (see
// that file's own header, "HOW A PROJECTION IS BUILT FROM CUMULATIVE TOTALS"):
//
//  - scripts/build-feature-history.ts's `buildFeatureHistory` (PURE, imported unmodified) turns a
//    season's raw per-match rows into DENSE, point-in-time `FeatureHistoryRow`s — one per
//    (player, gameweek), carrying that player's Premier League match totals STRICTLY BEFORE that
//    gameweek. This file feeds it `SourceMatchRow`s built directly from FPL-Core-Insights'
//    playermatchstats.csv (via scripts/ingest-core-insights.ts's own `toMatchStatRow`, imported
//    unmodified) instead of a `player_match_stats` Supabase read — the identical row shape, a
//    different (offline) source.
//  - scripts/run-backtest.ts's `projectRow`, `computePositionPriors`, `fallbackPositionPrior` and
//    `resolveRowPosition` (all PURE, imported unmodified) turn a `FeatureHistoryRow` into a full
//    point-in-time projection via `src/lib/projection/expectedPoints.ts`'s own combiner — the SAME
//    neutral-fixture, assumed-available, single-averaged-recent-match approximations run-backtest.ts
//    documents and uses for its own backtest, for the identical reason (no per-match fixture
//    difficulty, no daily-fitness signal, exists in this point-in-time reconstruction — see that
//    file's header for the full "because").
//  - `src/lib/projection/bonus.ts`'s `allocateFixtureBonus` (PURE, imported unmodified) then
//    allocates each REAL fixture's 6 bonus points across every player this reconstruction can place
//    in that match — grouped by playermatchstats.csv's own `match_id`, not by a synthetic
//    "gameweek fixture" the way run-backtest.ts's own multi-fixture approximation does. This file
//    has real per-match data, so it groups by the real match directly — MORE accurate than
//    run-backtest.ts's own "repeat one neutral fixture N times" approximation for a double
//    gameweek, and never needed here.
//
// Not a second projection path: every non-trivial piece above is an unmodified import from an
// existing, already-tested pure function. This file's own new code is CSV fetching/parsing, the
// fixture-grouping and alpha-search glue, and the falsification-gate/reproduction-check reporting.
//
// ============================================================================
// ACTUAL BONUS — differenced from playerstats.csv, never read as a raw cumulative total.
// ============================================================================
// playerstats.csv's own bonus/bps columns are SEASON-CUMULATIVE-TO-DATE snapshots, not a single
// gameweek's own award (verified by ticket #248 — tracing one player's rows across consecutive
// gameweeks found them monotonic). scripts/bonus-validation-report.ts's own
// `differenceCumulativeGameweekRows` (PURE, imported unmodified, ticket #253) recovers each
// gameweek's own value — a player's first row and any row immediately after a gap are treated as a
// fresh baseline, never guessed across a missing gameweek. `toPlayerGameweekHistoryRow`/
// `buildPlayerGameweekHistoryRows` (imported unmodified from scripts/ingest-core-insights.ts) parse
// playerstats.csv into the identical row shape that job stores.
//
// ============================================================================
// RANKING POPULATION HELD FIXED ACROSS THE ALPHA SEARCH.
// ============================================================================
// "Top 20 projected players by expected_points" (ticket #241's own population, "because that is
// the population the allocator actually moves") is computed ONCE per gameweek, at ALPHA = 1 (the
// value #241 measured against and the value this ticket is re-fitting away from) — never
// recomputed per candidate alpha. Recomputing it per alpha would make the fit's OWN population a
// moving target that itself depends on the parameter being searched, confounding the search with a
// second, uncontrolled effect. `expectedPoints` (bonus-exclusive from expectedPoints.ts) plus the
// alpha=1 bonus share is a fixed, one-time value per (gameweek, player); only `bonusPoints` itself
// varies with the candidate alpha in every downstream report.
//
// ============================================================================
// FALSIFICATION GATE AND REPRODUCTION CHECK — both printed, neither silently swallowed.
// ============================================================================
// Two gates (ticket #253's own text), both measured on HELD-OUT 2025-2026 gameweeks 29-38:
//   1. Top-20 |mean signed error| under the re-fitted ALPHA must be LOWER than under the currently
//      shipped ALPHA (imported from bonus.ts, never hardcoded) on the SAME held-out rows.
//   2. All-players mean signed error must stay within 0.020 in absolute terms; mean per-fixture
//      allocated total must stay above 5.70 (both are ticket #241's own existing guards).
// Reproduction check (2026-2027 GW2/GW3, ALPHA = 1, no Supabase, no actual data needed — this only
// re-derives the PROJECTED side): the reconstructed top-20 mean projected bonus must land within
// 0.02 of #241's own published 0.338 (GW2) / 0.334 (GW3). A failure here means the reconstruction
// itself disagrees with the live pipeline it is supposed to mirror, and this script STOPS (non-zero
// exit) rather than reporting a fit built on a broken foundation — ticket #253's own instruction.
//
// ============================================================================
// Run by hand: `npx tsx scripts/fit-bonus-alpha.ts`. NOT wired into any scheduled workflow — same
// "run by hand, deliberately" convention as scripts/run-backtest.ts (this reads a whole season over
// the network, ~44 HTTP requests). Prints its findings to stdout; writes nothing anywhere (no
// Supabase, no file) — the fitted ALPHA is applied to src/lib/projection/bonus.ts BY HAND once this
// script's output has been read, exactly like teamStrength.ts's SCALE precedent that file's own
// comment already describes.

import { parse } from 'csv-parse/sync'
import type { Position } from '../src/lib/scoring/types.ts'
import { PREMIER_LEAGUE_COMPETITION } from './lib/competition.ts'
import { buildFeatureHistory, type SourceMatchRow } from './build-feature-history.ts'
import { computePositionPriors, fallbackPositionPrior, projectRow, resolveRowPosition, type PositionPrior } from './run-backtest.ts'
import { buildElementTypeMap, buildPlayerGameweekHistoryRows, buildTeamCodeMap, toMatchStatRow, type MatchStatRow } from './ingest-core-insights.ts'
import { ALPHA as SHIPPED_ALPHA, allocateFixtureBonus, type FixtureBonusEntry } from '../src/lib/projection/bonus.ts'
import {
  buildGameweekBonusReport,
  differenceCumulativeGameweekRows,
  poolGameweekReports,
  topByExpectedPoints,
  TOP_N_PROJECTED,
  type ActualLiveStatRow,
  type GameweekBonusReport,
  type RawProjectedRow,
} from './bonus-validation-report.ts'

const JOB_NAME = 'fit-bonus-alpha'
const SOURCE_BASE_URL = 'https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data'

/** The full past season this ticket re-fits ALPHA against — the only season with complete (38-gameweek) player_gameweek_history/playerstats.csv coverage as of this ticket. */
export const FIT_SEASON = '2025-2026'
export const FIT_SEASON_GAMEWEEKS = 38

export interface GameweekRange {
  start: number
  end: number
}

/** Ticket #253 text verbatim: fit on gameweeks 1-28. Gameweek 1 carries no fit signal in practice (every player's prior_matches is 0 within this reconstruction, exactly like #241's own GW1 finding for the live pipeline — see bonus.ts's ALPHA doc comment) but is included per the ticket's own range, not specially excluded. */
export const FIT_RANGE: GameweekRange = { start: 1, end: 28 }
/** Ticket #253 text verbatim: score on gameweeks 29-38, held out and never touched by the fit. */
export const HOLDOUT_RANGE: GameweekRange = { start: 29, end: 38 }

/**
 * Throws if two gameweek ranges overlap — the fit/holdout split's own DoD-required guarantee
 * ("fit/holdout split never overlaps"). Pure, unit-tested directly (fit-bonus-alpha.test.ts) and
 * also called for real in main() below, against the actual FIT_RANGE/HOLDOUT_RANGE constants —
 * not just a decorative check on hardcoded test fixtures.
 */
export function assertNoRangeOverlap(a: GameweekRange, b: GameweekRange): void {
  const overlaps = a.start <= b.end && b.start <= a.end
  if (overlaps) {
    throw new FitBonusAlphaError(
      `fit range [${a.start}, ${a.end}] and holdout range [${b.start}, ${b.end}] overlap — they must be disjoint`,
    )
  }
}

export function gameweeksInRange(range: GameweekRange): number[] {
  const out: number[] = []
  for (let gw = range.start; gw <= range.end; gw++) out.push(gw)
  return out
}

/** The reproduction-check season/gameweeks and #241's own published top-20 mean PROJECTED bonus figures for them (docs/projection-model-backlog.md G3 table, ticket #253's own falsification text). */
export const REPRODUCTION_SEASON = '2026-2027'
export const REPRODUCTION_GAMEWEEKS: readonly number[] = [2, 3]
export const REPRODUCTION_PUBLISHED_TOP20_MEAN_PROJECTED: Readonly<Record<number, number>> = { 2: 0.338, 3: 0.334 }
export const REPRODUCTION_TOLERANCE = 0.02

/** Ticket #241's own existing guards, unchanged by this ticket — see that ticket's own falsification gate. */
export const OVERALL_SIGNED_ERROR_GUARD = 0.02
export const FIXTURE_ALLOCATION_MEAN_GUARD = 5.7

/** Grid-search resolution for the ALPHA fit — a systematic, deterministic, reproducible sweep (never a hand-picked candidate list), matching the "a real query against live data, never invented" precedent bonus.ts's own ALPHA comment already sets for this fit. */
export const ALPHA_GRID_MIN = 0.05
export const ALPHA_GRID_MAX = 6.0
export const ALPHA_GRID_STEP = 0.01

export class FitBonusAlphaError extends Error {}

// ============================================================================
// Fetching and CSV parsing — mirrors scripts/ingest-core-insights.ts's own fetchCsv/parseCsvRecords
// exactly (that file's own versions are not exported, so this is the one deliberate duplication —
// a handful of mechanical lines, not a scoring/projection rule; see CLAUDE.md's own carve-out for a
// small, four-line helper).
// ============================================================================

async function fetchCsv(url: string): Promise<{ status: number; text: string }> {
  let response: Response
  try {
    response = await fetch(url)
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new FitBonusAlphaError(`could not reach ${url}: ${message}`)
  }
  const text = await response.text()
  return { status: response.status, text }
}

function parseCsvRecords(text: string, url: string): Array<Record<string, string>> {
  try {
    return parse(text, { columns: true, skip_empty_lines: true, trim: true }) as Array<Record<string, string>>
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    throw new FitBonusAlphaError(`${url} exists but does not parse as CSV: ${message}`)
  }
}

function toInt(value: string | undefined): number | null {
  if (value === undefined) return null
  const trimmed = value.trim()
  if (trimmed === '') return null
  const n = Number(trimmed)
  return Number.isFinite(n) ? Math.trunc(n) : null
}

function seasonRootUrl(season: string, file: string): string {
  return `${SOURCE_BASE_URL}/${encodeURIComponent(season)}/${file}`
}

function gameweekUrl(season: string, gameweek: number): string {
  return `${SOURCE_BASE_URL}/${encodeURIComponent(season)}/By%20Gameweek/GW${gameweek}/playermatchstats.csv`
}

/** Mirrors scripts/ingest-core-insights.ts's own (unexported) buildPlayerCodeMap exactly — see the fetching/parsing comment above for why this one small map is duplicated rather than imported. */
function buildPlayerCodeMap(playerRecords: Array<Record<string, string>>): Map<number, number> {
  const map = new Map<number, number>()
  for (const record of playerRecords) {
    const playerId = toInt(record.player_id)
    const playerCode = toInt(record.player_code)
    if (playerId !== null && playerCode !== null) map.set(playerId, playerCode)
  }
  return map
}

// ============================================================================
// Season fetch — players.csv (id/code/position/team_code maps) + every gameweek's
// playermatchstats.csv. No teams.csv, no elo, no opponent resolution: this reconstruction always
// uses a neutral fixture (see file header), so opponent identity is never read.
// ============================================================================

interface SeasonPlayerMaps {
  playerCodeByPlayerId: Map<number, number>
  elementTypeByPlayerId: Map<number, number>
  teamCodeByPlayerId: Map<number, number>
}

async function fetchSeasonPlayerMaps(season: string): Promise<SeasonPlayerMaps> {
  const url = seasonRootUrl(season, 'players.csv')
  const resp = await fetchCsv(url)
  if (resp.status !== 200) throw new FitBonusAlphaError(`unexpected HTTP ${resp.status} fetching ${url}`)
  const records = parseCsvRecords(resp.text, url)
  return {
    playerCodeByPlayerId: buildPlayerCodeMap(records),
    elementTypeByPlayerId: buildElementTypeMap(records),
    teamCodeByPlayerId: buildTeamCodeMap(records),
  }
}

async function fetchSeasonMatchStats(season: string, gameweeks: readonly number[], maps: SeasonPlayerMaps): Promise<Map<number, MatchStatRow[]>> {
  const byGameweek = new Map<number, MatchStatRow[]>()
  const emptyCodeBySlug = new Map<string, number>()
  for (const gw of gameweeks) {
    const url = gameweekUrl(season, gw)
    const resp = await fetchCsv(url)
    if (resp.status === 404) {
      byGameweek.set(gw, [])
      continue
    }
    if (resp.status !== 200) throw new FitBonusAlphaError(`unexpected HTTP ${resp.status} fetching ${url}`)
    const records = parseCsvRecords(resp.text, url)
    const rows: MatchStatRow[] = []
    for (const record of records) {
      const row = toMatchStatRow(record, season, gw, maps.playerCodeByPlayerId, maps.elementTypeByPlayerId, maps.teamCodeByPlayerId, emptyCodeBySlug)
      if (row) rows.push(row)
    }
    byGameweek.set(gw, rows)
    console.log(`${JOB_NAME}: ${season} GW${gw}: ${rows.length} playermatchstats.csv row(s) parsed.`)
  }
  return byGameweek
}

function toSourceMatchRow(row: MatchStatRow): SourceMatchRow {
  return {
    player_code: row.player_code,
    element_type: row.element_type,
    team_code: row.team_code,
    competition: row.competition,
    gameweek: row.gameweek,
    minutes_played: row.minutes_played,
    xg: row.xg,
    xa: row.xa,
    saves: row.saves,
    clearances: row.clearances,
    blocks: row.blocks,
    interceptions: row.interceptions,
    tackles: row.tackles,
    recoveries: row.recoveries,
    team_goals_conceded: row.team_goals_conceded,
  }
}

// ============================================================================
// Position resolution — one lookup per player_code, built once from whichever feature-history row
// carries a resolved position (element_type is a season-constant per player, from
// buildFeatureHistory's own resolveElementType — see that file). resolveRowPosition is imported
// unmodified from run-backtest.ts; the empty fallback map is deliberate (element_type is virtually
// always resolved here, since it came from THIS SAME season's players.csv — the `players`-table
// fallback resolveRowPosition otherwise supports has no meaning offline).
// ============================================================================

const EMPTY_CODE_TO_POSITION: ReadonlyMap<number, Position> = new Map()

function buildPlayerCodeToPosition(featureHistoryRows: readonly { player_code: number; element_type: number | null }[]): Map<number, Position> {
  const map = new Map<number, Position>()
  for (const row of featureHistoryRows) {
    if (map.has(row.player_code)) continue
    const resolution = resolveRowPosition(row, EMPTY_CODE_TO_POSITION)
    if (resolution.position !== undefined) map.set(row.player_code, resolution.position)
  }
  return map
}

// ============================================================================
// Per-gameweek reconstruction — PURE given its inputs (no network, no Supabase). Groups every
// contributing player-fixture by the REAL match_id (not a synthetic per-gameweek fixture), and
// carries each player's ALPHA-INDEPENDENT expectedEvents/expectedPoints so the alpha search below
// only ever recomputes the cheap, pure allocateFixtureBonus step per candidate alpha.
// ============================================================================

export interface GameweekProjectionData {
  /** Real match_id -> every player projected for it this gameweek (both clubs). */
  entriesByMatchId: Map<string, FixtureBonusEntry<number>[]>
  /** player_code -> expectedPoints summed across this gameweek's fixtures, BONUS-EXCLUSIVE (expectedPoints.ts's own components.bonusPoints is always 0) — the base ticket #241's own ranking value is built from. */
  expectedPointsByCode: Map<number, number>
  /** player_code -> the numeric fixture id(s) (one per real match_id, stably assigned) he was projected for this gameweek — 2+ marks a double gameweek, excluded from the per-fixture reconstruction by buildGameweekBonusReport itself, unmodified. */
  fixtureIdsByCode: Map<number, number[]>
  unresolvedPosition: number
  missingFeatureRow: number
}

function buildGameweekProjectionData(
  gameweekId: number,
  matchStatRows: readonly MatchStatRow[],
  featureIndex: ReadonlyMap<string, Parameters<typeof projectRow>[0]>,
  playerCodeToPosition: ReadonlyMap<number, Position>,
  positionPriors: ReadonlyMap<string, PositionPrior>,
  matchIdToNumericId: Map<string, number>,
): GameweekProjectionData {
  const entriesByMatchId = new Map<string, FixtureBonusEntry<number>[]>()
  const expectedPointsByCode = new Map<number, number>()
  const fixtureIdsByCode = new Map<number, number[]>()
  let unresolvedPosition = 0
  let missingFeatureRow = 0

  for (const row of matchStatRows) {
    if (row.competition !== PREMIER_LEAGUE_COMPETITION || row.player_code === null) continue
    const playerCode = row.player_code
    const position = playerCodeToPosition.get(playerCode)
    if (position === undefined) {
      unresolvedPosition++
      continue
    }
    const featureRow = featureIndex.get(`${playerCode}:${gameweekId}`)
    if (!featureRow) {
      missingFeatureRow++
      continue
    }
    const prior = positionPriors.get(`${gameweekId}:${position}`) ?? fallbackPositionPrior(position)
    const projection = projectRow(featureRow, position, prior, 1)
    const events = projection.fixtures[0].expectedEvents

    const entries = entriesByMatchId.get(row.match_id) ?? []
    entries.push({ id: playerCode, position, events })
    entriesByMatchId.set(row.match_id, entries)

    expectedPointsByCode.set(playerCode, (expectedPointsByCode.get(playerCode) ?? 0) + projection.expectedPoints)

    let numericId = matchIdToNumericId.get(row.match_id)
    if (numericId === undefined) {
      numericId = matchIdToNumericId.size + 1
      matchIdToNumericId.set(row.match_id, numericId)
    }
    const fixtureIds = fixtureIdsByCode.get(playerCode) ?? []
    fixtureIds.push(numericId)
    fixtureIdsByCode.set(playerCode, fixtureIds)
  }

  return { entriesByMatchId, expectedPointsByCode, fixtureIdsByCode, unresolvedPosition, missingFeatureRow }
}

/** The fixed, ALPHA=1 ranking population for a gameweek — see file header, "RANKING POPULATION HELD FIXED". */
function buildFixedRankingExpectedPoints(data: GameweekProjectionData): Map<number, number> {
  const bonusAtAlpha1 = new Map<number, number>()
  for (const entries of data.entriesByMatchId.values()) {
    for (const result of allocateFixtureBonus(entries, 1)) {
      bonusAtAlpha1.set(result.id, (bonusAtAlpha1.get(result.id) ?? 0) + result.bonusPoints)
    }
  }
  const out = new Map<number, number>()
  for (const [code, basePoints] of data.expectedPointsByCode) {
    out.set(code, basePoints + (bonusAtAlpha1.get(code) ?? 0))
  }
  return out
}

/** Every player's bonus share for one gameweek at a given alpha — the only piece of buildRawProjectedRows that actually varies with the candidate alpha; everything else in `data` is reused unchanged. */
function bonusByCodeAtAlpha(data: GameweekProjectionData, alpha: number): Map<number, number> {
  const bonusByCode = new Map<number, number>()
  for (const entries of data.entriesByMatchId.values()) {
    for (const result of allocateFixtureBonus(entries, alpha)) {
      bonusByCode.set(result.id, (bonusByCode.get(result.id) ?? 0) + result.bonusPoints)
    }
  }
  return bonusByCode
}

function buildRawProjectedRows(data: GameweekProjectionData, rankingExpectedPoints: ReadonlyMap<number, number>, alpha: number): RawProjectedRow[] {
  const bonusByCode = bonusByCodeAtAlpha(data, alpha)
  const rows: RawProjectedRow[] = []
  for (const [code, expectedPoints] of rankingExpectedPoints) {
    const bonus = bonusByCode.get(code) ?? 0
    const fixtureIds = data.fixtureIdsByCode.get(code) ?? []
    rows.push({ playerCode: code, expectedPoints, components: { points: { bonusPoints: bonus }, fixtures: fixtureIds.map((fixtureId) => ({ fixtureId })) } })
  }
  return rows
}

// ============================================================================
// Season-level bundle + alpha search.
// ============================================================================

export interface GameweekComputationBundle {
  gameweekId: number
  data: GameweekProjectionData
  rankingExpectedPoints: Map<number, number>
  actual: ActualLiveStatRow[]
}

function buildReportsAtAlpha(bundles: readonly GameweekComputationBundle[], alpha: number): GameweekBonusReport[] {
  return bundles.map((b) => buildGameweekBonusReport(b.gameweekId, buildRawProjectedRows(b.data, b.rankingExpectedPoints, alpha), b.actual))
}

/** |pooled top-20 mean signed error| at a candidate alpha, over the FIT bundles — the objective this ticket's own text specifies (identical to #237's). Infinity (never NaN, never a false "good" score) when nothing is measurable at all. */
function fitObjective(fitBundles: readonly GameweekComputationBundle[], alpha: number): number {
  const pooled = poolGameweekReports(buildReportsAtAlpha(fitBundles, alpha))
  return pooled.top20.meanSignedError === null ? Number.POSITIVE_INFINITY : Math.abs(pooled.top20.meanSignedError)
}

export interface AlphaSearchResult {
  alpha: number
  objective: number
}

/** Deterministic grid search — see ALPHA_GRID_MIN/MAX/STEP's own comment for why a systematic sweep, not a hand-picked candidate list or a gradient method the objective's kinks (clamping, ties) could mislead. */
function gridSearchAlpha(fitBundles: readonly GameweekComputationBundle[], min: number, max: number, step: number): AlphaSearchResult {
  let best: AlphaSearchResult = { alpha: min, objective: Number.POSITIVE_INFINITY }
  const steps = Math.round((max - min) / step)
  for (let i = 0; i <= steps; i++) {
    const alpha = Math.round((min + i * step) * 1000) / 1000
    const objective = fitObjective(fitBundles, alpha)
    if (objective < best.objective) best = { alpha, objective }
  }
  return best
}

/** Mean projected bonus over the top-N-by-expectedPoints population — no actual data needed, used only by the reproduction check (which compares against #241's own PUBLISHED PROJECTED figure, not an actual). */
function computeTopNMeanProjectedBonus(rankingExpectedPoints: ReadonlyMap<number, number>, bonusByCode: ReadonlyMap<number, number>, n: number): number | null {
  const rows = [...rankingExpectedPoints.entries()].map(([playerCode, expectedPoints]) => ({
    playerCode,
    expectedPoints,
    projectedBonus: bonusByCode.get(playerCode) ?? 0,
  }))
  const top = topByExpectedPoints(rows, n)
  if (top.length === 0) return null
  return top.reduce((sum, r) => sum + r.projectedBonus, 0) / top.length
}

// ============================================================================
// Main — the only place any network call happens.
// ============================================================================

function fmt(n: number | null | undefined, digits = 4): string {
  return n === null || n === undefined ? 'n/a' : n.toFixed(digits)
}

async function buildSeasonBundles(
  season: string,
  gameweeks: readonly number[],
): Promise<{ bundles: GameweekComputationBundle[]; lastGameweekInData: number; playersCovered: number }> {
  const maps = await fetchSeasonPlayerMaps(season)
  const matchStatsByGameweek = await fetchSeasonMatchStats(season, gameweeks, maps)

  const sourceRows: SourceMatchRow[] = []
  for (const rows of matchStatsByGameweek.values()) for (const row of rows) sourceRows.push(toSourceMatchRow(row))

  const featureHistoryResult = buildFeatureHistory(sourceRows, season, new Date().toISOString())
  console.log(
    `${JOB_NAME}: ${season} feature-history reconstruction: ${featureHistoryResult.rows.length} row(s) across ` +
      `${featureHistoryResult.playersCovered} player(s), through gameweek ${featureHistoryResult.lastGameweekInData}.`,
  )

  const featureIndex = new Map<string, (typeof featureHistoryResult.rows)[number]>()
  for (const row of featureHistoryResult.rows) featureIndex.set(`${row.player_code}:${row.gameweek_id}`, row)

  const playerCodeToPosition = buildPlayerCodeToPosition(featureHistoryResult.rows)
  const positionPriors = computePositionPriors(featureHistoryResult.rows, (code) => playerCodeToPosition.get(code))

  const matchIdToNumericId = new Map<string, number>()
  const bundles: GameweekComputationBundle[] = []
  let totalUnresolvedPosition = 0
  let totalMissingFeatureRow = 0
  for (const gw of gameweeks) {
    if (gw < 2) continue // gameweek 1 of any season carries no prior_* evidence at all — see FIT_RANGE's own comment
    const data = buildGameweekProjectionData(gw, matchStatsByGameweek.get(gw) ?? [], featureIndex, playerCodeToPosition, positionPriors, matchIdToNumericId)
    totalUnresolvedPosition += data.unresolvedPosition
    totalMissingFeatureRow += data.missingFeatureRow
    bundles.push({ gameweekId: gw, data, rankingExpectedPoints: buildFixedRankingExpectedPoints(data), actual: [] })
  }
  console.log(
    `${JOB_NAME}: ${season} reconstruction excluded ${totalUnresolvedPosition} player-fixture row(s) with an unresolved position ` +
      `and ${totalMissingFeatureRow} with no feature-history row (both expected to be 0 or near it).`,
  )

  return { bundles, lastGameweekInData: featureHistoryResult.lastGameweekInData, playersCovered: featureHistoryResult.playersCovered }
}

async function attachActualBonus(season: string, maps: SeasonPlayerMaps, bundles: GameweekComputationBundle[]): Promise<void> {
  const url = seasonRootUrl(season, 'playerstats.csv')
  const resp = await fetchCsv(url)
  if (resp.status !== 200) throw new FitBonusAlphaError(`unexpected HTTP ${resp.status} fetching ${url}`)
  const records = parseCsvRecords(resp.text, url)
  const { rows: cumulativeRows, unresolvedByReason } = buildPlayerGameweekHistoryRows(records, season, maps.playerCodeByPlayerId)
  console.log(
    `${JOB_NAME}: ${season} playerstats.csv: ${records.length} row(s) read, ${cumulativeRows.length} resolved to player_code, ` +
      `unresolved: ${JSON.stringify(unresolvedByReason)}.`,
  )
  const differenced = differenceCumulativeGameweekRows(
    cumulativeRows.map((r) => ({ playerCode: r.player_code, gameweek: r.gameweek, bonus: r.bonus, bps: r.bps })),
  )
  const actualByGameweek = new Map<number, ActualLiveStatRow[]>()
  for (const row of differenced) {
    const list = actualByGameweek.get(row.gameweek) ?? []
    list.push({ playerCode: row.playerCode, bonus: row.bonus, bps: row.bps })
    actualByGameweek.set(row.gameweek, list)
  }
  for (const bundle of bundles) bundle.actual = actualByGameweek.get(bundle.gameweekId) ?? []
}

async function main(): Promise<void> {
  assertNoRangeOverlap(FIT_RANGE, HOLDOUT_RANGE)
  console.log(`${JOB_NAME}: fit range gw${FIT_RANGE.start}-${FIT_RANGE.end}, holdout range gw${HOLDOUT_RANGE.start}-${HOLDOUT_RANGE.end} (no overlap, asserted).`)
  console.log(`${JOB_NAME}: fetching ${FIT_SEASON} from FPL-Core-Insights (players.csv, playerstats.csv, ${FIT_SEASON_GAMEWEEKS} gameweeks of playermatchstats.csv)...`)

  const fitSeasonMaps = await fetchSeasonPlayerMaps(FIT_SEASON)
  const { bundles, lastGameweekInData } = await buildSeasonBundles(FIT_SEASON, gameweeksInRange({ start: 1, end: FIT_SEASON_GAMEWEEKS }))
  await attachActualBonus(FIT_SEASON, fitSeasonMaps, bundles)

  const fitBundles = bundles.filter((b) => b.gameweekId >= FIT_RANGE.start && b.gameweekId <= FIT_RANGE.end)
  const holdoutBundles = bundles.filter((b) => b.gameweekId >= HOLDOUT_RANGE.start && b.gameweekId <= HOLDOUT_RANGE.end)
  console.log(
    `${JOB_NAME}: ${FIT_SEASON} last gameweek in data: ${lastGameweekInData}. Fit bundles: ${fitBundles.length} gameweek(s). ` +
      `Holdout bundles: ${holdoutBundles.length} gameweek(s).`,
  )
  if (lastGameweekInData < HOLDOUT_RANGE.end) {
    console.warn(
      `${JOB_NAME}: WARNING — ${FIT_SEASON} data only reaches gameweek ${lastGameweekInData}, short of the holdout range's own ` +
        `end (${HOLDOUT_RANGE.end}). Every figure below reflects however much data was actually available; nothing is padded or guessed.`,
    )
  }

  // --------------------------------------------------------------------
  // Falsification gate, "before": the CURRENTLY SHIPPED alpha (imported, never hardcoded), on the
  // held-out range.
  // --------------------------------------------------------------------
  const beforeHoldoutPooled = poolGameweekReports(buildReportsAtAlpha(holdoutBundles, SHIPPED_ALPHA))

  // --------------------------------------------------------------------
  // The fit itself.
  // --------------------------------------------------------------------
  console.log(`${JOB_NAME}: grid-searching ALPHA over [${ALPHA_GRID_MIN}, ${ALPHA_GRID_MAX}] step ${ALPHA_GRID_STEP}, minimising |top-20 pooled mean signed error| on the FIT range...`)
  const best = gridSearchAlpha(fitBundles, ALPHA_GRID_MIN, ALPHA_GRID_MAX, ALPHA_GRID_STEP)
  const fitPooledAtFittedAlpha = poolGameweekReports(buildReportsAtAlpha(fitBundles, best.alpha))
  const afterHoldoutPooled = poolGameweekReports(buildReportsAtAlpha(holdoutBundles, best.alpha))

  const beforeAbs = beforeHoldoutPooled.top20.meanSignedError === null ? null : Math.abs(beforeHoldoutPooled.top20.meanSignedError)
  const afterAbs = afterHoldoutPooled.top20.meanSignedError === null ? null : Math.abs(afterHoldoutPooled.top20.meanSignedError)
  const gate1Pass = beforeAbs !== null && afterAbs !== null && afterAbs < beforeAbs
  const overallGuardPass = afterHoldoutPooled.overall.meanSignedError !== null && Math.abs(afterHoldoutPooled.overall.meanSignedError) <= OVERALL_SIGNED_ERROR_GUARD
  const fixtureGuardPass = afterHoldoutPooled.fixtureAllocation.meanAllocatedTotal !== null && afterHoldoutPooled.fixtureAllocation.meanAllocatedTotal > FIXTURE_ALLOCATION_MEAN_GUARD

  console.log('')
  console.log(`=== FIT (gw${FIT_RANGE.start}-${FIT_RANGE.end}, ${FIT_SEASON}) ===`)
  console.log(`Fitted ALPHA = ${best.alpha} (fit-range |top-20 pooled mean signed error| = ${fmt(best.objective)}, n=${fitPooledAtFittedAlpha.top20.sampleSize})`)
  console.log(`Fit-range top-20: mean projected ${fmt(fitPooledAtFittedAlpha.top20.meanProjectedBonus)}, mean actual ${fmt(fitPooledAtFittedAlpha.top20.meanActualBonus)}, signed error ${fmt(fitPooledAtFittedAlpha.top20.meanSignedError)}`)
  console.log(`Fit-range all-players: n=${fitPooledAtFittedAlpha.overall.sampleSize}, signed error ${fmt(fitPooledAtFittedAlpha.overall.meanSignedError)}`)

  console.log('')
  console.log(`=== FALSIFICATION GATE (held out, gw${HOLDOUT_RANGE.start}-${HOLDOUT_RANGE.end}, ${FIT_SEASON}) ===`)
  console.log(
    `Before (shipped ALPHA=${SHIPPED_ALPHA}): top-20 n=${beforeHoldoutPooled.top20.sampleSize}, mean projected ${fmt(beforeHoldoutPooled.top20.meanProjectedBonus)}, ` +
      `mean actual ${fmt(beforeHoldoutPooled.top20.meanActualBonus)}, signed error ${fmt(beforeHoldoutPooled.top20.meanSignedError)} (abs ${fmt(beforeAbs)})`,
  )
  console.log(
    `After  (fitted ALPHA=${best.alpha}): top-20 n=${afterHoldoutPooled.top20.sampleSize}, mean projected ${fmt(afterHoldoutPooled.top20.meanProjectedBonus)}, ` +
      `mean actual ${fmt(afterHoldoutPooled.top20.meanActualBonus)}, signed error ${fmt(afterHoldoutPooled.top20.meanSignedError)} (abs ${fmt(afterAbs)})`,
  )
  console.log(`Gate 1 — |after| < |before|: ${gate1Pass ? 'PASS' : 'FAIL'}`)
  console.log(
    `Gate 2a — all-players mean signed error within ±${OVERALL_SIGNED_ERROR_GUARD}: ${fmt(afterHoldoutPooled.overall.meanSignedError)} ` +
      `(n=${afterHoldoutPooled.overall.sampleSize}) -> ${overallGuardPass ? 'PASS' : 'FAIL'}`,
  )
  console.log(
    `Gate 2b — mean per-fixture allocated total above ${FIXTURE_ALLOCATION_MEAN_GUARD}: ${fmt(afterHoldoutPooled.fixtureAllocation.meanAllocatedTotal)} ` +
      `(${afterHoldoutPooled.fixtureAllocation.fixturesMeasured} fixture(s), ${afterHoldoutPooled.fixtureAllocation.clampedPlayerFixtureCount} clamped) -> ${fixtureGuardPass ? 'PASS' : 'FAIL'}`,
  )

  // --------------------------------------------------------------------
  // Reproduction check — 2026-2027 GW2/GW3, ALPHA = 1, no actual data needed. Runs regardless of
  // the fit-gate outcome (both are reported), but a failure here means STOP — see file header.
  // --------------------------------------------------------------------
  console.log('')
  console.log(`=== REPRODUCTION CHECK (${REPRODUCTION_SEASON}, GW${REPRODUCTION_GAMEWEEKS.join('/GW')}, ALPHA=1) ===`)
  const { bundles: reproBundles } = await buildSeasonBundles(REPRODUCTION_SEASON, REPRODUCTION_GAMEWEEKS)
  let reproductionOk = true
  for (const gw of REPRODUCTION_GAMEWEEKS) {
    const bundle = reproBundles.find((b) => b.gameweekId === gw)
    const bonusAtAlpha1 = bundle ? bonusByCodeAtAlpha(bundle.data, 1) : new Map<number, number>()
    const meanTop20 = bundle ? computeTopNMeanProjectedBonus(bundle.rankingExpectedPoints, bonusAtAlpha1, TOP_N_PROJECTED) : null
    const published = REPRODUCTION_PUBLISHED_TOP20_MEAN_PROJECTED[gw]
    const diff = meanTop20 === null ? null : Math.abs(meanTop20 - published)
    const withinTolerance = diff !== null && diff <= REPRODUCTION_TOLERANCE
    if (!withinTolerance) reproductionOk = false
    console.log(`GW${gw}: reconstructed top-20 mean projected bonus = ${fmt(meanTop20)}, published (#241) = ${published}, |diff| = ${fmt(diff)} -> ${withinTolerance ? 'WITHIN TOLERANCE' : 'OUT OF TOLERANCE'}`)
  }

  console.log('')
  if (!reproductionOk) {
    console.error(
      `${JOB_NAME}: REPRODUCTION CHECK FAILED — per ticket #253's own instruction, STOPPING rather than shipping a fit built on a ` +
        'reconstruction that does not reproduce the live pipeline it is meant to mirror. Report this back as a blocker.',
    )
    process.exitCode = 1
    return
  }
  console.log(`${JOB_NAME}: reproduction check passed — the point-in-time reconstruction is trustworthy.`)

  console.log('')
  console.log('=== SUMMARY ===')
  console.log(`Previous ALPHA: ${SHIPPED_ALPHA} (ticket #237, fitted on a single gameweek — 2026/27 GW2, n=616 — scored on GW3, n=652, held out)`)
  console.log(`Fitted ALPHA: ${best.alpha} (ticket #253, fitted on ${FIT_SEASON} gw${FIT_RANGE.start}-${FIT_RANGE.end}, n=${fitPooledAtFittedAlpha.top20.sampleSize} top-20 rows / ${fitPooledAtFittedAlpha.overall.sampleSize} all-players rows; scored on gw${HOLDOUT_RANGE.start}-${HOLDOUT_RANGE.end}, n=${afterHoldoutPooled.top20.sampleSize} top-20 rows / ${afterHoldoutPooled.overall.sampleSize} all-players rows, held out)`)
  console.log(`Falsification gate: ${gate1Pass && overallGuardPass && fixtureGuardPass ? 'ALL PASS' : 'AT LEAST ONE FAILED — see above'}`)
}

const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
