// Unit tests for scripts/lib/solver-output.ts — ticket #126, fixed by ticket
// #132 (defect 1). No Supabase, no filesystem, no solver: every DoD item
// provable without a database is proven here. See the module's own file
// header for what is a directly verified fixture versus best-effort
// construction.
//
// Ticket #132's own rule: "Both fixtures go into the test file verbatim — a
// tidied fixture would re-create the defect." The two Results blocks below
// (CHIP_FREE_RESULTS_BLOCK, CHIP_ENABLED_RESULTS_BLOCK) are copied
// character-for-character from the ticket's Context section, "Verified from
// the real log, 29 August 2026" — including the `-` empty-cell markers and
// each block's own column spacing. Do not "clean up" either string.
//
// The two ORIGINAL (#126) fixtures that used a blank chip column instead of
// the literal `-` have been corrected to `-` throughout this file: that
// blank-column shape was #126's own speculative construction ("a solve that
// plays no chip has never been observed" — #126's own DoD), and it is
// exactly the "tidied fixture" ticket #132 warns against re-creating. Their
// test INTENT (missing Results table, the cross-check disagreement, pool
// size) is unchanged; only the placeholder character is corrected to match
// the real log.

import { describe, expect, it } from 'vitest'
import { parseSolverOutput, SolverOutputParseError } from './solver-output.js'

// ============================================================================
// The real probe Results block — quoted VERBATIM from ticket #126's own
// Context section ("Verified from the real log, 28 August 2026").
// ============================================================================

const REAL_RESULTS_BLOCK = `Results
  iter  sell         buy        chip        score
     0  Muharemović  Thiaw      TC2, BB4   256.48
     1  Wirtz        Tavernier  TC2, BB4   256.29
     2  Muharemović  Botman     TC2, BB4   255.98
`

