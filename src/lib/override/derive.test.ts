import { describe, expect, it } from 'vitest'
import {
  IDENTICAL_TO_RECOMMENDATION_MESSAGE,
  UNIQUE_VIOLATION_CODE,
  buildOverrideTarget,
  buildTransferChoice,
  compareToRecommendation,
  deriveOverrideAccess,
  deriveOverrideFlowView,
  deriveOverrideWriteErrorMessage,
  deriveRegisteredOverrideView,
  elementTypeOf,
  isAlreadyRegisteredError,
  isEntryComplete,
  missingEntryFields,
  selectableTransferInPlayers,
  squadMemberOptions,
} from './derive.ts'
import type {
  OverrideEntry,
  OverridePlayerOption,
  OverrideRecommendation,
  StoredOverrideDecision,
} from './types.ts'

const RECOMMENDATION: OverrideRecommendation = {
  gameweekId: 5,
  planIndex: 0,
  gameweekName: 'Gameweek 5',
  isRoll: false,
  transferInPlayerId: 101,
  transferOutPlayerId: 102,
  captainPlayerId: 201,
  viceCaptainPlayerId: 202,
  solverRunId: 77,
  hitCost: 0,
}

const NAMES = new Map<number, string>([
  [101, 'Player In'],
  [102, 'Player Out'],
  [201, 'Salah'],
  [202, 'Haaland'],
  [301, 'Different Captain'],
  [302, 'Different Vice'],
  [401, 'Alt Out'],
  [402, 'Alt In'],
])

/** An entry identical to RECOMMENDATION in every field. */
function identicalEntry(): OverrideEntry {
  return {
    captainPlayerId: 201,
    viceCaptainPlayerId: 202,
    transfer: { kind: 'transfer', outPlayerId: 102, inPlayerId: 101 },
  }
}

function incompleteEntry(): OverrideEntry {
  return { captainPlayerId: 201, viceCaptainPlayerId: null, transfer: null }
}

describe('isEntryComplete / missingEntryFields', () => {
  it('is incomplete with everything unset', () => {
    const entry: OverrideEntry = { captainPlayerId: null, viceCaptainPlayerId: null, transfer: null }
    expect(isEntryComplete(entry)).toBe(false)
    expect(missingEntryFields(entry).length).toBeGreaterThan(0)
  })

  it('is incomplete when captain and vice-captain are the same player', () => {
    const entry: OverrideEntry = {
      captainPlayerId: 201,
      viceCaptainPlayerId: 201,
      transfer: { kind: 'roll' },
    }
    expect(isEntryComplete(entry)).toBe(false)
    expect(missingEntryFields(entry)).toContain('Captain and vice-captain must be different players')
  })

  it('is complete once captain, vice-captain (distinct) and a transfer decision are all set — roll case', () => {
    const entry: OverrideEntry = {
      captainPlayerId: 201,
      viceCaptainPlayerId: 202,
      transfer: { kind: 'roll' },
    }
    expect(isEntryComplete(entry)).toBe(true)
    expect(missingEntryFields(entry)).toEqual([])
  })

  it('is complete once captain, vice-captain (distinct) and a full transfer (out + in) are set', () => {
    expect(isEntryComplete(identicalEntry())).toBe(true)
  })
})

describe('buildTransferChoice', () => {
  it('returns a roll choice as soon as the mode is roll, independent of the player pickers', () => {
    expect(buildTransferChoice('roll', null, null)).toEqual({ kind: 'roll' })
  })

  it('returns null while mode is transfer but one or both players are unpicked', () => {
    expect(buildTransferChoice('transfer', null, null)).toBeNull()
    expect(buildTransferChoice('transfer', 102, null)).toBeNull()
    expect(buildTransferChoice('transfer', null, 101)).toBeNull()
  })

  it('returns a complete transfer choice once both players are picked', () => {
    expect(buildTransferChoice('transfer', 102, 101)).toEqual({
      kind: 'transfer',
      outPlayerId: 102,
      inPlayerId: 101,
    })
  })

  it('returns null while no mode has been chosen yet', () => {
    expect(buildTransferChoice('unset', 102, 101)).toBeNull()
  })
})

