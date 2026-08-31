import { BENCH_SIZE } from '../lib/squad/positions'
import './Pitch.css'
import './PitchSkeleton.css'

/**
 * A representative 4-4-2 formation shape, purely for footprint — the
 * actual saved formation is unknown before the read resolves. Reuses
 * Pitch.css's row/bench classes so the real Pitch swaps in at (close to)
 * the same height instead of causing a jump (DoD: "no layout shift when
 * data arrives"). The bench row always uses BENCH_SIZE, which is fixed
 * regardless of formation.
 *
 * Ticket #169 / docs/ui-audit-2026-08-31.md F25/F28 — matches Pitch.tsx's
 * own structure exactly: no `<Surface>` on either the field or the bench,
 * `bleed` full-bleed, bench-sized placeholder shirts on the bench row.
 */
const ROW_SHIRT_COUNTS = [1, 4, 4, 2] as const

function PitchSkeleton() {
  return (
    <div className="pitch bleed" aria-hidden="true">
      <div className="pitch__field">
        {ROW_SHIRT_COUNTS.map((count, rowIndex) => (
          <div className="pitch__row" key={rowIndex}>
            {Array.from({ length: count }).map((_, shirtIndex) => (
              <div className="pitch-skeleton__shirt" key={shirtIndex} />
            ))}
          </div>
        ))}
      </div>
      <div className="pitch__bench">
        <p className="pitch__bench-title">Bench</p>
        <div className="pitch__bench-row">
          {Array.from({ length: BENCH_SIZE }).map((_, shirtIndex) => (
            <div className="pitch-skeleton__shirt pitch-skeleton__shirt--bench" key={shirtIndex} />
          ))}
        </div>
      </div>
    </div>
  )
}

export default PitchSkeleton
