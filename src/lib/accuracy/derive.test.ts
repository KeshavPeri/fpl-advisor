// Unit tests for src/lib/accuracy/derive.ts — ticket #96. Every case is a
// named test, matching the ticket's own definition-of-done bullets one-for-one
// so a reviewer can check them off directly against this file, the same
// convention src/lib/chips/derive.test.ts and src/lib/verdict/derive.test.ts
// already establish.

import { describe, expect, it } from 'vitest'
import { MIN_SAMPLE_SIZE, MIN_SETTLED_GAMEWEEKS_FOR_ACTIVE, deriveAccuracyView } from './derive.ts'
import type { PredictionLogRow } from './types.ts'

// Ticket #272 added a required second argument (the active model_version).
// None of the pre-#272 tests below are about the active/fallback switch —
// they all build fixtures with a single model_version, defaulting (via
// settledRow() below) to 'baseline-v1' — so passing that same version as
// "active" here keeps every one of them exercising exactly what it did
// before this ticket, whichever branch (active vs. fallback) it happens to
// take internally. See the "ticket #272" describe block at the bottom of
// this file for the tests that exercise the switch itself.
const ACTIVE_MODEL_VERSION = 'baseline-v1'

/** A settled row with sensible defaults — every field overridable so each
 *  test states only what it actually cares about. `storedError` defaults to
 *  the CORRECT `actual - projected` value so tests that don't care about the
 *  stored-column cross-check don't accidentally exercise it. */
function settledRow(overrides: Partial<PredictionLogRow> = {}): PredictionLogRow {
  const base: PredictionLogRow = {
    gameweekId: 1,
    modelVersion: 'baseline-v1',
    projectedPoints: 4,
    projectedMinutes: 90,
    capturedAt: '2026-08-14T18:00:00Z',
    actualPoints: 4,
    actualMinutes: 90,
    settledAt: '2026-08-16T09:00:00Z',
    storedError: 0,
    ...overrides,
  }
  if (overrides.storedError === undefined) {
    base.storedError = (base.actualPoints ?? 0) - base.projectedPoints
  }
  return base
}

/** N identical measured rows, each with the same actual/projected pair —
 *  enough to build a fixture with a known, hand-computable mean. */
function repeatMeasured(count: number, overrides: Partial<PredictionLogRow> = {}): PredictionLogRow[] {
  return Array.from({ length: count }, () => settledRow(overrides))
}

describe('deriveAccuracyView — unsettled rows never reach a figure', () => {
  it('a mix of settled and unsettled rows ignores the unsettled ones in every mean and count', () => {
    // 60 settled rows, each actual=6/projected=4 -> abs error 2, signed error +2.
    const settled = repeatMeasured(60, { actualPoints: 6, projectedPoints: 4 })
    // 5 unsettled rows that would badly skew both means if wrongly included
    // as zero (actual=null -> would need to become 0, error -4/-4 abs 4).
    const unsettled = repeatMeasured(5, {
      actualPoints: null,
      actualMinutes: null,
      settledAt: null,
      storedError: null,
      projectedPoints: 4,
    })

    const view = deriveAccuracyView([...settled, ...unsettled], ACTIVE_MODEL_VERSION)

    expect(view.hasData).toBe(true)
    expect(view.rolling?.measuredCount).toBe(60)
    expect(view.rolling?.mae).toBe(2)
    expect(view.rolling?.meanSignedError).toBe(2)
  })
})

