/**
 * Point-in-time team strength — ticket #175's construction, moved here by
 * ticket #229 so the live projection (expectedPoints.ts) and the backtest
 * (scripts/run-backtest.ts) share exactly ONE copy. Originally written and
 * calibrated inside scripts/run-backtest.ts; nothing about the arithmetic
 * changed in the move, only its address. Pure, no I/O: every function here
 * takes already-fetched rows/records, never reads Supabase itself.
 *
 * WHY THIS EXISTS (ticket #229). `teams.elo` on live data has been frozen
 * for the whole of 2026/27 — `data/2026-2027/teams.csv` publishes an empty
 * `elo` cell for all twenty clubs, and `api.clubelo.com` itself returns 502
 * with no sign of recovering. Every established club is still carrying its
 * 2025/26 rating (ticket #176 preserves rather than nulls a stale value),
 * which flattens fixture difficulty into near-uniform noise — see
 * expectedPoints.ts's `resolveFixtureExpectedScore` for the precedence that
 * now falls back to THIS construction whenever elo cannot be trusted.
 *
 * WHAT IT IS. A team's point-in-time strength is (goals scored - goals
 * conceded) per prior match, built ONLY from `player_match_stats` rows
 * strictly before the row being projected (see `computeTeamStrengthAsOf`'s
 * own "lookahead guard" comment — the most important property here).
 * `computeFixtureExpectedScore` turns two teams' strength records into an
 * expectedScore on the SAME [0, 1] scale `fixture.ts`'s elo formula
 * produces, via one calibrated free parameter, `SCALE` (see its own comment
 * for the exact calibration).
 */

// ============================================================================
// Ticket #175's own construction — see MIN_TEAM_PRIOR_MATCHES/NEUTRAL_EXPECTED_SCORE_VALUE/SCALE below.
// ============================================================================

/**
 * Ticket #175. A team's point-in-time strength needs at least this many
 * PRIOR matches (strictly before the row's own gameweek) on EACH side of a
 * fixture before expectedScore is computed from a real comparison — below
 * this, both teams fall back to NEUTRAL_EXPECTED_SCORE_VALUE (0.5), the same
 * "average fixture" every row used before this ticket. A single early match
 * is too noisy to base a fixture adjustment on (one red card or one own
 * goal swings a one-match average wildly). 3 is a JUDGEMENT call (ticket
 * text: "state the minimum as a judgement in the code comment"), not a
 * derived value — high enough to smooth a one-match outlier, low enough
 * that most of the season gets a real fixture signal rather than sitting at
 * the neutral fallback (every team has played its 3rd match by gameweek 4,
 * assuming no early postponement).
 */
export const MIN_TEAM_PRIOR_MATCHES = 3

/**
 * Ticket #175. The expectedScore value used whenever a fixture cannot be
 * given a real point-in-time strength comparison. Matches fixture.ts's own
 * "0.5 = a coin flip / an average fixture" convention exactly — the same
 * value DIFFICULTY_EXPECTED_SCORE[3] and an even elo matchup both resolve
 * to — never a different number invented for this fallback.
 */
export const NEUTRAL_EXPECTED_SCORE_VALUE = 0.5

