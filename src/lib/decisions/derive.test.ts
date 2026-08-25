import { describe, expect, it } from 'vitest'
import {
  EMPTY_STATE_MESSAGE,
  HIT_COST_NOT_RECORDED_TEXT,
  RECOMMENDATION_NOT_PRESERVED_NOTE,
  UNKNOWN_PLAYER_LABEL,
  deriveDecisionHistoryView,
} from './derive.ts'
import type { DecisionGameweek, DecisionHistorySource, DecisionSourceRow } from './types.ts'

const NAMES = new Map<number, string>([
  [101, 'Player In'],
  [102, 'Player Out'],
  [201, 'Salah'],
  [202, 'Haaland'],
])

const GW1: DecisionGameweek = { id: 1, name: 'Gameweek 1', deadlineTime: '2026-08-15T17:30:00Z' }
const GW2: DecisionGameweek = { id: 2, name: 'Gameweek 2', deadlineTime: '2026-08-22T17:30:00Z' }
const GW3: DecisionGameweek = { id: 3, name: 'Gameweek 3', deadlineTime: '2026-08-29T17:30:00Z' }
const GW4_FUTURE: DecisionGameweek = {
  id: 4,
  name: 'Gameweek 4',
  deadlineTime: '2099-01-01T17:30:00Z',
}

/** A fixed "now" that has passed GW1-GW3's deadlines but not GW4's. */
const NOW_MS = new Date('2026-09-01T12:00:00Z').getTime()

function commitRow(overrides: Partial<DecisionSourceRow> = {}): DecisionSourceRow {
  return {
    gameweekId: 1,
    gameweekName: 'Gameweek 1',
    planIndex: 0,
    kind: 'commit',
    decidedAt: '2026-08-14T09:00:00Z',
    snapshot: {
      isRoll: false,
      transferInPlayerId: 101,
      transferOutPlayerId: 102,
      captainPlayerId: 201,
      viceCaptainPlayerId: 202,
      hitCost: 0,
      solverRunId: 77,
    },
    ...overrides,
  }
}

function overrideRow(overrides: Partial<DecisionSourceRow> = {}): DecisionSourceRow {
  return {
    gameweekId: 2,
    gameweekName: 'Gameweek 2',
    planIndex: 0,
    kind: 'override',
    decidedAt: '2026-08-21T09:00:00Z',
    snapshot: {
      isRoll: true,
      transferInPlayerId: null,
      transferOutPlayerId: null,
      captainPlayerId: 201,
      viceCaptainPlayerId: 202,
      hitCost: null,
      solverRunId: 88,
    },
    ...overrides,
  }
}

function source(
  decisions: DecisionSourceRow[],
  gameweeks: DecisionGameweek[] = [GW1, GW2, GW3, GW4_FUTURE],
  playerNames: ReadonlyMap<number, string> = NAMES
): DecisionHistorySource {
  return { decisions, gameweeks, playerNames }
}

describe('deriveDecisionHistoryView — ordering', () => {
  it('orders entries newest first by decided_at', () => {
    const oldest = commitRow({ gameweekId: 1, decidedAt: '2026-08-14T09:00:00Z' })
    const newest = overrideRow({ gameweekId: 3, decidedAt: '2026-08-28T09:00:00Z' })
    const middle = commitRow({ gameweekId: 2, decidedAt: '2026-08-21T09:00:00Z' })

    const view = deriveDecisionHistoryView(source([oldest, middle, newest]), NOW_MS)

    expect(view.entries.map((e) => e.gameweekId)).toEqual([3, 2, 1])
  })
})

describe('deriveDecisionHistoryView — commit entries render from the snapshot alone', () => {
  it('a commit entry states the gameweek and the decision in player names, sourced only from DecisionSourceRow (no recommendation data exists in the input type at all)', () => {
    const row = commitRow()
    const view = deriveDecisionHistoryView(source([row]), NOW_MS)

    expect(view.entries).toHaveLength(1)
    const entry = view.entries[0]
    expect(entry.gameweekName).toBe('Gameweek 1')
    expect(entry.kind).toBe('commit')
    expect(entry.kindLabel).toBe('Committed')
    expect(entry.recorded.transferText).toBe('Player Out out, Player In in')
    expect(entry.recorded.captainText).toBe('Salah')
    expect(entry.recorded.viceCaptainText).toBe('Haaland')
    expect(entry.recorded.hitCostText).toBe('No hit taken')
    // A commit is, by definition, acceptance of the recommendation as given
    // — no gap note.
    expect(entry.recommendationGapNote).toBeNull()
  })
})

