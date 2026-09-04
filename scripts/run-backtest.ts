// Backtest harness — ticket #133 (feature-list item 32, first slice).
//
// ============================================================================
// WHAT THIS IS, AND WHY IT IS NOT scripts/calibration-report.ts.
// ============================================================================
// calibration-report.ts compares two DISTRIBUTIONS with full-season hindsight
// on both sides — its own caveats say plainly that this is invalid for
// judging any one prediction. A backtest asks a different question: for each
// gameweek of a past season, using ONLY what was knowable strictly before
// that gameweek, what would the model have projected — and what actually
// happened? public.feature_history (ticket #121, densified by #125) makes
// this possible: every row already carries the CUMULATIVE totals of a
// player's Premier League matches strictly before its gameweek_id, nothing
// from the gameweek itself and nothing later. This job's entire job is to
// not reach past that boundary — see "THE JOIN" below.
//
// ============================================================================
// SCOPE OF THIS FIRST SLICE — measures the PROJECTION, not the recommendation.
// ============================================================================
// No transfers, no captaincy, no solver, no season league position — that is
// item 32's remaining work. This slice reads feature_history, produces one
// projected-points figure per (player, gameweek) row from the existing pure
// modules under src/lib/projection/, reconstructs that gameweek's actual
// points from player_match_stats via src/lib/scoring/, and reports the
// signed error. Read-only: the only Supabase write anywhere in this file is
// its own job_runs row.
//
// ============================================================================
// THE JOIN. Never player_match_stats for features.
// ============================================================================
// feature_history is keyed on player_code, never the FPL element id — 453 of
// 458 element ids changed between the 2025-2026 and 2026-2027 seasons (see
// the #12/#22 migrations). This job selects no player_id from either table.
// POSITION (ticket #154, fixing a defect this file used to have): the
// PRIMARY source is feature_history.element_type itself — populated at
// ingest time from that ROW'S OWN season's players.csv (ticket #146) — with
// the live players.code = feature_history.player_code / .player_code join a
// FALLBACK for rows written before that column existed, never the primary
// path any more. Joining to the live `players` table was the defect: that
// table holds only the CURRENT season's players, so a 2025-2026 player no
// longer in the 2026/27 game had no row there and the row was silently
// dropped as unresolvedPlayerCode — 23% of this job's population. See
// resolveRowPosition. Actuals are filtered to competition =
// PREMIER_LEAGUE_COMPETITION (ticket #54) — cup and European rows score no
// FPL points and carry 34% higher xG per 90.
//
// RATE INPUTS COME FROM feature_history's prior_* TOTALS AND NOTHING ELSE.
// This job never reads player_match_stats to build a rate — that table is
// read here for exactly one purpose: reconstructing the TARGET gameweek's
// actual points. If a future edit finds itself computing a rate from
// player_match_stats, the lookahead has already happened (ticket text).
//
// ============================================================================
// HOW A PROJECTION IS BUILT FROM CUMULATIVE TOTALS (Tier 2 — logged
// HIGH-IMPACT; see the Builder report for the full "because").
// ============================================================================
// feature_history stores season-to-date CUMULATIVE totals, not a per-match
// history and not a last-five-match window — so the live pipeline's exact
// inputs (scripts/project-points.ts's recent-minutes list, per-match defcon
// hit/miss history, real fixture elo) do not exist here. This job builds the
// closest honest equivalent from what IS available, using every function
// unmodified:
//
//  - Rates (xG/xA/saves/CBI/recoveries per 90): rates.ts's own formula is
//    generic in the underlying count, so a player's PlayerRateHistory is
//    built directly from prior_minutes/prior_xg/prior_xa/prior_saves/
//    prior_clearances+blocks+interceptions/prior_recoveries — an exact,
//    non-approximated mapping. The POSITION prior each row shrinks toward is
//    computed by rates.ts's own positionPriorRates(), fed every OTHER
//    player's prior_* totals for that SAME gameweek and position — itself
//    entirely knowable before that gameweek, so the prior carries no
//    lookahead either.
//
//  - Minutes need PER-MATCH data (minutes.ts's last-five list) that a
//    cumulative total cannot reconstruct exactly. This job approximates a
//    player's "typical match" — average minutes per prior match — and feeds
//    that single averaged match into estimateMinutes() unmodified. This is a
//    real approximation and is deliberately not hidden: see
//    docs/projection-model-backlog.md's new section for the "because" and
//    the sanity bounds this file checks partly guard against exactly this
//    kind of harness error. Unchanged by ticket #154 — see below.
//
//  - Defensive-contribution hit rate ALSO needed per-match data
//    (defconRate.ts's per-match threshold check), and until ticket #154 was
//    approximated exactly like minutes above (one averaged "typical match",
//    checked once against the threshold) — a defect, not a deliberate
//    approximation: with defconRate.ts's own shrinkage strength that
//    approximation could never let a player's own evidence carry more than
//    1/6 of the estimate's weight, REGARDLESS of how many real matches he
//    had (ticket #146's prior_matches bucket diagnostic below found this
//    shape and could not explain it until now). Ticket #146 added the real
//    per-match counters (prior_defcon_qualifying_matches, prior_defcon_hits)
//    feature_history was missing; ticket #154 reads them and reproduces the
//    real qualifying-match count and hit count exactly (buildDefconMatches /
//    buildDefconMatchesFromCounts) — see resolveRowPosition's sibling
//    section below. The single-averaged-match path remains, unmodified, as
//    the fallback for a row written before that migration (hasDefconCounters
//    false) — see buildDefconMatches's own comment.
//
//  - Fixture difficulty does not exist in feature_history at all (no
//    opponent, no elo, no FDR). Every row is projected against a NEUTRAL
//    fixture — fplDifficulty = 3, teamElo/opponentElo = null — which
//    fixture.ts's own DIFFICULTY_EXPECTED_SCORE table resolves to exactly
//    expectedScore = 0.5, the same value real elo gives two evenly-matched
//    teams. At that value attackingMultiplier/defensiveMultiplier are both
//    exactly 1.0 and expectedGoalsConceded is exactly leagueBaselineGoals —
//    i.e. an honest "average fixture", not a hand-derived shortcut.
//
//  - Availability: feature_history carries no players.status/
//    chance_of_playing history for a past season, and reading TODAY's
//    players table for a historical gameweek would itself be a form of
//    lookahead (today's fitness says nothing about a gameweek two seasons
//    ago). Every row is projected as fully available (status 'a') — a row
//    with prior_matches > 0 already carries positive evidence the player was
//    selectable, which is the best signal this table can offer.
//
//  - Multi-fixture gameweeks: feature_history is one row per (player,
//    gameweek), not per fixture, so a naive projection would always project
//    exactly one fixture per gameweek even when a player's team played
//    twice — CLOSED by ticket #140 (Tier 2 — logged HIGH-IMPACT; see the
//    Builder report for the full "because"). This job has no independent
//    fixture-schedule table for a past season (the live `fixtures` table
//    carries no `season` column — it is the CURRENT season's schedule
//    only), so the fixture count fed to the projected side is the number of
//    player_match_stats ROWS FOUND for that (player, gameweek) — exactly
//    the count the actual side already sums (aggregateActualForGameweek's
//    own matchesFound). Two identical neutral fixture contexts are then
//    projected and summed via expectedPoints.ts's own projectPlayerGameweek
//    (unmodified — it already sums whatever fixture array it is given).
//    This is a real approximation: a player rotated out of ONE of his
//    team's two fixtures that gameweek is still projected for 1, not the
//    team's true 2, because this job has no signal of "team fixture count"
//    independent of this player's own appearances. Documented, not hidden.
//
//  - Blank gameweeks (a player's team had NO fixture that gameweek — a
//    postponement/rearrangement, not a benching) are a DIFFERENT case from
//    "didNotFeature" (team played, this player just didn't) and get their
//    own exclusion reason, `blankGameweek` — ticket #140. Distinguishing
//    the two needs *some* notion of team schedule, which player_match_stats
//    alone does not carry as a column — but match_id embeds it as text
//    (e.g. "25-26-prem-manchester-united-vs-arsenal"). This job infers each
//    player's team-for-the-season as the single team-slug appearing most
//    often across ALL of that player's own match_id rows that season (see
//    inferTeamSlug) — the player's own team appears in every one of his
//    matches, each opponent in at most a handful — and treats a gameweek as
//    "the team played" if that slug appears in ANY match_id, for ANY
//    player, in that season+gameweek (see buildTeamSlugsByGameweek). A
//    player with too little history to resolve a team-slug (or fewer than
//    two matches, where the modal slug can tie) defaults to hadFixture =
//    true — i.e. falls back to today's didNotFeature behaviour rather than
//    guessing blankGameweek. Fail open, not fail confident.
//
// ============================================================================
// THE MEASURED POPULATION (ticket text, verbatim rule).
// ============================================================================
// A feature_history row enters the headline MAE/MSE only if ALL of:
//   1. prior_matches > 0        — otherwise there is no point-in-time signal
//                                  at all (named test: "no prior matches").
//   2. the player actually featured that gameweek (minutes_played > 0 in at
//      least one matching player_match_stats row) — a player who did not
//      feature is a correct zero on both sides that would flatter the error
//      by diluting it with an easy case (named test: "did not feature").
//   3. that gameweek's actual reconstruction is not missing
//      team_goals_conceded (~2% of rows, ticket #125's known gap, carried
//      forward here rather than solved) — without it the clean-sheet/
//      goals-conceded reconstruction is a guess, not a measurement.
//   4. the player's team did have a fixture that gameweek (ticket #140) —
//      a genuine blank gameweek is excluded as `blankGameweek`, distinct
//      from a player who simply did not feature in a fixture his team did
//      play (`didNotFeature`). See "BLANK GAMEWEEKS" below.
// Every row read falls into EXACTLY one of: measured, or one of the five
// named exclusion reasons below — a strict partition, asserted in
// assertReconciles() and covered by a named test.
//
// ============================================================================
// team_goals_conceded, NOT the per-player goals_conceded column.
// ============================================================================
// player_match_stats.goals_conceded is a goalkeeper-only stat, ~1% populated
// for outfield rows (see build-feature-history.ts's own header) — using it
// for clean-sheet reconstruction on outfield players would silently default
// nearly every one of them to "0 conceded" and inflate the derived
// clean-sheet rate toward 100%, which is exactly the failure mode
// CLEAN_SHEET_RATE_UPPER_BOUND below exists to catch. This job reads
// team_goals_conceded (added by ticket #125's migration, ~98% populated for
// 2025-2026 — the other known gap carried forward, not solved here) for
// every position, matching feature_history's own prior_team_goals_conceded
// column and build-feature-history.ts's stated correction.
//
// ============================================================================
// BONUS — excluded from both sides, without extra bookkeeping.
// ============================================================================
// The actual side has no bonus column to read (verified, ticket #127 — no
// `bonus` column in the FPL-Core-Insights source, and it can never have one).
// The projected side here calls src/lib/projection/expectedPoints.ts's
// projectPlayerFixture() directly (never scripts/project-points.ts's SEPARATE
// bonus-allocation pass), whose own components.bonusPoints is hardcoded to
// exactly 0 — so bonus is absent from both sides by construction, with no
// subtract-back-out step needed (unlike calibration-report.ts, which compares
// against project-points.ts's bonus-carrying stored output and must undo it).
//
// ============================================================================
// SANITY BOUNDS — the report FAILS, naming the figure, rather than printing
// a number nobody checked.
// ============================================================================
// Mean absolute error outside [MAE_LOWER_BOUND, MAE_UPPER_BOUND] points per
// player-gameweek, or any position's derived clean-sheet rate above
// CLEAN_SHEET_RATE_UPPER_BOUND, means the HARNESS is wrong, not the model —
// see checkSanityBounds(). The report file is still written (useful for
// diagnosing which figure failed) but the job_runs row records status
// 'failure' and the process exits non-zero.
//
// ============================================================================
// RANKING SKILL — ticket #147 (feature-list item 32, next slice after #133/
// #140). A different question from everything above: not "how close are the
// model's numbers" but "does it put the right players at the top" — the
// only thing a recommendation actually depends on (the captain IS the
// squad's top-projected player; a transfer IS a claim one player will
// outscore another). Computed entirely from the SAME `measured: MeasuredRow[]`
// population #133/#140 already build — no new Supabase read, no change to
// the measured-population rule or its reconciliation.
//
//  - Spearman rank correlation between projected and actual points, per
//    gameweek and pooled across the season (mirroring how `overall` pools
//    every measured row for MAE above) — tied values share the AVERAGE of
//    the ranks they would occupy (the standard tie-correction; many rows
//    project identically at the position prior, so ties are common, not an
//    edge case). Implemented as the Pearson correlation of the two rank
//    sequences, which is exactly the tie-corrected Spearman's rho.
//
//  - Top-10 / top-20 overlap: within one set of same-gameweek rows, which
//    rows rank in the top N by PROJECTED points, which rank in the top N by
//    ACTUAL points, and how many rows are in both sets. Selecting the top N
//    by value uses a stable sort (ties broken by original row order) — a
//    different, explicit tie rule from Spearman's average-rank rule, because
//    "top 10" must select exactly 10 rows, not a fractional rank.
//
//  - Per-gameweek figures use the SAME MIN_BUCKET_SAMPLE_SIZE (50) threshold
//    #140's buckets already use — a gameweek under that is reported "too
//    small to read", never as a correlation (ticket text). Per-position
//    figures pool the whole season for Spearman (like the existing
//    by-position MAE table) and sum top-N overlaps across every gameweek for
//    that position (no 50-row gate there: a per-gameweek goalkeeper
//    population is often under 50 by construction — roughly one starting
//    keeper per club — so gating at 50 would silently zero out goalkeepers
//    entirely rather than reporting an honestly smaller sample size).
//
//  - Sanity bounds (ticket text, pre-answered): a Spearman correlation
//    outside [-0.2, 0.9], or a top-10 OR top-20 overlap fraction above 9/10
//    (ticket #159 extended this from top-10-only — see below), fails the
//    report — checked on the season aggregate and on each position,
//    mirroring checkSanityBounds' own overall-plus-by-position shape. The
//    upper bound matters more: a suspiciously good correlation is the shape
//    a lookahead leak takes.
//
// ============================================================================
// NAIVE RANKING BASELINES, TOP-N REFUSAL, AND THE WIDER LEAK BOUND — ticket
// #159, three defects LEARNINGS-second-build-wave.md §13/§14 recorded against
// #147's ranking-skill slice above, reproduced by the 30 Aug backtest run.
// ============================================================================
//
//  - DEFECT 1 (§13) — the headline season Spearman (0.305, n=10,474) has no
//    comparator. #147's ticket TEXT (not the SPEARMAN_LOWER_BOUND/
//    SPEARMAN_UPPER_BOUND harness-sanity bounds above, a different check for
//    a different purpose — those exist to catch the harness being WRONG, not
//    to say whether a value is GOOD) separately asserted an absolute band of
//    0.3–0.6 for "is this good", invented from general intuition and not
//    derived from anything about weekly FPL scoring, so a reader has no way
//    to tell "0.305" apart from "a naive rule would have scored just as
//    well". Fixed by three baseline rankings —
//    computed over the IDENTICAL `measured: MeasuredRow[]` population the
//    model's own Spearman above uses (no separate population, no second
//    Supabase read, no `players.now_cost` — see the ticket's own explicit
//    exclusion, a 2026/27 price would be both a cross-season mismatch and a
//    lookahead against 2025/26 gameweeks):
//      - prior minutes per match (`prior_minutes / prior_matches`) —
//        computeBaselineMinutesPerMatch.
//      - prior xG+xA per match (`(prior_xg + prior_xa) / prior_matches`) —
//        computeBaselineXgXaPerMatch.
//      - a constant ranking — every row assigned the identical raw value
//        (CONSTANT_BASELINE_VALUE), the zero-skill floor. A literally
//        constant value has zero variance, so spearmanCorrelation correctly
//        returns null there (proven by this file's own "identical values"
//        test) rather than a numeric 0 — computeConstantBaselineSpearman
//        asserts that null (throwing if it is ever anything else — the
//        self-test: an implementation that finds a SPURIOUS signal in an
//        input that carries none is broken) and reports it as exactly 0.
//    Both real baselines carry prior_matches > 0 by construction (a
//    feature_history row with prior_matches = 0 is already excluded before
//    ever reaching the measured population — see classifyRow's
//    `noPriorMatches` reason) — computeBaselineMinutesPerMatch/
//    computeBaselineXgXaPerMatch ASSERT this (throw if violated) rather than
//    guarding it defensively with a `?? 0`, so a future change that admits a
//    zero-prior-matches row into the measured population fails loudly here,
//    unlike averageMinutesPerMatch above (used for the recentMinutes
//    approximation), which IS called on excluded rows too via
//    computePositionPriors and must default safely. The report states, per
//    baseline, at the season aggregate: model's Spearman MINUS that
//    baseline's — a DIFFERENCE, never checked against an asserted threshold
//    (buildBaselineVerdicts).
//
//  - DEFECT 2 (§14) — a top-N metric is meaningless when N approaches the
//    population it is drawn from. Goalkeeper top-20 overlap read 696/698
//    (99.7%) over a per-gameweek goalkeeper population of ~19 — topNOverlap
//    already caps N at the population correctly (min(20, 19) = 19), but a
//    top-19-of-19 "overlap" is close to automatic (select nearly the whole
//    population, count how much of it overlaps with itself), not a ranking
//    signal. Fixed by topNIsMeaningful/TOP_N_MAX_POPULATION_FRACTION: a
//    JUDGEMENT threshold (not derived from anything about FPL scoring, and
//    deliberately given a DIFFERENT value from TOP10_OVERLAP_UPPER_BOUND_
//    FRACTION above so the two are never confused — that one asks "is the
//    overlap suspiciously GOOD", this one asks "is N close enough to the
//    population that any overlap would be uninteresting regardless of
//    value") — applied per (gameweek, position) slice, the same "too small
//    to read" discipline #147 already applies to gameweeks under
//    MIN_BUCKET_SAMPLE_SIZE rows, but keyed on a FRACTION of that slice's
//    own population rather than an absolute row count (50 is not a
//    meaningful floor for something whose natural weekly population is ~19,
//    as opposed to ~250 for every position pooled). A refused slice
//    contributes NOTHING to summarizeRankingByPosition's season-position
//    sum — Defect 2's 696/698 becomes an honest "too small to read" rather
//    than a misleadingly precise percentage.
//
//  - DEFECT 3 (§14) — the leak-alarm sanity bound (checkRankingSanityBounds,
//    #147: fails the report on a top-10 overlap above 9/10) was applied only
//    to the season aggregate and each position's TOP-10 — the 99.7% figure
//    above was a TOP-20 and sailed straight through, because the guard never
//    looked there. Fixed by applying the SAME TOP10_OVERLAP_UPPER_BOUND_
//    FRACTION bound to top-20 too, at every level checkRankingSanityBounds
//    already checks (season aggregate, each position) — not a new bound,
//    the existing one applied to the place the leak shape actually appeared.
//    A separate, unverified observation from the same 30 Aug run — Defender
//    and Midfielder report byte-identical overlaps (75/370, 226/740) on
//    populations of 3,632/4,860, where the SAME two figures differed in the
//    29 Aug run (DEF 75/231, MID 82/239) — is NOT asserted as a bug here
//    (`summarizeRankingByPosition` looks correct on inspection); this ticket
//    only adds the per-gameweek × per-position breakdown
//    (summarizeRankingByGameweekAndPosition) that makes it distinguishable
//    on the next run.
//
// ============================================================================
// Wiring.
// ============================================================================
// Reads exactly SUPABASE_URL and SUPABASE_SECRET_KEY. Season is
// BACKTEST_SEASON, trimmed, falling back to DEFAULT_SEASON when unset or
// blank — matching scripts/build-feature-history.ts's FEATURE_HISTORY_SEASON
// convention exactly (a job-specific env var name, same trim-and-default
// behaviour, not a shared variable). Writes to no table but job_runs (one
// row, never upserted). Writes one file, to BACKTEST_REPORT_PATH. Issues no
// Supabase insert/update/upsert/delete anywhere except that one job_runs
// insert. NOT wired into any scheduled workflow — workflow_dispatch only,
// run by hand, deliberately (this reads a whole season).

import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { mkdir, writeFile } from 'node:fs/promises'
import { dirname } from 'node:path'
import { assertRowCountMatches, fetchAllPages } from './lib/paginate.ts'
import { PREMIER_LEAGUE_COMPETITION } from './lib/competition.ts'
import type { DefensiveActionStats, Position } from '../src/lib/scoring/types.ts'
import { DEFENDER, FORWARD, GOALKEEPER, MIDFIELDER } from '../src/lib/scoring/types.ts'
import { defensiveContributionPoints } from '../src/lib/scoring/defensiveContribution.ts'
import { goalkeeperSavePoints } from '../src/lib/scoring/goalkeeperSaves.ts'
import { totalMatchPoints, type MatchPointComponents } from '../src/lib/scoring/totalMatchPoints.ts'
import {
  APPEARANCE_POINTS_60_PLUS,
  APPEARANCE_POINTS_UNDER_60,
  ASSIST_POINTS,
  GOALS_CONCEDED_DIVISOR,
  GOALS_CONCEDED_POINTS_PER_UNIT,
  cleanSheetPoints,
  goalPoints,
  goalsConcededPointsApply,
  savePointsApply,
} from '../src/lib/projection/pointValues.ts'
import { positionPriorRates, type PlayerRateHistory, type PlayerRates, type RateHistoryMatch } from '../src/lib/projection/rates.ts'
import { positionPriorHitRate } from '../src/lib/projection/defconRate.ts'
import type { DefensiveContributionMatch } from '../src/lib/projection/types.ts'
import { HOME_ADVANTAGE_ELO, LEAGUE_BASELINE_GOALS_PER_TEAM } from '../src/lib/projection/fixture.ts'
import {
  projectPlayerGameweek,
  type FixtureContext,
  type FixtureProjectionComponents,
  type GameweekProjection,
  type PlayerProjectionInput,
} from '../src/lib/projection/expectedPoints.ts'

const JOB_NAME = 'run-backtest'
const FEATURE_HISTORY_MIGRATION = 'supabase/migrations/20260827090000_feature_history.sql'
const PLAYER_MATCH_STATS_MIGRATION = 'supabase/migrations/20260811170000_player_match_stats.sql'
const TEAM_GOALS_CONCEDED_MIGRATION = 'supabase/migrations/20260828090000_player_match_stats_team_goals_conceded.sql'
const TEAM_AND_OPPONENT_MIGRATION = 'supabase/migrations/20260831090000_team_and_opponent.sql'

/**
 * Season this job backtests, read from BACKTEST_SEASON — trimmed, falling
 * back to this default when unset or blank. Matches
 * scripts/build-feature-history.ts's FEATURE_HISTORY_SEASON convention
 * exactly (job-specific env var, same trim-and-default rule), not a shared
 * variable — this job can be pointed at a different season than that job's
 * own default without the two fighting over one env var.
 */
export const DEFAULT_SEASON = '2025-2026'

const DEFAULT_REPORT_PATH = './out/backtest-report.md'

/**
 * Assumed availability for every projected row (Tier 3 — see file header).
 * No historical daily fitness signal exists in feature_history for a past
 * season, and today's players.status says nothing about a gameweek in an
 * earlier season, so this is the deliberate, documented substitute.
 */
const ASSUMED_AVAILABILITY_STATUS = 'a'

/**
 * The neutral FPL difficulty rating (1 = easiest, 5 = hardest) fed to
 * fixture.ts when no real fixture exists to project against. fixture.ts's
 * own DIFFICULTY_EXPECTED_SCORE table resolves 3 to exactly 0.5 — the same
 * expectedScore two elo-even teams produce — so every multiplier derived
 * from it below is exactly 1.0 (no adjustment). Tier 3.
 */
const NEUTRAL_FIXTURE_DIFFICULTY = 3

/**
 * Sanity bounds (ticket text, pre-answered — not fitted here). Outside these,
 * the HARNESS is wrong, not the model — see checkSanityBounds().
 */
export const MAE_LOWER_BOUND = 1.0
export const MAE_UPPER_BOUND = 3.5
export const CLEAN_SHEET_RATE_UPPER_BOUND = 0.6

/**
 * Ranking-skill sanity bounds (ticket #147, ticket text verbatim). Outside
 * these, the HARNESS is wrong, not the model — see checkRankingSanityBounds().
 * The upper bound matters more than the lower one: a suspiciously good
 * correlation is the shape a lookahead leak takes.
 */
export const SPEARMAN_LOWER_BOUND = -0.2
export const SPEARMAN_UPPER_BOUND = 0.9
/** "a top-10 overlap above 9 of 10" — expressed as the fraction 9/10 so it applies regardless of the exact denominator an aggregate figure carries. Ticket #159: also applied to top-20 now (Defect 3) — same fraction, same meaning, just checked in more places. */
export const TOP10_OVERLAP_UPPER_BOUND_FRACTION = 0.9

/**
 * Ticket #159, Defect 2. A top-N figure is refused ("too small to read"),
 * not printed, when the N actually used (after topNOverlap's own population
 * cap) exceeds this fraction of the population it was drawn from — see
 * topNIsMeaningful. A JUDGEMENT threshold, not derived from anything about
 * FPL scoring, and deliberately a DIFFERENT number from
 * TOP10_OVERLAP_UPPER_BOUND_FRACTION above so the two are never confused:
 * that one asks "is the overlap suspiciously GOOD" (a leak-shaped RESULT);
 * this one asks "is N close enough to the population that ANY overlap would
 * be uninteresting, regardless of its value" (a meaningless QUESTION). At
 * 0.75, a top-10-of-19 request (10/19 ≈ 52.6%) is still reported; a
 * top-20-of-19 request (19/19 = 100%) — the exact shape LEARNINGS §14
 * found — is refused.
 */
export const TOP_N_MAX_POPULATION_FRACTION = 0.75

/**
 * Ticket #159, Defect 1, naive baseline 3 ("constant ranking"). The single
 * raw value every row is assigned for the zero-skill-floor baseline — see
 * computeConstantBaselineSpearman. Its exact numeric value is arbitrary
 * (every row gets the SAME one, so spearmanCorrelation's rank computation
 * cannot see it at all); kept as a named constant rather than an inline
 * literal so it reads as a deliberate choice, not a stray number.
 */
export const CONSTANT_BASELINE_VALUE = 0

export const PRIOR_MINUTES_PER_MATCH_BASELINE_LABEL = 'Prior minutes per match'
export const PRIOR_XG_XA_PER_MATCH_BASELINE_LABEL = 'Prior xG+xA per match'
export const CONSTANT_BASELINE_LABEL = 'Constant (zero-skill floor)'

/** A clean sheet requires 60+ minutes, same gate pointValues.ts's appearance-points split uses. */
const CLEAN_SHEET_QUALIFYING_MINUTES = 60

/**
 * Ticket #140. A bucket (prior_matches range, or the multi-fixture
 * diagnostic) with fewer than this many measured rows is reported as "too
 * small to read" rather than as a figure — same threshold and same rule
 * `src/lib/accuracy/derive.ts`'s `MIN_SAMPLE_SIZE` uses for the in-app
 * rolling accuracy display (ticket #123). Defined locally rather than
 * imported: this file's own documented convention is small, self-contained
 * constants with a comment naming the ticket, not a cross-import into the
 * display layer for one shared number.
 */
export const MIN_BUCKET_SAMPLE_SIZE = 50

/**
 * The `prior_matches` buckets the defcon and overall signed-error
 * diagnostics report by, ticket text verbatim. A measured row always has
 * `priorMatches >= 1` (rows with `prior_matches <= 0` are excluded as
 * `noPriorMatches` before ever reaching the measured population), so these
 * four buckets partition every measured row exactly once.
 */
export const PRIOR_MATCHES_BUCKETS: readonly { label: string; min: number; max: number }[] = [
  { label: '1–4', min: 1, max: 4 },
  { label: '5–9', min: 5, max: 9 },
  { label: '10–19', min: 10, max: 19 },
  { label: '20+', min: 20, max: Infinity },
]

/**
 * The multi-fixture-headline sanity threshold from the ticket text
 * verbatim: "if excluding [multi-fixture player-gameweeks] moves the season
 * headline by more than 0.05, say so prominently." Applied to mean absolute
 * error, the report's own headline figure.
 */
export const MULTI_FIXTURE_HEADLINE_THRESHOLD = 0.05

const POSITIONS: readonly Position[] = [GOALKEEPER, DEFENDER, MIDFIELDER, FORWARD]
const POSITION_NAMES: Readonly<Record<Position, string>> = {
  1: 'Goalkeeper',
  2: 'Defender',
  3: 'Midfielder',
  4: 'Forward',
}

// ============================================================================
// Env — identical contract to every other scripts/*.ts job.
// ============================================================================

interface SupabaseEnv {
  url: string
  secretKey: string
}

function readSupabaseEnv(): SupabaseEnv | null {
  const url = process.env.SUPABASE_URL
  const secretKey = process.env.SUPABASE_SECRET_KEY
  const missing: string[] = []
  if (!url) missing.push('SUPABASE_URL')
  if (!secretKey) missing.push('SUPABASE_SECRET_KEY')

  if (missing.length > 0) {
    console.error(
      `${JOB_NAME}: required environment variables are not set. ` +
        'Both SUPABASE_URL and SUPABASE_SECRET_KEY must be set ' +
        `(missing: ${missing.join(', ')}). Making no network call.`,
    )
    return null
  }

  return { url: url as string, secretKey: secretKey as string }
}

function readSeason(): string {
  return (process.env.BACKTEST_SEASON ?? '').trim() || DEFAULT_SEASON
}

function readReportPath(): string {
  return process.env.BACKTEST_REPORT_PATH ?? DEFAULT_REPORT_PATH
}

// ============================================================================
// Errors
// ============================================================================

export class BacktestError extends Error {
  context: string
  constructor(message: string, context: string) {
    super(message)
    this.name = 'BacktestError'
    this.context = context
  }
}

export class BacktestSanityError extends Error {
  failures: string[]
  constructor(failures: string[]) {
    super(`sanity bounds failed: ${failures.join('; ')}`)
    this.name = 'BacktestSanityError'
    this.failures = failures
  }
}

interface PostgrestLikeError {
  code?: string
  message?: string
}

