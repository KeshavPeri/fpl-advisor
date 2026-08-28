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


// ============================================================================
// TICKET #66 — the full captured logs, verbatim, both halves together (body
// solution blocks AND the Results table). #132's fixtures above were
// Results-table extracts only; the defect this ticket fixes lives in the
// relationship between the body and the table, so only a whole-log fixture
// can catch it. Both logs below are quoted character-for-character from the
// two solves captured the same production run, 28 August 2026 (the console
// noise before "Filtered player pool..." — the HiGHS solve trace — carries
// no Solution/GW/CHIP/Results text and is omitted; everything from
// "Filtered player pool..." to the end of the log is verbatim).
// ============================================================================

const FULL_CHIP_FREE_LOG = `Filtered player pool from 616 to 311 players
This solver is free for personal, educational, or non-commercial use under the Apache License 2.0. Commercial entities must obtain a Commercial License before accessing, viewing, or using the code for any commercial purposes. Unauthorized access or use by commercial entities without a valid commercial license is strictly prohibited. To obtain a commercial license, please contact us at info@fploptimized.com.
Version: 1 - 45131c5
Using FT values of {'2': 2, '3': 1.6, '4': 1.3, '5': 1.1}


Solution 1
    ** GW 2:
    ITB=0.0->0.5, FT=1, PT=0, NT=1
    Buy 368 - Szoboszlai
    Sell 366 - Wirtz

    Lineup:
    	Kinsky (3.32)
    	Calafiori (3.29), Muharemović (3.86), Maguire (6.97, V)
    	Groß (3.33), Mbeumo (6.08), Szoboszlai (6.33), B.Fernandes (7.12, C)
    	Calvert-Lewin (4.1), João Pedro (5.05), Haaland (5.68)
    Bench:
    	Verbruggen (2.88), Ajer (2.66), O'Shea (2.34), I.Sangaré (2.3)
    Lineup xPts: 62.24


    ** GW 3:
    ITB=0.5->0.1, FT=1, PT=0, NT=1
    Buy 388 - Guéhi
    Sell 8 - Calafiori

    Lineup:
    	Verbruggen (3.72)
    	Muharemović (2.93), Ajer (3.57), Maguire (4.44), Guéhi (9.95, C)
    	Groß (4.06), Mbeumo (4.5), B.Fernandes (5.31), Szoboszlai (6.68)
    	Calvert-Lewin (3.41), Haaland (7.08, V)
    Bench:
    	Kinsky (3.04), João Pedro (2.83), O'Shea (2.77), I.Sangaré (2.7)
    Lineup xPts: 65.57


    ** GW 4:
    ITB=0.1->0.1, FT=1, PT=0, NT=1
    Buy 445 - Thiaw
    Sell 334 - Muharemović

    Lineup:
    	Verbruggen (3.71)
    	Maguire (4.09), Thiaw (4.15), Guéhi (5.36)
    	Groß (4.06), Mbeumo (4.22), B.Fernandes (4.99), Szoboszlai (6.41, V)
    	Calvert-Lewin (4.12), Haaland (4.71), João Pedro (6.55, C)
    Bench:
    	Kinsky (3.47), O'Shea (2.69), Ajer (2.38), I.Sangaré (2.3)
    Lineup xPts: 58.92


    ** GW 5:
    ITB=0.1->0.1, FT=1, PT=0, NT=1
    Buy 593 - Dedić
    Sell 87 - Ajer

    Lineup:
    	Kinsky (3.15)
    	Maguire (4.35), Dedić (6.54), Thiaw (7.5, V), Guéhi (9.29, C)
    	Mbeumo (4.43), Szoboszlai (4.96), B.Fernandes (5.22)
    	João Pedro (4.09), Calvert-Lewin (4.32), Haaland (6.81)
    Bench:
    	Verbruggen (2.69), Groß (3.01), I.Sangaré (2.89), O'Shea (2.7)
    Lineup xPts: 69.94


    ** GW 6:
    ITB=0.1->0.1, FT=1, PT=0, NT=1
    Buy 569 - Gonzalo
    Sell 346 - Calvert-Lewin

    Lineup:
    	Verbruggen (3.32)
    	Dedić (4.49), Thiaw (5.33), Guéhi (5.43), Maguire (5.88, V)
    	Szoboszlai (5.18), Mbeumo (5.46), B.Fernandes (6.41, C)
    	Haaland (4.77), João Pedro (4.82), Gonzalo (5.42)
    Bench:
    	Kinsky (2.88), Groß (3.75), O'Shea (3.27), I.Sangaré (2.45)
    Lineup xPts: 62.91

Total xPts over the horizon: 319.58



Solution 2
    ** GW 2:
    ITB=0.0->1.5, FT=1, PT=0, NT=1
    Buy 68 - Tavernier
    Sell 366 - Wirtz

    Lineup:
    	Kinsky (3.32)
    	Calafiori (3.29), Muharemović (3.86), Maguire (6.97, V)
    	Groß (3.33), Tavernier (5.49), Mbeumo (6.08), B.Fernandes (7.12, C)
    	Calvert-Lewin (4.1), João Pedro (5.05), Haaland (5.68)
    Bench:
    	Verbruggen (2.88), Ajer (2.66), O'Shea (2.34), I.Sangaré (2.3)
    Lineup xPts: 61.4


    ** GW 3:
    ITB=1.5->0.5, FT=1, PT=0, NT=1
    Buy 388 - Guéhi
    Sell 334 - Muharemović

    Lineup:
    	Verbruggen (3.72)
    	Ajer (3.57), Maguire (4.44), Calafiori (4.6), Guéhi (9.95, C)
    	Groß (4.06), Tavernier (4.31), Mbeumo (4.5), B.Fernandes (5.31)
    	Calvert-Lewin (3.41), Haaland (7.08, V)
    Bench:
    	Kinsky (3.04), João Pedro (2.83), O'Shea (2.77), I.Sangaré (2.7)
    Lineup xPts: 64.88


    ** GW 4:
    ITB=0.5->0.0, FT=1, PT=0, NT=1
    Buy 445 - Thiaw
    Sell 87 - Ajer

    Lineup:
    	Verbruggen (3.71)
    	Maguire (4.09), Thiaw (4.15), Calafiori (4.42), Guéhi (5.36, V)
    	Mbeumo (4.22), B.Fernandes (4.99), Tavernier (5.22)
    	Calvert-Lewin (4.12), Haaland (4.71), João Pedro (6.55, C)
    Bench:
    	Kinsky (3.47), Groß (4.06), O'Shea (2.69), I.Sangaré (2.3)
    Lineup xPts: 58.09


    ** GW 5:
    ITB=0.0->0.6, FT=1, PT=0, NT=1
    Buy 447 - Botman
    Sell 8 - Calafiori

    Lineup:
    	Kinsky (3.15)
    	Maguire (4.35), Botman (7.27), Thiaw (7.5, V), Guéhi (9.29, C)
    	Mbeumo (4.43), Tavernier (4.7), B.Fernandes (5.22)
    	João Pedro (4.09), Calvert-Lewin (4.32), Haaland (6.81)
    Bench:
    	Verbruggen (2.69), Groß (3.01), I.Sangaré (2.89), O'Shea (2.7)
    Lineup xPts: 70.41


    ** GW 6:
    ITB=0.6->0.1, FT=1, PT=0, NT=1
    Buy 237 - Ndiaye
    Sell 124 - Groß

    Lineup:
    	Verbruggen (3.32)
    	Botman (5.2), Thiaw (5.33), Guéhi (5.43), Maguire (5.88, V)
    	Tavernier (4.31), Mbeumo (5.46), Ndiaye (5.67), B.Fernandes (6.41, C)
    	Haaland (4.77), João Pedro (4.82)
    Bench:
    	Kinsky (2.88), O'Shea (3.27), Calvert-Lewin (2.52), I.Sangaré (2.45)
    Lineup xPts: 63.01

Total xPts over the horizon: 317.78



Solution 3
    ** GW 2:
    ITB=0.0->0.0, FT=1, PT=0, NT=0

    Lineup:
    	Kinsky (3.32)
    	Calafiori (3.29), Muharemović (3.86), Maguire (6.97, V)
    	Groß (3.33), Wirtz (3.75), Mbeumo (6.08), B.Fernandes (7.12, C)
    	Calvert-Lewin (4.1), João Pedro (5.05), Haaland (5.68)
    Bench:
    	Verbruggen (2.88), Ajer (2.66), O'Shea (2.34), I.Sangaré (2.3)
    Lineup xPts: 59.66


    ** GW 3:
    ITB=0.0->3.0, FT=2, PT=0, NT=2
    Buy 388 - Guéhi
    Buy 368 - Szoboszlai
    Sell 426 - B.Fernandes
    Sell 304 - O'Shea

    Lineup:
    	Verbruggen (3.72)
    	Ajer (3.57), Maguire (4.44), Calafiori (4.6), Guéhi (9.95, C)
    	Wirtz (3.94), Groß (4.06), Mbeumo (4.5), Szoboszlai (6.68)
    	Calvert-Lewin (3.41), Haaland (7.08, V)
    Bench:
    	Kinsky (3.04), Muharemović (2.93), João Pedro (2.83), I.Sangaré (2.7)
    Lineup xPts: 65.88


    ** GW 4:
    ITB=3.0->1.0, FT=1, PT=0, NT=1
    Buy 154 - Palmer
    Sell 366 - Wirtz

    Lineup:
    	Verbruggen (3.71)
    	Maguire (4.09), Calafiori (4.42), Guéhi (5.36)
    	Groß (4.06), Mbeumo (4.22), Szoboszlai (6.41), Palmer (7.53, C)
    	Calvert-Lewin (4.12), Haaland (4.71), João Pedro (6.55, V)
    Bench:
    	Kinsky (3.47), Muharemović (3.87), Ajer (2.38), I.Sangaré (2.3)
    Lineup xPts: 62.72


    ** GW 5:
    ITB=1.0->0.5, FT=1, PT=0, NT=1
    Buy 445 - Thiaw
    Sell 87 - Ajer

    Lineup:
    	Kinsky (3.15)
    	Muharemović (4.17), Maguire (4.35), Thiaw (7.5, V), Guéhi (9.29, C)
    	Mbeumo (4.43), Palmer (4.48), Szoboszlai (4.96)
    	João Pedro (4.09), Calvert-Lewin (4.32), Haaland (6.81)
    Bench:
    	Verbruggen (2.69), Calafiori (3.8), Groß (3.01), I.Sangaré (2.89)
    Lineup xPts: 66.83


    ** GW 6:
    ITB=0.5->0.5, FT=1, PT=0, NT=1
    Buy 569 - Gonzalo
    Sell 346 - Calvert-Lewin

    Lineup:
    	Verbruggen (3.32)
    	Calafiori (4.79), Thiaw (5.33), Guéhi (5.43), Maguire (5.88, C)
    	Szoboszlai (5.18), Palmer (5.29), Mbeumo (5.46, V)
    	Haaland (4.77), João Pedro (4.82), Gonzalo (5.42)
    Bench:
    	Kinsky (2.88), Groß (3.75), I.Sangaré (2.45), Muharemović (2.02)
    Lineup xPts: 61.56

Total xPts over the horizon: 316.65




Transfer Overview

Solution 1
	GW2: Wirtz -> Szoboszlai
	GW3: Calafiori -> Guéhi
	GW4: Muharemović -> Thiaw
	GW5: Ajer -> Dedić
	GW6: Calvert-Lewin -> Gonzalo

Solution 2
	GW2: Wirtz -> Tavernier
	GW3: Muharemović -> Guéhi
	GW4: Ajer -> Thiaw
	GW5: Calafiori -> Botman
	GW6: Groß -> Ndiaye

Solution 3
	GW2: Roll
	GW3: O'Shea, B.Fernandes -> Guéhi, Szoboszlai
	GW4: Wirtz -> Palmer
	GW5: Ajer -> Thiaw
	GW6: Calvert-Lewin -> Gonzalo


Results
  iter  sell    buy         chip      score
     0  Wirtz   Szoboszlai  -        269.85
     1  Wirtz   Tavernier   -        268.32
     2  -       -           -        268.24
`

