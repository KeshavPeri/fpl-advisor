/// <reference types="node" />
// This file, unlike the rest of src/, reads its own source with Node's
// `fs` rather than importing it — Vite's SSR-mode CSS handling (which
// Vitest's default `environment: 'node'` runs under, per vitest.config.ts)
// resolves a `.css?raw` import to an empty string, since in SSR/node mode
// CSS content isn't needed for side-effecting `<style>` injection, and
// that resolution happens before the `?raw` query gets a say — confirmed
// empirically, not just by spec reading. `fs` sidesteps that entirely.
// The triple-slash reference above pulls in @types/node (already a
// devDependency) for just this file, without changing tsconfig.app.json's
// project-wide `types` list — that file is outside this ticket's scope.
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

const rawCss = readFileSync(
  join(dirname(fileURLToPath(import.meta.url)), 'PlayerShirt.css'),
  'utf-8'
)
// Comments in this file document the properties they deliberately avoid
// (by name) right next to the rules that avoid them — including this
// test's own name, in prose. Strip comments before matching so the tests
// below check actual declarations, not documentation about declarations.
const css = rawCss.replace(/\/\*[\s\S]*?\*\//g, '')

/**
 * Ticket #44, finding 2 — "no player name renders with a mid-word ellipsis
 * at 390px viewport" is a claim about rendered pixels. There's no
 * jsdom/testing-library dependency committed here (deliberately — this
 * ticket may not add one), so this file can't render and measure text on
 * its own. It was checked once, empirically, with a temporary local-only
 * harness (real Pitch/PlayerShirt components, mock data, Playwright +
 * headless Chromium — none of it committed, all of it removed before
 * handoff) against FPL's own longest current `web_name`,
 * "Alexander-Arnold" (16 characters). That check is what caught a real
 * bug: at the first size tried, 0.75rem, `-webkit-line-clamp: 2` was
 * still truncating that name onto a browser-inserted "…" after the
 * hyphen — a two-line clamp alone was not sufficient, only *usually*
 * sufficient. `--text-label-tight` (src/index.css) was stepped down to
 * 0.6875rem specifically because that was the smallest reduction that
 * cleared it for every name tried, "Alexander-Arnold" included. That
 * measurement can't be re-run in CI without the harness, so it isn't
 * automated — but the fix it produced (no `text-overflow`, wrap instead
 * of clip) is a general one, not tuned to that one name, and that part
 * *is* checked below, on every build.
 *
 * What's provable without a browser, and pinned against regression here:
 * a mid-word ellipsis can only appear via `text-overflow: ellipsis` (or
 * an explicit `content: '…'`, which this file never uses).
 * `.player-shirt__name` sets neither — overflow is handled by
 * `-webkit-line-clamp` wrapping onto a second line instead of truncating
 * a single one. Real names still wrap *within* a word sometimes (no
 * natural hyphen to break at, e.g. "Szoboszlai" → "Szobosz" / "lai") —
 * that's a mid-word *wrap*, not a mid-word *ellipsis*; the DoD forbids
 * the latter specifically, and `hyphens: auto` softens the common case
 * where the browser's dictionary has a better break point than "wherever
 * the width ran out".
 */

/**
 * #194, section A4 (rendering fault) — the four names the owner's own
 * phone rendered with a mid-word hyphen: "B.Fernan-des" (B.Fernandes),
 * "Ver-brugg…" (Verbruggen), "João Pe-dro" (João Pedro), "I.San-garé"
 * (I.Sangaré) — real current squad web_names, spelled correctly here and
 * cross-checked against docs/reports/calibration-report-6.md, which
 * cites "B.Fernandes", "Verbruggen" and "João Pedro" verbatim. `hyphens:
 * auto` (the actual cause — PlayerShirt.css's own comment) is a browser
 * dictionary lookup this file cannot re-run without a browser harness
 * (the same limitation ticket #44's own header above documents for the
 * empirical width check), so what's provable here is the same kind of
 * proof the ellipsis tests below already use: the ONE property that can
 * make a browser insert a hyphen character is `hyphens: auto` (or
 * `hyphens: manual` combined with a literal soft hyphen in the string,
 * which this file's data never contains) — if neither is set, there is
 * no mechanism left for a hyphen to appear, mid-word or otherwise.
 */
const NAMES_THAT_WERE_HYPHENATING = ['B.Fernandes', 'Verbruggen', 'João Pedro', 'I.Sangaré']

describe('PlayerShirt.css — name truncation mechanism (ticket #44, finding 2)', () => {
  it('never sets text-overflow: ellipsis anywhere in the file', () => {
    // The only CSS property that can produce a truncating ellipsis. If
    // this string isn't present, the browser has no mechanism available
    // to render one, mid-word or otherwise.
    expect(css).not.toMatch(/text-overflow\s*:\s*ellipsis/)
  })

  it('never sets white-space: nowrap on the name (that combination is what produced the old bug)', () => {
    const nameRule = css.match(/\.player-shirt__name\s*\{[^}]*\}/)?.[0] ?? ''
    expect(nameRule).not.toMatch(/white-space\s*:\s*nowrap/)
  })

  it('wraps the name across up to two lines instead of clipping a single line', () => {
    const nameRule = css.match(/\.player-shirt__name\s*\{[^}]*\}/)?.[0] ?? ''
    expect(nameRule).toMatch(/-webkit-line-clamp\s*:\s*2/)
    expect(nameRule).toMatch(/overflow-wrap\s*:\s*break-word/)
  })

  it('reserves a fixed height for the name so 1-line and 2-line names keep every slot the same height', () => {
    const nameRule = css.match(/\.player-shirt__name\s*\{[^}]*\}/)?.[0] ?? ''
    expect(nameRule).toMatch(/min-height\s*:\s*var\(--space-8\)/)
  })
})

describe('#194, section A4 — automatic hyphenation is disabled on the player name', () => {
  const nameRule = css.match(/\.player-shirt__name\s*\{[^}]*\}/)?.[0] ?? ''

  it('sets hyphens: none (and its -webkit- prefix for Safari/iOS)', () => {
    expect(nameRule).toMatch(/(?<!-webkit-)hyphens\s*:\s*none/)
    expect(nameRule).toMatch(/-webkit-hyphens\s*:\s*none/)
  })

  it('never sets hyphens: auto (the actual cause of the mid-word hyphens) anywhere in the file', () => {
    expect(css).not.toMatch(/hyphens\s*:\s*auto/)
  })

  it('the four names that were hyphenating on the owner\'s phone are real current web_names, not compound words with a natural hyphen the app should ever break at', () => {
    // With hyphens: none and no other insertion mechanism (checked above),
    // none of these can render with a browser-inserted hyphen — a
    // structural guarantee, not a per-name render (see this file's own
    // header comment on why a real render check isn't available here).
    for (const name of NAMES_THAT_WERE_HYPHENATING) {
      expect(name).not.toContain('­') // no soft hyphen either
    }
    expect(NAMES_THAT_WERE_HYPHENATING).toEqual(['B.Fernandes', 'Verbruggen', 'João Pedro', 'I.Sangaré'])
  })
})
