/**
 * Coverage for the token/cascade fixes made directly in src/index.css by
 * ticket #166 (docs/ui-audit-2026-08-31.md). Two independent things are
 * proven here, both against the real committed CSS text (not a copy of
 * the values, so this drifts if and only if the actual tokens do):
 *
 *  1. F1 — .num survives every current and future `font:` shorthand
 *     collision, generically (not just for today's 13 known offenders).
 *     This is the DoD's "most important item" — grep-checkable, and
 *     literally re-derived below via a tiny CSS parser rather than
 *     asserted by string-matching alone.
 *  2. F5/F2 — the elevation scale's boundary contrast ratios, and
 *     --text-tertiary's WCAG AA compliance, computed with the same WCAG
 *     relative-luminance formula the audit used, from the literal token
 *     values in src/index.css. The numbers asserted below are the exact
 *     ones recorded in this ticket's report to the orchestrator.
 *
 * A tiny hand-rolled CSS parser is used throughout rather than a new
 * dependency (this ticket's scope forbids adding one) — good enough for
 * this codebase's flat CSS (no nesting beyond one level of @media), not
 * a general-purpose CSS parser.
 */
import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const srcDir = path.dirname(fileURLToPath(import.meta.url))
const indexCssPath = path.join(srcDir, 'index.css')

// ---- A tiny CSS rule extractor -------------------------------------------

interface CssRule {
  selector: string
  body: string
}

function stripCommentsAndImports(css: string): string {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/@import[^;]*;/g, '').replace(/@charset[^;]*;/g, '')
}

/** Recurses into @media/@supports; skips @keyframes/@font-face bodies
 * entirely (no real selectors live there); records everything else as a
 * rule. Assumes braces are balanced and unquoted, true of this repo's CSS. */
function extractRules(text: string): CssRule[] {
  const rules: CssRule[] = []
  let i = 0
  while (i < text.length) {
    const brace = text.indexOf('{', i)
    if (brace === -1) break
    const prelude = text.slice(i, brace).trim()

    let depth = 1
    let j = brace + 1
    while (j < text.length && depth > 0) {
      if (text[j] === '{') depth++
      else if (text[j] === '}') depth--
      j++
    }
    const body = text.slice(brace + 1, j - 1)

    if (/^@media\b/.test(prelude) || /^@supports\b/.test(prelude)) {
      rules.push(...extractRules(body))
    } else if (!prelude.startsWith('@') && prelude.length > 0) {
      rules.push({ selector: prelude, body })
    }
    // else: @keyframes, @font-face, @page, @import-that-slipped-through — skip.

    i = j
  }
  return rules
}

function collectCssFiles(dir: string): string[] {
  const out: string[] = []
  for (const entry of readdirSync(dir)) {
    const full = path.join(dir, entry)
    const stat = statSync(full)
    if (stat.isDirectory()) out.push(...collectCssFiles(full))
    else if (entry.endsWith('.css')) out.push(full)
  }
  return out
}

function classAndIdCount(selector: string): { classCount: number; idCount: number } {
  return {
    classCount: (selector.match(/\.[-\w]+/g) ?? []).length,
    idCount: (selector.match(/#[-\w]+/g) ?? []).length,
  }
}

const usesFontShorthand = (body: string) => /(^|;)\s*font\s*:/.test(body)

// ---- WCAG contrast, from the literal token values in src/index.css ------

const indexCssRaw = readFileSync(indexCssPath, 'utf8')

function extractToken(name: string): string {
  const match = indexCssRaw.match(new RegExp(`--${name}:\\s*([^;]+);`))
  if (!match) throw new Error(`token --${name} not found in src/index.css`)
  return match[1].trim()
}

interface Rgba {
  r: number
  g: number
  b: number
  a: number
}

function parseColor(raw: string): Rgba {
  const hex = raw.match(/^#([0-9a-fA-F]{6})$/)
  if (hex) {
    const n = parseInt(hex[1], 16)
    return { r: (n >> 16) & 255, g: (n >> 8) & 255, b: n & 255, a: 1 }
  }
  const rgba = raw.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+))?\s*\)/)
  if (rgba) {
    return {
      r: Number(rgba[1]),
      g: Number(rgba[2]),
      b: Number(rgba[3]),
      a: rgba[4] === undefined ? 1 : Number(rgba[4]),
    }
  }
  throw new Error(`unrecognised colour value: "${raw}"`)
}

