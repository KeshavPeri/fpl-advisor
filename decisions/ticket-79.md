# Ticket 79 — Add the reasoning screen

## HIGH-IMPACT

None. QA checked all five routine decisions below against escalation.md's test question
("would this be expensive to reverse after ten more tickets are built on top of it?") and found
none commit to a data structure, external dependency, or irreversible choice.

## ROUTINE

- Coverage is stated in words for **every** named player, not just the ones with missing
  history, with distinct wording for the has-history and no-history cases — because the ticket's
  own DoD says "stated in words for every player shown," a stricter bar than the verdict card's
  existing missing-only precedent.
- `formatComponentLabel` strips the trailing "Points" and converts camelCase to sentence case
  generically, with no hardcoded name-to-label map — because the DoD requires the breakdown to
  render from whatever `components.points` actually contains, and a generic formatter stays
  correct the moment ticket #78 adds a real `bonusPoints` figure, with no edit needed here.
- The horizon total and the horizon *label* (gameweek count) fail independently: if
  `solver_runs.horizon` can't be resolved, the label reads "Horizon unavailable" but the stored
  total still renders — one missing piece doesn't blank the other. (QA flagged as a non-blocking
  observation that the wording could momentarily read as if the number itself were missing; not
  acted on, since it wasn't a DoD item and the underlying behaviour is correct.)
- The four named players' (transfer in/out, captain, vice-captain) `player_projections` read is
  filtered by an explicit `player_id` list (≤4 rows) rather than using a paginate loop — checked
  against the ticket's pagination note by reading `src/lib/verdict/api.ts` directly: that file
  contains no range/paginate pattern to match, only `.eq()`/`.limit()` filters. This ticket's own
  new queries (≤4 rows for player_projections, ≤11 rows for the starting-XI `solver_picks` query)
  are structurally incapable of approaching Supabase's 1,000-row cap, which satisfies the
  underlying concern without a literal `paginate()` call.
- Captain gap is computed from raw (undoubled) `solver_picks.expected_points` for the flagged
  captain vs. the next-highest non-captain starter, reusing the same run-filtered starting-XI
  query shape (`is_lineup = true`, filtered by `gameweek_id`, `solution_index` and
  `solver_run_id`) that ticket #72 already established for the verdict card.
