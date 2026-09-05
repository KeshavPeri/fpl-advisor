# Ticket #207 — Revert the minutes model to its pre-#191 state

## HIGH-IMPACT

None. The core action — reverting `src/lib/projection/minutes.ts` — was the ticket's
pre-registered decision, made in #191's own definition of done ("if any position moves away
from 1.00, revert rather than tune"), not a new judgement call made during this build.

## ROUTINE

- Updated `src/lib/projection/expectedPoints.test.ts`'s hardcoded expectation for the
  `[90,90,90,10,10]` window: it encoded #191's shipped pSixtyPlus/defensive-contribution
  numbers. After the revert the correct values are pSixtyPlus 0.6 and
  defensiveContributionPoints 0.6. A mechanical consequence of the revert, not a new modelling
  choice — mirrors the same fast-follow #191 itself needed when it shipped (`e652df7`'s second
  commit).
- Updated the `buildRecentMinutes`-related assertions in `scripts/run-backtest.test.ts`.
  Investigation found #201 had already patched these to expect #191's shipped 50min/0.5
  pSixtyPlus figures on the `[90,90,20,0,0]` window (rather than leaving them red), and had
  added an assertion that the shipped model *diverges* from the harness's own independent
  pre-#191 reconstruction. After this revert the shipped model and that reconstruction are
  identical, so the tests now assert that equivalence and expect the reverted 40min/0.4
  figures. Only the test file changed — `scripts/run-backtest.ts` itself is untouched, keeping
  the scope boundary with the concurrently-edited #209 branch intact.
- Deleted the tests that existed solely to pin #191's `dropSingleLowest` and
  start-vs-minutes-given-start split behaviour, per the ticket's explicit instruction to
  restore the corresponding tests and delete the #191-only ones.