const FULL_CHIP_ENABLED_LOG = `Filtered player pool from 616 to 311 players
This solver is free for personal, educational, or non-commercial use under the Apache License 2.0. Commercial entities must obtain a Commercial License before accessing, viewing, or using the code for any commercial purposes. Unauthorized access or use by commercial entities without a valid commercial license is strictly prohibited. To obtain a commercial license, please contact us at info@fploptimized.com.
Version: 1 - 45131c5
Using FT values of {'2': 2, '3': 1.6, '4': 1.3, '5': 1.1}


Solution 1
    ** GW 2:
    CHIP BB
    ITB=0.0->0.5, FT=1, PT=0, NT=1
    Buy 368 - Szoboszlai
    Sell 366 - Wirtz

    Lineup:
    	Verbruggen (2.88), Kinsky (3.32)
    	O'Shea (2.34), Ajer (2.66), Calafiori (3.29), Muharemović (3.86), Maguire (6.97, V)
    	I.Sangaré (2.3), Groß (3.33), Mbeumo (6.08), Szoboszlai (6.33), B.Fernandes (7.12, C)
    	Calvert-Lewin (4.1), João Pedro (5.05), Haaland (5.68)
    Bench:

    Lineup xPts: 72.41


    ** GW 3:
    CHIP TC
    ITB=0.5->0.1, FT=1, PT=0, NT=1
    Buy 388 - Guéhi
    Sell 8 - Calafiori

    Lineup:
    	Verbruggen (3.72)
    	Muharemović (2.93), Ajer (3.57), Maguire (4.44), Guéhi (9.95, C)
    	Groß (4.06), Mbeumo (4.5), B.Fernandes (5.31), Szoboszlai (6.68)
    	Calvert-Lewin (3.41), Haaland (7.08, V)
    Bench:
    	Kinsky (3.04), João Pedro (2.83), O'Shea (2.77), I.Sangaré (2.7)
    Lineup xPts: 75.52


    ** GW 4:
    ITB=0.1->0.1, FT=1, PT=0, NT=1
    Buy 445 - Thiaw
    Sell 334 - Muharemović

    Lineup:
    	Verbruggen (3.71)
    	Maguire (4.09), Thiaw (4.15), Guéhi (5.36)
    	Groß (4.06), Mbeumo (4.22), B.Fernandes (4.99), Szoboszlai (6.41, V)
    	Calvert-Lewin (4.12), Haaland (4.71), João Pedro (6.55, C)
    Bench:
    	Kinsky (3.47), O'Shea (2.69), Ajer (2.38), I.Sangaré (2.3)
    Lineup xPts: 58.92


    ** GW 5:
    ITB=0.1->0.1, FT=1, PT=0, NT=1
    Buy 593 - Dedić
    Sell 87 - Ajer

    Lineup:
    	Kinsky (3.15)
    	Maguire (4.35), Dedić (6.54), Thiaw (7.5, V), Guéhi (9.29, C)
    	Mbeumo (4.43), Szoboszlai (4.96), B.Fernandes (5.22)
    	João Pedro (4.09), Calvert-Lewin (4.32), Haaland (6.81)
    Bench:
    	Verbruggen (2.69), Groß (3.01), I.Sangaré (2.89), O'Shea (2.7)
    Lineup xPts: 69.94


    ** GW 6:
    ITB=0.1->0.1, FT=1, PT=0, NT=1
    Buy 569 - Gonzalo
    Sell 346 - Calvert-Lewin

    Lineup:
    	Verbruggen (3.32)
    	Dedić (4.49), Thiaw (5.33), Guéhi (5.43), Maguire (5.88, V)
    	Szoboszlai (5.18), Mbeumo (5.46), B.Fernandes (6.41, C)
    	Haaland (4.77), João Pedro (4.82), Gonzalo (5.42)
    Bench:
    	Kinsky (2.88), Groß (3.75), O'Shea (3.27), I.Sangaré (2.45)
    Lineup xPts: 62.91

Total xPts over the horizon: 339.70



Solution 2
    ** GW 2:
    CHIP BB
    ITB=0.0->1.5, FT=1, PT=0, NT=1
    Buy 68 - Tavernier
    Sell 366 - Wirtz

    Lineup:
    	Verbruggen (2.88), Kinsky (3.32)
    	O'Shea (2.34), Ajer (2.66), Calafiori (3.29), Muharemović (3.86), Maguire (6.97, V)
    	I.Sangaré (2.3), Groß (3.33), Tavernier (5.49), Mbeumo (6.08), B.Fernandes (7.12, C)
    	Calvert-Lewin (4.1), João Pedro (5.05), Haaland (5.68)
    Bench:

    Lineup xPts: 71.57


    ** GW 3:
    CHIP TC
    ITB=1.5->0.5, FT=1, PT=0, NT=1
    Buy 388 - Guéhi
    Sell 334 - Muharemović

    Lineup:
    	Verbruggen (3.72)
    	Ajer (3.57), Maguire (4.44), Calafiori (4.6), Guéhi (9.95, C)
    	Groß (4.06), Tavernier (4.31), Mbeumo (4.5), B.Fernandes (5.31)
    	Calvert-Lewin (3.41), Haaland (7.08, V)
    Bench:
    	Kinsky (3.04), João Pedro (2.83), O'Shea (2.77), I.Sangaré (2.7)
    Lineup xPts: 74.83


    ** GW 4:
    ITB=0.5->0.0, FT=1, PT=0, NT=1
    Buy 445 - Thiaw
    Sell 87 - Ajer

    Lineup:
    	Verbruggen (3.71)
    	Maguire (4.09), Thiaw (4.15), Calafiori (4.42), Guéhi (5.36, V)
    	Mbeumo (4.22), B.Fernandes (4.99), Tavernier (5.22)
    	Calvert-Lewin (4.12), Haaland (4.71), João Pedro (6.55, C)
    Bench:
    	Kinsky (3.47), Groß (4.06), O'Shea (2.69), I.Sangaré (2.3)
    Lineup xPts: 58.09


    ** GW 5:
    ITB=0.0->0.6, FT=1, PT=0, NT=1
    Buy 447 - Botman
    Sell 8 - Calafiori

    Lineup:
    	Kinsky (3.15)
    	Maguire (4.35), Botman (7.27), Thiaw (7.5, V), Guéhi (9.29, C)
    	Mbeumo (4.43), Tavernier (4.7), B.Fernandes (5.22)
    	João Pedro (4.09), Calvert-Lewin (4.32), Haaland (6.81)
    Bench:
    	Verbruggen (2.69), Groß (3.01), I.Sangaré (2.89), O'Shea (2.7)
    Lineup xPts: 70.41


    ** GW 6:
    ITB=0.6->0.1, FT=1, PT=0, NT=1
    Buy 237 - Ndiaye
    Sell 124 - Groß

    Lineup:
    	Verbruggen (3.32)
    	Botman (5.2), Thiaw (5.33), Guéhi (5.43), Maguire (5.88, V)
    	Tavernier (4.31), Mbeumo (5.46), Ndiaye (5.67), B.Fernandes (6.41, C)
    	Haaland (4.77), João Pedro (4.82)
    Bench:
    	Kinsky (2.88), O'Shea (3.27), Calvert-Lewin (2.52), I.Sangaré (2.45)
    Lineup xPts: 63.01

Total xPts over the horizon: 337.90



Solution 3
    ** GW 2:
    CHIP BB
    ITB=0.0->0.0, FT=1, PT=0, NT=0

    Lineup:
    	Verbruggen (2.88), Kinsky (3.32)
    	O'Shea (2.34), Ajer (2.66), Calafiori (3.29), Muharemović (3.86), Maguire (6.97, V)
    	I.Sangaré (2.3), Groß (3.33), Wirtz (3.75), Mbeumo (6.08), B.Fernandes (7.12, C)
    	Calvert-Lewin (4.1), João Pedro (5.05), Haaland (5.68)
    Bench:

    Lineup xPts: 69.83


    ** GW 3:
    CHIP TC
    ITB=0.0->3.0, FT=2, PT=0, NT=2
    Buy 388 - Guéhi
    Buy 368 - Szoboszlai
    Sell 426 - B.Fernandes
    Sell 304 - O'Shea

    Lineup:
    	Verbruggen (3.72)
    	Ajer (3.57), Maguire (4.44), Calafiori (4.6), Guéhi (9.95, C)
    	Wirtz (3.94), Groß (4.06), Mbeumo (4.5), Szoboszlai (6.68)
    	Calvert-Lewin (3.41), Haaland (7.08, V)
    Bench:
    	Kinsky (3.04), Muharemović (2.93), João Pedro (2.83), I.Sangaré (2.7)
    Lineup xPts: 75.82


    ** GW 4:
    ITB=3.0->1.0, FT=1, PT=0, NT=1
    Buy 154 - Palmer
    Sell 366 - Wirtz

    Lineup:
    	Verbruggen (3.71)
    	Maguire (4.09), Calafiori (4.42), Guéhi (5.36)
    	Groß (4.06), Mbeumo (4.22), Szoboszlai (6.41), Palmer (7.53, C)
    	Calvert-Lewin (4.12), Haaland (4.71), João Pedro (6.55, V)
    Bench:
    	Kinsky (3.47), Muharemović (3.87), Ajer (2.38), I.Sangaré (2.3)
    Lineup xPts: 62.72


    ** GW 5:
    ITB=1.0->0.5, FT=1, PT=0, NT=1
    Buy 445 - Thiaw
    Sell 87 - Ajer

    Lineup:
    	Kinsky (3.15)
    	Muharemović (4.17), Maguire (4.35), Thiaw (7.5, V), Guéhi (9.29, C)
    	Mbeumo (4.43), Palmer (4.48), Szoboszlai (4.96)
    	João Pedro (4.09), Calvert-Lewin (4.32), Haaland (6.81)
    Bench:
    	Verbruggen (2.69), Calafiori (3.8), Groß (3.01), I.Sangaré (2.89)
    Lineup xPts: 66.83


    ** GW 6:
    ITB=0.5->0.5, FT=1, PT=0, NT=1
    Buy 569 - Gonzalo
    Sell 346 - Calvert-Lewin

    Lineup:
    	Verbruggen (3.32)
    	Calafiori (4.79), Thiaw (5.33), Guéhi (5.43), Maguire (5.88, C)
    	Szoboszlai (5.18), Palmer (5.29), Mbeumo (5.46, V)
    	Haaland (4.77), João Pedro (4.82), Gonzalo (5.42)
    Bench:
    	Kinsky (2.88), Groß (3.75), I.Sangaré (2.45), Muharemović (2.02)
    Lineup xPts: 61.56

Total xPts over the horizon: 336.77




Transfer Overview

Solution 1
	GW2: (BB) Wirtz -> Szoboszlai
	GW3: (TC) Calafiori -> Guéhi
	GW4: Muharemović -> Thiaw
	GW5: Ajer -> Dedić
	GW6: Calvert-Lewin -> Gonzalo

Solution 2
	GW2: (BB) Wirtz -> Tavernier
	GW3: (TC) Muharemović -> Guéhi
	GW4: Ajer -> Thiaw
	GW5: Calafiori -> Botman
	GW6: Groß -> Ndiaye

Solution 3
	GW2: (BB) Roll
	GW3: (TC) O'Shea, B.Fernandes -> Guéhi, Szoboszlai
	GW4: Wirtz -> Palmer
	GW5: Ajer -> Thiaw
	GW6: Calvert-Lewin -> Gonzalo


Results
  iter  sell    buy         chip        score
     0  Wirtz   Szoboszlai  BB2, TC3   288.18
     1  Wirtz   Tavernier   BB2, TC3   286.65
     2  -       -           BB2, TC3   286.58
`

