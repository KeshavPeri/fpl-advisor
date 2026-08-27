// Parses the chip decision out of the solver's raw stdout — ticket #126
// (feature-list item 27), unblocked by the chip probe (#114) and its finding
// in docs/solver-notes.md: none of the results-CSV columns carry a chip
// decision, but dev/solver.py's stdout does, in structured form, at the very
// end, in a `Results` table:
//
//   Results
//     iter  sell         buy        chip        score
//        0  Muharemović  Thiaw      TC2, BB4   256.48
//        1  Wirtz        Tavernier  TC2, BB4   256.29
//        2  Muharemović  Botman     TC2, BB4   255.98
//
// `TC2, BB4` means Triple Captain in gameweek 2, Bench Boost in gameweek 4.
// This is the parse target: one compact line per `solution_index` (the
// `iter` column), the same key solver_picks and recommendations already
// use. The literal text above — quoted verbatim in the ticket, "Verified
// from the real log, 28 August 2026" — is this module's one directly
// verified fixture; everything else about the log's shape is inferred (see
// "WHAT IS INFERRED, NOT VERIFIED" below), same discipline
// docs/solver-notes.md's own "Resolved" section applies: write down what is
// actually known, and say plainly what is not.
//
// ============================================================================
// THE CROSS-CHECK — the most important thing this file does.
// ============================================================================
// A silent chip misread would put a wrong number in front of a decision
// (product-brief.md §6a). The ticket names a second, independent source in
// the same log: "a CHIP TC / CHIP BB line inside each gameweek block."
// parseSolverOutput() reads BOTH the `Results` table and these per-gameweek
// `CHIP XX` lines, and THROWS if they disagree, naming both readings. It
// never picks one. Two readings that agree are evidence; one reading is a
// guess — the same discipline that caught the doubled solver_picks figure in
// #72.
//
// ============================================================================
// WHAT IS INFERRED, NOT VERIFIED.
// ============================================================================
// The ticket quotes exactly one real fragment: the `Results` table above.
// Everything about how the per-gameweek `CHIP TC` / `CHIP BB` lines are laid
// out — their surrounding "gameweek block" — is NOT quoted anywhere in the
// ticket text, so it cannot be verified here the way the Results table can.
// Two structural choices below follow from close reading of the ticket's own
// wording, not from a captured log:
//
//   1. The ticket says "a CHIP TC / CHIP BB line inside each gameweek
//      block" (singular set of gameweek blocks) and "a Transfer Overview
//      section" (singular), not "one per iteration" — and in the one real
//      example given, all three solutions/iterations report the IDENTICAL
//      chip decision (TC2, BB4 for every row). This module therefore treats
//      the per-gameweek CHIP lines as ONE flat reading for the whole log
//      (gameweek headers `GW <n>` followed by `CHIP <code>` lines), not one
//      per iteration, and cross-checks it against EVERY solution's own
//      Results-table chip reading. If a future real log shows genuinely
//      different chip timings across iterations with their own separate
//      gameweek blocks, this will need revisiting — but it will revisit
//      LOUDLY: a real per-solution divergence that this flat model cannot
//      represent shows up as a cross-check failure, never a silent wrong
//      answer, because a divergent Results row will not match the one flat
//      reading and this module throws.
//
//   2. The gameweek header format (`GW <n>` on its own line) and the CHIP
//      line format (`CHIP TC` / `CHIP BB` on their own line) are the
//      simplest literal reading of "a CHIP TC / CHIP BB line inside each
//      gameweek block" — a gameweek marker line, then a chip marker line.
//
// The ticket's own definition of done accepts this limit explicitly ("What a
// substitute cannot catch: the parser is tested against one captured log,
// not against every shape the solver can print") and defers real-world
// confirmation to the human post-merge check (dispatch Solver run, confirm a
// chip advisory actually appears). If that check shows a different real
// shape, update GW_HEADER_RE / CHIP_LINE_RE below — the Results-table parser
// and the cross-check contract (throw, never guess) do not need to change.
//
// ============================================================================
// Chip token shape — pinned, not guessed.
// ============================================================================
// "The chip codes observed are TC and BB, immediately followed by the
// gameweek number with no separator, comma-space delimited between chips:
// TC2, BB4. Do not assume WC or FH format — neither has ever been observed,
// both are out of scope" (the ticket's own words). CHIP_TOKEN_RE below
// matches exactly two uppercase letters followed by digits — it will happily
// parse a future WC/FH token IF it happens to share that same two-letter-
// plus-digits shape, but this module makes no claim about that; item 28 is
// what actually exercises Wildcard/Free Hit.
//
// ============================================================================
// Pure. No I/O — see scripts/lib/competition.ts and scripts/lib/lockdown.ts
// for the same shape. `supabase`, `fetch` and `process.env` appear nowhere
// in this file (ticket #126's own DoD, grep-checkable).

