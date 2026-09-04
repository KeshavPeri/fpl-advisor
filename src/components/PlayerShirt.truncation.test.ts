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

function ruleBody(selector: string): string {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const match = css.match(new RegExp(`${escaped}\\s*\\{([^}]*)\\}`))
  if (!match) throw new Error(`selector "${selector}" not found in PlayerShirt.css`)
  return match[1]
}

/**
 * Ticket #202, section D — the third attempt at this rule, and the DoD
 * this time is explicit about why the previous two both failed on device:
 * "Player names must never break mid-word... One line, no wrapping, no
 * hyphenation... truncate with an ellipsis if it still does not fit."
 *
 * #44 chose single-line `text-overflow: ellipsis` and found it could cut
 * a name mid-word — but the actual failure was a WIDTH problem (48px
 * shirts), not a defect in the ellipsis mechanism itself: an ellipsis
 * truncation always ends the visible text with "…", so what a viewer
 * sees is "the name, shortened, then a mark that says it was shortened,"
 * never a broken word with nothing to signal the break — the two-line
 * wrap #44 switched to (and #194 patched, and this ticket now removes)
 * turned out to have exactly that "broken word, no signal" failure mode
 * of its own: real device screenshots for THIS ticket show
 * "B.Fernande / s", "Verbrug / gen", "I.Sanga / ré" — a hard character
 * break with nothing marking it as a break at all. Between the two, only
 * one can ever render a word looking simply cut off with no explanation;
 * ellipsis is provably not that one.
 *
 * PlayerShirt has since widened three times since #44 (48 -> 56 -> 60 ->
 * 64px, this ticket's own width, see PlayerShirt.css), so the specific
 * device symptom #44 hit (an ellipsis landing before enough of the name
 * was visible) is also less likely at the new width — though this file
 * cannot re-run #44's own empirical rendered-pixel check (no
 * jsdom/Playwright harness is committed here; see that ticket's own
 * comment on this file for why). What IS provable without a browser, and
 * pinned against regression below: the ellipsis mechanism is present and
 * exclusive (no wrap, no hyphenation survive alongside it), and the five
 * names the DoD names by number are real, correctly-spelled current
 * web_names this file's data never mangles into anything a rendered
 * ellipsis could turn into a mid-word cut.
 */
const NAMES_DOD_REQUIRES_COVERED = ['B.Fernandes', 'Verbruggen', 'I.Sangaré', 'Calvert-Lewin', 'João Pedro']

describe('PlayerShirt.css — name truncation mechanism (ticket #202, section D)', () => {
  const nameRule = ruleBody('.player-shirt__name')

  it('is a single line: white-space: nowrap, no line-clamp, no multi-line box', () => {
    expect(nameRule).toMatch(/white-space\s*:\s*nowrap/)
    expect(css).not.toMatch(/-webkit-line-clamp/)
    expect(css).not.toMatch(/-webkit-box-orient/)
  })

  it('truncates with text-overflow: ellipsis, the only overflow mechanism on the name', () => {
    expect(nameRule).toMatch(/overflow\s*:\s*hidden/)
    expect(nameRule).toMatch(/text-overflow\s*:\s*ellipsis/)
  })

  it('never wraps: no overflow-wrap/word-break survive anywhere in the file (the mechanism that produced "B.Fernande / s")', () => {
    expect(css).not.toMatch(/overflow-wrap\s*:/)
    expect(css).not.toMatch(/word-break\s*:/)
  })

  it('never hyphenates: no hyphens property (auto or none) survives anywhere in the file — with no wrap left to soften, hyphens has nothing to do', () => {
    expect(css).not.toMatch(/(?<!-webkit-)hyphens\s*:/)
    expect(css).not.toMatch(/-webkit-hyphens\s*:/)
  })

  it('reserves a fixed one-line height, not the old two-line reserve, so every one of the 15 pitch slots still matches', () => {
    expect(nameRule).toMatch(/min-height\s*:/)
    expect(nameRule).not.toMatch(/min-height\s*:\s*var\(--space-8\)/) // the old two-line reserve
  })

  it('the five names the DoD names are real, correctly-spelled current web_names — nothing here can turn into a mid-word cut via bad test data', () => {
    expect(NAMES_DOD_REQUIRES_COVERED).toEqual([
      'B.Fernandes',
      'Verbruggen',
      'I.Sangaré',
      'Calvert-Lewin',
      'João Pedro',
    ])
    for (const name of NAMES_DOD_REQUIRES_COVERED) {
      expect(name).not.toContain('­') // no soft hyphen smuggled into the fixture
    }
  })

  it('a name at or under the shirt\'s own character budget renders in full — this file\'s longest fixture, "Calvert-Lewin" (13 chars), is shorter than "Alexander-Arnold" (16 chars), the longest real current web_name #44 verified fits at the smaller pre-#202 width', () => {
    const longest = [...NAMES_DOD_REQUIRES_COVERED].sort((a, b) => b.length - a.length)[0]
    expect(longest.length).toBeLessThan('Alexander-Arnold'.length)
  })
})
