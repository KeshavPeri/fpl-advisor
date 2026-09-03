## Context

Backtest report 9 (3 Sep 2026) still fails its oracle-ceiling check at the five-gameweek
horizon: the model scores Spearman **0.619** against a genuine hindsight oracle's **0.506**.
The lookahead fix committed the same day (`5a99d6e`, backlog G13) removed three point-in-time
lookups that were keyed on each leg's own gameweek. That fix was correct and is not in
question — the number moved 0.728 → 0.619 — but it was incomplete. A second, larger leak
remains in the same construction, and until it is closed no five-gameweek figure this project
produces means anything. Everything on the model roadmap (`docs/model-review-2026-09-02.md`
R2 onward, feature-list item 32) is gated on this.

## The defect, precisely

`scripts/run-backtest.ts`, `projectAndReconstructWindowGameweek`. For each leg of a
five-gameweek window the function does:

```
const actualInputs = actualRows.map(toActualMatchStatsInput)
const outcome = aggregateActualForGameweek(position, actualInputs)
...
const opponentTeamCodes = actualRows.map((r) => r.opponent_team_code)
...
const projection = projectRow(row, position, prior, outcome.matchesFound, fixtureExpectedScores)
```

`outcome.matchesFound` is `rows.length` — the number of that **player's own actual match rows**
for that gameweek — and it is passed into `projectRow` as the leg's `fixtureCount`. The leg's
opponents come from those same actual rows.

So when a player did not feature in a leg, `actualRows` is `[]`, `matchesFound` is `0`,
`projectRow` builds an empty fixture array, and the leg projects **exactly 0** against an
actual of **exactly 0**. The harness is telling the model, in advance, which of the five weeks
the player would miss.

A five-gameweek points total is dominated by how many of those five weeks a player turns up
for, and `docs/model-review-2026-09-02.md` §1f measures minutes as carrying roughly 85% of the
model's whole ranking signal. This is not a rounding error: in report 9's own single-gameweek
population, 6,913 of 12,567 rows with a matching actual entry were non-appearances.

**This does not affect the one-gameweek section.** There, `didNotFeature` rows are excluded
before anything is projected, so `matchesFound` is always at least 1 and the #140 multi-fixture
approximation stands as designed. Nothing above the five-gameweek heading in the report may
change.

## The fix

The number of fixtures a club plays in a gameweek, and who it plays, are **published before
the horizon starts** — they are legitimately known at G. What is not known at G is whether
this particular player will be in the team. So the leg's fixtures must come from the club's
schedule, never from the player's own appearance.

The schedule is already derivable from data this job reads. `buildTeamMatchRecords` currently
accumulates `{ matchId, gameweek, teamCode, opponentTeamCode }` per (match, team) and then
**discards** every match whose goals could not be resolved on both sides. A fixture schedule
needs no goals at all — a match that happened is a match that was scheduled.

## Scope

**In scope:**

- A new pure exported function building a club fixture schedule from the same
  `matchStatsRows` already fetched for actuals — no new Supabase read, no new column, no
  migration. Keyed by `(team_code, gameweek)`, returning that club's opponent team codes for
  that gameweek, one entry per distinct `match_id` (so a double gameweek returns two).
  Deliberately **not** filtered on goals resolvability, unlike `buildTeamMatchRecords`.
- `projectAndReconstructWindowGameweek` takes the schedule and derives each leg's fixture
  count and opponent list from it, at `(row.team_code, legGameweekId)`.
- `actualRows` continue to supply the leg's **actual** points and nothing else.
- A new exclusion reason for a window whose start row has a null `team_code`, so the club
  schedule cannot be resolved at all — counted by name, reconciling like every other reason.
- A leg whose club has no schedule entry for that gameweek projects zero fixtures and zero
  points. That is the club's blank gameweek, and it is a legitimate zero on both sides.
  Counted and reported separately from the exclusion above.
- Three new counters in the five-gameweek report section:
  - legs whose fixture count came from the club schedule,
  - legs where the club had no fixture (a blank gameweek),
  - **legs where the player did not feature but his club did have a fixture** — this is the
    exact size of the leak being closed. See the falsification check below.
- A dated addendum to `docs/projection-model-backlog.md` G13 recording that the 3 Sep fix
  closed three lookups and that this was the fourth, larger one, in the same function.

**Explicitly out of scope:**

- **Everything above the five-gameweek heading in the report.** The one-gameweek headline,
  by-position, by-gameweek, by-component, defcon-bucket, fixture-coverage, minutes-evidence
  and naive-baseline sections must be byte-identical in behaviour. Do not touch `classifyRow`,
  `aggregateActualForGameweek`, `projectRow`, or the #140 multi-fixture path.