describe('deriveDecisionHistoryView — override entries (decisions/ticket-103.md ruling)', () => {
  // The original three named-test scenarios (captain-only differs,
  // transfer-only differs, both differ) are rewritten per the ruling: there
  // is no "recommended" side in scope to diff against
  // (recommendation_decisions.snapshot never stored one — see types.ts's
  // header), so each scenario below asserts the RECORDED values render
  // accurately for that shape of override, and the honest gap note appears
  // every time, rather than asserting which field differs.

  it('override entry (captain/vice-captain scenario) renders the recorded captain and vice-captain accurately, plus the honest recommendation-gap note', () => {
    const row = overrideRow({
      snapshot: {
        isRoll: true,
        transferInPlayerId: null,
        transferOutPlayerId: null,
        captainPlayerId: 202,
        viceCaptainPlayerId: 201,
        hitCost: null,
        solverRunId: 88,
      },
    })
    const view = deriveDecisionHistoryView(source([row]), NOW_MS)
    const entry = view.entries[0]

    expect(entry.kind).toBe('override')
    expect(entry.kindLabel).toBe('Registered override')
    expect(entry.recorded.captainText).toBe('Haaland')
    expect(entry.recorded.viceCaptainText).toBe('Salah')
    expect(entry.recorded.transferText).toBe('Rolled the transfer')
    expect(entry.recommendationGapNote).toBe(RECOMMENDATION_NOT_PRESERVED_NOTE)
  })

  it('override entry (transfer scenario) renders the recorded transfer accurately, plus the honest recommendation-gap note', () => {
    const row = overrideRow({
      snapshot: {
        isRoll: false,
        transferInPlayerId: 101,
        transferOutPlayerId: 102,
        captainPlayerId: 201,
        viceCaptainPlayerId: 202,
        hitCost: null,
        solverRunId: 88,
      },
    })
    const view = deriveDecisionHistoryView(source([row]), NOW_MS)
    const entry = view.entries[0]

    expect(entry.recorded.transferText).toBe('Player Out out, Player In in')
    expect(entry.recorded.captainText).toBe('Salah')
    expect(entry.recorded.viceCaptainText).toBe('Haaland')
    expect(entry.recommendationGapNote).toBe(RECOMMENDATION_NOT_PRESERVED_NOTE)
  })

  it('override entry (captain and transfer both scenario) renders every recorded field accurately, plus the honest recommendation-gap note', () => {
    const row = overrideRow({
      snapshot: {
        isRoll: false,
        transferInPlayerId: 101,
        transferOutPlayerId: 102,
        captainPlayerId: 202,
        viceCaptainPlayerId: 201,
        hitCost: null,
        solverRunId: 88,
      },
    })
    const view = deriveDecisionHistoryView(source([row]), NOW_MS)
    const entry = view.entries[0]

    expect(entry.recorded.transferText).toBe('Player Out out, Player In in')
    expect(entry.recorded.captainText).toBe('Haaland')
    expect(entry.recorded.viceCaptainText).toBe('Salah')
    expect(entry.recommendationGapNote).toBe(RECOMMENDATION_NOT_PRESERVED_NOTE)
  })
})

