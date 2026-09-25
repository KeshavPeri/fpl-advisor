import { useEffect, useRef, useState } from 'react'
import { fetchLatestMiniLeagueStandings } from '../lib/miniLeague/api.ts'
import { deriveMiniLeagueView } from '../lib/miniLeague/derive.ts'
import type { MiniLeagueStandingRow, MiniLeagueView } from '../lib/miniLeague/types.ts'
import { toErrorMessage } from '../lib/format'
import { getFplEntryId } from '../lib/squad/env.ts'
import Surface from './Surface'
import './MiniLeagueCard.css'

/**
 * Whether the viewer has asked for reduced motion — same static, one-shot check AppShell.tsx's
 * own `prefersReducedMotion` already uses for its scroll parallax (that file's own header:
 * src/lib/squad/positions.ts's precedent of a feature owning its own small copy of a domain
 * rule rather than importing across an unrelated module boundary — this is the same call for a
 * one-line platform check). Read once; this app has no live theme/motion toggle to react to.
 */
function prefersReducedMotion(): boolean {
  return typeof window !== 'undefined' && window.matchMedia('(prefers-reduced-motion: reduce)').matches
}

const COUNT_UP_DURATION_MS = 700

/**
 * Ticket #276 — "points count up on first view (reduced-motion: static)." One run from 0 to
 * `target` on mount (or whenever `target` itself changes — a page-lifetime remount is the only
 * "re-view" this component can have, since MiniLeagueCard owns a single fetch-on-mount), eased
 * out, cancelled on unmount. Reduced motion (or a null target) skips the animation and renders
 * the final value immediately — never an incomplete count frozen mid-way.
 */
function useCountUp(target: number | null): number | null {
  const reduced = useRef(prefersReducedMotion())
  const [value, setValue] = useState<number | null>(reduced.current ? target : target === null ? null : 0)

  useEffect(() => {
    if (target === null || reduced.current) {
      setValue(target)
      return
    }
    const finalValue = target
    let frame: number
    const start = performance.now()
    function tick(now: number) {
      const progress = Math.min((now - start) / COUNT_UP_DURATION_MS, 1)
      const eased = 1 - (1 - progress) ** 3
      setValue(Math.round(finalValue * eased))
      if (progress < 1) frame = requestAnimationFrame(tick)
    }
    frame = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(frame)
  }, [target])

  return value
}

/** How far (in points) the gap bar's fill reads as "full" — a Tier 3 visual scale, not a real
 *  bound (a mini-league's point gaps have no natural maximum): far enough that everyday single-
 *  and double-digit gaps still show a meaningfully different fill, close enough that the bar
 *  doesn't read as permanently near-empty. See this ticket's own report. */
const GAP_BAR_SCALE = 40

function pointsPhrase(points: number): string {
  return `${points} point${points === 1 ? '' : 's'}`
}

function nameOf(row: MiniLeagueStandingRow | null): string {
  if (!row) return 'the place above'
  return row.entryName ?? row.playerName ?? 'the place above'
}

/**
 * Ticket #276 — "a gap bar: points to the place above, or your lead over 2nd when you're 1st
 * ('Leading by 26')." Renders nothing when there's no safe gap to show (no `you`, or the
 * underlying totals are unavailable — derive.ts already returns null rather than guessing in
 * either case).
 */
function GapBar({ view }: { view: MiniLeagueView }) {
  const value = view.isLeading ? view.leadOverSecond : view.gapToAbove
  const animatedValue = useCountUp(value)

  if (value === null || animatedValue === null) return null

  const label = view.isLeading
    ? `Leading by ${animatedValue}`
    : `${pointsPhrase(animatedValue)} to ${nameOf(view.above)}`
  const fillPercent = Math.min((value / GAP_BAR_SCALE) * 100, 100)

  return (
    <div className="mini-league-card__gapbar">
      <div className="mini-league-card__gapbar-track">
        <div
          className={
            view.isLeading
              ? 'mini-league-card__gapbar-fill mini-league-card__gapbar-fill--leading'
              : 'mini-league-card__gapbar-fill'
          }
          style={{ width: `${fillPercent}%` }}
        />
      </div>
      <p className="mini-league-card__gapbar-label">{label}</p>
    </div>
  )
}

function MovementBadge({ movement }: { movement: number | null }) {
  if (movement === null || movement === 0) {
    return (
      <span className="mini-league-card__movement mini-league-card__movement--flat">
        <span className="num">–</span>
      </span>
    )
  }
  const up = movement > 0
  return (
    <span
      className={
        up
          ? 'mini-league-card__movement mini-league-card__movement--up'
          : 'mini-league-card__movement mini-league-card__movement--down'
      }
    >
      <span className="mini-league-card__movement-arrow" aria-hidden="true">
        {up ? '▲' : '▼'}
      </span>
      <span className="num">{Math.abs(movement)}</span>
    </span>
  )
}

/**
 * Ticket #276 — "team name prominent, manager name small." Both names render whenever both
 * exist; a row with only one of the two (a real gap in the underlying data — both columns are
 * nullable, see MiniLeagueStandingRow) falls back to whichever it has, exactly as before this
 * ticket, rather than showing an empty manager line.
 */
