// Publish the backtest's headline figures where an agent session can reach
// them — ticket #198.
//
// ============================================================================
// Why this exists.
// ============================================================================
// Ticket #193's falsification numbers were produced correctly by the
// Backtest workflow (scripts/run-backtest.ts) and then became unreachable.
// They existed only inside the generated `backtest-report.md`, uploaded as a
// workflow artifact — and GitHub redirects artifact downloads to Azure blob
// storage, which no agent session's egress allowlist reaches. Every agent in
// this pipeline can read `api.github.com`; none can read an artifact. A
// job's own `$GITHUB_STEP_SUMMARY` becomes that job's check-run
// `output.summary`, which IS reachable from `api.github.com` — no download,
// no artifact redirect. This file is pure text-in / text-out: it reads an
// already-generated report file and emits its headline figures as plain
// key/value lines, so the workflow step can write them to
// `$GITHUB_STEP_SUMMARY` and (on a PR) post them as a PR comment. It does
// not run the backtest, does not touch Supabase, and does not import
// anything from run-backtest.ts — see this ticket's scope constraint:
// run-backtest.ts does not change, and this file does not read from it
// either, to keep this a genuinely independent, standalone check on the
// report's own text rather than a second code path that could share a bug
// with the thing it is meant to make visible.
//
// ============================================================================
// The second problem this solves: a red run carries no signal.
// ============================================================================
// scripts/run-backtest.ts exits non-zero on ANY failed bound — including the
// known, standing one-gameweek oracle-ceiling failure (see
// decisions/ticket-193.md) — so a passing ticket and a failing ticket
// produce an identical red run. This file's second job is to publish the
// PER-CHECK verdict (sanity / ranking sanity / oracle-ceiling), named, so a
// reader can tell "only the known one-gameweek check failed" from the run
// page alone, without relaxing, splitting out, or suppressing that failure
// — the job still exits non-zero exactly as before this ticket.
//
// ============================================================================
// Fail loud, never quiet.
// ============================================================================
// A figure this file cannot find in the report is a PARSE FAILURE, thrown
// with the figure's own name — never emitted as 0, blank, or "n/a" standing
// in for "missing". "n/a" is only ever emitted when the report ITSELF says
// "n/a" (scripts/run-backtest.ts's own fmt()/fmtSpearman() convention for a
// genuinely absent measurement) — that is the source being honest about
// missing data, not this parser failing to find a line. See
// LEARNINGS-second-build-wave.md §3: a parser that silently emits a
// confident, readable, wrong summary is worse than no parser at all.
//
// ============================================================================
// Why sections are found by nested heading text, not line offset.
// ============================================================================
// `### Season aggregate` and `### By position` each appear TWICE in a real
// report — once under the one-gameweek `## Ranking skill (ticket #147)`
// section, once under the five-gameweek `## Five-gameweek ranking (ticket
// #183)` section — and a heading `generateReportMarkdown` adds later would
// silently shift a line-offset-based parser's picks. `findSection` below
// always resolves a level-3 heading WITHIN the specific level-2 (or level-3)
// parent section it belongs to, matched by that parent's own literal
// heading text, so a new section appended anywhere else in the report
// cannot change what this file reads.
// ============================================================================

export class BacktestSummaryError extends Error {
  figure: string
  constructor(message: string, figure: string) {
    super(message)
    this.name = 'BacktestSummaryError'
    this.figure = figure
  }
}

interface Section {
  headingText: string
  body: string
}

/**
 * Finds the first heading at `level` (1 `#` per level) whose text satisfies
 * `matches`, within `markdown`, and returns everything from that heading up
 * to (not including) the next heading at the SAME level or shallower. Never
 * matches a deeper heading (e.g. a level-2 search skips over level-3
 * headings entirely) — the caller nests a second `findSection` call scoped
 * to the returned body when it needs to disambiguate a heading that repeats
 * under more than one parent (see file header).
 */
function findSection(markdown: string, level: number, matches: (headingText: string) => boolean): Section | null {
  const marker = '#'.repeat(level) + ' '
  const lines = markdown.split('\n')
  let startIdx = -1
  let headingText = ''

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    // A deeper heading (e.g. '### ') never matches a shallower marker (e.g.
    // '## '): startsWith compares the character right after marker's own
    // '#'s too, and a deeper heading has one more '#' there instead of the
    // marker's trailing space — so this check alone correctly limits the
    // search to exactly `level`, with no separate "is this deeper" test needed.
    if (!line.startsWith(marker)) continue
    const text = line.slice(marker.length).trim()
    if (matches(text)) {
      startIdx = i
      headingText = text
      break
    }
  }
  if (startIdx === -1) return null

  let endIdx = lines.length
  for (let i = startIdx + 1; i < lines.length; i++) {
    const headingMatch = /^(#{1,6})\s/.exec(lines[i])
    if (headingMatch && headingMatch[1].length <= level) {
      endIdx = i
      break
    }
  }
  return { headingText, body: lines.slice(startIdx, endIdx).join('\n') }
}