function isMissingTable(error: PostgrestLikeError, tableName: string): boolean {
  if (error.code === 'PGRST205' || error.code === '42P01') return true
  const message = error.message ?? ''
  return new RegExp(tableName).test(message) && /schema cache|does not exist|relation.*does not exist/i.test(message)
}

// Same pattern as build-feature-history.ts's own guard: a missing
// team_goals_conceded column (the #125 migration not yet applied) fails
// loudly with a message naming the gap, rather than silently defaulting
// every clean-sheet reconstruction to "conceded nothing".
function isMissingColumn(error: PostgrestLikeError, columnName: string): boolean {
  if (error.code === '42703') return true
  const message = error.message ?? ''
  return new RegExp(columnName).test(message) && /does not exist/i.test(message)
}

// ============================================================================
// job_runs
// ============================================================================

type JsonRecord = Record<string, unknown>

interface JobRunInput {
  status: 'success' | 'failure' | 'skipped'
  message: string
  details: JsonRecord | null
  startedAt: Date
}

async function recordJobRun(supabase: SupabaseClient, input: JobRunInput): Promise<void> {
  const finishedAt = new Date()
  const { error } = await supabase.from('job_runs').insert({
    job_name: JOB_NAME,
    status: input.status,
    message: input.message,
    details: input.details,
    started_at: input.startedAt.toISOString(),
    finished_at: finishedAt.toISOString(),
  })
  if (error) {
    if (isMissingTable(error, 'job_runs')) {
      console.error(`${JOB_NAME}: table "job_runs" does not exist. Apply its migration before running this script.`)
    }
    throw new Error(`failed to record job_runs row: ${error.message}`)
  }
}

// ============================================================================
// Pure computation — projection side. No I/O below this point in either
// section; every case is testable on constructed rows with no live database.
// ============================================================================

/** The prior_* fields this job reads off feature_history — only what it needs. */
export interface FeatureHistoryPriorFields {
  prior_matches: number
  prior_minutes: number
  prior_xg: number
  prior_xa: number
  prior_saves: number
  prior_clearances: number
  prior_blocks: number
  prior_interceptions: number
  prior_tackles: number
  prior_recoveries: number
  /**
   * Ticket #146/#154. Count of this player's Premier League matches strictly
   * before gameweek_id, this season, with 60+ minutes played — the same
   * qualifying rule defconRate.ts's isQualifyingMatch() applies. NULL means
   * never computed (a row written before the #146 migration); 0 is a real
   * measurement. See the migration's own column comment.
   */
  prior_defcon_qualifying_matches: number | null
  /**
   * Ticket #146/#154. Of prior_defcon_qualifying_matches, how many reached
   * the player's position threshold — determined per match via
   * src/lib/scoring/defensiveContribution.ts, never reimplemented here. NULL
   * means never computed; 0 is a real measurement.
   */
  prior_defcon_hits: number | null
  /**
   * Ticket #181/#185/#187. This player's minutes played in his most recent
   * Premier League matches with a resolvable player_code — the SAME
   * contributing-row set `prior_matches` and every other `prior_*` total are
   * built from — STRICTLY BEFORE `gameweek_id`, MOST RECENT FIRST, capped at
   * `minutes.ts`'s `RECENT_MATCH_COUNT` (5). NOT filtered by any
   * minutes-played threshold — cameo appearances count, matching
   * `estimateMinutes()`'s own window exactly (never the unrelated
   * 60-minute `isQualifyingMatch()` rule `prior_defcon_qualifying_matches`
   * uses). NULL means this row predates the #185 migration or was never
   * rebuilt after it landed — a genuine "not yet computed" gap, distinct
   * from a real empty array (a player with `prior_matches = 0`, e.g. his
   * first ingested gameweek). Ticket #185 stored this column; this is the
   * first ticket to read it — see `buildRecentMinutes` below, and
   * `supabase/migrations/20260902090000_feature_history_recent_minutes.sql`
   * for the full definition (not restated here beyond what that function
   * needs).
   */
  prior_recent_minutes: number[] | null
}

export interface FeatureHistoryRow extends FeatureHistoryPriorFields {
  gameweek_id: number
  player_code: number
  /**
   * Ticket #146/#154. The FPL position code as it was in THIS ingested
   * season, copied from that season's own players.csv — never from the live
   * `players` table, which holds only the current season's players and
   * silently drops anyone who has since left the league (23% of this job's
   * population — see file header). NULL means this row predates the #146
   * migration or the position could not be resolved that season; the
   * `players`-table fallback map applies only then — see resolveRowPosition.
   */
  element_type: number | null
  /**
   * Ticket #167/#175. The FPL stable club code (matching `public.teams.code`)
   * of the player's OWN club for this season, copied through from
   * `player_match_stats.team_code` at ingest time — never from the live
   * `public.players`/`public.teams` tables. NULL means this row predates the
   * #167 migration or the player's team_code could not be resolved at
   * ingest time (see that migration's own column comment) — a row with a
   * null team_code is excluded from the fixture-aware measured population
   * as `unresolvedFixtureTeams`, never guessed. 100% populated for
   * 2025-2026 as of ticket #175 (18,588 of 18,588 rows).
   */
  team_code: number | null
}

/** Exact, non-approximated mapping — rates.ts's shrinkage formula is generic in the underlying count. */
export function buildPlayerRateHistory(row: FeatureHistoryPriorFields): PlayerRateHistory {
  return {
    minutesPlayed: row.prior_minutes,
    totalXg: row.prior_xg,
    totalXa: row.prior_xa,
    totalSaves: row.prior_saves,
    totalCbi: row.prior_clearances + row.prior_blocks + row.prior_interceptions,
    totalRecoveries: row.prior_recoveries,
  }
}

/** Same mapping, shaped for positionPriorRates() — one entry per player, summed exactly like buildPlayerRateHistory's own totals. */
export function buildRateHistoryMatch(row: FeatureHistoryPriorFields): RateHistoryMatch {
  return {
    minutesPlayed: row.prior_minutes,
    xg: row.prior_xg,
    xa: row.prior_xa,
    saves: row.prior_saves,
    cbi: row.prior_clearances + row.prior_blocks + row.prior_interceptions,
    recoveries: row.prior_recoveries,
  }
}

/** A player's average minutes per prior match — 0 with no prior matches (never divides by zero). */
export function averageMinutesPerMatch(row: Pick<FeatureHistoryPriorFields, 'prior_matches' | 'prior_minutes'>): number {
  return row.prior_matches > 0 ? row.prior_minutes / row.prior_matches : 0
}

/**
 * Ticket #159, naive baseline 1: prior minutes per prior match. Every row
 * that reaches the measured population already has prior_matches > 0 (rows
 * with prior_matches <= 0 are excluded as `noPriorMatches` before ever
 * reaching classifyRow's `measured` outcome) — this ASSERTS that invariant
 * (throws if violated) rather than defaulting defensively to 0, so a future
 * change that admits a zero-prior-matches row into the measured population
 * fails loudly here instead of silently producing a wrong or hidden number.
 * Unlike averageMinutesPerMatch above, which IS called on excluded rows too
 * (via computePositionPriors, for the position-prior computation, not the
 * baseline) and must default safely to 0.
 */
export function computeBaselineMinutesPerMatch(row: Pick<FeatureHistoryPriorFields, 'prior_matches' | 'prior_minutes'>): number {
  if (row.prior_matches <= 0) {
    throw new BacktestError(
      'computeBaselineMinutesPerMatch called on a row with prior_matches <= 0 — the measured population should never contain one (see classifyRow)',
      'baseline',
    )
  }
  return row.prior_minutes / row.prior_matches
}

/** Ticket #159, naive baseline 2: prior xG + prior xA, per prior match. Same assertion as computeBaselineMinutesPerMatch — see its comment. */
export function computeBaselineXgXaPerMatch(row: Pick<FeatureHistoryPriorFields, 'prior_matches' | 'prior_xg' | 'prior_xa'>): number {
  if (row.prior_matches <= 0) {
    throw new BacktestError(
      'computeBaselineXgXaPerMatch called on a row with prior_matches <= 0 — the measured population should never contain one (see classifyRow)',
      'baseline',
    )
  }
  return (row.prior_xg + row.prior_xa) / row.prior_matches
}

/**
 * Ticket #187. True when a feature_history row carries the #185 stored
 * last-five-match minutes window — distinguishes "zero prior matches, a
 * real empty array" ([], see the migration's own column comment) from
 * "never computed" (null — a row predating the #185 migration or never
 * rebuilt after it landed). Mirrors `hasDefconCounters`'s own null-check
 * shape exactly: an explicit empty array is a real value, only null/
 * undefined means "not yet computed".
 */
export function hasStoredRecentMinutesWindow(row: Pick<FeatureHistoryPriorFields, 'prior_recent_minutes'>): boolean {
  return row.prior_recent_minutes !== null && row.prior_recent_minutes !== undefined
}

/** Ticket #187. Which construction `buildRecentMinutes` used for one row — surfaced so main() can count and report both, mirroring `DefconMatchSource`/`classifyDefconSource` exactly. */
export type RecentMinutesSource = 'storedWindow' | 'averagedFallback'

/** Ticket #187. Pure classifier mirroring `buildRecentMinutes`'s own branch — the branch main() counts is the exact same branch buildRecentMinutes takes, never a second guess at it. */
export function classifyRecentMinutesSource(row: Pick<FeatureHistoryPriorFields, 'prior_recent_minutes'>): RecentMinutesSource {
  return hasStoredRecentMinutesWindow(row) ? 'storedWindow' : 'averagedFallback'
}

/** Ticket #187. A strict 2-way partition of every `feature_history` row read (mirrors `DefconSourceCounts` exactly) — how many rows fed `estimateMinutes()` the true #185 stored window vs the pre-#185 single-averaged-match fallback. */
export interface RecentMinutesSourceCounts {
  fromStoredWindow: number
  fromAveragedFallback: number
}

export function emptyRecentMinutesSourceCounts(): RecentMinutesSourceCounts {
  return { fromStoredWindow: 0, fromAveragedFallback: 0 }
}

/** Mutates counts in place from one row's `classifyRecentMinutesSource` result. */
export function incrementRecentMinutesSource(counts: RecentMinutesSourceCounts, source: RecentMinutesSource): void {
  if (source === 'storedWindow') counts.fromStoredWindow++
  else counts.fromAveragedFallback++
}

/**
 * Ticket #187. Histogram of `buildRecentMinutes(row).length` across every
 * `feature_history` row read — 0–5 for a row on the stored #185 window
 * (min(prior_matches, 5) by that column's own construction), 0–1 for a row
 * on the pre-#185 averaged-match fallback. Keyed by length rather than a
 * fixed-size array/tuple so this file never has to import `RECENT_MATCH_COUNT`
 * from `minutes.ts` just to size a bucket list — any length that actually
 * occurs gets its own entry.
 */
export type RecentMinutesWindowLengthDistribution = Record<number, number>

export function emptyRecentMinutesWindowLengthDistribution(): RecentMinutesWindowLengthDistribution {
  return {}
}

export function incrementRecentMinutesWindowLength(distribution: RecentMinutesWindowLengthDistribution, length: number): void {
  distribution[length] = (distribution[length] ?? 0) + 1
}

/**
 * Ticket #187 — the fix. Prefers the #185 stored last-five-match window
 * (`prior_recent_minutes`), returned EXACTLY as stored: most-recent-first,
 * unmodified — never sorted, reversed, or averaged. Falls back to the
 * pre-#187 single-averaged-match approximation this file's header
 * documented ("feeds minutes.ts's estimateMinutes() one 'typical match'")
 * only when the column is null (a row predating the #185 migration or never
 * rebuilt after it landed — see `hasStoredRecentMinutesWindow`), counted via
 * `classifyRecentMinutesSource`/`RecentMinutesSourceCounts` in main() so the
 * fallback's prevalence is visible in the report, never silent. A defensive
 * copy (`[...]`) is returned for the stored-window path so a caller can
 * never mutate `row.prior_recent_minutes` itself through this function's
 * result.
 */
export function buildRecentMinutes(
  row: Pick<FeatureHistoryPriorFields, 'prior_matches' | 'prior_minutes' | 'prior_recent_minutes'>,
): number[] {
  if (hasStoredRecentMinutesWindow(row)) {
    return [...(row.prior_recent_minutes as number[])]
  }
  return row.prior_matches > 0 ? [averageMinutesPerMatch(row)] : []
}

/**
 * Ticket #154. True when a feature_history row carries the #146 defensive-
 * contribution counters — distinguishes "zero qualifying matches, actually
 * measured" (0, a real value) from "never computed" (null — a row written
 * before the #146 migration). Both fields are populated together by
 * build-feature-history.ts, so checking one would do, but checking both
 * documents the pairing rather than assuming it.
 */
export function hasDefconCounters(
  row: Pick<FeatureHistoryPriorFields, 'prior_defcon_qualifying_matches' | 'prior_defcon_hits'>,
): boolean {
  return row.prior_defcon_qualifying_matches !== null && row.prior_defcon_qualifying_matches !== undefined &&
    row.prior_defcon_hits !== null && row.prior_defcon_hits !== undefined
}

/** Ticket #154. Which construction `buildDefconMatches` used for one row — surfaced so main() can count and report both, rather than only being able to infer it after the fact. */
export type DefconMatchSource = 'storedCounters' | 'averagedFallback'

/** Ticket #154. Pure classifier mirroring `buildDefconMatches`'s own branch — kept as its own exported function so the branch main() counts is the exact same branch buildDefconMatches takes, never a second guess at it. */
export function classifyDefconSource(
  row: Pick<FeatureHistoryPriorFields, 'prior_defcon_qualifying_matches' | 'prior_defcon_hits'>,
): DefconMatchSource {
  return hasDefconCounters(row) ? 'storedCounters' : 'averagedFallback'
}

/**
 * Ticket #154. Minutes for every synthetic match `buildDefconMatchesFromCounts`
 * builds — comfortably over defconRate.ts's own 60-minute qualifying gate, so
 * every synthetic match this function builds is counted as qualifying by
 * `isQualifyingMatch`, matching the real per-match rule it is standing in for.
 */
const SYNTHETIC_DEFCON_MATCH_MINUTES = 90

/**
 * Ticket #154. A defensive-actions count no real position's threshold can
 * reach (defender: 10 CBIT; midfielder/forward: 12 CBIRT — see
 * src/lib/scoring/defensiveContribution.ts) — used only to guarantee a
 * synthetic "hit" match clears whichever threshold applies, never compared
 * against a threshold value directly. This file still never holds the
 * threshold number itself; it only needs two counts unambiguously on either
 * side of it, for every position.
 */
const GUARANTEED_HIT_DEFENSIVE_ACTIONS = 999

function syntheticHitMatch(): DefensiveContributionMatch {
  return {
    minutesPlayed: SYNTHETIC_DEFCON_MATCH_MINUTES,
    clearances: GUARANTEED_HIT_DEFENSIVE_ACTIONS,
    blocks: 0,
    interceptions: 0,
    tackles: 0,
    recoveries: 0,
  }
}

function syntheticMissMatch(): DefensiveContributionMatch {
  return { minutesPlayed: SYNTHETIC_DEFCON_MATCH_MINUTES, clearances: 0, blocks: 0, interceptions: 0, tackles: 0, recoveries: 0 }
}

/**
 * Ticket #154. Builds exactly `qualifyingMatches` synthetic matches — `hits`
 * of them constructed to unambiguously reach ANY position's defensive-
 * contribution threshold, the remaining `qualifyingMatches - hits`
 * constructed to unambiguously miss it. Every one of them is 90 minutes, so
 * all `qualifyingMatches` of them pass defconRate.ts's own `isQualifyingMatch`
 * gate unmodified. Fed through `estimateDefconHitRate` (also unmodified) this
 * reproduces EXACTLY `(hits + SHRINKAGE_K * positionPrior) / (qualifyingMatches
 * + SHRINKAGE_K)` — the real per-match threshold check is never
 * reimplemented here, only two extremes safely on either side of it.
 *
 * `hits` is clamped to `[0, qualifyingMatches]` and both inputs are floored
 * at 0 — defensive against a corrupt row, never expected from a real
 * feature_history read (prior_defcon_hits <= prior_defcon_qualifying_matches
 * by construction, see the #146 migration).
 */
export function buildDefconMatchesFromCounts(qualifyingMatches: number, hits: number): DefensiveContributionMatch[] {
  const n = Math.max(0, Math.trunc(qualifyingMatches))
  const h = Math.min(n, Math.max(0, Math.trunc(hits)))
  return [...Array.from({ length: h }, syntheticHitMatch), ...Array.from({ length: n - h }, syntheticMissMatch)]
}

/**
 * For defconRate.ts's estimateDefconHitRate() — the player's real per-match
 * qualifying-match count and hit count (ticket #146/#154) when
 * `feature_history` carries them, reproduced exactly via
 * `buildDefconMatchesFromCounts`. Falls back to the single-averaged-match
 * approximation (average clearances/blocks/interceptions/tackles/recoveries
 * per prior match, checked once) only for a row written before the #146
 * migration — see `hasDefconCounters`. Empty for a player with no prior
 * matches and no stored counters.
 *
 * The fallback path is the pre-#154 defect this ticket fixes: it feeds
 * estimateDefconHitRate exactly 0 or 1 matches regardless of how much real
 * history the row carries, so at defconRate.ts's own shrinkage strength (see
 * that file's SHRINKAGE_K) a player's own evidence could never carry more
 * than 1/6 of the estimate's weight. Kept, not deleted, because it is still
 * the only option for a pre-migration row — see this file's tests for both
 * paths and the named test proving the old path was the defect.
 */
export function buildDefconMatches(row: FeatureHistoryPriorFields): DefensiveContributionMatch[] {
  if (hasDefconCounters(row)) {
    return buildDefconMatchesFromCounts(row.prior_defcon_qualifying_matches as number, row.prior_defcon_hits as number)
  }
  if (row.prior_matches <= 0) return []
  const n = row.prior_matches
  return [
    {
      minutesPlayed: averageMinutesPerMatch(row),
      clearances: row.prior_clearances / n,
      blocks: row.prior_blocks / n,
      interceptions: row.prior_interceptions / n,
      tackles: row.prior_tackles / n,
      recoveries: row.prior_recoveries / n,
    },
  ]
}

export interface PositionPrior {
  rate: PlayerRates
  defconHitRate: number
}

function positionPriorKey(gameweekId: number, position: Position): string {
  return `${gameweekId}:${position}`
}

/**
 * Position priors, one per (gameweek, position), built ONLY from that same
 * gameweek's feature_history rows (every player's prior_* totals — already
 * strictly-before that gameweek by feature_history's own construction, so
 * the prior itself carries no lookahead). A row with prior_matches = 0
 * contributes nothing (its totals are all zero, so positionPriorRates'/
 * positionPriorHitRate's own empty-input handling applies unchanged) — see
 * this file's tests for the case that matters: a gameweek/position pair
 * where every contributing player is excluded still resolves to a defined,
 * non-throwing prior via those functions' own neutral defaults.
 */
export function computePositionPriors(
  rows: readonly FeatureHistoryRow[],
  positionOf: (playerCode: number) => Position | undefined,
): Map<string, PositionPrior> {
  const rateMatchesByKey = new Map<string, RateHistoryMatch[]>()
  const defconMatchesByKey = new Map<string, DefensiveContributionMatch[]>()
  const positionsByKey = new Map<string, Position>()

  for (const row of rows) {
    if (row.prior_matches <= 0) continue
    const position = positionOf(row.player_code)
    if (position === undefined) continue
    const key = positionPriorKey(row.gameweek_id, position)
    positionsByKey.set(key, position)

    const rateList = rateMatchesByKey.get(key) ?? []
    rateList.push(buildRateHistoryMatch(row))
    rateMatchesByKey.set(key, rateList)

    const defconList = defconMatchesByKey.get(key) ?? []
    defconList.push(...buildDefconMatches(row))
    defconMatchesByKey.set(key, defconList)
  }

  const result = new Map<string, PositionPrior>()
  for (const [key, position] of positionsByKey) {
    result.set(key, {
      rate: positionPriorRates(rateMatchesByKey.get(key) ?? []),
      defconHitRate: positionPriorHitRate(position, defconMatchesByKey.get(key) ?? []),
    })
  }
  return result
}

/** Fallback prior for a (gameweek, position) key with no contributing rows — should not occur for a row with prior_matches > 0 (it would have contributed to its own key), kept as a defensive, non-throwing default rather than an assumption the map is always populated. */
export function fallbackPositionPrior(position: Position): PositionPrior {
  return { rate: positionPriorRates([]), defconHitRate: positionPriorHitRate(position, []) }
}

// ============================================================================
// Position resolution — ticket #154. feature_history.element_type is the
// primary source (populated at ingest time from THAT season's own
// players.csv — never drops a player who has since left the league); the
// live `players` table is a fallback for a row written before the #146
// migration, never the primary source. See file header, "Defect 1".
// ============================================================================

/** Which of the two sources actually resolved one row's position — surfaced so main() can count all three outcomes for the report, not just apply them. */
export type PositionResolutionSource = 'elementType' | 'playersFallback' | 'unresolved'

export interface PositionResolution {
  position: Position | undefined
  source: PositionResolutionSource
}

/**
 * One row's position: `feature_history.element_type` when non-null (cast the
 * same way `players.element_type` already is at the one existing call site —
 * no second mapping invented), the `players`-table fallback map when null,
 * `undefined` (source 'unresolved') only when neither resolves. Named test
 * covers all three paths.
 */
export function resolveRowPosition(
  row: Pick<FeatureHistoryRow, 'player_code' | 'element_type'>,
  codeToPosition: ReadonlyMap<number, Position>,
): PositionResolution {
  if (row.element_type !== null && row.element_type !== undefined) {
    return { position: row.element_type as Position, source: 'elementType' }
  }
  const fallback = codeToPosition.get(row.player_code)
  if (fallback !== undefined) return { position: fallback, source: 'playersFallback' }
  return { position: undefined, source: 'unresolved' }
}

/** Neutral fixture — see file header. At fplDifficulty 3, every fixture.ts multiplier this produces is exactly 1.0. */
function buildNeutralFixtureContext(gameweekId: number): FixtureContext {
  return {
    fixtureId: gameweekId,
    isHome: true,
    teamElo: null,
    opponentElo: null,
    fplDifficulty: NEUTRAL_FIXTURE_DIFFICULTY,
    leagueBaselineGoals: LEAGUE_BASELINE_GOALS_PER_TEAM,
  }
}

// ============================================================================
// FIXTURE-AWARE EXPECTED SCORE — ticket #175. Pure, no I/O below this point:
// every function takes already-fetched rows/records, never reads Supabase
// itself. Replaces the neutral fplDifficulty=3 fixture (expectedScore
// exactly 0.5, every multiplier exactly 1.0) every measured row used before
// this ticket with a point-in-time team-strength comparison, built ONLY
// from player_match_stats rows strictly before the row being projected.
// ============================================================================

/**
 * Ticket #175. A team's point-in-time strength needs at least this many
 * PRIOR matches (strictly before the row's own gameweek) on EACH side of a
 * fixture before expectedScore is computed from a real comparison — below
 * this, both teams fall back to NEUTRAL_EXPECTED_SCORE_VALUE (0.5), the same
 * "average fixture" every row used before this ticket. A single early match
 * is too noisy to base a fixture adjustment on (one red card or one own
 * goal swings a one-match average wildly). 3 is a JUDGEMENT call (ticket
 * text: "state the minimum as a judgement in the code comment"), not a
 * derived value — high enough to smooth a one-match outlier, low enough
 * that most of the season gets a real fixture signal rather than sitting at
 * the neutral fallback (every team has played its 3rd match by gameweek 4,
 * assuming no early postponement).
 */
export const MIN_TEAM_PRIOR_MATCHES = 3

/**
 * Ticket #175. The expectedScore value used whenever a fixture cannot be
 * given a real point-in-time strength comparison. Matches fixture.ts's own
 * "0.5 = a coin flip / an average fixture" convention exactly — the same
 * value DIFFICULTY_EXPECTED_SCORE[3] and an even elo matchup both resolve
 * to — never a different number invented for this fallback.
 */
export const NEUTRAL_EXPECTED_SCORE_VALUE = 0.5

/**
 * Ticket #175. The one free parameter in the point-in-time strength ->
 * expectedScore construction below (see computeFixtureExpectedScore):
 * `expectedScore = clamp(0.5 + (ownRate - opponentRate) / SCALE, 0, 1)`.
 *
 * CALIBRATED, NOT CHOSEN (ticket text) — set so the spread of the
 * expectedScore values this construction produces over the 2025-2026
 * measured population matches the spread of the elo-derived expectedScore
 * already stored in `player_projections.components` on live data:
 * `SCALE = stdDev(ownRate - opponentRate, over every resolvable fixture) /
 * stdDev(live elo-derived expectedScore)`.
 *
 * THE TWO OBSERVED DISTRIBUTIONS.
 *
 * Target (live elo-derived expectedScore, `player_projections.components`,
 * rows where `eloFallbackUsed` is false — i.e. a real elo comparison, never
 * the coarser 5-value FDR fallback): n = 3,181, mean = 0.5003,
 * population stdDev = 0.1701, min = 0.1238, max = 0.8762. Obtained by
 * Keshav running a hand, read-only query directly against Supabase — NOT an
 * in-run read from this job. This job has no Supabase access at all and
 * never will (confirmed); the DoD's original phrasing asking for "an in-run
 * read" was a specification error, not something to keep retrying via
 * credentials.
 *
 * This construction's own delta (`ownRate - opponentRate`), 2025-2026,
 * Premier League only, over every resolvable fixture with sufficient prior
 * history on both sides (MIN_TEAM_PRIOR_MATCHES): n = 698 (349 matches x 2
 * perspectives, mean exactly 0 by construction — every match contributes
 * +delta and -delta), population stdDev = 0.9564. Computed by reconstructing
 * player_match_stats from FPL-Core-Insights' own public per-gameweek CSVs
 * (no Supabase needed for this side — confirmed reachable) via a throwaway
 * script that reused this file's own buildTeamMatchRecords/
 * computeTeamStrengthAsOf/teamStrengthRate/fixtureHasSufficientHistory and
 * scripts/ingest-core-insights.ts's own buildClubCodeBySlug/
 * buildTeamCodeMap/toMatchStatRow UNMODIFIED, never re-derived — the
 * reconstruction's own row counts matched the ticket's stated population
 * exactly before this number was trusted (15,340 of 15,340 total rows;
 * 12,754 Premier League rows; 12,613 of 12,754 = 98.9% opponent_team_code
 * resolved). The script was run via `npx tsx`, never committed.
 *
 * SCALE = 0.9564 / 0.1701 = 5.6225.
 */
export const SCALE = 5.6225

/**
 * One `player_match_stats` row's fields needed to build the point-in-time
 * team-strength table — team_code (which club these particular stats
 * belong to), opponent_team_code (the club faced, so a team's opponent in
 * one match can be found without re-parsing match_id), and
 * team_goals_conceded (per-player-on-pitch, not a team total — see this
 * file's header on why the MAX across a team's players in one match is the
 * correct team figure, never the average or the first row found).
 */
export interface MatchStatsForTeamStrength {
  matchId: string
  gameweek: number
  teamCode: number | null
  opponentTeamCode: number | null
  teamGoalsConceded: number | null
}

/** One resolvable (team, match) outcome: this team's own goals conceded (the max across its players who appeared) and goals scored (the SAME match's opponent's own max-conceded figure — "the opponent's conceded figure for that same match", ticket text verbatim). */
export interface TeamMatchRecord {
  matchId: string
  gameweek: number
  teamCode: number
  goalsConceded: number
  goalsScored: number
}

interface TeamMatchAccumulator {
  matchId: string
  gameweek: number
  teamCode: number
  opponentTeamCode: number | null
  goalsConceded: number | null
}

/** Ignores a null side rather than treating it as 0 — a team's goals-conceded figure is "not yet seen a non-null row" until it genuinely has one, and 0 (a clean sheet) must never be indistinguishable from "unknown". */
function maxIgnoringNull(a: number | null, b: number | null): number | null {
  if (a === null) return b
  if (b === null) return a
  return Math.max(a, b)
}

/**
 * One row per (matchId, teamCode) actually resolvable to BOTH a real
 * goals-conceded figure (max across that team's own players' rows) AND a
 * real goals-scored figure (the SAME match's opponent's own max-conceded
 * figure, found via opponent_team_code — never by re-parsing match_id) — a
 * match where either side is missing contributes NOTHING to the
 * point-in-time strength table (never a guessed 0), so a team's `matches`
 * count below reflects only genuinely known outcomes. Built once per run
 * over the SAME `player_match_stats` rows already fetched for actuals — no
 * extra Supabase call. Named tests: a normal match, a match with a player
 * substituted before a late goal, and a 0-0 (proving 0 is preserved, never
 * treated as "unknown" and skipped).
 */
export function buildTeamMatchRecords(rows: readonly MatchStatsForTeamStrength[]): TeamMatchRecord[] {
  const byKey = new Map<string, TeamMatchAccumulator>()
  const keyOf = (matchId: string, teamCode: number): string => `${matchId}::${teamCode}`

  for (const row of rows) {
    if (row.teamCode === null) continue
    const key = keyOf(row.matchId, row.teamCode)
    const existing = byKey.get(key)
    byKey.set(key, {
      matchId: row.matchId,
      gameweek: row.gameweek,
      teamCode: row.teamCode,
      opponentTeamCode: existing?.opponentTeamCode ?? row.opponentTeamCode,
      goalsConceded: maxIgnoringNull(existing?.goalsConceded ?? null, row.teamGoalsConceded),
    })
  }

  const records: TeamMatchRecord[] = []
  for (const acc of byKey.values()) {
    if (acc.goalsConceded === null || acc.opponentTeamCode === null) continue
    const opponentAcc = byKey.get(keyOf(acc.matchId, acc.opponentTeamCode))
    if (opponentAcc === undefined || opponentAcc.goalsConceded === null) continue
    records.push({
      matchId: acc.matchId,
      gameweek: acc.gameweek,
      teamCode: acc.teamCode,
      goalsConceded: acc.goalsConceded,
      goalsScored: opponentAcc.goalsConceded,
    })
  }
  return records
}

function clubScheduleKey(teamCode: number, gameweek: number): string {
  return `${teamCode}:${gameweek}`
}

