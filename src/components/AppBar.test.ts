/**
 * Coverage for AppBar.tsx/.css (ticket #166, docs/ui-audit-2026-08-31.md
 * F17). Same renderToStaticMarkup pattern as Surface.test.ts, wrapped in
 * react-router's <MemoryRouter> because <NavLink> needs a router context
 * to render — react-router is an existing dependency, not a new one.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import AppBar from './AppBar.tsx'

const here = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.join(here, 'AppBar.css'), 'utf8')

function renderAt(pathname: string): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [pathname] }, createElement(AppBar))
  )
}

describe('F17 — three top-level destinations, reachable from any route', () => {
  it('renders links to /, /chips and /decisions with the audit\'s exact labels', () => {
    const html = renderAt('/')
    expect(html).toMatch(/href="\/"[^>]*>This week</)
    expect(html).toMatch(/href="\/chips"[^>]*>Chips</)
    expect(html).toMatch(/href="\/decisions"[^>]*>Record</)
  })

  it('does not link the three contextual routes (they stay reached from the surfaces they belong to)', () => {
    const html = renderAt('/')
    expect(html).not.toMatch(/href="\/reasoning"/)
    expect(html).not.toMatch(/href="\/override"/)
    expect(html).not.toMatch(/href="\/squad"/)
  })

  it('marks the current route with aria-current="page" (NavLink\'s own default), which AppBar.css keys off', () => {
    const html = renderAt('/chips')
    expect(html).toMatch(/href="\/chips"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/chips"/)
    expect(html).not.toMatch(/href="\/"[^>]*aria-current="page"/)
    expect(css).toMatch(/\.app-bar__item\[aria-current='page'\]/)
  })

  it('the root link uses `end` so it is not active on every other route (NavLink\'s prefix-matching default)', () => {
    const html = renderAt('/chips')
    // If `end` were missing, "/" would prefix-match "/chips" and both
    // links would carry aria-current="page" simultaneously.
    const currentCount = (html.match(/aria-current="page"/g) ?? []).length
    expect(currentCount).toBe(1)
  })
})

describe('every 44px minimum tap target and no hand-typed cubic-bezier', () => {
  it('.app-bar__item has a 44px min-height', () => {
    expect(css).toMatch(/\.app-bar__item\s*\{[^}]*min-height:\s*44px/)
  })

  it('uses --ease-out / --dur-press tokens, not a re-typed cubic-bezier', () => {
    expect(css).toMatch(/var\(--ease-out\)/)
    expect(css).toMatch(/var\(--dur-press\)/)
    expect(css).not.toMatch(/cubic-bezier\(/)
  })

  it('respects prefers-reduced-motion by dropping the press scale, keeping colour feedback', () => {
    expect(css).toMatch(/prefers-reduced-motion:\s*reduce/)
  })
})
