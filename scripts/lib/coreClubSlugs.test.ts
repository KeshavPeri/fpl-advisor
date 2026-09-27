// Unit tests for scripts/lib/coreClubSlugs.ts — ticket #285.
//
// The fixture below is GW1 of FPL-Core-Insights' real, live
// data/2026-2027/By%20Gameweek/GW1/fixtures.csv, filtered to tournament ==
// 'prem' and transcribed verbatim (home_team/away_team/match_id columns) —
// fetched 26 Sept 2026, same source scripts/lib/coreClubSlugs.ts's own header
// cites. Ten matches, every one of the 20 clubs appears exactly once (as
// home or away), so this one gameweek alone is a complete fixture for the
// "every slug maps, one match per club" DoD item.

import { describe, expect, it } from 'vitest'
import { resolveOpponentTeamCode } from '../ingest-core-insights.ts'
import { CORE_CLUB_SLUG_TO_TEAM_CODE } from './coreClubSlugs.ts'

interface RealFixtureRow {
  home: number
  away: number
  matchId: string
}

// Verbatim from a live fetch of data/2026-2027/By Gameweek/GW1/fixtures.csv, tournament == 'prem'.
const GW1_PREM_FIXTURES: readonly RealFixtureRow[] = [
  { home: 3, away: 9, matchId: '26-27-prem-arsenal-vs-coventry-city' },
  { home: 94, away: 6, matchId: '26-27-prem-brentford-vs-tottenham-hotspur' },
  { home: 36, away: 7, matchId: '26-27-prem-brighton-hove-albion-vs-aston-villa' },
  { home: 17, away: 2, matchId: '26-27-prem-nottingham-forest-vs-leeds-united' },
  { home: 11, away: 31, matchId: '26-27-prem-everton-vs-crystal-palace' },
  { home: 88, away: 1, matchId: '26-27-prem-hull-city-vs-manchester-united' },
  { home: 43, away: 91, matchId: '26-27-prem-manchester-city-vs-afc-bournemouth' },
  { home: 40, away: 56, matchId: '26-27-prem-ipswich-town-vs-sunderland' },
  { home: 4, away: 14, matchId: '26-27-prem-newcastle-united-vs-liverpool' },
  { home: 54, away: 8, matchId: '26-27-prem-fulham-vs-chelsea' },
]

/** Splits "26-27-prem-<a>-vs-<b>" into [a, b] — same shape scripts/lib/competition.ts's parseMatchClubSlugs produces, reimplemented here (not imported) so this test does not depend on that module's own prefix-stripping logic to prove the fixture data is self-consistent. */
function slugsFromMatchId(matchId: string): [string, string] {
  const remainder = matchId.replace(/^\d{2}-\d{2}-prem-/, '')
  const [a, b] = remainder.split('-vs-')
  return [a, b]
}

describe('CORE_CLUB_SLUG_TO_TEAM_CODE', () => {
  it('has exactly 20 entries — one per current Premier League club', () => {
    expect(CORE_CLUB_SLUG_TO_TEAM_CODE.size).toBe(20)
  })

  it('maps every slug appearing in a real GW1 prem fixture list to its real team code, home and away, for all 20 clubs', () => {
    const seenCodes = new Set<number>()
    for (const fixture of GW1_PREM_FIXTURES) {
      const [homeSlug, awaySlug] = slugsFromMatchId(fixture.matchId)
      expect(CORE_CLUB_SLUG_TO_TEAM_CODE.get(homeSlug)).toBe(fixture.home)
      expect(CORE_CLUB_SLUG_TO_TEAM_CODE.get(awaySlug)).toBe(fixture.away)
      seenCodes.add(fixture.home)
      seenCodes.add(fixture.away)
    }
    // Confirms the ten matches above really do cover all 20 clubs once each — the DoD's own
    // "include at least one match for each of the 20 clubs" requirement.
    expect(seenCodes.size).toBe(20)
  })

  it('includes all three promoted clubs for 2026-27 (Coventry City, Hull City, Ipswich Town)', () => {
    expect(CORE_CLUB_SLUG_TO_TEAM_CODE.get('coventry-city')).toBe(9)
    expect(CORE_CLUB_SLUG_TO_TEAM_CODE.get('hull-city')).toBe(88)
    expect(CORE_CLUB_SLUG_TO_TEAM_CODE.get('ipswich-town')).toBe(40)
  })
})

// ============================================================================
// resolveOpponentTeamCode (scripts/ingest-core-insights.ts) fed by
// CORE_CLUB_SLUG_TO_TEAM_CODE — the actual resolver this map exists to feed,
// exercised both home and away, per the DoD.
// ============================================================================

describe('resolveOpponentTeamCode using CORE_CLUB_SLUG_TO_TEAM_CODE', () => {
  it('resolves the opponent correctly for the HOME club', () => {
    // 26-27-prem-arsenal-vs-coventry-city — Arsenal (3) is home.
    const result = resolveOpponentTeamCode('26-27-prem-arsenal-vs-coventry-city', 'prem', 3, CORE_CLUB_SLUG_TO_TEAM_CODE)
    expect(result).toEqual({ opponentTeamCode: 9, reason: null })
  })

  it('resolves the opponent correctly for the AWAY club', () => {
    // Same match — Coventry City (9) is away.
    const result = resolveOpponentTeamCode('26-27-prem-arsenal-vs-coventry-city', 'prem', 9, CORE_CLUB_SLUG_TO_TEAM_CODE)
    expect(result).toEqual({ opponentTeamCode: 3, reason: null })
  })

  it('resolves every GW1 prem fixture correctly, both directions, for all ten matches', () => {
    for (const fixture of GW1_PREM_FIXTURES) {
      const homeResult = resolveOpponentTeamCode(fixture.matchId, 'prem', fixture.home, CORE_CLUB_SLUG_TO_TEAM_CODE)
      expect(homeResult).toEqual({ opponentTeamCode: fixture.away, reason: null })
      const awayResult = resolveOpponentTeamCode(fixture.matchId, 'prem', fixture.away, CORE_CLUB_SLUG_TO_TEAM_CODE)
      expect(awayResult).toEqual({ opponentTeamCode: fixture.home, reason: null })
    }
  })

  // Ticket #285's own scope constraint: "no fuzzy matching... an unknown slug is still skipped
  // and counted" — a slug this map does not recognize resolves to null with a named reason,
  // never a guess.
  it('an unrecognized club slug is skipped and counted, never guessed', () => {
    const result = resolveOpponentTeamCode('26-27-prem-arsenal-vs-some-unmapped-club', 'prem', 3, CORE_CLUB_SLUG_TO_TEAM_CODE)
    expect(result.opponentTeamCode).toBeNull()
    expect(result.reason).toBe('club slug not found among known team codes')
  })

  it('a slug that IS in the map but for the wrong own-team-code is not guessed either', () => {
    // ownTeamCode 999 is neither club in this match.
    const result = resolveOpponentTeamCode('26-27-prem-arsenal-vs-coventry-city', 'prem', 999, CORE_CLUB_SLUG_TO_TEAM_CODE)
    expect(result.opponentTeamCode).toBeNull()
    expect(result.reason).toBe("own team_code not found among the match_id's two club slugs")
  })
})
