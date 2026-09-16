## Problem

Preflight check 6 passed on 12 Sept 2026 with the reason *"every team has a
ClubElo rating; no horizon fixture uses the FDR fallback"* while every single
rating in the table was four months old and stamped stale.

The check tests `elo === null` and nothing else:

```
const nullEloTeamsCount = teamsRead.rows.filter((t) => t.elo === null).length
```

`teams.elo_stale_since` has existed since
`supabase/migrations/20260901090000_teams_elo_stale_since.sql` (ticket #176)
and is written on every nightly ingest run. No check reads it. So the one
signal that would have caught this is present in the database, correct, and
never looked at.

This is check 6 measuring presence when the thing that matters is freshness.
It let a whole-season model defect run unreported for four gameweeks.

## The fix

Extend check 6 to read `elo_stale_since` alongside `elo`, and fail when
ratings are stale.

- Add `staleEloTeamsCount`: the number of `teams` rows with a non-null
  `elo_stale_since` older than `ELO_STALE_HOURS`.
- `ELO_STALE_HOURS = 240` (ten days). A ClubElo rating that has not refreshed
  in ten days has missed at least one full round of fixtures. Judgement call,
  stated as such in the code comment, following the same pattern as the
  existing `staleHoursThreshold = 36` in check 8. Tier 3.
- Verdict logic, keeping the existing conditions intact:
  - FAIL if `nullEloTeamsCount > 0` or `fixturesFallbackCount > 0` (today's
    rule, unchanged).
  - FAIL if `staleEloTeamsCount > 0`, with a reason naming the count, the
    total, and the age of the oldest stale mark in days.
  - PASS otherwise.
- Report `staleEloTeamsCount`, `totalTeamsCount` and `oldestStaleMarkAgeDays`
  in the check's `Values:` line so the report carries the evidence, not just
  the verdict.

Note that the ingest re-stamps `elo_stale_since` on every run rather than
setting it once, so the timestamp reads as "as of the last run, this rating
could still not be confirmed" — which is exactly the quantity this check
wants. Do not change that behaviour.

## Falsification gate

None required. This ticket makes no causal claim about a measured model
number; it makes a check read a column it was always supposed to read.

## Definition of done

- Run `scripts/preflight-check.ts` against the live database. Check 6 must
  come back **FAIL** naming twenty stale clubs. If it comes back PASS, the
  check is still not reading the column — stop and report.
- Paste the failing check-6 block into the PR body.
- Named tests: all fresh passes; one stale fails; a stale mark newer than the
  threshold passes; a null elo still fails as it does today.
- `npm run build`, `npm run lint`, `npm test` clean.

## Out of scope

- Fixing the stale ratings. That is a separate ticket. This one only makes
  the condition visible.
- Every other preflight check.
- The overall PASS/FAIL rollup rule. Check 6 becoming a failure will turn the
  overall preflight verdict red, and that is the intended outcome, not a
  regression to work around. Do not add an exemption.

## Files

- `scripts/preflight-check.ts`
- `scripts/preflight-check.test.ts`