describe('parseSolverOutput — the full captured chip-enabled log, body and Results table together (ticket #66)', () => {
  it('passes the cross-check: all three solutions agree on BB in gameweek 2 and TC in gameweek 3 (the test that was missing)', () => {
    const result = parseSolverOutput(FULL_CHIP_ENABLED_LOG)
    expect(result.solutions).toHaveLength(3)
    for (const solution of result.solutions) {
      expect(solution.chips).toEqual([
        { chipCode: 'BB', gameweekId: 2 },
        { chipCode: 'TC', gameweekId: 3 },
      ])
    }
    expect(result.solutions.map((s) => s.score)).toEqual([288.18, 286.65, 286.58])
  })

  it('reads the buy/sell columns matching the body\'s own transfers, confirming the same solution was compared on both sides', () => {
    const result = parseSolverOutput(FULL_CHIP_ENABLED_LOG)
    expect(result.solutions[0].playerBought).toBe('Szoboszlai')
    expect(result.solutions[1].playerBought).toBe('Tavernier')
    expect(result.solutions[2].playerBought).toBeNull() // Solution 3 is a roll
  })
})

describe('parseSolverOutput — the full captured chip-free log still cross-checks as agreement (ticket #66)', () => {
  it('passes with no chips anywhere, using the real Solution-block body (not the flat #132 fixture)', () => {
    const result = parseSolverOutput(FULL_CHIP_FREE_LOG)
    expect(result.solutions).toHaveLength(3)
    for (const solution of result.solutions) {
      expect(solution.chips).toEqual([])
    }
    expect(result.solutions.map((s) => s.score)).toEqual([269.85, 268.32, 268.24])
  })
})

