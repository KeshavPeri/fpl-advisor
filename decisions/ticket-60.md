# Decisions — ticket #60

## HIGH-IMPACT

- **`iteration_criteria` changed from `this_gw_transfer_in_out` to `this_gw_transfer_in`** —
  **because** the first real recommendation run produced three "plans" with the same incoming
  player, the same captain and identical scores, differing only in which bench player was sold.
  `this_gw_transfer_in_out` only requires the transfer IN *or* OUT player to differ, and varying
  the OUT player alone is nearly free for the optimiser — it took that route every time.
  `this_gw_transfer_in` forces the INCOMING player to differ, which is the decision a human is
  actually choosing between when reading "Plan B". This shapes every recommendation the app will
  ever produce, per the ticket's own framing. (Tier 2)
- **A Supabase DELETE for stale `recommendations` rows is NOT wired in — flagged, not
  implemented.** The DoD asks for "re-running for the same gameweek removes plans that no longer
  exist rather than leaving stale plan_index rows." **Because**: (1) `public.recommendations`'s
  own migration (`20260817090000_recommendations.sql`) explicitly withholds `DELETE` from
  `service_role`'s GRANT, on the strength of ticket #47's own DoD ("this file issues no Supabase
  row-removal call of any kind") — a raw delete call from this script would fail with
  "permission denied for table recommendations" under the grants as they stand today; (2)
  granting `DELETE` needs a new migration, which is both outside this ticket's Scope constraint
  (its file list, and its explicit "No new database table, no migration") and outside
  `escalation.md`'s Tier 1 boundary — "any migration or operation that deletes ... data in the
  live Supabase instance" is Tier 1 (STOP for a human), and the Tier 2 carve-out is explicitly
  limited to "code, test fixtures, or seed data," which stored recommendations are not. I
  implemented the pure logic this needs (`src/lib/recommendation/staleness.ts`'s
  `computeStalePlanIndices`, unit-tested including the "three-then-one" case the DoD names) and
  left it unwired, with a comment in `scripts/generate-recommendations.ts`'s file header pointing
  here. A human needs to decide whether to add a migration granting `DELETE` (and accept that a
  scheduled job will then issue deletes against live production data) before this DoD item can be
  completed. (Tier 1 — flagged, not decided by the Builder)

## ROUTINE

- **`SCORE_TOLERANCE = 0.5`** (points, summed across the whole solve horizon — same quantity as
  `score.ts`'s `computePlanScore`) is the threshold below which two plans sharing an incoming
  player and captain count as the same decision. EXPLICITLY UNCALIBRATED, same status as
  `confidence.ts`'s existing thresholds: product-brief.md §9 open question 2 says the real number
  belongs to a future backtest, not to taste. Chosen to match `CONFIDENCE_MARGINAL_THRESHOLD`
  (also 0.5) — a gap the confidence-band logic itself already treats as "routinely under one
  point apart... well inside the model's own error" is not a gap distinctness should treat as two
  different decisions either. (Tier 3)
- **The outgoing player is not a parameter of `isSameDecision`/`PlanDecisionKey` at all** — not
  merely ignored by convention, but structurally absent from the type, so a future caller cannot
  accidentally wire it back in. (Tier 3)
- **`collapseSameDecisionPlans` is a single greedy left-to-right pass** (keep the first
  not-yet-matched plan in score-descending order, drop everything that matches an already-kept
  plan) rather than a full pairwise clustering pass — because the input is already ranked
  best-score-first (`ranking.ts`'s `rankSolutions`), so the first plan seen for any decision is
  guaranteed to be its highest scorer, and `num_iterations` is capped at 3 (unchanged by this
  ticket), so there are at most 3 plans to compare — a more elaborate transitive-clustering
  algorithm is not needed at this scale. (Tier 3)
- **The confidence-band score gap (Plan A vs Plan B) is now computed from the DISTINCT plan list,
  not the raw solver solutions** — because a collapse can shrink 3 raw solutions to 1 or 2
  distinct plans, and comparing against a "Plan B" that turned out to be the same decision as
  Plan A would be comparing a plan against itself. With one distinct plan, the gap is `Infinity`
  and the band is `clear` — unchanged behaviour from ticket #47, just now measured on the
  post-collapse list. The coverage floor (`applyCoverageFloor`) still applies per plan regardless
  of how many distinct plans exist. (Tier 3)
- **When only one distinct plan survives, `reasons.ts` states "One clear course of action this
  gameweek — no meaningfully different alternative" instead of the confidence-band comparison
  line** ("a clear/marginal edge over the next-best alternative..."), which would otherwise
  describe an alternative that no longer exists after the collapse. Confident phrasing, not a
  hedge — `design-reference.md`'s interface-writing rule, same reasoning ticket #47 already
  applied to "roll your transfer." (Tier 3)
- **Did not widen the solver's player pool** (`xmin_lb`, `keep_top_ev_percent`,
  `ev_per_price_cutoff`) even though a narrower pool is part of why the solver had few genuinely
  different players to choose an alternative from. Out of scope per the ticket's own Notes — a
  separate finding for a future ticket, not acted on here. (Tier 3, observation only)