/** Alpha-composites `fg` over an opaque `bg`. */
function over(fg: Rgba, bg: { r: number; g: number; b: number }) {
  return {
    r: fg.r * fg.a + bg.r * (1 - fg.a),
    g: fg.g * fg.a + bg.g * (1 - fg.a),
    b: fg.b * fg.a + bg.b * (1 - fg.a),
  }
}

function channelLuminance(c8: number): number {
  const c = c8 / 255
  return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4
}

function relativeLuminance({ r, g, b }: { r: number; g: number; b: number }): number {
  return 0.2126 * channelLuminance(r) + 0.7152 * channelLuminance(g) + 0.0722 * channelLuminance(b)
}

/** WCAG contrast ratio between two relative luminances, order-independent. */
function contrast(l1: number, l2: number): number {
  const lighter = Math.max(l1, l2)
  const darker = Math.min(l1, l2)
  return (lighter + 0.05) / (darker + 0.05)
}

describe('F1 — .num cannot be defeated by a later font: shorthand, anywhere in the app', () => {
  it('.num restates every property the font shorthand resets, all !important', () => {
    const rule = extractRules(stripCommentsAndImports(indexCssRaw)).find((r) => r.selector === '.num')
    expect(rule).toBeDefined()
    expect(rule!.body).toMatch(/font-family:\s*var\(--font-mono\)\s*!important/)
    expect(rule!.body).toMatch(/font-variant-numeric:\s*tabular-nums\s*!important/)
    expect(rule!.body).toMatch(/font-feature-settings:\s*'tnum'\s*1\s*!important/)
  })

  it("regression check — the single-class scenario is real: VerdictCard.css's projected-points class sets the font shorthand", () => {
    // Confirms the fix is guarding something, not a vacuous proof.
    // VerdictCard.tsx/.css are out of ticket #166's scope to edit
    // (CLAUDE.md) — this only reads the file.
    const verdictCss = readFileSync(path.join(srcDir, 'components', 'VerdictCard.css'), 'utf8')
    const rule = extractRules(stripCommentsAndImports(verdictCss)).find(
      (r) => r.selector === '.verdict-card__points-value'
    )
    expect(rule).toBeDefined()
    expect(rule!.body).toMatch(/font:\s*var\(--text-display\)/)
  })

  it(
    "regression check — the harder, 2-class-tie scenario is also real: DeadlineCountdown.css's escalated " +
      'remaining-time selector has the same (0,2,0) specificity a `.num.num`-only fix would have had, and ' +
      'would have won that tie on source order (it loads after index.css)',
    () => {
      const deadlineCss = readFileSync(path.join(srcDir, 'components', 'DeadlineCountdown.css'), 'utf8')
      const rule = extractRules(stripCommentsAndImports(deadlineCss)).find(
        (r) => r.selector === '.deadline-countdown--escalated .deadline-countdown__remaining'
      )
      expect(rule).toBeDefined()
      expect(usesFontShorthand(rule!.body)).toBe(true)
      const { classCount, idCount } = classAndIdCount(rule!.selector)
      expect(idCount).toBe(0)
      expect(classCount).toBe(2) // a plain .num.num override would only have tied this, not beaten it
      // Confirms *this specific rule* doesn't itself carry !important on a
      // font property — if it did, !important-vs-!important would fall
      // back to specificity/order, and this 2-class, later-loaded rule
      // would win the tie.
      expect(rule!.body).not.toMatch(/font[\w-]*\s*:[^;]*!important/)
    }
  )

  it(
    "Grep-checkable, generically: nothing else in src/**/*.css marks font-family, " +
      "font-variant-numeric or font-feature-settings !important — the only thing that could " +
      'still defeat .num, regardless of any selector\'s specificity',
    () => {
      const cssFiles = collectCssFiles(srcDir)
      // Sanity check on the walk itself, so a broken path fails loudly
      // instead of this test vacuously passing over zero files.
      expect(cssFiles.length).toBeGreaterThan(10)

      const offenders: string[] = []
      for (const file of cssFiles) {
        const raw = readFileSync(file, 'utf8')
        for (const rule of extractRules(stripCommentsAndImports(raw))) {
          if (file === indexCssPath && rule.selector === '.num') continue // .num's own rule
          if (/font(-family|-variant-numeric|-feature-settings)?\s*:[^;]*!important/.test(rule.body)) {
            offenders.push(`${path.relative(srcDir, file)}: "${rule.selector}"`)
          }
        }
      }

      expect(offenders).toEqual([])
    }
  )
})