function requireSection(markdown: string, level: number, matches: (headingText: string) => boolean, describe: string): Section {
  const section = findSection(markdown, level, matches)
  if (section === null) {
    throw new BacktestSummaryError(
      `could not find the "${describe}" section (a level-${level} heading) in the report — the report format may have changed, or this is not a full backtest report.`,
      describe,
    )
  }
  return section
}

/** Extracts the first `**value**` following `anchor` in `body`. Throws, naming `figureName`, when `anchor` is not found at all. */
function extractBold(body: string, anchor: string, figureName: string): string {
  const anchorIdx = body.indexOf(anchor)
  if (anchorIdx === -1) {
    throw new BacktestSummaryError(`could not find "${figureName}" — expected the text "${anchor}" followed by a **bold** value, and it is not present in the report.`, figureName)
  }
  const rest = body.slice(anchorIdx + anchor.length)
  const match = /^\*\*([^*]+)\*\*/.exec(rest)
  if (match === null) {
    throw new BacktestSummaryError(`found "${anchor}" but no **bold** value immediately after it — expected "${figureName}" there.`, figureName)
  }
  return match[1].trim()
}

/** Extracts the integer at the end of the line containing `anchor`. Throws, naming `figureName`, when `anchor` is missing or the line does not end in an integer. */
function extractTrailingCount(body: string, anchor: string, figureName: string): string {
  const lines = body.split('\n')
  const line = lines.find((l) => l.includes(anchor))
  if (line === undefined) {
    throw new BacktestSummaryError(`could not find "${figureName}" — expected a line containing "${anchor}", and none is present in the report.`, figureName)
  }
  const match = /(-?\d+)\s*$/.exec(line)
  if (match === null) {
    throw new BacktestSummaryError(`found the line for "${figureName}" ("${anchor}") but it does not end in a number: "${line.trim()}"`, figureName)
  }
  return match[1]
}

export interface BacktestFigures {
  oneGameweekModelSpearman: string
  fiveGameweekModelSpearman: string
  oneGameweekOracleSpearman: string
  fiveGameweekOracleSpearman: string
  oneGameweekMeasuredPopulation: string
  fiveGameweekMeasuredPopulation: string
  seasonMeanAbsoluteError: string
  seasonMeanSignedError: string
  fiveGameweekLegsFromSchedule: string
  fiveGameweekLegsBlankGameweek: string
  fiveGameweekLegsClubPlayedPlayerDidNot: string
}

export interface CheckVerdict {
  /** The name this check is published under — one of "Sanity check", "Ranking sanity check", "Oracle-ceiling check". */
  name: string
  ok: boolean
  /** Named failure lines, verbatim from the report (each already names the specific bound that failed) — empty when ok. */
  failures: string[]
}

export interface BacktestSummary {
  figures: BacktestFigures
  /** Always exactly 3, in this order: sanity, ranking sanity, oracle-ceiling. */
  checks: CheckVerdict[]
}

/** `## <name>: PASSED` or `## <name>: FAILED`, with FAILED's failure lines being every `- ...` line in the section body. Used for all three checks — they share this exact shape in generateReportMarkdown. */
function parseCheckVerdict(section: Section, name: string): CheckVerdict {
  const statusMatch = /:\s*(PASSED|FAILED)\s*$/.exec(section.headingText)
  if (statusMatch === null) {
    throw new BacktestSummaryError(`the "${name}" heading ("${section.headingText}") does not end in PASSED or FAILED.`, name)
  }
  const ok = statusMatch[1] === 'PASSED'
  const failures = ok
    ? []
    : section.body
        .split('\n')
        .filter((l) => l.startsWith('- '))
        .map((l) => l.slice(2).trim())
  return { name, ok, failures }
}

/**
 * Parses a generated backtest-report.md (scripts/run-backtest.ts's own
 * generateReportMarkdown output) into the figures and check verdicts this
 * ticket publishes. Throws BacktestSummaryError, naming the missing figure,
 * on anything it cannot find — never silently emits a placeholder.
 */
