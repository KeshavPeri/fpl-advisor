// Unit tests for scripts/snapshot-predictions.ts's pure decision function — ticket #73. No
// Supabase, no network: decideSnapshotAction is exercised directly, matching the pure-function
// testing convention already established by scripts/emit-projections-csv.test.ts,
// scripts/store-solver-output.test.ts and src/lib/notification/schedule.test.ts.

import { describe, expect, it } from 'vitest'
import { decideSnapshotAction, modelVersionsToSnapshot } from './snapshot-predictions.ts'

const DEADLINE_ISO = '2026-09-19T10:00:00Z'
const DEADLINE_MS = new Date(DEADLINE_ISO).getTime()
const MINUTE_MS = 60 * 1000
const MODEL_VERSION = 'baseline-v1'

function decide(nowMs: number, projectionRowCount = 587, modelVersion = MODEL_VERSION) {
  return decideSnapshotAction({ gameweekId: 5, deadlineIso: DEADLINE_ISO, nowMs, projectionRowCount, modelVersion })
}

describe('decideSnapshotAction — before the deadline: capture (overwrite)', () => {
  it('captures one minute before the deadline', () => {
    const decision = decide(DEADLINE_MS - MINUTE_MS)
    expect(decision.outcome).toBe('captured')
  })

  it('captures with plenty of time remaining', () => {
    const threeDaysMs = 3 * 24 * 60 * MINUTE_MS
    expect(decide(DEADLINE_MS - threeDaysMs).outcome).toBe('captured')
  })
})

describe('decideSnapshotAction — at or after the deadline: freeze, never overwrite', () => {
  it('freezes exactly at the deadline instant (inclusive)', () => {
    const decision = decide(DEADLINE_MS)
    expect(decision.outcome).toBe('skipped-after-deadline')
  })

  it('freezes one minute after the deadline', () => {
    const decision = decide(DEADLINE_MS + MINUTE_MS)
    expect(decision.outcome).toBe('skipped-after-deadline')
    if (decision.outcome === 'skipped-after-deadline') {
      expect(decision.message).toMatch(/deadline/i)
      expect(decision.message).toMatch(/gameweek 5/)
    }
  })

  it('freezes long after the deadline, even with projections present', () => {
    const oneWeekMs = 7 * 24 * 60 * MINUTE_MS
    const decision = decide(DEADLINE_MS + oneWeekMs, 587)
    expect(decision.outcome).toBe('skipped-after-deadline')
  })

  it('freeze takes priority over the no-projections case — a deadline-passed gameweek with zero rows is still reported as frozen, not as "no projections"', () => {
    const decision = decide(DEADLINE_MS + MINUTE_MS, 0)
    expect(decision.outcome).toBe('skipped-after-deadline')
  })
})

describe('decideSnapshotAction — a gameweek with no projections', () => {
  it('skips with a named message and captures nothing, before the deadline', () => {
    const decision = decide(DEADLINE_MS - MINUTE_MS, 0)
    expect(decision.outcome).toBe('skipped-no-projections')
    if (decision.outcome === 'skipped-no-projections') {
      expect(decision.message).toMatch(/zero player_projections rows/)
      expect(decision.message).toMatch(new RegExp(MODEL_VERSION))
    }
  })
})

describe('decideSnapshotAction — modelVersion is named in the message', () => {
  it('names whichever model_version was passed in, not a fixed constant', () => {
    const decision = decide(DEADLINE_MS - MINUTE_MS, 0, 'gbm-v1')
    if (decision.outcome === 'skipped-no-projections') {
      expect(decision.message).toMatch(/model_version='gbm-v1'/)
    } else {
      throw new Error('expected skipped-no-projections')
    }
  })
})

describe('modelVersionsToSnapshot — ticket #260', () => {
  it('DoD item 4: returns a single entry when active === the secondary (baseline-v1) model', () => {
    expect(modelVersionsToSnapshot('baseline-v1')).toEqual(['baseline-v1'])
  })

  it('returns both, active first, when they differ', () => {
    expect(modelVersionsToSnapshot('gbm-v1')).toEqual(['gbm-v1', 'baseline-v1'])
  })

  it('dedupes against an explicit secondary model too, not only the default', () => {
    expect(modelVersionsToSnapshot('gbm-v1', 'gbm-v1')).toEqual(['gbm-v1'])
  })
})