describe('deriveOverrideFlowView — the write cannot happen from step one', () => {
  it('exposes no confirmable state on the entry step, even with a complete entry', () => {
    const view = deriveOverrideFlowView({
      step: 'enter',
      entry: identicalEntry(),
      recommendation: RECOMMENDATION,
      playerNames: NAMES,
    })
    expect(view.comparison).toBeNull()
    expect(view.refusalMessage).toBeNull()
  })

  it('exposes no confirmable state on the confirm step when the entry is incomplete', () => {
    const view = deriveOverrideFlowView({
      step: 'confirm',
      entry: incompleteEntry(),
      recommendation: RECOMMENDATION,
      playerNames: NAMES,
    })
    expect(view.canContinue).toBe(false)
    expect(view.comparison).toBeNull()
    expect(view.refusalMessage).toBeNull()
  })

  it('reaching a confirmable state requires BOTH the confirm step and a complete entry', () => {
    const differingEntry: OverrideEntry = {
      captainPlayerId: 301,
      viceCaptainPlayerId: 202,
      transfer: { kind: 'transfer', outPlayerId: 102, inPlayerId: 101 },
    }
    const view = deriveOverrideFlowView({
      step: 'confirm',
      entry: differingEntry,
      recommendation: RECOMMENDATION,
      playerNames: NAMES,
    })
    expect(view.canContinue).toBe(true)
    expect(view.comparison).not.toBeNull()
  })
})

describe('compareToRecommendation / deriveOverrideFlowView — the confirm panel', () => {
  it('states both sides explicitly for every field, differing or not', () => {
    const comparison = compareToRecommendation(RECOMMENDATION, identicalEntry(), NAMES)
    expect(comparison.captain.recommendedText).toBe('Salah')
    expect(comparison.captain.actualText).toBe('Salah')
    expect(comparison.viceCaptain.recommendedText).toBe('Haaland')
    expect(comparison.viceCaptain.actualText).toBe('Haaland')
    expect(comparison.transfer.recommendedText).toBe('Player Out out, Player In in')
    expect(comparison.transfer.actualText).toBe('Player Out out, Player In in')
  })

  it('names captain as the only differing field when only the captain differs', () => {
    const entry: OverrideEntry = {
      captainPlayerId: 301,
      viceCaptainPlayerId: 202,
      transfer: { kind: 'transfer', outPlayerId: 102, inPlayerId: 101 },
    }
    const comparison = compareToRecommendation(RECOMMENDATION, entry, NAMES)
    expect(comparison.differingFieldLabels).toEqual(['Captain'])
    expect(comparison.captain.differs).toBe(true)
    expect(comparison.viceCaptain.differs).toBe(false)
    expect(comparison.transfer.differs).toBe(false)
    expect(comparison.captain.actualText).toBe('Different Captain')
  })

  it('names transfer as the only differing field when only the transfer differs', () => {
    const entry: OverrideEntry = {
      captainPlayerId: 201,
      viceCaptainPlayerId: 202,
      transfer: { kind: 'transfer', outPlayerId: 401, inPlayerId: 402 },
    }
    const comparison = compareToRecommendation(RECOMMENDATION, entry, NAMES)
    expect(comparison.differingFieldLabels).toEqual(['Transfer'])
    expect(comparison.captain.differs).toBe(false)
    expect(comparison.viceCaptain.differs).toBe(false)
    expect(comparison.transfer.differs).toBe(true)
    expect(comparison.transfer.actualText).toBe('Alt Out out, Alt In in')
  })

  it('names transfer as differing when a roll overrides an actual recommended transfer', () => {
    const entry: OverrideEntry = {
      captainPlayerId: 201,
      viceCaptainPlayerId: 202,
      transfer: { kind: 'roll' },
    }
    const comparison = compareToRecommendation(RECOMMENDATION, entry, NAMES)
    expect(comparison.differingFieldLabels).toEqual(['Transfer'])
    expect(comparison.transfer.actualText).toBe('Rolled the transfer')
  })

  it('names both captain and transfer when both differ', () => {
    const entry: OverrideEntry = {
      captainPlayerId: 301,
      viceCaptainPlayerId: 202,
      transfer: { kind: 'transfer', outPlayerId: 401, inPlayerId: 402 },
    }
    const comparison = compareToRecommendation(RECOMMENDATION, entry, NAMES)
    expect(comparison.differingFieldLabels).toEqual(['Captain', 'Transfer'])
  })

  it('names all three fields when captain, vice-captain and transfer all differ', () => {
    const entry: OverrideEntry = {
      captainPlayerId: 301,
      viceCaptainPlayerId: 302,
      transfer: { kind: 'transfer', outPlayerId: 401, inPlayerId: 402 },
    }
    const comparison = compareToRecommendation(RECOMMENDATION, entry, NAMES)
    expect(comparison.differingFieldLabels).toEqual(['Captain', 'Vice-captain', 'Transfer'])
  })
})

