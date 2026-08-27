// Unit tests for scripts/build-feature-history.ts and its migration —
// ticket #121. No live Supabase project: every DoD item provable without a
// database is proven here on constructed match rows — the strictly-before
// boundary (both off-by-one directions), the first-gameweek zero row, the
// non-Premier-League exclusion, and the two arithmetic reconciliations. What
// this file cannot prove — that the job produces sane output against
// 15,000+ real player_match_stats rows — is exactly the ticket's own named
// "what a substitute cannot catch" human check after merge.
//
// The migration-file and source-invariant sections below use the same
// grep-on-real-source technique as scripts/calibration-report.test.ts's
// ticket #54 section and scripts/ingest-core-insights.test.ts's "source
// invariants" section: proving the shape of what actually shipped, not
// re-deriving the same logic in TypeScript.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { PREMIER_LEAGUE_COMPETITION } from './lib/competition.ts'
import { buildFeatureHistory, DEFAULT_SEASON, ZERO_TOTALS, type SourceMatchRow } from './build-feature-history.ts'

const SEASON = '2025-2026'
const COMPUTED_AT = '2026-08-27T09:00:00.000Z'

/** A fully-specified contributing (Premier League, player_code-resolved) match row, with every stat distinguishable so a test can tell which matches were folded in. */
function premMatch(playerCode: number, gameweek: number, overrides: Partial<SourceMatchRow> = {}): SourceMatchRow {
  return {
    player_code: playerCode,
    competition: PREMIER_LEAGUE_COMPETITION,
    gameweek,
    minutes_played: 90,
    xg: 0.1 * gameweek,
    xa: 0.2 * gameweek,
    saves: gameweek,
    clearances: gameweek,
    blocks: gameweek,
    interceptions: gameweek,
    tackles: gameweek,
    recoveries: gameweek,
    team_goals_conceded: gameweek % 3,
    ...overrides,
  }
}

function cupMatch(playerCode: number, gameweek: number, overrides: Partial<SourceMatchRow> = {}): SourceMatchRow {
  return { ...premMatch(playerCode, gameweek, overrides), competition: 'fa-cup' }
}

function sumMatches(matches: readonly SourceMatchRow[]) {
  return matches.reduce(
    (totals, m) => ({
      prior_matches: totals.prior_matches + 1,
      prior_minutes: totals.prior_minutes + (m.minutes_played ?? 0),
      prior_xg: totals.prior_xg + (m.xg ?? 0),
      prior_xa: totals.prior_xa + (m.xa ?? 0),
      prior_saves: totals.prior_saves + (m.saves ?? 0),
      prior_clearances: totals.prior_clearances + (m.clearances ?? 0),
      prior_blocks: totals.prior_blocks + (m.blocks ?? 0),
      prior_interceptions: totals.prior_interceptions + (m.interceptions ?? 0),
      prior_tackles: totals.prior_tackles + (m.tackles ?? 0),
      prior_recoveries: totals.prior_recoveries + (m.recoveries ?? 0),
      prior_team_goals_conceded: totals.prior_team_goals_conceded + (m.team_goals_conceded ?? 0),
    }),
    { ...ZERO_TOTALS },
  )
}

// ============================================================================
// The strictly-before rule — the entire ticket. Both off-by-one directions
// asserted separately, per the DoD.
// ============================================================================

describe('buildFeatureHistory — strictly-before rule', () => {
  it('the row for gameweek 3 contains the totals of gameweeks 1 and 2 only', () => {
    const gw1 = premMatch(100, 1)
    const gw2 = premMatch(100, 2)
    const gw3 = premMatch(100, 3)
    const result = buildFeatureHistory([gw1, gw2, gw3], SEASON, COMPUTED_AT)

    const row3 = result.rows.find((r) => r.gameweek_id === 3)
    expect(row3).toBeDefined()

    // Direction 1: does NOT include gameweek 3's own match — its xg (0.3)
    // must be absent from the total.
    expect(row3!.prior_xg).toBeCloseTo(gw1.xg! + gw2.xg!, 10)
    expect(row3!.prior_xg).not.toBeCloseTo(gw1.xg! + gw2.xg! + gw3.xg!, 10)

    // Direction 2: DOES include both gameweek 1 and gameweek 2 — not just
    // the immediately preceding gameweek.
    expect(row3!.prior_matches).toBe(2)
    expect(row3!.prior_minutes).toBe(gw1.minutes_played! + gw2.minutes_played!)
    expect(row3!.prior_saves).toBe(gw1.saves! + gw2.saves!)
    expect(row3).toMatchObject(sumMatches([gw1, gw2]))
  })

  it('the row for gameweek 2 contains gameweek 1 only, not gameweek 2', () => {
    const gw1 = premMatch(100, 1)
    const gw2 = premMatch(100, 2)
    const result = buildFeatureHistory([gw1, gw2], SEASON, COMPUTED_AT)
    const row2 = result.rows.find((r) => r.gameweek_id === 2)
    expect(row2).toMatchObject(sumMatches([gw1]))
  })
})