describe('deriveDecisionHistoryView — missing optional fields', () => {
  it('a roll renders "Rolled the transfer" rather than showing null transfer ids', () => {
    const row = commitRow({
      snapshot: {
        isRoll: true,
        transferInPlayerId: null,
        transferOutPlayerId: null,
        captainPlayerId: 201,
        viceCaptainPlayerId: 202,
        hitCost: 0,
        solverRunId: 77,
      },
    })
    const view = deriveDecisionHistoryView(source([row]), NOW_MS)
    expect(view.entries[0].recorded.transferText).toBe('Rolled the transfer')
  })

  it("an override's null hit_cost renders as not recorded, never as zero", () => {
    const row = overrideRow()
    const view = deriveDecisionHistoryView(source([row]), NOW_MS)
    expect(view.entries[0].recorded.hitCostText).toBe(HIT_COST_NOT_RECORDED_TEXT)
    expect(view.entries[0].recorded.hitCostText).not.toContain('0')
    expect(view.entries[0].recorded.hitCostText).not.toContain('null')
  })

  it('a real hit cost on a commit renders the exact figure, distinct from "no hit" and "not recorded"', () => {
    const row = commitRow({
      snapshot: {
        isRoll: false,
        transferInPlayerId: 101,
        transferOutPlayerId: 102,
        captainPlayerId: 201,
        viceCaptainPlayerId: 202,
        hitCost: 4,
        solverRunId: 77,
      },
    })
    const view = deriveDecisionHistoryView(source([row]), NOW_MS)
    expect(view.entries[0].recorded.hitCostText).toBe('Took a 4-point hit')
  })
})

describe('deriveDecisionHistoryView — unresolvable player id', () => {
  it('renders an explicit unknown-player label and keeps the entry (does not drop it)', () => {
    const row = commitRow({
      snapshot: {
        isRoll: false,
        transferInPlayerId: 9999,
        transferOutPlayerId: 102,
        captainPlayerId: 9998,
        viceCaptainPlayerId: 202,
        hitCost: 0,
        solverRunId: 77,
      },
    })
    const view = deriveDecisionHistoryView(source([row]), NOW_MS)

    expect(view.entries).toHaveLength(1)
    const entry = view.entries[0]
    expect(entry.recorded.transferText).toBe(`Player Out out, ${UNKNOWN_PLAYER_LABEL} in`)
    expect(entry.recorded.captainText).toBe(UNKNOWN_PLAYER_LABEL)
  })
})

describe('deriveDecisionHistoryView — headline reconciliation', () => {
  it('commits + overrides = decisionsRecorded, and decisionsRecorded + gameweeksWithNoDecision = gameweeksElapsed', () => {
    // GW1, GW2, GW3 have elapsed by NOW_MS; GW4 has not. Of the elapsed
    // three, GW1 has a commit, GW2 has an override, GW3 has nothing.
    const decisions = [
      commitRow({ gameweekId: 1, decidedAt: '2026-08-14T09:00:00Z' }),
      overrideRow({ gameweekId: 2, decidedAt: '2026-08-21T09:00:00Z' }),
    ]
    const view = deriveDecisionHistoryView(source(decisions), NOW_MS)

    expect(view.headline).toEqual({
      decisionsRecorded: 2,
      commits: 1,
      overrides: 1,
      gameweeksElapsed: 3,
      gameweeksWithNoDecision: 1,
    })
    expect(view.headline.commits + view.headline.overrides).toBe(view.headline.decisionsRecorded)
    expect(view.headline.decisionsRecorded + view.headline.gameweeksWithNoDecision).toBe(
      view.headline.gameweeksElapsed
    )
  })

  it('reconciles at zero decisions — every elapsed gameweek counts as having no decision', () => {
    const view = deriveDecisionHistoryView(source([]), NOW_MS)
    expect(view.headline).toEqual({
      decisionsRecorded: 0,
      commits: 0,
      overrides: 0,
      gameweeksElapsed: 3,
      gameweeksWithNoDecision: 3,
    })
  })
})

describe('deriveDecisionHistoryView — empty state', () => {
  it('names what is missing and how a decision is recorded when nothing has been decided yet', () => {
    const view = deriveDecisionHistoryView(source([]), NOW_MS)
    expect(view.hasEntries).toBe(false)
    expect(view.entries).toEqual([])
    expect(view.emptyStateMessage).toBe(EMPTY_STATE_MESSAGE)
    expect(view.emptyStateMessage).toMatch(/commit/i)
    expect(view.emptyStateMessage).toMatch(/override/i)
  })

  it('has no empty-state message once at least one decision exists', () => {
    const view = deriveDecisionHistoryView(source([commitRow()]), NOW_MS)
    expect(view.hasEntries).toBe(true)
    expect(view.emptyStateMessage).toBeNull()
  })
})