export function parseBacktestReport(markdown: string): BacktestSummary {
  // ---- One-gameweek sections -------------------------------------------
  const headline = requireSection(markdown, 2, (t) => t === 'Headline', 'Headline')
  const seasonMeanAbsoluteError = extractBold(headline.body, 'Mean absolute error: ', 'season mean absolute error')
  const seasonMeanSignedError = extractBold(headline.body, 'Mean signed error: ', 'season mean signed error')

  const measuredPopulationSection = requireSection(
    markdown,
    2,
    (t) => t === 'The measured population, and what is excluded',
    'The measured population, and what is excluded',
  )
  const oneGameweekMeasuredPopulation = extractTrailingCount(
    measuredPopulationSection.body,
    '**rows measured (headline population)**:',
    'one-gameweek measured population',
  )

  const sanitySection = requireSection(markdown, 2, (t) => t.startsWith('Sanity check:'), 'Sanity check')

  const rankingSkillSection = requireSection(markdown, 2, (t) => t.startsWith('Ranking skill'), 'Ranking skill (ticket #147)')
  const rankingSanitySection = requireSection(
    rankingSkillSection.body,
    3,
    (t) => t.startsWith('Ranking sanity check:'),
    'Ranking sanity check',
  )
  const oneGwSeasonAggregate = requireSection(
    rankingSkillSection.body,
    3,
    (t) => t === 'Season aggregate',
    'one-gameweek Season aggregate',
  )
  const oneGameweekModelSpearman = extractBold(oneGwSeasonAggregate.body, 'Spearman rank correlation: ', 'one-gameweek model Spearman')

  // ---- Five-gameweek sections (ticket #183) ------------------------------
  const fiveGwSection = requireSection(markdown, 2, (t) => t.startsWith('Five-gameweek ranking'), 'Five-gameweek ranking (ticket #183)')

  const fiveGwPopulationSection = requireSection(
    fiveGwSection.body,
    3,
    (t) => t === 'Population, truncated windows, and reconciliation',
    'Population, truncated windows, and reconciliation',
  )
  const fiveGameweekMeasuredPopulation = extractTrailingCount(
    fiveGwPopulationSection.body,
    '**five-gameweek rows measured**:',
    'five-gameweek measured population',
  )

  const clubScheduleSection = requireSection(
    fiveGwSection.body,
    3,
    (t) => t.startsWith('Club-schedule fixture diagnostics'),
    'Club-schedule fixture diagnostics (ticket #193)',
  )
  const fiveGameweekLegsFromSchedule = extractTrailingCount(
    clubScheduleSection.body,
    'legs whose fixture count came from the club schedule',
    'five-gameweek legs from the club schedule',
  )
  const fiveGameweekLegsBlankGameweek = extractTrailingCount(
    clubScheduleSection.body,
    'legs where the club had **no** scheduled fixture that gameweek',
    'five-gameweek blank-gameweek legs',
  )
  const fiveGameweekLegsClubPlayedPlayerDidNot = extractTrailingCount(
    clubScheduleSection.body,
    'legs where the club **did** have a scheduled fixture but the player did not feature in it',
    'five-gameweek legs where the club played and the player did not',
  )

  const fiveGwSeasonAggregate = requireSection(fiveGwSection.body, 3, (t) => t === 'Season aggregate', 'five-gameweek Season aggregate')
  const fiveGameweekModelSpearman = extractBold(fiveGwSeasonAggregate.body, 'Spearman rank correlation: ', 'five-gameweek model Spearman')

  const oracleSection = requireSection(
    fiveGwSection.body,
    3,
    (t) => t.startsWith('Quality oracle'),
    'Quality oracle — a hindsight ceiling, not a target',
  )
  const oneGameweekOracleSpearman = extractBold(
    oracleSection.body,
    'one-gameweek oracle, season: Spearman ',
    'one-gameweek oracle Spearman',
  )
  const fiveGameweekOracleSpearman = extractBold(
    oracleSection.body,
    'five-gameweek oracle, season: Spearman ',
    'five-gameweek oracle Spearman',
  )

  const oracleCeilingSection = requireSection(fiveGwSection.body, 3, (t) => t.startsWith('Oracle-ceiling check:'), 'Oracle-ceiling check')

  return {
    figures: {
      oneGameweekModelSpearman,
      fiveGameweekModelSpearman,
      oneGameweekOracleSpearman,
      fiveGameweekOracleSpearman,
      oneGameweekMeasuredPopulation,
      fiveGameweekMeasuredPopulation,
      seasonMeanAbsoluteError,
      seasonMeanSignedError,
      fiveGameweekLegsFromSchedule,
      fiveGameweekLegsBlankGameweek,
      fiveGameweekLegsClubPlayedPlayerDidNot,
    },
    checks: [
      parseCheckVerdict(sanitySection, 'Sanity check'),
      parseCheckVerdict(rankingSanitySection, 'Ranking sanity check'),
      parseCheckVerdict(oracleCeilingSection, 'Oracle-ceiling check'),
    ],
  }
}