// ============================================================================
// TICKET #66 — "Solution N" maps to "iter N-1", asserted directly.
// ============================================================================

describe('parseSolverOutput — "Solution N" in the body maps to "iter N-1" in the Results table (ticket #66)', () => {
  it('checks a Solution 1 block that differs from Solution 3 against iter 0 and iter 2 respectively, and agrees', () => {
    const log = `Solution 1
    ** GW 2:
    CHIP BB

Solution 2
    ** GW 2:
    CHIP TC

Solution 3
    ** GW 2:
    CHIP TC

Results
  iter  sell  buy  chip  score
     0  A     B    BB2   10.00
     1  A     B    TC2   9.00
     2  A     B    TC2   8.00
`
    // Solution 1 (BB2) differs from Solution 3 (TC2). Under the correct
    // mapping, Solution 1 -> iter 0 (BB2) and Solution 3 -> iter 2 (TC2) —
    // both agree, so the whole log agrees and the cross-check does not throw.
    expect(() => parseSolverOutput(log)).not.toThrow()
    const result = parseSolverOutput(log)
    expect(result.solutions[0].chips).toEqual([{ chipCode: 'BB', gameweekId: 2 }])
    expect(result.solutions[2].chips).toEqual([{ chipCode: 'TC', gameweekId: 2 }])
  })

  it('rejects a fixture that a naive same-number (Solution N vs iter N, no shift) mapping would wrongly accept', () => {
    // Solution 1 reads TC2, Solution 2 reads BB2, Solution 3 reads no chip.
    // The Results table is deliberately shifted by one: iter 0 says "-",
    // iter 1 says "TC2", iter 2 says "BB2". A NAIVE same-number mapping
    // (Solution N checked against iter N, not iter N-1) would compare
    // Solution 1 (TC2) to iter 1 (TC2) — match — and Solution 2 (BB2) to
    // iter 2 (BB2) — match — finding no disagreement at all. The CORRECT
    // mapping (Solution N -> iter N-1) compares Solution 1 (TC2) to iter 0
    // ("-"/none) instead, which is a genuine disagreement, so the correct
    // implementation must throw here even though the naive one would not.
    const log = `Solution 1
    ** GW 2:
    CHIP TC

Solution 2
    ** GW 2:
    CHIP BB

Solution 3
    ** GW 2:

Results
  iter  sell  buy  chip  score
     0  A     B    -     10.00
     1  A     B    TC2   9.00
     2  A     B    BB2   8.00
`
    expect(() => parseSolverOutput(log)).toThrow(SolverOutputParseError)
    expect(() => parseSolverOutput(log)).toThrow(/disagree/)
    try {
      parseSolverOutput(log)
      expect.unreachable('parseSolverOutput should have thrown')
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err)
      expect(message).toContain('solution 0')
    }
  })
})

