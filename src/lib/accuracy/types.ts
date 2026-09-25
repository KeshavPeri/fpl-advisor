/**
 * Types for the rolling accuracy display (ticket #96). product-brief.md §2:
 * "every projection stored, scored against actuals after gameweek lockdown,
 * and shown as a rolling figure in-app." This ticket builds that display —
 * the storage half (`prediction_log`) was ticket #73, see
 * supabase/migrations/20260821090000_prediction_log.sql for the exact column
 * semantics this module's arithmetic depends on.
 *
 * Same house pattern as src/lib/verdict/, src/lib/reasoning/, src/lib/chips/:
 * api.ts does I/O and resolves raw rows into the camelCased type below,
 * derive.ts is pure and does every bit of arithmetic and wording, the
 * component renders derive.ts's output with no further logic of its own.
 */

/**
 * One `prediction_log` row, camelCased 1:1 from the migration's columns —
 * nothing renamed or reshaped, so derive.ts's arithmetic can be checked
 * directly against that file's own column comments rather than against a
 * second layer of naming.
 *
 * `actualPoints` / `actualMinutes` / `settledAt` stay nullable here, matching
 * the underlying columns exactly, even though api.ts's own query already
 * filters to `settled_at IS NOT NULL` at the database level (see api.ts's
 * comment on why). deriveAccuracyView (./derive.ts) filters unsettled rows
 * out itself as its own first step — belt-and-braces so the single most
 * important rule in this ticket (a row with `settled_at IS NULL` "has not
 * been measured yet" per the migration's own comment, and must never be
 * treated as a measured zero) is enforced in the pure, unit-tested layer,
 * not only in a database query nothing here can see fail.
 */
export interface PredictionLogRow {
  gameweekId: number
  modelVersion: string
  projectedPoints: number
  projectedMinutes: number
  capturedAt: string
  actualPoints: number | null
  actualMinutes: number | null
  settledAt: string | null
  /**
   * The stored `error` column (`actual_points - projected_points` per the
   * migration's own comment). Read only so derive.ts's own test can
   * cross-check the arithmetic it computes independently from
   * `actualPoints`/`projectedPoints` against this column — the DoD's "NOT by
   * blindly averaging the stored error column" requirement. Never itself
   * folded into a headline figure by this module.
   */
  storedError: number | null
}

/**
 * One gameweek's figures, computed only over that gameweek's own measured
 * population (`projectedMinutes > 0 OR actualMinutes > 0`) at the current
 * model version — see derive.ts's `selectCurrentModelVersion` and
 * `MEASUREMENT TRAP` comment.
 */
export interface GameweekAccuracyFigure {
  gameweekId: number
  gameweekLabel: string
  measuredCount: number
  /** Rows where both projected and actual minutes were zero — a correctly
   *  predicted non-appearance, counted separately and never folded into
   *  mae/meanSignedError above (or below, for the rolling total). */
  nonAppearanceCount: number
  /** null only when measuredCount is 0 — nothing to average, not a zero result. */
  mae: number | null
  meanSignedError: number | null
  /** True when measuredCount is below MIN_SAMPLE_SIZE — mae/meanSignedError
   *  above are still computed (so a caller/test can inspect them) but the
   *  view must render "too small to read", never the number itself. */
  tooSmall: boolean
}

/** The rolling total across every settled gameweek at the current model version. */
export interface RollingAccuracyFigure {
  measuredCount: number
  /** Distinct gameweeks contributing to this figure — same as perGameweek.length. */
  gameweeksSettled: number
  nonAppearanceCount: number
  mae: number | null
  meanSignedError: number | null
  tooSmall: boolean
}

/** Fully-resolved display data for AccuracyCard — the component does no further derivation. */
export interface AccuracyView {
  hasData: boolean
  /** Present only when hasData is false — states what the card is waiting
   *  for and when settlement happens, never a spinner or a bare zero. */
  emptyStateMessage: string | null
  /** The model_version this view's figures are built from — either the
   *  active model (config/projection-model.json) once it has enough settled
   *  history, or the fallback selectCurrentModelVersion resolved to before
   *  then. See pendingActive below. Null only alongside hasData: false. */
  modelVersion: string | null
  /**
   * Set (ticket #272) exactly when the figures above come from a fallback
   * version rather than the live active model — i.e. the active model from
   * config/projection-model.json has fewer than
   * derive.ts's MIN_SETTLED_GAMEWEEKS_FOR_ACTIVE settled gameweeks of its
   * own, including when it has none at all or doesn't appear in the rows.
   * `settledGameweeks` is how many of that active model's own settled
   * gameweeks exist so far, so the UI can say "N so far". Null once the
   * active model has enough history to be shown directly (or alongside
   * hasData: false, where there's nothing to compare against yet).
   */
  pendingActive: { modelVersion: string; settledGameweeks: number } | null
  /** Null only alongside hasData: false. */
  rolling: RollingAccuracyFigure | null
  /** Ascending by gameweekId. Empty only alongside hasData: false. */
  perGameweek: readonly GameweekAccuracyFigure[]
  /** Stated in words per the DoD: positive mean signed error means the
   *  model is under-projecting. Null when there's no rolling figure, the
   *  rolling sample is too small to read, or the signed error is exactly
   *  zero (no directional claim to make). */
  biasWord: 'under-projecting' | 'over-projecting' | null
  /** A full sentence carrying biasWord plus the magnitude — null exactly
   *  when biasWord is null. */
  biasSentence: string | null
}
