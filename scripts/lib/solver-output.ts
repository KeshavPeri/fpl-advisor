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
// use. The literal text above — quoted verbatim in ticket #126, "Verified
// from the real log, 28 August 2026" — was this module's one directly
// verified fixture at the time it was written; everything else about the
// log's shape was inferred (see "WHAT IS INFERRED, NOT VERIFIED" below).
//
// ============================================================================
// TICKET #132 — the defect this ticket's own DoD predicted.
// ============================================================================
// #126's own definition of done said plainly: "a solve that plays no chip
// has never been observed." It hadn't. In production the chip-free solve —
// the NORMAL run, which is the common case — failed on every run:
// `the "Results" table was found but no data rows could be parsed under its
// header row.` Two real shapes, both captured from the same production run
// of 29 August 2026, exposed three accidents the original parser had baked
// in from its one example:
//
//   1. An empty cell is the literal token `-`, not blank, in EVERY column —
//      including `sell` and `buy` on a rolled transfer (no player sold, none
//      bought), not just `chip`. The old row regex treated the chip column's
//      absence as "nothing to consume" (an optional group matching zero
//      characters); a literal `-` character sitting in that column position
//      is a real character the regex had no path to consume, so the whole
//      row failed to match.
//   2. The header's own column spacing shifts between a chip-enabled log and
//      a chip-free one (the chip column is narrower when every value is a
//      bare `-` rather than "BB2, TC3"), because the table is column-padded
//      to fit whatever the widest value in each column happens to be. A
//      parser keyed to one log's exact spacing breaks on the other's.
//   3. The chip cell can itself contain a space — "BB2, TC3" is ONE cell of
//      two comma-separated tokens, not two whitespace-delimited fields.
//
// The fix below (see "COLUMN SPLITTING" further down) treats `-` as the
// literal empty-cell marker in every column, and derives column boundaries
// from each log's OWN header line at parse time — never from a stored
// character offset — so a shift in column padding between logs changes
// nothing about how the row is read. `SolverSolution` also gains
// `playerSold` / `playerBought` (`string | null`, `-` -> null) so a rolled
// transfer is representable at all; the old parser silently discarded both
// columns.
//
// The chip-enabled solve's own timing (BB in gameweek 2, TC in gameweek 3)
// differs from the chip probe's (#114, TC in gameweek 2, BB in gameweek 4) on
// a near-identical squad two days apart — #126's central design decision
// (compare the SAME night's two solves, not a different night's) is what
// makes that instability harmless: the chip-free baseline it is compared
// against is read from the very same run. See the Builder's report on ticket
// #132 for the actual delta measured (+18.33 over the horizon).
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
// WHAT WAS INFERRED, NOT VERIFIED — and what ticket #66 corrected.
// ============================================================================
// #126 had only the `Results` table as a real fragment; the per-gameweek
// body layout below it was inferred, not captured. Ticket #66 supplied the
// real captured logs (both a chip-free and a chip-enabled solve, 28 August
// 2026) and corrected two of #126's guesses:
//
//   1. The body is NOT one flat reading for the whole log — it is wrapped in
//      numbered `Solution N` blocks (1-based), one per Results-table `iter`
//      row (0-based, `iter = N-1` — see mapSolutionNumberToIterIndex below).
//      #126's flat model (no `Solution` header, one reading checked against
//      every row) happened to look correct on the one example #126 had,
//      where a reader that found NOTHING AT ALL was indistinguishable from a
//      reader working correctly on a chip-free log — both report "(none)".
//      That flat shape is kept working purely so #132's own tests (written
//      against the flat model) still pass unmodified; a real log always has
//      `Solution` headers and always takes the per-solution path.
//
//   2. The real gameweek header is `** GW <n>:` (with the leading `**` and
//      trailing `:`), indented inside its solution block — not the bare
//      `GW <n>` #126 guessed. GW_HEADER_RE below matches both shapes: the
//      real one, and the bare one #132's existing tests still use.
//
// The CHIP line itself (`CHIP TC` / `CHIP BB`, indented) was the one guess
// that held up unchanged.
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
// for the same shape. No database client, no network call and no
// environment-variable read appear anywhere below (ticket #126's own DoD,
// grep-checkable — this header deliberately never spells out the literal
// identifiers it is careful to avoid, the same discipline
// scripts/build-solver-input.ts's own file header uses).

