## Problem

`data/2026-2027/teams.csv` has published `fotmob_name` blank for all twenty
clubs since the season began. The direct consequence is that
`player_match_stats.opponent_team_code` is **NULL on every current-season
row**, because `scripts/ingest-core-insights.ts` builds its club-slug map
from that column and correctly refuses to guess when it is empty.

Nothing noticed. Preflight ran every night and reported PASS. It took a
hand-run diagnostic on 15 Sept 2026, four gameweeks into the season, to find
it — and only then because a separate fix had visibly failed to do anything.

Check 7 already reads `player_match_stats`:

> every `player_match_stats` row carries a competition; no player exceeds 38
> Premier League matches in a season.

It counts null `competition` and nothing else. The columns that a blank
source file silently empties — `opponent_team_code`, `team_code` — are never
counted.

This is the second whole-season model defect in two weeks caused by a blank
column in the same source file, and the second one preflight could have
caught on night one.

## The fix

Add a new check: **Current-season match data completeness.**

Over `player_match_stats` rows where `season = CURRENT_SEASON` and
`competition = 'prem'`, report and gate on:

- `opponentTeamCodeNullShare` — the share of rows with a null
  `opponent_team_code`.
- `teamCodeNullShare` — the share with a null `team_code`.
- `elementTypeNullShare` — the share with a null `element_type`.

FAIL when any share exceeds `MAX_NULL_SHARE = 0.10`. WARN between 0.02 and
0.10. PASS below.

Ten percent is a judgement call, stated as such in the code comment,
following the same pattern as check 8's `staleHoursThreshold`. A handful of
unresolvable rows is normal (an odd fixture slug, a mid-season signing);
a tenth of the season's rows is a broken pipeline. Tier 3.

The check must also report `currentSeasonRowCount`. Zero current-season rows
is itself a FAIL — it means the ingest is not writing this season at all, and
a share computed over an empty set must never read as 100% healthy.

Report every figure in the check's `Values:` line, so the report carries the
evidence rather than only the verdict.

## Falsification gate

Run `scripts/preflight-check.ts` against live data. The new check must come
back **FAIL** with `opponentTeamCodeNullShare` at or near 1.0. If it comes
back PASS or WARN, the check is not reading what it claims to read — stop and
report.

Paste the new check's block into the PR body.

## Definition of done

- `npm run build`, `npm run lint`, `npm test` clean.
- Named tests: all populated passes; all null fails; a share just under the
  threshold warns; zero current-season rows fails with its own distinct
  reason, never a divide-by-zero or a false PASS.
- Check 7 is left exactly as it is. This is a new check, not an edit to that
  one — its competition and 38-match assertions have caught real defects and
  must keep their own separate verdict.

## Out of scope

- Fixing the null columns. Ticket #114 in this same batch routes around them
  for the projection; backfilling them properly is a later question. This
  ticket only makes the condition visible.
- `scripts/ingest-core-insights.ts`.
- Every other existing check.
- The overall PASS/FAIL rollup. Preflight is already failing on check 6
  (stale ratings) and this adds a second failure. Both are correct. Do not
  add an exemption for either.

## Files

- `scripts/preflight-check.ts`
- `scripts/preflight-check.test.ts`