/**
 * Ticket #193 — the second, larger lookahead leak in the same construction
 * G13 partially fixed. A window leg's fixture COUNT and OPPONENT(s) used to
 * come from `actualRows` — the player's OWN `player_match_stats` rows for
 * that gameweek — which silently told the model, in advance, exactly which
 * of the five weeks the player would fail to feature in (a non-featuring
 * leg had zero actual rows, so `matchesFound` was 0 and the leg projected 0
 * fixtures against an actual of 0: a free, foreknown pass). The number of
 * fixtures a club plays in a gameweek, and who it plays, are PUBLISHED
 * before the horizon starts — legitimately known at G. Whether any one
 * player features in them is not.
 *
 * This builds that published schedule from the SAME `player_match_stats`
 * rows already fetched for actuals — no extra Supabase call — keyed by
 * (team_code, gameweek), one entry per distinct `match_id` (so a double
 * gameweek returns two opponent codes). Deliberately NOT filtered on
 * goals-resolvability, unlike `buildTeamMatchRecords` above: a match that
 * happened is a match that was scheduled, whether or not both sides'
 * goals-conceded figures happen to be readable afterward — goals are never
 * read here at all.
 *
 * APPROXIMATION, STATED NOT HIDDEN (mirrors G10's own team-slug caveat):
 * this schedule is reconstructed from matches that were actually PLAYED, so
 * a fixture postponed after the horizon began looks identical to a club
 * that never had one — this job has no independent fixture-schedule table
 * for a past season (see G10). Both read as `blankGameweek` in the report
 * below. Not a defect to fix here.
 *
 * Named tests: a single fixture; a double gameweek (two match_ids, one
 * gameweek, one club) returning two opponents; a match whose
 * `team_goals_conceded` is null on both sides still appearing (goals are
 * never inspected — the whole point of not reusing `buildTeamMatchRecords`);
 * a club with no rows in a gameweek returning nothing.
 */
export function buildClubFixtureSchedule(rows: readonly MatchStatsForTeamStrength[]): Map<string, (number | null)[]> {
  const seenMatchTeam = new Set<string>() // dedupe by (matchId, teamCode) — many player rows share one match/team
  const byGroup = new Map<string, (number | null)[]>()

  for (const row of rows) {
    if (row.teamCode === null) continue
    const dedupeKey = `${row.matchId}::${row.teamCode}`
    if (seenMatchTeam.has(dedupeKey)) continue
    seenMatchTeam.add(dedupeKey)

    const key = clubScheduleKey(row.teamCode, row.gameweek)
    const existing = byGroup.get(key)
    if (existing === undefined) byGroup.set(key, [row.opponentTeamCode])
    else existing.push(row.opponentTeamCode)
  }

  return byGroup
}

/** Looks up one club's scheduled opponent(s) for one gameweek — `[]` (never `undefined`) for a club with no schedule entry that gameweek, the blank-gameweek case. The single place `clubScheduleKey`'s exact string format matters, so callers (and tests) never need to know it. */
export function lookupClubFixtureSchedule(schedule: ReadonlyMap<string, readonly (number | null)[]>, teamCode: number, gameweek: number): readonly (number | null)[] {
  return schedule.get(clubScheduleKey(teamCode, gameweek)) ?? []
}

/** A team's summed prior record as of one point in time — see computeTeamStrengthAsOf. */
export interface TeamStrengthRecord {
  matches: number
  goalsScored: number
  goalsConceded: number
}

/**
 * Sums every one of `teamCode`'s resolvable match records with gameweek
 * STRICTLY BEFORE `beforeGameweek` — THE LOOKAHEAD GUARD (ticket text: "the
 * most important test in the ticket"). A gameweek-N row must never see a
 * gameweek-N or later record; `r.gameweek < beforeGameweek`, never `<=`,
 * is the entire guard.
 */
export function computeTeamStrengthAsOf(records: readonly TeamMatchRecord[], teamCode: number, beforeGameweek: number): TeamStrengthRecord {
  const prior = records.filter((r) => r.teamCode === teamCode && r.gameweek < beforeGameweek)
  return {
    matches: prior.length,
    goalsScored: prior.reduce((sum, r) => sum + r.goalsScored, 0),
    goalsConceded: prior.reduce((sum, r) => sum + r.goalsConceded, 0),
  }
}

/** (goalsScored - goalsConceded) per prior match — 0 with no prior matches (never divides by zero; MIN_TEAM_PRIOR_MATCHES in computeFixtureExpectedScore is what actually decides whether this value is trusted). */
export function teamStrengthRate(record: TeamStrengthRecord): number {
  return record.matches > 0 ? (record.goalsScored - record.goalsConceded) / record.matches : 0
}

/** Whether computeFixtureExpectedScore would use a REAL point-in-time comparison for this pair (both teams meet MIN_TEAM_PRIOR_MATCHES) rather than the neutral fallback — the SAME gate that function applies internally, exposed separately only for the report's fixture-coverage counters (never a second, divergent rule). */
export function fixtureHasSufficientHistory(own: TeamStrengthRecord, opponent: TeamStrengthRecord): boolean {
  return own.matches >= MIN_TEAM_PRIOR_MATCHES && opponent.matches >= MIN_TEAM_PRIOR_MATCHES
}

function clampUnit(value: number): number {
  if (value < 0) return 0
  if (value > 1) return 1
  return value
}

/**
 * Ticket #175. The point-in-time analogue of fixture.ts's elo-derived
 * expectedScore, built from each team's (goalsScored - goalsConceded) per
 * prior match (see file header, "THE CONSTRUCTION"). Falls back to
 * NEUTRAL_EXPECTED_SCORE_VALUE when either team has fewer than
 * MIN_TEAM_PRIOR_MATCHES resolvable prior matches — never a guessed
 * adjustment from thin evidence. Named tests: exactly 0.5 for two teams
 * with identical prior records (the delta cancels to 0 regardless of
 * SCALE); clamped to [0, 1] for a lopsided delta; the neutral fallback
 * below the minimum.
 */
export function computeFixtureExpectedScore(own: TeamStrengthRecord, opponent: TeamStrengthRecord, scale: number): number {
  if (!fixtureHasSufficientHistory(own, opponent)) return NEUTRAL_EXPECTED_SCORE_VALUE
  const delta = teamStrengthRate(own) - teamStrengthRate(opponent)
  return clampUnit(0.5 + delta / scale)
}

/**
 * Ticket #175. Whether a row's own club (`feature_history.team_code`) AND
 * every one of its matched `player_match_stats` rows' opponent_team_code
 * resolve — the DoD's "a row with an unresolvable own or opponent club" gate.
 * Pure, over the SAME actual rows classifyRow/aggregateActualForGameweek
 * already read for this (player, gameweek). An empty opponent list (no
 * matched actual rows at all) is never resolved — there is nothing to build
 * a fixture from — though in practice this function is only consulted for a
 * row that has already passed the `featured` gate, which guarantees at
 * least one matched row.
 */
export function resolveFixtureTeams(ownTeamCode: number | null, opponentTeamCodes: readonly (number | null)[]): boolean {
  if (ownTeamCode === null) return false
  if (opponentTeamCodes.length === 0) return false
  return opponentTeamCodes.every((code) => code !== null)
}

/**
 * Inverts fixture.ts's own `expectedScore(eloFor, eloAgainst, isHome)` elo
 * logistic exactly, so a FixtureContext built with `{ teamElo:
 * eloForExpectedScore(s), opponentElo: 0, isHome: false }` reproduces `s`
 * bit-for-bit through expectedPoints.ts's own, unmodified combiner —
 * verified at s=0.5 (see this file's own tests): it reproduces the EXACT
 * expectedScore the pre-#175 neutral fplDifficulty=3 fallback always did.
 * This file never reimplements attackingMultiplier/expectedGoalsConceded/
 * defensiveMultiplier — it constructs a fixture IDENTITY (an elo pair
 * engineered to reproduce a point-in-time expectedScore), then hands it to
 * expectedPoints.ts's own math, unchanged.
 *
 * Derivation. With opponentElo pinned at 0 and isHome at false (so
 * homeAdjustment = -HOME_ADVANTAGE_ELO):
 *   expectedScore(eloFor, 0, false) = 1 / (1 + 10^((HOME_ADVANTAGE_ELO - eloFor) / 400))
 * Solving for the eloFor that makes this equal `s`:
 *   eloFor = HOME_ADVANTAGE_ELO + 400 * log10(s / (1 - s))
 * Correct at the s=0/s=1 boundaries too: Math.log10(0) = -Infinity and
 * Math.log10(Infinity) = Infinity propagate through IEEE-754 arithmetic to
 * give expectedScore exactly 0 or exactly 1 — never NaN.
 */
export function eloForExpectedScore(targetExpectedScore: number): number {
  return HOME_ADVANTAGE_ELO + 400 * Math.log10(targetExpectedScore / (1 - targetExpectedScore))
}

/** A FixtureContext engineered to reproduce `expectedScoreValue` exactly through expectedPoints.ts's own elo combiner — see eloForExpectedScore's own comment for the derivation and why isHome/opponentElo are fixed anchors, not signal. */
function buildFixtureContextFromExpectedScore(expectedScoreValue: number, gameweekId: number): FixtureContext {
  return {
    fixtureId: gameweekId,
    isHome: false,
    teamElo: eloForExpectedScore(expectedScoreValue),
    opponentElo: 0,
    fplDifficulty: NEUTRAL_FIXTURE_DIFFICULTY, // irrelevant here — both elo fields are non-null, so expectedPoints.ts never falls back to it.
    leagueBaselineGoals: LEAGUE_BASELINE_GOALS_PER_TEAM,
  }
}

/** Tallies how many measured rows used a real, computed fixture vs the neutral fallback (ticket #175 report line) — see fixtureHasSufficientHistory for the gate. */
export interface FixtureCoverageCounts {
  realFixture: number
  neutralFallback: number
}

export function emptyFixtureCoverageCounts(): FixtureCoverageCounts {
  return { realFixture: 0, neutralFallback: 0 }
}

/** Mutates counts in place — real when every one of a row's fixtures used a real point-in-time comparison, neutralFallback if ANY of them fell back (conservative: a mixed double-gameweek row is not counted as fully "real"). */
export function incrementFixtureCoverage(counts: FixtureCoverageCounts, real: boolean): void {
  if (real) counts.realFixture++
  else counts.neutralFallback++
}

/**
 * Projects one feature_history row via src/lib/projection/expectedPoints.ts's
 * own combiner, imported and never reimplemented. Every input is built ONLY
 * from this row's prior_* totals (rate history, recent-minutes/defcon
 * approximations) and a position prior computed from the SAME gameweek's
 * data (computePositionPriors) — nothing here reads any later gameweek.
 *
 * `fixtureCount` (ticket #140) — how many fixtures the player's team held
 * this gameweek, defaulting to 1 so every existing call site (and every
 * pre-#140 test) is an EXACT no-op: one neutral fixture context, identical
 * to this function's behaviour before this ticket. For fixtureCount > 1,
 * the SAME neutral context (see buildNeutralFixtureContext's own header —
 * expectedScore is exactly 0.5, the neutral value) is repeated and summed
 * by projectPlayerGameweek, unmodified — never reimplemented here. A
 * negative or fractional count is truncated at 0, defensively; main() never
 * passes one (fixtureCount is always a real row count from the actual
 * side).
 *
 * `fixtureExpectedScores` (ticket #175) — one point-in-time expectedScore
 * per fixture, by index; defaults to `[]` so every pre-#175 call site
 * (every existing test included) is an EXACT no-op: an index with no entry
 * (the whole array, by default) falls back to buildNeutralFixtureContext,
 * bit-for-bit identical to this function's behaviour before this ticket —
 * never reimplemented, never a "close enough" approximation (verified: a
 * defined expectedScore of exactly 0.5 reproduces the SAME projection as
 * the neutral fallback, see this file's own tests).
 */
export function projectRow(
  row: FeatureHistoryRow,
  position: Position,
  prior: PositionPrior,
  fixtureCount = 1,
  fixtureExpectedScores: readonly number[] = [],
): GameweekProjection {
  const input: PlayerProjectionInput = {
    position,
    status: ASSUMED_AVAILABILITY_STATUS,
    chanceOfPlayingNextRound: null,
    recentMinutes: buildRecentMinutes(row),
    rateHistory: buildPlayerRateHistory(row),
    ratePositionPrior: prior.rate,
    defconMatches: buildDefconMatches(row),
    defconPositionPrior: prior.defconHitRate,
  }
  const count = Math.max(0, Math.trunc(fixtureCount))
  const fixtures: FixtureContext[] = Array.from({ length: count }, (_, i) => {
    const expectedScoreValue = fixtureExpectedScores[i]
    return expectedScoreValue === undefined
      ? buildNeutralFixtureContext(row.gameweek_id)
      : buildFixtureContextFromExpectedScore(expectedScoreValue, row.gameweek_id)
  })
  return projectPlayerGameweek(input, fixtures)
}

/** The 7 point components this job compares — bonus is deliberately absent (see file header); projectPlayerFixture's own bonusPoints is always exactly 0. */
export interface ComponentTotals {
  appearancePoints: number
  goalPoints: number
  assistPoints: number
  cleanSheetPoints: number
  goalsConcededPoints: number
  savePoints: number
  defensiveContributionPoints: number
}

export function emptyComponentTotals(): ComponentTotals {
  return {
    appearancePoints: 0,
    goalPoints: 0,
    assistPoints: 0,
    cleanSheetPoints: 0,
    goalsConcededPoints: 0,
    savePoints: 0,
    defensiveContributionPoints: 0,
  }
}

function addComponentTotals(a: ComponentTotals, b: ComponentTotals): ComponentTotals {
  return {
    appearancePoints: a.appearancePoints + b.appearancePoints,
    goalPoints: a.goalPoints + b.goalPoints,
    assistPoints: a.assistPoints + b.assistPoints,
    cleanSheetPoints: a.cleanSheetPoints + b.cleanSheetPoints,
    goalsConcededPoints: a.goalsConcededPoints + b.goalsConcededPoints,
    savePoints: a.savePoints + b.savePoints,
    defensiveContributionPoints: a.defensiveContributionPoints + b.defensiveContributionPoints,
  }
}

export function sumComponentTotals(list: readonly ComponentTotals[]): ComponentTotals {
  return list.reduce(addComponentTotals, emptyComponentTotals())
}

/** Picks the 7 comparable components out of expectedPoints.ts's own component shape, dropping bonusPoints (always 0 — see file header). */
export function pickProjectedComponents(components: FixtureProjectionComponents): ComponentTotals {
  return {
    appearancePoints: components.appearancePoints,
    goalPoints: components.goalPoints,
    assistPoints: components.assistPoints,
    cleanSheetPoints: components.cleanSheetPoints,
    goalsConcededPoints: components.goalsConcededPoints,
    savePoints: components.savePoints,
    defensiveContributionPoints: components.defensiveContributionPoints,
  }
}

// ============================================================================
// Pure computation — actual side. Reconstructs one match's real FPL points
// from src/lib/scoring/'s own functions, never reimplemented. Mirrors
// scripts/calibration-report.ts's reconstructActualMatchPoints in shape, with
// one deliberate difference: goals conceded/clean sheet are read from
// team_goals_conceded (the team-level figure), never the per-player
// goals_conceded column — see file header.
// ============================================================================

export interface ActualMatchStatsInput {
  minutesPlayed: number | null
  goals: number | null
  assists: number | null
  teamGoalsConceded: number | null
  saves: number | null
  clearances: number | null
  blocks: number | null
  interceptions: number | null
  tackles: number | null
  recoveries: number | null
}

export interface ReconstructedMatch {
  minutes: number
  totalPoints: number
  components: ComponentTotals
}

export function reconstructActualMatchPoints(position: Position, stats: ActualMatchStatsInput): ReconstructedMatch {
  const minutes = stats.minutesPlayed ?? 0
  const goals = stats.goals ?? 0
  const assists = stats.assists ?? 0
  const teamGoalsConceded = stats.teamGoalsConceded ?? 0
  const saves = stats.saves ?? 0

  const defconStats: DefensiveActionStats = {
    clearances: stats.clearances ?? 0,
    blocks: stats.blocks ?? 0,
    interceptions: stats.interceptions ?? 0,
    tackles: stats.tackles ?? 0,
    recoveries: stats.recoveries ?? 0,
  }

  const appearancePoints = minutes === 0 ? 0 : minutes < 60 ? APPEARANCE_POINTS_UNDER_60 : APPEARANCE_POINTS_60_PLUS
  const isCleanSheet = minutes >= CLEAN_SHEET_QUALIFYING_MINUTES && teamGoalsConceded === 0

  const components: ComponentTotals = {
    appearancePoints,
    goalPoints: goals * goalPoints(position),
    assistPoints: assists * ASSIST_POINTS,
    cleanSheetPoints: isCleanSheet ? cleanSheetPoints(position) : 0,
    goalsConcededPoints: goalsConcededPointsApply(position)
      ? Math.floor(teamGoalsConceded / GOALS_CONCEDED_DIVISOR) * GOALS_CONCEDED_POINTS_PER_UNIT
      : 0,
    savePoints: savePointsApply(position) ? goalkeeperSavePoints(saves) : 0,
    defensiveContributionPoints: defensiveContributionPoints(position, defconStats),
  }

  const fullComponents: MatchPointComponents = {
    ...components,
    penaltySavePoints: 0,
    penaltyMissPoints: 0,
    yellowCardPoints: 0,
    redCardPoints: 0,
    ownGoalPoints: 0,
    // Bonus deliberately excluded from both sides — see file header. Never
    // set to anything but 0 here.
    bonusPoints: 0,
  }

  return { minutes, totalPoints: totalMatchPoints(fullComponents), components }
}

export interface ActualGameweekOutcome {
  /** True if any matching row has minutes_played > 0 — the "did the player feature" gate. */
  featured: boolean
  /** False if any matching row is missing team_goals_conceded — the "actual data incomplete" gate. Vacuously true for zero rows. */
  teamGoalsConcededKnown: boolean
  totalPoints: number
  components: ComponentTotals
  minutes: number
  matchesFound: number
}

/**
 * Aggregates every player_match_stats row found for one (player, gameweek)
 * into one outcome. Each row is reconstructed independently and SUMMED
 * (never averaged or merged first) — the correct behaviour for a genuine
 * double gameweek, where FPL scores each match separately. Zero rows is the
 * "no data found at all" case: featured = false, an empty ComponentTotals,
 * teamGoalsConcededKnown = true (vacuous — nothing to be missing).
 */
export function aggregateActualForGameweek(position: Position, rows: readonly ActualMatchStatsInput[]): ActualGameweekOutcome {
  const featured = rows.some((r) => (r.minutesPlayed ?? 0) > 0)
  const teamGoalsConcededKnown = rows.every((r) => r.teamGoalsConceded !== null && r.teamGoalsConceded !== undefined)
  const reconstructed = rows.map((r) => reconstructActualMatchPoints(position, r))
  return {
    featured,
    teamGoalsConcededKnown,
    totalPoints: reconstructed.reduce((sum, r) => sum + r.totalPoints, 0),
    components: sumComponentTotals(reconstructed.map((r) => r.components)),
    minutes: reconstructed.reduce((sum, r) => sum + r.minutes, 0),
    matchesFound: rows.length,
  }
}

/** The six named exclusion reasons — see classifyRow. `blankGameweek` added by ticket #140; `unresolvedFixtureTeams` added by ticket #175. */
export type ExclusionReason =
  | 'noPriorMatches'
  | 'didNotFeature'
  | 'actualDataIncomplete'
  | 'unresolvedPlayerCode'
  | 'blankGameweek'
  | 'unresolvedFixtureTeams'

export type RowClassification =
  | { kind: 'excluded'; reason: ExclusionReason }
  | { kind: 'measured'; position: Position; outcome: ActualGameweekOutcome }

/**
 * Classifies one feature_history row into the measured population or exactly
 * one named exclusion reason — the single source of truth main() and this
 * file's tests both use, so the exclusion rule proven by test is the exact
 * rule the job runs. See this file's header, "THE MEASURED POPULATION".
 *
 * `hadFixture` (ticket #140) defaults to `true` so every existing 3-arg call
 * site — every pre-#140 test included — is an EXACT no-op: unfeatured stays
 * `didNotFeature`, unchanged. Only when the caller can positively determine
 * the player's team had no fixture this gameweek (see file header, "BLANK
 * GAMEWEEKS") does `hadFixture = false` redirect an unfeatured row to the
 * new `blankGameweek` reason instead.
 *
 * `fixtureTeamsResolved` (ticket #175) defaults to `true` so every pre-#175
 * call site — every existing 3-arg and 4-arg test included — is an EXACT
 * no-op. Checked LAST, after every other gate: a row whose own or opponent
 * club could not be resolved (see resolveFixtureTeams) is excluded as
 * `unresolvedFixtureTeams` only once it has already cleared every other
 * reason a row is excluded — this is deliberately the LAST reason checked,
 * not the first, so a row that would already be excluded for some other
 * reason keeps that reason (matching this function's existing precedence:
 * each check runs only once every earlier one has passed).
 */
export function classifyRow(
  row: FeatureHistoryRow,
  position: Position | undefined,
  actualRows: readonly ActualMatchStatsInput[],
  hadFixture = true,
  fixtureTeamsResolved = true,
): RowClassification {
  if (position === undefined) return { kind: 'excluded', reason: 'unresolvedPlayerCode' }
  if (row.prior_matches <= 0) return { kind: 'excluded', reason: 'noPriorMatches' }

  const outcome = aggregateActualForGameweek(position, actualRows)
  if (!outcome.featured) return { kind: 'excluded', reason: hadFixture ? 'didNotFeature' : 'blankGameweek' }
  if (!outcome.teamGoalsConcededKnown) return { kind: 'excluded', reason: 'actualDataIncomplete' }
  if (!fixtureTeamsResolved) return { kind: 'excluded', reason: 'unresolvedFixtureTeams' }

  return { kind: 'measured', position, outcome }
}

// ============================================================================
// Pure computation — error, aggregation, sanity bounds, reconciliation.
// ============================================================================

export interface MeasuredRow {
  gameweekId: number
  position: Position
  projectedPoints: number
  actualPoints: number
  /** projected - actual. Positive = the model over-projected; negative = under-projected. */
  signedError: number
  absError: number
  projectedComponents: ComponentTotals
  actualComponents: ComponentTotals
  actualMinutes: number
  /**
   * Ticket #140. How many fixtures this player's team held this gameweek —
   * taken directly from the actual side's own `matchesFound` (the count of
   * `player_match_stats` rows found for this player, this gameweek), the
   * same count `projectRow` was given to build the matching number of
   * projected fixtures. 1 for the ordinary case; >1 identifies a
   * multi-fixture player-gameweek for the diagnostic below.
   */
  fixtureCount: number
  /** Ticket #140. `feature_history.prior_matches` at classification time — the bucketing key for the defcon and overall signed-error diagnostics. */
  priorMatches: number
  /** Ticket #159, naive baseline 1 — see computeBaselineMinutesPerMatch. */
  baselineMinutesPerMatch: number
  /** Ticket #159, naive baseline 2 — see computeBaselineXgXaPerMatch. */
  baselineXgXaPerMatch: number
}

export function buildMeasuredRow(
  gameweekId: number,
  position: Position,
  projectedPoints: number,
  projectedComponents: ComponentTotals,
  actual: ActualGameweekOutcome,
  priorMatches = 0,
  baselineMinutesPerMatch = 0,
  baselineXgXaPerMatch = 0,
): MeasuredRow {
  const signedError = projectedPoints - actual.totalPoints
  return {
    gameweekId,
    position,
    projectedPoints,
    actualPoints: actual.totalPoints,
    signedError,
    absError: Math.abs(signedError),
    projectedComponents,
    actualComponents: actual.components,
    actualMinutes: actual.minutes,
    fixtureCount: actual.matchesFound,
    priorMatches,
    baselineMinutesPerMatch,
    baselineXgXaPerMatch,
  }
}

export interface ErrorSummary {
  n: number
  meanAbsoluteError: number | null
  meanSignedError: number | null
}

export function summarizeErrors(rows: readonly MeasuredRow[]): ErrorSummary {
  const n = rows.length
  if (n === 0) return { n: 0, meanAbsoluteError: null, meanSignedError: null }
  return {
    n,
    meanAbsoluteError: rows.reduce((sum, r) => sum + r.absError, 0) / n,
    meanSignedError: rows.reduce((sum, r) => sum + r.signedError, 0) / n,
  }
}

export function summarizeByPosition(rows: readonly MeasuredRow[]): Record<Position, ErrorSummary> {
  const result = {} as Record<Position, ErrorSummary>
  for (const position of POSITIONS) {
    result[position] = summarizeErrors(rows.filter((r) => r.position === position))
  }
  return result
}

export function summarizeByGameweek(rows: readonly MeasuredRow[]): Map<number, ErrorSummary> {
  const gameweekIds = [...new Set(rows.map((r) => r.gameweekId))].sort((a, b) => a - b)
  const result = new Map<number, ErrorSummary>()
  for (const gameweekId of gameweekIds) {
    result.set(
      gameweekId,
      summarizeErrors(rows.filter((r) => r.gameweekId === gameweekId)),
    )
  }
  return result
}

/**
 * States the mean signed error in words — the most important sentence in the
 * report, per the ticket ("this sign is easy to invert and impossible to
 * spot once rendered"). signedError = projected - actual throughout this
 * file, so a POSITIVE mean means the model projects MORE than what actually
 * happened (over-projecting); NEGATIVE means it projects less
 * (under-projecting).
 */
export function describeSignedError(meanSignedError: number | null): string {
  if (meanSignedError === null) return 'no measured rows to describe'
  if (meanSignedError > 0) {
    return `the model is OVER-projecting by ${meanSignedError.toFixed(3)} points per player-gameweek on average`
  }
  if (meanSignedError < 0) {
    return `the model is UNDER-projecting by ${Math.abs(meanSignedError).toFixed(3)} points per player-gameweek on average`
  }
  return 'the model is exactly calibrated on average (mean signed error is precisely 0)'
}

/** Fraction of qualifying (60+ actual minutes) rows, by position, whose ACTUAL reconstruction registered a clean sheet. Null with no qualifying rows for that position — "no data", not "0%". */
export function derivedCleanSheetRate(rows: readonly MeasuredRow[], position: Position): number | null {
  const qualifying = rows.filter((r) => r.position === position && r.actualMinutes >= CLEAN_SHEET_QUALIFYING_MINUTES)
  if (qualifying.length === 0) return null
  const hits = qualifying.filter((r) => r.actualComponents.cleanSheetPoints > 0).length
  return hits / qualifying.length
}

export interface SanityCheckResult {
  ok: boolean
  failures: string[]
}

/**
 * The report FAILS, naming the figure, rather than printing a number nobody
 * checked (ticket text). Outside these bounds means the HARNESS is wrong,
 * not the model.
 */
export function checkSanityBounds(overallMae: number | null, cleanSheetRateByPosition: Partial<Record<Position, number | null>>): SanityCheckResult {
  const failures: string[] = []

  if (overallMae !== null && (overallMae < MAE_LOWER_BOUND || overallMae > MAE_UPPER_BOUND)) {
    failures.push(
      `overall mean absolute error ${overallMae.toFixed(3)} is outside the sane bound [${MAE_LOWER_BOUND}, ${MAE_UPPER_BOUND}] points per player-gameweek`,
    )
  }

  for (const position of POSITIONS) {
    const rate = cleanSheetRateByPosition[position]
    if (rate !== null && rate !== undefined && rate > CLEAN_SHEET_RATE_UPPER_BOUND) {
      failures.push(
        `${POSITION_NAMES[position]} derived clean-sheet rate ${(rate * 100).toFixed(1)}% exceeds the sane bound ${(CLEAN_SHEET_RATE_UPPER_BOUND * 100).toFixed(0)}%`,
      )
    }
  }

  return { ok: failures.length === 0, failures }
}

/** The six named exclusion reasons — a strict partition of every feature_history row read, alongside measuredCount. See assertReconciles. `blankGameweek` added by ticket #140; `unresolvedFixtureTeams` added by ticket #175. */
export interface ExclusionCounts {
  noPriorMatches: number
  didNotFeature: number
  actualDataIncomplete: number
  unresolvedPlayerCode: number
  blankGameweek: number
  unresolvedFixtureTeams: number
}

export function emptyExclusionCounts(): ExclusionCounts {
  return { noPriorMatches: 0, didNotFeature: 0, actualDataIncomplete: 0, unresolvedPlayerCode: 0, blankGameweek: 0, unresolvedFixtureTeams: 0 }
}

/** Mutates counts in place, incrementing the named reason by 1 — the one place a classifyRow exclusion reason is turned into a count. */
export function incrementExclusion(counts: ExclusionCounts, reason: ExclusionReason): void {
  counts[reason]++
}

export function totalExcluded(counts: ExclusionCounts): number {
  return (
    counts.noPriorMatches +
    counts.didNotFeature +
    counts.actualDataIncomplete +
    counts.unresolvedPlayerCode +
    counts.blankGameweek +
    counts.unresolvedFixtureTeams
  )
}

/** rows read = rows measured + rows excluded, by reason, exactly — throws naming both sides on any mismatch. */
export function assertReconciles(rowsRead: number, measuredCount: number, counts: ExclusionCounts): void {
  const excluded = totalExcluded(counts)
  const total = measuredCount + excluded
  if (total !== rowsRead) {
    throw new BacktestError(
      `reconciliation failed: ${rowsRead} feature_history row(s) read, but measured (${measuredCount}) + excluded (${excluded}) = ${total}. ` +
        `Exclusion breakdown: ${JSON.stringify(counts)}.`,
      'reconciliation',
    )
  }
}

/**
 * Ticket #154. How every `feature_history` row read resolved its position —
 * a strict 3-way partition (`fromElementType + fromPlayersFallback +
 * unresolved === rows read`), reported alongside the existing exclusion
 * counts. `unresolved` is the same population `exclusions.unresolvedPlayerCode`
 * counts (a row that resolves to neither is always excluded that way) —
 * kept as its own counter rather than reused so the population section can
 * show the position-resolution breakdown as one self-contained group.
 */
export interface PositionResolutionCounts {
  fromElementType: number
  fromPlayersFallback: number
  unresolved: number
}

export function emptyPositionResolutionCounts(): PositionResolutionCounts {
  return { fromElementType: 0, fromPlayersFallback: 0, unresolved: 0 }
}

/** Mutates counts in place from one row's `resolveRowPosition` result. */
export function incrementPositionResolution(counts: PositionResolutionCounts, source: PositionResolutionSource): void {
  if (source === 'elementType') counts.fromElementType++
  else if (source === 'playersFallback') counts.fromPlayersFallback++
  else counts.unresolved++
}

