## Problem

`scripts/team-strength-diagnostic.ts` now fails every single run, for a
reason that is not a defect.

Live run, 18 Sept 2026, gameweek 5:

```
falsification gate FAILED — team-strength-source gate: fail (0 row(s));
market-odds liveness gate: pass (20 row(s));
market-odds-vs-team-strength divergence gate: pass (max |difference| 0.2959);
overround plausibility gate: pass (0 of 20 out of range)
```

Gate 1 requires **at least one fixture to resolve to source
`team-strength`**. I wrote that for #235, when team-strength was the top tier
of the precedence. Ticket #238 then correctly made `market-odds` the top
tier. So gate 1 can now only pass when market odds are ABSENT — it fails
precisely when everything is working.

Every other gate passed. The run is healthy. The job exits non-zero anyway.

This is worse than a cosmetic bug. A gate that is always red is a gate nobody
reads, and this repo has already shipped dead code once because a gate was
trusted without being understood (§21). A permanently-failing check is how
the next real failure gets ignored.

## The fix

Gate 1 was asking the wrong question. What it should assert is that the live
precedence reached a **real** fixture signal, not which tier supplied it.

Replace it with: **at least one fixture resolves to `market-odds` OR
`team-strength`, and NO fixture resolves to `stale-elo` or `fdr`.**

- The first half keeps the liveness property §21 exists to enforce.
- The second half is stronger than what it replaces. `stale-elo` means the
  model fell back to ratings frozen since last season; `fdr` means it fell
  back to FPL's coarse 1–5 bucket. Either one appearing in a gameweek where
  every club has played four matches and the market is pricing all ten
  fixtures is a real failure that no current gate catches.
- Report the per-source counts in the gate's own reason string, so a failure
  says which tier it fell to, not just that it fell.

Renumber and retitle the gate so its text names what it now checks. Update
the report's "Reading this table" note, which still describes
`team-strength` as the tier the precedence picks.

Keep gates 2, 3, 5, 6 and 7 exactly as they are. Gate 4 (Man Utd v Man City)
stays NOT APPLICABLE and stays non-blocking.

## Falsification gate

Runnable offline against a synthetic precedence result — no credentials
needed.

**Stop and report unless all three hold:**

1. A synthetic population where every fixture resolves to `market-odds`
   PASSES. This is the live case that currently fails, and it is the whole
   point of the ticket.
2. A synthetic population containing one `stale-elo` row FAILS, naming
   `stale-elo` and its count in the reason.
3. A synthetic population containing one `fdr` row FAILS the same way.

## Definition of done — offline only

- `npm run build`, `npm run lint`, `npm test` clean.
- The three named tests above, plus one asserting a mixed
  `market-odds`/`team-strength` population passes.
- No change to any gate other than gate 1, asserted by leaving their tests
  untouched.

## Post-merge owner check (does not block this PR)

Keshav re-runs the diagnostic against live data and confirms it exits 0.
**Not a gate. Do not block on it.**

## Out of scope

- `src/lib/projection/expectedPoints.ts` and the precedence itself. The
  precedence is correct; the gate describing it is not.
- Every other script and every other gate.
- `src/lib/projection/bonus.ts` and `scripts/bonus-validation-report.ts` —
  another ticket in this batch owns them.

## Files

- `scripts/team-strength-diagnostic.ts`
- `scripts/team-strength-diagnostic.test.ts`