describe('deriveAccuracyView — a settled row with actual_points = 0 is a real measured zero, distinct from unsettled', () => {
  it('includes the settled zero in the mean and excludes the unsettled row entirely', () => {
    const settledZero = settledRow({
      gameweekId: 3,
      projectedPoints: 3,
      projectedMinutes: 90,
      actualPoints: 0,
      actualMinutes: 90,
      settledAt: '2026-08-30T09:00:00Z',
    })
    const unsettled = settledRow({
      gameweekId: 3,
      projectedPoints: 3,
      projectedMinutes: 90,
      actualPoints: null,
      actualMinutes: null,
      settledAt: null,
      storedError: null,
    })

    // Pad past MIN_SAMPLE_SIZE with identical settled-zero rows so this
    // gameweek's figure isn't itself flagged too-small, keeping the
    // assertion about mae/meanSignedError meaningful rather than incidental.
    const padding = repeatMeasured(MIN_SAMPLE_SIZE - 1, {
      gameweekId: 3,
      projectedPoints: 3,
      projectedMinutes: 90,
      actualPoints: 0,
      actualMinutes: 90,
      settledAt: '2026-08-30T09:00:00Z',
    })

    const view = deriveAccuracyView([settledZero, unsettled, ...padding], ACTIVE_MODEL_VERSION)

    // MIN_SAMPLE_SIZE settled zeros in total (1 + padding), unsettled row excluded.
    expect(view.rolling?.measuredCount).toBe(MIN_SAMPLE_SIZE)
    expect(view.rolling?.mae).toBe(3)
    expect(view.rolling?.meanSignedError).toBe(-3)
    expect(view.rolling?.tooSmall).toBe(false)
  })
})

describe('deriveAccuracyView — measured population excludes correctly-predicted non-appearances', () => {
  it('a row with both projected and actual minutes at zero is counted separately, never in mae/meanSignedError', () => {
    // 55 real measured rows: projected 5, actual 5 (zero error) so any
    // leakage from the non-appearance rows below is immediately visible as
    // a non-zero mae/meanSignedError.
    const measured = repeatMeasured(55, { projectedPoints: 5, actualPoints: 5 })
    // 20 correctly-predicted non-appearances: model projected 0 minutes,
    // player didn't play, both score 0.
    const nonAppearances = repeatMeasured(20, {
      projectedPoints: 0,
      projectedMinutes: 0,
      actualPoints: 0,
      actualMinutes: 0,
    })

    const view = deriveAccuracyView([...measured, ...nonAppearances], ACTIVE_MODEL_VERSION)

    expect(view.rolling?.measuredCount).toBe(55)
    expect(view.rolling?.nonAppearanceCount).toBe(20)
    expect(view.rolling?.mae).toBe(0)
    expect(view.rolling?.meanSignedError).toBe(0)
  })

  it('a row is measured when EITHER side is non-zero, not only when both are', () => {
    // Projected 0 minutes (model expected a non-appearance) but the player
    // actually came off the bench and scored — a real miss, must be measured.
    const surprise = repeatMeasured(MIN_SAMPLE_SIZE, {
      projectedPoints: 0,
      projectedMinutes: 0,
      actualPoints: 2,
      actualMinutes: 30,
    })

    const view = deriveAccuracyView(surprise, ACTIVE_MODEL_VERSION)

    expect(view.rolling?.measuredCount).toBe(MIN_SAMPLE_SIZE)
    expect(view.rolling?.nonAppearanceCount).toBe(0)
    expect(view.rolling?.mae).toBe(2)
  })
})

describe('deriveAccuracyView — arithmetic comes from actual/projected directly, not the stored error column', () => {
  it('agrees with a correct stored error column on a fixture where the two should match', () => {
    const rows = repeatMeasured(MIN_SAMPLE_SIZE, {
      projectedPoints: 4,
      actualPoints: 7,
      storedError: 3, // correct: actual - projected
    })
    const view = deriveAccuracyView(rows, ACTIVE_MODEL_VERSION)
    expect(view.rolling?.meanSignedError).toBe(3)
  })

  it('does NOT reproduce a deliberately wrong-signed stored error column', () => {
    // storedError is written backwards here (projected - actual instead of
    // actual - projected) — if this module blindly averaged the column it
    // would report -3; computed correctly from actual/projected it must
    // report +3.
    const rows = repeatMeasured(MIN_SAMPLE_SIZE, {
      projectedPoints: 4,
      actualPoints: 7,
      storedError: -3, // wrong: projected - actual
    })
    const view = deriveAccuracyView(rows, ACTIVE_MODEL_VERSION)
    expect(view.rolling?.meanSignedError).toBe(3)
    expect(view.rolling?.meanSignedError).not.toBe(-3)
  })
})

