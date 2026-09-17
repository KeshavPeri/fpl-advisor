// Unit tests for scripts/ingest-match-odds.ts — ticket #238.
//
// This job's live Odds-API fetch and Supabase writes can't be exercised without a real network
// call and a live Supabase project (same limitation every scripts/*.ts test file already
// documents — see e.g. scripts/ingest-gameweek-live-stats.test.ts). Every function under test
// here is pure, with no I/O of its own, exercised directly on constructed payloads.

import { describe, expect, it } from 'vitest'
import {
  buildFixtureOddsRow,
  checkClubResolutionFloor,
  classifyOddsApiFixture,
  maskApiKeyInUrl,
  parseBookmakerH2hPrices,
  resolveFixtureIdForOdds,
  validateOddsApiShape,
  type FixtureCandidate,
  type RawOddsApiBookmaker,
  type RawOddsApiFixture,
} from './ingest-match-odds.ts'
import { ODDS_CLUB_NAME_TO_TEAM_CODE } from './lib/oddsClubNames.ts'
import { MAX_FIXTURE_DAYS_OUT, MIN_CLUB_RESOLUTION_RATE } from '../src/lib/projection/marketOdds.ts'

const DAY_MS = 24 * 60 * 60 * 1000
const NOW = Date.UTC(2026, 8, 15) // 15 Sept 2026, matching the ticket's own measurement date

function bookmaker(overrides: Partial<RawOddsApiBookmaker> & { key?: string } = {}): RawOddsApiBookmaker {
  return {
    key: 'bet365',
    markets: [{ key: 'h2h', outcomes: [{ name: 'Arsenal', price: 1.5 }, { name: 'Chelsea', price: 6.0 }, { name: 'Draw', price: 4.0 }] }],
    ...overrides,
  }
}

function fixture(overrides: Partial<RawOddsApiFixture> = {}): RawOddsApiFixture {
  return {
    id: 'abc123',
    commence_time: new Date(NOW + 3 * DAY_MS).toISOString(),
    home_team: 'Arsenal',
    away_team: 'Chelsea',
    bookmakers: [bookmaker()],
    ...overrides,
  }
}

// ============================================================================
// ODDS_CLUB_NAME_TO_TEAM_CODE — DoD-named test: "every one of the twenty names... resolves to a
// distinct code."
// ============================================================================

describe('ODDS_CLUB_NAME_TO_TEAM_CODE', () => {
  it('has exactly twenty entries', () => {
    expect(ODDS_CLUB_NAME_TO_TEAM_CODE.size).toBe(20)
  })

  it('every one of the twenty names resolves to a distinct (non-duplicate) team code', () => {
    const codes = Array.from(ODDS_CLUB_NAME_TO_TEAM_CODE.values())
    expect(codes.length).toBe(20)
    expect(new Set(codes).size).toBe(20) // no two names share a code
  })

  it('every code is a positive integer', () => {
    for (const code of ODDS_CLUB_NAME_TO_TEAM_CODE.values()) {
      expect(Number.isInteger(code)).toBe(true)
      expect(code).toBeGreaterThan(0)
    }
  })
})

// ============================================================================
// maskApiKeyInUrl — the live key must never reach a log line or thrown message.
// ============================================================================

describe('maskApiKeyInUrl', () => {
  it('replaces the apiKey query-string value, keeping the rest of the URL intact', () => {
    const url = 'https://api.the-odds-api.com/v4/sports/soccer_epl/odds?regions=uk&markets=h2h&oddsFormat=decimal&apiKey=super-secret-key'
    expect(maskApiKeyInUrl(url)).toBe('https://api.the-odds-api.com/v4/sports/soccer_epl/odds?regions=uk&markets=h2h&oddsFormat=decimal&apiKey=***')
  })

  it('does not throw and returns the URL unchanged when there is no apiKey parameter', () => {
    const url = 'https://api.the-odds-api.com/v4/sports/soccer_epl/odds?regions=uk'
    expect(maskApiKeyInUrl(url)).toBe(url)
  })
})

