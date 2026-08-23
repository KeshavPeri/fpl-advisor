import { describe, expect, it } from 'vitest'
import { deriveCommitView, isAlreadyCommittedError, UNIQUE_VIOLATION_CODE } from './derive.ts'
import type { StoredCommitDecision } from './types.ts'

describe('deriveCommitView', () => {
  it('offers the commit control, enabled, with the label "Commit", when no decision is stored', () => {
    const view = deriveCommitView(null, null)
    expect(view.isCommitted).toBe(false)
    expect(view.buttonLabel).toBe('Commit')
    expect(view.buttonDisabled).toBe(false)
    expect(view.errorMessage).toBeNull()
  })

  it('renders as committed, disabled, with the label "Committed" — never Submit/Save/Done — when a decision is stored', () => {
    const decision: StoredCommitDecision = { decidedAt: '2026-08-22T10:00:00Z' }
    const view = deriveCommitView(decision, null)
    expect(view.isCommitted).toBe(true)
    expect(view.buttonLabel).toBe('Committed')
    expect(view.buttonDisabled).toBe(true)
    expect(view.buttonLabel).not.toBe('Submit')
    expect(view.buttonLabel).not.toBe('Save')
    expect(view.buttonLabel).not.toBe('Done')
  })

  it('the committed state is driven entirely by the stored decision, present vs absent — this is what makes it survive a reload', () => {
    const decision: StoredCommitDecision = { decidedAt: '2026-08-22T10:00:00Z' }
    expect(deriveCommitView(decision, null).isCommitted).toBe(true)
    expect(deriveCommitView(null, null).isCommitted).toBe(false)
  })

  it('carries no error message when there has been no write failure', () => {
    expect(deriveCommitView(null, null).errorMessage).toBeNull()
  })

  it('renders a specific message saying what failed and what to do, not a generic error, on a write failure', () => {
    const view = deriveCommitView(null, 'permission denied for table recommendation_decisions')
    expect(view.errorMessage).toBe(
      "Couldn't record the commit: permission denied for table recommendation_decisions. Tap Commit to try again."
    )
    // Specific, not generic — and legible on its own.
    expect(view.errorMessage).not.toBe('Something went wrong.')
    expect(view.errorMessage).not.toBe('Error')
  })

  it('leaves the control interactable (not stuck showing "Committed") after a write failure, so the user can retry', () => {
    const view = deriveCommitView(null, 'network error')
    expect(view.isCommitted).toBe(false)
    expect(view.buttonLabel).toBe('Commit')
    expect(view.buttonDisabled).toBe(false)
  })

  it('a stored decision always wins over a stale write-error message — once committed, the error is moot', () => {
    const decision: StoredCommitDecision = { decidedAt: '2026-08-22T10:00:00Z' }
    const view = deriveCommitView(decision, 'some earlier transient error')
    expect(view.isCommitted).toBe(true)
    expect(view.errorMessage).toBeNull()
  })
})

describe('isAlreadyCommittedError', () => {
  it('is true for Postgres\' unique_violation code (23505)', () => {
    expect(isAlreadyCommittedError(UNIQUE_VIOLATION_CODE)).toBe(true)
    expect(isAlreadyCommittedError('23505')).toBe(true)
  })

  it('is false for any other error code, including null/undefined', () => {
    expect(isAlreadyCommittedError('42501')).toBe(false)
    expect(isAlreadyCommittedError('')).toBe(false)
    expect(isAlreadyCommittedError(null)).toBe(false)
    expect(isAlreadyCommittedError(undefined)).toBe(false)
  })
})