describe('F5 — the elevation scale is genuinely separable (computed WCAG contrast, over --surface-0)', () => {
  const base = parseColor(extractToken('surface-0'))
  const baseL = relativeLuminance(base)

  const material1 = parseColor(extractToken('material-1'))
  const material2 = parseColor(extractToken('material-2'))
  const material3 = parseColor(extractToken('material-3'))
  const border = parseColor(extractToken('panel-border'))

  const l1L = relativeLuminance(over(material1, base))
  const l2L = relativeLuminance(over(material2, base))
  const l3L = relativeLuminance(over(material3, base))
  // The border's typical use: a panel's own 1px edge, i.e. composited
  // over that panel's fill (level 2, --panel-fill's default).
  const borderOverL2L = relativeLuminance(over(border, over(material2, base)))

  it('L1 (recessed) is present against the base ink without being a card — 1.06:1', () => {
    expect(contrast(l1L, baseL)).toBeCloseTo(1.06, 1)
  })

  it('L2 (the standard panel) is clearly visible against base — 1.25:1', () => {
    expect(contrast(l2L, baseL)).toBeCloseTo(1.25, 1)
  })

  it('L2 is visible against L1 — 1.18:1', () => {
    expect(contrast(l2L, l1L)).toBeCloseTo(1.18, 1)
  })

  it('L3 (the loudest surface on a screen) is clearly visible against base — 1.55:1', () => {
    expect(contrast(l3L, baseL)).toBeCloseTo(1.55, 1)
  })

  it('L3 is visible against L2 — 1.24:1', () => {
    expect(contrast(l3L, l2L)).toBeCloseTo(1.24, 1)
  })

  it('every adjacent elevation pair is more visible than the border between them (was inverted: 1.079:1 fill vs 1.260:1 border)', () => {
    const borderVisibility = contrast(borderOverL2L, l2L)
    expect(contrast(l2L, l1L)).toBeGreaterThan(borderVisibility)
    expect(contrast(l3L, l2L)).toBeGreaterThan(borderVisibility)
  })
})

/**
 * The ticket-79 follow-up correction. Ticket #166 bought F5's elevation
 * contrast with alpha (0.55 -> 0.72 on the standard panel, 0.62 -> 0.84
 * on the raised one), which is the one currency it could not spend: more
 * opacity is less material, and the app read as frosted rather than as
 * glass. The two properties below have to hold AT THE SAME TIME — the
 * elevation must survive (asserted in the F5 block above, unchanged) and
 * no fill may exceed its pre-#166 alpha.
 */