// ============================================================================
// validateOddsApiShape
// ============================================================================

describe('validateOddsApiShape', () => {
  it('does not throw for a well-formed array of fixtures', () => {
    expect(() => validateOddsApiShape([fixture()], 'endpoint')).not.toThrow()
  })

  it('throws when the response is not an array', () => {
    expect(() => validateOddsApiShape({ elements: [] }, 'endpoint')).toThrow(/not a JSON array/)
  })

  it('throws when a fixture is missing commence_time/home_team/away_team', () => {
    const bad = [{ home_team: 'Arsenal', away_team: 'Chelsea', bookmakers: [] }]
    expect(() => validateOddsApiShape(bad, 'endpoint')).toThrow(/missing commence_time/)
  })

  it('throws when a fixture is missing a "bookmakers" array', () => {
    const bad = [{ commence_time: new Date().toISOString(), home_team: 'Arsenal', away_team: 'Chelsea' }]
    expect(() => validateOddsApiShape(bad, 'endpoint')).toThrow(/missing a "bookmakers" array/)
  })

  it('an empty array is valid (handled by main() as "nothing to ingest", not a shape error)', () => {
    expect(() => validateOddsApiShape([], 'endpoint')).not.toThrow()
  })
})

// ============================================================================
// parseBookmakerH2hPrices
// ============================================================================

describe('parseBookmakerH2hPrices', () => {
  it('parses a well-formed h2h market into home/draw/away prices', () => {
    const result = parseBookmakerH2hPrices(bookmaker(), 'Arsenal', 'Chelsea')
    expect(result).toEqual({ home: 1.5, draw: 4.0, away: 6.0 })
  })

  it('returns null when the bookmaker carries no h2h market at all', () => {
    const b = bookmaker({ markets: [{ key: 'totals', outcomes: [] }] })
    expect(parseBookmakerH2hPrices(b, 'Arsenal', 'Chelsea')).toBeNull()
  })

  it('returns null when an outcome is missing (e.g. no Draw price)', () => {
    const b = bookmaker({ markets: [{ key: 'h2h', outcomes: [{ name: 'Arsenal', price: 1.5 }, { name: 'Chelsea', price: 6.0 }] }] })
    expect(parseBookmakerH2hPrices(b, 'Arsenal', 'Chelsea')).toBeNull()
  })

  it('returns null when a price is zero or negative (malformed, never treated as a real price)', () => {
    const b = bookmaker({ markets: [{ key: 'h2h', outcomes: [{ name: 'Arsenal', price: 0 }, { name: 'Chelsea', price: 6.0 }, { name: 'Draw', price: 4.0 }] }] })
    expect(parseBookmakerH2hPrices(b, 'Arsenal', 'Chelsea')).toBeNull()
  })
})

// ============================================================================
// classifyOddsApiFixture — covers the DoD-named "an unmapped club name is skipped and counted,
// never guessed" and "a fixture more than 35 days out is ignored".
// ============================================================================