export interface ChipPlay {
  /** e.g. "TC", "BB" — verbatim from the log, never normalized or narrowed to a union (see file header on WC/FH). */
  chipCode: string
  /** The horizon gameweek this chip would be played in, e.g. 2 for "TC2". A real, absolute FPL gameweek id — matches the "week" column solver_picks already uses. */
  gameweekId: number
}

export interface SolverSolution {
  /** The Results table's own "iter" column — the same key solver_picks.solution_index already uses. */
  solutionIndex: number
  /** Empty when no chip was played in this solution — not an error, not omitted. */
  chips: readonly ChipPlay[]
  /** The Results table's own "score" column — this solution's objective. */
  score: number
}

export interface ParsedSolverOutput {
  solutions: readonly SolverSolution[]
  /** From "Filtered player pool from X to Y players" — the pool size AFTER prep_data's filters, i.e. what actually entered the solve. Null if the line never appeared. Same regex store-solver-output.ts's parseSolverLog already uses for the normal run; this module reads it independently so the chip-enabled run's own figure is available without importing across scripts (store-solver-output.ts is out of this ticket's scope — see the file's own header). */
  poolSizeAfter: number | null
}

export class SolverOutputParseError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'SolverOutputParseError'
  }
}

// ============================================================================
// Regexes
// ============================================================================

const POOL_SIZE_RE = /Filtered player pool from \d+ to (\d+) players/
const RESULTS_HEADER_LINE_RE = /^\s*iter\s+sell\s+buy\s+chip\s+score\s*$/i
/**
 * One Results-table data row. sell/buy are matched as `\S+` (a single
 * whitespace-free token) — FPL web_names have no internal spaces (verified
 * against the real example: "Muharemović", "Thiaw", "Wirtz", "Tavernier",
 * "Botman" are all single tokens). The chip group is OPTIONAL and, when
 * absent, consumes nothing — see parseChipColumn's own test coverage for the
 * empty-column case.
 */
const RESULTS_ROW_RE = /^\s*(\d+)\s+(\S+)\s+(\S+)\s+(?:([A-Z]{2}\d+(?:,\s*[A-Z]{2}\d+)*)\s+)?(-?\d+(?:\.\d+)?)\s*$/
const CHIP_TOKEN_RE = /^([A-Z]{2})(\d+)$/
/** A bare gameweek header line, e.g. "GW 2" or "GW2" — nothing else on the line, so this never matches a Transfer Overview line like "GW2: (TC) Muharemović -> Thiaw" (see file header). */
const GW_HEADER_RE = /^GW\s*(\d+)$/i
/** A bare per-gameweek chip line, e.g. "CHIP TC" — see file header for the format's provenance. */
const CHIP_LINE_RE = /^CHIP\s+([A-Z]{2})$/i

// ============================================================================
// Pool size
// ============================================================================

function parsePoolSize(logText: string): number | null {
  const match = POOL_SIZE_RE.exec(logText)
  return match ? Number(match[1]) : null
}

// ============================================================================
// Chip column — "TC2, BB4" -> [{chipCode:'TC',gameweekId:2},{chipCode:'BB',gameweekId:4}]
// ============================================================================

function parseChipColumn(raw: string | undefined): ChipPlay[] {
  if (!raw || raw.trim() === '') return []
  return raw.split(',').map((token) => {
    const trimmed = token.trim()
    const match = CHIP_TOKEN_RE.exec(trimmed)
    if (!match) {
      throw new SolverOutputParseError(
        `unrecognized chip token "${trimmed}" in the Results table's chip column (raw value: "${raw}"). Expected the shape ` +
          '"<2 uppercase letters><gameweek number>", e.g. "TC2".',
      )
    }
    return { chipCode: match[1], gameweekId: Number(match[2]) }
  })
}

// ============================================================================
// The Results table
// ============================================================================