/**
 * Ticket #154. How every `feature_history` row read built its defensive-
 * contribution match evidence — a strict 2-way partition
 * (`fromStoredCounters + fromAveragedFallback === rows read`), reported
 * alongside the position-resolution counters above. Counted over every row
 * read (not only the measured population): `buildDefconMatches` is also
 * called for excluded rows via `computePositionPriors`, so this reports the
 * whole population's defcon-evidence quality, not just the headline's.
 */
export interface DefconSourceCounts {
  fromStoredCounters: number
  fromAveragedFallback: number
}

export function emptyDefconSourceCounts(): DefconSourceCounts {
  return { fromStoredCounters: 0, fromAveragedFallback: 0 }
}

/** Mutates counts in place from one row's `classifyDefconSource` result. */
export function incrementDefconSource(counts: DefconSourceCounts, source: DefconMatchSource): void {
  if (source === 'storedCounters') counts.fromStoredCounters++
  else counts.fromAveragedFallback++
}

// ============================================================================
// Team-slug inference — ticket #140, blank-gameweek detection. Pure text
// parsing over match_id, no I/O. See file header, "BLANK GAMEWEEKS".
// ============================================================================

/** Every match_id this job reads is already filtered to competition = prem at the query level (see main()). */
const MATCH_ID_PREM_PREFIX_RE = /^\d{2}-\d{2}-prem-/

/**
 * Splits a Premier League match_id into its two team slugs, e.g.
 * "25-26-prem-manchester-united-vs-arsenal" -> ["manchester-united",
 * "arsenal"]. Returns null for anything that does not match the expected
 * "<season>-prem-<home>-vs-<away>" shape — never guesses.
 */
export function parseMatchIdTeamSlugs(matchId: string): readonly [string, string] | null {
  if (!MATCH_ID_PREM_PREFIX_RE.test(matchId)) return null
  const remainder = matchId.replace(MATCH_ID_PREM_PREFIX_RE, '')
  const parts = remainder.split('-vs-')
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') return null
  return [parts[0], parts[1]]
}

/**
 * Infers a player's team-for-the-season as the single team-slug appearing
 * MOST OFTEN across all of the match_ids passed in — a player's own team
 * appears in every one of his matches, while any one opponent appears at
 * most a handful of times (home leg, away leg, and rarely more via
 * rearranged fixtures), so the modal slug is the player's team. Returns
 * null with no parseable match_id at all. A player with exactly one
 * parseable match can tie between his own team and that match's single
 * opponent — this function returns whichever slug it encounters first in
 * that case, which is why callers (see buildTeamSlugsByGameweek's caller in
 * main()) treat an unresolved-or-unreliable team as hadFixture = true
 * (fail open to today's didNotFeature behaviour) rather than trusting a
 * single-match inference.
 */
export function inferTeamSlug(matchIds: readonly string[]): string | null {
  const counts = new Map<string, number>()
  for (const matchId of matchIds) {
    const pair = parseMatchIdTeamSlugs(matchId)
    if (pair === null) continue
    for (const slug of pair) counts.set(slug, (counts.get(slug) ?? 0) + 1)
  }
  let bestSlug: string | null = null
  let bestCount = 0
  for (const [slug, count] of counts) {
    if (count > bestCount) {
      bestSlug = slug
      bestCount = count
    }
  }
  return bestSlug
}

/**
 * The set of team-slugs that played at all in each gameweek, from every
 * match_id across every player — the "did this team have a fixture this
 * gameweek" lookup blankGameweek detection needs. Built once per run from
 * the SAME player_match_stats rows already fetched for actuals, so it costs
 * no extra Supabase round trip.
 */
export function buildTeamSlugsByGameweek(rows: readonly { gameweek: number; matchId: string }[]): Map<number, Set<string>> {
  const result = new Map<number, Set<string>>()
  for (const row of rows) {
    const pair = parseMatchIdTeamSlugs(row.matchId)
    if (pair === null) continue
    const set = result.get(row.gameweek) ?? new Set<string>()
    set.add(pair[0])
    set.add(pair[1])
    result.set(row.gameweek, set)
  }
  return result
}

// ============================================================================
// Diagnostics — ticket #140. Pure, over the already-built measured
// population, no I/O.
// ============================================================================

export interface BucketSummary {
  label: string
  n: number
  /** null when n < MIN_BUCKET_SAMPLE_SIZE — "too small to read", not a guessed figure. */
  meanSignedError: number | null
  tooSmallToRead: boolean
}

/**
 * Buckets measured rows by `priorMatches` into PRIOR_MATCHES_BUCKETS and
 * reports the mean of whatever signed-error quantity `valueOf` picks off
 * each row — used for both the defcon-only breakdown and the overall
 * signed-error breakdown (ticket text: "the same bucketing"), so the
 * bucketing logic itself is written once.
 */
export function bucketByPriorMatches(rows: readonly MeasuredRow[], valueOf: (row: MeasuredRow) => number): BucketSummary[] {
  return PRIOR_MATCHES_BUCKETS.map(({ label, min, max }) => {
    const bucketRows = rows.filter((r) => r.priorMatches >= min && r.priorMatches <= max)
    const n = bucketRows.length
    const tooSmallToRead = n < MIN_BUCKET_SAMPLE_SIZE
    const meanSignedError = tooSmallToRead ? null : bucketRows.reduce((sum, r) => sum + valueOf(r), 0) / n
    return { label, n, meanSignedError, tooSmallToRead }
  })
}

/** The defcon-only signed error for one measured row: projected defcon points minus actual defcon points. */
export function defconSignedError(row: MeasuredRow): number {
  return row.projectedComponents.defensiveContributionPoints - row.actualComponents.defensiveContributionPoints
}

export interface MultiFixtureDiagnostic {
  /** Player-gameweeks with fixtureCount > 1 — the population the diagnostic isolates. */
  multiFixtureCount: number
  /** The season headline (every measured row) — identical to ReportData.overall, repeated here so the "with"/"without" comparison is self-contained. */
  withMultiFixture: ErrorSummary
  /** The headline recomputed excluding multi-fixture player-gameweeks. */
  withoutMultiFixture: ErrorSummary
  /** withMultiFixture.MAE - withoutMultiFixture.MAE. Null if either side has no rows. */
  maeDelta: number | null
  /** Ticket text: "if excluding them moves the season headline by more than 0.05, say so prominently." */
  movesHeadlineSignificantly: boolean
}

export function buildMultiFixtureDiagnostic(rows: readonly MeasuredRow[]): MultiFixtureDiagnostic {
  const multiFixtureRows = rows.filter((r) => r.fixtureCount > 1)
  const withMultiFixture = summarizeErrors(rows)
  const withoutMultiFixture = summarizeErrors(rows.filter((r) => r.fixtureCount <= 1))
  const maeDelta =
    withMultiFixture.meanAbsoluteError !== null && withoutMultiFixture.meanAbsoluteError !== null
      ? withMultiFixture.meanAbsoluteError - withoutMultiFixture.meanAbsoluteError
      : null
  return {
    multiFixtureCount: multiFixtureRows.length,
    withMultiFixture,
    withoutMultiFixture,
    maeDelta,
    movesHeadlineSignificantly: maeDelta !== null && Math.abs(maeDelta) > MULTI_FIXTURE_HEADLINE_THRESHOLD,
  }
}

/** Count of measured rows with fixtureCount > 1, per gameweek — the fixture-count column the by-gameweek table carries (ticket text). */
export function countMultiFixtureRowsByGameweek(rows: readonly MeasuredRow[]): Map<number, number> {
  const result = new Map<number, number>()
  for (const row of rows) {
    if (row.fixtureCount <= 1) continue
    result.set(row.gameweekId, (result.get(row.gameweekId) ?? 0) + 1)
  }
  return result
}

/** "4,209 of 18,243 is 23%" — ticket text verbatim. Rounds to the nearest whole percentage point, and is 0% (never NaN) with zero rows read. */
export function formatExclusionPercentage(count: number, rowsRead: number): string {
  if (rowsRead <= 0) return '0%'
  return `${Math.round((count / rowsRead) * 100)}%`
}

// ============================================================================
// RANKING SKILL — ticket #147. Pure, over the already-built measured
// population (the SAME `MeasuredRow[]` #133/#140 build), no I/O. See file
// header, "RANKING SKILL".
// ============================================================================

/** The two comparable values one measured row contributes to a ranking — projected and actual points, paired by construction (one row IS one player-gameweek on both sides). */
export interface RankingPair {
  projected: number
  actual: number
}

export function toRankingPair(row: Pick<MeasuredRow, 'projectedPoints' | 'actualPoints'>): RankingPair {
  return { projected: row.projectedPoints, actual: row.actualPoints }
}

/**
 * 1-based ranks, descending (rank 1 = the highest value), with the STANDARD
 * average-rank tie correction: values tied for positions i..j (0-based, so
 * ranks i+1..j+1) all receive the mean of those ranks. This is the tie rule
 * Spearman's rho is defined against (ticket text: "average ranks is
 * standard") — ties are common here, not an edge case, since many rows
 * project identically at the position prior.
 */
export function rankDescending(values: readonly number[]): number[] {
  const n = values.length
  const order = values.map((_, i) => i).sort((a, b) => values[b] - values[a])
  const ranks = new Array<number>(n)
  let i = 0
  while (i < n) {
    let j = i
    while (j + 1 < n && values[order[j + 1]] === values[order[i]]) j++
    // Positions i..j (0-based) occupy ranks i+1..j+1 (1-based) — their average is the tied rank every one of them receives.
    const averageRank = (i + 1 + (j + 1)) / 2
    for (let k = i; k <= j; k++) ranks[order[k]] = averageRank
    i = j + 1
  }
  return ranks
}

/** Pearson correlation of two equal-length numeric sequences. Null (never NaN) when either side has zero variance — a correlation is undefined, not zero, when one side is constant. */
function pearsonCorrelation(a: readonly number[], b: readonly number[]): number | null {
  const n = a.length
  const meanA = a.reduce((sum, x) => sum + x, 0) / n
  const meanB = b.reduce((sum, x) => sum + x, 0) / n
  let covariance = 0
  let varianceA = 0
  let varianceB = 0
  for (let i = 0; i < n; i++) {
    const deviationA = a[i] - meanA
    const deviationB = b[i] - meanB
    covariance += deviationA * deviationB
    varianceA += deviationA * deviationA
    varianceB += deviationB * deviationB
  }
  if (varianceA === 0 || varianceB === 0) return null
  return covariance / Math.sqrt(varianceA * varianceB)
}

/**
 * Spearman rank correlation between projected and actual points, over
 * whatever set of pairs is passed in (a single gameweek, a position pooled
 * across the season, or the whole season) — implemented as the Pearson
 * correlation of the two rank sequences (rankDescending's average-rank tie
 * correction), which IS the tie-corrected Spearman's rho, not an
 * approximation of it. Null with fewer than 2 pairs, or when either side's
 * ranks carry no variance at all (every value tied) — undefined, not 0.
 */
export function spearmanCorrelation(pairs: readonly RankingPair[]): number | null {
  if (pairs.length < 2) return null
  const projectedRanks = rankDescending(pairs.map((p) => p.projected))
  const actualRanks = rankDescending(pairs.map((p) => p.actual))
  return pearsonCorrelation(projectedRanks, actualRanks)
}

/** One top-N overlap figure: how many of the N pairs selected by projected value are ALSO among the N pairs selected by actual value, and the N actually used (== min(requested N, population) — never claims a top-10 out of a population of 4). */
export interface TopNOverlap {
  overlap: number
  n: number
}

/**
 * Selects the top `topN` pairs by projected value and the top `topN` pairs
 * by actual value — from the SAME set of pairs, so "overlap" means the same
 * row ranks highly on both sides, no player identity needed — and counts how
 * many rows are in both sets. Selection uses a stable sort (Array.prototype.sort
 * is stable per the ES2019 spec, and Node's V8 engine implements it), so ties
 * at the selection boundary are broken by original row order — a DIFFERENT,
 * explicit tie rule from spearmanCorrelation's average-rank rule, because a
 * top-N selection must choose exactly N rows, not award a fractional slot to
 * every tied row (ticket text: "decide the tie rule explicitly").
 */
export function topNOverlap(pairs: readonly RankingPair[], topN: number): TopNOverlap {
  const n = Math.min(topN, pairs.length)
  if (n <= 0) return { overlap: 0, n: 0 }
  const indices = pairs.map((_, i) => i)
  const byProjected = [...indices].sort((a, b) => pairs[b].projected - pairs[a].projected).slice(0, n)
  const byActual = new Set([...indices].sort((a, b) => pairs[b].actual - pairs[a].actual).slice(0, n))
  const overlap = byProjected.filter((idx) => byActual.has(idx)).length
  return { overlap, n }
}

/**
 * Ticket #159, Defect 2. Whether one topNOverlap result is worth printing at
 * all: false when `result.n` (the N actually used, already capped at the
 * population by topNOverlap itself) is more than TOP_N_MAX_POPULATION_
 * FRACTION of `population` — the case a top-20 request over a ~19-person
 * weekly goalkeeper population produces (n capped to ~19, ~19/19 ≈ 100%),
 * where "overlap" is close to automatic (select nearly the whole
 * population, count how much of it overlaps with itself) rather than a real
 * ranking signal. `population <= 0` is always refused (nothing to rank).
 * Deliberately does NOT special-case `result.n === 0` as "meaningful" —
 * callers that want to distinguish "no data at all" from "refused" do so
 * themselves (see summarizeRankingByGameweekAndPosition), because this
 * function only knows the ratio, not why it is what it is.
 */
export function topNIsMeaningful(result: TopNOverlap, population: number): boolean {
  if (population <= 0) return false
  return result.n / population <= TOP_N_MAX_POPULATION_FRACTION
}

export interface GameweekRankingSummary {
  gameweekId: number
  n: number
  /** Ticket text: a gameweek under MIN_BUCKET_SAMPLE_SIZE is "too small to read", never a correlation — spearman/top10/top20 are all null when this is true. */
  tooSmallToRead: boolean
  spearman: number | null
  top10: TopNOverlap | null
  top20: TopNOverlap | null
}

/** Per-gameweek Spearman + top-10/20 overlap, gated by the same MIN_BUCKET_SAMPLE_SIZE #140's buckets already use. */
export function summarizeRankingByGameweek(rows: readonly MeasuredRow[]): Map<number, GameweekRankingSummary> {
  const gameweekIds = [...new Set(rows.map((r) => r.gameweekId))].sort((a, b) => a - b)
  const result = new Map<number, GameweekRankingSummary>()
  for (const gameweekId of gameweekIds) {
    const gameweekRows = rows.filter((r) => r.gameweekId === gameweekId)
    const n = gameweekRows.length
    const tooSmallToRead = n < MIN_BUCKET_SAMPLE_SIZE
    const pairs = gameweekRows.map(toRankingPair)
    result.set(gameweekId, {
      gameweekId,
      n,
      tooSmallToRead,
      spearman: tooSmallToRead ? null : spearmanCorrelation(pairs),
      top10: tooSmallToRead ? null : topNOverlap(pairs, 10),
      top20: tooSmallToRead ? null : topNOverlap(pairs, 20),
    })
  }
  return result
}

export interface SeasonRankingSummary {
  n: number
  /** Pooled across every measured row, regardless of gameweek — mirrors how `overall` pools every row for MAE. */
  spearman: number | null
  /** Sum of each non-too-small gameweek's overlap and N — a season overlap RATE, not a single top-10 selection over 8,000+ pooled rows (which "top 10 of the season" would not sensibly mean). */
  top10: TopNOverlap
  top20: TopNOverlap
}

export function summarizeSeasonRanking(rows: readonly MeasuredRow[], byGameweek: ReadonlyMap<number, GameweekRankingSummary>): SeasonRankingSummary {
  const spearman = spearmanCorrelation(rows.map(toRankingPair))
  let overlap10 = 0
  let n10 = 0
  let overlap20 = 0
  let n20 = 0
  for (const summary of byGameweek.values()) {
    if (summary.tooSmallToRead || summary.top10 === null || summary.top20 === null) continue
    overlap10 += summary.top10.overlap
    n10 += summary.top10.n
    overlap20 += summary.top20.overlap
    n20 += summary.top20.n
  }
  return { n: rows.length, spearman, top10: { overlap: overlap10, n: n10 }, top20: { overlap: overlap20, n: n20 } }
}

export interface PositionRankingSummary {
  position: Position
  n: number
  /** Pooled across the whole season for this position — mirrors summarizeByPosition's season-level MAE, not a per-gameweek figure. */
  spearman: number | null
  /**
   * Summed across every gameweek this position appears in — NOT gated by
   * MIN_BUCKET_SAMPLE_SIZE (unlike the by-gameweek table above). A
   * per-gameweek goalkeeper population is often under 50 by construction —
   * roughly one starting keeper per club, ~20 at most — so a 50-row gate
   * would silently zero out goalkeepers' top-N figures entirely rather than
   * reporting an honestly smaller sample size. topNOverlap already caps N at
   * the population size, so a thin gameweek just contributes a smaller N,
   * never a wrong one.
   *
   * Ticket #159, Defect 2: a gameweek whose capped N is a large fraction of
   * ITS OWN population (topNIsMeaningful) contributes NOTHING to this sum —
   * see top10Refused/top20Refused below for when that empties the figure
   * entirely.
   */
  top10: TopNOverlap
  top20: TopNOverlap
  /**
   * Ticket #159, Defect 2. True when this position had measured rows in at
   * least one gameweek, but EVERY one of those gameweeks' top-10 slices was
   * refused by topNIsMeaningful — so top10 above is {overlap: 0, n: 0} not
   * because there was no data, but because none of it was meaningful at
   * top-10 (the exact goalkeeper/top-20 shape LEARNINGS §14 found, extended
   * defensively to top-10 too). The report prints "too small to read" for
   * this case, distinct from "n/a" (no data at all).
   */
  top10Refused: boolean
  top20Refused: boolean
}

export function summarizeRankingByPosition(rows: readonly MeasuredRow[]): Record<Position, PositionRankingSummary> {
  const result = {} as Record<Position, PositionRankingSummary>
  for (const position of POSITIONS) {
    const positionRows = rows.filter((r) => r.position === position)
    const spearman = spearmanCorrelation(positionRows.map(toRankingPair))

    const gameweekIds = [...new Set(positionRows.map((r) => r.gameweekId))]
    let overlap10 = 0
    let n10 = 0
    let overlap20 = 0
    let n20 = 0
    for (const gameweekId of gameweekIds) {
      const pairs = positionRows.filter((r) => r.gameweekId === gameweekId).map(toRankingPair)
      const population = pairs.length
      const t10 = topNOverlap(pairs, 10)
      const t20 = topNOverlap(pairs, 20)
      // Ticket #159, Defect 2: a slice whose capped N is too large a
      // fraction of ITS OWN gameweek population contributes nothing to the
      // season-position sum — see topNIsMeaningful.
      if (topNIsMeaningful(t10, population)) {
        overlap10 += t10.overlap
        n10 += t10.n
      }
      if (topNIsMeaningful(t20, population)) {
        overlap20 += t20.overlap
        n20 += t20.n
      }
    }

    const hadAnyGameweekWithRows = gameweekIds.length > 0

    result[position] = {
      position,
      n: positionRows.length,
      spearman,
      top10: { overlap: overlap10, n: n10 },
      top20: { overlap: overlap20, n: n20 },
      top10Refused: hadAnyGameweekWithRows && n10 === 0,
      top20Refused: hadAnyGameweekWithRows && n20 === 0,
    }
  }
  return result
}

/**
 * Ticket #159, Defect 3. The finest grain this report prints: one summary
 * per (gameweek, position) pair that actually has measured rows for it —
 * the only place the unverified Defender/Midfielder identical-overlap
 * observation (see file header) is distinguishable on the next run, and
 * where Defect 2's near-100% goalkeeper top-20 shape is visible cell by
 * cell rather than only after being summed away in summarizeRankingByPosition
 * above. NOT gated by MIN_BUCKET_SAMPLE_SIZE, same reasoning as
 * summarizeRankingByPosition; IS gated by topNIsMeaningful per cell.
 */
export interface GameweekPositionRankingSummary {
  gameweekId: number
  position: Position
  n: number
  top10: TopNOverlap
  top20: TopNOverlap
  /** Ticket #159. True when n > 0 but topNIsMeaningful rejects this cell's top-10 — refused, not "no data" (n === 0 is never refused, see topNIsMeaningful's own comment on that distinction). */
  top10Refused: boolean
  top20Refused: boolean
}

export function summarizeRankingByGameweekAndPosition(rows: readonly MeasuredRow[]): GameweekPositionRankingSummary[] {
  const gameweekIds = [...new Set(rows.map((r) => r.gameweekId))].sort((a, b) => a - b)
  const result: GameweekPositionRankingSummary[] = []
  for (const gameweekId of gameweekIds) {
    for (const position of POSITIONS) {
      const pairs = rows.filter((r) => r.gameweekId === gameweekId && r.position === position).map(toRankingPair)
      const n = pairs.length
      const top10 = topNOverlap(pairs, 10)
      const top20 = topNOverlap(pairs, 20)
      result.push({
        gameweekId,
        position,
        n,
        top10,
        top20,
        top10Refused: n > 0 && !topNIsMeaningful(top10, n),
        top20Refused: n > 0 && !topNIsMeaningful(top20, n),
      })
    }
  }
  return result
}

export interface RankingSanityCheckResult {
  ok: boolean
  failures: string[]
}

/**
 * The report FAILS, naming the figure, rather than printing a number nobody
 * checked (ticket text) — mirrors checkSanityBounds' own shape exactly
 * (overall, then each position). Checked here: the season aggregate and each
 * position's Spearman correlation and top-10 AND top-20 overlap fraction.
 * The upper bound matters more than the lower one: a suspiciously good
 * correlation is the shape a lookahead leak takes.
 *
 * Ticket #159, Defect 3: `seasonTop20` (and each position's `.top20`) is a
 * new required check — LEARNINGS §14's 99.7% figure was a TOP-20, not a
 * top-10, and the original bound (ticket #147) only ever checked
 * `seasonTop10`/`.top10`, so that exact shape sailed through. Existing
 * callers must now pass a `seasonTop20` argument too — see this file's own
 * tests for the hand-verified updates.
 */
export function checkRankingSanityBounds(
  seasonSpearman: number | null,
  seasonTop10: TopNOverlap,
  seasonTop20: TopNOverlap,
  byPosition: Record<Position, PositionRankingSummary>,
): RankingSanityCheckResult {
  const failures: string[] = []

  const checkSpearman = (label: string, value: number | null): void => {
    if (value !== null && (value < SPEARMAN_LOWER_BOUND || value > SPEARMAN_UPPER_BOUND)) {
      failures.push(
        `${label} Spearman rank correlation ${value.toFixed(3)} is outside the sane bound [${SPEARMAN_LOWER_BOUND}, ${SPEARMAN_UPPER_BOUND}]`,
      )
    }
  }
  // Ticket #159: generalized from the #147 checkTop10 so the SAME bound
  // (TOP10_OVERLAP_UPPER_BOUND_FRACTION, still 9/10 regardless of whether N
  // was 10 or 20) applies to top-20 too — never a second, invented bound.
  const checkTopN = (label: string, topLabel: 'top-10' | 'top-20', topN: TopNOverlap): void => {
    if (topN.n > 0 && topN.overlap / topN.n > TOP10_OVERLAP_UPPER_BOUND_FRACTION) {
      failures.push(
        `${label} ${topLabel} overlap ${topN.overlap} of ${topN.n} (${((topN.overlap / topN.n) * 100).toFixed(1)}%) exceeds the sane bound of 9 of 10 (90%)`,
      )
    }
  }

  checkSpearman('season', seasonSpearman)
  checkTopN('season', 'top-10', seasonTop10)
  checkTopN('season', 'top-20', seasonTop20)
  for (const position of POSITIONS) {
    checkSpearman(POSITION_NAMES[position], byPosition[position].spearman)
    checkTopN(POSITION_NAMES[position], 'top-10', byPosition[position].top10)
    checkTopN(POSITION_NAMES[position], 'top-20', byPosition[position].top20)
  }

  return { ok: failures.length === 0, failures }
}

// ============================================================================
// NAIVE RANKING BASELINES — ticket #159, Defect 1. Pure, over the SAME
// `measured: MeasuredRow[]` population every ranking figure above uses. No
// I/O, no new Supabase read.
// ============================================================================

export interface BaselineSummary {
  label: string
  /** Pooled across the whole season — mirrors SeasonRankingSummary.spearman. */
  seasonSpearman: number | null
  /** Pooled per position across the whole season — mirrors PositionRankingSummary.spearman. */
  byPosition: Record<Position, number | null>
}

function baselineRankingPairs(rows: readonly MeasuredRow[], valueOf: (row: MeasuredRow) => number): RankingPair[] {
  return rows.map((r) => ({ projected: valueOf(r), actual: r.actualPoints }))
}

/** One real (non-constant) baseline's Spearman, at the season aggregate and per position — shared by both computeBaselineMinutesPerMatch and computeBaselineXgXaPerMatch's own MeasuredRow fields. */
export function summarizeBaselineSpearman(label: string, rows: readonly MeasuredRow[], valueOf: (row: MeasuredRow) => number): BaselineSummary {
  const seasonSpearman = spearmanCorrelation(baselineRankingPairs(rows, valueOf))
  const byPosition = {} as Record<Position, number | null>
  for (const position of POSITIONS) {
    byPosition[position] = spearmanCorrelation(baselineRankingPairs(rows.filter((r) => r.position === position), valueOf))
  }
  return { label, seasonSpearman, byPosition }
}

/**
 * Ticket #159, naive baseline 3 ("constant ranking"), the zero-skill floor
 * AND a self-test of the correlation code. Every row is assigned the
 * IDENTICAL raw value (CONSTANT_BASELINE_VALUE) — zero variance, so
 * spearmanCorrelation correctly returns null there (proven by this file's
 * own "returns null ... when every projected value is identical" test
 * above), never a numeric value, because a Pearson/Spearman correlation is
 * mathematically UNDEFINED for a constant input, not zero. This function
 * ASSERTS that null (throws if spearmanCorrelation ever returns anything
 * else here) and reports it as exactly 0 for display and for the verdict
 * line below — a baseline that discriminates NOTHING has, by definition,
 * zero rank-correlation skill. The throw IS the self-test the ticket asks
 * for: "a correlation implementation that scores a constant ranking well is
 * broken" — one that found a spurious non-null signal in an input carrying
 * none would trip it.
 */
export function computeConstantBaselineSpearman(rows: readonly MeasuredRow[]): number {
  const raw = spearmanCorrelation(rows.map((r) => ({ projected: CONSTANT_BASELINE_VALUE, actual: r.actualPoints })))
  if (raw !== null) {
    throw new BacktestError(
      `constant-ranking baseline unexpectedly produced a non-null Spearman correlation (${raw.toFixed(6)}) — a genuinely constant value has zero variance, so spearmanCorrelation must return null; a non-null result here means the correlation implementation found a spurious signal in an input that carries none`,
      'baseline',
    )
  }
  return 0
}

function summarizeConstantBaseline(rows: readonly MeasuredRow[]): BaselineSummary {
  const seasonSpearman = computeConstantBaselineSpearman(rows)
  const byPosition = {} as Record<Position, number | null>
  for (const position of POSITIONS) {
    byPosition[position] = computeConstantBaselineSpearman(rows.filter((r) => r.position === position))
  }
  return { label: CONSTANT_BASELINE_LABEL, seasonSpearman, byPosition }
}

/** The three naive baselines, in report order — ticket text verbatim (minutes, then xG+xA, then the constant floor). */
export function summarizeBaselines(rows: readonly MeasuredRow[]): BaselineSummary[] {
  return [
    summarizeBaselineSpearman(PRIOR_MINUTES_PER_MATCH_BASELINE_LABEL, rows, (r) => r.baselineMinutesPerMatch),
    summarizeBaselineSpearman(PRIOR_XG_XA_PER_MATCH_BASELINE_LABEL, rows, (r) => r.baselineXgXaPerMatch),
    summarizeConstantBaseline(rows),
  ]
}

export interface BaselineVerdict {
  label: string
  modelSpearman: number | null
  baselineSpearman: number | null
  /** modelSpearman - baselineSpearman, season aggregate. Null when either side is null (undefined correlation somewhere — no verdict can be stated as a number then). A DIFFERENCE, never checked against an asserted threshold (ticket text) — the report states the number and stops. */
  delta: number | null
}

/** Ticket #159: "model's Spearman MINUS each baseline's, at the season aggregate, printed in the report — a difference, never a threshold." */
export function buildBaselineVerdicts(modelSeasonSpearman: number | null, baselines: readonly BaselineSummary[]): BaselineVerdict[] {
  return baselines.map((b) => ({
    label: b.label,
    modelSpearman: modelSeasonSpearman,
    baselineSpearman: b.seasonSpearman,
    delta: modelSeasonSpearman !== null && b.seasonSpearman !== null ? modelSeasonSpearman - b.seasonSpearman : null,
  }))
}