describe('deriveOverrideFlowView — refusing an entry identical to the recommendation', () => {
  it('refuses with a specific message naming Commit as the alternative, and exposes no comparison', () => {
    const view = deriveOverrideFlowView({
      step: 'confirm',
      entry: identicalEntry(),
      recommendation: RECOMMENDATION,
      playerNames: NAMES,
    })
    expect(view.comparison).toBeNull()
    expect(view.refusalMessage).toBe(IDENTICAL_TO_RECOMMENDATION_MESSAGE)
    expect(view.refusalMessage).toContain('Commit')
    // Specific, not generic.
    expect(view.refusalMessage).not.toBe('Something went wrong.')
  })

  it('does not refuse an entry that differs in even one field', () => {
    const entry: OverrideEntry = {
      captainPlayerId: 301,
      viceCaptainPlayerId: 202,
      transfer: { kind: 'transfer', outPlayerId: 102, inPlayerId: 101 },
    }
    const view = deriveOverrideFlowView({
      step: 'confirm',
      entry,
      recommendation: RECOMMENDATION,
      playerNames: NAMES,
    })
    expect(view.refusalMessage).toBeNull()
    expect(view.comparison).not.toBeNull()
  })
})

describe('buildOverrideTarget', () => {
  it('carries the recommendation\'s own gameweek, plan and solver run, with hit_cost null — transfer case', () => {
    const target = buildOverrideTarget(RECOMMENDATION, identicalEntry())
    expect(target.gameweekId).toBe(5)
    expect(target.planIndex).toBe(0)
    expect(target.isRoll).toBe(false)
    expect(target.transferOutPlayerId).toBe(102)
    expect(target.transferInPlayerId).toBe(101)
    expect(target.captainPlayerId).toBe(201)
    expect(target.viceCaptainPlayerId).toBe(202)
    expect(target.hitCost).toBeNull()
    expect(target.solverRunId).toBe(77)
  })

  it('records a roll as is_roll true with both transfer ids null', () => {
    const entry: OverrideEntry = {
      captainPlayerId: 201,
      viceCaptainPlayerId: 202,
      transfer: { kind: 'roll' },
    }
    const target = buildOverrideTarget(RECOMMENDATION, entry)
    expect(target.isRoll).toBe(true)
    expect(target.transferOutPlayerId).toBeNull()
    expect(target.transferInPlayerId).toBeNull()
    expect(target.hitCost).toBeNull()
  })

  it('throws rather than silently building a target from an incomplete entry', () => {
    expect(() => buildOverrideTarget(RECOMMENDATION, incompleteEntry())).toThrow()
  })

  // Ticket #107. This is the ticket's most important test (its own DoD's
  // words): a `toEqual` on the FULL object, not field-by-field assertions,
  // so an accidental rename or nesting of any one of the seven decided keys
  // fails the build exactly as loudly as a missing `recommended`.
  it('writes the exact shape stored in `snapshot`: the seven decided keys unchanged in name, position and value, plus a `recommended` object carrying the same seven field names from the recommendation', () => {
    const entry: OverrideEntry = {
      captainPlayerId: 301,
      viceCaptainPlayerId: 302,
      transfer: { kind: 'transfer', outPlayerId: 401, inPlayerId: 402 },
    }
    const target = buildOverrideTarget(RECOMMENDATION, entry)
    expect(target).toEqual({
      gameweekId: 5,
      planIndex: 0,
      isRoll: false,
      transferInPlayerId: 402,
      transferOutPlayerId: 401,
      captainPlayerId: 301,
      viceCaptainPlayerId: 302,
      hitCost: null,
      solverRunId: 77,
      recommended: {
        isRoll: false,
        transferInPlayerId: 101,
        transferOutPlayerId: 102,
        captainPlayerId: 201,
        viceCaptainPlayerId: 202,
        hitCost: 0,
        solverRunId: 77,
      },
    })
  })

  it('the `recommended` object always mirrors the recommendation, never the entry — a roll entry overriding an actual recommended transfer still records what was recommended', () => {
    const entry: OverrideEntry = {
      captainPlayerId: 201,
      viceCaptainPlayerId: 202,
      transfer: { kind: 'roll' },
    }
    const target = buildOverrideTarget(RECOMMENDATION, entry)
    expect(target.isRoll).toBe(true)
    expect(target.recommended).toEqual({
      isRoll: false,
      transferInPlayerId: 101,
      transferOutPlayerId: 102,
      captainPlayerId: 201,
      viceCaptainPlayerId: 202,
      hitCost: 0,
      solverRunId: 77,
    })
  })
})