describe('classifyOddsApiFixture', () => {
  it('a well-formed, in-range, mapped fixture with usable bookmaker prices classifies as "ok"', () => {
    const outcome = classifyOddsApiFixture(fixture(), NOW)
    expect(outcome.status).toBe('ok')
    if (outcome.status === 'ok') {
      expect(outcome.homeTeamCode).toBe(ODDS_CLUB_NAME_TO_TEAM_CODE.get('Arsenal'))
      expect(outcome.awayTeamCode).toBe(ODDS_CLUB_NAME_TO_TEAM_CODE.get('Chelsea'))
      expect(outcome.bookmakerPrices).toEqual([{ home: 1.5, draw: 4.0, away: 6.0 }])
    }
  })

  it('an unmapped home club name is skipped and counted (never guessed) -- DoD-named test', () => {
    const outcome = classifyOddsApiFixture(fixture({ home_team: 'Luton Town' }), NOW)
    expect(outcome.status).toBe('unmapped-club')
    if (outcome.status === 'unmapped-club') {
      expect(outcome.unmappedNames).toEqual(['Luton Town'])
    }
  })

  it('an unmapped away club name is skipped and counted (never guessed)', () => {
    const outcome = classifyOddsApiFixture(fixture({ away_team: 'Luton Town' }), NOW)
    expect(outcome.status).toBe('unmapped-club')
    if (outcome.status === 'unmapped-club') {
      expect(outcome.unmappedNames).toEqual(['Luton Town'])
    }
  })

  it('both club names unmapped are both reported', () => {
    const outcome = classifyOddsApiFixture(fixture({ home_team: 'Luton Town', away_team: 'Portsmouth' }), NOW)
    expect(outcome.status).toBe('unmapped-club')
    if (outcome.status === 'unmapped-club') {
      expect(outcome.unmappedNames).toEqual(['Luton Town', 'Portsmouth'])
    }
  })

  it('a fixture more than 35 days out is ignored -- DoD-named test', () => {
    const tooFarOut = fixture({ commence_time: new Date(NOW + (MAX_FIXTURE_DAYS_OUT + 1) * DAY_MS).toISOString() })
    expect(classifyOddsApiFixture(tooFarOut, NOW).status).toBe('too-far-out')
  })

  it('a fixture exactly AT the 35-day boundary is NOT ignored (inclusive)', () => {
    const atBoundary = fixture({ commence_time: new Date(NOW + MAX_FIXTURE_DAYS_OUT * DAY_MS).toISOString() })
    expect(classifyOddsApiFixture(atBoundary, NOW).status).toBe('ok')
  })

  it('club-name resolution is checked BEFORE the day cap -- an unmapped AND far-out fixture is still "unmapped-club"', () => {
    const bad = fixture({ home_team: 'Luton Town', commence_time: new Date(NOW + 100 * DAY_MS).toISOString() })
    expect(classifyOddsApiFixture(bad, NOW).status).toBe('unmapped-club')
  })

  it('a mapped, in-range fixture with no usable bookmaker prices classifies as "no-usable-bookmaker-prices"', () => {
    const noBooks = fixture({ bookmakers: [bookmaker({ markets: [{ key: 'totals', outcomes: [] }] })] })
    expect(classifyOddsApiFixture(noBooks, NOW).status).toBe('no-usable-bookmaker-prices')
  })

  it('multiple bookmakers: a malformed one is dropped, a well-formed one is kept', () => {
    const mixed = fixture({
      bookmakers: [bookmaker({ key: 'good', markets: [{ key: 'h2h', outcomes: [{ name: 'Arsenal', price: 1.6 }, { name: 'Chelsea', price: 5.5 }, { name: 'Draw', price: 4.2 }] }] }), bookmaker({ key: 'bad', markets: [] })],
    })
    const outcome = classifyOddsApiFixture(mixed, NOW)
    expect(outcome.status).toBe('ok')
    if (outcome.status === 'ok') {
      expect(outcome.bookmakerPrices).toHaveLength(1)
    }
  })
})

// ============================================================================
// checkClubResolutionFloor — DoD-named test: "the 80% resolution floor fails the job."
// ============================================================================

describe('checkClubResolutionFloor', () => {
  it('passes at exactly the 80% floor', () => {
    const result = checkClubResolutionFloor(10, 2) // 8/10 = 80%
    expect(result.rate).toBeCloseTo(0.8, 10)
    expect(result.passed).toBe(true)
  })

  it('fails below the 80% floor -- DoD-named test', () => {
    const result = checkClubResolutionFloor(10, 3) // 7/10 = 70%
    expect(result.rate).toBeCloseTo(0.7, 10)
    expect(result.passed).toBe(false)
  })

  it('passes vacuously when nothing was fetched at all (0/0 is not treated as a broken mapping)', () => {
    const result = checkClubResolutionFloor(0, 0)
    expect(result.passed).toBe(true)
    expect(result.rate).toBe(1)
  })

  it('uses MIN_CLUB_RESOLUTION_RATE as its default floor', () => {
    const failingRate = MIN_CLUB_RESOLUTION_RATE - 0.01
    const total = 100
    const unmapped = Math.round((1 - failingRate) * total)
    expect(checkClubResolutionFloor(total, unmapped).passed).toBe(false)
  })
})