function StandingsRow({ row, isYou }: { row: MiniLeagueStandingRow; isYou: boolean }) {
  const total = useCountUp(row.total)
  const primaryName = row.entryName ?? row.playerName
  const managerName = row.entryName && row.playerName ? row.playerName : null

  return (
    <li className={isYou ? 'mini-league-card__row mini-league-card__row--you' : 'mini-league-card__row'}>
      <span className="mini-league-card__row-rank num">{row.rank}</span>
      <span className="mini-league-card__row-names">
        <span className="mini-league-card__row-team">{primaryName ?? 'Unknown entry'}</span>
        {managerName && <span className="mini-league-card__row-manager">{managerName}</span>}
      </span>
      <span className="mini-league-card__row-total num">{total ?? '—'}</span>
    </li>
  )
}

/**
 * The mini-league standings card (ticket #271, feature-list item 33; redesigned by ticket #276 —
 * "very bad and super unsatisfying. Make it satisfying yet premium"). product-brief.md §1:
 * standings "may be displayed. They must never enter the optimiser's objective" — this component
 * (and everything it reads under src/lib/miniLeague/) is display only, read by nothing else in
 * the app.
 *
 * Same pattern as AccuracyCard: owns its own read, independent of every other card's load state
 * — a slow or failed mini-league fetch must never block or blank the pitch or the verdict above
 * it. Loading/empty/error states follow AccuracyCard's own shapes (skeleton Surface, role="alert"
 * Surface, role="status" Surface).
 *
 * The rank figure uses --text-headline, matching AccuracyCard's own summary-tile figure —
 * design-reference.md/F30 (see VerdictCard.css) reserve --text-display for exactly one figure per
 * screen. The "premium moment" when leading (ticket #276) is a small crown glyph with a subtle
 * glow next to the rank, NOT this card's own `focal` (cyan-glow-panel) treatment — VerdictCard.tsx
 * already reserves that for the one focal panel on Home (its own comment: "F12/F39"), and a
 * second glowing panel on the same screen would contradict that, not complement it.
 */
function MiniLeagueCard() {
  const [state, setState] = useState<
    | { status: 'loading' }
    | { status: 'error'; message: string }
    | { status: 'ready'; view: MiniLeagueView }
  >({ status: 'loading' })

  useEffect(() => {
    let cancelled = false
    setState({ status: 'loading' })

    async function load() {
      try {
        const rows = await fetchLatestMiniLeagueStandings()
        if (cancelled) return
        setState({ status: 'ready', view: deriveMiniLeagueView(rows, getFplEntryId()) })
      } catch (err) {
        if (cancelled) return
        setState({ status: 'error', message: toErrorMessage(err) })
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [])

  if (state.status === 'loading') {
    return (
      <Surface className="mini-league-card mini-league-card--loading" aria-hidden="true">
        <div className="mini-league-card__skeleton-line mini-league-card__skeleton-line--title" />
        <div className="mini-league-card__skeleton-line mini-league-card__skeleton-line--figure" />
        <div className="mini-league-card__skeleton-line mini-league-card__skeleton-line--body" />
      </Surface>
    )
  }

  if (state.status === 'error') {
    return (
      <Surface className="mini-league-card" role="alert">
        <p className="mini-league-card__title">Mini-league</p>
        <p className="mini-league-card__error">
          Couldn't load mini-league standings: {state.message}. Reload this page to try again.
        </p>
      </Surface>
    )
  }

  const { view } = state

  if (!view.hasData) {
    return (
      <Surface className="mini-league-card" role="status">
        <p className="mini-league-card__title">Mini-league</p>
        <p className="mini-league-card__empty">{view.emptyStateMessage}</p>
      </Surface>
    )
  }

  return (
    <Surface className="mini-league-card">
      <p className="mini-league-card__title">Mini-league</p>

      {view.entryNotInLeague ? (
        <p className="mini-league-card__notice">
          Your entry isn't showing in this league's standings yet.
        </p>
      ) : (
        <>
          <div className="mini-league-card__headline">
            <div className="mini-league-card__rank-figure">
              {view.isLeading && (
                <span className="mini-league-card__crown" aria-hidden="true">
                  ♛
                </span>
              )}
              <span className="mini-league-card__rank-value num">{view.you?.rank}</span>
              <span className="mini-league-card__rank-of">of {view.leagueSize}</span>
            </div>
            <MovementBadge movement={view.movement} />
          </div>

          <GapBar view={view} />
        </>
      )}

      <ul className="mini-league-card__table">
        {view.rows.map((entry, index) =>
          entry.kind === 'divider' ? (
            // A divider carries no identity of its own to key by; its position in this
            // already-derived, already-sorted list is stable per render, so the index is safe.
            <li key={`divider-${index}`} className="mini-league-card__divider" aria-hidden="true">
              <span>···</span>
            </li>
          ) : (
            <StandingsRow key={entry.row.entryId} row={entry.row} isYou={view.you?.entryId === entry.row.entryId} />
          )
        )}
      </ul>
    </Surface>
  )
}

export default MiniLeagueCard
