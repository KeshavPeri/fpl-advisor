/**
 * Availability-ring derivation for the pitch (ticket #38).
 *
 * Pure and self-contained — no I/O, no Supabase — so it is provable without
 * a database, matching the convention set by `src/lib/projection/minutes.ts`
 * (which computes something adjacent — a continuous `availabilityFactor`
 * for the projection model). This file is intentionally a separate,
 * independent implementation rather than an import of that one: the rules
 * differ (a discrete solid/hollow/none *ring*, not a [0,1] factor), the
 * ticket is explicit that this screen must not read or surface anything
 * from the projection layer, and `src/lib/squad/positions.ts`'s own header
 * comment already establishes the precedent of a feature owning its own
 * copy of a small domain rule rather than importing across an unrelated
 * module boundary. See decisions/ticket-38.md.
 *
 * Rules, verbatim from the ticket's definition of done:
 *  - status 'i' | 's' | 'u'                              -> solid coral ring
 *  - status 'd', OR any non-null chance below 100         -> hollow coral ring
 *  - status 'a' with no chance set (and nothing above matched) -> no ring
 */

export type AvailabilityRing = 'solid' | 'hollow' | 'none'

export interface Availability {
  ring: AvailabilityRing
  /**
   * The non-colour channel for the ring: assistive tech reads this instead
   * of relying on the ring's colour/fill alone (design-reference.md's
   * accessibility expectations, applied here explicitly by the ticket).
   */
  label: string
}

const OUT_STATUSES = new Set(['i', 's', 'u'])

const OUT_STATUS_LABEL: Record<string, string> = {
  i: 'Injured',
  s: 'Suspended',
  u: 'Unavailable',
}

export function deriveAvailability(
  status: string,
  chanceOfPlayingNextRound: number | null
): Availability {
  if (OUT_STATUSES.has(status)) {
    return { ring: 'solid', label: OUT_STATUS_LABEL[status] ?? 'Unavailable' }
  }

  if (status === 'd' || (chanceOfPlayingNextRound !== null && chanceOfPlayingNextRound < 100)) {
    const label =
      chanceOfPlayingNextRound !== null
        ? `Doubtful — ${chanceOfPlayingNextRound}% chance of playing`
        : 'Doubtful'
    return { ring: 'hollow', label }
  }

  return { ring: 'none', label: 'Available' }
}