// ============================================================================
// First-gameweek row: prior_matches = 0, every total zero — real zeros, not
// null and not an absent row.
// ============================================================================

describe('buildFeatureHistory — a player’s first gameweek', () => {
  it('has prior_matches = 0 and every total at zero, not null and not absent', () => {
    const result = buildFeatureHistory([premMatch(200, 1)], SEASON, COMPUTED_AT)
    const row1 = result.rows.find((r) => r.gameweek_id === 1 && r.player_code === 200)

    expect(row1).toBeDefined()
    expect(row1).toMatchObject(ZERO_TOTALS)
    for (const key of Object.keys(ZERO_TOTALS) as Array<keyof typeof ZERO_TOTALS>) {
      expect(row1![key]).not.toBeNull()
      expect(row1![key]).toBe(0)
    }
  })
})

// ============================================================================
// Non-Premier-League exclusion — a cup match interleaved between two league
// matches contributes nothing to any total.
// ============================================================================

describe('buildFeatureHistory — non-Premier-League exclusion', () => {
  it('a cup match interleaved between two league matches contributes nothing to any total', () => {
    const gw1 = premMatch(300, 1)
    const gw2Cup = cupMatch(300, 2, { minutes_played: 90, xg: 99, xa: 99, saves: 99, clearances: 99, blocks: 99, interceptions: 99, tackles: 99, recoveries: 99, team_goals_conceded: 99 })
    const gw3 = premMatch(300, 3)
    const result = buildFeatureHistory([gw1, gw2Cup, gw3], SEASON, COMPUTED_AT)

    // Ticket #125: rows are dense, so gameweek 2 now DOES get a row — but it
    // must carry gameweek 1's totals forward unchanged, never the cup
    // match's stats (every overridden field above is 99, so any leakage
    // would be obvious).
    const row2 = result.rows.find((r) => r.gameweek_id === 2)
    expect(row2).toMatchObject(sumMatches([gw1])) // NOT gw1 + the cup match
    expect(row2!.prior_matches).toBe(1)

    const row3 = result.rows.find((r) => r.gameweek_id === 3)
    expect(row3).toMatchObject(sumMatches([gw1])) // NOT gw1 + the cup match
    expect(row3!.prior_matches).toBe(1)

    expect(result.rowsContributingToTotals).toBe(2)
    expect(result.nonPremierLeagueRowsExcluded).toBe(1)
  })
})

// ============================================================================
// Counters reconcile arithmetically: source rows read = rows contributing to
// totals + non-Premier-League rows excluded, exactly.
// ============================================================================

describe('buildFeatureHistory — counter reconciliation', () => {
  it('source rows read equals rows contributing to totals plus non-Premier-League rows excluded', () => {
    const rows: SourceMatchRow[] = [
      premMatch(1, 1),
      premMatch(1, 2),
      cupMatch(1, 3),
      premMatch(2, 1),
      cupMatch(2, 2),
      { ...premMatch(3, 1), player_code: null }, // Premier League but no resolvable player_code
      { ...premMatch(3, 2), competition: null }, // not yet stamped
    ]
    const result = buildFeatureHistory(rows, SEASON, COMPUTED_AT)

    expect(result.sourceRowsRead).toBe(rows.length)
    expect(result.sourceRowsRead).toBe(result.rowsContributingToTotals + result.nonPremierLeagueRowsExcluded)
    // Concretely: 3 genuinely contributing rows (player 1's two, player 2's one).
    expect(result.rowsContributingToTotals).toBe(3)
    expect(result.nonPremierLeagueRowsExcluded).toBe(4)
  })

  it('reconciles even when every row is excluded', () => {
    const rows: SourceMatchRow[] = [cupMatch(1, 1), cupMatch(1, 2)]
    const result = buildFeatureHistory(rows, SEASON, COMPUTED_AT)
    expect(result.sourceRowsRead).toBe(2)
    expect(result.rowsContributingToTotals).toBe(0)
    expect(result.nonPremierLeagueRowsExcluded).toBe(2)
    expect(result.rows).toHaveLength(0)
  })
})

