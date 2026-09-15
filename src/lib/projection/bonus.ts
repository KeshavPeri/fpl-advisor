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
 * SHARPENED — ticket #237, `docs/projection-model-backlog.md` G3. The
 * proportional share above was measured (`scripts/bonus-validation-report.ts`,
 * against real bonus/BPS ingested by ticket #224) to be too flat: it gets the
 * fixture-level TOTAL right but under-pays the players who actually win real
 * bonus, because real bonus is winner-take-most (3/2/1 to exactly three
 * players), not a continuous proportion. `allocateFixtureBonus` now raises
 * each player's excess to an exponent, {@link ALPHA}, before normalising —
 * see that constant's own doc comment for the exact formula, why `ALPHA = 1`
 * is a strict generalisation of the method above, and why its shipped value
 * here is a placeholder pending a live-data fit this Builder session could
 * not perform.
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
export const TOTAL_BONUS_POINTS_PER_FIXTURE = 6

/**
 * The real maximum bonus a single player can earn in one match (outright BPS leader, no tie).
 * Exported (ticket #237) so scripts/bonus-validation-report.ts can infer, from a player's
 * already-stored projected bonus figure alone, whether that player-fixture was clamped --
 * see that file's own `extractProjectedFixtureInfo` for exactly how, and its caveat that this
 * is an INFERENCE (no `clamped` flag is persisted to `player_projections`), not a stored fact.
 */
export const MAX_BONUS_POINTS_PER_PLAYER_FIXTURE = 3.0

/**
 * Ticket #237. The exponent that sharpens each player's share of a fixture's 6 bonus points:
 * `share_i = excess_i^ALPHA / sum_j(excess_j^ALPHA) * 6`. ALPHA = 1 is exactly the linear share
 * this file shipped with under ticket #78 (docs/projection-model-backlog.md G3) -- a strict
 * generalisation, not a replacement -- and ALPHA > 1 concentrates the six points on the
 * highest-excess players, closing the gap `scripts/bonus-validation-report.ts` measured between
 * the model's flat share and real bonus's winner-take-most shape.
 *
 * ================================================================================
 * PLACEHOLDER VALUE -- NOT YET CALIBRATED. This is 1 (a no-op), not a fitted number.
 * ================================================================================
 * Ticket #237's own text requires ALPHA to be "CALIBRATED, NOT CHOSEN", by the following
 * procedure, matching `teamStrength.ts`'s `SCALE` precedent (a real query against live data,
 * never invented, never a round number picked because it "looks about right"):
 *
 *   1. FIT on gameweek 2 only (n = 616 matched players, 20 of them top-by-expected_points) --
 *      the alpha that minimises the ABSOLUTE top-20 mean signed error
 *      (`scripts/bonus-validation-report.ts`'s `BonusComparisonStats.meanSignedError`, restricted
 *      to `TOP_N_PROJECTED`).
 *   2. EVALUATE that fitted alpha on gameweek 3 only (n = 652), held out and never used in the
 *      fit -- this is the number the ticket's falsification gate reads.
 *   3. Report the pooled (gameweeks 2+3) figure too, clearly labelled as in-sample for
 *      gameweek 2, never as an independent confirmation.
 *
 * Gameweek 1 carries no information for this fit (the allocator projected 0.000 bonus for every
 * player -- no current-season data existed yet, a start-of-season artefact, not a share-shape
 * measurement) and must not be used.
 *
 * THIS BUILDER SESSION COULD NOT PERFORM THAT FIT. It requires row-level (player, fixture)
 * `player_projections`/`gameweek_live_stats` data for gameweeks 2 and 3, and this session has no
 * Supabase credentials (`SUPABASE_URL`/`SUPABASE_SECRET_KEY` both unset, no database tool
 * available) -- the exact same structural limitation `docs/projection-model-backlog.md`'s G9, G11
 * and G13 already record for a live backtest run, and the same reason `teamStrength.ts`'s `SCALE`
 * comment states its own number was "Obtained by Keshav running a hand, read-only query directly
 * against Supabase -- NOT an in-run read from this job." The fit for ALPHA needs the identical
 * kind of hand-run, out-of-session query.
 *
 * A USEFUL SHORTCUT FOR WHOEVER RUNS THAT QUERY, recorded here so it does not need
 * re-deriving: gameweeks 2 and 3's own validation run reported ZERO clamped player-fixtures at
 * ALPHA = 1 (ticket #237's own problem statement table). Whenever a fixture is unclamped at
 * ALPHA = 1, each player's ALPHA = 1 bonus figure (`components.points.bonusPoints`, already
 * stored) is EXACTLY proportional to that player's `excess` (`share_i = excess_i / totalExcess *
 * 6` -- no clamping to distort it) -- and the ALPHA-generalised share is scale-invariant to that
 * proportionality constant: `(c*x_i)^a / sum_j(c*x_j)^a === x_i^a / sum_j(x_j)^a` for any `c > 0`.
 * So a candidate ALPHA's fixture-level shares can be recomputed EXACTLY from the already-stored
 * ALPHA = 1 `bonusPoints` values grouped by `components.fixtures[].fixtureId` (itself already
 * stored, see `scripts/project-points.ts`'s row-construction code) -- no re-derivation of raw
 * expected-BPS "excess" and no new column needed. This makes the fit a same-session,
 * read-only, no-code-change query once real Supabase access is available.
 *
 * Once that live fit and the ticket's falsification gate (both run against gameweek 3, held out)
 * are read, this constant must be updated BY HAND to the fitted value, with the two sample sizes,
 * the fit/holdout split and the date recorded here -- exactly replacing this placeholder note,
 * never appended alongside it.
 *
 * TWO GAMEWEEKS IS THIN. State this plainly for whoever reads the eventual fitted value: the
 * instrument (`gameweek_live_stats`) gains exactly one gameweek of evidence per week the season
 * progresses, and ALPHA must be RE-FITTED and RE-CHECKED once ten finished gameweeks are on
 * record -- see `docs/projection-model-backlog.md`'s G20 entry, added by this ticket.
 */
export const ALPHA = 1

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
 * ABOVE the bare-appearance baseline, raised to `alpha` (ticket #237).
 *
 * A player's raw share is `(excess^alpha / sum_j(excess_j^alpha)) * 6`.
 * `alpha = 1` (the {@link ALPHA} default) is EXACTLY the original ticket
 * #78 linear share -- `excess^1 === excess`, so this is a strict
 * generalisation, not a replacement; passing a literal `1` reproduces the
 * pre-#237 allocation bit-for-bit. `alpha > 1` concentrates the six points
 * on the highest-excess players -- real bonus is winner-take-most, not
 * proportional (see file header).
 *
 * Normalising AFTER raising to the power means the per-fixture total still
 * sums to 6 whenever nothing clamps, for ANY alpha -- the level cannot
 * break while the shape is being sharpened. Any raw share above 3.0 (the
 * real per-match maximum) is clamped to 3.0; the clamped-off residual is
 * left unallocated, not redistributed -- so a fixture with a clamped
 * player sums to strictly LESS than 6.00. A higher alpha makes clamping
 * MORE likely (concentration pushes the top share up), not less.
 *
 * When every player's excess is exactly 0 (no data, or a fixture nobody in
 * the group is projected to do anything in beyond appearing), every player
 * gets exactly 0 -- no divide-by-zero, and this check happens BEFORE the
 * `^alpha` step so it is unaffected by alpha's value.
 */
export function allocateFixtureBonus<Id>(entries: readonly FixtureBonusEntry<Id>[], alpha: number = ALPHA): FixtureBonusResult<Id>[] {
  const excessByEntry = entries.map((entry) => nonAppearanceBps(entry.position, entry.events))
  const totalExcess = excessByEntry.reduce((sum, excess) => sum + excess, 0)

  if (totalExcess <= 0) {
    return entries.map((entry) => ({ id: entry.id, bonusPoints: 0, clamped: false }))
  }

  const poweredByEntry = excessByEntry.map((excess) => excess ** alpha)
  const totalPowered = poweredByEntry.reduce((sum, powered) => sum + powered, 0)

  return entries.map((entry, index) => {
    const rawShare = (poweredByEntry[index] / totalPowered) * TOTAL_BONUS_POINTS_PER_FIXTURE
    const clamped = rawShare > MAX_BONUS_POINTS_PER_PLAYER_FIXTURE
    return {
      id: entry.id,
      bonusPoints: clamped ? MAX_BONUS_POINTS_PER_PLAYER_FIXTURE : rawShare,
      clamped,
    }
  })
}
