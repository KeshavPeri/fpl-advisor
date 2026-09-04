// Tests for scripts/publish-backtest-summary.ts — ticket #198.
//
// The one committed fixture (scripts/fixtures/backtest-report-10.md) is a
// hand-built, realistic "backtest report 10": no such report exists
// anywhere in this repo's history (checked: docs/reports/ holds only report
// 7, which predates ticket #183's five-gameweek section entirely), so it
// was constructed by hand to match scripts/run-backtest.ts's
// generateReportMarkdown() output format exactly, reusing the real report 7
// verbatim for every section that ticket #183/#187/#193 do not touch, and
// hand-writing the sections those tickets add — embedding the three real,
// documented #193 falsification figures from decisions/ticket-193.md
// (legs where the club played and the player did not = 6,836; five-gameweek
// model Spearman = 0.397; five-gameweek oracle Spearman = 0.506) alongside
// plausible values for everything else. It also reproduces the real,
// documented, standing one-gameweek oracle-ceiling failure from that same
// decisions file (oracle 0.336-ish below the model) — see the "a run that
// failed a bound" tests below, which read that failure straight off this
// one committed fixture rather than needing a second one.
//
// This file never re-derives a figure from the report's prose by hand and
// compares it to the parser's own output (that would just be testing the
// parser against itself) — every expected value below is either copied
// directly from decisions/ticket-193.md (the three falsification figures)
// or read directly off the fixture file's own text.

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import { BacktestSummaryError, formatBacktestSummary, parseBacktestReport, readReportPathFromArgs } from './publish-backtest-summary.ts'

const fixturePath = fileURLToPath(new URL('./fixtures/backtest-report-10.md', import.meta.url))
const report10 = readFileSync(fixturePath, 'utf8')

// ============================================================================
// Every figure present — the DoD's #193 exact-value check.
// ============================================================================

describe('parseBacktestReport — backtest report 10 (every figure present)', () => {
  const summary = parseBacktestReport(report10)

  it('emits the three #193 falsification figures EXACTLY as decisions/ticket-193.md records them', () => {
    // These three are the DoD's own named assertion: "Any other values mean
    // the parser is wrong." Copied verbatim from decisions/ticket-193.md,
    // not from the fixture file, so a mistake made in BOTH places at once
    // (fixture and parser) cannot cancel out and pass silently.
    expect(summary.figures.fiveGameweekLegsClubPlayedPlayerDidNot).toBe('6836')
    expect(summary.figures.fiveGameweekModelSpearman).toBe('0.397')
    expect(summary.figures.fiveGameweekOracleSpearman).toBe('0.506')
  })

  it('emits every other headline figure the DoD names, matching the fixture text', () => {
    expect(summary.figures.oneGameweekModelSpearman).toBe('0.323')
    expect(summary.figures.oneGameweekOracleSpearman).toBe('0.301')
    expect(summary.figures.oneGameweekMeasuredPopulation).toBe('10460')
    expect(summary.figures.fiveGameweekMeasuredPopulation).toBe('9184')
    expect(summary.figures.seasonMeanAbsoluteError).toBe('1.800')
    expect(summary.figures.seasonMeanSignedError).toBe('-0.196')
    expect(summary.figures.fiveGameweekLegsFromSchedule).toBe('36232')
    expect(summary.figures.fiveGameweekLegsBlankGameweek).toBe('504')
  })

  it('the two leg counters that must sum to the total legs reconcile (9,184 windows × 4 legs)', () => {
    const total = Number(summary.figures.fiveGameweekLegsFromSchedule) + Number(summary.figures.fiveGameweekLegsBlankGameweek)
    expect(total).toBe(9184 * 4)
  })
})

// ============================================================================
// A report from a run that failed a bound — read straight off the SAME
// committed fixture, which genuinely fails its one-gameweek oracle-ceiling
// check (a real, standing, documented failure — decisions/ticket-193.md).
// No second fixture needed: a real backtest report with a mix of passing
// and failing checks is exactly what report 10 already is.
// ============================================================================

describe('parseBacktestReport — a report from a run that failed a bound (report 10 itself)', () => {
  const summary = parseBacktestReport(report10)

  it('names exactly three checks, in order: Sanity check, Ranking sanity check, Oracle-ceiling check', () => {
    expect(summary.checks.map((c) => c.name)).toEqual(['Sanity check', 'Ranking sanity check', 'Oracle-ceiling check'])
  })

  it('reports Sanity check and Ranking sanity check as PASSED, with no failure lines', () => {
    const [sanity, rankingSanity] = summary.checks
    expect(sanity.ok).toBe(true)
    expect(sanity.failures).toEqual([])
    expect(rankingSanity.ok).toBe(true)
    expect(rankingSanity.failures).toEqual([])
  })

  it('reports Oracle-ceiling check as FAILED, naming ONLY the one-gameweek bound — not the five-gameweek one, which passed', () => {
    const oracleCeiling = summary.checks[2]
    expect(oracleCeiling.ok).toBe(false)
    expect(oracleCeiling.failures).toHaveLength(1)
    expect(oracleCeiling.failures[0]).toContain('one-gameweek quality oracle')
    expect(oracleCeiling.failures[0]).not.toContain('five-gameweek quality oracle')
  })
})