- `computeOracleFeaturedRate`, `computeOracleAppearanceRate`,
  `computeOracleFiveGameweekEstimate` and `checkOracleCeiling` — untouched. **The ceiling bound
  must not be relaxed, widened, downgraded to a warning, or removed.** It is the instrument
  that caught both leaks.
- **The one-gameweek oracle-ceiling failure is not fixed by this ticket and must not be.**
  See "what will not change" below.
- Anything under `src/`. No live projection, no recommendation, no app surface changes.
- No migration, no schema change, no new Supabase read, no workflow file change.

## Definition of done

- [ ] The new schedule builder is pure, exported, and has named tests covering: a single
      fixture; a double gameweek (two `match_id`s, one gameweek, one club) returning two
      opponents; a match whose `team_goals_conceded` is null on both sides still appearing in
      the schedule (this is the behaviour that differs from `buildTeamMatchRecords`); and a
      club with no rows in a gameweek returning nothing.
- [ ] `projectAndReconstructWindowGameweek` no longer reads `matchesFound` for its fixture
      count. Grep-checkable: `matchesFound` appears nowhere in the arguments to `projectRow`
      inside that function.
- [ ] **The pinned defect test:** a leg the player did not feature in, whose club did play,
      projects a non-zero figure. Reverting the fix must make this named test fail.
- [ ] A named test proving the leg's opponent comes from the schedule and not the player's own
      rows — constructed so the player has no rows at all for that leg.
- [ ] The one-gameweek section is unchanged: MAE 1.831, mean signed error 0.055, season
      Spearman 0.345 and every by-position and by-gameweek figure in report 9 reproduce
      exactly on the same data.
- [ ] Reconciliation still holds: five-gameweek measured + excluded, by reason, equals the
      single-gameweek measured candidate count.
- [ ] The report prints the three new counters named in Scope.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` all exit 0.
- [ ] Scope constraint: only `scripts/run-backtest.ts`, `scripts/run-backtest.test.ts`,
      `docs/projection-model-backlog.md` and this ticket's own
      `decisions/ticket-<issue>.md` change. No other file, in either direction.

## Falsification check — STOP AND REPORT, do not merge past this

This ticket's premise is a causal claim about a measured number, so it carries a figure that
must move if the claim is true (`LEARNINGS-second-build-wave.md` §17).

- **The counter "legs where the player did not feature but his club had a fixture" must be a
  large share of all window legs.** If it is near zero, the diagnosis is wrong: stop, do not
  merge, report the number.
- **The five-gameweek model Spearman must fall materially below report 9's 0.619, and must sit
  below the five-gameweek oracle.** If it does not, stop, do not merge, and report the number
  with the counters. Do not adjust the oracle, the bound, or any constant to make it pass.

This is a build-time stop, not only the existing runtime bound. Ticket 89's identical check
shipped as a runtime assertion, which let a wrong fix merge cleanly and simply turned the
nightly job red (§17). Report it in the PR body.

## What will NOT change, and must be said in the PR

Per `LEARNINGS-second-build-wave.md` §15, a ticket that fixes a cause without fixing every
visible symptom must name the symptom that survives it.

- **The Backtest job will still exit 1 after this merges.** The one-gameweek oracle-ceiling
  check (oracle 0.336 below model 0.345) is a separate problem with a separate cause — a
  quality oracle that knows nothing about minutes, fixtures or clean sheets is not a ceiling at
  one gameweek — and it gets its own ticket. Do not read the red run as this ticket failing.
- No live projection, recommendation, Telegram message or app surface moves. MAE and the
  signed error do not move.
- Report 9 and report 10's five-gameweek sections are not comparable to each other, for the
  same reason #154 and #175 were not. Say so in the report.

## Notes for the Analyst / Builder

- The published schedule is being reconstructed from matches that were actually played, so a
  fixture postponed after the horizon began looks, here, like a club that never had a fixture.
  That is a stated approximation, not a defect — this job has no independent fixture-schedule
  table for a past season (backlog G10 records the same limitation). State it in the report's
  own section text.
- `TeamMatchAccumulator` already carries `matchId`, `gameweek`, `teamCode` and
  `opponentTeamCode`. Reuse that shape rather than re-parsing `match_id`.
- Do not "fix" a leg with no schedule entry by falling back to one neutral fixture. That
  invents a match, and it reintroduces exactly the class of silent default this ticket exists
  to remove. Zero fixtures, counted, is the honest answer.
- `docs/projection-model-backlog.md` is in the scope list on purpose — G13's addendum is
  required, and D10 records what happens when an instructed documentation edit is left out of
  the scope constraint.
