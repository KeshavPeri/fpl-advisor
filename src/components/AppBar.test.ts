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
    // #194, section C — "This week" renamed to "Home"; the label lives on
    // the `--home` item now, not necessarily first in DOM order (Home is
    // last, so its own CSS rule can win the cascade tie for the circular
    // shape — see AppBar.tsx's own comment).
    expect(html).toMatch(/href="\/"[\s\S]*?<span class="app-bar__label">Home<\/span>/)
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
  it('every destination renders one inline SVG glyph alongside its label, plus the dome-rim arc (ticket #202, section C)', () => {
    const html = renderAt('/')
    const iconCount = (html.match(/<svg [^>]*class="app-bar__icon"/g) ?? []).length
    expect(iconCount).toBe(3)
    // Ticket #202 adds a fourth, non-icon SVG — the dome's own visible
    // rim, the one curve a plain CSS `border` cannot draw around the
    // masked union shape (see AppBar.css's own header comment).
    const totalSvgCount = (html.match(/<svg /g) ?? []).length
    expect(totalSvgCount).toBe(4)
    expect(html).toMatch(/<svg [^>]*class="app-bar__dome-rim"/)
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

  it('every destination keeps an accessible name; the icons (and the dome-rim arc) are decorative', () => {
    const html = renderAt('/')
    for (const label of ['Home', 'Chips', 'Record']) {
      expect(html).toContain(`>${label}</span>`)
    }
    // Three icon glyphs plus the dome-rim arc, all aria-hidden — the
    // name never comes from a glyph.
    const hidden = (html.match(/<svg [^>]*aria-hidden="true"/g) ?? []).length
    expect(hidden).toBe(4)
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

  it('adds no keyframe/animation motion — only the press feedback the foundations already define, plus static positioning offsets', () => {
    expect(css).not.toMatch(/@keyframes|animation:/)
    const transforms = css.match(/transform:\s*[^;]+;/g) ?? []
    // Ticket #202, section C — `.app-bar`, `.app-bar__item--home` and
    // `.app-bar__dome-rim` all centre themselves with the same
    // `translateX(-50%)` now (the old Home-specific `translate(-50%,
    // -58%)` is gone along with Home's own independent box — see this
    // file's header comment and AppBar.css's).
    expect(transforms.sort()).toEqual([
      'transform: none;',
      'transform: scale(0.96);',
      'transform: translateX(-50%);',
      'transform: translateX(-50%);',
      'transform: translateX(-50%);',
    ])
  })
})

describe('#202, section C — one continuous piece of glass: a CSS mask union, not two overlapping bordered shapes', () => {
  it('.app-bar itself carries the union mask (a pill-rect layer unioned with a fixed-radius circle layer)', () => {
    const rule = css.match(/\.app-bar\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/mask-image:/)
    expect(rule).toMatch(/-webkit-mask-image:/)
    expect(rule).toMatch(/radial-gradient\(\s*circle calc\(var\(--nav-home-size\) \/ 2\)/)
    expect(rule).toMatch(/mask-composite:\s*add/)
  })

  it('the mask box spans the full union bounding height — bump overshoot plus the pill\'s own height', () => {
    const rule = css.match(/\.app-bar\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/height:\s*calc\(var\(--nav-bump-overshoot\)\s*\+\s*var\(--nav-bar-height\)\)/)
  })

  it('Home is no longer its own bordered, backdrop-filtered box — it carries neither a background nor a backdrop-filter of its own', () => {
    const rule = css.match(/\.app-bar__item--home\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/position:\s*absolute/)
    expect(rule).toMatch(/border-radius:\s*50%/)
    expect(rule).toMatch(/width:\s*var\(--nav-home-size\)/)
    expect(rule).toMatch(/height:\s*var\(--nav-home-size\)/)
    expect(rule).not.toMatch(/background:/)
    expect(rule).not.toMatch(/backdrop-filter:/)
    expect(rule).not.toMatch(/border:/)
  })

  it('the dome-rim arc\'s path data is derived from the same two tokens the mask uses, not a hand-typed guess', () => {
    const tsx = readFileSync(path.join(here, 'AppBar.tsx'), 'utf8')
    expect(tsx).toMatch(/NAV_HOME_SIZE_PX\s*=\s*3\.75\s*\*\s*16/)
    expect(tsx).toMatch(/NAV_BUMP_OVERSHOOT_PX\s*=\s*0\.9375\s*\*\s*16/)
    expect(tsx).toMatch(/DOME_ARC_PATH/)
    expect(tsx).toMatch(/large-arc-flag 0/) // documented, not just coded
  })

  it('a spacer reserves the circle\'s own footprint so the side items never collide with it', () => {
    const rule = css.match(/\.app-bar__home-spacer\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).toMatch(/width:\s*var\(--nav-home-size\)/)
  })

  it('one sharp type register across the whole bar — smaller/heavier/tighter, not layered with uppercase+wide-tracking too', () => {
    const rule = css.match(/\.app-bar__label\s*\{[^}]*\}/)?.[0] ?? ''
    expect(rule).not.toMatch(/text-transform:\s*uppercase/)
    expect(rule).toMatch(/font-weight:\s*650/)
    expect(rule).toMatch(/letter-spacing:\s*-0\.006em/)
  })
})

describe('#202, section C — the active destination carries a cyan fill and an outer bloom', () => {
  it('the active item has a box-shadow the inactive items do not', () => {
    const activeRule = css.match(/\.app-bar__item\[aria-current='page'\]\s*\{[^}]*\}/)?.[0] ?? ''
    expect(activeRule).toMatch(/box-shadow:\s*var\(--nav-active-glow\)/)
    const inactiveRule = css.match(/\.app-bar__item\s*\{[^}]*\}/)?.[0] ?? ''
    expect(inactiveRule).not.toMatch(/box-shadow:\s*var\(--nav-active-glow\)/)
  })

  it('the active item takes the cyan accent (not just a neutral primary-text swap)', () => {
    const activeRule = css.match(/\.app-bar__item\[aria-current='page'\]\s*\{[^}]*\}/)?.[0] ?? ''
    expect(activeRule).toMatch(/color:\s*var\(--accent-cyan\)/)
    expect(activeRule).toMatch(/background:\s*var\(--accent-cyan-dim\)/)
  })

  it('the glow token is defined once, in index.css, not re-typed here', () => {
    const indexCss = readFileSync(path.join(here, '..', 'index.css'), 'utf8')
    expect(indexCss).toMatch(/--nav-active-glow:/)
    expect(css).not.toMatch(/--nav-active-glow:\s*0 0/) // not redefined locally
  })

  it('applies identically to Home as to the two side items — no Home-specific override survives (the old "protect --material-bar" workaround is gone along with Home\'s own background)', () => {
    expect(css).not.toMatch(/\.app-bar__item--home\[aria-current='page'\]/)
  })
})

describe('#202, section C — the icon strokes are heavier than before', () => {
  it('the resting and active stroke weights are both raised, one consistent increment apart', () => {
    const barRule = css.match(/\.app-bar\s*\{[^}]*\}/)?.[0] ?? ''
    expect(barRule).toMatch(/--nav-stroke:\s*1\.75/)
    expect(barRule).toMatch(/--nav-stroke-active:\s*2\.25/)
  })
})

describe('ticket-79 follow-up, correction A — the bar is the glassiest surface here', () => {
  it('the bar carries the strongest backdrop blur in the app — every panel tier is strictly behind it (#194, section B)', () => {
    expect(css).toMatch(/backdrop-filter:\s*blur\(var\(--material-bar-blur\)\)/)
    const surfaceCss = readFileSync(path.join(here, 'Surface.css'), 'utf8')
    // Panels carry blur again now (#194) — the bar's distinction is no
    // longer "the only one with blur" but "the strongest one," asserted
    // numerically in index.css.test.ts's "nav bar is the glassiest
    // surface" test.
    expect(surfaceCss).toMatch(/backdrop-filter:\s*blur\(var\(--panel-blur\)\)/)
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