// ============================================================================
// resolveFixtureIdForOdds
// ============================================================================

describe('resolveFixtureIdForOdds', () => {
  const candidates: FixtureCandidate[] = [
    { id: 101, homeTeamId: 1, awayTeamId: 2, kickoffTimeMs: NOW + DAY_MS },
    { id: 202, homeTeamId: 3, awayTeamId: 4, kickoffTimeMs: NOW + 2 * DAY_MS },
  ]

  it('resolves the single matching (home, away) team-id pair', () => {
    expect(resolveFixtureIdForOdds(1, 2, NOW + DAY_MS, candidates)).toBe(101)
  })

  it('returns null when no fixture matches the team-id pair', () => {
    expect(resolveFixtureIdForOdds(1, 99, NOW, candidates)).toBeNull()
  })

  it('when multiple candidates share the same team-id pair, picks the one closest to commence_time', () => {
    const twoMeetings: FixtureCandidate[] = [
      { id: 1, homeTeamId: 5, awayTeamId: 6, kickoffTimeMs: NOW },
      { id: 2, homeTeamId: 5, awayTeamId: 6, kickoffTimeMs: NOW + 100 * DAY_MS },
    ]
    expect(resolveFixtureIdForOdds(5, 6, NOW + 2 * DAY_MS, twoMeetings)).toBe(1)
    expect(resolveFixtureIdForOdds(5, 6, NOW + 90 * DAY_MS, twoMeetings)).toBe(2)
  })

  it('when multiple candidates match and none has a known kickoff, returns the first one rather than guessing further', () => {
    const twoUnknownKickoffs: FixtureCandidate[] = [
      { id: 1, homeTeamId: 5, awayTeamId: 6, kickoffTimeMs: null },
      { id: 2, homeTeamId: 5, awayTeamId: 6, kickoffTimeMs: null },
    ]
    expect(resolveFixtureIdForOdds(5, 6, NOW, twoUnknownKickoffs)).toBe(1)
  })
})

// ============================================================================
// buildFixtureOddsRow
// ============================================================================

describe('buildFixtureOddsRow', () => {
  it('wires medianOddsAcrossBooks and removeOverround into the row shape unchanged', () => {
    const row = buildFixtureOddsRow(42, [{ home: 2.0, draw: 3.5, away: 4.0 }], '2026-09-15T12:00:00.000Z')
    expect(row.fixture_id).toBe(42)
    expect(row.fetched_at).toBe('2026-09-15T12:00:00.000Z')
    expect(row.book_count).toBe(1)
    expect(row.median_home).toBe(2.0)
    expect(row.median_draw).toBe(3.5)
    expect(row.median_away).toBe(4.0)
    expect(row.p_home).toBeCloseTo(14 / 29, 10)
    expect(row.p_draw).toBeCloseTo(8 / 29, 10)
    expect(row.p_away).toBeCloseTo(7 / 29, 10)
    expect(row.overround).toBeCloseTo(29 / 28, 10)
  })

  it('book_count is exactly the number of bookmaker rows supplied', () => {
    const row = buildFixtureOddsRow(1, [{ home: 2, draw: 3, away: 4 }, { home: 1.9, draw: 3.2, away: 4.5 }, { home: 2.1, draw: 3.4, away: 3.8 }], 'ts')
    expect(row.book_count).toBe(3)
  })
})