// ============================================================================
// FIVE-GAMEWEEK RANKING TARGET — ticket #183. Pure, over already-fetched
// data (featureHistoryRows, the SAME `measured: MeasuredRow[]` population,
// and the SAME actualByPlayerGameweek/teamMatchRecords main() already built
// for the section above), no new Supabase read. Nothing above this point in
// the file is read, let alone modified, by anything below — the existing
// section's construction and every figure it prints are untouched (see this
// file's own tests, "existing report is byte-identical").
//
// WHY. The app plans over a five-gameweek horizon (build-solver-input.ts's
// `decay_base`/`ft_value_list`; scripts/project-points.ts's own
// `PROJECTION_HORIZON = 5`) but the section above measures only one
// gameweek. docs/model-review-2026-09-02.md (commissioned after a backtest
// run showed the model losing to a naive minutes ranking) found that
// single-gameweek Spearman is nearly saturated — a quality oracle that
// knows a player's TRUE season scoring rate only reaches ~0.33 there, so the
// 1-GW section has almost no headroom left to show any future model
// improvement — while the 5-GW totals the solver actually optimises show
// much more room (oracle ~0.485 vs the model's ~0.425, worse still at
// forwards). This section adds that measurement, additively, per that
// review's recommendation R2.
//
// FIVE PROJECTIONS SUMMED, NEVER ONE PROJECTION TIMES FIVE (ticket text).
// EVERYTHING IS PLANNED AT G. The app picks a transfer once, at the window's
// start gameweek G, and lives with it for G..G+4. So every leg of the window
// is projected from the model state visible AT G — G's `feature_history` row
// (strictly-before-G totals, by feature_history's own construction — see
// file header, "THE JOIN"), G's position prior, and both teams' strength as
// of G — and only the FIXTURE identity varies leg by leg, because the
// published schedule for G..G+4 is genuinely known at G. The G leg reuses
// the corresponding `measured` row's own `projectedPoints`/`actualPoints`
// directly (computed by the untouched section above via the exact same
// pipeline) rather than recomputing it a second, potentially divergent way.
//
// THIS WAS WRONG UNTIL 3 SEP 2026 AND IS WHY THE ORACLE CEILING TRIPPED.
// The legs used to be projected from G+i's OWN feature_history row, position
// prior and team strength — point-in-time state from INSIDE the target
// window, i.e. hindsight the app does not have when it plans at G. That
// inflated the model's five-gameweek Spearman to 0.728 against a genuine
// hindsight oracle's 0.506, which is what `checkOracleCeiling` reported. See
// `projectAndReconstructWindowGameweek`'s own comment for the exact split of
// which argument serves which side, and docs/projection-model-backlog.md G13.
//
// TRUNCATED WINDOWS — EXCLUDED, NOT SHORTENED (ticket text: "decide exclude
// vs. shorter-window reporting, state which"). A starting gameweek G whose
// window would run past the last gameweek this run's `feature_history` read
// actually covers (`lastGameweekInData`, computed from the data itself,
// never hardcoded as 38 — a partial-season read must not silently claim
// gameweeks that were never fetched) is excluded as `truncatedWindow`,
// counted, never reported as a shorter sum. This mirrors
// docs/model-review-2026-09-02.md's own R2 spec verbatim ("for every
// measured row with gameweek ≤ 34") for a 38-gameweek season — a shortened
// window would mix different-length sums into one "5-gameweek" figure,
// which is not the same measurement for every row.
//
// ZEROS FOR NON-FEATURING WEEKS INSIDE THE WINDOW (ticket text, quoting
// docs/model-review-2026-09-02.md's R2: "zeros for non-featuring weeks —
// that risk is part of what a transfer buys"). Unlike the single-gameweek
// section, a window leg where the player did not feature (or had no
// matching `player_match_stats` row at all) contributes its natural 0
// actual points — never excludes the whole window — because a five-gameweek
// transfer decision genuinely carries the risk of a rotation week or a
// blank gameweek somewhere in the window; excluding those windows would
// hide exactly the risk a real transfer bears. `aggregateActualForGameweek`
// already returns 0 total points for an empty or non-featuring row set, so
// this falls out of the SAME unmodified function used everywhere else in
// this file — no special-casing needed. The one thing that STILL excludes a
// whole window: a leg whose matched actual data has `team_goals_conceded`
// unknown (the same ~2% gap the section above hard-excludes for) — silently
// defaulting an unknown conceded-goals figure to 0 would bias that leg
// toward an undeserved clean sheet, so a window with that gap in ANY leg is
// excluded as `actualDataIncomplete`, counted, same reasoning as the
// existing section's own gate, just re-applied per leg.
//
// THE QUALITY ORACLE (ticket text; docs/model-review-2026-09-02.md's own
// construction, reproduced here from feature_history/player_match_stats
// data this job already reads — no new Supabase call). Each player's
// "quality" is his own points-per-match rate over every one of HIS season's
// `player_match_stats` rows whose gameweek is OUTSIDE the target window —
// never inside it, for one or for five gameweeks — then that single number
// is ranked against the SAME actual target the model/baselines are ranked
// against. `computeOracleRate` is the whole leak guard: it sums only
// matches whose gameweekId is not in the caller's `excludeGameweeks` set.
// THIS IS A HINDSIGHT CEILING, NEVER A MODEL AND NEVER A TARGET TO TUNE
// TOWARD — restated in the report's own prose, not just here (ticket text).
//
// REUSING THE SAME MATH, NEW ROW SHAPE. spearmanCorrelation, topNOverlap,
// topNIsMeaningful, rankDescending and MIN_BUCKET_SAMPLE_SIZE are already
// generic over `RankingPair`/`TopNOverlap` — reused completely unmodified
// below via `GenericRankingRow` (`{ position, groupId, projected, actual }`,
// `groupId` meaning "starting gameweek" for the five-gameweek model/
// baselines and the five-gameweek oracle, and plain "gameweek" for the
// one-gameweek oracle). `summarizeGenericRankingByGroup`/
// `summarizeGenericSeasonRanking`/`summarizeGenericRankingByPosition`
// deliberately RETURN the SAME exported types the section above already
// uses (`GameweekRankingSummary`/`SeasonRankingSummary`/
// `PositionRankingSummary`) so the existing `buildRankingGameweekTable`/
// `buildBaselineSpearmanTable`/`buildBaselineVerdictLines`/`fmtSpearman`/
// `fmtTopN`/`fmtTopNOrRefused` formatting functions are reused, unmodified,
// for this section's tables too — never a second, divergent formatting
// layer.
// ============================================================================

/**
 * The horizon this section sums — five gameweeks, matching
 * build-solver-input.ts's `decay_base`/`ft_value_list` and
 * scripts/project-points.ts's own `PROJECTION_HORIZON = 5`. Defined locally
 * rather than imported (same convention MIN_BUCKET_SAMPLE_SIZE's own comment
 * states: this file's own small, self-contained constants, not a
 * cross-import into another script for one shared number).
 */
export const FIVE_GAMEWEEK_HORIZON = 5

function windowKey(playerCode: number, gameweekId: number): string {
  return `${playerCode}:${gameweekId}`
}

/** Every gameweek_id read this run, keyed for O(1) lookup by (player_code, gameweek_id) — the index main() builds once from the SAME `featureHistoryRows` array the section above already fetched. */
export function buildFeatureHistoryIndex(rows: readonly FeatureHistoryRow[]): Map<string, FeatureHistoryRow> {
  const result = new Map<string, FeatureHistoryRow>()
  for (const row of rows) result.set(windowKey(row.player_code, row.gameweek_id), row)
  return result
}

/** The last gameweek_id this run's `feature_history` read actually covers — 0 for an empty read. Computed from the data itself so a partial-season read never silently claims gameweeks it never fetched (see this section's own header, "TRUNCATED WINDOWS"). */
export function computeLastGameweekInData(rows: readonly FeatureHistoryRow[]): number {
  let max = 0
  for (const row of rows) if (row.gameweek_id > max) max = row.gameweek_id
  return max
}

/** The five contiguous gameweek ids a starting gameweek's window covers — `[G, G+1, G+2, G+3, G+4]`. */
export function buildFiveGameweekWindow(startGameweekId: number): number[] {
  return Array.from({ length: FIVE_GAMEWEEK_HORIZON }, (_, i) => startGameweekId + i)
}

/** True when a starting gameweek's window would reach past `lastGameweekInData` — the truncated-window exclusion gate (see this section's own header). */
export function isFiveGameweekWindowTruncated(startGameweekId: number, lastGameweekInData: number): boolean {
  return startGameweekId + FIVE_GAMEWEEK_HORIZON - 1 > lastGameweekInData
}

/**
 * One window leg's outcome — `'ok'` carries both sides so the caller can
 * sum; every other status is a named reason the WHOLE window gets excluded
 * (see classifyFiveGameweekRow). Ticket #193: `'ok'` also carries
 * `fixtureCount`/`featured`, the club-schedule diagnostics
 * classifyFiveGameweekRow tallies across a window's four legs — both are
 * already computed to build the projection, so this is free.
 * `'unresolvedTeamCode'` (ticket #193) — the window's start row has no
 * `team_code`, so the club schedule cannot be resolved for ANY leg (every
 * leg shares the same G row's team_code — see this function's own comment).
 */
export type WindowGameweekOutcome =
  | { status: 'ok'; position: Position; projectedPoints: number; actualPoints: number; fixtureCount: number; featured: boolean }
  | { status: 'missingFeatureHistoryRow' }
  | { status: 'unresolvedPosition' }
  | { status: 'unresolvedTeamCode' }
  | { status: 'actualDataIncomplete' }

/**
 * Projects and reconstructs ONE window leg — the (player, G+i) pair for leg
 * `i` of a window that starts at gameweek G.
 *
 * TWO GAMEWEEK ARGUMENTS, AND WHICH SIDE EACH ONE SERVES. The app plans the
 * whole five-gameweek horizon ONCE, at G, from the state it can actually see
 * at G. So the two gameweek parameters below are NOT interchangeable and
 * must never be collapsed into one:
 *
 *   `featureGameweekId` — THE WINDOW'S START, G. Every point-in-time piece
 *   of MODEL STATE is keyed on it, because G's state is all the app has when
 *   it plans the horizon. Exactly three lookups, all of them here:
 *     1. the `feature_history` row (`prior_*` form, minutes, xG/xA, and the
 *        `element_type`/`team_code` read off it),
 *     2. both `computeTeamStrengthAsOf` calls — own club's and opponent's
 *        strength,
 *     3. the (gameweek, position) entry in `positionPriors`.
 *   Keying any of these on the leg's own gameweek instead reads state from
 *   INSIDE the target window — hindsight the app does not have — and that is
 *   not a small leak: it inflated the model's five-gameweek Spearman to
 *   0.728 against a genuine hindsight oracle's 0.506, which is the ordering
 *   `checkOracleCeiling` refuses. See docs/projection-model-backlog.md G13.
 *
 *   `legGameweekId` — THIS LEG'S OWN GAMEWEEK, G+i. Only what a PUBLISHED
 *   FIXTURE SCHEDULE legitimately tells you at G is keyed on it:
 *     - that leg's real outcome (via `actualRows`, which the caller has
 *       already selected for G+i) — the target being ranked, not an input, and
 *     - the leg's fixture COUNT and OPPONENT(s) — WHO the player's club plays
 *       that week and how many times (a double gameweek returns two) — via
 *       `clubFixtureSchedule`, looked up at (this row's own `team_code`,
 *       `legGameweekId`). **Ticket #193**: this used to come from
 *       `actualRows` — the player's OWN matched rows for the leg — which
 *       told the model in advance exactly which weeks the player would not
 *       feature in (no rows ⇒ 0 fixtures ⇒ a foreknown 0 projected against a
 *       foreknown 0 actual). The published SCHEDULE, never the player's own
 *       appearance, is what is legitimately knowable at G — see
 *       `buildClubFixtureSchedule`'s own comment and
 *       docs/projection-model-backlog.md G13's addendum.
 *   The schedule for G..G+4 is public at G; whether THIS PLAYER features in
 *   it, and the form of the clubs in it, are not. Hence the split: the
 *   fixture's IDENTITY is the leg's, while both sides' STRENGTH is measured
 *   as of G and the outcome is read at the leg.
 *
 * Every function called here is imported/defined ABOVE this section,
 * unmodified: `resolveRowPosition` (same two-source resolution the section
 * above uses, same `codeToPosition` fallback), `aggregateActualForGameweek`/
 * `reconstructActualMatchPoints` (via `toActualMatchStatsInput`, so a
 * non-featuring or no-data leg naturally reconstructs to 0 points — see this
 * section's own header, "ZEROS FOR NON-FEATURING WEEKS"), `resolveFixtureTeams`/
 * `computeTeamStrengthAsOf`/`computeFixtureExpectedScore` (the SAME
 * point-in-time fixture construction ticket #175 built, degrading to the
 * neutral fixture exactly as it already does when a club cannot be
 * resolved — never a second, divergent fixture rule), `lookupClubFixtureSchedule`
 * (ticket #193), and `projectRow` itself. `projectRow` is called with the
 * SCHEDULE's fixture count, never `outcome.matchesFound` (the player's own
 * matched-row count) — that is the entire fix.
 */
export function projectAndReconstructWindowGameweek(
  playerCode: number,
  /** G — the window's START gameweek. Keys the feature_history row, both team-strength reads and the position prior. See this function's own comment. */
  featureGameweekId: number,
  /** G+i — this leg's OWN gameweek. Serves only the club fixture schedule and the actual outcome. See this function's own comment. */
  legGameweekId: number,
  featureHistoryByPlayerGameweek: ReadonlyMap<string, FeatureHistoryRow>,
  codeToPosition: ReadonlyMap<number, Position>,
  positionPriors: ReadonlyMap<string, PositionPrior>,
  actualRows: readonly ActualSourceRow[],
  teamMatchRecords: readonly TeamMatchRecord[],
  /** Ticket #193 — the published club fixture schedule (`buildClubFixtureSchedule`), the leg's fixture count/opponent(s) source. Never `actualRows`. */
  clubFixtureSchedule: ReadonlyMap<string, readonly (number | null)[]>,
): WindowGameweekOutcome {
  // A leg can never sit before the window that contains it. This guard is
  // cheap and it is the one place the two arguments are compared, so a
  // future caller that swaps them at the call site fails loudly here rather
  // than silently reintroducing the G13 lookahead.
  if (legGameweekId < featureGameweekId) {
    throw new BacktestError(
      `window leg gameweek ${legGameweekId} precedes its own window start ${featureGameweekId} for player ${playerCode} — the two gameweek arguments to projectAndReconstructWindowGameweek are almost certainly swapped.`,
      'fiveGameweekWindow',
    )
  }

  const row = featureHistoryByPlayerGameweek.get(windowKey(playerCode, featureGameweekId))
  if (row === undefined) return { status: 'missingFeatureHistoryRow' }

  const resolution = resolveRowPosition(row, codeToPosition)
  if (resolution.position === undefined) return { status: 'unresolvedPosition' }
  const position = resolution.position

  // Ticket #193: without the window's own club known, the schedule cannot be
  // resolved for ANY leg (every leg shares this same G row) — excluded by
  // name, never guessed. Narrows `row.team_code` to `number` below.
  if (row.team_code === null) return { status: 'unresolvedTeamCode' }

  // THE FIX. Fixture COUNT and OPPONENT(s) come from the published club
  // schedule, keyed on (this row's own club, the LEG's own gameweek) — never
  // from whether this player personally has a matching player_match_stats
  // row for the leg. A leg with no schedule entry is the club's blank
  // gameweek: 0 fixtures, a legitimate zero, counted separately below (never
  // a fallback neutral fixture — that would invent a match).
  const scheduledOpponents = lookupClubFixtureSchedule(clubFixtureSchedule, row.team_code, legGameweekId)
  const fixtureCount = scheduledOpponents.length

  const actualInputs = actualRows.map(toActualMatchStatsInput)
  const outcome = aggregateActualForGameweek(position, actualInputs)
  if (!outcome.teamGoalsConcededKnown) return { status: 'actualDataIncomplete' }

  // Fixture IDENTITY from the schedule (at the leg), fixture STRENGTH as of G.
  const fixtureTeamsResolved = resolveFixtureTeams(row.team_code, scheduledOpponents)
  let fixtureExpectedScores: number[] = []
  if (fixtureTeamsResolved) {
    const ownStrength = computeTeamStrengthAsOf(teamMatchRecords, row.team_code, featureGameweekId)
    fixtureExpectedScores = scheduledOpponents.map((code) =>
      computeFixtureExpectedScore(ownStrength, computeTeamStrengthAsOf(teamMatchRecords, code as number, featureGameweekId), SCALE),
    )
  }

  const prior = positionPriors.get(positionPriorKey(featureGameweekId, position)) ?? fallbackPositionPrior(position)
  const projection = projectRow(row, position, prior, fixtureCount, fixtureExpectedScores)

  return { status: 'ok', position, projectedPoints: projection.expectedPoints, actualPoints: outcome.totalPoints, fixtureCount, featured: outcome.featured }
}

/** One measured five-gameweek row — mirrors MeasuredRow's shape for the fields the ranking/baseline/report layer below needs, summed across the window rather than one gameweek. */
export interface FiveGameweekRow {
  playerCode: number
  startGameweekId: number
  position: Position
  /** Sum of five per-gameweek projections — never one projection × 5 (see this section's header). */
  projectedPoints: number
  /** Sum of five actual-points reconstructions, 0 for a non-featuring leg (see this section's header). */
  actualPoints: number
  /** Ticket text: "the same prior quantity ranked against the five-gameweek actual total" — reused verbatim from the corresponding `measured` row's own baseline (computed at the START gameweek, never recomputed per leg or averaged across the window). */
  baselineMinutesPerMatch: number
  baselineXgXaPerMatch: number
  /**
   * Ticket #193 — club-schedule fixture diagnostics, tallied across this
   * window's four G+1..G+4 legs only (never the G leg — its fixture count
   * comes from the already-correct single-gameweek path above, and by
   * construction that leg already featured). See `sumClubScheduleLegCounts`
   * for the season-wide totals the report prints.
   */
  /** How many of the four legs had at least one schedule-derived fixture (0-4). */
  legsWithScheduleFixture: number
  /** How many of the four legs had NO schedule entry — the club's blank gameweek, a legitimate zero on both sides (0-4). */
  legsBlankGameweek: number
  /** THE LEAK SIZE: of the legs with a scheduled fixture, how many the player did not feature in (0-4) — this is exactly what used to project a foreknown 0 before this ticket. */
  legsDidNotFeatureButClubHadFixture: number
}

export type FiveGameweekExclusionReason = 'truncatedWindow' | 'missingFeatureHistoryRow' | 'unresolvedPosition' | 'unresolvedTeamCode' | 'actualDataIncomplete'

export type FiveGameweekClassification =
  | { kind: 'excluded'; reason: FiveGameweekExclusionReason }
  | { kind: 'measured'; row: FiveGameweekRow }

/**
 * Classifies one (player, starting gameweek) pair — `startRow` is the
 * CORRESPONDING single-gameweek `measured` row (its own `projectedPoints`/
 * `actualPoints`/`position`/both baselines reused directly for the window's
 * G leg, never recomputed a second way). Gameweeks G+1..G+4 are each
 * projected and reconstructed fresh via `projectAndReconstructWindowGameweek`
 * — any non-'ok' leg excludes the WHOLE window under that leg's own reason
 * (a window is only as good as its worst-resolved leg; never a partial sum
 * silently missing a leg).
 *
 * `startRow.gameweekId` is G, and it is passed to every leg as that
 * function's `featureGameweekId` — the model state each leg is built from is
 * the state at G, never the state at G+i, because that is the only state the
 * app has when it plans the whole horizon at G. The leg's own gameweek goes
 * in as `legGameweekId` and selects that leg's `actualRows` (its outcome)
 * and its schedule-derived fixture (via `clubFixtureSchedule`). See
 * `projectAndReconstructWindowGameweek`'s own comment for why each side gets
 * which.
 *
 * Ticket #193 — also tallies `legsWithScheduleFixture`/`legsBlankGameweek`/
 * `legsDidNotFeatureButClubHadFixture` across the four legs it evaluates
 * (from each leg's `outcome.fixtureCount`/`outcome.featured`, already
 * computed to build the projection — free). Only reaches the return for a
 * `'measured'` window: a window excluded partway through discards whatever
 * it had tallied for its earlier legs too, matching this function's existing
 * "a window is only as good as its worst-resolved leg" rule — never a
 * partial diagnostic for a window that isn't itself in the report.
 */
export function classifyFiveGameweekRow(
  playerCode: number,
  startRow: Pick<MeasuredRow, 'gameweekId' | 'position' | 'projectedPoints' | 'actualPoints' | 'baselineMinutesPerMatch' | 'baselineXgXaPerMatch'>,
  lastGameweekInData: number,
  featureHistoryByPlayerGameweek: ReadonlyMap<string, FeatureHistoryRow>,
  codeToPosition: ReadonlyMap<number, Position>,
  positionPriors: ReadonlyMap<string, PositionPrior>,
  actualByPlayerGameweek: ReadonlyMap<string, readonly ActualSourceRow[]>,
  teamMatchRecords: readonly TeamMatchRecord[],
  /** Ticket #193 — see `projectAndReconstructWindowGameweek`'s own parameter of the same name. */
  clubFixtureSchedule: ReadonlyMap<string, readonly (number | null)[]>,
): FiveGameweekClassification {
  if (isFiveGameweekWindowTruncated(startRow.gameweekId, lastGameweekInData)) {
    return { kind: 'excluded', reason: 'truncatedWindow' }
  }

  let projectedPoints = startRow.projectedPoints
  let actualPoints = startRow.actualPoints
  let legsWithScheduleFixture = 0
  let legsBlankGameweek = 0
  let legsDidNotFeatureButClubHadFixture = 0

  const window = buildFiveGameweekWindow(startRow.gameweekId)
  for (let i = 1; i < window.length; i++) {
    const gameweekId = window[i]
    const actualRows = actualByPlayerGameweek.get(windowKey(playerCode, gameweekId)) ?? []
    const outcome = projectAndReconstructWindowGameweek(
      playerCode,
      startRow.gameweekId,
      gameweekId,
      featureHistoryByPlayerGameweek,
      codeToPosition,
      positionPriors,
      actualRows,
      teamMatchRecords,
      clubFixtureSchedule,
    )
    if (outcome.status !== 'ok') return { kind: 'excluded', reason: outcome.status }
    projectedPoints += outcome.projectedPoints
    actualPoints += outcome.actualPoints
    if (outcome.fixtureCount > 0) {
      legsWithScheduleFixture++
      if (!outcome.featured) legsDidNotFeatureButClubHadFixture++
    } else {
      legsBlankGameweek++
    }
  }

  return {
    kind: 'measured',
    row: {
      playerCode,
      startGameweekId: startRow.gameweekId,
      position: startRow.position,
      projectedPoints,
      actualPoints,
      baselineMinutesPerMatch: startRow.baselineMinutesPerMatch,
      baselineXgXaPerMatch: startRow.baselineXgXaPerMatch,
      legsWithScheduleFixture,
      legsBlankGameweek,
      legsDidNotFeatureButClubHadFixture,
    },
  }
}

/** The five named exclusion reasons (`unresolvedTeamCode` added by ticket #193) — a strict partition of every single-gameweek `measured` row (the candidate population), alongside the five-gameweek measured count. Mirrors `ExclusionCounts`/`assertReconciles` above exactly, for the five-gameweek population. */
export interface FiveGameweekExclusionCounts {
  truncatedWindow: number
  missingFeatureHistoryRow: number
  unresolvedPosition: number
  unresolvedTeamCode: number
  actualDataIncomplete: number
}

export function emptyFiveGameweekExclusionCounts(): FiveGameweekExclusionCounts {
  return { truncatedWindow: 0, missingFeatureHistoryRow: 0, unresolvedPosition: 0, unresolvedTeamCode: 0, actualDataIncomplete: 0 }
}

export function incrementFiveGameweekExclusion(counts: FiveGameweekExclusionCounts, reason: FiveGameweekExclusionReason): void {
  counts[reason]++
}

export function totalFiveGameweekExcluded(counts: FiveGameweekExclusionCounts): number {
  return counts.truncatedWindow + counts.missingFeatureHistoryRow + counts.unresolvedPosition + counts.unresolvedTeamCode + counts.actualDataIncomplete
}

/** Ticket #193 — season-wide totals of `FiveGameweekRow`'s own per-window leg diagnostics (see that interface's own comment), summed across every five-gameweek MEASURED row. The report's three new counters. */
export interface ClubScheduleLegCounts {
  legsWithScheduleFixture: number
  legsBlankGameweek: number
  legsDidNotFeatureButClubHadFixture: number
}

export function sumClubScheduleLegCounts(rows: readonly FiveGameweekRow[]): ClubScheduleLegCounts {
  const totals: ClubScheduleLegCounts = { legsWithScheduleFixture: 0, legsBlankGameweek: 0, legsDidNotFeatureButClubHadFixture: 0 }
  for (const row of rows) {
    totals.legsWithScheduleFixture += row.legsWithScheduleFixture
    totals.legsBlankGameweek += row.legsBlankGameweek
    totals.legsDidNotFeatureButClubHadFixture += row.legsDidNotFeatureButClubHadFixture
  }
  return totals
}

/** candidates (the single-gameweek `measured` population) = five-gameweek measured + excluded, by reason, exactly — mirrors `assertReconciles` above. */
export function assertFiveGameweekReconciles(candidateCount: number, measuredCount: number, counts: FiveGameweekExclusionCounts): void {
  const excluded = totalFiveGameweekExcluded(counts)
  const total = measuredCount + excluded
  if (total !== candidateCount) {
    throw new BacktestError(
      `five-gameweek reconciliation failed: ${candidateCount} single-gameweek measured row(s) were candidates, but five-gameweek measured (${measuredCount}) + excluded (${excluded}) = ${total}. ` +
        `Exclusion breakdown: ${JSON.stringify(counts)}.`,
      'reconciliation',
    )
  }
}

// ----------------------------------------------------------------------------
// Generic ranking summarizers — reused for the five-gameweek model ranking,
// both naive baselines, and the quality oracle at BOTH horizons (see this
// section's own header, "REUSING THE SAME MATH, NEW ROW SHAPE"). Return
// types are the SAME exported types the section above already uses, so its
// formatting functions apply here unmodified.
// ----------------------------------------------------------------------------

/** `groupId` means "starting gameweek" for every five-gameweek use below, and plain "gameweek" for the one-gameweek oracle — see this section's header. */
export interface GenericRankingRow {
  position: Position
  groupId: number
  projected: number
  actual: number
}

function toGenericRankingPair(row: Pick<GenericRankingRow, 'projected' | 'actual'>): RankingPair {
  return { projected: row.projected, actual: row.actual }
}

/** Mirrors summarizeRankingByGameweek exactly, generalized to GenericRankingRow — same MIN_BUCKET_SAMPLE_SIZE gate, same tie rules (via the unmodified spearmanCorrelation/topNOverlap). */
export function summarizeGenericRankingByGroup(rows: readonly GenericRankingRow[]): Map<number, GameweekRankingSummary> {
  const groupIds = [...new Set(rows.map((r) => r.groupId))].sort((a, b) => a - b)
  const result = new Map<number, GameweekRankingSummary>()
  for (const groupId of groupIds) {
    const groupRows = rows.filter((r) => r.groupId === groupId)
    const n = groupRows.length
    const tooSmallToRead = n < MIN_BUCKET_SAMPLE_SIZE
    const pairs = groupRows.map(toGenericRankingPair)
    result.set(groupId, {
      gameweekId: groupId,
      n,
      tooSmallToRead,
      spearman: tooSmallToRead ? null : spearmanCorrelation(pairs),
      top10: tooSmallToRead ? null : topNOverlap(pairs, 10),
      top20: tooSmallToRead ? null : topNOverlap(pairs, 20),
    })
  }
  return result
}

/** Mirrors summarizeSeasonRanking exactly, generalized to GenericRankingRow. */
export function summarizeGenericSeasonRanking(rows: readonly GenericRankingRow[], byGroup: ReadonlyMap<number, GameweekRankingSummary>): SeasonRankingSummary {
  const spearman = spearmanCorrelation(rows.map(toGenericRankingPair))
  let overlap10 = 0
  let n10 = 0
  let overlap20 = 0
  let n20 = 0
  for (const summary of byGroup.values()) {
    if (summary.tooSmallToRead || summary.top10 === null || summary.top20 === null) continue
    overlap10 += summary.top10.overlap
    n10 += summary.top10.n
    overlap20 += summary.top20.overlap
    n20 += summary.top20.n
  }
  return { n: rows.length, spearman, top10: { overlap: overlap10, n: n10 }, top20: { overlap: overlap20, n: n20 } }
}

/** Mirrors summarizeRankingByPosition exactly, generalized to GenericRankingRow — including the Defect 2 topNIsMeaningful gate, unmodified. */
export function summarizeGenericRankingByPosition(rows: readonly GenericRankingRow[]): Record<Position, PositionRankingSummary> {
  const result = {} as Record<Position, PositionRankingSummary>
  for (const position of POSITIONS) {
    const positionRows = rows.filter((r) => r.position === position)
    const spearman = spearmanCorrelation(positionRows.map(toGenericRankingPair))

    const groupIds = [...new Set(positionRows.map((r) => r.groupId))]
    let overlap10 = 0
    let n10 = 0
    let overlap20 = 0
    let n20 = 0
    for (const groupId of groupIds) {
      const pairs = positionRows.filter((r) => r.groupId === groupId).map(toGenericRankingPair)
      const population = pairs.length
      const t10 = topNOverlap(pairs, 10)
      const t20 = topNOverlap(pairs, 20)
      if (topNIsMeaningful(t10, population)) {
        overlap10 += t10.overlap
        n10 += t10.n
      }
      if (topNIsMeaningful(t20, population)) {
        overlap20 += t20.overlap
        n20 += t20.n
      }
    }

    const hadAnyGroupWithRows = groupIds.length > 0
    result[position] = {
      position,
      n: positionRows.length,
      spearman,
      top10: { overlap: overlap10, n: n10 },
      top20: { overlap: overlap20, n: n20 },
      top10Refused: hadAnyGroupWithRows && n10 === 0,
      top20Refused: hadAnyGroupWithRows && n20 === 0,
    }
  }
  return result
}

/** Ticket #183, five-gameweek naive baselines — the SAME two per-row prior quantities the single-gameweek section's baselines use (`baselineMinutesPerMatch`/`baselineXgXaPerMatch`, both computed at the START gameweek — see FiveGameweekRow's own comment), ranked here against the five-gameweek actual total instead of the single-gameweek one. */
export function summarizeGenericBaselineSpearman(label: string, rows: readonly GenericRankingRow[]): BaselineSummary {
  const seasonSpearman = spearmanCorrelation(rows.map(toGenericRankingPair))
  const byPosition = {} as Record<Position, number | null>
  for (const position of POSITIONS) {
    byPosition[position] = spearmanCorrelation(rows.filter((r) => r.position === position).map(toGenericRankingPair))
  }
  return { label, seasonSpearman, byPosition }
}

/**
 * Ticket #183. THE SAME self-test as computeConstantBaselineSpearman above
 * (ticket text: "a constant ranking scores 0 on the five-gameweek target
 * too" — named test), reapplied to the five-gameweek actual target: every
 * row assigned the IDENTICAL CONSTANT_BASELINE_VALUE has zero variance, so
 * spearmanCorrelation must return null, never a numeric value — asserted
 * (throws otherwise) rather than assumed, exactly like the original.
 */
