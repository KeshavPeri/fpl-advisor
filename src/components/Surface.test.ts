/**
 * Coverage for Surface.tsx/.css's ticket #166 changes
 * (docs/ui-audit-2026-08-31.md F5/F11/F12/F15/F16). Rendered-output
 * assertions use react-dom/server's renderToStaticMarkup from a plain
 * .ts file, the same pattern VerdictCard.test.ts established, so
 * vitest.config.ts's `src/**\/*.test.ts`-only include glob doesn't need
 * to change.
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

describe('F15 — level/raised resolve to genuinely distinct classes', () => {
  it('defaults to level 2', () => {
    const html = renderToStaticMarkup(createElement(Surface, {}, 'x'))
    expect(html).toMatch(/class="surface surface--level-2"/)
  })

  it('raised (the legacy prop every existing call site still passes) resolves to level 3, not a no-op', () => {
    const html = renderToStaticMarkup(createElement(Surface, { raised: true }, 'x'))
    expect(html).toMatch(/class="surface surface--level-3"/)
  })

  it('an explicit level overrides raised', () => {
    const html = renderToStaticMarkup(createElement(Surface, { raised: true, level: 1 }, 'x'))
    expect(html).toMatch(/class="surface surface--level-1"/)
  })

  it('each level class maps to a distinct --material-* background in Surface.css', () => {
    for (const level of [1, 2, 3]) {
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

describe('ticket-79 follow-up — panels are material, not fog', () => {
  it('no panel carries a backdrop blur: blur() over the static wash returns the wash (F13)', () => {
    expect(css).not.toMatch(/backdrop-filter:[^;]*blur\(/)
    expect(css).not.toMatch(/--material-\d-blur/)
  })

  it('panels keep saturate(), which acts on the wash transmitted through the fill', () => {
    expect(css).toMatch(/backdrop-filter:\s*saturate\(var\(--panel-saturate\)\)/)
  })

  it('each level takes its own light-catching top edge and sheen — the non-alpha elevation mechanism', () => {
    for (const level of [1, 2, 3]) {
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