describe('deriveAccuracyView — bias is stated in words', () => {
  it('a positive mean signed error reads as under-projecting', () => {
    const rows = repeatMeasured(MIN_SAMPLE_SIZE, { projectedPoints: 4, actualPoints: 6 })
    const view = deriveAccuracyView(rows, ACTIVE_MODEL_VERSION)
    expect(view.biasWord).toBe('under-projecting')
    expect(view.biasSentence).toMatch(/under-projecting/)
  })

  it('a negative mean signed error reads as over-projecting', () => {
    const rows = repeatMeasured(MIN_SAMPLE_SIZE, { projectedPoints: 6, actualPoints: 4 })
    const view = deriveAccuracyView(rows, ACTIVE_MODEL_VERSION)
    expect(view.biasWord).toBe('over-projecting')
    expect(view.biasSentence).toMatch(/over-projecting/)
  })

  it('no directional claim when the sample is too small to read', () => {
    const rows = repeatMeasured(MIN_SAMPLE_SIZE - 1, { projectedPoints: 4, actualPoints: 6 })
    const view = deriveAccuracyView(rows, ACTIVE_MODEL_VERSION)
    expect(view.rolling?.tooSmall).toBe(true)
    expect(view.biasWord).toBeNull()
    expect(view.biasSentence).toBeNull()
  })
})

describe('deriveAccuracyView — sample size gates every figure', () => {
  it('a mean over fewer than MIN_SAMPLE_SIZE measured rows is labelled too-small', () => {
    const rows = repeatMeasured(MIN_SAMPLE_SIZE - 1)
    const view = deriveAccuracyView(rows, ACTIVE_MODEL_VERSION)
    expect(view.rolling?.measuredCount).toBe(MIN_SAMPLE_SIZE - 1)
    expect(view.rolling?.tooSmall).toBe(true)
  })

  it('the rolling total and a single gameweek can disagree on too-small independently', () => {
    const bigGw = repeatMeasured(60, { gameweekId: 1, actualPoints: 5, projectedPoints: 5 })
    const smallGw = repeatMeasured(10, { gameweekId: 2, actualPoints: 5, projectedPoints: 5 })
    const view = deriveAccuracyView([...bigGw, ...smallGw], ACTIVE_MODEL_VERSION)

    expect(view.rolling?.measuredCount).toBe(70)
    expect(view.rolling?.tooSmall).toBe(false)

    const gw1 = view.perGameweek.find((gw) => gw.gameweekId === 1)
    const gw2 = view.perGameweek.find((gw) => gw.gameweekId === 2)
    expect(gw1?.tooSmall).toBe(false)
    expect(gw2?.tooSmall).toBe(true)
  })
})

describe('deriveAccuracyView — per-gameweek figures alongside the rolling total', () => {
  it('reports each gameweek separately, ascending by gameweek id, with its own label', () => {
    const gw2 = repeatMeasured(MIN_SAMPLE_SIZE, { gameweekId: 2, actualPoints: 5, projectedPoints: 5 })
    const gw1 = repeatMeasured(MIN_SAMPLE_SIZE, { gameweekId: 1, actualPoints: 3, projectedPoints: 5 })

    const view = deriveAccuracyView([...gw2, ...gw1], ACTIVE_MODEL_VERSION)

    expect(view.perGameweek.map((gw) => gw.gameweekId)).toEqual([1, 2])
    expect(view.perGameweek[0].gameweekLabel).toBe('Gameweek 1')
    expect(view.perGameweek[0].mae).toBe(2)
    expect(view.perGameweek[1].mae).toBe(0)
    expect(view.rolling?.gameweeksSettled).toBe(2)
  })
})

