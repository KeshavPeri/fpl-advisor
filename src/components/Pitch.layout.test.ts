/**
 * Ticket #194, section E — the pitch's dimensional DoD, checked against
 * the literal committed CSS rather than against a browser (no rendering
 * harness is available in this environment — see PlayerShirt.
 * truncation.test.ts's own header for the same limitation). Every value
 * below is read out of the actual token/calc() expressions in
 * index.css / Pitch.css / PlayerShirt.css / AppShell.css, so this drifts
 * if and only if those files do.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const here = path.dirname(fileURLToPath(import.meta.url))
const indexCss = readFileSync(path.join(here, '..', 'index.css'), 'utf8')
const pitchCss = readFileSync(path.join(here, 'Pitch.css'), 'utf8')
const playerShirtCss = readFileSync(path.join(here, 'PlayerShirt.css'), 'utf8')
const appShellCss = readFileSync(path.join(here, 'AppShell.css'), 'utf8')

// ---- Tiny px resolver: --space-N tokens (all rem) plus calc(a + b) /
// calc(a - b) / calc(a / n) of two such tokens — everything this app's
// CSS actually composes its non-token pixel values from. ----

function remToPx(raw: string): number {
  const rem = raw.match(/([\d.]+)rem/)
  if (rem) return parseFloat(rem[1]) * 16
  const px = raw.match(/([\d.]+)px/)
  if (px) return parseFloat(px[1])
  throw new Error(`unrecognised length: "${raw}"`)
}

function spaceToken(name: string): number {
  const match = indexCss.match(new RegExp(`--${name}:\\s*([^;]+);`))
  if (!match) throw new Error(`token --${name} not found`)
  return remToPx(match[1].trim())
}

/** Resolves `var(--space-N)`, `calc(var(--space-N) + var(--space-M))`,
 *  `calc(var(--space-N) - var(--space-M))` and `calc(var(--space-N) / D)`
 *  — the only shapes Pitch.css/PlayerShirt.css use. */
function resolveLength(raw: string): number {
  const trimmed = raw.trim()
  const bare = trimmed.match(/^var\(--([\w-]+)\)$/)
  if (bare) return spaceToken(bare[1])

  const calc = trimmed.match(/^calc\((.+)\)$/)
  if (calc) {
    const expr = calc[1]
    const sum = expr.match(/^var\(--([\w-]+)\)\s*\+\s*var\(--([\w-]+)\)$/)
    if (sum) return spaceToken(sum[1]) + spaceToken(sum[2])
    const diff = expr.match(/^var\(--([\w-]+)\)\s*-\s*var\(--([\w-]+)\)$/)
    if (diff) return spaceToken(diff[1]) - spaceToken(diff[2])
    const div = expr.match(/^var\(--([\w-]+)\)\s*\/\s*(\d+)$/)
    if (div) return spaceToken(div[1]) / Number(div[2])
  }
  throw new Error(`unrecognised length expression: "${raw}"`)
}

function ruleBody(css: string, selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`selector "${selector}" not found`)
  return match[1]
}

function declaredLength(css: string, selector: string, property: string): number {
  const body = ruleBody(css, selector)
  const match = body.match(new RegExp(`${property}:\\s*([^;]+);`))
  if (!match) throw new Error(`"${property}" not declared on "${selector}"`)
  return resolveLength(match[1])
}

// ---- The values this file's DoD is actually about ----

const STARTING_SHIRT_WIDTH = declaredLength(playerShirtCss, '.player-shirt', 'width')
const BENCH_SHIRT_WIDTH = declaredLength(playerShirtCss, '.player-shirt--bench', 'width')
const ROW_GAP = declaredLength(pitchCss, '.pitch__row', 'gap')
const FIELD_ROW_TO_ROW_GAP = declaredLength(pitchCss, '.pitch__field', 'gap')
const NAME_PRICE_GAP = declaredLength(playerShirtCss, '.player-shirt', 'gap')

// The pre-#194 values (ticket #169's own F26/F27 fixes) — hand-recorded
// baselines, the same technique index.css.test.ts uses to pin the
// ticket-79 --material-2 luminance this ticket must beat.
const PREVIOUS_STARTING_SHIRT_WIDTH = 56 // calc(var(--space-12) + var(--space-2))
const PREVIOUS_FIELD_ROW_TO_ROW_GAP = 40 // calc(var(--space-6) + var(--space-4))
const PREVIOUS_NAME_PRICE_GAP = 4 // var(--space-1)

describe('#194, section E — the pitch is wider, tighter, and the bench stays subordinate', () => {
  it('the starting-XI shirt width is strictly greater than its pre-#194 value', () => {
    expect(STARTING_SHIRT_WIDTH).toBeGreaterThan(PREVIOUS_STARTING_SHIRT_WIDTH)
  })

  it('the bench shirt width is strictly less than the starting-XI width', () => {
    expect(BENCH_SHIRT_WIDTH).toBeLessThan(STARTING_SHIRT_WIDTH)
  })

  it('the bench is not built from Surface (no <Surface> import in Pitch.tsx\'s bench branch)', () => {
    const pitchTsx = readFileSync(path.join(here, 'Pitch.tsx'), 'utf8')
    expect(pitchTsx).not.toMatch(/import Surface/)
  })

  it('the row-to-row gap is strictly smaller than its pre-#194 value', () => {
    expect(FIELD_ROW_TO_ROW_GAP).toBeLessThan(PREVIOUS_FIELD_ROW_TO_ROW_GAP)
  })

  it('the name-to-price vertical gap is strictly smaller than its pre-#194 value', () => {
    expect(NAME_PRICE_GAP).toBeLessThan(PREVIOUS_NAME_PRICE_GAP)
  })

  it('on a 393px viewport, a five-shirt row plus its gaps spans at least 96% of the width remaining inside the retained side margin', () => {
    const VIEWPORT = 393
    // Pitch.tsx applies `.bleed-narrow` (AppShell.css), which leaves
    // var(--space-2) of margin on each side once env(safe-area-inset-*)
    // is 0 (portrait, no notch-side inset) — the case this DoD item is
    // written against. Confirm the rule shape first (the formula is
    // `-1 * (env(...) + --space-4 - --space-2)`, so the margin retained
    // once env() is zero is exactly --space-4 - --space-2), then compute
    // that retained margin directly — resolveLength's tiny arithmetic
    // parser doesn't handle the env()-bearing calc() itself.
    expect(ruleBody(appShellCss, '.bleed-narrow')).toMatch(
      /margin-left:\s*calc\(-1 \* \(env\(safe-area-inset-left\)\s*\+\s*var\(--space-4\)\s*-\s*var\(--space-2\)\)\)/
    )
    const retainedMargin = spaceToken('space-4') - spaceToken('space-2')
    const remaining = VIEWPORT - 2 * retainedMargin
    const rowWidth = 5 * STARTING_SHIRT_WIDTH + 4 * ROW_GAP
    expect(rowWidth).toBeLessThanOrEqual(remaining)
    expect(rowWidth / remaining).toBeGreaterThanOrEqual(0.96)
  })
})