describe('parseSolverOutput — the real probe output (ticket #126 Context)', () => {
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
// TICKET #132, DEFECT 1 — the two real shapes captured from the same
// production run of 29 August 2026. Both quoted verbatim (see file header).
// ============================================================================

// The chip-free (normal) run's Results table. Every chip cell is the literal
// `-`, and solution 2 rolled its transfer — both sell and buy are also `-`.
const CHIP_FREE_RESULTS_BLOCK = `Results
  iter  sell    buy         chip      score
     0  Wirtz   Szoboszlai  -        269.85
     1  Wirtz   Tavernier   -        268.32
     2  -       -           -        268.24
`

// The chip-enabled run's Results table, same production run. Every solution
// plays BB in gameweek 2 and TC in gameweek 3 — note this is NOT the probe's
// TC2/BB4: the parser reads what is actually in the log, never what a
// previous run happened to show (ticket #132's own DoD wording).
const CHIP_ENABLED_RESULTS_BLOCK = `Results
  iter  sell    buy         chip        score
     0  Wirtz   Szoboszlai  BB2, TC3   288.18
     1  Wirtz   Tavernier   BB2, TC3   286.65
     2  -       -           BB2, TC3   286.58
`

describe('parseSolverOutput — the chip-free production log (ticket #132, defect 1)', () => {
  // No CHIP lines in the body at all — a chip-free table with no
  // per-gameweek CHIP line anywhere is agreement, not a missing reading (see
  // the "cross-check" describe block below for the case that must disagree).
  const fullLog = `Filtered player pool from 600 to 360 players
GW 1
GW 2
GW 3

${CHIP_FREE_RESULTS_BLOCK}`

  it('parses to three solutions with no chips and the exact scores 269.85, 268.32, 268.24', () => {
    const result = parseSolverOutput(fullLog)
    expect(result.solutions).toHaveLength(3)
    expect(result.solutions.map((s) => s.solutionIndex)).toEqual([0, 1, 2])
    expect(result.solutions.map((s) => s.score)).toEqual([269.85, 268.32, 268.24])
    for (const solution of result.solutions) {
      expect(solution.chips).toEqual([])
    }
  })

  it('solution 2 carries no player sold and none bought — "-" is empty in sell and buy, not just chip', () => {
    const result = parseSolverOutput(fullLog)
    const solution2 = result.solutions[2]
    expect(solution2.playerSold).toBeNull()
    expect(solution2.playerBought).toBeNull()
  })

  it('solutions 0 and 1 read real sell/buy names, not "-"', () => {
    const result = parseSolverOutput(fullLog)
    expect(result.solutions[0].playerSold).toBe('Wirtz')
    expect(result.solutions[0].playerBought).toBe('Szoboszlai')
    expect(result.solutions[1].playerSold).toBe('Wirtz')
    expect(result.solutions[1].playerBought).toBe('Tavernier')
  })
})

describe('parseSolverOutput — the chip-enabled production log (ticket #132, defect 1)', () => {
  const fullLog = `Filtered player pool from 600 to 360 players
GW 1
GW 2
CHIP BB
GW 3
CHIP TC
GW 4

${CHIP_ENABLED_RESULTS_BLOCK}`

  it('parses to three solutions, each with BB in gameweek 2 and TC in gameweek 3, and the exact scores 288.18, 286.65, 286.58', () => {
    const result = parseSolverOutput(fullLog)
    expect(result.solutions).toHaveLength(3)
    expect(result.solutions.map((s) => s.solutionIndex)).toEqual([0, 1, 2])
    expect(result.solutions.map((s) => s.score)).toEqual([288.18, 286.65, 286.58])
    for (const solution of result.solutions) {
      expect(solution.chips).toEqual([
        { chipCode: 'BB', gameweekId: 2 },
        { chipCode: 'TC', gameweekId: 3 },
      ])
    }
  })

  it('solution 2 carries no player sold and none bought, even though every solution plays a chip', () => {
    const result = parseSolverOutput(fullLog)
    const solution2 = result.solutions[2]
    expect(solution2.playerSold).toBeNull()
    expect(solution2.playerBought).toBeNull()
    expect(solution2.chips).toEqual([
      { chipCode: 'BB', gameweekId: 2 },
      { chipCode: 'TC', gameweekId: 3 },
    ])
  })
})

// ============================================================================
// TICKET #132, DEFECT 1 — column boundaries are derived from the header,
// never a stored offset. Grep-checkable at the source level (see the
// "source invariants" describe block at the bottom of this file); this
// describe block is the behavioural proof: two logs whose header column
// widths genuinely differ both parse correctly with the SAME parser.
// ============================================================================

describe('parseSolverOutput — header column widths differ between logs and both still parse (ticket #132, defect 1)', () => {
  it('the chip-free header is narrower (no chip value ever exceeds "-") yet parses correctly', () => {
    const result = parseSolverOutput(`GW 1\n\n${CHIP_FREE_RESULTS_BLOCK}`)
    expect(result.solutions.map((s) => s.score)).toEqual([269.85, 268.32, 268.24])
  })

  it('the chip-enabled header is wider (padded for "BB2, TC3") yet parses correctly with the same parser', () => {
    const result = parseSolverOutput(`GW 2\nCHIP BB\nGW 3\nCHIP TC\n\n${CHIP_ENABLED_RESULTS_BLOCK}`)
    expect(result.solutions.map((s) => s.score)).toEqual([288.18, 286.65, 286.58])
  })
})

// ============================================================================
// A genuinely malformed row still fails, naming what could not be read
// (ticket #132, defect 1 DoD).
// ============================================================================

describe('parseSolverOutput — a genuinely malformed Results row (ticket #132, defect 1)', () => {
  it('throws naming the row and the column-count mismatch when a row is truncated (fewer cells than the header)', () => {
    const truncatedLog = `GW 1

Results
  iter  sell    buy         chip      score
     0  Wirtz   Szoboszlai
`
    expect(() => parseSolverOutput(truncatedLog)).toThrow(SolverOutputParseError)
    expect(() => parseSolverOutput(truncatedLog)).toThrow(/malformed row/)
    try {
      parseSolverOutput(truncatedLog)
      expect.unreachable('parseSolverOutput should have thrown')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      expect(message).toContain('expected 5 columns')
      expect(message).toContain('Wirtz')
    }
  })
})

// ============================================================================
// The cross-check — a chip-free log's cross-check is agreement, and a "-" in
// the table with a real CHIP line in the body is a genuine disagreement.
// (Ticket #132, defect 1 DoD.)
// ============================================================================

describe('parseSolverOutput — the cross-check on a chip-free log (ticket #132, defect 1)', () => {
  it('passes: "-" in the Results table with no CHIP line anywhere in the body is agreement, not a missing reading', () => {
    const fullLog = `GW 1
GW 2
GW 3

${CHIP_FREE_RESULTS_BLOCK}`
    expect(() => parseSolverOutput(fullLog)).not.toThrow()
    const result = parseSolverOutput(fullLog)
    expect(result.solutions.every((s) => s.chips.length === 0)).toBe(true)
  })

  it('fails: "-" in the Results table but a real "CHIP TC" line in the body is a genuine disagreement', () => {
    const disagreeingLog = `GW 1
GW 2
CHIP TC
GW 3

${CHIP_FREE_RESULTS_BLOCK}`
    expect(() => parseSolverOutput(disagreeingLog)).toThrow(SolverOutputParseError)
    expect(() => parseSolverOutput(disagreeingLog)).toThrow(/disagree/)
  })
})

// ============================================================================
// An empty chip column ("-") yields no chips for that solution, not an
// error — corrected to use the real placeholder (ticket #132, defect 1); see
// file header for why the old blank-column fixture is gone.
// ============================================================================

describe('parseSolverOutput — a chip-free solve (empty chip column, "-")', () => {
  const noChipLog = `Filtered player pool from 500 to 200 players
GW 1
GW 2
GW 3

Results
  iter  sell     buy      chip  score
     0  PlayerA  PlayerB  -     123.45
     1  PlayerC  PlayerD  -     120.00
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
     0  PlayerA  PlayerB  -     100.00
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
     0  PlayerA  PlayerB  -     50.00
`
    expect(parseSolverOutput(log).poolSizeAfter).toBeNull()
  })
})

