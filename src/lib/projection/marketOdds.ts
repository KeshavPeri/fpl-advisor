/**
 * Market odds as the forward fixture term — ticket #238.
 *
 * The results-derived team-strength term (teamStrength.ts, ticket #114/#229/#235) is current but
 * backward-looking by construction: it cannot know a suspension, a rotation after a midweek
 * European tie, or an injury crisis. Bookmakers price all of that, continuously, with real money
 * behind the estimate — the only forward-looking fixture signal this app has access to.
 *
 * A three-way market converts to an expectedScore in [0, 1] with no fitted parameter and no
 * borrowed rating scale — this IS the definition of an elo expected score (a draw counts half),
 * so it slots directly into the same [0, 1] space fixture.ts/teamStrength.ts already produce.
 *
 * Pure computation only: no I/O, no database, no fetch, no reading the clock (every timestamp
 * this file compares is passed in by the caller as a plain number — see isMarketOddsFresh).
 */

// ============================================================================
// Median across bookmakers
// ============================================================================

/**
 * Population median of a numeric array. Ticket text: "use the median across the returned
 * bookmakers... not the mean and not one chosen book" — robust to a single stale or mispriced
 * feed, which is the realistic failure mode with ~21 books per fixture. Empty array returns 0 —
 * never called on one by this file's own callers, which always guard on book_count first
 * (scripts/ingest-match-odds.ts).
 */
export function median(values: readonly number[]): number {
  if (values.length === 0) return 0
  const sorted = [...values].sort((a, b) => a - b)
  const mid = Math.floor(sorted.length / 2)
  return sorted.length % 2 === 0 ? (sorted[mid - 1] + sorted[mid]) / 2 : sorted[mid]
}

/** Decimal odds for the three-way 1X2 (h2h) market. */
export interface MarketOddsPrices {
  home: number
  draw: number
  away: number
}

/** The median decimal price for each of the three outcomes, taken independently across every bookmaker row supplied. */
export function medianOddsAcrossBooks(bookmakerPrices: readonly MarketOddsPrices[]): MarketOddsPrices {
  return {
    home: median(bookmakerPrices.map((p) => p.home)),
    draw: median(bookmakerPrices.map((p) => p.draw)),
    away: median(bookmakerPrices.map((p) => p.away)),
  }
}

// ============================================================================
// Overround removal
// ============================================================================

export interface OverroundRemovalResult {
  pHome: number
  pDraw: number
  pAway: number
  overround: number
}

/**
 * Proportional overround removal — TIER 3, decided in the ticket:
 *
 *   raw_i     = 1 / decimal_odds_i          (home, draw, away)
 *   overround = raw_home + raw_draw + raw_away
 *   p_i       = raw_i / overround
 *
 * Proportional normalisation is the simplest way to strip a bookmaker's margin out of a set of
 * decimal odds. Shin's method and the power method are both measurably better at the extremes
 * (a heavily one-sided market) — both are explicitly out of scope for this ticket (see its own
 * "Out of scope" list), so this stays the simplest correct construction and a later ticket can
 * measure whether the more sophisticated methods actually move the model's output.
 */
export function removeOverround(prices: MarketOddsPrices): OverroundRemovalResult {
  const rawHome = 1 / prices.home
  const rawDraw = 1 / prices.draw
  const rawAway = 1 / prices.away
  const overround = rawHome + rawDraw + rawAway
  return {
    pHome: rawHome / overround,
    pDraw: rawDraw / overround,
    pAway: rawAway / overround,
    overround,
  }
}

// ============================================================================
// expectedScore — the elo-space conversion
// ============================================================================

export type MarketOddsSide = 'home' | 'away'

/**
 * expectedScore(home) = p_home + 0.5 * p_draw; expectedScore(away) = p_away + 0.5 * p_draw. This
 * is the definition of an elo expected score (a draw counts as half a win for both sides), so
 * `deltas.md` D11's rule against substituting another provider's elo does not apply here — this
 * computes a number from prices, it does not import a rating.
 */
export function marketExpectedScore(probabilities: Pick<OverroundRemovalResult, 'pHome' | 'pDraw' | 'pAway'>, side: MarketOddsSide): number {
  return side === 'home' ? probabilities.pHome + 0.5 * probabilities.pDraw : probabilities.pAway + 0.5 * probabilities.pDraw
}

// ============================================================================
// Thresholds — the precedence gate's own rule, plus the ingest-side sanity guard and the
// falsification gate's overround plausibility band. Named constants so
// src/lib/projection/expectedPoints.ts, scripts/ingest-match-odds.ts and
// scripts/team-strength-diagnostic.ts read the same numbers rather than each hardcoding them.
// ============================================================================

/**
 * Minimum number of bookmakers' own three-way prices required before a fixture's market odds are
 * trusted for the projection. Ticket text, verbatim: "a fixture gets the market term when the API
 * returned it with at least 3 books". Below this, resolveFixtureExpectedScore falls through to
 * team strength — never a guessed adjustment from too thin a sample.
 */
export const MIN_MARKET_ODDS_BOOK_COUNT = 3

/**
 * Odds freshness window, in hours. Ticket text, verbatim: "the odds row is under 48 hours old".
 * Older than this, the fixture falls through even when book_count is otherwise sufficient —
 * stale prices are worse than no prices (ticket text).
 */
export const MARKET_ODDS_FRESHNESS_HOURS = 48

const MS_PER_HOUR = 60 * 60 * 1000

/**
 * Whether a fetched_at timestamp is still within the freshness window as of `nowMs`. Pure
 * arithmetic on two already-known timestamps — the caller supplies `nowMs` (never `Date.now()`
 * read from inside this module), keeping this file's "no I/O" guarantee intact the same way every
 * other pure module in this directory keeps it (see e.g. teamStrength.ts's lookahead guard, which
 * takes `beforeGameweek` as a plain argument rather than deriving "now" itself).
 */
export function isMarketOddsFresh(fetchedAtMs: number, nowMs: number, freshnessHours: number = MARKET_ODDS_FRESHNESS_HOURS): boolean {
  return nowMs - fetchedAtMs <= freshnessHours * MS_PER_HOUR
}

/**
 * Sanity cap, in days, on how far out a fetched fixture's kickoff may be before its odds row is
 * ignored entirely by the ingest job. Ticket text, verbatim: "ignore any returned fixture whose
 * kickoff is more than 35 days out... a guard against a malformed or long-dated market" — this is
 * NOT the projection horizon (the API's own coverage — measured at ~24 days on 15 Sept 2026 — is
 * the horizon; a fixed day-window would throw away usable signal). It should never fire in
 * normal operation.
 */
export const MAX_FIXTURE_DAYS_OUT = 35

/**
 * Plausible overround range for a real UK three-way market — falsification-gate item 3 (ticket
 * text, verbatim): "an overround below 1 is impossible and above 1.15 is not a real UK three-way
 * market." Outside this range the prices were misparsed. Checked by
 * scripts/team-strength-diagnostic.ts, not enforced by the ingest itself (a misparsed row is
 * still worth recording and diagnosing, not silently dropped).
 */
export const OVERROUND_MIN_PLAUSIBLE = 1.0
export const OVERROUND_MAX_PLAUSIBLE = 1.15

/** Minimum fraction of fetched fixtures that must resolve to a known club before the ingest trusts its own name mapping. Ticket text, verbatim: "fails loudly... when fewer than 80% of the fixtures it fetched resolve to a known club." */
export const MIN_CLUB_RESOLUTION_RATE = 0.8
