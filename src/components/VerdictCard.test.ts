/**
 * Rendered-output coverage for the verdict card's points figure (ticket
 * #68 revision). derive.test.ts's "never renders a decimal point" test
 * only ever asserted on deriveVerdictView's return value — never on
 * anything React actually renders. VerdictCard itself fetches via
 * useEffect and can't be driven synchronously into its 'ready' state, so
 * this targets VerdictPointsFigure — the presentational subcomponent
 * VerdictCard.tsx extracted for exactly this purpose — via
 * react-dom/server's renderToStaticMarkup, called from a plain .ts file
 * with React.createElement so vitest.config.ts's `src/**\/*.test.ts`
 * include glob (deliberately .ts-only, see that file's own header
 * comment) doesn't need to change.
 *
 * VerdictCard.tsx also imports fetchVerdict from ../lib/verdict/api.ts,
 * which imports the real Supabase client (../lib/supabase.ts) — that
 * module throws at import time when VITE_SUPABASE_URL /
 * VITE_SUPABASE_PUBLISHABLE_KEY aren't set (createClient('', '')), which
 * they never are under `vitest run`. No prior test file imported that
 * chain, so nothing had hit this before. VerdictPointsFigure never calls
 * fetchVerdict — it's a pure presentational component — so the client is
 * stubbed out here rather than actually touched.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase.ts', () => ({ supabase: {}, supabaseConfigured: false }))

const { VerdictPointsFigure } = await import('./VerdictCard.tsx')

describe('#194, section A2 — the action row does not stick to the viewport while scrolling', () => {
  it('position: sticky appears nowhere in VerdictCard.css', () => {
    const here = path.dirname(fileURLToPath(import.meta.url))
    const css = readFileSync(path.join(here, 'VerdictCard.css'), 'utf8')
    expect(css).not.toMatch(/position:\s*sticky/)
  })
})

describe('#194, section D — Why this / Register override are buttons, not links', () => {
  const here = path.dirname(fileURLToPath(import.meta.url))
  const tsx = readFileSync(path.join(here, 'VerdictCard.tsx'), 'utf8')
  const css = readFileSync(path.join(here, 'VerdictCard.css'), 'utf8')

  it('no <a> element and no react-router Link import remain in VerdictCard.tsx', () => {
    expect(tsx).not.toMatch(/<a[\s>]/)
    expect(tsx).not.toMatch(/import\s*\{\s*Link\s*\}\s*from\s*'react-router'/)
  })

  it('renders three <button type="button"> elements: Commit, Why this, Register override', () => {
    expect(tsx).toMatch(/verdict-card__commit-button verdict-card__commit-control/)
    expect((tsx.match(/type="button"/g) ?? []).length).toBeGreaterThanOrEqual(3)
  })

  it('no arrow glyph survives on either secondary button', () => {
    expect(tsx).not.toMatch(/Why this →/)
    expect(tsx).not.toMatch(/Register override →/)
    expect(tsx).not.toMatch(/Override registered →/)
  })

  it('the two secondary buttons share one class, one row, and neither uses coral or cyan', () => {
    expect(tsx).toMatch(/className="verdict-card__secondary-button"[\s\S]*?Why this/)
    expect(tsx).toMatch(/<OverrideButton /)
    const rule = css.match(/\.verdict-card__secondary-button\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).not.toMatch(/accent-coral/)
    expect(rule).not.toMatch(/accent-cyan/)
  })

  it('the secondary buttons\' own min-height is less than Commit\'s', () => {
    const px = (raw: string) => (raw.trim().endsWith('rem') ? parseFloat(raw) * 16 : parseFloat(raw))
    const commitRule = css.match(/\.verdict-card__commit-button\s*\{[^}]*\}/)?.[0] ?? ''
    const secondaryRule = css.match(/\.verdict-card__secondary-button\s*\{[^}]*\}/)?.[0] ?? ''
    const commitHeight = px(commitRule.match(/min-height:\s*([^;]+);/)![1])
    const secondaryHeight = px(secondaryRule.match(/min-height:\s*([^;]+);/)![1])
    expect(secondaryHeight).toBeLessThan(commitHeight)
  })
})

describe('VerdictPointsFigure', () => {
  it('renders a whole-number points figure with no decimal point anywhere in the markup', () => {
    const html = renderToStaticMarkup(
      createElement(VerdictPointsFigure, { label: 'Gameweek 5 projected points', points: 62 })
    )
    expect(html).toContain('62')
    expect(html).not.toContain('.')
  })

  it('renders the explicit "Unavailable" state, never 0/NaN/blank, when points is null', () => {
    const html = renderToStaticMarkup(
      createElement(VerdictPointsFigure, { label: 'Gameweek 5 projected points', points: null })
    )
    expect(html).toContain('Unavailable')
    expect(html).not.toContain('>0<')
    expect(html).not.toContain('NaN')
    expect(html).not.toContain('.')
  })
})
