// Unit tests for parseProjectionModelConfig — ticket #260. Pure, no filesystem: the file-reading
// half (readActiveModelVersionConfig) is a thin, untestable-without-a-real-file wrapper around
// this function, matching the convention every other scripts/*.ts job uses for its I/O boundary.

import { describe, expect, it } from 'vitest'
import { parseProjectionModelConfig } from './activeModelVersion.ts'

describe('parseProjectionModelConfig', () => {
  it('accepts a valid config', () => {
    expect(parseProjectionModelConfig('{"active":"baseline-v1","fallback":"baseline-v1"}')).toEqual({
      active: 'baseline-v1',
      fallback: 'baseline-v1',
    })
  })

  it('accepts active and fallback naming different models', () => {
    expect(parseProjectionModelConfig('{"active":"gbm-v1","fallback":"baseline-v1"}')).toEqual({
      active: 'gbm-v1',
      fallback: 'baseline-v1',
    })
  })

  it('throws on invalid JSON', () => {
    expect(() => parseProjectionModelConfig('not json')).toThrow(/not valid JSON/)
  })

  it('throws when "active" is missing', () => {
    expect(() => parseProjectionModelConfig('{"fallback":"baseline-v1"}')).toThrow(/"active"/)
  })

  it('throws when "fallback" is missing', () => {
    expect(() => parseProjectionModelConfig('{"active":"baseline-v1"}')).toThrow(/"fallback"/)
  })

  it('throws when "active" is an empty string', () => {
    expect(() => parseProjectionModelConfig('{"active":"","fallback":"baseline-v1"}')).toThrow(/"active"/)
  })

  it('throws when "fallback" is an empty string', () => {
    expect(() => parseProjectionModelConfig('{"active":"baseline-v1","fallback":""}')).toThrow(/"fallback"/)
  })

  it('throws when "active" is not a string', () => {
    expect(() => parseProjectionModelConfig('{"active":1,"fallback":"baseline-v1"}')).toThrow(/"active"/)
  })

  it('throws when the top level is not an object', () => {
    expect(() => parseProjectionModelConfig('["baseline-v1"]')).toThrow(/JSON object/)
    expect(() => parseProjectionModelConfig('"baseline-v1"')).toThrow(/JSON object/)
    expect(() => parseProjectionModelConfig('null')).toThrow(/JSON object/)
  })
})