const GK: OverridePlayerOption[] = [
  { id: 1, webName: 'GK One', elementType: 1 },
  { id: 2, webName: 'GK Two', elementType: 1 },
]
const DEF: OverridePlayerOption[] = [
  { id: 10, webName: 'Def Squad', elementType: 2 },
  { id: 11, webName: 'Def Bench Pool', elementType: 2 },
]
const MID: OverridePlayerOption[] = [{ id: 20, webName: 'Mid Squad', elementType: 3 }]
const POOL: OverridePlayerOption[] = [...GK, ...DEF, ...MID]
const SQUAD_IDS = new Set([1, 10, 20])

describe('squadMemberOptions', () => {
  it('keeps only the players whose id is in the squad set', () => {
    const members = squadMemberOptions(POOL, SQUAD_IDS)
    expect(members.map((p) => p.id).sort()).toEqual([1, 10, 20])
  })
})

describe('elementTypeOf', () => {
  it('resolves a known player id to its position', () => {
    expect(elementTypeOf(POOL, 10)).toBe(2)
  })

  it('returns null for a null id or an id not in the list', () => {
    expect(elementTypeOf(POOL, null)).toBeNull()
    expect(elementTypeOf(POOL, 9999)).toBeNull()
  })
})

describe('selectableTransferInPlayers', () => {
  it('offers only players in the same position as the transfer-out player', () => {
    const options = selectableTransferInPlayers(POOL, SQUAD_IDS, 2)
    expect(options.every((p) => p.elementType === 2)).toBe(true)
    expect(options.some((p) => p.elementType === 1)).toBe(false)
    expect(options.some((p) => p.elementType === 3)).toBe(false)
  })

  it('excludes players already in the squad, even when their position matches', () => {
    const options = selectableTransferInPlayers(POOL, SQUAD_IDS, 2)
    // id 10 is a DEF already in SQUAD_IDS — must not appear even though its
    // position matches; id 11 is a DEF NOT in the squad — must appear.
    expect(options.map((p) => p.id)).not.toContain(10)
    expect(options.map((p) => p.id)).toContain(11)
  })

  it('offers nothing until a transfer-out player (and so a position) is chosen', () => {
    expect(selectableTransferInPlayers(POOL, SQUAD_IDS, null)).toEqual([])
  })
})

