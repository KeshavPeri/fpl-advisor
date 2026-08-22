/**
 * Bonus-points projection — ticket #78, `docs/projection-model-backlog.md`
 * G3.
 *
 * The binding constraint: this app cannot compute a real BPS total.
 * `player_match_stats` carries six of the roughly thirty relevant BPS-scoring
 * actions (minutes, goals, assists, saves, CBI, recoveries) and none of the
 * passing, dribbling, shots-on-target, key-pass or big-chance data the real
 * BPS system also scores. Any method that depends on an accurate ABSOLUTE
 * BPS number is unsound. What the available data supports is relative
 * ordering and spread between players in the same match, which is what a
 * share-based allocation needs.
 *
 * Adopted method: share the six bonus points available in a match in
 * proportion to each player's expected BPS ABOVE a bare-appearance
 * baseline. In one sentence: the six bonus points a match awards are shared
 * out according to how much each player is expected to do beyond simply
 * turning up.
 *
 * Two rejected alternatives, recorded so nobody re-proposes them:
 *  - Rank allocation (`src/lib/scoring/bonus.ts`'s `allocateBonusPoints`):
 *    winner-take-all, overstates the top player roughly threefold. Correct
 *    for SETTLING a finished match (a real BPS ranking exists there); wrong
 *    for projection, where only an expectation exists. Not modified, not
 *    reused, by design -- see that file's own header.
 *  - Proportional to TOTAL expected BPS (appearance BPS included): every
 *    player who is expected to last an hour banks a large, performance-blind
 *    appearance floor, so shares come out nearly flat (~0.27 each) --
 *    flatter than reality, and flatness is the specific error G3 describes.
 *
 * Why the appearance term is excluded from the share, stated as the
 * "because": it is the one BPS component every participating player banks
 * regardless of how he plays, so it carries no information about who
 * deserves bonus. Because every other modelled term is non-negative, the
 * "excess" above the appearance baseline is exactly the sum of the
 * non-appearance terms -- no subtraction or clamping-to-zero is needed.
 *
 * Pure computation only: no I/O, no database, no fetch.
 */
import type { Position } from '../scoring/types.ts'
import {
  APPEARANCE_BPS_60_PLUS,
  APPEARANCE_BPS_UNDER_60,
  ASSIST_BPS,
  CBI_ACTIONS_PER_BPS,
  ORDINARY_SAVE_BPS,
  RECOVERY_ACTIONS_PER_BPS,
  cleanSheetBps,
  goalBps,
} from '../scoring/bps.ts'
import type { FixtureExpectedEvents } from './expectedPoints.ts'

/** Bonus points a single Premier League fixture has to award, total, across every player. */
const TOTAL_BONUS_POINTS_PER_FIXTURE = 6

/** The real maximum bonus a single player can earn in one match (outright BPS leader, no tie). */
const MAX_BONUS_POINTS_PER_PLAYER_FIXTURE = 3.0

/**
 * Expected appearance BPS alone: `3 x (pAppears - pSixtyPlus) + 6 x pSixtyPlus`.
 * The one component every participating player banks regardless of
 * performance -- deliberately factored out so {@link allocateFixtureBonus}
 * can exclude it from the share without recomputing it differently there.
 */
function appearanceBps(events: Pick<FixtureExpectedEvents, 'pAppears' | 'pSixtyPlus'>): number {
  return APPEARANCE_BPS_UNDER_60 * (events.pAppears - events.pSixtyPlus) + APPEARANCE_BPS_60_PLUS * events.pSixtyPlus
}

/**
 * Expected BPS from every modelled term OTHER than appearance: goals,
 * assists, clean sheet, saves, CBI, recoveries. This is exactly the
 * "excess above the bare-appearance baseline" the file header describes --
 * every term here is a non-negative expectation times a non-negative BPS
 * value, so the sum is guaranteed non-negative with no clamping needed.
 *
 * The CBI and recovery terms DIVIDE, they do not floor --
 * `bpsFromCbi`'s `Math.floor` in `src/lib/scoring/bps.ts` is correct for a
 * finished match (a real count) and wrong for an expectation (flooring an
 * expected value is not the expectation of the floor).
 */
function nonAppearanceBps(position: Position, events: FixtureExpectedEvents): number {
  return (
    events.expectedGoals * goalBps(position) +
    events.expectedAssists * ASSIST_BPS +
    events.pCleanSheet * events.pSixtyPlus * cleanSheetBps(position) +
    events.expectedSaves * ORDINARY_SAVE_BPS +
    events.expectedCbi / CBI_ACTIONS_PER_BPS +
    events.expectedRecoveries / RECOVERY_ACTIONS_PER_BPS
  )
}

/**
 * Expected total BPS for one player-fixture: the appearance baseline plus
 * every other modelled term. Exported so a caller can inspect the full
 * figure; {@link allocateFixtureBonus} below uses only the non-appearance
 * part of this same computation to build each player's share.
 */
export function expectedBps(position: Position, events: FixtureExpectedEvents): number {
  return appearanceBps(events) + nonAppearanceBps(position, events)
}

/** One player projected for one fixture, as far as bonus allocation needs it. */
export interface FixtureBonusEntry<Id> {
  id: Id
  position: Position
  events: FixtureExpectedEvents
}

export interface FixtureBonusResult<Id> {
  id: Id
  /** This player's share of the fixture's 6 bonus points, clamped at {@link MAX_BONUS_POINTS_PER_PLAYER_FIXTURE}. */
  bonusPoints: number
  /** True when the raw proportional share exceeded the 3.0 cap and was clamped down -- the clamped amount is left unallocated, never redistributed to other players. */
  clamped: boolean
}

/**
 * Allocates one fixture's 6 available bonus points across every player
 * projected for it (both clubs -- see file header on why total entries is
 * closer to ~50 than 22), in proportion to each player's expected BPS
 * ABOVE the bare-appearance baseline.
 *
 * A player's raw share is `(excess / totalExcess) * 6`. Any raw share above
 * 3.0 (the real per-match maximum) is clamped to 3.0; the clamped-off
 * residual is left unallocated, not redistributed -- so a fixture with a
 * clamped player sums to strictly LESS than 6.00.
 *
 * When every player's excess is exactly 0 (no data, or a fixture nobody in
 * the group is projected to do anything in beyond appearing), every player
 * gets exactly 0 -- no divide-by-zero.
 */
export function allocateFixtureBonus<Id>(entries: readonly FixtureBonusEntry<Id>[]): FixtureBonusResult<Id>[] {
  const excessByEntry = entries.map((entry) => nonAppearanceBps(entry.position, entry.events))
  const totalExcess = excessByEntry.reduce((sum, excess) => sum + excess, 0)

  if (totalExcess <= 0) {
    return entries.map((entry) => ({ id: entry.id, bonusPoints: 0, clamped: false }))
  }

  return entries.map((entry, index) => {
    const rawShare = (excessByEntry[index] / totalExcess) * TOTAL_BONUS_POINTS_PER_FIXTURE
    const clamped = rawShare > MAX_BONUS_POINTS_PER_PLAYER_FIXTURE
    return {
      id: entry.id,
      bonusPoints: clamped ? MAX_BONUS_POINTS_PER_PLAYER_FIXTURE : rawShare,
      clamped,
    }
  })
}