// ============================================================================
// Second arithmetic reconciliation, on real (constructed) output: for any
// player, the totals in the row AT his final match's own gameweek, plus that
// gameweek's own match, equal his full-season totals.
//
// Ticket #125: under dense rows, a player's LAST row is no longer
// necessarily the row for his last match's own gameweek — it can be a later,
// carried-forward row if other players (or excluded matches) extend the
// season's data past his final appearance. So this reconciliation is now
// keyed on the row AT the final match's own gameweek_id, not on
// `playerRows`'s max gameweek_id — the two coincide only when a player's
// last match is also the last gameweek anywhere in the season's data.
// ============================================================================

describe('buildFeatureHistory — full-season reconciliation', () => {
  it('the row at a player’s final match’s own gameweek, plus that match’s own stats, equals his full-season total', () => {
    const playerAMatches = [1, 2, 3, 4, 5].map((gw) => premMatch(400, gw))
    const playerBMatches = [1, 3, 4].map((gw) => premMatch(401, gw)) // gaps are fine — rows follow actual appearances
    const playerBCup = cupMatch(401, 2) // interleaved noise — must not affect the reconciliation
    const allRows = [...playerAMatches, ...playerBMatches, playerBCup]

    const result = buildFeatureHistory(allRows, SEASON, COMPUTED_AT)

    for (const [playerCode, matches] of [
      [400, playerAMatches],
      [401, playerBMatches],
    ] as const) {
      const playerRows = result.rows.filter((r) => r.player_code === playerCode)
      const finalMatch = matches.reduce((latest, m) => (m.gameweek > latest.gameweek ? m : latest))
      const rowAtFinalMatch = playerRows.find((r) => r.gameweek_id === finalMatch.gameweek)!

      const fullSeasonTotals = sumMatches(matches)
      const reconstructed = sumMatches([...matches.filter((m) => m.gameweek < finalMatch.gameweek), finalMatch])
      // Sanity: reconstructing from rowAtFinalMatch's prior_* fields plus the
      // final match's own stats must equal the independently-computed
      // full-season sum.
      for (const key of Object.keys(ZERO_TOTALS) as Array<keyof typeof ZERO_TOTALS>) {
        const finalMatchContribution =
          key === 'prior_matches'
            ? 1
            : key === 'prior_minutes'
              ? (finalMatch.minutes_played ?? 0)
              : key === 'prior_xg'
                ? (finalMatch.xg ?? 0)
                : key === 'prior_xa'
                  ? (finalMatch.xa ?? 0)
                  : key === 'prior_saves'
                    ? (finalMatch.saves ?? 0)
                    : key === 'prior_clearances'
                      ? (finalMatch.clearances ?? 0)
                      : key === 'prior_blocks'
                        ? (finalMatch.blocks ?? 0)
                        : key === 'prior_interceptions'
                          ? (finalMatch.interceptions ?? 0)
                          : key === 'prior_tackles'
                            ? (finalMatch.tackles ?? 0)
                            : key === 'prior_recoveries'
                              ? (finalMatch.recoveries ?? 0)
                              : (finalMatch.team_goals_conceded ?? 0)
        expect(rowAtFinalMatch[key] + finalMatchContribution).toBeCloseTo(fullSeasonTotals[key], 10)
        expect(reconstructed[key]).toBeCloseTo(fullSeasonTotals[key], 10)
      }
    }

    // Dense-specific: player 401's final match is gameweek 4, but the
    // season's data (via player 400) runs through gameweek 5 — so player
    // 401 also gets a gameweek 5 row, carrying gameweek 4's totals forward
    // unchanged (his full-season total, since gameweek 4 was his last match).
    const player401Row5 = result.rows.find((r) => r.player_code === 401 && r.gameweek_id === 5)
    expect(player401Row5).toMatchObject(sumMatches(playerBMatches))
  })
})

// ============================================================================
// Player/gameweek coverage counters.
// ============================================================================