describe('deriveAccuracyView — model_version is read but never raced against another', () => {
  it('uses only the version with the most settled rows, excluding the other version entirely', () => {
    const established = repeatMeasured(80, {
      modelVersion: 'baseline-v1',
      capturedAt: '2026-08-10T09:00:00Z',
      actualPoints: 5,
      projectedPoints: 5,
    })
    // A newer version, captured later, but with far fewer settled rows —
    // must not "win" just because it's more recent (see derive.ts's own
    // comment on selectCurrentModelVersion).
    const newcomer = repeatMeasured(2, {
      modelVersion: 'baseline-v2',
      capturedAt: '2026-08-20T09:00:00Z',
      actualPoints: 9,
      projectedPoints: 1,
    })

    const view = deriveAccuracyView([...established, ...newcomer], ACTIVE_MODEL_VERSION)

    expect(view.modelVersion).toBe('baseline-v1')
    expect(view.rolling?.measuredCount).toBe(80)
    expect(view.rolling?.mae).toBe(0)
  })
})

describe('deriveAccuracyView — honest empty state', () => {
  it('zero settled rows names what the card is waiting for and when settlement happens', () => {
    const view = deriveAccuracyView([], ACTIVE_MODEL_VERSION)

    expect(view.hasData).toBe(false)
    expect(view.rolling).toBeNull()
    expect(view.perGameweek).toEqual([])
    expect(view.biasWord).toBeNull()
    expect(view.emptyStateMessage).not.toBeNull()
    expect(view.emptyStateMessage).toMatch(/09:00/)
    expect(view.emptyStateMessage).toMatch(/settl/i)
  })

  it('an entirely unsettled prediction_log (this gameweek only) is still the empty state, not zero', () => {
    const rows = repeatMeasured(600, { settledAt: null, actualPoints: null, actualMinutes: null, storedError: null })
    const view = deriveAccuracyView(rows, ACTIVE_MODEL_VERSION)

    expect(view.hasData).toBe(false)
    expect(view.emptyStateMessage).not.toBeNull()
  })
})

describe('deriveAccuracyView — sanity bound on a realistic constructed dataset', () => {
  it('MAE over the measured population lands between 1.0 and 3.5 points/player-gameweek', () => {
    // A repeating, non-degenerate spread of signed errors — not every row
    // identical — so this is a genuine average rather than a single
    // hand-picked number. Cycles -3..+3 (mean absolute 12/7 ≈ 1.71).
    const errorCycle = [-3, -2, -1, 0, 1, 2, 3]
    const measuredRows: PredictionLogRow[] = []
    for (let gw = 1; gw <= 4; gw++) {
      for (let i = 0; i < 100; i++) {
        const error = errorCycle[i % errorCycle.length]
        const projectedPoints = 5
        measuredRows.push(
          settledRow({
            gameweekId: gw,
            projectedPoints,
            projectedMinutes: 90,
            actualPoints: Math.max(0, projectedPoints + error),
            actualMinutes: 90,
            settledAt: '2026-09-01T09:00:00Z',
          })
        )
      }
      // Roughly 1 in 6 players is a correctly-predicted non-appearance —
      // included to prove they don't drag MAE toward zero (the ticket's own
      // "measurement trap").
      for (let i = 0; i < 20; i++) {
        measuredRows.push(
          settledRow({
            gameweekId: gw,
            projectedPoints: 0,
            projectedMinutes: 0,
            actualPoints: 0,
            actualMinutes: 0,
            settledAt: '2026-09-01T09:00:00Z',
          })
        )
      }
    }

    const view = deriveAccuracyView(measuredRows, ACTIVE_MODEL_VERSION)

    expect(view.hasData).toBe(true)
    expect(view.rolling?.tooSmall).toBe(false)
    expect(view.rolling?.gameweeksSettled).toBe(4)
    expect(view.rolling?.nonAppearanceCount).toBe(80)
    expect(view.rolling?.mae).not.toBeNull()
    expect(view.rolling?.mae as number).toBeGreaterThanOrEqual(1.0)
    expect(view.rolling?.mae as number).toBeLessThanOrEqual(3.5)
  })
})