export function computeGenericConstantBaselineSpearman(actualValues: readonly number[]): number {
  const raw = spearmanCorrelation(actualValues.map((actual) => ({ projected: CONSTANT_BASELINE_VALUE, actual })))
  if (raw !== null) {
    throw new BacktestError(
      `five-gameweek constant-ranking baseline unexpectedly produced a non-null Spearman correlation (${raw.toFixed(6)}) — ` +
        'the identical self-test computeConstantBaselineSpearman applies to the one-gameweek target (see its own comment), reapplied here to the ' +
        'five-gameweek actual total: a genuinely constant projected value has zero variance, so spearmanCorrelation must return null.',
      'baseline',
    )
  }
  return 0
}

function summarizeGenericConstantBaseline(rows: readonly GenericRankingRow[]): BaselineSummary {
  const seasonSpearman = computeGenericConstantBaselineSpearman(rows.map((r) => r.actual))
  const byPosition = {} as Record<Position, number | null>
  for (const position of POSITIONS) {
    byPosition[position] = computeGenericConstantBaselineSpearman(rows.filter((r) => r.position === position).map((r) => r.actual))
  }
  return { label: CONSTANT_BASELINE_LABEL, seasonSpearman, byPosition }
}

/** The three naive baselines for the five-gameweek target, in the SAME report order as the one-gameweek section (minutes, then xG+xA, then the constant floor). */
export function summarizeFiveGameweekBaselines(rows: readonly FiveGameweekRow[]): BaselineSummary[] {
  const minutesRows: GenericRankingRow[] = rows.map((r) => ({ position: r.position, groupId: r.startGameweekId, projected: r.baselineMinutesPerMatch, actual: r.actualPoints }))
  const xgXaRows: GenericRankingRow[] = rows.map((r) => ({ position: r.position, groupId: r.startGameweekId, projected: r.baselineXgXaPerMatch, actual: r.actualPoints }))
  const constantRows: GenericRankingRow[] = rows.map((r) => ({ position: r.position, groupId: r.startGameweekId, projected: CONSTANT_BASELINE_VALUE, actual: r.actualPoints }))
  return [
    summarizeGenericBaselineSpearman(PRIOR_MINUTES_PER_MATCH_BASELINE_LABEL, minutesRows),
    summarizeGenericBaselineSpearman(PRIOR_XG_XA_PER_MATCH_BASELINE_LABEL, xgXaRows),
    summarizeGenericConstantBaseline(constantRows),
  ]
}

// ----------------------------------------------------------------------------
// The quality oracle — ticket text, docs/model-review-2026-09-02.md's own
// construction. See this section's own header, "THE QUALITY ORACLE".
// ----------------------------------------------------------------------------

/** One (player, gameweek) actual outcome, pre-grouped — the shape buildPlayerSeasonMatches needs; main() builds this once from the SAME `actualByPlayerGameweek` map the section above already built (no new Supabase read). */
export interface PlayerGameweekActualGroup {
  playerCode: number
  gameweekId: number
  rows: readonly ActualMatchStatsInput[]
}

/**
 * One (player, gameweek) actual points/matches pair — the raw material computeOracleRate sums over, excluding whichever gameweeks the caller's target window covers.
 *
 * `featured` (ticket #187) is OPTIONAL: real data from `buildPlayerSeasonMatches`
 * below always sets it, but it is optional on the TYPE so every pre-#187 test
 * literal in this file's own test suite (`computeOracleRate`'s own leak-guard
 * tests, `groupSeasonMatchesByPlayer`'s bucketing test) keeps compiling and
 * exercising `computeOracleRate` unmodified — that function never reads this
 * field. Only the new #187 appearance-rate functions below read it, and every
 * test that exercises those sets it explicitly.
 */
export interface PlayerSeasonMatch {
  playerCode: number
  gameweekId: number
  points: number
  matches: number
  /** True if the player featured (any minutes > 0) this gameweek — see the interface comment above. */
  featured?: boolean
}

/** Reconstructs every (player, gameweek) actual outcome for the WHOLE season (not gated by the measured-population rules above — the oracle needs a player's full season record, including gameweeks the model-accuracy sections exclude) via the SAME aggregateActualForGameweek used everywhere else in this file. A player whose position cannot be resolved (`positionOf` returns undefined) is skipped — points cannot be computed without a position. */
export function buildPlayerSeasonMatches(
  groups: readonly PlayerGameweekActualGroup[],
  positionOf: (playerCode: number) => Position | undefined,
): PlayerSeasonMatch[] {
  const result: PlayerSeasonMatch[] = []
  for (const g of groups) {
    const position = positionOf(g.playerCode)
    if (position === undefined) continue
    const outcome = aggregateActualForGameweek(position, g.rows)
    result.push({
      playerCode: g.playerCode,
      gameweekId: g.gameweekId,
      points: outcome.totalPoints,
      matches: outcome.matchesFound,
      featured: outcome.featured,
    })
  }
  return result
}

export function groupSeasonMatchesByPlayer(matches: readonly PlayerSeasonMatch[]): Map<number, PlayerSeasonMatch[]> {
  const result = new Map<number, PlayerSeasonMatch[]>()
  for (const m of matches) {
    const list = result.get(m.playerCode) ?? []
    list.push(m)
    result.set(m.playerCode, list)
  }
  return result
}

/**
 * THE MOST IMPORTANT FUNCTION IN THIS TICKET — the leave-window-out oracle
 * rate (ticket text: "a named test proves no gameweek inside the window
 * contributes to its own estimate"). Sums points and matches from every one
 * of `playerSeasonMatches` whose `gameweekId` is NOT in `excludeGameweeks` —
 * the caller's target window, whether one gameweek wide (the one-gameweek
 * oracle) or five (the five-gameweek oracle) — and divides. The ENTIRE leak
 * guard is the `excludeGameweeks.has(m.gameweekId)` check below; nothing
 * else in this file may compute a value that gets treated as this player's
 * "quality" for a window that includes the gameweek it was measured in.
 * Null when the player has zero matches outside the window (no evidence to
 * rank on — never a guessed rate).
 */
export function computeOracleRate(playerSeasonMatches: readonly PlayerSeasonMatch[], excludeGameweeks: ReadonlySet<number>): number | null {
  let points = 0
  let matches = 0
  for (const m of playerSeasonMatches) {
    if (excludeGameweeks.has(m.gameweekId)) continue
    points += m.points
    matches += m.matches
  }
  return matches > 0 ? points / matches : null
}

// ----------------------------------------------------------------------------
// Ticket #187 — the oracle fix. `computeOracleRate` above is UNCHANGED and
// still the one-gameweek oracle's own rate (ticket text: "a per-gameweek
// figure for the single-gameweek target, matching [its] units" — a
// points-per-match rate already matches a single gameweek's units closely
// enough, per the ticket's own explicit scoping to the five-gameweek target
// only; see this file's "FIVE-GAMEWEEK RANKING TARGET" section header,
// "THE QUALITY ORACLE", for the defect this section fixes).
//
// The five-gameweek target is a TOTAL, not a rate, so the oracle fed to it
// must estimate a total: (points per FEATURED out-of-window gameweek) ×
// (out-of-window appearance rate) × (the horizon width). Both factors are
// leak-guarded EXACTLY like computeOracleRate above — the SAME
// `excludeGameweeks.has(m.gameweekId)` check, repeated in each function
// below rather than factored through computeOracleRate, so each factor's
// own leak guard is independently visible and independently testable (the
// ticket's own instruction: "the appearance rate is exactly as leak-prone as
// the scoring rate").
// ----------------------------------------------------------------------------

/**
 * Ticket #187. The out-of-window rate factor for the five-gameweek TOTAL
 * estimate — points per FEATURED gameweek (never per raw match/fixture row:
 * conditioning on `featured` keeps this factor answering "how well does he
 * score when he actually plays", never diluted by benched weeks, which the
 * separate `computeOracleAppearanceRate` factor already accounts for — see
 * this section's header for why the two factors must not double-count the
 * same non-appearance risk). Null when the player has zero FEATURED matches
 * outside the window — no evidence to rank on, never a guessed rate.
 */
export function computeOracleFeaturedRate(playerSeasonMatches: readonly PlayerSeasonMatch[], excludeGameweeks: ReadonlySet<number>): number | null {
  let points = 0
  let featuredCount = 0
  for (const m of playerSeasonMatches) {
    if (excludeGameweeks.has(m.gameweekId)) continue
    if (m.featured !== true) continue
    points += m.points
    featuredCount++
  }
  return featuredCount > 0 ? points / featuredCount : null
}

/**
 * Ticket #187. The out-of-window appearance-rate factor for the
 * five-gameweek TOTAL estimate — the fraction of out-of-window (player,
 * gameweek) entries in which the player featured. THIS IS THE LEAK RISK THE
 * TICKET NAMES EXPLICITLY: it is tempting to use how many of the FIVE WINDOW
 * gameweeks the player actually featured in, but that is inside the window
 * and would be a leak producing a spectacular, wrong ceiling — this function
 * only ever looks outside it, via the identical `excludeGameweeks.has(...)`
 * guard `computeOracleRate`/`computeOracleFeaturedRate` use. Null when there
 * are zero out-of-window entries at all (no evidence, never a guessed rate);
 * a real 0 (out-of-window entries exist, none featured) is returned as 0 —
 * a genuine "never plays" signal, not missing data. See
 * `computeOracleFiveGameweekEstimate`'s own comment for why that distinction
 * matters to the caller.
 */
export function computeOracleAppearanceRate(playerSeasonMatches: readonly PlayerSeasonMatch[], excludeGameweeks: ReadonlySet<number>): number | null {
  let featuredCount = 0
  let total = 0
  for (const m of playerSeasonMatches) {
    if (excludeGameweeks.has(m.gameweekId)) continue
    total++
    if (m.featured === true) featuredCount++
  }
  return total > 0 ? featuredCount / total : null
}

/**
 * Ticket #187 — THE MOST IMPORTANT FUNCTION IN THIS TICKET (ticket text: "a
 * named test proves no data from inside the target window reaches the
 * oracle — including the appearance-rate factor"). The five-gameweek
 * quality-oracle TOTAL: `computeOracleFeaturedRate` × `computeOracleAppearanceRate`
 * × `horizonWidth`, both factors computed from the SAME out-of-window
 * `playerSeasonMatches`/`excludeGameweeks` this function itself never reads
 * directly — every leak guard lives in the two functions above, not
 * duplicated here. Null only when there is NO out-of-window evidence at all
 * (`computeOracleAppearanceRate` returns null); a player with out-of-window
 * evidence who simply never featured in any of it (`appearanceRate === 0`)
 * resolves to exactly 0, not null — `computeOracleFeaturedRate` is null in
 * that case too (no featured matches to average), so `rate ?? 0` reflects
 * "he is estimated to score 0 because he is estimated to never play",
 * arithmetically the same conclusion either way but stated without relying
 * on `0 × null` type-coercion.
 */
export function computeOracleFiveGameweekEstimate(
  playerSeasonMatches: readonly PlayerSeasonMatch[],
  excludeGameweeks: ReadonlySet<number>,
  horizonWidth: number,
): number | null {
  const appearanceRate = computeOracleAppearanceRate(playerSeasonMatches, excludeGameweeks)
  if (appearanceRate === null) return null
  const rate = computeOracleFeaturedRate(playerSeasonMatches, excludeGameweeks)
  return (rate ?? 0) * appearanceRate * horizonWidth
}

/**
 * Ticket #187. `checkOracleCeiling`'s own result shape — mirrors
 * `RankingSanityCheckResult`'s `{ ok, failures }` exactly so main() folds it
 * into the SAME combined failure gate the existing sanity checks already
 * use, no new job-status mechanism invented.
 */
export interface OracleCeilingCheckResult {
  ok: boolean
  failures: string[]
}

/**
 * Ticket #187, DoD: "The oracle sits above the model at both horizons. If it
 * does not, STOP and report rather than shipping a ceiling the model
 * exceeds — that's a finding, not a pass." A hindsight ceiling the model
 * meets or beats means the CEILING is mis-specified, not that the model
 * found headroom that does not exist (ticket #183 said so explicitly, and
 * ticket #89/#187's own history — model 0.672 vs oracle 0.507 at five
 * gameweeks, pre-fix — is exactly the shape this check exists to catch
 * automatically rather than relying on a human reading the report). `>=`,
 * not `>` alone: a tie is not "the oracle sits above the model" either. Null
 * on either side of a comparison skips it (insufficient data to compare is
 * not the same failure as a ceiling the model exceeds).
 */
export function checkOracleCeiling(
  oneGwModelSpearman: number | null,
  oneGwOracleSpearman: number | null,
  fiveGwModelSpearman: number | null,
  fiveGwOracleSpearman: number | null,
): OracleCeilingCheckResult {
  const failures: string[] = []
  if (oneGwModelSpearman !== null && oneGwOracleSpearman !== null && oneGwModelSpearman >= oneGwOracleSpearman) {
    failures.push(
      `one-gameweek quality oracle (Spearman ${oneGwOracleSpearman.toFixed(3)}) does not sit above the model (${oneGwModelSpearman.toFixed(3)}) — ` +
        'a hindsight ceiling the model meets or exceeds means the oracle is mis-specified, not that the model beat its own ceiling.',
    )
  }
  if (fiveGwModelSpearman !== null && fiveGwOracleSpearman !== null && fiveGwModelSpearman >= fiveGwOracleSpearman) {
    failures.push(
      `five-gameweek quality oracle (Spearman ${fiveGwOracleSpearman.toFixed(3)}) does not sit above the model (${fiveGwModelSpearman.toFixed(3)}) — ` +
        'same reasoning as the one-gameweek check above.',
    )
  }
  return { ok: failures.length === 0, failures }
}

// ============================================================================
// Report generation.
// ============================================================================

function fmt(n: number | null, decimals = 3): string {
  return n === null ? 'n/a' : n.toFixed(decimals)
}

/** Exported for ticket #183's own report-generation tests (byte-identical existing sections; the new five-gameweek sections) — was module-private before this ticket; this visibility change is the only edit to any pre-#183 line in this interface. */
export interface ReportData {
  generatedAt: Date
  season: string
  measured: MeasuredRow[]
  overall: ErrorSummary
  byPosition: Record<Position, ErrorSummary>
  byGameweek: Map<number, ErrorSummary>
  cleanSheetRateByPosition: Partial<Record<Position, number | null>>
  sanity: SanityCheckResult
  exclusions: ExclusionCounts
  /** Ticket #154. */
  positionResolution: PositionResolutionCounts
  defconSource: DefconSourceCounts
  /** Ticket #187. */
  recentMinutesSource: RecentMinutesSourceCounts
  recentMinutesWindowLengthDistribution: RecentMinutesWindowLengthDistribution
  featureHistoryRowsRead: number
  actualRowsMatched: number
  playersRowCount: number
  matchStatsRowCount: number
  /** Ticket #140. */
  multiFixtureByGameweek: Map<number, number>
  multiFixtureDiagnostic: MultiFixtureDiagnostic
  defconBuckets: BucketSummary[]
  overallBuckets: BucketSummary[]
  /** Ticket #147. */
  rankingSeason: SeasonRankingSummary
  rankingByPosition: Record<Position, PositionRankingSummary>
  rankingByGameweek: Map<number, GameweekRankingSummary>
  rankingSanity: RankingSanityCheckResult
  /** Ticket #159. */
  baselines: BaselineSummary[]
  baselineVerdicts: BaselineVerdict[]
  rankingByGameweekAndPosition: GameweekPositionRankingSummary[]
  /** Ticket #175. */
  fixtureCoverage: FixtureCoverageCounts
  /** Ticket #183 — the five-gameweek ranking target. See this file's "FIVE-GAMEWEEK RANKING TARGET" section. */
  fiveGameweek: FiveGameweekReportData
}

/** Ticket #183. Everything the five-gameweek section's report block needs, computed entirely in main() from data the section above already fetched — no new Supabase read. */
interface FiveGameweekReportData {
  lastGameweekInData: number
  /** How many single-gameweek `measured` rows were CANDIDATES for a five-gameweek window (== data.measured.length, repeated here so this section's own reconciliation line is self-contained). */
  candidateCount: number
  measuredCount: number
  exclusions: FiveGameweekExclusionCounts
  /** Ticket #193 — the three club-schedule fixture counters (season-wide totals across every measured row's legs). See `sumClubScheduleLegCounts`. */
  clubSchedule: ClubScheduleLegCounts
  season: SeasonRankingSummary
  byPosition: Record<Position, PositionRankingSummary>
  byStartGameweek: Map<number, GameweekRankingSummary>
  baselines: BaselineSummary[]
  baselineVerdicts: BaselineVerdict[]
  /** One-gameweek quality oracle — the SAME single-gameweek `measured` population, leaving out only the one target gameweek. */
  oracleOneGw: {
    season: SeasonRankingSummary
    byPosition: Record<Position, PositionRankingSummary>
    /** measured rows skipped because the player had no season match outside the excluded gameweek — no evidence to rank on. */
    insufficientData: number
  }
  /**
   * Ticket #197 diagnostic — REPORTED ONLY, never a check, never gates the
   * report, never compared against a threshold. The SAME one-gameweek
   * `measured` population, re-projected via the SAME `projectRow` combiner
   * with every fixture forced neutral (no `fixtureExpectedScores` argument
   * at all — `projectRow`'s own documented default, bit-for-bit the same
   * neutral construction ticket #175's coverage gate already falls back to
   * for thin-history clubs). Tests directly, on this run's own population,
   * whether the model's one-gameweek edge over the quality oracle above is
   * fixture information specifically — see docs/projection-model-backlog.md
   * G14.
   */
  oneGwNeutralFixtureModel: {
    season: SeasonRankingSummary
    byPosition: Record<Position, PositionRankingSummary>
  }
  /** Five-gameweek quality oracle — leaves out the WHOLE target window. */
  oracleFiveGw: {
    season: SeasonRankingSummary
    byPosition: Record<Position, PositionRankingSummary>
    insufficientData: number
  }
  /** Ticket #187, DoD: "the oracle sits above the model at both horizons ... if it does not, STOP and report". */
  oracleCeiling: OracleCeilingCheckResult
}

function buildPositionTable(byPosition: Record<Position, ErrorSummary>, cleanSheetRateByPosition: Partial<Record<Position, number | null>>): string {
  const header = '| Position | n | Mean absolute error | Mean signed error | Derived clean-sheet rate |\n|---|---|---|---|---|'
  const rows = POSITIONS.map((position) => {
    const s = byPosition[position]
    const rate = cleanSheetRateByPosition[position] ?? null
    return `| ${POSITION_NAMES[position]} | ${s.n} | ${fmt(s.meanAbsoluteError)} | ${fmt(s.meanSignedError)} | ${rate === null ? 'n/a' : `${(rate * 100).toFixed(1)}%`} |`
  })
  return [header, ...rows].join('\n')
}

/** The fixture-count column (ticket text) is how many of that gameweek's measured player-gameweeks had more than one fixture — 0 for an ordinary gameweek, >0 flags a candidate double gameweek. */
function buildGameweekTable(byGameweek: Map<number, ErrorSummary>, multiFixtureByGameweek: Map<number, number>): string {
  const header = '| Gameweek | n | Mean absolute error | Mean signed error | Multi-fixture rows |\n|---|---|---|---|---|'
  const rows = [...byGameweek.entries()].map(
    ([gw, s]) => `| ${gw} | ${s.n} | ${fmt(s.meanAbsoluteError)} | ${fmt(s.meanSignedError)} | ${multiFixtureByGameweek.get(gw) ?? 0} |`,
  )
  return [header, ...rows].join('\n')
}

function buildBucketTable(buckets: readonly BucketSummary[]): string {
  const header = '| prior_matches | n | Mean signed error |\n|---|---|---|'
  const rows = buckets.map((b) => `| ${b.label} | ${b.n} | ${b.tooSmallToRead ? 'too small to read' : fmt(b.meanSignedError)} |`)
  return [header, ...rows].join('\n')
}

// Ticket #147 — ranking-skill formatting.

function fmtSpearman(value: number | null): string {
  return value === null ? 'n/a' : value.toFixed(3)
}

function fmtTopN(topN: TopNOverlap | null): string {
  if (topN === null || topN.n === 0) return 'n/a'
  return `${topN.overlap} of ${topN.n} (${((topN.overlap / topN.n) * 100).toFixed(1)}%)`
}

/** Ticket #159, Defect 2: "too small to read" when refused (N too large a fraction of its own population), distinct from fmtTopN's plain "n/a" for genuinely zero rows. */
function fmtTopNOrRefused(topN: TopNOverlap, refused: boolean): string {
  return refused ? 'too small to read' : fmtTopN(topN)
}

function buildRankingPositionTable(byPosition: Record<Position, PositionRankingSummary>): string {
  const header = '| Position | n | Spearman | Top-10 overlap | Top-20 overlap |\n|---|---|---|---|---|'
  const rows = POSITIONS.map((position) => {
    const s = byPosition[position]
    return `| ${POSITION_NAMES[position]} | ${s.n} | ${fmtSpearman(s.spearman)} | ${fmtTopNOrRefused(s.top10, s.top10Refused)} | ${fmtTopNOrRefused(s.top20, s.top20Refused)} |`
  })
  return [header, ...rows].join('\n')
}

// Ticket #159 — naive-baseline and gameweek×position formatting.

function buildBaselineSpearmanTable(
  modelSeasonSpearman: number | null,
  modelByPosition: Record<Position, PositionRankingSummary>,
  baselines: readonly BaselineSummary[],
): string {
  const header = '| Ranking | Season | Goalkeeper | Defender | Midfielder | Forward |\n|---|---|---|---|---|---|'
  const row = (label: string, seasonSpearman: number | null, byPosition: Record<Position, number | null>): string =>
    `| ${label} | ${fmtSpearman(seasonSpearman)} | ${POSITIONS.map((p) => fmtSpearman(byPosition[p])).join(' | ')} |`
  const modelByPositionSpearman: Record<Position, number | null> = Object.fromEntries(
    POSITIONS.map((p) => [p, modelByPosition[p].spearman]),
  ) as Record<Position, number | null>
  const modelRow = row('Model (projection)', modelSeasonSpearman, modelByPositionSpearman)
  const baselineRows = baselines.map((b) => row(b.label, b.seasonSpearman, b.byPosition))
  return [header, modelRow, ...baselineRows].join('\n')
}

function buildBaselineVerdictLines(verdicts: readonly BaselineVerdict[]): string {
  return verdicts
    .map(
      (v) =>
        `- Model (${fmtSpearman(v.modelSpearman)}) minus ${v.label} (${fmtSpearman(v.baselineSpearman)}) = **${v.delta === null ? 'n/a' : v.delta.toFixed(3)}**`,
    )
    .join('\n')
}

function buildGameweekPositionTable(rows: readonly GameweekPositionRankingSummary[]): string {
  const header = '| Gameweek | Position | n | Top-10 overlap | Top-20 overlap |\n|---|---|---|---|---|'
  const body = rows.map(
    (r) =>
      `| ${r.gameweekId} | ${POSITION_NAMES[r.position]} | ${r.n} | ${fmtTopNOrRefused(r.top10, r.top10Refused)} | ${fmtTopNOrRefused(r.top20, r.top20Refused)} |`,
  )
  return [header, ...body].join('\n')
}

function buildRankingGameweekTable(byGameweek: Map<number, GameweekRankingSummary>): string {
  const header = '| Gameweek | n | Spearman | Top-10 overlap | Top-20 overlap |\n|---|---|---|---|---|'
  const rows = [...byGameweek.entries()].map(([gameweekId, s]) =>
    s.tooSmallToRead
      ? `| ${gameweekId} | ${s.n} | too small to read | too small to read | too small to read |`
      : `| ${gameweekId} | ${s.n} | ${fmtSpearman(s.spearman)} | ${fmtTopN(s.top10)} | ${fmtTopN(s.top20)} |`,
  )
  return [header, ...rows].join('\n')
}

function componentMean(rows: readonly MeasuredRow[], pick: (c: ComponentTotals) => number, source: 'projected' | 'actual'): number | null {
  if (rows.length === 0) return null
  const total = rows.reduce((sum, r) => sum + pick(source === 'projected' ? r.projectedComponents : r.actualComponents), 0)
  return total / rows.length
}

function buildComponentTable(rows: readonly MeasuredRow[]): string {
  const labels: Array<[keyof ComponentTotals, string]> = [
    ['appearancePoints', 'Appearance'],
    ['goalPoints', 'Goals'],
    ['assistPoints', 'Assists'],
    ['cleanSheetPoints', 'Clean sheets'],
    ['goalsConcededPoints', 'Goals conceded'],
    ['savePoints', 'Saves'],
    ['defensiveContributionPoints', 'Defensive contribution'],
  ]
  const header = '| Component | Mean actual | Mean projected | Mean signed error |\n|---|---|---|---|'
  const body = labels
    .map(([key, label]) => {
      const actual = componentMean(rows, (c) => c[key], 'actual')
      const projected = componentMean(rows, (c) => c[key], 'projected')
      const signed = actual === null || projected === null ? null : projected - actual
      return `| ${label} | ${fmt(actual)} | ${fmt(projected)} | ${fmt(signed)} |`
    })
    .join('\n')
  return [header, body].join('\n')
}

