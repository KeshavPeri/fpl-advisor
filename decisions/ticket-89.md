# Ticket #89 — Narrow the preflight projections check to available players

## HIGH-IMPACT

- Check 3 (projections) reads its own independent `teams` and gameweek-scoped `fixtures`
  queries rather than sharing check 6's existing reads. **Because** the preflight file's own
  established convention (stated in its header) is that each check reads independently so one
  check's query shape never entangles with another's — check 6's fixtures read spans a
  5-gameweek horizon, not the single target gameweek check 3 needs, so sharing would have
  produced the wrong data even if it had been convenient.

## ROUTINE

- The all-zero breakdown reason-string wording (`"all-zero breakdown: N total (...)"`) is a
  Tier 3 formatting choice, matching the file's existing reason-string conventions.
- A projection row whose `player_id` has no matching `players` row is folded into the failing
  "available" bucket rather than silently passed, matching the file's own governing rule that
  it never returns a pass for something it could not evaluate — same treatment as an unresolved
  team id.
