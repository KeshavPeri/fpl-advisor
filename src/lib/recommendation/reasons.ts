/**
 * Reason lines — ticket #47. Stored short factual lines, one row per line
 * (`recommendation_reasons`), NOT generated prose — item 21 renders them
 * and item 14 puts the headline into Telegram later.
 *
 * design-reference.md's interface-writing rule binds this text even though
 * this ticket has no UI: sentence case, plain verbs, no filler, FPL's own
 * vocabulary ("gameweek", "transfer", "captain"), no emoji. "Roll your
 * transfer" is written as a confident answer, never as an absence. Do not
 * add "differential" or "effective ownership" wording — product-brief.md
 * §1 keeps mini-league position out of every recommendation.
 */
import type { ConfidenceBand } from './confidence.ts'

export interface CoverageReasonInput {
  role: string
  name: string
}

export interface ReasonInputs {
  isRoll: boolean
  transferInName: string | null
  transferOutName: string | null
  captainName: string
  viceCaptainName: string
  hitCost: number
  transfersMade: number
  freeTransfersAvailable: number
  grossPointsRounded: number
  netPointsRounded: number
  confidenceBand: ConfidenceBand
  /**
   * True when this is the only distinct plan the solve produced this gameweek — every other
   * solution the solver returned was collapsed as the same decision (see
   * src/lib/recommendation/distinctness.ts). There is then no "next-best alternative" to compare
   * this plan against, so the confidence-band comparison line below would be describing an
   * alternative that does not exist. Ticket #60's DoD: this reads as one clear course of action
   * with no meaningfully different alternative — a confident answer, never an apology or hedge.
   */
  isOnlyDistinctPlan: boolean
  /** Players in THIS plan with no Premier League match history — already resolved to display names by the caller. */
  coverageGaps: readonly CoverageReasonInput[]
}

/** Builds one plan's ordered reason lines. Pure string assembly from already-resolved inputs — no lookup, no I/O. */
export function buildReasonLines(inputs: ReasonInputs): string[] {
  const lines: string[] = []

  if (inputs.isRoll) {
    lines.push('Roll your transfer. No changes recommended this gameweek.')
  } else {
    lines.push(`Transfer in ${inputs.transferInName}. Transfer out ${inputs.transferOutName}.`)
  }

  lines.push(`Captain ${inputs.captainName}. Vice-captain ${inputs.viceCaptainName}.`)

  if (inputs.hitCost > 0) {
    lines.push(
      `Costs a ${inputs.hitCost}-point hit — ${inputs.transfersMade} transfer(s) made against ${inputs.freeTransfersAvailable} free.`,
    )
    lines.push(`Projected gain: ${inputs.grossPointsRounded} points before the hit, ${inputs.netPointsRounded} after.`)
  }

  if (inputs.isOnlyDistinctPlan) {
    lines.push('One clear course of action this gameweek — no meaningfully different alternative.')
  } else if (inputs.confidenceBand === 'coin-flip') {
    lines.push('This plan and the next-best alternative are statistically close. Either is a reasonable choice.')
  } else if (inputs.confidenceBand === 'marginal') {
    lines.push('A marginal edge over the next-best alternative across the gameweeks ahead.')
  } else {
    lines.push('A clear edge over the next-best alternative across the gameweeks ahead.')
  }

  for (const gap of inputs.coverageGaps) {
    lines.push(`${gap.name} has no Premier League match history yet. This projection rests on a position estimate, not real form.`)
  }

  return lines
}