/** Exported for ticket #183's own "existing report is byte-identical" test — was module-private before this ticket; this visibility change is the only edit to any pre-#183 line touching this function. */
export function generateReportMarkdown(data: ReportData): string {
  const sections: string[] = []

  sections.push(
    '# Backtest report — point-in-time projection vs actual\n\n' +
      `Generated: ${data.generatedAt.toISOString()} · Job: \`${JOB_NAME}\` · Season: \`${data.season}\`\n\n` +
      'Measures the projection only — no transfers, captaincy, solver, or league position (item 32\'s remaining ' +
      'work). Every projected figure below is built strictly from `feature_history` prior-gameweek totals — no ' +
      'later gameweek, no live current-season data. See `scripts/run-backtest.ts`\'s file header for the full ' +
      'method and its documented approximations, and `docs/projection-model-backlog.md` for what this slice does ' +
      'and does not settle.',
  )

  sections.push(
    (data.sanity.ok ? '## Sanity check: PASSED\n\n' : '## Sanity check: FAILED\n\n') +
      (data.sanity.ok
        ? 'Overall mean absolute error and every position\'s derived clean-sheet rate are within their sane bounds.'
        : `**${data.sanity.failures.length} bound(s) failed — this means the HARNESS is wrong, not necessarily the model:**\n\n` +
          data.sanity.failures.map((f) => `- ${f}`).join('\n')),
  )

  sections.push(
    '## Headline\n\n' +
      `Measured population: **${data.overall.n}** player-gameweek row(s). Mean absolute error: **${fmt(data.overall.meanAbsoluteError)}**. ` +
      `Mean signed error: **${fmt(data.overall.meanSignedError)}** — ${describeSignedError(data.overall.meanSignedError)}.`,
  )

  sections.push(
    '## The measured population, and what is excluded\n\n' +
      `- \`feature_history\` rows read (season=${data.season}): ${data.featureHistoryRowsRead}\n` +
      `- rows with a matching \`player_match_stats\` actual gameweek entry found: ${data.actualRowsMatched}\n` +
      `- **rows measured (headline population)**: ${data.measured.length}\n` +
      `- excluded — no prior matches (\`prior_matches = 0\`, no point-in-time signal): ${data.exclusions.noPriorMatches}\n` +
      `- excluded — player did not feature this gameweek (a correct zero that would flatter the error): ${data.exclusions.didNotFeature}\n` +
      `- excluded — blank gameweek (player's team had no fixture at all, ticket #140): ${data.exclusions.blankGameweek}\n` +
      `- excluded — actual data incomplete (\`team_goals_conceded\` null, ~2% known gap, ticket #125): ${data.exclusions.actualDataIncomplete}\n` +
      `- excluded — unresolved position (neither \`feature_history.element_type\` nor the \`players\` fallback resolves, ticket #154): ${data.exclusions.unresolvedPlayerCode} ` +
      `(${formatExclusionPercentage(data.exclusions.unresolvedPlayerCode, data.featureHistoryRowsRead)} of rows read)\n` +
      `- excluded — unresolved fixture teams (own club or the opponent faced could not be resolved, ticket #175 — chiefly mid-season transfers, see that ticket's own note): ${data.exclusions.unresolvedFixtureTeams} ` +
      `(${formatExclusionPercentage(data.exclusions.unresolvedFixtureTeams, data.featureHistoryRowsRead)} of rows read)\n\n` +
      `Reconciliation: ${data.measured.length} measured + ${totalExcluded(data.exclusions)} excluded = ` +
      `${data.measured.length + totalExcluded(data.exclusions)}, against ${data.featureHistoryRowsRead} rows read.`,
  )

  sections.push(
    '## Fixture coverage (ticket #175)\n\n' +
      'Before this ticket, every measured row below was projected under a neutral fixture ' +
      '(expectedScore exactly 0.5, every multiplier exactly 1.0) — the harness could not see which ' +
      'team a player faced. This ticket reads `feature_history.team_code` (the player\'s own club) ' +
      'and `player_match_stats.opponent_team_code` (the club faced) and builds a point-in-time ' +
      'team-strength table from `player_match_stats` rows strictly before the row being projected — ' +
      'see `scripts/run-backtest.ts`\'s file header for the construction and its SCALE constant. A ' +
      `team below ${MIN_TEAM_PRIOR_MATCHES} prior matches (a JUDGEMENT call, not derived) falls back ` +
      'to the same neutral expectedScore every row used before this ticket — a genuinely resolvable ' +
      'club with too little history yet, never an unresolved one (which is excluded separately ' +
      'above, never silently defaulted to neutral).\n\n' +
      `- measured rows that used a real, computed fixture: ${data.fixtureCoverage.realFixture}\n` +
      `- measured rows that fell back to the neutral fixture (insufficient prior team history): ${data.fixtureCoverage.neutralFallback}\n`,
  )

  sections.push(
    '## Position resolution and defensive-contribution evidence (ticket #154)\n\n' +
      'Ticket #146 added `element_type` and the two per-match defcon counters to `feature_history`; this is the ' +
      'first slice to read them. Position resolution is a strict 3-way partition of every row read; defcon-evidence ' +
      'source is a strict 2-way partition of the same population (not only the measured rows below — ' +
      '`buildDefconMatches` also runs for excluded rows via the position-prior computation).\n\n' +
      `- position from \`feature_history.element_type\` (primary source): ${data.positionResolution.fromElementType}\n` +
      `- position from the \`players\` table fallback (row predates ticket #146): ${data.positionResolution.fromPlayersFallback}\n` +
      `- position unresolved (neither source — excluded as \`unresolvedPlayerCode\` above): ${data.positionResolution.unresolved}\n` +
      `- defensive-contribution evidence from stored \`prior_defcon_qualifying_matches\`/\`prior_defcon_hits\` counters: ${data.defconSource.fromStoredCounters}\n` +
      `- defensive-contribution evidence from the pre-#154 single-averaged-match fallback (row predates ticket #146): ${data.defconSource.fromAveragedFallback}\n`,
  )

  sections.push('## By position\n\n' + buildPositionTable(data.byPosition, data.cleanSheetRateByPosition))

  sections.push(
    '## By gameweek\n\n' +
      'A bad week is visible here rather than averaged away into the season figure above. "Multi-fixture rows" is ' +
      'how many of that gameweek\'s measured player-gameweeks had more than one fixture (ticket #140) — a nonzero ' +
      'value flags a candidate double gameweek.\n\n' +
      buildGameweekTable(data.byGameweek, data.multiFixtureByGameweek),
  )

  sections.push(
    '## Multi-fixture gameweeks (ticket #140)\n\n' +
      `Player-gameweeks with more than one fixture: **${data.multiFixtureDiagnostic.multiFixtureCount}** of ${data.measured.length} measured.\n\n` +
      `- Season headline WITH multi-fixture rows (the figure above): n=${data.multiFixtureDiagnostic.withMultiFixture.n}, ` +
      `MAE=${fmt(data.multiFixtureDiagnostic.withMultiFixture.meanAbsoluteError)}, ` +
      `mean signed error=${fmt(data.multiFixtureDiagnostic.withMultiFixture.meanSignedError)}\n` +
      `- Season headline WITHOUT multi-fixture rows: n=${data.multiFixtureDiagnostic.withoutMultiFixture.n}, ` +
      `MAE=${fmt(data.multiFixtureDiagnostic.withoutMultiFixture.meanAbsoluteError)}, ` +
      `mean signed error=${fmt(data.multiFixtureDiagnostic.withoutMultiFixture.meanSignedError)}\n\n` +
      (data.multiFixtureDiagnostic.movesHeadlineSignificantly
        ? `**Excluding multi-fixture player-gameweeks moves the season MAE by ${fmt(data.multiFixtureDiagnostic.maeDelta)} — ` +
          `more than the ${MULTI_FIXTURE_HEADLINE_THRESHOLD} threshold. This is worth reading before trusting the headline as-is.**`
        : `Excluding multi-fixture player-gameweeks moves the season MAE by ${fmt(data.multiFixtureDiagnostic.maeDelta)} — ` +
          `within the ${MULTI_FIXTURE_HEADLINE_THRESHOLD} threshold, not a material driver of the headline on its own.`),
  )

  sections.push(
    '## Defensive-contribution signed error, by prior_matches bucket (ticket #140)\n\n' +
      'Full-season calibration can look correct while point-in-time estimation shrinks hard toward the position ' +
      'prior early in a player\'s history — this table is what tells a cold-start problem (shrinks toward 0 as the ' +
      'bucket rises) apart from a level problem (stays flat). A bucket under ' +
      `${MIN_BUCKET_SAMPLE_SIZE} measured rows is reported as "too small to read", never as a number nobody checked.\n\n` +
      buildBucketTable(data.defconBuckets),
  )

  sections.push(
    '## Overall signed error, by prior_matches bucket (ticket #140)\n\n' +
      'The same bucketing applied to the overall signed error, for comparison against the defcon-only breakdown ' +
      'above.\n\n' +
      buildBucketTable(data.overallBuckets),
  )

  sections.push(
    '## By component\n\n' +
      'Mean actual vs mean projected per component, across the measured population — attributes a gap in the ' +
      'headline to a specific term rather than leaving it only visible in aggregate. Bonus is absent from both ' +
      'sides (see file header) rather than shown as an always-zero row.\n\n' +
      buildComponentTable(data.measured),
  )

  sections.push(
    '## Ranking skill (ticket #147)\n\n' +
      'The metrics above measure how close the model\'s numbers are; this measures whether it puts ' +
      'the right players at the top — the only thing a recommendation actually depends on (the ' +
      'captain IS the squad\'s top-projected player; a transfer IS a claim one player will outscore ' +
      'another). Same measured population as above, no new Supabase read. **Spearman rank ' +
      'correlation** ranks projected and actual points among the same set of rows (tied values share ' +
      'the average rank they would occupy) and reports how well the two orderings agree — 1 is ' +
      'perfect agreement, −1 is perfect reversal, 0 is no relationship. **Top-N overlap** is closer to ' +
      'what the app actually does: of the players ranked in the model\'s top 10 (or top 20) that ' +
      'gameweek, how many were also in the actual top 10 (or top 20). See ' +
      '`docs/projection-model-backlog.md` for what this section does and does not settle — no ' +
      'conclusion about whether the ranking is good is drawn here.',
  )

  sections.push(
    (data.rankingSanity.ok ? '### Ranking sanity check: PASSED\n\n' : '### Ranking sanity check: FAILED\n\n') +
      (data.rankingSanity.ok
        ? 'The season aggregate and every position\'s Spearman correlation and top-10 overlap are within their sane bounds.'
        : `**${data.rankingSanity.failures.length} bound(s) failed — this means the HARNESS is wrong, not necessarily the model ` +
          `(a suspiciously good correlation is the shape a lookahead leak takes):**\n\n` +
          data.rankingSanity.failures.map((f) => `- ${f}`).join('\n')),
  )

  sections.push(
    '### Season aggregate\n\n' +
      `- Spearman rank correlation: **${fmtSpearman(data.rankingSeason.spearman)}** (n=${data.rankingSeason.n})\n` +
      `- Top-10 overlap: **${fmtTopN(data.rankingSeason.top10)}**\n` +
      `- Top-20 overlap: **${fmtTopN(data.rankingSeason.top20)}**\n\n` +
      'Top-10/20 figures are summed across every gameweek with at least ' +
      `${MIN_BUCKET_SAMPLE_SIZE} measured rows (the same threshold the by-gameweek table below applies) — ` +
      'a season-wide overlap RATE, not a single top-10 selected from the whole season pooled together.',
  )

  sections.push(
    '### By position\n\n' +
      'A captain is chosen across positions, but a transfer is usually within one — Spearman is ' +
      'pooled across the whole season for that position (like the by-position table above); top-N ' +
      'overlap is summed across every gameweek that position appears in, uncapped by the 50-row ' +
      'gameweek gate (a per-gameweek goalkeeper population is often under 50 by construction).\n\n' +
      buildRankingPositionTable(data.rankingByPosition),
  )

  sections.push(
    '### By gameweek\n\n' +
      `A gameweek with fewer than ${MIN_BUCKET_SAMPLE_SIZE} measured rows is reported "too small to ` +
      'read" rather than as a correlation nobody could trust.\n\n' +
      buildRankingGameweekTable(data.rankingByGameweek),
  )

  sections.push(
    '### By gameweek × position (ticket #159, Defect 3)\n\n' +
      'The finest grain this report prints — the only place the Defender/Midfielder identical-overlap ' +
      'observation noted in this ticket\'s decisions file is distinguishable on the next run (not asserted ' +
      'as a bug here). Not gated by the 50-row gameweek threshold above (a per-gameweek, per-position ' +
      'population, goalkeepers especially, is routinely under 50 by construction); IS gated by the ' +
      `top-N-meaningfulness check directly below.\n\n` +
      buildGameweekPositionTable(data.rankingByGameweekAndPosition),
  )

  sections.push(
    '## Naive ranking baselines (ticket #159, Defect 1)\n\n' +
      'The season Spearman above has no comparator on its own — an absolute band was previously asserted ' +
      'from general intuition, not derived from anything about weekly FPL scoring. These three baselines ' +
      'are computed over the EXACT SAME measured population as the model\'s own ranking above (no separate ' +
      'population, no second Supabase read, and never `players.now_cost` — a 2026/27 price would be both a ' +
      'cross-season mismatch and a lookahead against these 2025/26 gameweeks). A model with real skill ' +
      'should beat them; one that does not is decoration, not signal.\n\n' +
      `- **${PRIOR_MINUTES_PER_MATCH_BASELINE_LABEL}** (\`prior_minutes / prior_matches\`) — the player who has played the most, stays.\n` +
      `- **${PRIOR_XG_XA_PER_MATCH_BASELINE_LABEL}** (\`(prior_xg + prior_xa) / prior_matches\`) — the player with the best underlying attacking numbers, stays.\n` +
      `- **${CONSTANT_BASELINE_LABEL}** — every row ranked identically; the zero-skill floor, and a self-test ` +
      'of the correlation code itself (an implementation that scores a constant ranking WELL, rather than at ' +
      'exactly 0, is broken — see `computeConstantBaselineSpearman`).\n\n' +
      buildBaselineSpearmanTable(data.rankingSeason.spearman, data.rankingByPosition, data.baselines),
  )

  sections.push(
    '### Verdict — model Spearman minus each baseline\'s (season aggregate)\n\n' +
      'A DIFFERENCE, never checked against an asserted threshold (ticket text) — the report states the ' +
      'number and stops there.\n\n' +
      buildBaselineVerdictLines(data.baselineVerdicts),
  )

  sections.push(
    '## Provenance\n\n' +
      `- players rows fetched: ${data.playersRowCount}\n` +
      `- feature_history rows fetched (season=${data.season}): ${data.featureHistoryRowsRead}\n` +
      `- player_match_stats rows fetched (season=${data.season}, competition=${PREMIER_LEAGUE_COMPETITION}): ${data.matchStatsRowCount}\n` +
      `- sanity bounds: mean absolute error in [${MAE_LOWER_BOUND}, ${MAE_UPPER_BOUND}]; derived clean-sheet rate ≤ ${(CLEAN_SHEET_RATE_UPPER_BOUND * 100).toFixed(0)}% per position\n` +
      `- ranking sanity bounds (#147, extended by #159 to top-20): Spearman rank correlation in [${SPEARMAN_LOWER_BOUND}, ${SPEARMAN_UPPER_BOUND}]; top-10 AND top-20 overlap ≤ ${(TOP10_OVERLAP_UPPER_BOUND_FRACTION * 100).toFixed(0)}%, at the season aggregate and every position\n` +
      `- top-N meaningfulness threshold (#159): a top-N figure is refused ("too small to read") when N exceeds ${(TOP_N_MAX_POPULATION_FRACTION * 100).toFixed(0)}% of the population it was drawn from — a judgement, not a derived bound\n`,
  )

  // Ticket #183 — appended strictly AFTER every section above. Nothing above
  // this line is touched by this push; the existing report is byte-identical
  // for the same ReportData (see this file's own test).
  sections.push(...buildFiveGameweekSections(data))

  // Ticket #187 — appended strictly AFTER the five-gameweek section above,
  // for the identical reason (nothing above this line touched; the report
  // through the end of the five-gameweek section stays byte-identical for
  // the same ReportData).
  sections.push(buildRecentMinutesEvidenceSection(data))

  return sections.join('\n\n') + '\n'
}

/** Ticket #187. Renders the window-length histogram as a markdown table, sorted ascending by length. */
function buildRecentMinutesWindowLengthTable(distribution: RecentMinutesWindowLengthDistribution): string {
  const lengths = Object.keys(distribution)
    .map(Number)
    .sort((a, b) => a - b)
  const header = '| Window length | Rows |\n|---|---|'
  if (lengths.length === 0) return header + '\n| (no rows read) | — |'
  const rows = lengths.map((length) => `| ${length} | ${distribution[length]} |`).join('\n')
  return [header, rows].join('\n')
}

/**
 * Ticket #187. `buildRecentMinutes`'s source-partition and window-length
 * counters — see this section's own definitions (`RecentMinutesSourceCounts`,
 * `RecentMinutesWindowLengthDistribution`) for what each counts and why.
 * Counted over every `feature_history` row read (not only the measured
 * population below), mirroring the defcon-evidence partition above exactly.
 */
function buildRecentMinutesEvidenceSection(data: ReportData): string {
  return (
    '## Minutes evidence (ticket #187)\n\n' +
    'Ticket #185 stored `prior_recent_minutes` — this player\'s true last-five-match minutes window, ' +
    "most-recent-first, strictly before this row's own gameweek — and this is the first ticket to read it: " +
    '`buildRecentMinutes` now returns that stored window unmodified, in place of the pre-#187 ' +
    "single-averaged-match approximation every projection below (and every measured row's own projection " +
    'above) previously received. Source is a strict 2-way partition of every row read, mirroring the ' +
    'defensive-contribution-evidence partition above.\n\n' +
    `- minutes evidence from the stored \`prior_recent_minutes\` window (ticket #185/#187): ${data.recentMinutesSource.fromStoredWindow}\n` +
    '- minutes evidence from the pre-#185 single-averaged-match fallback (row predates the #185 migration, or was ' +
    `never rebuilt after it landed — expect this near zero; a large count means #185's rebuild did not land and ` +
    `this run should be read as suspect): ${data.recentMinutesSource.fromAveragedFallback}\n\n` +
    '**Window-length distribution** — the array length `buildRecentMinutes` actually returned (0–5 for the ' +
    'stored window, 0–1 for the averaged fallback):\n\n' +
    buildRecentMinutesWindowLengthTable(data.recentMinutesWindowLengthDistribution) +
    '\n\n**What this run cannot be compared against**: mean absolute error, signed error, and every component ' +
    'figure in every section above move once this fix lands — each measured row now receives a different ' +
    'projection than any previous run. This is that fix working, not a regression; reports before and after ' +
    'ticket #187 are not comparable to each other.'
  )
}

/**
 * Ticket #183. Builds the five-gameweek ranking target's own report
 * sections — the model's ranking, the three naive baselines and their
 * verdicts, and the quality oracle at both horizons. Every table below is
 * built by the SAME formatting functions the one-gameweek section above
 * uses (buildRankingPositionTable/buildRankingGameweekTable/
 * buildBaselineSpearmanTable/buildBaselineVerdictLines/fmtSpearman/fmtTopN),
 * unmodified — see this file's "FIVE-GAMEWEEK RANKING TARGET" section header
 * for why that reuse is safe (summarizeGenericRankingBy* return the exact
 * same types).
 */
function buildFiveGameweekSections(data: ReportData): string[] {
  const fg = data.fiveGameweek
  const sections: string[] = []

  sections.push(
    '## Five-gameweek ranking (ticket #183)\n\n' +
      `The app plans over a **${FIVE_GAMEWEEK_HORIZON}-gameweek** horizon (\`build-solver-input.ts\`'s ` +
      "`decay_base`/`ft_value_list`; `scripts/project-points.ts`'s own `PROJECTION_HORIZON = 5`) — every " +
      'figure above measures only one gameweek. `docs/model-review-2026-09-02.md` found the one-gameweek ' +
      'ranking section above is nearly saturated (its own quality oracle reaches only ~0.33 there — see the ' +
      'oracle section below), so it has little room left to show any future model change; the five-gameweek ' +
      'totals below are the horizon the solver actually optimises, and are the primary ranking figure this ' +
      'project should read going forward, not the one-gameweek section above (which stays exactly as it was — ' +
      'nothing above this heading changed). Same measured single-gameweek population feeds every window below ' +
      '(no new Supabase read): for each starting gameweek, the model\'s own projections at gameweeks ' +
      "G..G+4 are summed (never one projection × 5 — each leg is built from THAT gameweek's own " +
      'strictly-before `feature_history` row), and compared against the sum of actual points over the same ' +
      'five gameweeks (0 for a gameweek the player did not feature in — the risk a five-gameweek transfer ' +
      'decision genuinely carries, not excluded). **Ticket #193**: each leg\'s fixture COUNT and OPPONENT(s) ' +
      'now come from the club\'s published schedule at that leg\'s own gameweek, never from whether this ' +
      'player personally has a matching actual row that gameweek — see the diagnostics subsection below.',
  )

  sections.push(
    '### Population, truncated windows, and reconciliation\n\n' +
      `- last gameweek this run's \`feature_history\` read covers: **${fg.lastGameweekInData}**\n` +
      `- single-gameweek measured rows (the candidate population for a five-gameweek window): ${fg.candidateCount}\n` +
      `- excluded — **truncated window** (starting gameweek + 4 exceeds gameweek ${fg.lastGameweekInData}, i.e. a starting gameweek ` +
      `above ${fg.lastGameweekInData - FIVE_GAMEWEEK_HORIZON + 1} — excluded rather than reported as a shorter sum, per ` +
      `\`docs/model-review-2026-09-02.md\`'s own R2 rule): ${fg.exclusions.truncatedWindow}\n` +
      `- excluded — the window's START gameweek \`feature_history\` row was missing (every leg is built from it, never from the leg's own row — see \`projectAndReconstructWindowGameweek\`; should not occur at all, since a candidate row is by construction a measured row at that same gameweek): ${fg.exclusions.missingFeatureHistoryRow}\n` +
      `- excluded — the position on the window's START gameweek row could not be resolved: ${fg.exclusions.unresolvedPosition}\n` +
      `- excluded — the window's START gameweek row had no \`team_code\` (ticket #193 — every leg shares this one row's club, so its absence means the club schedule cannot be resolved for the whole window): ${fg.exclusions.unresolvedTeamCode}\n` +
      `- excluded — a window leg's actual data was incomplete (\`team_goals_conceded\` unknown, the same ~2% gap the section above excludes for, re-applied per leg): ${fg.exclusions.actualDataIncomplete}\n` +
      `- **five-gameweek rows measured**: ${fg.measuredCount}\n\n` +
      `Reconciliation: ${fg.measuredCount} measured + ${totalFiveGameweekExcluded(fg.exclusions)} excluded = ` +
      `${fg.measuredCount + totalFiveGameweekExcluded(fg.exclusions)}, against ${fg.candidateCount} single-gameweek measured rows as candidates.`,
  )

  sections.push(
    '### Club-schedule fixture diagnostics (ticket #193)\n\n' +
      'Counted across every MEASURED five-gameweek row\'s four G+1..G+4 legs (never the G leg — its fixture ' +
      'count comes from the already-correct single-gameweek path above, and by construction that leg already ' +
      'featured, since the single-gameweek section excludes non-featuring rows outright).\n\n' +
      `- legs whose fixture count came from the club schedule (the schedule had at least one entry that gameweek): ${fg.clubSchedule.legsWithScheduleFixture}\n` +
      `- legs where the club had **no** scheduled fixture that gameweek (a genuine blank gameweek — 0 fixtures, a legitimate zero on both sides, never a defect): ${fg.clubSchedule.legsBlankGameweek}\n` +
      `- legs where the club **did** have a scheduled fixture but the player did not feature in it — **this is the exact size of the leak this ticket closes**: ${fg.clubSchedule.legsDidNotFeatureButClubHadFixture}\n\n` +
      'APPROXIMATION, stated not hidden (mirrors `docs/projection-model-backlog.md` G10\'s own team-slug ' +
      'caveat): the published schedule above is reconstructed from matches that were actually PLAYED — this ' +
      'job has no independent fixture-schedule table for a past season. A fixture postponed after its horizon ' +
      'began is therefore indistinguishable from a club that never had one; both read as a blank gameweek ' +
      'above. Not a defect to fix here.',
  )

  sections.push(
    '### Season aggregate\n\n' +
      `- Spearman rank correlation: **${fmtSpearman(fg.season.spearman)}** (n=${fg.season.n})\n` +
      `- Top-10 overlap: **${fmtTopN(fg.season.top10)}**\n` +
      `- Top-20 overlap: **${fmtTopN(fg.season.top20)}**`,
  )

  sections.push('### By position\n\n' + buildRankingPositionTable(fg.byPosition))

  sections.push(
    '### By starting gameweek\n\n' +
      '"Gameweek" in this table means the WINDOW\'S STARTING gameweek (its own actual/projected totals cover ' +
      `that gameweek and the next four). Same ${MIN_BUCKET_SAMPLE_SIZE}-row "too small to read" gate the ` +
      'one-gameweek section\'s own by-gameweek table applies.\n\n' +
      buildRankingGameweekTable(fg.byStartGameweek),
  )

  sections.push(
    '### Naive ranking baselines\n\n' +
      'The same three baselines as the one-gameweek section above, computed the same way (ticket text: ' +
      '"the same prior quantity ranked against the five-gameweek actual total") — `prior_minutes / prior_matches` ' +
      'and `(prior_xg + prior_xa) / prior_matches`, both taken at the WINDOW\'S STARTING gameweek and ranked ' +
      'here against the five-gameweek actual total, plus the constant zero-skill floor.\n\n' +
      buildBaselineSpearmanTable(fg.season.spearman, fg.byPosition, fg.baselines),
  )

  sections.push(
    '### Verdict — model Spearman minus each baseline\'s (season aggregate)\n\n' +
      'A DIFFERENCE, never checked against an asserted threshold — same rule as the one-gameweek verdict above.\n\n' +
      buildBaselineVerdictLines(fg.baselineVerdicts),
  )

  sections.push(
    '### Quality oracle — a hindsight ceiling, not a target\n\n' +
      "Each player's \"quality\" is built from every one of HIS season's actual matches OUTSIDE the target " +
      'window — never inside it — then ranked against the same actual target the model and baselines above ' +
      'are ranked against. **This is a hindsight ceiling, computed from results a real decision could never ' +
      'see in advance. No model can be expected to reach it, and nothing in this project should be tuned ' +
      'toward it** — it exists only to show how much ranking headroom remains once the model\'s own numbers ' +
      'are compared to it, at both horizons.\n\n' +
      '**Ticket #187 fixed a units mismatch here.** The one-gameweek oracle below is his out-of-window ' +
      'points-per-match RATE, which already matches a single gameweek\'s own units. The five-gameweek target ' +
      'is a TOTAL, not a rate, and a five-gameweek total is dominated by how many of those five gameweeks the ' +
      'player actually features in — a rate estimator scored against a totals target is handicapped by ' +
      'construction, regardless of how good the rate itself is. The five-gameweek oracle below is instead a ' +
      'TOTAL: his out-of-window points-per-FEATURED-gameweek rate × his out-of-window appearance rate × the ' +
      `${FIVE_GAMEWEEK_HORIZON}-gameweek horizon — both factors leak-guarded identically to the rate above (see ` +
      '`computeOracleFeaturedRate`/`computeOracleAppearanceRate` in `scripts/run-backtest.ts`), so an oracle ' +
      'that already knows a player\'s true season-long numbers still cannot see whether he happens to feature ' +
      'inside THIS particular five-gameweek window.\n\n' +
      `- one-gameweek oracle, season: Spearman **${fmtSpearman(fg.oracleOneGw.season.spearman)}** (n=${fg.oracleOneGw.season.n}), ` +
      `top-10 overlap **${fmtTopN(fg.oracleOneGw.season.top10)}**, top-20 overlap **${fmtTopN(fg.oracleOneGw.season.top20)}** ` +
      `(${fg.oracleOneGw.insufficientData} row(s) skipped — no season match outside the single target gameweek to rank on)\n` +
      `- five-gameweek oracle, season: Spearman **${fmtSpearman(fg.oracleFiveGw.season.spearman)}** (n=${fg.oracleFiveGw.season.n}), ` +
      `top-10 overlap **${fmtTopN(fg.oracleFiveGw.season.top10)}**, top-20 overlap **${fmtTopN(fg.oracleFiveGw.season.top20)}** ` +
      `(${fg.oracleFiveGw.insufficientData} row(s) skipped — no season match outside the five-gameweek target window to rank on)\n\n` +
      '#### One-gameweek oracle, by position\n\n' +
      buildRankingPositionTable(fg.oracleOneGw.byPosition) +
      '\n\n#### Five-gameweek oracle, by position\n\n' +
      buildRankingPositionTable(fg.oracleFiveGw.byPosition),
  )

  sections.push(
    (fg.oracleCeiling.ok ? '### Oracle-ceiling check: PASSED\n\n' : '### Oracle-ceiling check: FAILED\n\n') +
      (fg.oracleCeiling.ok
        ? 'The quality oracle sits above the model at both horizons, as a hindsight ceiling must — see ' +
          '`checkOracleCeiling` in `scripts/run-backtest.ts`.'
        : `**${fg.oracleCeiling.failures.length} check(s) failed — a model that meets or beats its own hindsight ` +
          'ceiling means the CEILING is mis-specified, not that the model found real headroom. This is a ' +
          'finding to investigate, not a result to quote:**\n\n' +
          fg.oracleCeiling.failures.map((f) => `- ${f}`).join('\n')),
  )

  sections.push(
    '### Diagnostic (ticket #197): one-gameweek model with every fixture forced neutral\n\n' +
      'REPORTED ONLY — never a check, never gates this report, never asserted (see ' +
      '`docs/projection-model-backlog.md` G14). Same one-gameweek measured population and the SAME `projectRow` ' +
      'combiner as the "Ranking skill" section above, called a second time per row with no ' +
      '`fixtureExpectedScores` argument at all — `projectRow`\'s own documented default, bit-for-bit the same ' +
      'neutral construction ticket #175\'s own coverage gate already falls back to for thin-history clubs (every ' +
      'multiplier exactly 1.0). Tests directly, on this run\'s own population, whether the model\'s one-gameweek ' +
      'edge over the quality oracle above is fixture information specifically — compare the by-position table ' +
      'below against "Ranking skill" → "By position" above (the model as actually run) and the one-gameweek ' +
      'oracle by-position table above (which sees no fixture information at all, by construction).\n\n' +
      `- season: Spearman **${fmtSpearman(fg.oneGwNeutralFixtureModel.season.spearman)}** (n=${fg.oneGwNeutralFixtureModel.season.n}) ` +
      `— for comparison, the model as actually run above scores **${fmtSpearman(data.rankingSeason.spearman)}** and the ` +
      `one-gameweek oracle above scores **${fmtSpearman(fg.oracleOneGw.season.spearman)}**\n\n` +
      buildRankingPositionTable(fg.oneGwNeutralFixtureModel.byPosition),
  )

  return sections
}

// ============================================================================
// Main
// ============================================================================

interface PlayerRow {
  code: number | null
  element_type: number
}

/** Exported for ticket #183's own window-leg tests (projectAndReconstructWindowGameweek's `actualRows` parameter is this exact type) — was module-private before this ticket. */
export interface ActualSourceRow {
  player_code: number | null
  /** Ticket #140 — read only for team-slug inference (blank-gameweek detection); never used for point reconstruction. See file header, "BLANK GAMEWEEKS". */
  match_id: string
  gameweek: number
  minutes_played: number | null
  goals: number | null
  assists: number | null
  team_goals_conceded: number | null
  saves: number | null
  clearances: number | null
  blocks: number | null
  interceptions: number | null
  tackles: number | null
  recoveries: number | null
  /** Ticket #167/#175 — this row's own club, used ONLY to build the point-in-time team-strength table (buildTeamMatchRecords); never for point reconstruction. 100% populated for 2025-2026 (15,340 of 15,340 rows). */
  team_code: number | null
  /** Ticket #167/#175 — the club this row's player faced, used both to build the team-strength table and to resolve a measured row's specific opponent (resolveFixtureTeams). 98.9% populated for 2025-2026 Premier League rows (12,613 of 12,754) — the ~141 unresolved rows are mid-season transfers (players.csv stores one club per season), excluded as unresolvedFixtureTeams, never guessed. */
  opponent_team_code: number | null
}

/** Exported for ticket #183's own tests — was module-private before this ticket. */
export function toActualMatchStatsInput(row: ActualSourceRow): ActualMatchStatsInput {
  return {
    minutesPlayed: row.minutes_played,
    goals: row.goals,
    assists: row.assists,
    teamGoalsConceded: row.team_goals_conceded,
    saves: row.saves,
    clearances: row.clearances,
    blocks: row.blocks,
    interceptions: row.interceptions,
    tackles: row.tackles,
    recoveries: row.recoveries,
  }
}

