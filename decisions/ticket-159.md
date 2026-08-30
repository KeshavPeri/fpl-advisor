# Ticket #159 — Add naive ranking baselines and cap top-N at the population

## HIGH-IMPACT

- **Season Spearman (0.305) now reports against three naive baselines — prior minutes/match,
  prior xG+xA/match, and a constant zero-skill floor — instead of standing alone, because
  #147's original 0.3–0.6 "good" band was invented from general intuition about regression
  models, not derived from anything about weekly FPL scoring.** A model that beats a naive
  benchmark has skill; one that doesn't is decoration. The verdict line reports the model's
  Spearman minus each baseline's as a plain difference, never against an asserted threshold —
  deliberately, so this ticket doesn't repeat #147's mistake of turning a guess into a fact by
  writing it into a definition of done. This is Tier 2: it changes an instrument whose readings
  are used to reason about the model, and reports from before this ticket are not directly
  comparable to reports after it.
- **`TOP_N_MAX_POPULATION_FRACTION = 0.75` — a new judgement threshold that refuses a top-N
  figure when N is too large a fraction of its own population, instead of printing it.**
  **Because** goalkeeper top-20 overlap read 696/698 (99.7%) over a per-gameweek population of
  ~19 — arithmetic near-100%, not signal, and the existing leak-detection bound didn't catch it
  because it only checked top-10. 0.75 was chosen so a top-10-of-19 request (≈53%) still
  reports while a top-20-of-19 request (100%, the exact case that produced the misleading
  figure) is refused. Deliberately kept a distinct constant from the pre-existing
  `TOP10_OVERLAP_UPPER_BOUND_FRACTION` (0.9, the leak-detection bound) so the two different
  questions — "is N too close to the whole population" vs. "is the overlap suspiciously good"
  — are never conflated by a reader. QA confirmed this reads as Tier 2 under escalation.md's
  test (how data is structured / reported), and is logging it as such here.
- **The leak sanity bound (previously top-10 only, at season aggregate and per position) now
  also covers top-20 at both levels**, using the same `TOP10_OVERLAP_UPPER_BOUND_FRACTION` —
  no new bound value, just applied where the report actually prints. **Because** the guard was
  written to catch exactly the 99.7% shape and did not look where that shape appeared.

## ROUTINE

- The Defender/Midfielder identical top-N overlap figures (75/370, 226/740) remain unverified
  as coincidence or defect. Per the ticket's explicit instruction, this is **not** asserted as
  a bug anywhere in code, tests, or this log — the new per-gameweek × per-position breakdown
  now makes it distinguishable on the next run without anyone re-deriving it by hand.
- The constant baseline is implemented by feeding a literal constant value through the existing,
  already-tested `spearmanCorrelation` function (which correctly returns `null` for zero
  variance), wrapped to assert that `null` and report it as `0` — rather than an arbitrary or
  index-based pseudo-random ranking. Chosen because it reuses a proven code path and is exactly
  reproducible and hand-verifiable rather than probabilistic.
- `prior_matches = 0` rows are asserted to already be excluded before ranking (throws if
  violated), rather than defensively guarded with a fallback — so a future change that admits
  such a row fails loudly instead of silently producing a division artifact.
- Every baseline reads only `feature_history`'s strictly-before columns (`prior_minutes`,
  `prior_matches`, `prior_xg`, `prior_xa`) — never `now_cost`, which is a 2026/27 price applied
  to 2025/26 gameweeks and would be both a cross-season mismatch and a lookahead. This was a
  scope decision already made by the ticket text, not invented here, but is worth restating
  since it's easy to reach for price as an obvious baseline.
