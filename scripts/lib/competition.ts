// Shared competition parser — ticket #54.
//
// THE BUG THIS FILE EXISTS TO PREVENT. player_match_stats.match_id carries
// the competition as a slug segment (e.g.
// "25-26-prem-manchester-united-vs-arsenal"), but nothing derived that
// segment into a queryable column: every consumer of the table has been
// treating a row as a Premier League appearance regardless of which
// competition it actually came from. Cup and European matches score ZERO
// FPL points, and their per-90 rates are measurably different (34% higher
// xG per 90 in cup/European rows — see ticket #54), so a row from any other
// competition contaminates every rate this app computes.
//
// ONE PARSED COLUMN, ONE FILTER. This module is the only place a match_id
// slug is decoded into a competition token. scripts/ingest-core-insights.ts
// calls parseCompetition() once per row at ingest time and stores the result
// in player_match_stats.competition; every consumer (scripts/project-points.ts,
// scripts/calibration-report.ts) filters on that stored column with
// PREMIER_LEAGUE_COMPETITION, never by pattern-matching match_id again. A
// `LIKE '%-prem-%'` filter scattered across call sites would be untestable in
// isolation and would silently admit anything new whose slug happens to
// contain the substring — see the ticket Notes.
//
// FAIL LOUDLY ON AN UNKNOWN TOKEN. The whole defect this ticket fixes exists
// because unexpected rows arrived and nothing objected. A slug whose
// competition segment is not in KNOWN_COMPETITIONS throws
// UnknownCompetitionError rather than defaulting to Premier League or
// silently returning null — see ingest-core-insights.ts's header for how
// that propagates into a failed job_runs row.
//
// SEASON-PREFIX INDEPENDENT. match_id's leading two two-digit segments are
// the short season (e.g. "25-26", "26-27") — this parser strips whatever
// matches that shape rather than hardcoding "25-26", so it keeps working
// once the source starts publishing a new season under this same slug
// convention.

/** The one competition that scores FPL points. Every consumer filters on this, never a literal string. */
export const PREMIER_LEAGUE_COMPETITION = 'prem' as const

/**
 * Every competition token FPL-Core-Insights is known to publish under
 * `data/{season}/By Gameweek/GW{n}/playermatchstats.csv`, verified directly
 * against the source on 17 Aug 2026 (see ticket #54). Sorted longest-first
 * below when matched, purely as a defensive measure against a future token
 * being a literal prefix of another — none of the current six are.
 */
export const KNOWN_COMPETITIONS = [
  'prem',
  'efl-cup',
  'fa-cup',
  'champions-league',
  'europa-league',
  'conference-league',
] as const

export type CompetitionToken = (typeof KNOWN_COMPETITIONS)[number]

/** Strips a leading "<2 digits>-<2 digits>-" season prefix, e.g. "25-26-" or "26-27-". Season-value-agnostic by design — see file header. */
const SEASON_PREFIX_RE = /^\d{2}-\d{2}-/

const TOKENS_LONGEST_FIRST: readonly string[] = [...KNOWN_COMPETITIONS].sort((a, b) => b.length - a.length)

export class UnknownCompetitionError extends Error {
  matchId: string
  remainder: string
  constructor(matchId: string, remainder: string) {
    super(
      `unrecognized competition in match_id "${matchId}" — after stripping the season prefix, ` +
        `"${remainder}" does not start with any known competition token ` +
        `(${KNOWN_COMPETITIONS.join(', ')}). This is a new or unexpected competition at the ` +
        'source and must be added to KNOWN_COMPETITIONS deliberately, not defaulted past.',
    )
    this.name = 'UnknownCompetitionError'
    this.matchId = matchId
    this.remainder = remainder
  }
}

/**
 * Parses the competition token out of a player_match_stats.match_id slug,
 * e.g. "25-26-prem-manchester-united-vs-arsenal" -> "prem",
 * "25-26-champions-league-bayern-münchen-vs-arsenal" -> "champions-league".
 *
 * Throws UnknownCompetitionError — never defaults to "prem", never returns
 * null — when the token after the season prefix does not match any entry in
 * KNOWN_COMPETITIONS. See file header for why that is deliberate.
 */
export function parseCompetition(matchId: string): CompetitionToken {
  const withoutSeason = matchId.replace(SEASON_PREFIX_RE, '')

  for (const token of TOKENS_LONGEST_FIRST) {
    if (withoutSeason === token || withoutSeason.startsWith(`${token}-`)) {
      return token as CompetitionToken
    }
  }

  throw new UnknownCompetitionError(matchId, withoutSeason)
}

// ============================================================================
// Club slugs — ticket #167. Belongs beside parseCompetition() because it
// parses the SAME match_id slug, one segment further in: once the season
// prefix and competition token are stripped, what remains is exactly two
// club-name slugs joined by "-vs-", e.g. "manchester-united-vs-arsenal" or
// "brighton-hove-albion-vs-fulham". This is structural parsing only — it
// never decides which club is "home", which is the player's own club, or
// resolves a slug to a team code; that is
// scripts/ingest-core-insights.ts's resolveOpponentTeamCode, since it needs
// data (a season's teams.csv) this module has no business reading.
// ============================================================================

export class UnknownMatchSlugError extends Error {
  matchId: string
  remainder: string
  constructor(matchId: string, remainder: string) {
    super(
      `match_id "${matchId}" does not split into exactly two club slugs joined by "-vs-" after its season and ` +
        `competition prefix — remainder was "${remainder}". This is a new or unexpected match_id shape and must ` +
        'be investigated deliberately, not defaulted past.',
    )
    this.name = 'UnknownMatchSlugError'
    this.matchId = matchId
    this.remainder = remainder
  }
}

/**
 * Splits the two club-name slugs out of a match_id, given its
 * already-parsed competition token (from parseCompetition() — never
 * re-derived here, so this can never disagree with parseCompetition about
 * where the club segment begins):
 *   parseMatchClubSlugs("25-26-prem-manchester-united-vs-arsenal", "prem")
 *     -> ["manchester-united", "arsenal"]
 *   parseMatchClubSlugs("25-26-prem-brighton-hove-albion-vs-fulham", "prem")
 *     -> ["brighton-hove-albion", "fulham"]
 *
 * Splits on "-vs-", never on "-" — club slugs themselves contain hyphens
 * (Brighton & Hove Albion, Wolverhampton Wanderers, ...), so splitting on
 * every hyphen would shred a multi-word club name into nonsense fragments.
 *
 * Throws UnknownMatchSlugError — never returns a guessed pair, never
 * silently returns one or three+ segments — when the remainder after the
 * season+competition prefix does not split into exactly two non-empty
 * "-vs-" segments. This is a genuine SHAPE failure (the source's match_id
 * format itself changed), and this module's own discipline (see file
 * header) is to fail loudly on that rather than default past it — the same
 * treatment parseCompetition gives an unrecognized competition token. It is
 * a different, rarer failure from a club slug that parses fine here but
 * names a club this app does not otherwise recognize: that semantic case is
 * the caller's concern (resolveOpponentTeamCode), not this function's — see
 * that function's own "counted and reported, never guessed" handling.
 */
export function parseMatchClubSlugs(matchId: string, competition: CompetitionToken): [string, string] {
  const withoutSeason = matchId.replace(SEASON_PREFIX_RE, '')
  const remainder = withoutSeason === competition ? '' : withoutSeason.slice(competition.length + 1)
  const parts = remainder.split('-vs-')
  if (parts.length !== 2 || parts[0] === '' || parts[1] === '') {
    throw new UnknownMatchSlugError(matchId, remainder)
  }
  return [parts[0], parts[1]]
}
