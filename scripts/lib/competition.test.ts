// Unit tests for scripts/lib/competition.ts — ticket #54.
//
// Pure function, no Supabase, no network: parseCompetition is exercised
// directly against real slug shapes taken from the ticket's own definition
// of done, so this proves the parser without needing a live source fetch.

import { describe, expect, it } from 'vitest'
import {
  KNOWN_COMPETITIONS,
  parseCompetition,
  parseMatchClubSlugs,
  PREMIER_LEAGUE_COMPETITION,
  UnknownCompetitionError,
  UnknownMatchSlugError,
} from './competition.js'

describe('parseCompetition — named competitions from real slug shapes', () => {
  it('parses "prem" from a Premier League slug', () => {
    expect(parseCompetition('25-26-prem-manchester-united-vs-arsenal')).toBe('prem')
  })

  it('parses "efl-cup" from an EFL Cup slug', () => {
    expect(parseCompetition('25-26-efl-cup-manchester-city-vs-huddersfield-town')).toBe('efl-cup')
  })

  it('parses "fa-cup" from an FA Cup slug', () => {
    expect(parseCompetition('25-26-fa-cup-arsenal-vs-liverpool')).toBe('fa-cup')
  })

  it('parses "champions-league" from a Champions League slug', () => {
    expect(parseCompetition('25-26-champions-league-bayern-münchen-vs-arsenal')).toBe('champions-league')
  })

  it('parses "europa-league" from a Europa League slug', () => {
    expect(parseCompetition('25-26-europa-league-tottenham-hotspur-vs-roma')).toBe('europa-league')
  })

  it('parses "conference-league" from a Conference League slug', () => {
    expect(parseCompetition('25-26-conference-league-chelsea-vs-legia-warsaw')).toBe('conference-league')
  })
})

describe('parseCompetition — non-ASCII team names', () => {
  it('does not mangle the competition token when a team name carries a non-ASCII character', () => {
    // "bayern-münchen" — the ticket's own example. The token comes BEFORE
    // the team names in the slug, so this proves the ü does not throw off
    // the parse, not that ü survives untouched (this function never returns
    // team names at all).
    const result = parseCompetition('25-26-champions-league-bayern-münchen-vs-arsenal')
    expect(result).toBe('champions-league')
  })
})

describe('parseCompetition — season-prefix independence', () => {
  it('does not depend on the season prefix being 25-26', () => {
    expect(parseCompetition('26-27-prem-manchester-united-vs-arsenal')).toBe('prem')
    expect(parseCompetition('26-27-efl-cup-manchester-city-vs-huddersfield-town')).toBe('efl-cup')
  })
})

describe('parseCompetition — unknown competition token', () => {
  it('throws UnknownCompetitionError rather than defaulting to prem or returning null', () => {
    expect(() => parseCompetition('25-26-club-world-cup-manchester-city-vs-real-madrid')).toThrow(UnknownCompetitionError)
  })

  it('names the offending match_id in the thrown error message', () => {
    const matchId = '25-26-club-world-cup-manchester-city-vs-real-madrid'
    expect(() => parseCompetition(matchId)).toThrow(matchId)
  })

  it('throws for a slug with no recognizable season prefix at all', () => {
    expect(() => parseCompetition('not-a-real-slug')).toThrow(UnknownCompetitionError)
  })
})

describe('constants', () => {
  it('PREMIER_LEAGUE_COMPETITION is "prem" and is itself a known competition', () => {
    expect(PREMIER_LEAGUE_COMPETITION).toBe('prem')
    expect(KNOWN_COMPETITIONS).toContain(PREMIER_LEAGUE_COMPETITION)
  })

  it('KNOWN_COMPETITIONS lists exactly the six competitions the ticket verified', () => {
    expect([...KNOWN_COMPETITIONS].sort()).toEqual(
      ['champions-league', 'conference-league', 'efl-cup', 'europa-league', 'fa-cup', 'prem'].sort(),
    )
  })
})

// ============================================================================
// parseMatchClubSlugs — ticket #167. Structural parsing only: splits the
// remainder of a match_id (after season + competition) into its two club
// slugs. Semantic resolution (does a slug name a club this app knows about)
// is scripts/ingest-core-insights.ts's job, tested there.
// ============================================================================

describe('parseMatchClubSlugs — real slug shapes', () => {
  it('splits a normal two-club slug', () => {
    expect(parseMatchClubSlugs('25-26-prem-manchester-united-vs-arsenal', 'prem')).toEqual([
      'manchester-united',
      'arsenal',
    ])
  })

  it('splits a slug where one club name is itself hyphenated (brighton-hove-albion)', () => {
    expect(parseMatchClubSlugs('25-26-prem-brighton-hove-albion-vs-fulham', 'prem')).toEqual([
      'brighton-hove-albion',
      'fulham',
    ])
  })

  it('splits a slug where BOTH club names are hyphenated', () => {
    expect(parseMatchClubSlugs('25-26-prem-wolverhampton-wanderers-vs-tottenham-hotspur', 'prem')).toEqual([
      'wolverhampton-wanderers',
      'tottenham-hotspur',
    ])
  })

  it('splits correctly for a non-"prem" competition token', () => {
    expect(parseMatchClubSlugs('25-26-efl-cup-manchester-city-vs-huddersfield-town', 'efl-cup')).toEqual([
      'manchester-city',
      'huddersfield-town',
    ])
  })

  it('is season-prefix independent, matching parseCompetition', () => {
    expect(parseMatchClubSlugs('26-27-prem-hull-city-vs-manchester-united', 'prem')).toEqual([
      'hull-city',
      'manchester-united',
    ])
  })
})

describe('parseMatchClubSlugs — unrecognizable shape', () => {
  it('throws UnknownMatchSlugError when the remainder has no "-vs-" at all', () => {
    expect(() => parseMatchClubSlugs('25-26-prem-arsenal-chelsea', 'prem')).toThrow(UnknownMatchSlugError)
  })

  it('throws UnknownMatchSlugError when the remainder is empty (competition token with nothing after it)', () => {
    expect(() => parseMatchClubSlugs('25-26-prem', 'prem')).toThrow(UnknownMatchSlugError)
  })

  it('names the offending match_id in the thrown error message', () => {
    const matchId = '25-26-prem-arsenal-chelsea'
    expect(() => parseMatchClubSlugs(matchId, 'prem')).toThrow(matchId)
  })

  it('never splits on a bare hyphen — "-vs-" only, so a hyphenated-but-well-formed slug never false-positives as malformed', () => {
    // Sanity check on the positive path above: this must NOT throw.
    expect(() => parseMatchClubSlugs('25-26-prem-brighton-hove-albion-vs-fulham', 'prem')).not.toThrow()
  })
})
