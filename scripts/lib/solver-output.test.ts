// Unit tests for scripts/lib/solver-output.ts — ticket #126. No Supabase, no
// filesystem, no solver: every DoD item provable without a database is
// proven here. See the module's own file header for what is a directly
// verified fixture (the `Results` table, quoted verbatim from the ticket)
// versus what is this ticket's own best-effort construction (the
// gameweek-block / CHIP-line shape — see "WHAT IS INFERRED, NOT VERIFIED").

import { describe, expect, it } from 'vitest'
import { parseSolverOutput, SolverOutputParseError } from './solver-output.js'

// ============================================================================
// The real Results block — quoted VERBATIM from the ticket's own Context
// section ("Verified from the real log, 28 August 2026"). Do not "clean up"
// this string's spacing; it is deliberately copied character for character.
// ============================================================================

const REAL_RESULTS_BLOCK = `Results
  iter  sell         buy        chip        score
     0  Muharemović  Thiaw      TC2, BB4   256.48
     1  Wirtz        Tavernier  TC2, BB4   256.29
     2  Muharemović  Botman     TC2, BB4   255.98
`

describe('parseSolverOutput — the real probe output (ticket #126 Context)', () => {
  // The gameweek-block section below is this ticket's own construction (see
  // the module's file header) — the exact per-gameweek layout was never
  // quoted in the ticket, only its two clues ("a CHIP TC / CHIP BB line
  // inside each gameweek block") and the fact that the real Results block
  // shows every solution agreeing on TC2, BB4. This fixture is built to
  // agree with that real block, matching what a real log's cross-check would
  // need to look like for the real Results block to parse successfully.
  const fullLog = `Filtered player pool from 612 to 368 players
GW 1
GW 2
CHIP TC
GW 3
GW 4
CHIP BB
GW 5

${REAL_RESULTS_BLOCK}`

  it('yields three solutions, each with TC in gameweek 2 and BB in gameweek 4, and the exact scores from the log', () => {
    const result = parseSolverOutput(fullLog)
    expect(result.solutions).toHaveLength(3)

    for (const solution of result.solutions) {
      expect(solution.chips).toEqual([
        { chipCode: 'TC', gameweekId: 2 },
        { chipCode: 'BB', gameweekId: 4 },
      ])
    }

    expect(result.solutions.map((s) => s.solutionIndex)).toEqual([0, 1, 2])
    expect(result.solutions.map((s) => s.score)).toEqual([256.48, 256.29, 255.98])
  })

  it('captures the post-filter pool size from "Filtered player pool from N to M players"', () => {
    const result = parseSolverOutput(fullLog)
    expect(result.poolSizeAfter).toBe(368)
  })
})

// ============================================================================
// An empty chip column yields no chips for that solution, not an error.
// ============================================================================

describe('parseSolverOutput — a chip-free solve (empty chip column)', () => {
  const noChipLog = `Filtered player pool from 500 to 200 players
GW 1
GW 2
GW 3

Results
  iter  sell     buy      chip  score
     0  PlayerA  PlayerB        123.45
     1  PlayerC  PlayerD        120.00
`

  it('parses every solution with an empty chips array, not an error', () => {
    const result = parseSolverOutput(noChipLog)
    expect(result.solutions).toHaveLength(2)
    expect(result.solutions[0].chips).toEqual([])
    expect(result.solutions[1].chips).toEqual([])
    expect(result.solutions[0].score).toBe(123.45)
    expect(result.solutions[1].score).toBe(120.0)
  })
})

// ============================================================================
// The cross-check that fails loudly — the most important test in the
// ticket. A Results table disagreeing with the per-gameweek CHIP lines must
// throw, naming both readings, never silently pick one.
// ============================================================================

describe('parseSolverOutput — Results table disagrees with the per-gameweek CHIP lines (most important test)', () => {
  it('throws, naming both readings, rather than silently trusting the Results table', () => {
    const disagreeingLog = `GW 1
GW 2

Results
  iter  sell     buy      chip  score
     0  PlayerA  PlayerB  TC2   100.00
`
    // The Results table says TC2 was played; the gameweek block above has no
    // "CHIP TC" line at all under GW 2 — a real disagreement.
    expect(() => parseSolverOutput(disagreeingLog)).toThrow(SolverOutputParseError)
    try {
      parseSolverOutput(disagreeingLog)
      expect.unreachable('parseSolverOutput should have thrown')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      expect(message).toContain('disagree')
      expect(message).toContain('TC2') // the Results table's reading
      expect(message).toContain('(none)') // the per-gameweek reading
    }
  })

  it('also throws when the per-gameweek lines report a chip the Results table does not', () => {
    const disagreeingLog = `GW 1
GW 2
CHIP TC

Results
  iter  sell     buy      chip  score
     0  PlayerA  PlayerB        100.00
`
    expect(() => parseSolverOutput(disagreeingLog)).toThrow(/disagree/)
  })
})

// ============================================================================
// A missing Results table fails loudly rather than returning an empty
// advisory — an absent table and "no chip played" must never look the same.
// ============================================================================

describe('parseSolverOutput — a missing Results table', () => {
  it('throws rather than returning an empty solutions array', () => {
    const noResultsLog = `GW 1
GW 2
CHIP TC
GW 3
`
    expect(() => parseSolverOutput(noResultsLog)).toThrow(SolverOutputParseError)
    expect(() => parseSolverOutput(noResultsLog)).toThrow(/no "Results" table found/)
  })

  it('throws on a completely empty log', () => {
    expect(() => parseSolverOutput('')).toThrow(SolverOutputParseError)
  })
})

// ============================================================================
// poolSizeAfter — independent of whether a Results table is even reachable
// in isolation (it is read from a different line entirely), but only ever
// returned alongside a successfully parsed Results table since a missing
// one throws first.
// ============================================================================

describe('parseSolverOutput — poolSizeAfter', () => {
  it('is null when the "Filtered player pool" line never appears', () => {
    const log = `GW 1

Results
  iter  sell     buy      chip  score
     0  PlayerA  PlayerB        50.00
`
    expect(parseSolverOutput(log).poolSizeAfter).toBeNull()
  })
})
