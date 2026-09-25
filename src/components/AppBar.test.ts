/**
 * Coverage for AppBar.tsx/.css/NavIcons.tsx — ticket #275's Reddit-style
 * glass nav rewrite (docs/ui-nav-spec-2026-09-25.md), replacing the
 * previous #202 dome/bump coverage entirely. Same renderToStaticMarkup
 * pattern the file already used, wrapped in react-router's
 * <MemoryRouter> because <NavLink>/useLocation need a router context.
 */
import { readFileSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MemoryRouter } from 'react-router'
import { describe, expect, it } from 'vitest'
import AppBar, { NAV_COLLAPSE_THRESHOLD_PX, NAV_COLLAPSE_TOP_GUARD_PX, nextNavScrollState } from './AppBar.tsx'

const here = path.dirname(fileURLToPath(import.meta.url))
const css = readFileSync(path.join(here, 'AppBar.css'), 'utf8')
const tsx = readFileSync(path.join(here, 'AppBar.tsx'), 'utf8')
const iconsSource = readFileSync(path.join(here, 'NavIcons.tsx'), 'utf8')

function renderAt(pathname: string): string {
  return renderToStaticMarkup(
    createElement(MemoryRouter, { initialEntries: [pathname] }, createElement(AppBar))
  )
}

describe('ticket #275 — four equal destinations, one active treatment', () => {
  it('renders links to /, /reasoning, /chips and /decisions with the spec\'s exact labels, in that order', () => {
    const html = renderAt('/')
    const order = ['href="/"', 'Home', 'href="/reasoning"', 'Why', 'href="/chips"', 'Chips', 'href="/decisions"', 'Record']
    let cursor = -1
    for (const token of order) {
      const idx = html.indexOf(token, cursor + 1)
      expect(idx).toBeGreaterThan(cursor)
      cursor = idx
    }
  })

  it('does not link the two remaining contextual routes (unchanged — reached from the surfaces they belong to)', () => {
    const html = renderAt('/')
    expect(html).not.toMatch(/href="\/squad"/)
    expect(html).not.toMatch(/href="\/override"/)
  })

  it('marks the current route with aria-current="page" (NavLink\'s own default), which AppBar.css keys off', () => {
    const html = renderAt('/chips')
    expect(html).toMatch(/href="\/chips"[^>]*aria-current="page"|aria-current="page"[^>]*href="\/chips"/)
    expect(html).not.toMatch(/href="\/"[^>]*aria-current="page"/)
    expect(css).toMatch(/\.app-bar__item\[aria-current='page'\]/)
  })

  it('the root link uses `end` so it is not active on every other route', () => {
    const html = renderAt('/chips')
    const currentCount = (html.match(/aria-current="page"/g) ?? []).length
    expect(currentCount).toBe(1)
  })

  it('one active rule applies identically to every tab — no per-tab special case (the old Home hump is gone)', () => {
    expect(css).not.toMatch(/app-bar__item--home/)
    expect(css).not.toMatch(/dome/i)
    expect(css).not.toMatch(/mask-image/)
  })
})

describe('every 44px minimum tap target, including the collapsed circle', () => {
  it('.app-bar__item has a 44px min-height', () => {
    expect(css).toMatch(/\.app-bar__item\s*\{[^}]*min-height:\s*44px/)
  })

  it('the collapsed button is exactly --nav-bar-height square', () => {
    const rule = css.match(/\.app-bar__collapsed\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/width:\s*var\(--nav-bar-height\)/)
    expect(rule).toMatch(/height:\s*var\(--nav-bar-height\)/)
  })

  it('--nav-bar-height is at least 44px', () => {
    const indexCss = readFileSync(path.join(here, '..', 'index.css'), 'utf8')
    const match = indexCss.match(/--nav-bar-height:\s*([\d.]+)rem/)
    expect(match).not.toBeNull()
    expect(Number(match![1]) * 16).toBeGreaterThanOrEqual(44)
  })
})

