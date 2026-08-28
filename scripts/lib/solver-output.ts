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
/** A bare gameweek header line, e.g. "GW 2" or "GW2" — nothing else on the line, so this never matches a Transfer Overview line like "GW2: (TC) Muharemović -> Thiaw" (see file header). */
const GW_HEADER_RE = /^GW\s*(\d+)$/i
/** A bare per-gameweek chip line, e.g. "CHIP TC" — see file header for the format's provenance. */
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
