/**
 * Recommendation availability — ticket #55 (feature-list item 14).
 *
 * "Decide whether a recommendation is sendable at all" (this ticket's own
 * Scope). `recommendations` is upserted per gameweek and never has old rows
 * deleted (see `supabase/migrations/20260817090000_recommendations.sql`'s
 * file header), so a stored row for some past gameweek always exists once
 * the app has run for a while — the question this module answers is never
 * "does a row exist" but "is the MOST RECENT row current, or old, or is
 * there nothing at all."
 *
 * product-brief.md §6a/§6d: "It must never present stale recommendations as
 * current. No recommendation is better than a wrong one." This ticket's own
 * DoD: "A recommendation older than current gameweek is never sent as
 * current — state its age explicitly or send the failure notice." This
 * module implements the "state its age explicitly" branch — the message
 * composers in `message.ts` build the actual wording.
 *
 * Pure, no I/O — `scripts/send-telegram.ts` derives both gameweek ids from
 * Supabase reads and passes them in here.
 */

export type RecommendationAvailability =
  | { kind: 'current' }
  | { kind: 'stale'; recommendationGameweekId: number; currentGameweekId: number; gameweeksBehind: number }
  | { kind: 'none' }

export interface AvailabilityInput {
  /** The gameweek this notification run targets — the next one whose deadline has not yet passed (or the last known gameweek, at the end of the data this app has). */
  currentGameweekId: number
  /** The highest gameweek_id present in `recommendations` (plan_index 0), or null if the table has no rows at all yet. */
  latestRecommendationGameweekId: number | null
}

/**
 * `latestRecommendationGameweekId` ahead of `currentGameweekId` is treated
 * as 'current', not stale or an error: it can only mean the solver has
 * already produced a plan for a gameweek this job's own "next unpassed
 * deadline" lookup hasn't caught up to yet (e.g. the `gameweeks` table
 * lagging a fresh ingest) — the plan is still the best forward-looking one
 * available, not old data being presented as new.
 */
export function classifyAvailability(input: AvailabilityInput): RecommendationAvailability {
  const { currentGameweekId, latestRecommendationGameweekId } = input

  if (latestRecommendationGameweekId === null) {
    return { kind: 'none' }
  }
  if (latestRecommendationGameweekId < currentGameweekId) {
    return {
      kind: 'stale',
      recommendationGameweekId: latestRecommendationGameweekId,
      currentGameweekId,
      gameweeksBehind: currentGameweekId - latestRecommendationGameweekId,
    }
  }
  return { kind: 'current' }
}