async function main(): Promise<void> {
  const startedAt = new Date()
  const env = readSupabaseEnv()
  if (!env) {
    process.exit(1)
    return
  }
  const season = readSeason()
  const reportPath = readReportPath()
  const supabase = createClient(env.url, env.secretKey)

  try {
    // --------------------------------------------------------------------
    // 1. players — resolves position for both sides' joins, via .code only.
    // --------------------------------------------------------------------
    const {
      rows: playerRows,
      error: playersError,
      pages: playersPagesFetched,
    } = await fetchAllPages<PlayerRow>((from, to) =>
      supabase.from('players').select('code, element_type').order('id', { ascending: true }).range(from, to).returns<PlayerRow[]>(),
    )
    if (playersError) {
      throw new BacktestError(`players lookup failed: ${playersError.message}`, 'players')
    }
    const { count: playersExpectedCount, error: playersCountError } = await supabase
      .from('players')
      .select('*', { count: 'exact', head: true })
    if (playersCountError) {
      throw new BacktestError(`players count check failed: ${playersCountError.message}`, 'players')
    }
    assertRowCountMatches('players', playerRows.length, playersExpectedCount ?? 0)

    const codeToPosition = new Map<number, Position>()
    for (const player of playerRows) {
      if (player.code !== null) codeToPosition.set(player.code, player.element_type as Position)
    }

    // --------------------------------------------------------------------
    // 2. feature_history — 18,243+ rows for one season. Paginated,
    //    count-verified against the identical season filter.
    // --------------------------------------------------------------------
    const {
      rows: featureHistoryRows,
      error: featureHistoryError,
      pages: featureHistoryPagesFetched,
    } = await fetchAllPages<FeatureHistoryRow>((from, to) =>
      supabase
        .from('feature_history')
        .select(
          'gameweek_id, player_code, element_type, team_code, prior_matches, prior_minutes, prior_xg, prior_xa, prior_saves, prior_clearances, prior_blocks, ' +
            'prior_interceptions, prior_tackles, prior_recoveries, prior_defcon_qualifying_matches, prior_defcon_hits, prior_recent_minutes',
        )
        .eq('season', season)
        .order('season', { ascending: true })
        .order('gameweek_id', { ascending: true })
        .order('player_code', { ascending: true })
        .range(from, to)
        .returns<FeatureHistoryRow[]>(),
    )
    if (featureHistoryError) {
      if (isMissingTable(featureHistoryError, 'feature_history')) {
        throw new BacktestError(`the "feature_history" table does not exist. Apply ${FEATURE_HISTORY_MIGRATION} first.`, 'feature_history')
      }
      if (isMissingColumn(featureHistoryError, 'team_code')) {
        throw new BacktestError(`feature_history.team_code does not exist in this database yet. Apply ${TEAM_AND_OPPONENT_MIGRATION} first.`, 'feature_history')
      }
      throw new BacktestError(`feature_history lookup failed: ${featureHistoryError.message}`, 'feature_history')
    }
    const { count: featureHistoryExpectedCount, error: featureHistoryCountError } = await supabase
      .from('feature_history')
      .select('*', { count: 'exact', head: true })
      .eq('season', season)
    if (featureHistoryCountError) {
      throw new BacktestError(`feature_history count check failed: ${featureHistoryCountError.message}`, 'feature_history')
    }
    assertRowCountMatches(`feature_history (season=${season})`, featureHistoryRows.length, featureHistoryExpectedCount ?? 0)

    if (featureHistoryRows.length === 0) {
      const message =
        `${JOB_NAME}: feature_history is empty for season=${season}. Nothing to backtest — writing no report. ` +
        'Run scripts/build-feature-history.ts for this season first.'
      console.log(message)
      await recordJobRun(supabase, { status: 'skipped', message, details: { season }, startedAt })
      process.exit(0)
      return
    }

    // --------------------------------------------------------------------
    // 3. player_match_stats — actuals only, filtered to season + Premier
    //    League (ticket #54). 15,000+ rows. Paginated, count-verified
    //    against the identical filter on both queries.
    // --------------------------------------------------------------------
    const {
      rows: matchStatsRows,
      error: matchStatsError,
      pages: matchStatsPagesFetched,
    } = await fetchAllPages<ActualSourceRow>((from, to) =>
      supabase
        .from('player_match_stats')
        .select(
          'player_code, match_id, gameweek, minutes_played, goals, assists, team_goals_conceded, saves, clearances, blocks, interceptions, tackles, recoveries, team_code, opponent_team_code',
        )
        .eq('season', season)
        .eq('competition', PREMIER_LEAGUE_COMPETITION)
        .order('player_id', { ascending: true })
        .order('match_id', { ascending: true })
        .range(from, to)
        .returns<ActualSourceRow[]>(),
    )
    if (matchStatsError) {
      if (isMissingTable(matchStatsError, 'player_match_stats')) {
        throw new BacktestError(`the "player_match_stats" table does not exist. Apply ${PLAYER_MATCH_STATS_MIGRATION} first.`, 'player_match_stats')
      }
      if (isMissingColumn(matchStatsError, 'team_goals_conceded')) {
        throw new BacktestError(
          `player_match_stats.team_goals_conceded does not exist in this database yet. Apply ${TEAM_GOALS_CONCEDED_MIGRATION} first.`,
          'player_match_stats',
        )
      }
      if (isMissingColumn(matchStatsError, 'team_code') || isMissingColumn(matchStatsError, 'opponent_team_code')) {
        throw new BacktestError(
          `player_match_stats.team_code/opponent_team_code do not exist in this database yet. Apply ${TEAM_AND_OPPONENT_MIGRATION} first.`,
          'player_match_stats',
        )
      }
      throw new BacktestError(`player_match_stats lookup failed: ${matchStatsError.message}`, 'player_match_stats')
    }
    const { count: matchStatsExpectedCount, error: matchStatsCountError } = await supabase
      .from('player_match_stats')
      .select('*', { count: 'exact', head: true })
      .eq('season', season)
      .eq('competition', PREMIER_LEAGUE_COMPETITION)
    if (matchStatsCountError) {
      throw new BacktestError(`player_match_stats count check failed: ${matchStatsCountError.message}`, 'player_match_stats')
    }
    assertRowCountMatches(`player_match_stats (season=${season}, competition=${PREMIER_LEAGUE_COMPETITION})`, matchStatsRows.length, matchStatsExpectedCount ?? 0)

    // --------------------------------------------------------------------
    // 4. Index actuals by (player_code, gameweek).
    // --------------------------------------------------------------------
    const actualByPlayerGameweek = new Map<string, ActualSourceRow[]>()
    const matchIdsByPlayerCode = new Map<number, string[]>()
    for (const row of matchStatsRows) {
      if (row.player_code === null) continue
      const key = `${row.player_code}:${row.gameweek}`
      const list = actualByPlayerGameweek.get(key) ?? []
      list.push(row)
      actualByPlayerGameweek.set(key, list)

      const matchIds = matchIdsByPlayerCode.get(row.player_code) ?? []
      matchIds.push(row.match_id)
      matchIdsByPlayerCode.set(row.player_code, matchIds)
    }

    // --------------------------------------------------------------------
    // 4b. Team-slug inference for blank-gameweek detection (ticket #140) —
    //     see file header, "BLANK GAMEWEEKS". Built once from the SAME
    //     matchStatsRows already fetched above; no extra Supabase call.
    // --------------------------------------------------------------------
    const teamSlugByPlayerCode = new Map<number, string>()
    for (const [playerCode, matchIds] of matchIdsByPlayerCode) {
      const slug = inferTeamSlug(matchIds)
      if (slug !== null) teamSlugByPlayerCode.set(playerCode, slug)
    }
    const teamSlugsByGameweek = buildTeamSlugsByGameweek(matchStatsRows.map((r) => ({ gameweek: r.gameweek, matchId: r.match_id })))

    // --------------------------------------------------------------------
    // 4c2. Ticket #175. The point-in-time team-strength table — one row per
    //      resolvable (matchId, teamCode), built once from the SAME
    //      matchStatsRows already fetched above (no extra Supabase call).
    //      computeTeamStrengthAsOf (called per measured row, step 6) filters
    //      this down to gameweeks strictly before the row being projected —
    //      the lookahead guard.
    // --------------------------------------------------------------------
    const teamMatchRecords = buildTeamMatchRecords(
      matchStatsRows.map((r) => ({
        matchId: r.match_id,
        gameweek: r.gameweek,
        teamCode: r.team_code,
        opponentTeamCode: r.opponent_team_code,
        teamGoalsConceded: r.team_goals_conceded,
      })),
    )

    // --------------------------------------------------------------------
    // 4c3. Ticket #193. The published club fixture schedule — one row per
    //      resolvable (matchId, teamCode) like teamMatchRecords above, but
    //      NOT filtered on goals-resolvability (a schedule needs no goals at
    //      all). Built once from the SAME matchStatsRows already fetched
    //      above (no extra Supabase call). Used ONLY by the five-gameweek
    //      window section below, to source each leg's fixture count/
    //      opponent(s) from the club's schedule instead of the player's own
    //      matched rows — see buildClubFixtureSchedule's own comment and
    //      docs/projection-model-backlog.md G13's addendum. The
    //      single-gameweek section above this point is untouched by this
    //      ticket and does not read this map.
    // --------------------------------------------------------------------
    const clubFixtureSchedule = buildClubFixtureSchedule(
      matchStatsRows.map((r) => ({
        matchId: r.match_id,
        gameweek: r.gameweek,
        teamCode: r.team_code,
        opponentTeamCode: r.opponent_team_code,
        teamGoalsConceded: r.team_goals_conceded,
      })),
    )

    // --------------------------------------------------------------------
    // 4c. Ticket #154. Resolve one position per player_code for
    //     computePositionPriors (which keys its own aggregation by player
    //     code, not by row — see its own comment). First-resolved wins per
    //     code: feature_history rows are read ordered by (gameweek_id,
    //     player_code), never by season alone, so this is deterministic run
    //     to run, not an arbitrary pick. The per-ROW classification loop
    //     below (step 6) calls resolveRowPosition directly on each row
    //     instead of this map, for the row-exact resolution the ticket text
    //     asks for and this map's own comment above.
    // --------------------------------------------------------------------
    const resolvedPositionByCode = new Map<number, Position>()
    for (const row of featureHistoryRows) {
      if (resolvedPositionByCode.has(row.player_code)) continue
      const resolution = resolveRowPosition(row, codeToPosition)
      if (resolution.position !== undefined) resolvedPositionByCode.set(row.player_code, resolution.position)
    }

    // --------------------------------------------------------------------
    // 5. Position priors, one per (gameweek, position) — see
    //    computePositionPriors' own comment for why this carries no
    //    lookahead.
    // --------------------------------------------------------------------
    const positionPriors = computePositionPriors(featureHistoryRows, (code) => resolvedPositionByCode.get(code))

    // --------------------------------------------------------------------
    // 6. Classify every row, project + reconstruct the measured population.
    // --------------------------------------------------------------------
    const exclusions = emptyExclusionCounts()
    const measured: MeasuredRow[] = []
    // Ticket #197 diagnostic — collected alongside `measured` below, same
    // index population, never read by anything that isn't this diagnostic.
    // See FiveGameweekReportData.oneGwNeutralFixtureModel's own comment.
    const neutralFixtureOneGwRows: GenericRankingRow[] = []
    // Ticket #183 — the player_code for each `measured` row, same index
    // correspondence (measuredPlayerCodes[i] is measured[i]'s player) —
    // MeasuredRow itself carries no player identity, and the five-gameweek
    // section needs it to look up gameweeks G+1..G+4 for the SAME player.
    // Pushed alongside `measured.push` below; nothing about that push itself
    // is touched.
    const measuredPlayerCodes: number[] = []
    let actualRowsMatched = 0
    // Ticket #154 — population-health counters, over every feature_history
    // row read (not only the measured population): see the two interfaces'
    // own comments for why each counts what it counts.
    const positionResolutionCounts = emptyPositionResolutionCounts()
    const defconSourceCounts = emptyDefconSourceCounts()
    // Ticket #187 — same "every row read" population-health convention as
    // positionResolutionCounts/defconSourceCounts above: buildRecentMinutes
    // depends only on the row itself, not on whether it ends up measured.
    const recentMinutesSourceCounts = emptyRecentMinutesSourceCounts()
    const recentMinutesWindowLengthDistribution = emptyRecentMinutesWindowLengthDistribution()
    // Ticket #175 — how many measured rows used a real, computed fixture vs the neutral fallback.
    const fixtureCoverage = emptyFixtureCoverageCounts()

    for (const row of featureHistoryRows) {
      const resolution = resolveRowPosition(row, codeToPosition)
      incrementPositionResolution(positionResolutionCounts, resolution.source)
      incrementDefconSource(defconSourceCounts, classifyDefconSource(row))
      incrementRecentMinutesSource(recentMinutesSourceCounts, classifyRecentMinutesSource(row))
      incrementRecentMinutesWindowLength(recentMinutesWindowLengthDistribution, buildRecentMinutes(row).length)

      const position = resolution.position
      const actualRowsRaw = actualByPlayerGameweek.get(`${row.player_code}:${row.gameweek_id}`) ?? []
      if (actualRowsRaw.length > 0) actualRowsMatched++

      const teamSlug = teamSlugByPlayerCode.get(row.player_code) ?? null
      // Fail open to today's didNotFeature behaviour when the team cannot be
      // resolved — see inferTeamSlug's own comment on the single-match tie.
      const hadFixture = teamSlug === null ? true : (teamSlugsByGameweek.get(row.gameweek_id)?.has(teamSlug) ?? false)

      // Ticket #175 — the player's own club (feature_history.team_code) and
      // EVERY matched actual row's opponent (player_match_stats.
      // opponent_team_code) must all resolve, or this row is excluded as
      // unresolvedFixtureTeams below (never guessed).
      const fixtureTeamsResolved = resolveFixtureTeams(
        row.team_code,
        actualRowsRaw.map((r) => r.opponent_team_code),
      )

      const classification = classifyRow(row, position, actualRowsRaw.map(toActualMatchStatsInput), hadFixture, fixtureTeamsResolved)
      if (classification.kind === 'excluded') {
        incrementExclusion(exclusions, classification.reason)
        continue
      }

      // Ticket #175 — one point-in-time expectedScore per fixture, built
      // ONLY from team-strength records with gameweek strictly before this
      // row's own gameweek_id (the lookahead guard — see
      // computeTeamStrengthAsOf). row.team_code is guaranteed non-null here:
      // fixtureTeamsResolved (checked above) already required it.
      const ownStrength = computeTeamStrengthAsOf(teamMatchRecords, row.team_code as number, row.gameweek_id)
      const fixtureExpectedScores = actualRowsRaw.map((r) => {
        // opponent_team_code is likewise guaranteed non-null here — same reason.
        const opponentStrength = computeTeamStrengthAsOf(teamMatchRecords, r.opponent_team_code as number, row.gameweek_id)
        return computeFixtureExpectedScore(ownStrength, opponentStrength, SCALE)
      })
      const rowUsedRealFixture = actualRowsRaw.every((r) =>
        fixtureHasSufficientHistory(ownStrength, computeTeamStrengthAsOf(teamMatchRecords, r.opponent_team_code as number, row.gameweek_id)),
      )
      incrementFixtureCoverage(fixtureCoverage, rowUsedRealFixture)

      // Ticket #140: project as many fixtures as the actual side found rows
      // for (classification.outcome.matchesFound) — the same count
      // aggregateActualForGameweek summed on the actual side. Ticket #175:
      // each fixture now carries its own point-in-time expectedScore
      // (fixtureExpectedScores) rather than always the neutral fallback.
      const prior = positionPriors.get(positionPriorKey(row.gameweek_id, classification.position)) ?? fallbackPositionPrior(classification.position)
      const projection = projectRow(row, classification.position, prior, classification.outcome.matchesFound, fixtureExpectedScores)
      const projectedComponents = sumComponentTotals(projection.fixtures.map((f) => pickProjectedComponents(f.components)))

      // Ticket #197 diagnostic — the SAME row/position/prior/fixtureCount,
      // projected a SECOND time with no `fixtureExpectedScores` argument at
      // all, so `projectRow` falls back to buildNeutralFixtureContext for
      // every fixture (every multiplier exactly 1.0). REPORTED only — never
      // touches `projection`/`measured` above, never gates pass/fail. See
      // FiveGameweekReportData.oneGwNeutralFixtureModel's own comment.
      const neutralFixtureProjection = projectRow(row, classification.position, prior, classification.outcome.matchesFound)
      neutralFixtureOneGwRows.push({
        position: classification.position,
        groupId: row.gameweek_id,
        projected: neutralFixtureProjection.expectedPoints,
        actual: classification.outcome.totalPoints,
      })

      // Ticket #159, Defect 1 — naive baselines, computed from this SAME row
      // (row.prior_matches > 0 is guaranteed here: classifyRow already
      // excluded anything else as `noPriorMatches` above).
      const baselineMinutes = computeBaselineMinutesPerMatch(row)
      const baselineXgXa = computeBaselineXgXaPerMatch(row)

      measured.push(
        buildMeasuredRow(
          row.gameweek_id,
          classification.position,
          projection.expectedPoints,
          projectedComponents,
          classification.outcome,
          row.prior_matches,
          baselineMinutes,
          baselineXgXa,
        ),
      )
      // Ticket #183 — see the declaration comment above.
      measuredPlayerCodes.push(row.player_code)
    }

    assertReconciles(featureHistoryRows.length, measured.length, exclusions)

    // --------------------------------------------------------------------
    // 7. Aggregate, sanity-check, report.
    // --------------------------------------------------------------------
    const overall = summarizeErrors(measured)
    const byPosition = summarizeByPosition(measured)
    const byGameweek = summarizeByGameweek(measured)
    const cleanSheetRateByPosition: Partial<Record<Position, number | null>> = {}
    for (const position of POSITIONS) cleanSheetRateByPosition[position] = derivedCleanSheetRate(measured, position)
    const sanity = checkSanityBounds(overall.meanAbsoluteError, cleanSheetRateByPosition)
    const multiFixtureByGameweek = countMultiFixtureRowsByGameweek(measured)
    const multiFixtureDiagnostic = buildMultiFixtureDiagnostic(measured)
    const defconBuckets = bucketByPriorMatches(measured, defconSignedError)
    const overallBuckets = bucketByPriorMatches(measured, (r) => r.signedError)

    // Ticket #147 — ranking skill. Computed entirely from `measured`, the
    // same population above; no new Supabase read.
    const rankingByGameweek = summarizeRankingByGameweek(measured)
    const rankingSeason = summarizeSeasonRanking(measured, rankingByGameweek)
    const rankingByPosition = summarizeRankingByPosition(measured)
    // Ticket #159, Defect 3: seasonTop20 now checked alongside seasonTop10.
    const rankingSanity = checkRankingSanityBounds(rankingSeason.spearman, rankingSeason.top10, rankingSeason.top20, rankingByPosition)

    // Ticket #159 — naive baselines and the gameweek×position breakdown.
    // Both computed entirely from `measured`; no new Supabase read.
    const baselines = summarizeBaselines(measured)
    const baselineVerdicts = buildBaselineVerdicts(rankingSeason.spearman, baselines)
    const rankingByGameweekAndPosition = summarizeRankingByGameweekAndPosition(measured)

    // --------------------------------------------------------------------
    // Ticket #183 — the five-gameweek ranking target. Everything below is
    // NEW: it reads only `featureHistoryRows`, `measured`/`measuredPlayerCodes`,
    // `actualByPlayerGameweek`, `codeToPosition`, `resolvedPositionByCode`,
    // `positionPriors`, `teamMatchRecords` and (ticket #193) `clubFixtureSchedule`
    // — all already fetched/built above for the section above, untouched by
    // anything below. No new Supabase read.
    // --------------------------------------------------------------------
    const featureHistoryByPlayerGameweek = buildFeatureHistoryIndex(featureHistoryRows)
    const lastGameweekInData = computeLastGameweekInData(featureHistoryRows)

    const fiveGameweekExclusions = emptyFiveGameweekExclusionCounts()
    const fiveGameweekMeasured: FiveGameweekRow[] = []
    for (let i = 0; i < measured.length; i++) {
      const classification = classifyFiveGameweekRow(
        measuredPlayerCodes[i],
        measured[i],
        lastGameweekInData,
        featureHistoryByPlayerGameweek,
        codeToPosition,
        positionPriors,
        actualByPlayerGameweek,
        teamMatchRecords,
        clubFixtureSchedule,
      )
      if (classification.kind === 'excluded') {
        incrementFiveGameweekExclusion(fiveGameweekExclusions, classification.reason)
        continue
      }
      fiveGameweekMeasured.push(classification.row)
    }
    assertFiveGameweekReconciles(measured.length, fiveGameweekMeasured.length, fiveGameweekExclusions)

    const fiveGwRankingRows: GenericRankingRow[] = fiveGameweekMeasured.map((r) => ({
      position: r.position,
      groupId: r.startGameweekId,
      projected: r.projectedPoints,
      actual: r.actualPoints,
    }))
    const fiveGwByStartGameweek = summarizeGenericRankingByGroup(fiveGwRankingRows)
    const fiveGwSeason = summarizeGenericSeasonRanking(fiveGwRankingRows, fiveGwByStartGameweek)
    const fiveGwByPosition = summarizeGenericRankingByPosition(fiveGwRankingRows)

    const fiveGwBaselines = summarizeFiveGameweekBaselines(fiveGameweekMeasured)
    const fiveGwBaselineVerdicts = buildBaselineVerdicts(fiveGwSeason.spearman, fiveGwBaselines)

    // The quality oracle — a player's whole-season actual record, built once
    // from the SAME `actualByPlayerGameweek` map (no new Supabase read).
    // `resolvedPositionByCode` (ticket #154's own two-source resolution,
    // first-resolved per player_code) is the position source: the oracle
    // needs one position per player, not a per-row resolution.
    const playerGameweekGroups: PlayerGameweekActualGroup[] = [...actualByPlayerGameweek.entries()].map(([key, rows]) => {
      const separatorIndex = key.indexOf(':')
      return {
        playerCode: Number(key.slice(0, separatorIndex)),
        gameweekId: Number(key.slice(separatorIndex + 1)),
        rows: rows.map(toActualMatchStatsInput),
      }
    })
    const playerSeasonMatches = buildPlayerSeasonMatches(playerGameweekGroups, (code) => resolvedPositionByCode.get(code))
    const seasonMatchesByPlayer = groupSeasonMatchesByPlayer(playerSeasonMatches)

    let oracleOneGwInsufficientData = 0
    const oracleOneGwRows: GenericRankingRow[] = []
    for (let i = 0; i < measured.length; i++) {
      const row = measured[i]
      const rate = computeOracleRate(seasonMatchesByPlayer.get(measuredPlayerCodes[i]) ?? [], new Set([row.gameweekId]))
      if (rate === null) {
        oracleOneGwInsufficientData++
        continue
      }
      oracleOneGwRows.push({ position: row.position, groupId: row.gameweekId, projected: rate, actual: row.actualPoints })
    }
    const oracleOneGwByGroup = summarizeGenericRankingByGroup(oracleOneGwRows)
    const oracleOneGwSeason = summarizeGenericSeasonRanking(oracleOneGwRows, oracleOneGwByGroup)
    const oracleOneGwByPosition = summarizeGenericRankingByPosition(oracleOneGwRows)

    // Ticket #187 — the oracle fix: a TOTAL (out-of-window points-per-
    // featured-gameweek × out-of-window appearance rate × the horizon),
    // never the bare rate `computeOracleRate` still returns for the
    // one-gameweek oracle above. See computeOracleFiveGameweekEstimate's own
    // comment for the null/zero distinction.
    let oracleFiveGwInsufficientData = 0
    const oracleFiveGwRows: GenericRankingRow[] = []
    for (const row of fiveGameweekMeasured) {
      const excludeGameweeks = new Set(buildFiveGameweekWindow(row.startGameweekId))
      const estimate = computeOracleFiveGameweekEstimate(seasonMatchesByPlayer.get(row.playerCode) ?? [], excludeGameweeks, FIVE_GAMEWEEK_HORIZON)
      if (estimate === null) {
        oracleFiveGwInsufficientData++
        continue
      }
      oracleFiveGwRows.push({ position: row.position, groupId: row.startGameweekId, projected: estimate, actual: row.actualPoints })
    }
    const oracleFiveGwByGroup = summarizeGenericRankingByGroup(oracleFiveGwRows)
    const oracleFiveGwSeason = summarizeGenericSeasonRanking(oracleFiveGwRows, oracleFiveGwByGroup)
    const oracleFiveGwByPosition = summarizeGenericRankingByPosition(oracleFiveGwRows)

    // Ticket #187, DoD: "the oracle sits above the model at both horizons ...
    // if it does not, STOP and report". Folded into the existing sanity-bound
    // failure gate below, not a silent report-only observation.
    const oracleCeiling = checkOracleCeiling(rankingSeason.spearman, oracleOneGwSeason.spearman, fiveGwSeason.spearman, oracleFiveGwSeason.spearman)

    // Ticket #197 diagnostic — see FiveGameweekReportData.oneGwNeutralFixtureModel's own comment.
    const oneGwNeutralFixtureByGroup = summarizeGenericRankingByGroup(neutralFixtureOneGwRows)
    const oneGwNeutralFixtureSeason = summarizeGenericSeasonRanking(neutralFixtureOneGwRows, oneGwNeutralFixtureByGroup)
    const oneGwNeutralFixtureByPosition = summarizeGenericRankingByPosition(neutralFixtureOneGwRows)

    // Ticket #193 — the three club-schedule fixture counters, summed across
    // every five-gameweek MEASURED row's own per-window leg tallies.
    const clubScheduleLegCounts = sumClubScheduleLegCounts(fiveGameweekMeasured)

    const fiveGameweekReportData: FiveGameweekReportData = {
      lastGameweekInData,
      candidateCount: measured.length,
      measuredCount: fiveGameweekMeasured.length,
      exclusions: fiveGameweekExclusions,
      clubSchedule: clubScheduleLegCounts,
      season: fiveGwSeason,
      byPosition: fiveGwByPosition,
      byStartGameweek: fiveGwByStartGameweek,
      baselines: fiveGwBaselines,
      baselineVerdicts: fiveGwBaselineVerdicts,
      oracleOneGw: { season: oracleOneGwSeason, byPosition: oracleOneGwByPosition, insufficientData: oracleOneGwInsufficientData },
      oracleFiveGw: { season: oracleFiveGwSeason, byPosition: oracleFiveGwByPosition, insufficientData: oracleFiveGwInsufficientData },
      oracleCeiling,
      oneGwNeutralFixtureModel: { season: oneGwNeutralFixtureSeason, byPosition: oneGwNeutralFixtureByPosition },
    }

    const reportData: ReportData = {
      generatedAt: new Date(),
      season,
      measured,
      overall,
      byPosition,
      byGameweek,
      cleanSheetRateByPosition,
      sanity,
      exclusions,
      positionResolution: positionResolutionCounts,
      defconSource: defconSourceCounts,
      recentMinutesSource: recentMinutesSourceCounts,
      recentMinutesWindowLengthDistribution,
      featureHistoryRowsRead: featureHistoryRows.length,
      actualRowsMatched,
      playersRowCount: playerRows.length,
      matchStatsRowCount: matchStatsRows.length,
      multiFixtureByGameweek,
      multiFixtureDiagnostic,
      defconBuckets,
      overallBuckets,
      rankingSeason,
      rankingByPosition,
      rankingByGameweek,
      rankingSanity,
      baselines,
      baselineVerdicts,
      rankingByGameweekAndPosition,
      fixtureCoverage,
      fiveGameweek: fiveGameweekReportData,
    }
    const reportMarkdown = generateReportMarkdown(reportData)
    await mkdir(dirname(reportPath), { recursive: true })
    await writeFile(reportPath, reportMarkdown, 'utf8')

    const details: JsonRecord = {
      season,
      featureHistoryRowsRead: featureHistoryRows.length,
      featureHistoryPagesFetched,
      playersRowsFetched: playerRows.length,
      playersPagesFetched,
      matchStatsRowsFetched: matchStatsRows.length,
      matchStatsPagesFetched,
      actualRowsMatched,
      rowsMeasured: measured.length,
      exclusions,
      positionResolution: positionResolutionCounts,
      defconSource: defconSourceCounts,
      recentMinutesSource: recentMinutesSourceCounts,
      recentMinutesWindowLengthDistribution,
      overallMeanAbsoluteError: overall.meanAbsoluteError,
      overallMeanSignedError: overall.meanSignedError,
      byPosition: Object.fromEntries(POSITIONS.map((p) => [POSITION_NAMES[p], byPosition[p]])),
      cleanSheetRateByPosition: Object.fromEntries(POSITIONS.map((p) => [POSITION_NAMES[p], cleanSheetRateByPosition[p]])),
      sanity,
      multiFixtureDiagnostic,
      defconBuckets,
      overallBuckets,
      rankingSeason,
      rankingByPosition: Object.fromEntries(POSITIONS.map((p) => [POSITION_NAMES[p], rankingByPosition[p]])),
      rankingSanity,
      baselines,
      baselineVerdicts,
      fixtureCoverage,
      // Ticket #183 — informational: the oracle's own ranking figures carry
      // no asserted threshold, matching the ticket text's "no sanity bound
      // derived from the oracle['s ranking value]". Ticket #187 changed this
      // only insofar as ONE relationship between figures already reported
      // here — model vs oracle, at both horizons — is now gated below via
      // oracleCeiling; the oracle's raw Spearman/top-N figures themselves
      // are still never checked against a threshold.
      fiveGameweekMeasured: fiveGameweekReportData.measuredCount,
      fiveGameweekExclusions: fiveGameweekReportData.exclusions,
      fiveGameweekRankingSeason: fiveGameweekReportData.season,
      fiveGameweekOracleSeason: fiveGameweekReportData.oracleFiveGw.season,
      oracleCeiling: fiveGameweekReportData.oracleCeiling,
      reportPath,
    }

    // Ticket #147: the ranking-skill bounds fail the job exactly like the
    // existing sanity bounds above — added to the existing check, neither
    // bound's own logic touched. Ticket #187: oracleCeiling joins the same
    // gate — "STOP and report" (DoD) means the job records status 'failure'
    // and exits non-zero, exactly like every other sanity bound here, not a
    // console note a human might miss.
    if (!sanity.ok || !rankingSanity.ok || !fiveGameweekReportData.oracleCeiling.ok) {
      const combinedFailures = [...sanity.failures, ...rankingSanity.failures, ...fiveGameweekReportData.oracleCeiling.failures]
      const message = `${JOB_NAME}: sanity bounds FAILED for season=${season}: ${combinedFailures.join('; ')}. Report written to ${reportPath} for diagnosis.`
      console.error(message)
      await recordJobRun(supabase, { status: 'failure', message, details, startedAt })
      process.exit(1)
      return
    }

    const message =
      `${JOB_NAME}: season ${season} — ${measured.length} player-gameweek row(s) measured ` +
      `(of ${featureHistoryRows.length} feature_history row(s) read). Mean absolute error ${fmt(overall.meanAbsoluteError)}, ` +
      `mean signed error ${fmt(overall.meanSignedError)} — ${describeSignedError(overall.meanSignedError)}. ` +
      `Ranking skill: Spearman ${fmtSpearman(rankingSeason.spearman)}, top-10 overlap ${fmtTopN(rankingSeason.top10)}. ` +
      `Five-gameweek ranking (#183): Spearman ${fmtSpearman(fiveGameweekReportData.season.spearman)} ` +
      `(n=${fiveGameweekReportData.season.n}), oracle ${fmtSpearman(fiveGameweekReportData.oracleFiveGw.season.spearman)}. ` +
      `Report written to ${reportPath}.`
    console.log(message)
    await recordJobRun(supabase, { status: 'success', message, details, startedAt })
  } catch (err) {
    const message =
      err instanceof BacktestError || err instanceof BacktestSanityError
        ? err.message
        : err instanceof Error
          ? `unexpected failure: ${err.message}`
          : `unexpected failure: ${String(err)}`

    console.error(`${JOB_NAME}: failed: ${message}`)

    try {
      await recordJobRun(supabase, { status: 'failure', message, details: { season }, startedAt })
    } catch (recordErr) {
      const recordMessage = recordErr instanceof Error ? recordErr.message : String(recordErr)
      console.error(`${JOB_NAME}: additionally failed to record the failed job_runs row: ${recordMessage}`)
    }

    process.exit(1)
  }
}

// Guarded, matching every other job in scripts/: importing this module (e.g.
// from its test file) must not trigger a real run.
const isMainModule = process.argv[1] !== undefined && import.meta.url === `file://${process.argv[1]}`
if (isMainModule) {
  main().catch((err: unknown) => {
    const message = err instanceof Error ? err.message : String(err)
    console.error(`${JOB_NAME}: unexpected top-level failure: ${message}`)
    process.exit(1)
  })
}