describe('buildFeatureHistory — coverage counters', () => {
  it('playersCovered and gameweeksCovered count distinct CONTRIBUTING players/gameweeks — not the (larger) dense row count', () => {
    const rows: SourceMatchRow[] = [premMatch(1, 1), premMatch(1, 2), premMatch(2, 1), cupMatch(3, 5)]
    const result = buildFeatureHistory(rows, SEASON, COMPUTED_AT)
    expect(result.playersCovered).toBe(2) // players 1 and 2 — player 3's only row is a cup match
    expect(result.gameweeksCovered).toBe(2) // gameweeks 1 and 2 — distinct CONTRIBUTING gameweeks only
    // Ticket #125: dense output. lastGameweekInData is 5 (the cup match at
    // gw5 is still real data, even though it doesn't contribute to totals).
    // Player 1 (first contributing match gw1) gets rows 1-5 (5 rows); player
    // 2 (first contributing match gw1) also gets rows 1-5 (5 rows); player 3
    // has no contributing match at all, so gets zero rows.
    expect(result.lastGameweekInData).toBe(5)
    expect(result.rows).toHaveLength(10) // 5 (player 1) + 5 (player 2) + 0 (player 3)
    expect(result.rows.filter((r) => r.player_code === 3)).toHaveLength(0)
  })

  it('handles a double gameweek: both matches count toward the next gameweek’s prior totals', () => {
    const gw5a = premMatch(500, 5, { minutes_played: 90 })
    const gw5b = premMatch(500, 5, { minutes_played: 90 })
    const gw6 = premMatch(500, 6)
    const result = buildFeatureHistory([gw5a, gw5b, gw6], SEASON, COMPUTED_AT)

    const row5 = result.rows.find((r) => r.gameweek_id === 5)
    expect(row5!.prior_matches).toBe(0) // nothing strictly before gw5 in this fixture set

    const row6 = result.rows.find((r) => r.gameweek_id === 6)
    expect(row6!.prior_matches).toBe(2) // both gw5 matches
    expect(row6!.prior_minutes).toBe(180)
  })
})

// ============================================================================
// Dense rows (ticket #125). The #121 "strictly-before rule" describe block
// above is left byte-for-byte unmodified per this ticket's DoD — it already
// passes unchanged under dense generation because its fixtures have no gaps.
// These new tests exercise the actual density behaviour: gaps get filled,
// the fill carries the previous gameweek's totals forward unchanged, and the
// strictly-before rule still holds at the filled boundary.
// ============================================================================

describe('buildFeatureHistory — dense rows (ticket #125)', () => {
  it('a player who plays gameweeks 1, 2 and 5 gets rows for every gameweek 1-5, with gameweeks 3 and 4 carrying the gameweek-2-inclusive totals unchanged', () => {
    const gw1 = premMatch(600, 1)
    const gw2 = premMatch(600, 2)
    const gw5 = premMatch(600, 5)
    const result = buildFeatureHistory([gw1, gw2, gw5], SEASON, COMPUTED_AT)

    const gameweekIds = result.rows.map((r) => r.gameweek_id).sort((a, b) => a - b)
    expect(gameweekIds).toEqual([1, 2, 3, 4, 5])

    const row2 = result.rows.find((r) => r.gameweek_id === 2)!
    const row3 = result.rows.find((r) => r.gameweek_id === 3)!
    const row4 = result.rows.find((r) => r.gameweek_id === 4)!
    const row5 = result.rows.find((r) => r.gameweek_id === 5)!

    // Gameweek 2's row is the strictly-before total through gameweek 1 only
    // — gameweek 2's own match is not folded in yet.
    expect(row2).toMatchObject(sumMatches([gw1]))
    expect(row2.prior_matches).toBe(1)

    // Gameweek 3 is the first row where gameweek 2's match HAS been folded
    // in (2 < 3) — both gameweek 1 and gameweek 2 now count.
    expect(row3).toMatchObject(sumMatches([gw1, gw2]))
    expect(row3.prior_matches).toBe(2)

    // Gameweek 4 has no contributing match of its own, so it carries
    // gameweek 3's totals forward unchanged — same totals, only the
    // gameweek_id differs. This is the DoD's literal "gameweek 3 and 4 rows
    // carry the gameweek 2 totals unchanged": both rows already reflect
    // gameweek 2's contribution, and nothing since has changed it.
    expect(row4).toEqual({ ...row3, gameweek_id: 4 })

    // The strictly-before rule still holds at the filled boundary: gameweek
    // 5's row is gameweeks 1-2 only, never gameweek 5's own match — it is
    // identical to gameweek 4's row, since gameweek 5's match is excluded
    // from its own row by the strictly-before rule.
    expect(row5).toEqual({ ...row3, gameweek_id: 5 })
    expect(row5.prior_matches).toBe(2)
  })

  it('a player’s row count for a season equals the number of gameweeks from his first match through the last gameweek present in the data, inclusive', () => {
    const matches = [1, 2, 5].map((gw) => premMatch(700, gw))
    const laterPlayer = premMatch(999, 9) // a different player's match extends the season's last gameweek to 9
    const result = buildFeatureHistory([...matches, laterPlayer], SEASON, COMPUTED_AT)

    expect(result.lastGameweekInData).toBe(9)
    const playerRows = result.rows.filter((r) => r.player_code === 700)
    expect(playerRows).toHaveLength(9 - 1 + 1) // gameweeks 1 through 9 inclusive
    expect(new Set(playerRows.map((r) => r.gameweek_id)).size).toBe(playerRows.length) // no duplicate gameweek_id
  })

  it('a player’s dense rows extend through the last gameweek present in the data even past his own final match, via a later NON-contributing row', () => {
    const gw1 = premMatch(800, 1)
    const gw3 = premMatch(800, 3) // player 800's last contributing match
    const laterCup = cupMatch(801, 6) // non-contributing, but still real data at gameweek 6
    const result = buildFeatureHistory([gw1, gw3, laterCup], SEASON, COMPUTED_AT)

    expect(result.lastGameweekInData).toBe(6)
    const player800Rows = result.rows.filter((r) => r.player_code === 800)
    const gameweekIds = player800Rows.map((r) => r.gameweek_id).sort((a, b) => a - b)
    expect(gameweekIds).toEqual([1, 2, 3, 4, 5, 6])

    // Gameweeks 4, 5 and 6 all carry gameweek 3's match forward unchanged —
    // nothing contributed to player 800's totals after it.
    const row6 = player800Rows.find((r) => r.gameweek_id === 6)!
    expect(row6).toMatchObject(sumMatches([gw1, gw3]))
  })
})

