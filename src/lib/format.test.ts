import { describe, expect, it } from 'vitest'
import { toErrorMessage } from './format'

describe('toErrorMessage', () => {
  it('reads .message off a real Error', () => {
    expect(toErrorMessage(new Error('network down'))).toBe('network down')
  })

  it('reads .message off a plain Postgrest-shaped error object (QA, ticket #13 round 1)', () => {
    // What supabase-js actually resolves with on an RLS/permission/network
    // failure: { data: null, error: { message, details, hint, code } }. The
    // error is a plain object, not an Error instance — regression-tests the
    // "[object Object]" bug QA found in both SquadEntryScreen.tsx catch
    // blocks and confirmed traces back to src/lib/squad/api.ts throwing
    // this shape unwrapped.
    const postgrestError = {
      message: 'permission denied for table squads',
      details: null,
      hint: null,
      code: '42501',
    }
    expect(toErrorMessage(postgrestError)).toBe('permission denied for table squads')
    expect(toErrorMessage(postgrestError)).not.toBe('[object Object]')
  })

  it('falls back to String() for a value with no usable .message', () => {
    expect(toErrorMessage('already a string')).toBe('already a string')
    expect(toErrorMessage({ notMessage: 'x' })).toBe('[object Object]')
    expect(toErrorMessage(null)).toBe('null')
  })
})
