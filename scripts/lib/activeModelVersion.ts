// Which projection model_version the solver/app use — ticket #260.
//
// config/projection-model.json is the one switch: "active" is the model
// every job below reads by default, "fallback" is what covers a (player,
// gameweek) pair "active" has no row for. Today both are 'baseline-v1', so
// nothing changes; after gbm-v1 exists this file becomes a one-line edit
// (docs/model-diagnosis-2026-09-24.md §9.3) rather than five.
//
// Read via `new URL(..., import.meta.url)` so it resolves relative to this
// file on disk, not to whatever the process's cwd happens to be.

import { readFileSync } from 'node:fs'

export interface ProjectionModelConfig {
  active: string
  fallback: string
}

/** Pure — parses and validates already-read file text. No I/O, directly unit-testable. */
export function parseProjectionModelConfig(text: string): ProjectionModelConfig {
  let data: unknown
  try {
    data = JSON.parse(text)
  } catch (err) {
    throw new Error(`config/projection-model.json is not valid JSON: ${err instanceof Error ? err.message : String(err)}`)
  }
  if (typeof data !== 'object' || data === null || Array.isArray(data)) {
    throw new Error('config/projection-model.json must be a JSON object with "active" and "fallback" string fields.')
  }
  const { active, fallback } = data as Record<string, unknown>
  if (typeof active !== 'string' || active.trim() === '') {
    throw new Error('config/projection-model.json: "active" must be a non-empty string.')
  }
  if (typeof fallback !== 'string' || fallback.trim() === '') {
    throw new Error('config/projection-model.json: "fallback" must be a non-empty string.')
  }
  return { active, fallback }
}

/** Reads and parses config/projection-model.json off disk. Throws (via parseProjectionModelConfig, or on a read failure) rather than returning a partial/default config. */
export function readActiveModelVersionConfig(): ProjectionModelConfig {
  const configUrl = new URL('../../config/projection-model.json', import.meta.url)
  let text: string
  try {
    text = readFileSync(configUrl, 'utf8')
  } catch (err) {
    throw new Error(`could not read config/projection-model.json: ${err instanceof Error ? err.message : String(err)}`)
  }
  return parseProjectionModelConfig(text)
}