// ============================================================================
// TICKET #66 — leading whitespace on Solution / ** GW n: / CHIP XX lines.
// ============================================================================

describe('parseSolverOutput — leading whitespace on Solution, "** GW n:" and "CHIP XX" lines (ticket #66)', () => {
  it('tolerates indentation on all three line kinds, matching the real captured log\'s four-space indent', () => {
    const log = `    Solution 1
        ** GW 2:
        CHIP BB

Results
  iter  sell  buy  chip  score
     0  A     B    BB2   10.00
`
    const result = parseSolverOutput(log)
    expect(result.solutions[0].chips).toEqual([{ chipCode: 'BB', gameweekId: 2 }])
  })
})

// ============================================================================
// TICKET #66 — a chip is attributed to the gameweek of the header it sits
// under, not to whichever gameweek happened to be seen first.
// ============================================================================

describe('parseSolverOutput — a chip is attributed to the "** GW n:" header it sits under (ticket #66)', () => {
  it('attributes two chips in one solution to their own, different gameweeks', () => {
    const log = `Solution 1
    ** GW 2:
    CHIP BB
    ** GW 4:
    CHIP TC

Results
  iter  sell  buy  chip        score
     0  A     B    BB2, TC4   10.00
`
    const result = parseSolverOutput(log)
    expect(result.solutions[0].chips).toEqual([
      { chipCode: 'BB', gameweekId: 2 },
      { chipCode: 'TC', gameweekId: 4 },
    ])
  })
})