// ============================================================================
// Source invariants — ticket #132, defect 1 DoD: "no numeric character
// offset constant appears in the parser." Column boundaries must be derived
// from each log's own header at parse time, never a stored position.
// ============================================================================

describe('solver-output.ts — source invariants (ticket #132, defect 1)', () => {
  it('is pure: supabase, fetch and process.env appear nowhere in it', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const sourcePath = fileURLToPath(new URL('./solver-output.ts', import.meta.url))
    const source = readFileSync(sourcePath, 'utf8')
    expect(source).not.toMatch(/supabase/i)
    expect(source).not.toMatch(/\bfetch\(/)
    expect(source).not.toMatch(/process\.env/)
  })

  it('derives column boundaries from the header, never a numeric character-offset constant (DoD, grep-checkable)', async () => {
    const { readFileSync } = await import('node:fs')
    const { fileURLToPath } = await import('node:url')
    const sourcePath = fileURLToPath(new URL('./solver-output.ts', import.meta.url))
    const source = readFileSync(sourcePath, 'utf8')
    // Position-based slicing (.slice/.substring/.substr/.charAt/.charCodeAt
    // with a numeric column-offset argument) is exactly the pattern that
    // broke on the chip-free log's different column widths — it must never
    // reappear here. Column splitting is whitespace-run-based instead (see
    // splitResultsColumns), derived from each log's own header at parse
    // time, not from a stored position.
    expect(source).not.toMatch(/\.(slice|substring|substr|charAt|charCodeAt)\(/)
  })
})