export interface ChipPlay {
  /** e.g. "TC", "BB" — verbatim from the log, never normalized or narrowed to a union (see file header on WC/FH). */
  chipCode: string
  /** The horizon gameweek this chip would be played in, e.g. 2 for "TC2". A real, absolute FPL gameweek id — matches the "week" column solver_picks already uses. */
  gameweekId: number
}

export interface SolverSolution {
  /** The Results table's own "iter" column — the same key solver_picks.solution_index already uses. */
  solutionIndex: number
  /** The Results table's own "sell" column — the web_name of the player sold this solution, or null when the cell is the literal `-` (a rolled transfer, no player sold). Ticket #132, defect 1. */
  playerSold: string | null
  /** The Results table's own "buy" column — the web_name of the player bought this solution, or null when the cell is the literal `-` (a rolled transfer, no player bought). Ticket #132, defect 1. */
  playerBought: string | null
  /** Empty when no chip was played in this solution — not an error, not omitted. `-` in the Results table's chip column parses to this same empty array (ticket #132, defect 1) — never distinguished from a blank cell. */
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
const CHIP_TOKEN_RE = /^([A-Z]{2})(\d+)$/
/**
 * A body solution header, e.g. "Solution 1" — captured verbatim in the real chip-enabled log
 * (ticket #66). Body solution numbering is 1-based; the Results table's own "iter" column is
 * 0-based for the SAME solution — see mapSolutionNumberToIterIndex below, the one named place
 * that mapping lives.
 */
const SOLUTION_HEADER_RE = /^Solution\s+(\d+)$/i
/**
 * A gameweek header line inside a solution block. Matches BOTH the bare "GW 2" / "GW2" shape
 * (ticket #126/#132's original, best-effort construction — kept so those existing tests still
 * pass unmodified) and the real captured shape "** GW 2:" (ticket #66, verified from the real
 * log, indented four spaces inside its solution block — leading whitespace is stripped by the
 * caller's `.trim()` before this regex ever sees the line). Anchored end-to-end so it never
 * matches a Transfer Overview line like "GW2: (TC) Muharemović -> Thiaw", which has real content
 * after the colon.
 */
const GW_HEADER_RE = /^\*{0,2}\s*GW\s*(\d+)\s*:?\s*\*{0,2}$/i
/** A per-gameweek chip line, e.g. "CHIP TC" — indented in the real log, tolerated the same way as GW_HEADER_RE (leading whitespace stripped by the caller's `.trim()`). */
const CHIP_LINE_RE = /^CHIP\s+([A-Z]{2})$/i

/** The literal placeholder the solver prints for an empty cell — in sell, buy AND chip alike (ticket #132, defect 1). Never blank. */
const EMPTY_CELL = '-'

/** The Results table's column names, in order — stable, per the ticket's own wording ("the header names are stable; their positions are not"). Column WIDTHS and spacing are never assumed; see splitResultsColumns below. */
const RESULTS_COLUMNS = ['iter', 'sell', 'buy', 'chip', 'score'] as const

// ============================================================================
// COLUMN SPLITTING — ticket #132, defect 1's actual fix.
// ============================================================================
// The Results table is not whitespace-delimited in the ordinary sense: a
// column is separated from its neighbour by a RUN of two or more spaces,
// while a value that itself contains a single space — the chip column's
// "BB2, TC3" — is never split apart, because a comma-plus-single-space never
// matches a run of two-or-more. This holds across both real shapes captured
// 29 August 2026 regardless of how the column padding differs between them
// (a chip-enabled log needs a wider chip column than a chip-free one, which
// shows up as MORE padding before "score", not less — see the file header).
//
// This is deliberately NOT a fixed character-offset scheme: no column start
// position is ever hardcoded, stored, or derived once and reused — every
// call re-derives the split purely from the run-of-whitespace structure
// each individual line already carries. The only thing "derived from the
// header" in the DoD's sense is the COLUMN COUNT AND NAMES (RESULTS_COLUMNS
// above, validated against the header actually present in THIS log before a
// single data row is trusted) — never a numeric character offset.
function splitResultsColumns(line: string): string[] {
  return line.trim().split(/ {2,}/)
}

function formatColumnList(names: readonly string[]): string {
  return names.map((n) => `"${n}"`).join(', ')
}

// ============================================================================
// Pool size
// ============================================================================

function parsePoolSize(logText: string): number | null {
  const match = POOL_SIZE_RE.exec(logText)
  return match ? Number(match[1]) : null
}

// ============================================================================
// Chip column — "TC2, BB4" -> [{chipCode:'TC',gameweekId:2},{chipCode:'BB',gameweekId:4}];
// "-" (or blank) -> [] (ticket #132, defect 1: "-" is now a real character
// this module reads, not something a regex could leave unconsumed).
// ============================================================================

function parseChipColumn(raw: string): ChipPlay[] {
  const trimmed = raw.trim()
  if (trimmed === '' || trimmed === EMPTY_CELL) return []
  return trimmed.split(',').map((token) => {
    const chipToken = token.trim()
    const match = CHIP_TOKEN_RE.exec(chipToken)
    if (!match) {
      throw new SolverOutputParseError(
        `unrecognized chip token "${chipToken}" in the Results table's chip column (raw value: "${raw}"). Expected the shape ` +
          '"<2 uppercase letters><gameweek number>", e.g. "TC2", or the literal "-" for no chip.',
      )
    }
    return { chipCode: match[1], gameweekId: Number(match[2]) }
  })
}

/** "-" -> null (no player sold/bought this solution — a rolled transfer); anything else is the web_name verbatim. Ticket #132, defect 1. */
function parseNameCell(raw: string): string | null {
  return raw === EMPTY_CELL ? null : raw
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
  if (headerLine === undefined) {
    throw new SolverOutputParseError('the "Results" table has no header row — the log ends immediately after "Results".')
  }
  const headerColumns = splitResultsColumns(headerLine).map((c) => c.toLowerCase())
  const headerMatchesExpected =
    headerColumns.length === RESULTS_COLUMNS.length && RESULTS_COLUMNS.every((name, i) => headerColumns[i] === name)
  if (!headerMatchesExpected) {
    throw new SolverOutputParseError(
      `the "Results" table's header row does not have the expected columns ${formatColumnList(RESULTS_COLUMNS)} in that order ` +
        `(got: ${JSON.stringify(headerLine)}, parsed as ${formatColumnList(headerColumns)}).`,
    )
  }
  cursor++

  const solutions: SolverSolution[] = []
  while (cursor < lines.length && lines[cursor].trim() !== '') {
    const line = lines[cursor]
    const cells = splitResultsColumns(line)
    if (cells.length !== RESULTS_COLUMNS.length) {
      throw new SolverOutputParseError(
        `the "Results" table has a malformed row under its header: expected ${RESULTS_COLUMNS.length} columns ` +
          `${formatColumnList(RESULTS_COLUMNS)} but found ${cells.length} (row: ${JSON.stringify(line)}).`,
      )
    }
    const [iterRaw, sellRaw, buyRaw, chipRaw, scoreRaw] = cells

    if (!/^\d+$/.test(iterRaw)) {
      throw new SolverOutputParseError(
        `the "Results" table's "iter" column could not be read as a whole number (got: ${JSON.stringify(iterRaw)}, row: ${JSON.stringify(line)}).`,
      )
    }
    if (!/^-?\d+(?:\.\d+)?$/.test(scoreRaw)) {
      throw new SolverOutputParseError(
        `the "Results" table's "score" column could not be read as a number (got: ${JSON.stringify(scoreRaw)}, row: ${JSON.stringify(line)}).`,
      )
    }

    solutions.push({
      solutionIndex: Number(iterRaw),
      playerSold: parseNameCell(sellRaw),
      playerBought: parseNameCell(buyRaw),
      chips: parseChipColumn(chipRaw),
      score: Number(scoreRaw),
    })
    cursor++
  }

  if (solutions.length === 0) {
    throw new SolverOutputParseError('the "Results" table was found but no data rows could be parsed under its header row.')
  }

  return solutions
}

// ============================================================================
// Per-gameweek CHIP lines — the cross-check reading.
// ============================================================================
// TICKET #66 — the body is read per `Solution N` block, not as one flat
// reading for the whole log. The real captured log (both solve-2.log and
// solve-chip.log) wraps every gameweek/CHIP line inside a numbered
// `Solution N` block; #132's flat model (no `Solution` header at all) was a
// best-effort construction that never matched what the solver actually
// prints. That flat shape is kept working below ONLY because #132's own
// tests use it and must keep passing unmodified — a log with no `Solution`
// header anywhere still gets one reading applied to every Results-table row,
// exactly as before. A real log always has `Solution` headers, so it always
// takes the per-solution path.

/**
 * `Solution N` in the body is `iter N-1` in the Results table — verified
 * against the transfers in the real captured log (ticket #66's own
 * Context): `Solution 1` buys the same player `iter 0` names, `Solution 2`
 * matches `iter 1`, `Solution 3` (a roll) matches `iter 2`. This is the one
 * named place that mapping lives.
 */
function mapSolutionNumberToIterIndex(solutionNumber: number): number {
  return solutionNumber - 1
}

type GameweekChipReading =
  /** No `Solution N` header anywhere in the body — #132's original flat shape. One reading, checked against every solution. */
  | { readonly perSolution: false; readonly chips: readonly ChipPlay[] }
  /** At least one `Solution N` header found — ticket #66's real shape. Keyed by the MAPPED (0-based, `iter`-space) solution index. */
  | { readonly perSolution: true; readonly chipsByIterIndex: ReadonlyMap<number, readonly ChipPlay[]> }

function parseGameweekChipLines(lines: readonly string[]): GameweekChipReading {
  const flatChips: ChipPlay[] = []
  const chipsBySolutionNumber = new Map<number, ChipPlay[]>()
  let currentSolutionNumber: number | null = null
  let currentGameweekId: number | null = null
  let sawSolutionHeader = false

  for (const rawLine of lines) {
    const line = rawLine.trim() // tolerates leading whitespace on Solution / ** GW n: / CHIP XX lines (ticket #66)
    if (line === 'Results') break // everything from here on is the compact table, not a gameweek block

    const solutionMatch = SOLUTION_HEADER_RE.exec(line)
    if (solutionMatch) {
      sawSolutionHeader = true
      currentSolutionNumber = Number(solutionMatch[1])
      currentGameweekId = null // a new solution block starts with no gameweek header seen yet
      if (!chipsBySolutionNumber.has(currentSolutionNumber)) chipsBySolutionNumber.set(currentSolutionNumber, [])
      continue
    }

    const gwMatch = GW_HEADER_RE.exec(line)
    if (gwMatch) {
      currentGameweekId = Number(gwMatch[1])
      continue
    }

    const chipMatch = CHIP_LINE_RE.exec(line)
    if (chipMatch && currentGameweekId !== null) {
      const chip: ChipPlay = { chipCode: chipMatch[1].toUpperCase(), gameweekId: currentGameweekId }
      flatChips.push(chip)
      if (currentSolutionNumber !== null) chipsBySolutionNumber.get(currentSolutionNumber)!.push(chip)
    }
  }

  if (!sawSolutionHeader) return { perSolution: false, chips: flatChips }

  const chipsByIterIndex = new Map<number, readonly ChipPlay[]>()
  for (const [solutionNumber, chips] of chipsBySolutionNumber) {
    chipsByIterIndex.set(mapSolutionNumberToIterIndex(solutionNumber), chips)
  }
  return { perSolution: true, chipsByIterIndex }
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

function crossCheckChips(solutions: readonly SolverSolution[], reading: GameweekChipReading): void {
  for (const solution of solutions) {
    const gameweekReading = reading.perSolution
      ? (reading.chipsByIterIndex.get(solution.solutionIndex) ?? [])
      : reading.chips
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
