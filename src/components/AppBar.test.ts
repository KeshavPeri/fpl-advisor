/**
 * Coverage for AppBar.tsx/.css/NavIcons.tsx (ticket #166,
 * docs/ui-audit-2026-08-31.md F17, plus the ticket-79 follow-up that
 * gave the bar its icons and made it the app's glassiest surface). Same
 * renderToStaticMarkup pattern as Surface.test.ts, wrapped in
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
const iconsSource = readFileSync(path.join(here, 'NavIcons.tsx'), 'utf8')

function renderAt(pathname: string): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [pathname] }, createElement(AppBar))
  )
}

describe('F17 — three top-level destinations, reachable from any route', () => {
  it('renders links to /, /chips and /decisions with the audit\'s exact labels', () => {
    const html = renderAt('/')
    expect(html).toMatch(/href="\/"[\s\S]*?<span class="app-bar__label">This week<\/span>/)
    expect(html).toMatch(/href="\/chips"[\s\S]*?<span class="app-bar__label">Chips<\/span>/)
    expect(html).toMatch(/href="\/decisions"[\s\S]*?<span class="app-bar__label">Record<\/span>/)
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

describe('ticket-79 follow-up, correction B — the bar has icons, drawn in this repo', () => {
  it('every destination renders one inline SVG glyph alongside its label', () => {
    const html = renderAt('/')
    const svgCount = (html.match(/<svg /g) ?? []).length
    expect(svgCount).toBe(3)
    expect(html).toMatch(/<svg [^>]*class="app-bar__icon"/)
  })

  it('no icon library, no new dependency — NavIcons.tsx imports nothing but react types', () => {
    const imports = iconsSource.match(/^import .*$/gm) ?? []
    expect(imports).toEqual(["import type { SVGProps } from 'react'"])
  })

  it('no emoji anywhere in the bar or the icon set', () => {
    // Any codepoint carrying the Emoji_Presentation property, plus the
    // variation-selector-16 that forces emoji rendering on the rest.
    const emoji = /\p{Extended_Pictographic}|\uFE0F/u
    expect(emoji.test(iconsSource)).toBe(false)
    expect(emoji.test(readFileSync(path.join(here, 'AppBar.tsx'), 'utf8'))).toBe(false)
    expect(emoji.test(renderAt('/'))).toBe(false)
  })

  it('one grid, one stroke weight, stroke not fill, currentColor', () => {
    // Every glyph shares the same viewBox and the same stroke setup...
    const viewBoxes = iconsSource.match(/viewBox="[^"]*"/g) ?? []
    expect(new Set(viewBoxes)).toEqual(new Set(['viewBox="0 0 24 24"']))
    expect(iconsSource).toMatch(/fill="none"/)
    expect(iconsSource).toMatch(/stroke="currentColor"/)
    // ...and no glyph fills a shape or hard-codes a colour of its own.
    expect(iconsSource).not.toMatch(/fill="(?!none)/)
    // Checked against the rendered markup, where a prose "#166" cannot
    // be mistaken for a colour: nothing in the bar names one at all.
    const rendered = renderAt('/')
    expect(rendered).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(rendered).not.toMatch(/rgba?\(/)
    // ...the weight itself lives in CSS so the active state can change it.
    expect(rendered).not.toMatch(/stroke-width/)
    expect(css).toMatch(/\.app-bar__icon\s*\{[^}]*stroke-width:\s*var\(--nav-stroke\)/)
  })

  it('every destination keeps an accessible name; the icons are decorative', () => {
    const html = renderAt('/')
    for (const label of ['This week', 'Chips', 'Record']) {
      expect(html).toContain(`>${label}</span>`)
    }
    // Three links, three aria-hidden svgs — the name never comes from a glyph.
    const hidden = (html.match(/<svg [^>]*aria-hidden="true"/g) ?? []).length
    expect(hidden).toBe(3)
    expect(html).toMatch(/<svg [^>]*focusable="false"/)
  })

  it('the active destination is distinguishable without colour', () => {
    // Stroke weight and label weight both change, independently of the
    // cyan pill and the --text-* colour swap.
    expect(css).toMatch(
      /\.app-bar__item\[aria-current='page'\] \.app-bar__icon\s*\{[^}]*stroke-width:\s*var\(--nav-stroke-active\)/
    )
    expect(css).toMatch(
      /\.app-bar__item\[aria-current='page'\] \.app-bar__label\s*\{[^}]*font-weight:\s*620/
    )
  })

  it('adds no motion beyond the press feedback the foundations already define', () => {
    expect(css).not.toMatch(/@keyframes|animation:/)
    const transforms = css.match(/transform:\s*[^;]+;/g) ?? []
    expect(transforms.sort()).toEqual(['transform: none;', 'transform: scale(0.96);', 'transform: translateX(-50%);'])
  })
})

describe('ticket-79 follow-up, correction A — the bar is the glassiest surface here', () => {
  it('the bar is the only surface carrying a backdrop blur', () => {
    expect(css).toMatch(/backdrop-filter:\s*blur\(var\(--material-bar-blur\)\)/)
    const surfaceCss = readFileSync(path.join(here, 'Surface.css'), 'utf8')
    expect(surfaceCss).not.toMatch(/backdrop-filter:[^;]*blur\(/)
  })

  it('the scrim no longer erases the one backdrop worth blurring', () => {
    // A scrim that reaches solid --surface-0 above the bar's top edge
    // leaves the bar as glass over a flat field — the F13 defect again.
    expect(css).toMatch(/\.app-bar__scrim\s*\{[^}]*opacity:\s*var\(--scrim-strength\)/)
  })

  it('the bar saturates harder and catches more light than any panel', () => {
    expect(css).toMatch(/saturate\(var\(--material-bar-saturate\)\)/)
    expect(css).toMatch(/border-top-color:\s*var\(--material-edge-3\)/)
  })
})