describe('ticket #275 — WhyIcon, drawn in this repo, same rules as the other three', () => {
  it('every destination renders one inline SVG glyph alongside its label', () => {
    const html = renderAt('/')
    const iconCount = (html.match(/<svg [^>]*class="app-bar__icon"/g) ?? []).length
    expect(iconCount).toBe(4)
  })

  it('no icon library, no new dependency — NavIcons.tsx imports nothing but react types', () => {
    const imports = iconsSource.match(/^import .*$/gm) ?? []
    expect(imports).toEqual(["import type { SVGProps } from 'react'"])
  })

  it('no emoji anywhere in the bar or the icon set', () => {
    const emoji = /\p{Extended_Pictographic}|️/u
    expect(emoji.test(iconsSource)).toBe(false)
    expect(emoji.test(tsx)).toBe(false)
    expect(emoji.test(renderAt('/'))).toBe(false)
  })

  it('WhyIcon shares the one grid, stroke-not-fill, currentColor rules every other glyph follows', () => {
    const viewBoxes = iconsSource.match(/viewBox="[^"]*"/g) ?? []
    expect(new Set(viewBoxes)).toEqual(new Set(['viewBox="0 0 24 24"']))
    expect(iconsSource).not.toMatch(/fill="(?!none)/)
    const rendered = renderAt('/')
    expect(rendered).not.toMatch(/#[0-9a-fA-F]{3,8}\b/)
    expect(rendered).not.toMatch(/rgba?\(/)
    expect(rendered).not.toMatch(/stroke-width/) // weight lives in CSS, not inline
  })

  it('every destination keeps an accessible name; every icon is decorative', () => {
    const html = renderAt('/')
    for (const label of ['Home', 'Why', 'Chips', 'Record']) {
      expect(html).toContain(`>${label}</span>`)
    }
    // Whole opening tags, not two independently-ordered substring checks —
    // Glyph (NavIcons.tsx) sets aria-hidden before spreading `className`
    // in, so it renders BEFORE `class=` in the tag, not after.
    const iconTags = html.match(/<svg [^>]*>/g) ?? []
    const iconOnlyTags = iconTags.filter((tag) => tag.includes('class="app-bar__icon"'))
    expect(iconOnlyTags.length).toBe(4)
    expect(iconOnlyTags.every((tag) => tag.includes('aria-hidden="true"'))).toBe(true)
  })
})

describe('ticket #275 — "glow, not frost": light blur, real refraction where supported, faux fallback otherwise', () => {
  it('the shape carries a bright rim, a specular sheen and an outer glow, all via tokens (no hand-typed colour)', () => {
    const shapeRule = css.match(/\.app-bar__shape\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(shapeRule).toMatch(/border:\s*1px solid var\(--nav-glass-rim\)/)
    expect(shapeRule).toMatch(/border-top-color:\s*var\(--nav-glass-rim-bright\)/)
    expect(shapeRule).toMatch(/var\(--nav-glass-glow\)/)
    expect(css).toMatch(/\.app-bar__sheen\s*\{[^}]*background:\s*linear-gradient/)
  })

  it('the refraction tier is lighter blur than the app\'s own panel blur — "light blur at most", never the old bar\'s heavy 28px', () => {
    const indexCss = readFileSync(path.join(here, '..', 'index.css'), 'utf8')
    const px = (name: string) => Number(indexCss.match(new RegExp(`--${name}:\\s*(\\d+)px`))?.[1])
    expect(px('nav-glass-blur')).toBeLessThan(px('panel-blur'))
    expect(px('nav-glass-blur-faux')).toBeLessThan(px('material-bar-blur')) // still under the old "glassiest surface" ceiling
  })

  it('the refraction tier uses backdrop-filter: url(#…) with a real feDisplacementMap filter', () => {
    const rule = css.match(/\.app-bar__shape--refract\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/backdrop-filter:[^;]*url\(#nav-glass-refraction\)/)
    expect(tsx).toMatch(/feDisplacementMap/)
    expect(tsx).toMatch(/id="nav-glass-refraction"/)
  })

  it('the faux tier (no url() support) uses heavier blur/saturation instead, per the nav spec\'s own instruction', () => {
    const rule = css.match(/\.app-bar__shape--faux\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/backdrop-filter:\s*blur\(var\(--nav-glass-blur-faux\)\)\s*saturate\(var\(--nav-glass-saturate-faux\)\)/)
  })

  it('support is feature-detected with CSS.supports, not a user-agent sniff, and never throws where CSS is undefined (this test file\'s own Node environment)', () => {
    expect(tsx).toMatch(/CSS\.supports/)
    expect(tsx).not.toMatch(/navigator\.userAgent/)
    // The module import above already exercised this at load time under
    // vitest's Node environment (no `CSS` global) without throwing —
    // this assertion documents that guarantee explicitly.
    expect(typeof CSS).toBe('undefined')
  })
})

describe('ticket #275 — the tab-switch slide, stretch and icon bounce are transform/opacity only', () => {
  it('the active pill slides via a CSS transition on transform, at the spring easing token', () => {
    const rule = css.match(/\.app-bar__active-pill\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/transform:\s*translateX\(calc\(var\(--nav-active-index, 0\) \* 100%\)\)/)
    expect(rule).toMatch(/transition:\s*transform var\(--dur-spring\) var\(--ease-spring\)/)
  })

  it('four equal-width tabs make the slide pure CSS — 25% width, no runtime measurement of tab positions', () => {
    expect(css).toMatch(/\.app-bar__active-pill\s*\{[^}]*width:\s*25%/)
    expect(css).toMatch(/\.app-bar__item\s*\{[^}]*flex:\s*1 1 0/)
    expect(tsx).not.toMatch(/getBoundingClientRect/)
  })

  it('the stretch and the bounce are separate elements, each with its own @keyframes, both transform-only', () => {
    expect(css).toMatch(/@keyframes nav-pill-stretch\s*\{[\s\S]*?scaleX/)
    expect(css).toMatch(/@keyframes nav-icon-bounce\s*\{[\s\S]*?scale\(/)
    // Sliced by position (start-of-rule to start-of-next-rule) rather than
    // a brace-matching regex — a @keyframes block nests one `}` per stop,
    // which a lazy `[\s\S]*?\}` would stop at prematurely.
    const stretchStart = css.indexOf('@keyframes nav-pill-stretch')
    const bounceStart = css.indexOf('@keyframes nav-icon-bounce')
    const afterBounceStart = css.indexOf('/* ---- The collapsed circle', bounceStart)
    expect(stretchStart).toBeGreaterThan(-1)
    expect(bounceStart).toBeGreaterThan(stretchStart)
    expect(afterBounceStart).toBeGreaterThan(bounceStart)
    const stretchBlock = css.slice(stretchStart, bounceStart)
    const bounceBlock = css.slice(bounceStart, afterBounceStart)
    for (const block of [stretchBlock, bounceBlock]) {
      const declarations = block.match(/^\s+[a-z-]+:/gm) ?? []
      expect(new Set(declarations.map((d) => d.trim()))).toEqual(new Set(['transform:']))
    }
  })

  it('the keyframes are retriggered via a reflow, not a remount, and only on a genuine tab change', () => {
    expect(tsx).toMatch(/classList\.remove\('app-bar__pulse'\)/)
    expect(tsx).toMatch(/void el\.offsetWidth/)
    expect(tsx).toMatch(/classList\.add\('app-bar__pulse'\)/)
    expect(tsx).toMatch(/prevDisplayIndexRef\.current === displayIndex\) return/)
  })

  it('no hand-typed cubic-bezier survives outside the two named easing tokens', () => {
    expect(css).not.toMatch(/cubic-bezier\(/)
  })
})

describe('ticket #275 — collapse on scroll: transform/opacity only, anchored at the shape\'s own left edge', () => {
  it('the shape collapses via scaleX from a measured ratio, transform-origin: left — never width/border-radius', () => {
    const rule = css.match(/\.app-bar__shape\s*\{[\s\S]*?\n\}/)?.[0] ?? ''
    expect(rule).toMatch(/transform-origin:\s*left center/)
    expect(rule).toMatch(/transition:\s*transform var\(--dur-collapse\) var\(--ease-out\)/)
    expect(rule).not.toMatch(/width:/)
    expect(rule).not.toMatch(/border-radius:\s*\d/) // it's `calc(var(--nav-bar-height) / 2)`, a constant throughout — not itself animated
    const collapsedRule = css.match(/\[data-collapsed='true'\] \.app-bar__shape\s*\{[^}]*\}/)?.[0] ?? ''
    expect(collapsedRule).toMatch(/transform:\s*scaleX\(var\(--nav-collapse-scale/)
  })

  it('the collapse ratio is measured with ResizeObserver against the bar\'s own diameter token, not hand-typed', () => {
    expect(tsx).toMatch(/ResizeObserver/)
    expect(tsx).toMatch(/NAV_CIRCLE_DIAMETER_PX \/ width/)
    expect(tsx).toMatch(/NAV_CIRCLE_DIAMETER_PX = 3\.5 \* 16/) // mirrors --nav-bar-height, index.css
  })

  it('the row and the collapsed button crossfade via opacity, never a hide/show toggle of the shape itself', () => {
    const rowRule = css.match(/\.app-bar__row\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rowRule).toMatch(/opacity:\s*1/)
    const collapsedButtonRule = css.match(/(?<!\[data-collapsed='true'\] )\.app-bar__collapsed\s*\{[^}]*\}/)?.[0] ?? ''
    expect(collapsedButtonRule).toMatch(/opacity:\s*0/)
  })

  it('tapping the collapsed circle expands the bar — a plain button, not a NavLink', () => {
    expect(tsx).toMatch(/<button[\s\S]*?className="app-bar__collapsed"[\s\S]*?onClick=\{\(\) => setCollapsed\(false\)\}/)
  })
})

describe('ticket #275 — the scroll-direction → collapsed/expanded pure function, with a threshold', () => {
  it('does nothing (stays expanded) while scrolling within the top guard', () => {
    let state = { lastY: 0, collapsed: false }
    state = nextNavScrollState(state, 10)
    expect(state.collapsed).toBe(false)
    state = nextNavScrollState(state, NAV_COLLAPSE_TOP_GUARD_PX)
    expect(state.collapsed).toBe(false)
  })

  it('collapses once downward scroll exceeds the threshold past the top guard', () => {
    let state = { lastY: NAV_COLLAPSE_TOP_GUARD_PX + 1, collapsed: false }
    state = nextNavScrollState(state, NAV_COLLAPSE_TOP_GUARD_PX + 1 + NAV_COLLAPSE_THRESHOLD_PX)
    expect(state.collapsed).toBe(true)
  })

  it('does NOT collapse on a small downward move under the threshold (no flicker)', () => {
    const start = { lastY: 200, collapsed: false }
    const state = nextNavScrollState(start, 200 + NAV_COLLAPSE_THRESHOLD_PX - 1)
    expect(state.collapsed).toBe(false)
    expect(state.lastY).toBe(200) // reference point unmoved, so it can still accumulate
  })

  it('small back-and-forth jitter under the threshold never accumulates into a flip', () => {
    let state = { lastY: 300, collapsed: false }
    for (const y of [304, 299, 305, 298, 303]) {
      state = nextNavScrollState(state, y)
      expect(state.collapsed).toBe(false)
    }
  })

  it('re-expands once upward scroll exceeds the threshold', () => {
    let state = { lastY: 500, collapsed: true }
    state = nextNavScrollState(state, 500 - NAV_COLLAPSE_THRESHOLD_PX)
    expect(state.collapsed).toBe(true) // not yet — exactly at the threshold boundary
    state = nextNavScrollState(state, 500 - NAV_COLLAPSE_THRESHOLD_PX - NAV_COLLAPSE_THRESHOLD_PX)
    expect(state.collapsed).toBe(false)
  })

  it('always re-expands near the top, regardless of prior state', () => {
    const state = nextNavScrollState({ lastY: 900, collapsed: true }, 5)
    expect(state.collapsed).toBe(false)
  })

  it('clamps negative (iOS rubber-band overscroll) scrollY to 0', () => {
    const state = nextNavScrollState({ lastY: 900, collapsed: true }, -40)
    expect(state.collapsed).toBe(false)
    expect(state.lastY).toBe(0)
  })
})

describe('ticket #275 — prefers-reduced-motion: instant state changes, no morph', () => {
  it('transform-driven transitions/animations rely on the existing global rule (index.css F8) — no local transform override needed', () => {
    expect(css).not.toMatch(/prefers-reduced-motion[\s\S]*?transform:\s*none/)
  })

  it('the collapse crossfade\'s own transition-delay is zeroed locally (delay is not covered by the global rule)', () => {
    const block = css.match(/@media \(prefers-reduced-motion: reduce\)\s*\{[\s\S]*\}/)?.[0] ?? ''
    expect(block).toMatch(/\.app-bar__row,\s*\n\s*\.app-bar__collapsed\s*\{[^}]*transition-delay:\s*0s/)
  })
})

describe('ticket #275 — route change resets the bar to expanded', () => {
  it('resets collapsed state and the scroll reference point on every pathname change', () => {
    expect(tsx).toMatch(/\[location\.pathname\]\)/)
    expect(tsx).toMatch(/setCollapsed\(false\)/)
  })
})
