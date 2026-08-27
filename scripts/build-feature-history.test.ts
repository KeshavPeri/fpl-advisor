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

    // The cup gameweek gets no row of its own — no contributing match landed there.
    expect(result.rows.find((r) => r.gameweek_id === 2)).toBeUndefined()

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
// player, the totals in his final gameweek's row plus that gameweek's own
// match equal his full-season totals.
// ============================================================================

describe('buildFeatureHistory — full-season reconciliation', () => {
  it('final gameweek row + that gameweek’s own match equals the full-season total, for every player in a constructed season', () => {
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
      const lastRow = playerRows.reduce((latest, r) => (r.gameweek_id > latest.gameweek_id ? r : latest))
      const finalMatch = matches.reduce((latest, m) => (m.gameweek > latest.gameweek ? m : latest))

      const fullSeasonTotals = sumMatches(matches)
      const reconstructed = sumMatches([...matches.filter((m) => m.gameweek < finalMatch.gameweek), finalMatch])
      // Sanity: reconstructing from lastRow's prior_* fields plus the final
      // match's own stats must equal the independently-computed full-season sum.
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
        expect(lastRow[key] + finalMatchContribution).toBeCloseTo(fullSeasonTotals[key], 10)
        expect(reconstructed[key]).toBeCloseTo(fullSeasonTotals[key], 10)
      }
    }
  })
})

// ============================================================================
// Player/gameweek coverage counters.
// ============================================================================

describe('buildFeatureHistory — coverage counters', () => {
  it('playersCovered and gameweeksCovered count distinct contributing players/gameweeks', () => {
    const rows: SourceMatchRow[] = [premMatch(1, 1), premMatch(1, 2), premMatch(2, 1), cupMatch(3, 5)]
    const result = buildFeatureHistory(rows, SEASON, COMPUTED_AT)
    expect(result.playersCovered).toBe(2) // players 1 and 2 — player 3's only row is a cup match
    expect(result.gameweeksCovered).toBe(2) // gameweeks 1 and 2
    expect(result.rows).toHaveLength(3) // (1,1) (1,2) (2,1)
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
  it('lists the new migration, marked not yet applied', () => {
    expect(readmeSource).toMatch(/20260827090000_feature_history\.sql/)
    const rowMatch = readmeSource.match(/\| `20260827090000_feature_history\.sql` \|.*\|\s*$/m)
    expect(rowMatch).not.toBeNull()
    expect(rowMatch![0]).toMatch(/not yet applied/i)
  })
})
