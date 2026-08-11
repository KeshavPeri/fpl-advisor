/**
 * Total match points for a player from their component stats.
 *
 * Deliberately an aggregator, not a re-derivation: it sums point values that
 * have already been computed by the other functions in this module (defensive
 * contribution, goalkeeper saves, bonus) plus the caller-supplied standard
 * scoring components (appearance, goals, assists, clean sheets, goals
 * conceded, cards, own goals, penalties). Standard scoring categories are
 * unchanged for 2026/27 and are not restated as rules here — see
 * product-brief.md §6d, which lists only defensive contribution, goalkeeper
 * saves, BPS and bonus as load-bearing changes for this season. Hardcoding
 * unverified point values for the unchanged categories inside this module
 * would risk exactly the training-data drift the brief warns against, so
 * this function accepts them as already-known numbers instead.
 */

export interface MatchPointComponents {
  appearancePoints: number
  goalPoints: number
  assistPoints: number
  cleanSheetPoints: number
  goalsConcededPoints: number
  savePoints: number
  defensiveContributionPoints: number
  penaltySavePoints: number
  penaltyMissPoints: number
  yellowCardPoints: number
  redCardPoints: number
  ownGoalPoints: number
  bonusPoints: number
}

/** Sums a player's already-computed point components into a match total. */
export function totalMatchPoints(components: MatchPointComponents): number {
  return Object.values(components).reduce((total, points) => total + points, 0)
}
