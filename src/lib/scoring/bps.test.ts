import { describe, expect, it } from 'vitest'
import { DEFENDER, FORWARD, GOALKEEPER, MIDFIELDER } from './types.ts'
import {
  APPEARANCE_BPS_60_PLUS,
  APPEARANCE_BPS_UNDER_60,
  ASSIST_BPS,
  CBI_ACTIONS_PER_BPS,
  CLEAN_SHEET_BPS_GOALKEEPER_DEFENDER,
  GOAL_BPS_FORWARD,
  GOAL_BPS_GOALKEEPER_DEFENDER,
  GOAL_BPS_MIDFIELDER,
  ORDINARY_SAVE_BPS,
  RECOVERY_ACTIONS_PER_BPS,
  bpsFromBeingTackled,
  bpsFromCbi,
  bpsFromSave,
  bpsFromSaves,
  cleanSheetBps,
  goalBps,
} from './bps.ts'

describe('BPS from CBI — 2026/27 is 1 per 3 actions (was 2)', () => {
  it('2 CBI actions score 0 BPS', () => {
    expect(bpsFromCbi(2)).toBe(0)
  })

  it('3 CBI actions score 1 BPS', () => {
    expect(bpsFromCbi(3)).toBe(1)
  })

  it('5 CBI actions score 1 BPS (incomplete second group of three)', () => {
    expect(bpsFromCbi(5)).toBe(1)
  })

  it('6 CBI actions score 2 BPS', () => {
    expect(bpsFromCbi(6)).toBe(2)
  })
})

describe('BPS from being tackled — 2026/27 removes the penalty', () => {
  it('being tackled contributes 0 BPS', () => {
    expect(bpsFromBeingTackled()).toBe(0)
  })
})

describe('goalkeeper BPS from saves — 2026/27 values, per save', () => {
  it('one ordinary save scores 2 BPS', () => {
    expect(bpsFromSave({ insideBox: false, isBigChance: false, isPenaltySave: false })).toBe(2)
  })

  it('one save inside the box scores 3 BPS', () => {
    expect(bpsFromSave({ insideBox: true, isBigChance: false, isPenaltySave: false })).toBe(3)
  })

  it('one save of a big chance scores 3 BPS', () => {
    expect(bpsFromSave({ insideBox: false, isBigChance: true, isPenaltySave: false })).toBe(3)
  })

  it('one save inside the box that is also a big chance scores 4 BPS', () => {
    expect(bpsFromSave({ insideBox: true, isBigChance: true, isPenaltySave: false })).toBe(4)
  })

  it('a penalty save scores a flat 7 BPS (down from 8), not stacked with ordinary save BPS', () => {
    expect(bpsFromSave({ insideBox: true, isBigChance: true, isPenaltySave: true })).toBe(7)
  })

  it('three ordinary saves in a match accumulate to 6 BPS, not a flat per-match award', () => {
    const saves = [
      { insideBox: false, isBigChance: false, isPenaltySave: false },
      { insideBox: false, isBigChance: false, isPenaltySave: false },
      { insideBox: false, isBigChance: false, isPenaltySave: false },
    ]
    expect(bpsFromSaves(saves)).toBe(6)
  })
})

// ============================================================================
// Ticket #78 — the wider BPS table needed to project bonus, not just settle
// a finished match's CBI/save/tackle terms. Values verified against
// premierleague.com/en/news/106533 and .../4679946 — see bps.ts's header.
// ============================================================================

describe('the wider BPS table (ticket #78) matches the two named Premier League sources', () => {
  it('appearance: 3 BPS for 1-59 minutes, 6 BPS for 60+', () => {
    expect(APPEARANCE_BPS_UNDER_60).toBe(3)
    expect(APPEARANCE_BPS_60_PLUS).toBe(6)
  })

  it('assist is a flat 9 BPS', () => {
    expect(ASSIST_BPS).toBe(9)
  })

  it('CBI and recoveries both convert at 1 BPS per 3 actions (the same divisor, verified independently)', () => {
    expect(CBI_ACTIONS_PER_BPS).toBe(3)
    expect(RECOVERY_ACTIONS_PER_BPS).toBe(3)
  })

  it('ORDINARY_SAVE_BPS (already used by bpsFromSave) is exported and equals 2', () => {
    expect(ORDINARY_SAVE_BPS).toBe(2)
  })
})

describe('goalBps — NOT the fplai.app-inverted values (12 for GK/DEF, not 24)', () => {
  it('goalkeeper and defender goals score 12 BPS', () => {
    expect(goalBps(GOALKEEPER)).toBe(12)
    expect(goalBps(DEFENDER)).toBe(12)
    expect(GOAL_BPS_GOALKEEPER_DEFENDER).toBe(12)
  })

  it('midfielder goals score 18 BPS', () => {
    expect(goalBps(MIDFIELDER)).toBe(18)
    expect(GOAL_BPS_MIDFIELDER).toBe(18)
  })

  it('forward goals score 24 BPS', () => {
    expect(goalBps(FORWARD)).toBe(24)
    expect(GOAL_BPS_FORWARD).toBe(24)
  })
})

describe('cleanSheetBps — goalkeepers and defenders only', () => {
  it('goalkeeper and defender clean sheets score 12 BPS', () => {
    expect(cleanSheetBps(GOALKEEPER)).toBe(12)
    expect(cleanSheetBps(DEFENDER)).toBe(12)
    expect(CLEAN_SHEET_BPS_GOALKEEPER_DEFENDER).toBe(12)
  })

  it('midfielders and forwards score 0 clean-sheet BPS', () => {
    expect(cleanSheetBps(MIDFIELDER)).toBe(0)
    expect(cleanSheetBps(FORWARD)).toBe(0)
  })
})
