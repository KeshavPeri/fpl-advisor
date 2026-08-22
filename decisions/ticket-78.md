# Ticket 78 — Project bonus points and share them across each fixture

## HIGH-IMPACT

None on this ticket beyond what the ticket itself already decided. The allocation method —
share the six bonus points in proportion to expected BPS above a bare-appearance baseline,
rejecting both rank allocation and flat proportional-to-total-BPS — is a Tier 2 decision, but it
was made and justified with a "because" in the ticket text itself, not invented during the
build. QA checked the Builder's four implementation choices below against escalation.md's test
question and found all of them genuinely Tier 3.

## ROUTINE

- **Clamp uses strict `>` against 3.0, not `>=`** — a player whose raw share lands exactly at
  3.0 is not flagged `clamped`. Because 3.0 is the real achievable maximum, and a tied
  two-player fixture where both players' excess is identical (a real case, not just
  theoretical — exercised directly in `bonus.test.ts`) must still sum to exactly 6.00; a `>=`
  clamp would force an unallocated residual on an untied fixture and break that invariant.
- **CBI and recoveries are not fixture-adjusted** in `expectedBps` — no attacking-difficulty
  multiplier is applied to `expectedCbi`/`expectedRecoveries`, mirroring the existing choice in
  `defconRate.ts` not to fixture-adjust its own hit-rate estimate, and matching the ticket's
  stated formula exactly (no multiplier on those terms).
- **`allocateFixtureBonus` entries use array index as `id`**, zipped back to the staged player
  list by array position — order-preserving, matching `allocateBonusPoints`'s existing `.map()`
  convention, and cheaper than threading a real player ID through a type the caller doesn't
  otherwise need.
- **`project-points.ts`'s two-pass rewrite uses flat staged arrays** (`stagedFixtures`,
  `playerGwKeys`) rather than the previous inline-aggregate-per-gameweek loop, kept as close as
  possible to the original code's variable names and shape elsewhere to minimise the diff — this
  is new internal job structure, not a persisted schema change.
