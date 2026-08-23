/**
 * Pure derivation for the rolling accuracy card (ticket #96). No I/O — takes
 * every `prediction_log` row api.ts could read (settled or not) and returns
 * a fully-resolved `AccuracyView` the component renders with no further
 * logic, matching src/lib/verdict/derive.ts's own pure/impure split.
 *
 * ============================================================================
 * Unsettled rows never reach a figure.
 * ============================================================================
 * A row with `settledAt === null` "has not been measured yet" (the
 * migration's own comment on prediction_log.settled_at) — a genuinely
 * different state from a measured zero, never collapsed into one. This is
 * enforced here, in the pure layer, as this function's own first step
 * (`toSettledRow` below) — not only by api.ts's database filter, which
 * nothing in this module can see fail. See derive.test.ts's named test
 * mixing settled and unsettled rows.
 *
 * ============================================================================
 * THE MEASUREMENT TRAP (ticket's own Context section).
 * ============================================================================
 * Roughly 1 in 6 players is injured/suspended/never plays, and the model
 * correctly projects them at zero, so they score zero. A player who neither
 * was projected minutes nor played any is not a miss — averaging their
 * (0 - 0) error into MAE would drag it toward a meaninglessly low number,
 * dominated by correct zeros rather than measuring how well the model does
 * on players who actually featured or were expected to. The measured
 * population is therefore `projectedMinutes > 0 OR actualMinutes > 0`
 * (isMeasured below); rows where both are zero are counted separately as
 * correctly-predicted non-appearances and never folded into mae/
 * meanSignedError, at either the per-gameweek or rolling level.
 *
 * ============================================================================
 * error = actual - projected, computed here, not read off the stored column.
 * ============================================================================
 * The migration's own comment states the sign: "actual_points -
 * projected_points. Positive means the model under-projected". This module
 * recomputes that from `actualPoints`/`projectedPoints` directly rather than
 * averaging `storedError` — a wrong-signed or wrong-order value written to
 * that column would otherwise flow straight into the headline figure with
 * nothing here to catch it. See derive.test.ts's cross-check test.
 */
import type {
  AccuracyView,
  GameweekAccuracyFigure,
  PredictionLogRow,
  RollingAccuracyFigure,
} from './types.ts'

/** A mean below this many measured rows is not a result — it's noise. The
 *  DoD names this figure explicitly ("fewer than 50 measured rows"). */
export const MIN_SAMPLE_SIZE = 50

/** A prediction_log row that has actually been settled — every nullable
 *  settle-time field narrowed to its real type. Never exported: callers
 *  (api.ts, tests) only ever need PredictionLogRow; this is derive.ts's own
 *  internal proof that unsettled fields can't leak into the arithmetic
 *  below. */
interface SettledRow {
  gameweekId: number
  modelVersion: string
  projectedPoints: number
  projectedMinutes: number
  capturedAt: string
  actualPoints: number
  actualMinutes: number
  storedError: number
}

/**
 * Narrows a raw row to a SettledRow, or returns null when it hasn't been
 * measured yet. `settledAt === null` is the authoritative check (matching
 * the migration's own column comment); `actualPoints`/`actualMinutes` are
 * checked too only as defence against a data anomaly where settledAt is set
 * but an actual is somehow still missing — in practice
 * scripts/settle-predictions.ts never writes settledAt without both, so
 * that branch guards a shape the real job never produces rather than a real
 * code path.
 */
function toSettledRow(row: PredictionLogRow): SettledRow | null {
  if (row.settledAt === null || row.actualPoints === null || row.actualMinutes === null) {
    return null
  }
  return {
    gameweekId: row.gameweekId,
    modelVersion: row.modelVersion,
    projectedPoints: row.projectedPoints,
    projectedMinutes: row.projectedMinutes,
    capturedAt: row.capturedAt,
    actualPoints: row.actualPoints,
    actualMinutes: row.actualMinutes,
    storedError: row.storedError ?? 0,
  }
}

/** Rounds a display figure to two decimal places — this card is a
 *  measurement, not a projection, so decimals are permitted
 *  (design-reference.md's no-decimals rule scopes to projected points in
 *  the recommendation UI only). Two places is enough precision for an MAE
 *  in the 1-3.5 range without implying false accuracy. */
function round2(value: number): number {
  return Math.round(value * 100) / 100
}

function mean(values: readonly number[]): number {
  return values.reduce((sum, v) => sum + v, 0) / values.length
}

/**
 * The measured population, per the ticket's own "measurement trap" note:
 * a row counts as measured when the model expected the player to play OR
 * the player actually did — never when both sides agree on a no-show.
 */
function isMeasured(row: SettledRow): boolean {
  return row.projectedMinutes > 0 || row.actualMinutes > 0
}

interface GroupFigures {
  measuredCount: number
  nonAppearanceCount: number
  mae: number | null
  meanSignedError: number | null
}

/** Shared arithmetic for one bucket of settled rows — used for both a
 *  single gameweek's figures and the rolling total across every gameweek,
 *  so the two can never drift apart in how they define "measured". */
