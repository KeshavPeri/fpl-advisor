# Ticket #236 — Preflight must catch a source column going blank

## HIGH-IMPACT

None. The ticket itself designates the new check's thresholds as Tier 3
("Ten percent is a judgement call... Tier 3"), and nothing in the
implementation crossed into data-structure or dependency territory.

## ROUTINE

- `MAX_NULL_SHARE = 0.10` and a `WARN_NULL_SHARE_FLOOR = 0.02` taken
  literally from the ticket text, documented in a code comment following the
  same convention as check 8's `staleHoursThreshold`.
- The 10% boundary itself reads as WARN, not FAIL — read from the ticket's
  own wording ("FAIL when any share *exceeds*" vs. "WARN *between* 0.02 and
  0.10"), i.e. WARN is inclusive of both endpoints, FAIL is strictly greater
  than 0.10. Covered by an explicit named boundary test.
- `CURRENT_SEASON = '2026-2027'` duplicated as a literal constant in
  `preflight-check.ts` rather than imported from `scripts/project-points.ts`.
  Follows this file's own established pattern (it already duplicates
  `MODEL_VERSION` and `MIN_FINISHED_FIXTURES_FOR_BASELINE` from
  `project-points.ts` for the same reason) and CLAUDE.md's guidance that a
  small config literal duplicated per standalone script is the reasonable
  call — this is not a scoring or projection rule, so the "second copy of a
  scoring rule is a second thing to get wrong" concern from CLAUDE.md's
  `scripts`/`src` sharing section does not apply here.
- New check added as check 12, appended after check 11 in `CHECK_ORDER` /
  `CHECK_TITLES` / `main()`, rather than merged into check 7 — per the
  ticket's explicit instruction that this is a new check, not an edit to
  check 7, which stays byte-for-byte untouched.
- File-header FAIL/WARN summary comment and `job_runs.details` narrative
  updated to mention check 12, matching the existing convention every prior
  check-adding ticket has followed for traceability. No behavioural change.

## Falsification gate — NOT YET EVALUATED

The new check's unit tests all pass against constructed data, including a
named test reproducing the exact reported real-world condition
(`opponentTeamCodeNullShare = 1.0`, asserting `verdict: 'fail'`). But **the
actual live run against `scripts/preflight-check.ts` has not happened**:
this session has no Supabase credentials, the same environment-wide gap
recorded in `decisions/ticket-229.md` and confirmed independently across all
three tickets in tonight's batch.

Per the ticket's own text — "If it comes back PASS or WARN, the check is not
reading what it claims to read — stop and report" — **this PR must not be
merged until someone with production Supabase credentials runs
`npx tsx scripts/preflight-check.ts` and confirms check 12 reports FAIL with
`opponentTeamCodeNullShare` at or near 1.0**, then pastes the check's block
into the PR. This is flagged in the PR body.
