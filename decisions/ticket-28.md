# Decisions — ticket #28

## HIGH-IMPACT

None. The estimator formula (shrunk empirical rate, k = 5), the 60-minute qualifying rule, and
the ban on hardcoded probabilities were all pre-answered in the ticket text (Tier 3, decided
there). No Tier 1 or Tier 2 decision was required to implement this ticket.

## ROUTINE

- **"Delegate to cbitCount/cbirtCount" is satisfied via `defensiveContributionPoints`, not by
  calling `cbitCount`/`cbirtCount` directly**, because those two functions return raw counts —
  telling "hit" from "miss" still requires the threshold value (10 or 12), and the DoD
  explicitly forbids this module from holding that number or comparing a count against it.
  `defensiveContributionPoints` (from `src/lib/scoring/`) already wraps exactly that comparison
  and returns 0 or the +2 cap, so `reachedThreshold` is defined as
  `defensiveContributionPoints(position, match) > 0`. This is the only way to satisfy both the
  scope bullet ("do not reimplement the thresholds") and the DoD's literal-search check ("no
  file... compares a count against a literal 10 or 12") at the same time. (Tier 3)
- **Neutral prior for an empty match set is 0.5** — maximum uncertainty, not 0. With zero
  observed evidence, claiming a position "never" reaches the threshold would be a fabricated
  data point, which is exactly what the ticket's "no probability may be hardcoded" rule is
  guarding against. 0.5 is the only value that encodes "no information" rather than an
  assertion either way. (Tier 3)
- **`positionPriorHitRate` applies the same 60-minute qualifying filter as the per-player
  estimator**, so a prior computed from a mixed set of full appearances and cameos isn't skewed
  by minutes that can't reach a per-match threshold. The ticket's qualifying rule is stated
  generically ("a player's rate") and the prior is the same kind of rate computed over a
  different population, so the same filter applies for consistency. (Tier 3)
- **Goalkeepers short-circuit to 0 in both `estimateDefconHitRate` and `positionPriorHitRate`**,
  rather than relying on `defensiveContributionPoints` returning 0 for every goalkeeper stat
  line. Belt-and-braces: makes the "defensive contribution does not apply to goalkeepers" rule
  explicit in this file's control flow instead of only being an emergent property of the scoring
  module's behavior. (Tier 3)
- **New type `DefensiveContributionMatch`** (`DefensiveActionStats` + `minutesPlayed`) added in
  `src/lib/projection/types.ts` rather than extending anything in `src/lib/scoring/` — scoring's
  `DefensiveActionStats` has no minutes field because minutes aren't relevant to scoring a match
  that already happened; they matter only for deciding whether a match qualifies for the rate
  estimate. Kept the two modules' types decoupled per the ticket's "do not edit
  `src/lib/scoring/`" constraint. (Tier 3)
- Naming: `defconRate.ts` (as named in ticket scope), functions `estimateDefconHitRate`,
  `positionPriorHitRate`, `expectedDefensiveContributionPoints`, `isQualifyingMatch` — chosen to
  read as full sentences at call sites, matching the style of `src/lib/scoring/`. (Tier 3)