/**
 * Ticket #175. The one free parameter in the point-in-time strength ->
 * expectedScore construction below (see computeFixtureExpectedScore):
 * `expectedScore = clamp(0.5 + (ownRate - opponentRate) / SCALE, 0, 1)`.
 *
 * CALIBRATED, NOT CHOSEN (ticket text) — set so the spread of the
 * expectedScore values this construction produces over the 2025-2026
 * measured population matches the spread of the elo-derived expectedScore
 * already stored in `player_projections.components` on live data:
 * `SCALE = stdDev(ownRate - opponentRate, over every resolvable fixture) /
 * stdDev(live elo-derived expectedScore)`.
 *
 * THE TWO OBSERVED DISTRIBUTIONS.
 *
 * Target (live elo-derived expectedScore, `player_projections.components`,
 * rows where `eloFallbackUsed` is false — i.e. a real elo comparison, never
 * the coarser 5-value FDR fallback): n = 3,181, mean = 0.5003,
 * population stdDev = 0.1701, min = 0.1238, max = 0.8762. Obtained by
 * Keshav running a hand, read-only query directly against Supabase — NOT an
 * in-run read from this job. This job has no Supabase access at all and
 * never will (confirmed); the DoD's original phrasing asking for "an in-run
 * read" was a specification error, not something to keep retrying via
 * credentials.
 *
 * This construction's own delta (`ownRate - opponentRate`), 2025-2026,
 * Premier League only, over every resolvable fixture with sufficient prior
 * history on both sides (MIN_TEAM_PRIOR_MATCHES): n = 698 (349 matches x 2
 * perspectives, mean exactly 0 by construction — every match contributes
 * +delta and -delta), population stdDev = 0.9564. Computed by reconstructing
 * player_match_stats from FPL-Core-Insights' own public per-gameweek CSVs
 * (no Supabase needed for this side — confirmed reachable) via a throwaway
 * script that reused this file's own buildTeamMatchRecords/
 * computeTeamStrengthAsOf/teamStrengthRate/fixtureHasSufficientHistory and
 * scripts/ingest-core-insights.ts's own buildClubCodeBySlug/
 * buildTeamCodeMap/toMatchStatRow UNMODIFIED, never re-derived — the
 * reconstruction's own row counts matched the ticket's stated population
 * exactly before this number was trusted (15,340 of 15,340 total rows;
 * 12,754 Premier League rows; 12,613 of 12,754 = 98.9% opponent_team_code
 * resolved). The script was run via `npx tsx`, never committed.
 *
 * SCALE = 0.9564 / 0.1701 = 5.6225.
 */
export const SCALE = 5.6225

/**
 * Ticket #229. `computeFixtureExpectedScore` has no home/away term of its
 * own — unlike `fixture.ts`'s elo formula, which folds `HOME_ADVANTAGE_ELO`
 * into the rating gap before the logistic curve. This is the exact
 * expected-score equivalent of `HOME_ADVANTAGE_ELO` AT PARITY (two teams of
 * identical strength): `expectedScore(eloFor, eloFor - HOME_ADVANTAGE_ELO,
 * true)` at parity reduces to `1 / (1 + 10 ** (-HOME_ADVANTAGE_ELO / 400)) =
 * 1 / (1 + 10 ** (-65 / 400))`, and this constant is that value minus the
 * neutral 0.5 baseline — the amount `computeFixtureExpectedScore`'s own
 * `homeAdjustment` parameter should ADD for the home side (and subtract for
 * the away side) to reproduce the same home advantage at parity. NOT a
 * chosen number — derived, not fitted (Tier 3, ticket text).
 *
 * `1 / (1 + 10 ** (-65 / 400)) - 0.5 = 0.0925` (to 4 d.p.). The ticket text
 * itself states this as "0.0927" — evaluating the ticket's own stated
 * formula gives 0.092466..., which rounds to 0.0925, not 0.0927. This is a
 * discrepancy in the ticket text's rounding, not in the formula; this
 * constant follows the formula (stated as authoritative: "derived...: 1 /
 * (1 + 10 ** (-65 / 400)) - 0.5"), not the rounded literal. Flagged in the
 * Builder's report rather than silently reconciled by fitting a different
 * formula to hit 0.0927 exactly.
 */
export const HOME_EXPECTED_SCORE_BONUS = 1 / (1 + 10 ** (-65 / 400)) - 0.5

/**
 * One `player_match_stats` row's fields needed to build the point-in-time
 * team-strength table — team_code (which club these particular stats
 * belong to), opponent_team_code (the club faced, so a team's opponent in
 * one match can be found without re-parsing match_id), and
 * team_goals_conceded (per-player-on-pitch, not a team total — see this
 * file's header on why the MAX across a team's players in one match is the
 * correct team figure, never the average or the first row found).
 */
export interface MatchStatsForTeamStrength {
  matchId: string
  gameweek: number
  teamCode: number | null
  opponentTeamCode: number | null
  teamGoalsConceded: number | null
}

/** One resolvable (team, match) outcome: this team's own goals conceded (the max across its players who appeared) and goals scored (the SAME match's opponent's own max-conceded figure — "the opponent's conceded figure for that same match", ticket text verbatim). */
export interface TeamMatchRecord {
  matchId: string
  gameweek: number
  teamCode: number
  goalsConceded: number
  goalsScored: number
}

interface TeamMatchAccumulator {
  matchId: string
  gameweek: number
  teamCode: number
  opponentTeamCode: number | null
  goalsConceded: number | null
}