function computeGroupFigures(rows: readonly SettledRow[]): GroupFigures {
  const measured = rows.filter(isMeasured)
  const nonAppearanceCount = rows.length - measured.length

  if (measured.length === 0) {
    return { measuredCount: 0, nonAppearanceCount, mae: null, meanSignedError: null }
  }

  const absErrors = measured.map((row) => Math.abs(row.actualPoints - row.projectedPoints))
  const signedErrors = measured.map((row) => row.actualPoints - row.projectedPoints)

  return {
    measuredCount: measured.length,
    nonAppearanceCount,
    mae: round2(mean(absErrors)),
    meanSignedError: round2(mean(signedErrors)),
  }
}

/**
 * Picks the one model_version this view is built from — the ticket
 * explicitly scopes out comparing versions ("read model_version but don't
 * race two"), so every figure this module produces must come from exactly
 * one version's rows, never a blend.
 *
 * Chosen by which version has the most settled rows, tie-broken by the
 * latest capturedAt among them. Row-count, not recency alone, is the
 * primary key deliberately: a brand-new model_version with a single settled
 * row would otherwise "win" over an established version with thousands of
 * rows just because it was captured later, which would present as "no data"
 * on a card that actually has plenty.
 */
function selectCurrentModelVersion(rows: readonly SettledRow[]): string {
  const tallies = new Map<string, { count: number; latestCapturedAtMs: number }>()

  for (const row of rows) {
    const capturedAtMs = new Date(row.capturedAt).getTime()
    const existing = tallies.get(row.modelVersion)
    if (existing) {
      existing.count += 1
      if (capturedAtMs > existing.latestCapturedAtMs) existing.latestCapturedAtMs = capturedAtMs
    } else {
      tallies.set(row.modelVersion, { count: 1, latestCapturedAtMs: capturedAtMs })
    }
  }

  let bestVersion: string | null = null
  let bestCount = -1
  let bestLatest = -Infinity
  for (const [version, tally] of tallies) {
    const better =
      tally.count > bestCount || (tally.count === bestCount && tally.latestCapturedAtMs > bestLatest)
    if (better) {
      bestVersion = version
      bestCount = tally.count
      bestLatest = tally.latestCapturedAtMs
    }
  }

  // rows is guaranteed non-empty by deriveAccuracyView before this is called.
  return bestVersion as string
}

const EMPTY_STATE_MESSAGE =
  'No gameweeks settled yet. Settlement runs at 09:00 UK the morning after each ' +
  "gameweek's final match — accuracy figures appear here once the first gameweek settles."

/**
 * Turns the mean signed error into words, per the DoD: positive means the
 * model under-projected, negative means it over-projected (matching the
 * migration's own column comment on `error` exactly). Returns nulls when
 * there's no directional claim to make — no rolling figure, too small a
 * sample to read, or a signed error of exactly zero.
 */
function deriveBias(
  rolling: RollingAccuracyFigure
): Pick<AccuracyView, 'biasWord' | 'biasSentence'> {
  if (rolling.tooSmall || rolling.meanSignedError === null || rolling.meanSignedError === 0) {
    return { biasWord: null, biasSentence: null }
  }

  const magnitude = Math.abs(rolling.meanSignedError)
  const biasWord = rolling.meanSignedError > 0 ? 'under-projecting' : 'over-projecting'
  const biasSentence = `The model is ${biasWord} by an average of ${magnitude} point${
    magnitude === 1 ? '' : 's'
  } per player-gameweek.`

  return { biasWord, biasSentence }
}

export function deriveAccuracyView(rows: readonly PredictionLogRow[]): AccuracyView {
  const settledRows = rows
    .map(toSettledRow)
    .filter((row): row is SettledRow => row !== null)

  if (settledRows.length === 0) {
    return {
      hasData: false,
      emptyStateMessage: EMPTY_STATE_MESSAGE,
      modelVersion: null,
      rolling: null,
      perGameweek: [],
      biasWord: null,
      biasSentence: null,
    }
  }

  const modelVersion = selectCurrentModelVersion(settledRows)
  const versionRows = settledRows.filter((row) => row.modelVersion === modelVersion)

  const byGameweek = new Map<number, SettledRow[]>()
  for (const row of versionRows) {
    const existing = byGameweek.get(row.gameweekId)
    if (existing) {
      existing.push(row)
    } else {
      byGameweek.set(row.gameweekId, [row])
    }
  }

  const perGameweek: GameweekAccuracyFigure[] = Array.from(byGameweek.entries())
    .sort(([a], [b]) => a - b)
    .map(([gameweekId, gwRows]) => {
      const figures = computeGroupFigures(gwRows)
      return {
        gameweekId,
        gameweekLabel: `Gameweek ${gameweekId}`,
        measuredCount: figures.measuredCount,
        nonAppearanceCount: figures.nonAppearanceCount,
        mae: figures.mae,
        meanSignedError: figures.meanSignedError,
        tooSmall: figures.measuredCount < MIN_SAMPLE_SIZE,
      }
    })

  const rollingFigures = computeGroupFigures(versionRows)
  const rolling: RollingAccuracyFigure = {
    measuredCount: rollingFigures.measuredCount,
    gameweeksSettled: perGameweek.length,
    nonAppearanceCount: rollingFigures.nonAppearanceCount,
    mae: rollingFigures.mae,
    meanSignedError: rollingFigures.meanSignedError,
    tooSmall: rollingFigures.measuredCount < MIN_SAMPLE_SIZE,
  }

  const { biasWord, biasSentence } = deriveBias(rolling)

  return {
    hasData: true,
    emptyStateMessage: null,
    modelVersion,
    rolling,
    perGameweek,
    biasWord,
    biasSentence,
  }
}