// ============================================================================
// A figure missing from the report — must fail loudly, never a silent
// zero/blank (ticket text, and LEARNINGS-second-build-wave.md §3). Every
// case below starts from the real, otherwise-valid report-10 text and
// removes or renames exactly one anchor the parser depends on, so the ONLY
// thing under test is that specific figure's own failure path.
// ============================================================================

describe('parseBacktestReport — a figure missing from the report fails loudly', () => {
  it('throws a BacktestSummaryError naming the figure when the Headline section is entirely absent', () => {
    const broken = report10.replace(/## Headline\n\n[^\n]*\n\n/, '')
    expect(() => parseBacktestReport(broken)).toThrow(BacktestSummaryError)
    try {
      parseBacktestReport(broken)
      expect.unreachable('parseBacktestReport should have thrown')
    } catch (err) {
      expect(err).toBeInstanceOf(BacktestSummaryError)
      expect((err as BacktestSummaryError).figure).toBe('Headline')
      expect((err as Error).message).toContain('Headline')
    }
  })

  it('throws naming "season mean signed error" when only that one bold value is stripped from an otherwise-intact Headline', () => {
    const broken = report10.replace(/Mean signed error: \*\*-0\.196\*\*/, 'Mean signed error: (withheld)')
    expect(() => parseBacktestReport(broken)).toThrow(/season mean signed error/)
  })

  it('throws naming the leg counter when the club-played-player-did-not line is removed, rather than defaulting to 0', () => {
    const broken = report10.replace(
      /- legs where the club \*\*did\*\* have a scheduled fixture but the player did not feature in it — \*\*this is the exact size of the leak this ticket closes\*\*: 6836\n/,
      '',
    )
    const err = (() => {
      try {
        parseBacktestReport(broken)
        return null
      } catch (e) {
        return e
      }
    })()
    expect(err).toBeInstanceOf(BacktestSummaryError)
    expect((err as BacktestSummaryError).figure).toBe('five-gameweek legs where the club played and the player did not')
    // The defect this test guards against: a looser parser silently
    // reading a DIFFERENT trailing number on a nearby line and reporting it
    // as though it were the missing figure — or worse, emitting 0.
    expect((err as Error).message).not.toMatch(/: 0$/)
  })

  it('throws naming the five-gameweek Season aggregate when that whole subsection is removed, and does NOT fall back to the one-gameweek figure', () => {
    const broken = report10.replace(
      /### Season aggregate\n\n- Spearman rank correlation: \*\*0\.397\*\* \(n=9184\)\n- Top-10 overlap: \*\*1712 of 6900 \(24\.8%\)\*\*\n- Top-20 overlap: \*\*2890 of 13800 \(20\.9%\)\*\*\n\n/,
      '',
    )
    expect(() => parseBacktestReport(broken)).toThrow(/five-gameweek Season aggregate/)
  })

  it('throws naming the Oracle-ceiling check when its heading is missing entirely', () => {
    const broken = report10.replace('### Oracle-ceiling check: FAILED', '### Something else entirely')
    expect(() => parseBacktestReport(broken)).toThrow(/Oracle-ceiling check/)
  })

  it('does NOT throw, and passes "n/a" straight through, when the report itself explicitly says n/a — that is the source being honest about missing data, not a parse failure', () => {
    // scripts/run-backtest.ts's own fmtSpearman()/fmt() print "n/a" for a
    // null figure — this is what an early-season report with too little
    // data looks like, and it is a valid report, not a broken one.
    const withNa = report10.replace('- Spearman rank correlation: **0.397** (n=9184)', '- Spearman rank correlation: **n/a** (n=0)')
    const summary = parseBacktestReport(withNa)
    expect(summary.figures.fiveGameweekModelSpearman).toBe('n/a')
  })
})

// ============================================================================
// A report whose SANITY and RANKING SANITY checks themselves failed (not
// just oracle-ceiling) — proves the FAILED-heading/failure-line parsing
// path for the other two check groups too, using their real
// checkSanityBounds()/checkRankingSanityBounds() failure-string format
// (scripts/run-backtest.ts) rather than an invented one. Built in-memory
// from the same one committed fixture — no second fixture file (scope
// constraint: one fixture report).
// ============================================================================

describe('parseBacktestReport — Sanity check and Ranking sanity check both FAILED', () => {
  const withFailedBounds = report10
    .replace(
      '## Sanity check: PASSED\n\nOverall mean absolute error and every position\'s derived clean-sheet rate are within their sane bounds.',
      '## Sanity check: FAILED\n\n' +
        '**2 bound(s) failed — this means the HARNESS is wrong, not necessarily the model:**\n\n' +
        '- overall mean absolute error 4.120 is outside the sane bound [1, 3.5] points per player-gameweek\n' +
        '- Forward derived clean-sheet rate 72.0% exceeds the sane bound 60%',
    )
    .replace(
      '### Ranking sanity check: PASSED\n\nThe season aggregate and every position\'s Spearman correlation and top-10 overlap are within their sane bounds.',
      '### Ranking sanity check: FAILED\n\n' +
        '**1 bound(s) failed — this means the HARNESS is wrong, not necessarily the model ' +
        '(a suspiciously good correlation is the shape a lookahead leak takes):**\n\n' +
        '- season Spearman rank correlation 0.950 is outside the sane bound [-0.2, 0.9]',
    )

  it('reports Sanity check as FAILED, naming both bounds', () => {
    const summary = parseBacktestReport(withFailedBounds)
    const sanity = summary.checks[0]
    expect(sanity.ok).toBe(false)
    expect(sanity.failures).toEqual([
      'overall mean absolute error 4.120 is outside the sane bound [1, 3.5] points per player-gameweek',
      'Forward derived clean-sheet rate 72.0% exceeds the sane bound 60%',
    ])
  })

  it('reports Ranking sanity check as FAILED, naming its one bound, independently of Sanity check', () => {
    const summary = parseBacktestReport(withFailedBounds)
    const rankingSanity = summary.checks[1]
    expect(rankingSanity.ok).toBe(false)
    expect(rankingSanity.failures).toEqual(['season Spearman rank correlation 0.950 is outside the sane bound [-0.2, 0.9]'])
  })

  it('every headline figure is still readable — a failed bound never blocks the figures themselves', () => {
    const summary = parseBacktestReport(withFailedBounds)
    expect(summary.figures.fiveGameweekLegsClubPlayedPlayerDidNot).toBe('6836')
  })
})

// ============================================================================
// formatBacktestSummary — plain key/value lines (ticket text), plus the
// named per-check verdict block.
// ============================================================================

describe('formatBacktestSummary', () => {
  const text = formatBacktestSummary(parseBacktestReport(report10))

  it('emits every figure as a plain "key: value" line inside a fenced block', () => {
    expect(text).toContain('five_gameweek_legs_club_played_player_did_not: 6836')
    expect(text).toContain('five_gameweek_model_spearman: 0.397')
    expect(text).toContain('five_gameweek_oracle_spearman: 0.506')
    expect(text).toContain('one_gameweek_model_spearman: 0.323')
    expect(text).toContain('season_mean_absolute_error: 1.800')
    expect(text).toContain('season_mean_signed_error: -0.196')
  })

  it('names every check and whether it passed — not just an overall PASS/FAIL', () => {
    expect(text).toContain('**Sanity check: PASSED**')
    expect(text).toContain('**Ranking sanity check: PASSED**')
    expect(text).toContain('**Oracle-ceiling check: FAILED**')
    expect(text).toContain('one-gameweek quality oracle')
  })

  it('states plainly that a failed bound still exits the job non-zero — publishing figures is not suppressing the failure', () => {
    expect(text).toMatch(/still exits non-zero/)
  })
})

// ============================================================================
// readReportPathFromArgs — argv beats env beats the default, matching
// run-backtest.ts's own BACKTEST_REPORT_PATH convention.
// ============================================================================

describe('readReportPathFromArgs', () => {
  it('prefers an explicit CLI argument over the environment variable', () => {
    expect(readReportPathFromArgs(['node', 'script.ts', '/explicit/path.md'], { BACKTEST_REPORT_PATH: '/env/path.md' })).toBe(
      '/explicit/path.md',
    )
  })

  it('falls back to BACKTEST_REPORT_PATH when no CLI argument is given', () => {
    expect(readReportPathFromArgs(['node', 'script.ts'], { BACKTEST_REPORT_PATH: '/env/path.md' })).toBe('/env/path.md')
  })

  it('falls back to the same default path run-backtest.ts itself writes to when neither is set', () => {
    expect(readReportPathFromArgs(['node', 'script.ts'], {})).toBe('./out/backtest-report.md')
  })
})