/** Ignores a null side rather than treating it as 0 — a team's goals-conceded figure is "not yet seen a non-null row" until it genuinely has one, and 0 (a clean sheet) must never be indistinguishable from "unknown". */
function maxIgnoringNull(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

/**
 * One row per (matchId, teamCode) actually resolvable to BOTH a real
 * goals-conceded figure (max across that team's own players' rows) AND a
 * real goals-scored figure (the SAME match's opponent's own max-conceded
 * figure, found via opponent_team_code — never by re-parsing match_id) — a
 * match where either side is missing contributes NOTHING to the
 * point-in-time strength table (never a guessed 0), so a team's `matches`
 * count below reflects only genuinely known outcomes. Named tests: a normal
 * match, a match with a player substituted before a late goal, and a 0-0
 * (proving 0 is preserved, never treated as "unknown" and skipped).
 */
export function buildTeamMatchRecords(rows: readonly MatchStatsForTeamStrength[]): TeamMatchRecord[] {
  const byKey = new Map<string, TeamMatchAccumulator>()
  const keyOf = (matchId: string, teamCode: number): string => `${matchId}::${teamCode}`

  for (const row of rows) {
    if (row.teamCode === null) continue
    const key = keyOf(row.matchId, row.teamCode)
    const existing = byKey.get(key)
    byKey.set(key, {
      matchId: row.matchId,
      gameweek: row.gameweek,
      teamCode: row.teamCode,
      opponentTeamCode: existing?.opponentTeamCode ?? row.opponentTeamCode,
      goalsConceded: maxIgnoringNull(existing?.goalsConceded ?? null, row.teamGoalsConceded),
    })
  }

  const records: TeamMatchRecord[] = []
  for (const acc of byKey.values()) {
    if (acc.goalsConceded === null || acc.opponentTeamCode === null) continue
    const opponentAcc = byKey.get(keyOf(acc.matchId, acc.opponentTeamCode))
    if (opponentAcc === undefined || opponentAcc.goalsConceded === null) continue
    records.push({
      matchId: acc.matchId,
      gameweek: acc.gameweek,
      teamCode: acc.teamCode,
      goalsConceded: acc.goalsConceded,
      goalsScored: opponentAcc.goalsConceded,
    })
  }
  return records
}

/** A team's summed prior record as of one point in time — see computeTeamStrengthAsOf. */
export interface TeamStrengthRecord {
  matches: number
  goalsScored: number
  goalsConceded: number
}

/**
 * Sums every one of `teamCode`'s resolvable match records with gameweek
 * STRICTLY BEFORE `beforeGameweek` — THE LOOKAHEAD GUARD (ticket text: "the
 * most important test in the ticket"). A gameweek-N row must never see a
 * gameweek-N or later record; `r.gameweek < beforeGameweek`, never `<=`,
 * is the entire guard.
 */
export function computeTeamStrengthAsOf(records: readonly TeamMatchRecord[], teamCode: number, beforeGameweek: number): TeamStrengthRecord {
  const prior = records.filter((r) => r.teamCode === teamCode && r.gameweek < beforeGameweek)
  return {
    matches: prior.length,
    goalsScored: prior.reduce((sum, r) => sum + r.goalsScored, 0),
    goalsConceded: prior.reduce((sum, r) => sum + r.goalsConceded, 0),
  }
}

/** (goalsScored - goalsConceded) per prior match — 0 with no prior matches (never divides by zero; MIN_TEAM_PRIOR_MATCHES in computeFixtureExpectedScore is what actually decides whether this value is trusted). */
export function teamStrengthRate(record: TeamStrengthRecord): number {
  return record.matches > 0 ? (record.goalsScored - record.goalsConceded) / record.matches : 0
}

/** Whether computeFixtureExpectedScore would use a REAL point-in-time comparison for this pair (both teams meet MIN_TEAM_PRIOR_MATCHES) rather than the neutral fallback — the SAME gate that function applies internally, exposed separately so callers (the backtest's own report, and the live precedence in expectedPoints.ts) never invent a second, divergent rule. */
export function fixtureHasSufficientHistory(own: TeamStrengthRecord, opponent: TeamStrengthRecord): boolean {
  return own.matches >= MIN_TEAM_PRIOR_MATCHES && opponent.matches >= MIN_TEAM_PRIOR_MATCHES
}

function clampUnit(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * Ticket #175, extended by #229. The point-in-time analogue of fixture.ts's
 * elo-derived expectedScore, built from each team's (goalsScored -
 * goalsConceded) per prior match (see file header, "WHAT IT IS"). Falls
 * back to NEUTRAL_EXPECTED_SCORE_VALUE when either team has fewer than
 * MIN_TEAM_PRIOR_MATCHES resolvable prior matches — never a guessed
 * adjustment from thin evidence.
 *
 * `homeAdjustment` (ticket #229) — OPTIONAL, defaults to 0 so
 * scripts/run-backtest.ts's own calls (which pass no fourth argument: its
 * legs carry no venue, and must not start guessing one) are an EXACT no-op,
 * byte-identical to this function's behaviour before #229. The live
 * pipeline (expectedPoints.ts) passes `isHome ? HOME_EXPECTED_SCORE_BONUS :
 * -HOME_EXPECTED_SCORE_BONUS`. Applied to the delta BEFORE the [0, 1] clamp,
 * so a home-advantage push can still be clamped away at an extreme delta,
 * exactly like the base delta term is.
 *
 * Named tests: exactly 0.5 for two teams with identical prior records (the
 * delta cancels to 0 regardless of SCALE); clamped to [0, 1] for a lopsided
 * delta; the neutral fallback below the minimum; `homeAdjustment` defaults
 * to 0; a nonzero `homeAdjustment` shifts the result by exactly that amount
 * (pre-clamp).
 */
export function computeFixtureExpectedScore(
  own: TeamStrengthRecord,
  opponent: TeamStrengthRecord,
  scale: number,
  homeAdjustment = 0,
): number {
  if (!fixtureHasSufficientHistory(own, opponent)) return NEUTRAL_EXPECTED_SCORE_VALUE
  const delta = teamStrengthRate(own) - teamStrengthRate(opponent)
  return clampUnit(0.5 + delta / scale + homeAdjustment)
}

// ============================================================================
// Ticket #235 — build the record table from public.fixtures (real results),
// not from player_match_stats' match_id-derived opponent columns.
//
// WHY THIS EXISTS. `buildTeamMatchRecords` above depends on
// player_match_stats.opponent_team_code, which scripts/ingest-core-insights.ts
// resolves from FPL-Core-Insights' own `fotmob_name` club-slug column.
// `data/2026-2027/teams.csv` publishes that column BLANK for all twenty
// clubs (verified 15 Sept 2026) — the ingest correctly refuses to guess a
// club from a blank slug, so `opponent_team_code` is NULL on every
// current-season row, `buildTeamMatchRecords` resolves zero records, no club
// ever meets MIN_TEAM_PRIOR_MATCHES, and the team-strength tier never fires
// (ticket #235's "Problem": the diagnostic's own gate 2 passed vacuously
// because the new and old paths were, in practice, the same numbers).
//
// `public.fixtures` carries real results from FPL's own API directly —
// `team_h`/`team_a` (teams.id), `team_h_score`/`team_a_score`, `finished` —
// and depends on none of the blank FPL-Core-Insights columns. This is the
// PRIMARY path for the current season now, not a stopgap: ClubElo itself is
// abandoned (`api.clubelo.com` 502, `clubelo.com/ENG` frozen since Oct 2024,
// the best community mirror's scraper dead since 14 Jan 2026 — see the
// ticket's "Problem" section), so tier 1 (fresh elo) will in practice never
// fire again, and this construction — built from data already in the
// database — is the best signal available for the current season.
//
// `buildTeamMatchRecords` (the player_match_stats version, immediately
// above) is UNCHANGED and stays in use for `scripts/run-backtest.ts` and
// `scripts/build-training-features.ts`, which need PAST seasons' results —
// `public.fixtures` holds only the current season's schedule (no `season`
// column at all; see `decisions/ticket-140.md`), so it cannot serve either
// of those.
// ============================================================================

/**
 * One `public.fixtures` row's fields needed to build a team-match record —
 * `teams.id` values for `homeTeamId`/`awayTeamId` (NOT `teams.code` — see
 * `buildTeamMatchRecordsFromFixtures`'s own doc on why the caller must map
 * through `teamCodeById`), the actual final score, and whether the result is
 * real. `gameweek` is `fixtures.event_id` — a fixture with no gameweek
 * assigned yet (a blank-gameweek fixture) has nothing meaningful to pass
 * here and must be filtered out by the caller before this function ever
 * sees it (project-points.ts does exactly this).
 */
export interface FixtureResultRow {
  fixtureId: number
  gameweek: number
  homeTeamId: number
  awayTeamId: number
  homeScore: number | null
  awayScore: number | null
  finished: boolean
}

/** The result of {@link buildTeamMatchRecordsFromFixtures} — the records built, plus how many (fixture, side) entries were dropped for an unresolvable `teams.code`, counted rather than silently absorbed into `records.length` being merely "smaller than expected". */
export interface FixtureTeamMatchRecordsResult {
  records: TeamMatchRecord[]
  /** Ticket #235. Count of (fixture, side) entries dropped because that side's `teams.id` had no resolvable `teams.code` in `teamCodeById` — never guessed, never silently skipped without being counted. Surfaced in `job_runs.details` by project-points.ts. */
  unresolvableTeamCodeCount: number
}

/**
 * Builds the point-in-time team-strength record table from `public.fixtures`
 * rows (ticket #235) — the file header above explains why this replaces
 * `buildTeamMatchRecords` (player_match_stats) as the CURRENT season's
 * source. One `TeamMatchRecord` per side of each fixture: the home side gets
 * `goalsScored = homeScore`, `goalsConceded = awayScore`; the away side the
 * exact mirror. `matchId` is the fixture id, stringified — unlike
 * player_match_stats rows, a fixture row IS already one match, so there is
 * no max-across-players reduction to do here (contrast
 * `buildTeamMatchRecords`'s own "MAX across a team's players" correction,
 * which does not apply to a table that already holds the final score).
 *
 * A record is emitted ONLY when `finished` is true AND both scores are
 * non-null — a postponed or in-flight fixture contributes NOTHING, never a
 * guessed 0 (ticket text, verbatim). `fixtures.team_h`/`team_a` are
 * `teams.id`, not `teams.code` — `computeTeamStrengthAsOf` keys on `code`
 * (`deltas.md` D9), so every row is mapped through the caller-supplied
 * `teamCodeById` (`teams.id -> teams.code | null`) before being recorded. A
 * side whose id does not resolve to a code (missing from the map, or present
 * with a `null` code) contributes nothing for that side and is counted in
 * `unresolvableTeamCodeCount` — the OTHER side of the same fixture is still
 * recorded normally if its own code resolves; the two sides are independent.
 *
 * Named tests (teamStrength.test.ts): a finished fixture produces two
 * mirrored records; an unfinished fixture produces none; a null score
 * (either side) produces none; an unresolvable `teams.id` produces none for
 * that side only and is counted; two fixtures between the same two clubs
 * (e.g. the reverse fixture) are kept as two independent records, never
 * collapsed by team pairing — `matchId` (the fixture id) is what
 * distinguishes them, exactly as `buildTeamMatchRecords` above distinguishes
 * by `matchId`, never by team pairing alone. `public.fixtures` itself has no
 * `season` column and holds only the current season's schedule by ingest
 * convention (`decisions/ticket-140.md`), so unlike `buildTeamMatchRecords`
 * there is no season field to filter on here — this fixture-identity test is
 * what stands in its place: a prior season's meeting between the same two
 * clubs cannot silently merge into or overwrite this season's, because every
 * fixture keeps its own id.
 */
export function buildTeamMatchRecordsFromFixtures(
  rows: readonly FixtureResultRow[],
  teamCodeById: ReadonlyMap<number, number | null>,
): FixtureTeamMatchRecordsResult {
  const records: TeamMatchRecord[] = []
  let unresolvableTeamCodeCount = 0

  for (const row of rows) {
    if (!row.finished || row.homeScore === null || row.awayScore === null) continue
    const matchId = String(row.fixtureId)
    const sides: readonly { teamId: number; goalsScored: number; goalsConceded: number }[] = [
      { teamId: row.homeTeamId, goalsScored: row.homeScore, goalsConceded: row.awayScore },
      { teamId: row.awayTeamId, goalsScored: row.awayScore, goalsConceded: row.homeScore },
    ]
    for (const side of sides) {
      const teamCode = teamCodeById.get(side.teamId)
      if (teamCode === undefined || teamCode === null) {
        unresolvableTeamCodeCount++
        continue
      }
      records.push({
        matchId,
        gameweek: row.gameweek,
        teamCode,
        goalsScored: side.goalsScored,
        goalsConceded: side.goalsConceded,
      })
    }
  }

  return { records, unresolvableTeamCodeCount }
}