describe('ticket-79 follow-up — elevation is carried by colour, never by opacity', () => {
  const base = parseColor(extractToken('surface-0'))

  // The ceilings. --panel-fill's pre-#166 value, and --panel-fill-raised's.
  const PANEL_FILL_ALPHA_CEILING = 0.55
  const PANEL_FILL_RAISED_ALPHA_CEILING = 0.62

  it('no panel fill exceeds the pre-foundations alpha ceilings', () => {
    expect(parseColor(extractToken('material-1')).a).toBeLessThanOrEqual(PANEL_FILL_ALPHA_CEILING)
    expect(parseColor(extractToken('material-2')).a).toBeLessThanOrEqual(PANEL_FILL_ALPHA_CEILING)
    expect(parseColor(extractToken('material-3')).a).toBeLessThanOrEqual(PANEL_FILL_RAISED_ALPHA_CEILING)
  })

  it('the three levels are distinguishable with alpha held CONSTANT — every fill shares one alpha', () => {
    const alphas = ['material-1', 'material-2', 'material-3'].map((t) => parseColor(extractToken(t)).a)
    expect(new Set(alphas).size).toBe(1)
    // ...and they are still separable, so the elevation is provably a
    // function of colour alone rather than of opacity.
    const [c1, c2, c3] = ['material-1', 'material-2', 'material-3'].map((t) =>
      relativeLuminance(over(parseColor(extractToken(t)), base))
    )
    expect(contrast(c2, c1)).toBeGreaterThan(1.1)
    expect(contrast(c3, c2)).toBeGreaterThan(1.1)
  })

  it('the floating bar is the most translucent surface in the app — strictly below the panels', () => {
    const barAlpha = parseColor(extractToken('material-bar')).a
    const panelAlpha = parseColor(extractToken('material-2')).a
    expect(barAlpha).toBeLessThan(panelAlpha)
  })

  it('the light-catching edge brightens with the level — the non-alpha mechanism that replaces the opacity step', () => {
    const edges = ['material-edge-1', 'material-edge-2', 'material-edge-3'].map(
      (t) => parseColor(extractToken(t)).a
    )
    expect(edges[0]).toBeLessThan(edges[1])
    expect(edges[1]).toBeLessThan(edges[2])
    const sheens = ['material-sheen-1', 'material-sheen-2', 'material-sheen-3'].map(
      (t) => parseColor(extractToken(t)).a
    )
    expect(sheens[0]).toBeLessThan(sheens[1])
    expect(sheens[1]).toBeLessThan(sheens[2])
  })

  it("the bar's quietest label clears WCAG AA against the worst backdrop the scrim allows", () => {
    // Worst case: solid --text-primary content scrolling directly under
    // the bar, muted only by the scrim (--scrim-strength of --surface-0)
    // and then by the bar's own fill.
    const scrimStrength = Number(extractToken('scrim-strength'))
    expect(scrimStrength).toBeLessThan(1) // a fully opaque scrim = glass over nothing (F13)
    const bright = parseColor(extractToken('text-primary'))
    const scrimmed = over({ ...base, a: scrimStrength }, bright)
    const seenThroughBar = over(parseColor(extractToken('material-bar')), scrimmed)
    const label = relativeLuminance(parseColor(extractToken('text-secondary')))
    expect(contrast(label, relativeLuminance(seenThroughBar))).toBeGreaterThanOrEqual(4.5)
  })
})

describe('F2 — --text-tertiary meets WCAG AA (4.5:1) at its smallest used size', () => {
  const base = parseColor(extractToken('surface-0'))
  const baseL = relativeLuminance(base)
  const material2 = parseColor(extractToken('material-2'))
  const l2L = relativeLuminance(over(material2, base))
  const tertiaryL = relativeLuminance(parseColor(extractToken('text-tertiary')))

  it('meets AA on the standard (L2) panel — 5.05:1', () => {
    const ratio = contrast(tertiaryL, l2L)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
    expect(ratio).toBeCloseTo(5.05, 1)
  })

  it('meets AA on base ink — 6.31:1', () => {
    const ratio = contrast(tertiaryL, baseL)
    expect(ratio).toBeGreaterThanOrEqual(4.5)
    expect(ratio).toBeCloseTo(6.31, 1)
  })
})

describe('F3 — no link renders underlined by default', () => {
  it('index.css resets text-decoration on every <a>', () => {
    const rule = extractRules(stripCommentsAndImports(indexCssRaw)).find((r) => r.selector === 'a')
    expect(rule).toBeDefined()
    expect(rule!.body).toMatch(/text-decoration:\s*none/)
  })
})

describe('F8 — reduced motion gentles feedback instead of removing it', () => {
  it('opacity/colour transitions survive prefers-reduced-motion: reduce; movement still collapses', () => {
    expect(indexCssRaw).toMatch(/transition-property:\s*opacity,\s*color,\s*background-color,\s*border-color/)
    expect(indexCssRaw).toMatch(/animation-duration:\s*0\.01ms/)
  })
})

describe('Motion token consolidation (F6/F8/F11)', () => {
  it('the five motion tokens exist', () => {
    for (const token of ['--ease-out', '--dur-press', '--dur-enter', '--dur-state', '--dur-ambient']) {
      expect(indexCssRaw).toContain(`${token}:`)
    }
  })

  it('--ease-out is the audit\'s strong ease-out, not a re-typed value elsewhere', () => {
    expect(extractToken('ease-out')).toBe('cubic-bezier(0.23, 1, 0.32, 1)')
  })
})
