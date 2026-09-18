# Ticket #252 — Fix the stale team-strength gate — it fails on every healthy run

## HIGH-IMPACT

None this ticket — the fix was mechanical implementation of a fully-specified pass/fail rule,
not a judgement call with a because behind it.

## ROUTINE

- **Tier 3 — kept `checkTeamStrengthSourceGate`'s function and type names unchanged** despite the
  semantic rewrite (liveness-only → liveness-plus-health), renaming only the internal result
  fields (`count` → `countsBySource` + `reason`, as the ticket required for the per-source counts).
  **Because** gates 2/3/5/6/7's own source-invariant tests and `main()`'s shared wiring reference
  the gate by name, and the ticket explicitly said not to touch those gates — renaming the
  function would have forced unrelated churn for no benefit.
- **Tier 3 — "renumber/retitle the gate" interpreted as retitling gate 1's report text in place**,
  still numbered "1.", rather than reshuffling all seven gates' numbers. **Because** the ticket
  separately says to keep gates 2, 3, 5, 6, 7 "exactly as they are," which a renumber would
  contradict.
- **Tier 3 — the "Reading this table" note was already correct** about `market-odds` being the
  top precedence tier; rather than leave it untouched, an explicit clarifying sentence was added
  ("`team-strength` is NOT the top tier any more... second tier") to remove any ambiguity that the
  DoD item was met.

All three Tier 3 calls were verified independently by QA (PASS, 18 Sep 2026) alongside the full
diff, build, lint and test suite, with no unflagged Tier 1/2 concern found.