describe('deriveAccuracyView — ticket #272: follows the live model, not just the version with the most history', () => {
  // Every test below gives the OLD version ('baseline-v1') more total settled
  // rows than the active one ('gbm-v1') ever gets, so a pass here can only be
  // because MIN_SETTLED_GAMEWEEKS_FOR_ACTIVE is being honoured — the
  // pre-#272 "most settled rows" rule alone would pick 'baseline-v1' in
  // every one of these fixtures.
  const OLD_VERSION = 'baseline-v1'
  const ACTIVE_VERSION = 'gbm-v1'

  it('active model has 0 settled gameweeks (all its rows are unsettled) — falls back and reports pendingActive', () => {
    const oldRows = repeatMeasured(80, { modelVersion: OLD_VERSION, gameweekId: 1 })
    const activeUnsettled = repeatMeasured(30, {
      modelVersion: ACTIVE_VERSION,
      gameweekId: 5,
      actualPoints: null,
      actualMinutes: null,
      settledAt: null,
      storedError: null,
    })

    const view = deriveAccuracyView([...oldRows, ...activeUnsettled], ACTIVE_VERSION)

    expect(view.modelVersion).toBe(OLD_VERSION)
    expect(view.pendingActive).toEqual({ modelVersion: ACTIVE_VERSION, settledGameweeks: 0 })
  })

  it('active model does not appear in the rows at all — falls back and reports 0 settled gameweeks', () => {
    const oldRows = repeatMeasured(80, { modelVersion: OLD_VERSION, gameweekId: 1 })

    const view = deriveAccuracyView(oldRows, ACTIVE_VERSION)

    expect(view.modelVersion).toBe(OLD_VERSION)
    expect(view.pendingActive).toEqual({ modelVersion: ACTIVE_VERSION, settledGameweeks: 0 })
  })

  it('active model has 2 settled gameweeks — below the 3-gameweek threshold — still falls back and reports the count so far', () => {
    const oldRows = repeatMeasured(80, { modelVersion: OLD_VERSION, gameweekId: 1 })
    const activeRows = [
      ...repeatMeasured(10, { modelVersion: ACTIVE_VERSION, gameweekId: 10 }),
      ...repeatMeasured(10, { modelVersion: ACTIVE_VERSION, gameweekId: 11 }),
    ]

    const view = deriveAccuracyView([...oldRows, ...activeRows], ACTIVE_VERSION)

    expect(view.modelVersion).toBe(OLD_VERSION)
    expect(view.pendingActive).toEqual({ modelVersion: ACTIVE_VERSION, settledGameweeks: 2 })
  })

  it('active model has 3 settled gameweeks — meets the threshold — the view is built from it and pendingActive is null, even though the old version still has more total settled rows', () => {
    const oldRows = repeatMeasured(80, { modelVersion: OLD_VERSION, gameweekId: 1 })
    const activeRows = [
      ...repeatMeasured(10, { modelVersion: ACTIVE_VERSION, gameweekId: 10, actualPoints: 6, projectedPoints: 4 }),
      ...repeatMeasured(10, { modelVersion: ACTIVE_VERSION, gameweekId: 11, actualPoints: 6, projectedPoints: 4 }),
      ...repeatMeasured(10, { modelVersion: ACTIVE_VERSION, gameweekId: 12, actualPoints: 6, projectedPoints: 4 }),
    ]

    const view = deriveAccuracyView([...oldRows, ...activeRows], ACTIVE_VERSION)

    expect(MIN_SETTLED_GAMEWEEKS_FOR_ACTIVE).toBe(3)
    expect(view.modelVersion).toBe(ACTIVE_VERSION)
    expect(view.pendingActive).toBeNull()
    expect(view.rolling?.measuredCount).toBe(30)
    expect(view.rolling?.mae).toBe(2)
  })
})