// ============================================================================
// Season env var — documented default, matching ingest-core-insights.ts's
// FEATURE_HISTORY_SEASON / CORE_INSIGHTS_SEASON convention.
// ============================================================================

describe('season configuration', () => {
  it('DEFAULT_SEASON matches the season named in the ticket’s human-check step', () => {
    expect(DEFAULT_SEASON).toBe('2025-2026')
  })
})

// ============================================================================
// Source invariants — grepping the actual shipped scripts/build-feature-history.ts
// rather than re-deriving its Supabase-calling logic here, since that needs a
// live project this test file does not have.
// ============================================================================

const jobSourcePath = fileURLToPath(new URL('./build-feature-history.ts', import.meta.url))
const jobSource = readFileSync(jobSourcePath, 'utf8')

describe('build-feature-history.ts — source invariants', () => {
  it('reads the season from FEATURE_HISTORY_SEASON with a trimmed-and-defaulted fallback, matching CORE_INSIGHTS_SEASON’s convention', () => {
    expect(jobSource).toMatch(/process\.env\.FEATURE_HISTORY_SEASON/)
    expect(jobSource).toMatch(/\.trim\(\)\s*\|\|\s*DEFAULT_SEASON/)
  })

  it('paginates its player_match_stats read via fetchAllPages and verifies it with assertRowCountMatches', () => {
    expect(jobSource).toMatch(/import\s*\{[^}]*\}\s*from\s*['"]\.\/lib\/paginate\.ts['"]/s)
    expect(jobSource).toMatch(/fetchAllPages/)
    expect(jobSource).toMatch(/assertRowCountMatches/)
    expect(jobSource).toMatch(/fetchAllPages<SourceMatchRow>/)
    expect(jobSource).toMatch(/assertRowCountMatches\(/)
  })

  it('filters player_match_stats reads to the configured season', () => {
    expect(jobSource).toMatch(/\.eq\(\s*['"]season['"]\s*,\s*season\s*\)/)
  })

  it('imports PREMIER_LEAGUE_COMPETITION rather than a hardcoded competition literal for its filtering logic', () => {
    expect(jobSource).toMatch(/import\s*\{\s*PREMIER_LEAGUE_COMPETITION\s*\}\s*from\s*['"]\.\/lib\/competition\.ts['"]/)
  })

  it('issues no delete call anywhere', () => {
    expect(jobSource).not.toMatch(/\.delete\(\s*\)/)
  })

  it('never writes to player_match_stats — this job reads it only', () => {
    expect(jobSource).not.toMatch(/from\(\s*['"]player_match_stats['"]\s*\)\s*\n?\s*\.\s*(update|upsert|insert|delete)/)
  })

  it('upserts feature_history on the (season, gameweek_id, player_code) key', () => {
    expect(jobSource).toMatch(/onConflict:\s*['"]season,gameweek_id,player_code['"]/)
  })

  it('does not import from src/lib/projection', () => {
    expect(jobSource).not.toMatch(/from\s*['"][^'"]*src\/lib\/projection[^'"]*['"]/)
  })

  // Ticket #125's own DoD line: prior_team_goals_conceded must be populated
  // from the newly ingested team_goals_conceded column and never from the
  // pre-existing goalkeeper-only goals_conceded column. Grep-checkable: every
  // appearance of the substring "goals_conceded" in this file is part of the
  // longer string "team_goals_conceded" — there is no bare occurrence a stray
  // `row.goals_conceded` reference could hide behind.
  it('the string "goals_conceded" appears only as part of "team_goals_conceded"', () => {
    const bareOccurrences = jobSource.match(/(?<!team_)goals_conceded/g) ?? []
    expect(bareOccurrences).toEqual([])
  })
})

// ============================================================================
// Migration file — grep-checkable DoD items against the real shipped SQL.
// ============================================================================

const migrationPath = fileURLToPath(
  new URL('../supabase/migrations/20260827090000_feature_history.sql', import.meta.url),
)
const migrationSource = readFileSync(migrationPath, 'utf8')

describe('supabase/migrations/20260827090000_feature_history.sql', () => {
  it('contains both a CREATE POLICY and an explicit GRANT SELECT statement', () => {
    expect(migrationSource).toMatch(/CREATE POLICY/)
    expect(migrationSource).toMatch(/GRANT SELECT/)
  })

  it('grants service_role SELECT, INSERT, UPDATE', () => {
    expect(migrationSource).toMatch(/GRANT SELECT, INSERT, UPDATE ON public\.feature_history TO service_role/)
  })

  it('the string "player_id" does not appear anywhere in the migration', () => {
    expect(migrationSource).not.toMatch(/player_id/)
  })

  it('the primary key is (season, gameweek_id, player_code)', () => {
    expect(migrationSource).toMatch(/PRIMARY KEY \(season, gameweek_id, player_code\)/)
  })

  it('is idempotent by construction: CREATE TABLE/INDEX use IF NOT EXISTS, the policy is dropped then recreated', () => {
    expect(migrationSource).toMatch(/CREATE TABLE IF NOT EXISTS public\.feature_history/)
    expect(migrationSource).toMatch(/CREATE INDEX IF NOT EXISTS/)
    expect(migrationSource).toMatch(/DROP POLICY IF EXISTS "feature_history_select_anon"/)
  })

  it('every prior_* total column is NOT NULL with a default of 0 — never null, never absent', () => {
    const priorColumns = [
      'prior_matches',
      'prior_minutes',
      'prior_xg',
      'prior_xa',
      'prior_saves',
      'prior_clearances',
      'prior_blocks',
      'prior_interceptions',
      'prior_tackles',
      'prior_recoveries',
      'prior_team_goals_conceded',
    ]
    for (const column of priorColumns) {
      const re = new RegExp(`${column}\\s+(?:integer|numeric)\\s+NOT NULL DEFAULT 0`)
      expect(migrationSource).toMatch(re)
    }
  })
})

// ============================================================================
// supabase/README.md carries the new migration row, marked not yet applied.
// ============================================================================

const readmePath = fileURLToPath(new URL('../supabase/README.md', import.meta.url))
const readmeSource = readFileSync(readmePath, 'utf8')

describe('supabase/README.md', () => {
  // The feature_history migration's own applied status is not this ticket's
  // (#125's) concern — it was marked applied by the workflow that actually
  // ran it against the live database, after ticket #121 shipped this
  // assertion against a not-yet-applied row. Only the row's continued
  // presence is asserted here now; ticket #125's own README changes (a
  // corrected #54 row and a new not-yet-applied row for its own migration)
  // are asserted in ingest-core-insights.test.ts, which owns both.
  it('lists the feature_history migration', () => {
    expect(readmeSource).toMatch(/20260827090000_feature_history\.sql/)
    const rowMatch = readmeSource.match(/\| `20260827090000_feature_history\.sql` \|.*\|\s*$/m)
    expect(rowMatch).not.toBeNull()
  })
})
