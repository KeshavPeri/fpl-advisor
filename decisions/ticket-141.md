# Ticket #141 — Fix the chip advisory display — collapse duplicate solutions and attribute the delta to the chip set, not each chip

## HIGH-IMPACT

(none — Tier 3, a display correction with no stored-data, schema or behaviour change outside the
`/chips` screen)

## ROUTINE

- **Grouping key for "distinct plan" is a solution's own set of `(chipCode, chipGameweekId)` pairs,
  sorted by gameweek then chip code.** Two solutions collapse into one advisory only when they name
  the exact same chips in the exact same gameweeks; anything else — a different chip, a different
  gameweek for the same chip — is treated as a genuinely distinct plan, matching the ticket's own
  "different chips or different gameweeks" wording.
- **The single delta figure for a collapsed plan is read once, from that plan's first solution,**
  never recomputed or averaged. `chip_advisories` replicates one solution's objective delta onto
  every chip row within that solution (a database-computed `GENERATED` column), so every row sharing
  a solution index already carries the same value by construction — reading the first is not a
  simplification, it's reading the one number that exists.
- **`totalSolutionCount` counts DISTINCT `solutionIndex` values actually present in the fetched
  `chip_advisories` rows, not a hardcoded 3.** A solution that played no chip at all leaves no row in
  this table, so this is the most honest total the stored data can give — it undercounts only in the
  (currently unobserved) case where some alternate solutions play no chip while others do, which the
  DoD doesn't ask this ticket to solve.
- **The "N of M solutions" note is shown on the screen only when more than one distinct plan
  exists.** When there's exactly one plan, every solution that named a chip agreed on it by
  construction (that's what makes it one plan), so `solutionCount === totalSolutionCount` always
  holds and printing it would be redundant boilerplate, not information — it becomes informative
  exactly when solutions disagree, which is when it's shown.
- **Copy for the single delta line: "+N pts across the horizon"**, invented for this ticket (not
  specified verbatim in the DoD) — chosen to echo the ticket's own illustrative sentence ("...is
  worth +18 points across the horizon") and to read as one statement rather than a bare number, while
  staying short enough to sit under a decision list without becoming a second horizon-caution
  sentence (the fixed five-gameweek caution, `CHIP_ADVISORY_HORIZON_NOTE`, is kept verbatim and
  still renders once beneath the whole card, unchanged from ticket #126).
- **Decision rows keep the existing `chips-advisory__row`/`chips-advisory__list` markup and CSS
  classes**, with the per-row delta removed (moved to the new `chips-advisory__delta` line per
  plan) rather than introducing a new row component — matches design-reference.md's instruction to
  extend the chips screen's existing components and tokens rather than redesign it. `frontend-design`
  and Impeccable were not invoked (this ticket extends an existing surface, not a new one).
- **Local git state note (not a ticket decision, recorded for the run log):** this worktree's local
  `main`/`origin/main` refs were stale at task start — several tickets behind the repository's real
  `main` (missing #126, #132, #134–139 and beyond), even though the working tree's `HEAD` had already
  advanced past them on a differently-named branch. A `git fetch origin main` corrected the remote-
  tracking ref to the real `main` before this ticket's branch was created from it; no ticket work was
  affected, but a future run hitting the same stale-ref symptom should fetch before assuming the
  repository has diverged.
