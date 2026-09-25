/**
 * Coverage for AppShell.tsx/.css. Ticket #275 adds a per-route title
 * (ROUTE_TITLES), which needs `useLocation` — every render below is
 * wrapped in react-router's <MemoryRouter>, same pattern AppBar.test.ts
 * already established, rather than the old bare
 * `createElement(AppShell, …)` calls.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import AppShell from './AppShell.tsx'

const here = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.join(here, 'AppShell.css'), 'utf8')
const tsx = readFileSync(path.join(here, 'AppShell.tsx'), 'utf8')

function renderAt(pathname: string, props: Record<string, unknown> = {}): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [pathname] }, createElement(AppShell, props, 'x'))
  )
}

describe('ticket #275 — a real title per route (audit G1)', () => {
  it('renders the right title for every route App.tsx defines', () => {
    const cases: Array<[string, string]> = [
      ['/', 'Home'],
      ['/reasoning', 'Why'],
      ['/chips', 'Chips'],
      ['/decisions', 'Record'],
      ['/squad', 'Squad'],
      ['/override', 'Override'],
    ]
    for (const [pathname, title] of cases) {
      const html = renderAt(pathname)
      expect(html).toMatch(new RegExp(`<h1 class="app-shell__title"[^>]*>${title}</h1>`))
    }
  })

  it('the title renders before {children} — it introduces the screen, not the other way round', () => {
    const html = renderAt('/')
    expect(html.indexOf('app-shell__title')).toBeLessThan(html.indexOf('>x<'))
  })

  it('screens are not edited to get this — AppShell owns the title, not any screen file', () => {
    expect(tsx).toMatch(/ROUTE_TITLES/)
    expect(tsx).not.toMatch(/from ['"]\.\.\/screens/)
  })

  it('the title takes its own type step, not --text-display (must not compete with a screen\'s own hero figure)', () => {
    expect(css).toMatch(/\.app-shell__title\s*\{[^}]*font:\s*var\(--text-screen-title\)/)
    expect(css).not.toMatch(/\.app-shell__title\s*\{[^}]*font:\s*var\(--text-display\)/)
  })
})

describe('ticket #275 — the title fades/shrinks on scroll (fixes audit G8)', () => {
  it('the same scroll handler that drives the backdrop parallax also writes the title\'s opacity/transform', () => {
    expect(tsx).toMatch(/titleRef\.current\.style\.opacity/)
    expect(tsx).toMatch(/titleRef\.current\.style\.transform/)
    // One listener, not two — ticket #275's own header-comment claim.
    const listenerCount = (tsx.match(/addEventListener\('scroll'/g) ?? []).length
    expect(listenerCount).toBe(1)
  })

  it('the title fade is transform/opacity only, matching the nav bar\'s own 60fps rule', () => {
    const fnBody = tsx.match(/function applyScrollEffects\(\)\s*\{[\s\S]*?\n {4}\}/)?.[0] ?? ''
    expect(fnBody).toMatch(/titleRef\.current\.style\.opacity = /)
    expect(fnBody).toMatch(/titleRef\.current\.style\.transform = /)
    expect(fnBody).not.toMatch(/titleRef\.current\.style\.(width|height|fontSize)/)
  })

  it('skips the update under prefers-reduced-motion — the title still scrolls away normally, just without the animated fade', () => {
    const fnBody = tsx.match(/function applyScrollEffects\(\)\s*\{[\s\S]*?\n {4}\}/)?.[0] ?? ''
    const guardIndex = fnBody.indexOf('if (prefersReducedMotion()) return')
    const titleIndex = fnBody.indexOf('titleRef.current.style.opacity')
    expect(guardIndex).toBeGreaterThan(-1)
    expect(titleIndex).toBeGreaterThan(guardIndex)
  })
})

describe('F19 — the escalated wash is a real, opt-in layer', () => {
  it('defaults to escalated: false — no current screen changes today', () => {
    const html = renderAt('/')
    expect(html).toMatch(/class="app-shell"/)
    expect(html).not.toMatch(/app-shell--escalated"/)
    expect(html).toMatch(/app-shell__backdrop--escalated/)
  })

  it('escalated: true adds the modifier class that drives the CSS crossfade', () => {
    const html = renderAt('/', { escalated: true })
    expect(html).toMatch(/class="app-shell app-shell--escalated"/)
  })

  it('the escalated layer opacity-crossfades using --dur-ambient, not a hand-typed duration', () => {
    expect(css).toMatch(/\.app-shell__backdrop--escalated\s*\{[^}]*transition:\s*opacity\s+var\(--dur-ambient\)/)
    expect(css).not.toMatch(/\d+ms\s+cubic-bezier/)
  })
})

describe('#194, section H — M2 (screen transitions)', () => {
  it('the column plays a real entrance keyframe at the app\'s own --dur-enter/--ease-out tokens, no hand-typed values', () => {
    expect(css).toMatch(/animation:\s*app-shell-screen-enter\s+var\(--dur-enter\)\s+var\(--ease-out\)/)
  })

  it('the entrance keyframe moves from a settled offset, never from scale(0) or off past the safe area', () => {
    const keyframes = css.match(/@keyframes app-shell-screen-enter\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(keyframes).toMatch(/from\s*\{[^}]*opacity:\s*0[^}]*transform:\s*translateY\(0\.5rem\)/)
    expect(keyframes).toMatch(/to\s*\{[^}]*opacity:\s*1[^}]*transform:\s*translateY\(0\)/)
  })

  it('the floating bar is structurally excluded from the entrance animation — AppShell.tsx renders no <AppBar>', () => {
    // Checked for actual JSX usage, not the bare word — this file's own
    // ticket #275 comments legitimately mention AppBar.tsx by name (the
    // sibling scroll-collapse effect they compare against).
    expect(tsx).not.toMatch(/<AppBar/)
    expect(tsx).not.toMatch(/from ['"]\.\/AppBar/)
  })
})

describe('#194, section A1 — no home-screen content renders above the top safe-area inset', () => {
  it('the column\'s own padding-top adds --space-6 on top of env(safe-area-inset-top)', () => {
    expect(css).toMatch(/padding-top:\s*calc\(env\(safe-area-inset-top\)\s*\+\s*var\(--space-6\)\)/)
  })
})

describe('ticket #275 — the column reserves space for the (shorter, hump-free) new bar', () => {
  it('padding-bottom accounts for the bar\'s real reserved height via the shared --nav-bar-reserve token', () => {
    expect(css).toMatch(/padding-bottom:\s*calc\(env\(safe-area-inset-bottom\)\s*\+\s*var\(--nav-bar-reserve\)\)/)
  })

  it('the static (non-safe-area) portion of the reserve is at least the bar\'s own height plus one gap', () => {
    const indexCss = readFileSync(path.join(here, '..', 'index.css'), 'utf8')
    const px = (raw: string) => (raw.trim().endsWith('rem') ? parseFloat(raw) * 16 : parseFloat(raw))
    const extract = (name: string) => {
      const match = indexCss.match(new RegExp(`--${name}:\\s*([^;]+);`))
      if (!match) throw new Error(`token --${name} not found`)
      return match[1].trim()
    }
    const barHeight = px(extract('nav-bar-height'))
    const oneGap = px(extract('space-3'))
    const reserve = px(extract('nav-bar-reserve'))
    expect(reserve).toBeGreaterThanOrEqual(barHeight + oneGap)
  })
})

describe('F20 — .bleed exists and cancels the column\'s own horizontal inset', () => {
  it('is defined in AppShell.css', () => {
    expect(css).toMatch(/\.bleed\s*\{[^}]*margin-left:\s*calc\(-1 \* \(env\(safe-area-inset-left\)/)
  })
})

describe('#194, section E — .bleed-narrow retains a margin, departing from F25\'s full-bleed proposal', () => {
  it('cancels only part of the column\'s horizontal inset, unlike .bleed', () => {
    const rule = css.match(/\.bleed-narrow\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/margin-left:\s*calc\(-1 \* \(env\(safe-area-inset-left\)\s*\+\s*var\(--space-4\)\s*-\s*var\(--space-2\)\)\)/)
  })
})

describe('#202, section A — the grain layer is folded into app-shell__backdrop itself', () => {
  it('app-shell__backdrop is fixed, behind content, and carries an inline SVG turbulence layer (no new asset/dependency)', () => {
    const rule = css.match(/\.app-shell__backdrop\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/position:\s*fixed/)
    expect(rule).toMatch(/z-index:\s*-1/)
    expect(rule).toMatch(/background-image:[\s\S]*?url\("data:image\/svg\+xml/)
    expect(rule).toMatch(/feTurbulence/)
    expect(rule).toMatch(/background-blend-mode:\s*overlay/)
  })

  it('carries more than two colour sources (four radial-gradient centres, still only cyan/coral tokens)', () => {
    const rule = css.match(/\.app-shell__backdrop\s*\{[^}]*\}/)?.[0] ?? ''
    const gradientCount = (rule.match(/radial-gradient\(/g) ?? []).length
    expect(gradientCount).toBeGreaterThan(2)
    expect(rule).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
  })

  it('a separate app-shell__grain rule no longer exists — it is one layer of app-shell__backdrop now', () => {
    expect(css).not.toMatch(/\.app-shell__grain/)
  })

  it('translates on scroll via a ref-applied transform, gated behind prefers-reduced-motion, transform-only', () => {
    expect(tsx).toMatch(/prefersReducedMotion/)
    expect(tsx).toMatch(/translate3d\(0,/)
    expect(tsx).toMatch(/window\.scrollY/)
    expect(tsx).toMatch(/requestAnimationFrame/)
  })
})

describe('F18 — the column gap is overridable per screen without editing this file again', () => {
  it('defaults to the unchanged var(--space-6) via a --shell-gap seam', () => {
    expect(css).toMatch(/gap:\s*var\(--shell-gap,\s*var\(--space-6\)\)/)
  })
})