describe('deriveOverrideAccess', () => {
  it('blocks the entry point when this gameweek already has a commit row', () => {
    expect(deriveOverrideAccess('2026-08-22T10:00:00Z', null)).toBe('blocked-commit')
  })

  it('shows the registered override instead of the form when one already exists', () => {
    const decision: StoredOverrideDecision = {
      decidedAt: '2026-08-22T10:00:00Z',
      snapshot: {
        isRoll: true,
        transferInPlayerId: null,
        transferOutPlayerId: null,
        captainPlayerId: 201,
        viceCaptainPlayerId: 202,
      },
    }
    expect(deriveOverrideAccess(null, decision)).toBe('registered')
  })

  it('a stored commit takes priority over a stored override, if both were ever present', () => {
    const decision: StoredOverrideDecision = {
      decidedAt: '2026-08-22T10:00:00Z',
      snapshot: {
        isRoll: true,
        transferInPlayerId: null,
        transferOutPlayerId: null,
        captainPlayerId: 201,
        viceCaptainPlayerId: 202,
      },
    }
    expect(deriveOverrideAccess('2026-08-22T10:00:00Z', decision)).toBe('blocked-commit')
  })

  it('opens the form when neither a commit nor an override exists yet', () => {
    expect(deriveOverrideAccess(null, null)).toBe('open')
  })
})

describe('deriveRegisteredOverrideView', () => {
  it('renders the stored snapshot in words, using the same labels a comparison would', () => {
    const decision: StoredOverrideDecision = {
      decidedAt: '2026-08-22T10:00:00Z',
      snapshot: {
        isRoll: false,
        transferInPlayerId: 101,
        transferOutPlayerId: 102,
        captainPlayerId: 201,
        viceCaptainPlayerId: 202,
      },
    }
    const view = deriveRegisteredOverrideView(decision, NAMES)
    expect(view.captainText).toBe('Salah')
    expect(view.viceCaptainText).toBe('Haaland')
    expect(view.transferText).toBe('Player Out out, Player In in')
  })

  it('renders a rolled transfer distinctly from a made one', () => {
    const decision: StoredOverrideDecision = {
      decidedAt: '2026-08-22T10:00:00Z',
      snapshot: {
        isRoll: true,
        transferInPlayerId: null,
        transferOutPlayerId: null,
        captainPlayerId: 201,
        viceCaptainPlayerId: 202,
      },
    }
    expect(deriveRegisteredOverrideView(decision, NAMES).transferText).toBe('Rolled the transfer')
  })
})

describe('deriveOverrideWriteErrorMessage', () => {
  it('carries no message when there has been no write failure', () => {
    expect(deriveOverrideWriteErrorMessage(null)).toBeNull()
  })

  it('renders a specific message saying what failed and what to do, not a generic error', () => {
    const message = deriveOverrideWriteErrorMessage('permission denied for table recommendation_decisions')
    expect(message).toBe(
      "Couldn't register the override: permission denied for table recommendation_decisions. Tap Register override to try again."
    )
    expect(message).not.toBe('Something went wrong.')
    expect(message).not.toBe('Error')
  })
})

describe('isAlreadyRegisteredError', () => {
  it('is true for Postgres\' unique_violation code (23505)', () => {
    expect(isAlreadyRegisteredError(UNIQUE_VIOLATION_CODE)).toBe(true)
    expect(isAlreadyRegisteredError('23505')).toBe(true)
  })

  it('is false for any other error code, including null/undefined', () => {
    expect(isAlreadyRegisteredError('42501')).toBe(false)
    expect(isAlreadyRegisteredError('')).toBe(false)
    expect(isAlreadyRegisteredError(null)).toBe(false)
    expect(isAlreadyRegisteredError(undefined)).toBe(false)
  })
})