function parseResultsTable(lines: readonly string[]): SolverSolution[] {
  const resultsIndex = lines.findIndex((line) => line.trim() === 'Results')
  if (resultsIndex === -1) {
    throw new SolverOutputParseError(
      'no "Results" table found in the solver output. This is a parse failure, not "no chip played" — an absent Results ' +
        'table must never be read as an empty advisory. The solve may have crashed, been infeasible, or hit its time limit ' +
        'with no incumbent (see scripts/store-solver-output.ts for how the normal run classifies those outcomes).',
    )
  }

  let cursor = resultsIndex + 1
  while (cursor < lines.length && lines[cursor].trim() === '') cursor++
  const headerLine = lines[cursor]
  if (!headerLine || !RESULTS_HEADER_LINE_RE.test(headerLine)) {
    throw new SolverOutputParseError(
      `the "Results" table's header row does not match the expected "iter sell buy chip score" shape ` +
        `(got: ${JSON.stringify(headerLine ?? '<end of log>')}).`,
    )
  }
  cursor++

  const solutions: SolverSolution[] = []
  while (cursor < lines.length && lines[cursor].trim() !== '') {
    const line = lines[cursor]
    const match = RESULTS_ROW_RE.exec(line)
    if (!match) break
    const [, iterStr, , , chipRaw, scoreStr] = match
    solutions.push({
      solutionIndex: Number(iterStr),
      chips: parseChipColumn(chipRaw),
      score: Number(scoreStr),
    })
    cursor++
  }

  if (solutions.length === 0) {
    throw new SolverOutputParseError('the "Results" table was found but no data rows could be parsed under its header row.')
  }

  return solutions
}

// ============================================================================
// Per-gameweek CHIP lines — the cross-check reading. See file header,
// "WHAT IS INFERRED, NOT VERIFIED", point 1: one flat reading for the whole
// log, not one per iteration.
// ============================================================================

function parseGameweekChipLines(lines: readonly string[]): ChipPlay[] {
  const chips: ChipPlay[] = []
  let currentGameweekId: number | null = null

  for (const rawLine of lines) {
    const line = rawLine.trim()
    if (line === 'Results') break // everything from here on is the compact table, not a gameweek block

    const gwMatch = GW_HEADER_RE.exec(line)
    if (gwMatch) {
      currentGameweekId = Number(gwMatch[1])
      continue
    }

    const chipMatch = CHIP_LINE_RE.exec(line)
    if (chipMatch && currentGameweekId !== null) {
      chips.push({ chipCode: chipMatch[1].toUpperCase(), gameweekId: currentGameweekId })
    }
  }

  return chips
}

// ============================================================================
// The cross-check itself
// ============================================================================

function chipKey(chip: ChipPlay): string {
  return `${chip.chipCode}${chip.gameweekId}`
}

function formatChips(chips: readonly ChipPlay[]): string {
  return chips.length === 0 ? '(none)' : chips.map(chipKey).join(', ')
}

function sameChips(a: readonly ChipPlay[], b: readonly ChipPlay[]): boolean {
  if (a.length !== b.length) return false
  const aKeys = a.map(chipKey).sort()
  const bKeys = b.map(chipKey).sort()
  return aKeys.every((key, i) => key === bKeys[i])
}

function crossCheckChips(solutions: readonly SolverSolution[], gameweekReading: readonly ChipPlay[]): void {
  for (const solution of solutions) {
    if (!sameChips(solution.chips, gameweekReading)) {
      throw new SolverOutputParseError(
        `solution ${solution.solutionIndex}: the Results table and the per-gameweek CHIP lines disagree on which chip(s) ` +
          `were played — Results table says [${formatChips(solution.chips)}], per-gameweek CHIP lines say ` +
          `[${formatChips(gameweekReading)}]. Refusing to pick one.`,
      )
    }
  }
}

// ============================================================================
// Entry point
// ============================================================================

export function parseSolverOutput(logText: string): ParsedSolverOutput {
  const normalized = logText.replace(/\r\n/g, '\n')
  const lines = normalized.split('\n')

  const solutions = parseResultsTable(lines)
  const gameweekReading = parseGameweekChipLines(lines)
  crossCheckChips(solutions, gameweekReading)

  return {
    solutions,
    poolSizeAfter: parsePoolSize(normalized),
  }
}
