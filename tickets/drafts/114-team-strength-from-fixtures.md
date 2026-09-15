## Problem

Ticket #229 shipped and has never once fired. Its own diagnostic, run against
live data on 15 Sept 2026 for gameweek 5, proves it:

| Team | Opponent | H/A | Frozen-elo | Point-in-time | Source |
|---|---|---|---|---|---|
| Man City | Sunderland | H | 0.8490 | 0.8490 | stale-elo |
| Chelsea | Brentford | A | 0.3992 | 0.3992 | stale-elo |
| Man Utd | Fulham | A | 0.5530 | 0.5530 | stale-elo |

All twenty rows resolved to `stale-elo`. The point-in-time column is
identical to the frozen-elo column in every row. The `team-strength` tier was
never reached.

### Root cause

`data/2026-2027/teams.csv` publishes **`fotmob_name` blank for all twenty
clubs**, not only `elo`. Verified by fetching the file directly on 15 Sept
2026: 20 of 20 rows blank in both columns, against 0 of 20 blank in
`data/2025-2026/teams.csv`.

`scripts/ingest-core-insights.ts`'s `buildClubCodeBySlug` builds its
club-slug -> `team_code` map from `fotmob_name`. With every value blank the
map is empty, so `resolveOpponentTeamCode` resolves nothing, so
`player_match_stats.opponent_team_code` is **NULL on every current-season
row**. `buildTeamMatchRecords` needs a match's opponent to pair the two
sides' goals-conceded figures, so it emits zero records. Every club therefore
has zero prior matches, `MIN_TEAM_PRIOR_MATCHES` is never met, and
`resolveFixtureExpectedScore` falls straight through to the stale-elo tier.

One blank source file caused two separate model failures. The ingest is
behaving correctly in both cases — it is refusing to guess — but the model
has no fallback for the current season.

### There is no external source to fall back to

Searched on 15 Sept 2026. ClubElo is not down, it is abandoned:

- `clubelo.com/ENG` serves ratings dated **22 October 2024**.
- `api.clubelo.com` returns **502**.
- The best community mirror, `tonyelhabr/club-rankings` (a daily GitHub
  Action scraping both ClubElo and Opta), has its last row at **2026-01-14**
  for both feeds — 581,279 rows pulled and checked directly. Its scraper died
  when the source did.

So precedence tier 1 (fresh elo, `elo_stale_since IS NULL`) will in practice
never fire again. It stays in the code because it costs nothing and self-heals
if ClubElo ever returns, but nothing should be designed around it.

FPL's own `bootstrap-static` team strength is not a substitute either.
Checked live on 15 Sept 2026: `strength` is **null for all twenty clubs**,
all six `strength_attack_*`/`strength_defence_*` values are **0**, and
`strength_overall_home`/`_away` is a coarse 2–5 bucket that gives Chelsea
4/4 and Man Utd 4/4 — identical. It carries no more information than the FDR
fallback already in tier 4.

This ticket's own-results construction is therefore not a stopgap while we
find a better feed. It is the best signal available from data already in the
database, and it should be built as the primary path, not a fallback.

### The gate did not catch it

The diagnostic reported **PASS**. Gate 1 (Man Utd v Man City) was NOT
APPLICABLE, because the script only examines the next gameweek and that
fixture had already been played. Gate 2 compares the point-in-time spread
against the frozen-elo spread — and when the new path never activates, the
two populations are the same numbers, so the stdDevs matched exactly
(0.2150 vs 0.2150) and it passed.

**A gate that compares a new path against the old one passes vacuously
whenever the new path does not run.** That is a gate design defect, not a
data problem, and this ticket fixes it alongside the cause.

## The fix

Stop deriving the current season's opponents from `match_id` slugs. Build the
team-match records from `public.fixtures` instead, which carries real results
from FPL's own API and depends on none of the blank columns:

- `event_id` — the gameweek
- `team_h`, `team_a` — `teams.id`
- `team_h_score`, `team_a_score` — the actual score
- `finished` — whether the result is real

`scripts/project-points.ts` already reads `fixtures` for
`team_h_difficulty`/`team_a_difficulty`. Add the four columns above to that
SAME select. **No additional Supabase round trip.**

### Building the records

New pure function in `src/lib/projection/teamStrength.ts`:
`buildTeamMatchRecordsFromFixtures(rows, teamCodeById)`.

- One `TeamMatchRecord` per side of each fixture: home side gets
  `goalsScored = team_h_score`, `goalsConceded = team_a_score`; away side the
  mirror.
- Emit a record ONLY when `finished` is true AND both scores are non-null. A
  postponed or in-flight fixture contributes nothing — never a guessed 0.
