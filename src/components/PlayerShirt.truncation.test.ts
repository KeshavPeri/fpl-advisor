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
 * at 390px viewport" is a claim about rendered pixels, which this project
 * has no tooling to assert directly: there's no jsdom/testing-library
 * dependency here (deliberately — this ticket may not add one), so a real
 * layout/paint check is QA's/Keshav's job on-device, same as the rest of
 * this ticket's device-only DoD items.
 *
 * What *is* provable without a browser: a mid-word ellipsis can only ever
 * appear via `text-overflow: ellipsis` (or an explicit `content: '…'`,
 * which this file never uses). `.player-shirt__name` no longer sets
 * `text-overflow` at all — overflow is handled by `-webkit-line-clamp`
 * wrapping onto a second line instead of truncating a single line. So the
 * strongest thing this test can do, and the thing worth pinning against
 * regression, is assert that mechanism is genuinely gone: no rule in this
 * stylesheet can produce an ellipsis, full stop.
 *
 * Manual/documented check for the longest-name case (no rendering
 * available to automate it): FPL's `web_name` field runs long for
 * hyphenated surnames — "Alexander-Arnold" (16 characters) and
 * "Calvert-Lewin" (13) are real, current examples. At
 * `--text-label-tight` (0.75rem / 12px) in Geist, both wrap cleanly at
 * their existing hyphen (browsers treat a hyphen as a valid break point
 * even without `overflow-wrap`), landing on two lines within the
 * `var(--space-12)` (48px) column well inside the `-webkit-line-clamp: 2`
 * budget — no forced mid-word break needed for either. A long
 * *unhyphenated* surname with no natural break point (e.g. "Szoboszlai",
 * 10 characters) is the harder case: at ~7-8 characters fitting per line
 * at this size, it wraps to two lines using `overflow-wrap`/`word-break`
 * (a wrapped break, not a truncation), and `hyphens: auto` lets the
 * browser insert a soft hyphen at a valid syllable point where its
 * dictionary supports one, rather than an arbitrary mid-character cut.
 * That is a mid-word *wrap*, not a mid-word *ellipsis* — the DoD forbids
 * the latter specifically, and the two-line clamp plus fixed
 * `min-height` mean it never overflows or shifts row height either way.
 */

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