/**
 * Renders a BacktestSummary as plain key/value lines (ticket text) — one
 * figure per line, then one PASSED/FAILED line per named check, then one
 * numbered failure line per named bound that failed. This exact text is
 * what the workflow writes to $GITHUB_STEP_SUMMARY and posts as a PR
 * comment — no markdown table, no formatting decision left for the
 * workflow to make differently in each of the two places it is used.
 */
export function formatBacktestSummary(summary: BacktestSummary): string {
  const { figures, checks } = summary
  const lines: string[] = []

  lines.push('## Backtest headline figures')
  lines.push('')
  lines.push('```')
  lines.push(`one_gameweek_model_spearman: ${figures.oneGameweekModelSpearman}`)
  lines.push(`five_gameweek_model_spearman: ${figures.fiveGameweekModelSpearman}`)
  lines.push(`one_gameweek_oracle_spearman: ${figures.oneGameweekOracleSpearman}`)
  lines.push(`five_gameweek_oracle_spearman: ${figures.fiveGameweekOracleSpearman}`)
  lines.push(`one_gameweek_measured_population: ${figures.oneGameweekMeasuredPopulation}`)
  lines.push(`five_gameweek_measured_population: ${figures.fiveGameweekMeasuredPopulation}`)
  lines.push(`season_mean_absolute_error: ${figures.seasonMeanAbsoluteError}`)
  lines.push(`season_mean_signed_error: ${figures.seasonMeanSignedError}`)
  lines.push(`five_gameweek_legs_from_schedule: ${figures.fiveGameweekLegsFromSchedule}`)
  lines.push(`five_gameweek_legs_blank_gameweek: ${figures.fiveGameweekLegsBlankGameweek}`)
  lines.push(`five_gameweek_legs_club_played_player_did_not: ${figures.fiveGameweekLegsClubPlayedPlayerDidNot}`)
  lines.push('```')
  lines.push('')
  lines.push('## Backtest check verdicts')
  lines.push('')
  lines.push(
    'The job still exits non-zero when any bound below fails (ticket #198 does not relax, split out, or ' +
      'suppress any bound) — this table exists so a red run states exactly which named check failed, rather ' +
      'than forcing a reader to open the full report to find out.',
  )
  lines.push('')
  for (const check of checks) {
    lines.push(`- **${check.name}: ${check.ok ? 'PASSED' : 'FAILED'}**`)
    for (const failure of check.failures) {
      lines.push(`  - ${failure}`)
    }
  }

  return lines.join('\n') + '\n'
}

// ============================================================================
// CLI entry point.
// ============================================================================
// Reads the report file named by argv[2] (falling back to
// $BACKTEST_REPORT_PATH, matching run-backtest.ts's own env var, then to its
// same default path) and writes the formatted summary to stdout — the
// workflow redirects that into $GITHUB_STEP_SUMMARY and, on a PR, passes it
// to the PR-comment step. No Supabase read, no argument beyond the report
// path: this file only ever reads a file already sitting on disk.
// ============================================================================

const DEFAULT_REPORT_PATH = './out/backtest-report.md'

export function readReportPathFromArgs(argv: readonly string[], env: NodeJS.ProcessEnv): string {
  return argv[2] ?? env.BACKTEST_REPORT_PATH ?? DEFAULT_REPORT_PATH
}

async function main(): Promise<void> {
  const { readFile } = await import('node:fs/promises')
  const reportPath = readReportPathFromArgs(process.argv, process.env)
  let markdown: string
  try {
    markdown = await readFile(reportPath, 'utf8')
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`publish-backtest-summary: could not read report file "${reportPath}": ${message}`)
    process.exit(1)
    return
  }

  try {
    const summary = parseBacktestReport(markdown)
    process.stdout.write(formatBacktestSummary(summary))
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`publish-backtest-summary: failed to parse "${reportPath}": ${message}`)
    process.exit(1)
  }
}

// Guarded, matching every other job in scripts/: importing this module (e.g. from its test file) must not trigger a real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`publish-backtest-summary: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
