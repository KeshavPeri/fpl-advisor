/**
 * Coverage for Surface.tsx/.css's ticket #166 changes
 * (docs/ui-audit-2026-08-31.md F5/F11/F12/F15/F16), plus ticket #275's
 * narrowing to one card material plus one emphasis variant (audit G2).
 * Rendered-output assertions use react-dom/server's renderToStaticMarkup
 * from a plain .ts file, the same pattern VerdictCard.test.ts
 * established, so vitest.config.ts's `src/**\/*.test.ts`-only include
 * glob doesn't need to change.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import Surface from './Surface.tsx'

const here = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.join(here, 'Surface.css'), 'utf8')

describe('F11 — surface-arrive is gone', () => {
  it('no arrival animation survives in Surface.css', () => {
    expect(css).not.toMatch(/surface-arrive/)
    expect(css).not.toMatch(/@keyframes/)
  })

  it('a freshly rendered surface carries no inline arrival state (opacity/transform)', () => {
    const html = renderToStaticMarkup(createElement(Surface, {}, 'content'))
    expect(html).not.toMatch(/style="[^"]*opacity/)
    expect(html).not.toMatch(/style="[^"]*translateY/)
  })
})

describe('ticket #275 (audit G2) — Surface exposes one card material plus one emphasis variant', () => {
  it('defaults to the base material (surface--level-2)', () => {
    const html = renderToStaticMarkup(createElement(Surface, {}, 'x'))
    expect(html).toMatch(/class="surface surface--level-2"/)
  })

  it('raised (the legacy prop every existing call site still passes) resolves to the emphasis variant, not a no-op', () => {
    const html = renderToStaticMarkup(createElement(Surface, { raised: true }, 'x'))
    expect(html).toMatch(/class="surface surface--level-3"/)
  })

  it('level={1} (every existing call site\'s own near-black recess prop, e.g. DeadlineCountdown/ChipsScreen/ReasoningScreen) now renders the SAME class as level 2 — the near-black card style is gone, with no edit to any of those files', () => {
    const html = renderToStaticMarkup(createElement(Surface, { level: 1 }, 'x'))
    expect(html).toMatch(/class="surface surface--level-2"/)
  })

  it('level={2} renders the same base class as level 1 — they are visually one material now', () => {
    const html1 = renderToStaticMarkup(createElement(Surface, { level: 1 }, 'x'))
    const html2 = renderToStaticMarkup(createElement(Surface, { level: 2 }, 'x'))
    expect(html1).toBe(html2)
  })

  it('an explicit level={3} overrides raised, and still resolves to the emphasis variant', () => {
    const html = renderToStaticMarkup(createElement(Surface, { raised: false, level: 3 }, 'x'))
    expect(html).toMatch(/class="surface surface--level-3"/)
  })

  it('only two visual tiers exist in the rendered output across every level value 1–3', () => {
    const classes = [1, 2, 3].map((level) => {
      const html = renderToStaticMarkup(createElement(Surface, { level: level as 1 | 2 | 3 }, 'x'))
      return html.match(/class="surface (surface--level-\d)"/)?.[1]
    })
    expect(new Set(classes)).toEqual(new Set(['surface--level-2', 'surface--level-3']))
  })

  it('the near-black surface--level-1 rule no longer exists in Surface.css — --material-1 is not referenced by any actual declaration', () => {
    // Checked as a real selector/declaration, not the bare token name —
    // this file's own header comment legitimately names both in prose,
    // explaining what was removed and why.
    expect(css).not.toMatch(/\.surface--level-1\s*\{/)
    expect(css).not.toMatch(/:\s*var\(--material-1\)/)
    expect(css).not.toMatch(/:\s*var\(--material-edge-1\)/)
    expect(css).not.toMatch(/:\s*var\(--material-sheen-1\)/)
  })

  it('the remaining two level classes each map to a distinct --material-* background in Surface.css', () => {
    for (const level of [2, 3]) {
      expect(css).toMatch(new RegExp(`\\.surface--level-${level}\\s*\\{[^}]*background:\\s*var\\(--material-${level}\\)`))
    }
  })
})

describe('F16 — padding is a real prop', () => {
  it('defaults to no compact class', () => {
    const html = renderToStaticMarkup(createElement(Surface, {}, 'x'))
    expect(html).not.toMatch(/surface--compact/)
  })

  it('padding="compact" adds the compact class', () => {
    const html = renderToStaticMarkup(createElement(Surface, { padding: 'compact' }, 'x'))
    expect(html).toMatch(/surface--compact/)
  })
})

describe('F12 — the glow is opt-in and structurally behind the panel', () => {
  it('a non-focal surface renders no glow element', () => {
    const html = renderToStaticMarkup(createElement(Surface, {}, 'x'))
    expect(html).not.toMatch(/surface__glow/)
  })

  it('focal renders the glow as a sibling before the panel, inside a positioned wrapper', () => {
    const html = renderToStaticMarkup(createElement(Surface, { focal: true }, 'x'))
    const glowIndex = html.indexOf('surface__glow')
    const panelIndex = html.indexOf('surface--level-2')
    expect(glowIndex).toBeGreaterThan(-1)
    expect(panelIndex).toBeGreaterThan(-1)
    expect(glowIndex).toBeLessThan(panelIndex)
    expect(html).toMatch(/class="surface__focal-wrap"/)
  })

  it('existing call sites (no focal prop) are byte-for-byte unaffected by the focal wrapper', () => {
    const html = renderToStaticMarkup(createElement(Surface, { className: 'pitch__bench', raised: true }, 'x'))
    expect(html).not.toContain('surface__focal-wrap')
    expect(html.startsWith('<div class="surface surface--level-3 pitch__bench"')).toBe(true)
  })
})

describe('ticket-194 — panel blur is restored, now that the backdrop has real detail to blur', () => {
  it('every panel carries a real backdrop blur, at the shared --panel-blur token', () => {
    expect(css).toMatch(/backdrop-filter:\s*blur\(var\(--panel-blur\)\)\s*saturate\(var\(--panel-saturate\)\)/)
  })

  it('panels keep saturate(), which acts on the wash transmitted through the fill', () => {
    expect(css).toMatch(/saturate\(var\(--panel-saturate\)\)/)
  })

  it('each remaining level takes its own light-catching top edge and sheen — the non-alpha elevation mechanism', () => {
    for (const level of [2, 3]) {
      const rule = new RegExp(
        `\\.surface--level-${level}\\s*\\{[^}]*border-top-color:\\s*var\\(--material-edge-${level}\\)[^}]*` +
          `box-shadow:\\s*inset 0 1px 0 0 var\\(--material-sheen-${level}\\)`
      )
      expect(css).toMatch(rule)
    }
  })

  it('no fill alpha is hard-typed in the component stylesheet — every level reads its token', () => {
    expect(css).not.toMatch(/background:\s*rgba\(/)
  })
})

describe('backward compatibility with every existing call site', () => {
  it('forwards standard div attributes (role, aria-label) unchanged', () => {
    const html = renderToStaticMarkup(createElement(Surface, { role: 'alert', 'aria-label': 'x' }, 'x'))
    expect(html).toMatch(/role="alert"/)
    expect(html).toMatch(/aria-label="x"/)
  })
})