- `fixtures.team_h`/`team_a` are `teams.id`, NOT `teams.code`. Map them
  through `teams.code` before building, because `computeTeamStrengthAsOf`
  keys on code (`deltas.md` D9). `project-points.ts` already reads
  `teams.code` for exactly this purpose, so no new read.
- A side whose `teams.id` does not resolve to a code contributes nothing and
  is counted, by reason, in `job_runs.details` — never guessed.
- `computeTeamStrengthAsOf`, `teamStrengthRate`, `fixtureHasSufficientHistory`,
  `computeFixtureExpectedScore`, `SCALE`, `MIN_TEAM_PRIOR_MATCHES` and
  `HOME_EXPECTED_SCORE_BONUS` are all UNCHANGED. Only the source of the
  records changes.

`buildTeamMatchRecords` (the `player_match_stats` version) stays exactly as
it is — `scripts/run-backtest.ts` and `scripts/build-training-features.ts`
both depend on it for past seasons, where `fixtures` holds no results.
`scripts/project-points.ts`'s `buildCurrentSeasonTeamMatchRecords` is
replaced by the fixtures-based builder.

### Report what happened

`project-points.ts` must print, in its console summary AND in
`job_runs.details`: the number of team-match records built, the number of
clubs meeting `MIN_TEAM_PRIOR_MATCHES`, and the per-source fixture counts
(`elo` / `team-strength` / `stale-elo` / `fdr`). The current run prints none
of this, which is why the failure was invisible until the diagnostic was run
by hand.

### Fix the gate

In `scripts/team-strength-diagnostic.ts`:

1. **New gate, and the primary one:** at least one fixture in the examined
   gameweek must resolve to source `team-strength`. If none does, the fix is
   not running and the job must exit non-zero. This is the condition whose
   absence let #229 pass.
2. **Make gate 2 non-vacuous:** it must also FAIL when the point-in-time and
   frozen-elo columns are identical for every fixture. Identical columns are
   proof the new path did nothing, not evidence that it preserved spread.
3. Gate 1 (Man Utd v Man City) stays as-is, NOT APPLICABLE when the fixture
   is not in the population. It was always a bonus check, never the main one.
4. The report must also print the full point-in-time strength table — every
   club, its matches, goals scored, goals conceded and
   `teamStrengthRate` — sorted by rate. Without it there is no way to see
   whether the ratings are sensible, only whether they changed.

## Falsification gate

The premise is a causal claim: that blank `fotmob_name` is why the fix never
fired, and that sourcing from `fixtures` makes it fire.

Run `scripts/team-strength-diagnostic.ts` against live data. **Stop and
report — do not merge — unless all three hold:**

1. At least one fixture resolves to source `team-strength`.
2. At least one fixture's point-in-time `expectedScore` differs from its
   frozen-elo `expectedScore` by more than 0.01.
3. Every club in the strength table has at least 3 matches (by gameweek 5
   every club has played 4; fewer means the fixtures read is still dropping
   results).

**Stated prediction, on the record so it can be checked against the strength
table in the report:** Chelsea will rank above Man Utd on
`teamStrengthRate`. The frozen elo has Chelsea at 1831 and Man Utd at 1915,
and reversing that ordering is the specific thing this whole line of work
claims to fix. If the table does not reverse it, say so plainly in the PR —
it does not block the merge, but it means the diagnosis was incomplete and I
need to know.

Paste the full report into the PR body.

## Definition of done

- `npm run build`, `npm run lint`, `npm test` clean.
- Named tests: a finished fixture produces two mirrored records; an
  unfinished fixture produces none; a null score produces none; an
  unresolvable `teams.id` produces none and is counted; last season's
  fixtures cannot leak in.
- Named test that the diagnostic exits non-zero when no fixture resolves to
  `team-strength`.
- `scripts/run-backtest.ts` and `scripts/build-training-features.ts` are
  untouched and their suites pass unchanged.

## Out of scope

- `scripts/ingest-core-insights.ts`. Refusing to guess a club from a blank
  `fotmob_name` is correct and stays. Backfilling `opponent_team_code` from
  another season's name map is a separate question.
- `scripts/preflight-check.ts`. A check that would have caught the blank
  column four gameweeks ago is a separate ticket in this same batch — do not
  touch the file.
- `src/lib/projection/bonus.ts` and any multiplier constant.

## Files

- `src/lib/projection/teamStrength.ts`
- `src/lib/projection/teamStrength.test.ts`
- `scripts/project-points.ts`
- `scripts/project-points.test.ts`
- `scripts/team-strength-diagnostic.ts`
- `scripts/team-strength-diagnostic.test.ts`
