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
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

vi.mock('../lib/supabase.ts', () => ({ supabase: {}, supabaseConfigured: false }))

const { VerdictPointsFigure } = await import('./VerdictCard.tsx')

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
