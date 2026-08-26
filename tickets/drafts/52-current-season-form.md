## Context

**Every projection in the app is still built entirely on 2025/26 form. This season's matches have
been played and nothing reads them.**

`scripts/ingest-core-insights.ts` ingests the **2025-2026** season (`DEFAULT_SEASON`), which was
correct when it was written — 2026/27 had no played matches, and `deltas.md` D9 says so explicitly.
**That is no longer true.** Gameweeks 1 and 2 have been played and the source publishes them.

### What this looks like to a user, observed 26 August 2026

The reasoning screen for the gameweek 2 recommendation, in the app's own words:

> **Thiaw** — built on real Premier League match history.
> **Muharemović** — no Premier League history yet; this rests on a position-based estimate, not a
> season of form.

| Component | Thiaw | Muharemović |
|---|---|---|
| Appearance | **2.00** | **1.25** |
| Goal | 0.81 | 0.19 |
| Clean sheet | 0.92 | 0.26 |
| Defensive contribution | 0.72 | 0.14 |

**The coverage labelling is working exactly as `product-brief.md` §8 requires** — the app said
plainly which projection rests on nothing. The problem is what sits behind it: Muharemović played in
gameweek 1 and did well, and **the model cannot see a single minute of it.** Note the appearance
figures — the model is not merely unsure how good he is, it is not confident he plays at all,
because it has no minutes for him either.

This is G2 and G6 in `docs/projection-model-backlog.md`, and it gets worse rather than better while
the ingest stays pointed at last season: real 2026/27 evidence accumulates every week and none of it
reaches the model.

### The weighting rule, and why it is not a fixed percentage

The obvious fix — "weight this season 70%, last season 30%" — looks sensible and is wrong. **After
two gameweeks, this season is mostly noise; by December it is the only thing that matters.** Any
fixed split is badly calibrated at one end of the season or the other, and there is no single number
that is right at both.

**The weight must grow with the number of matches played, and `src/lib/projection/rates.ts` already
implements exactly that shape.** Its shrinkage formula blends a player's observed rate toward a
prior by `k` "phantom nineties": `(total + k × prior) / (nineties + k)`. With no minutes it returns
the prior exactly; with a season of minutes it converges on the player's own rate. Nobody picks a
percentage — the sample size decides.

**Today the observed side is last season and the prior is a position average. This ticket makes the
observed side *this* season and the prior *last* season's rate for that same player.** Two
gameweeks then barely move a projection off last season's form; fifteen gameweeks make this season
dominant; a player with no history at either level still falls back to the position prior, exactly
as now. **The behaviour Keshav asked for falls out of the existing maths — no new parameter, no
tuning, no percentage to argue about.**

Depends on nothing unmerged.

## Scope

**In scope:**

- **Ingest the current season alongside the historical one.** `scripts/ingest-core-insights.ts`
  already takes the season from `CORE_INSIGHTS_SEASON` (defaulting to `2025-2026`), and
  `player_match_stats` already carries a `season` column on every row. **Add a second ingest step to
  `.github/workflows/scheduled-jobs.yml`** that runs the same job with
  `CORE_INSIGHTS_SEASON: 2026-2027`. **No change to the ingest script's logic** — a season directory
  that is not yet published is already a normal, non-failing state.
- **`scripts/project-points.ts` splits a player's match rows by season** into a current-season set
  and a historical set, and passes both into the rate estimators.
- **Two-stage shrinkage in `src/lib/projection/rates.ts`:**
  1. the player's **historical** rate, shrunk toward the position prior — call this his personal
     prior;
  2. the player's **current-season** rate, shrunk toward that personal prior.
  Both stages use the existing `SHRINKAGE_K` and the existing formula. A player with no rows at
  either level returns the position prior exactly, by construction, as today.
- **The same two-stage treatment in `src/lib/projection/defconRate.ts`**, using its own existing
  `k = 5`.
- **Recent minutes prefer the current season.** `project-points.ts` builds `recentMinutes` from the
  last five matches; that sort must place current-season matches ahead of historical ones, so a
  player who has started twice this season is not judged on last season's bench appearances. **This
  is a sort change in `project-points.ts`, not a change to `minutes.ts`.**
- **Counters in `job_runs.details`** for `project-points`: players with current-season rows, players
  with historical rows only, players with neither, and the total current-season rows read. These
  three must sum to the player count.
- **`docs/projection-model-backlog.md` updated** — G6 marked as addressed, G2 narrowed to the
  population it still applies to (players with no rows in *either* season), with the two-stage rule
  stated.

**Explicitly out of scope:**

- **No change to `scripts/ingest-core-insights.ts` itself.** The season is already a parameter. If a
  change turns out to be genuinely required, flag it loudly rather than widening scope silently.
- **No switching the historical ingest off.** Both seasons are ingested; last season is the prior
  and remains load-bearing all year.
- **No fixed percentage weighting anywhere.** If a Builder finds itself writing a literal like
  `0.7`, the ticket has been misread — see Notes.
- **No change to `SHRINKAGE_K` (3) or the defcon `k` (5).** Retuning them is a separate question
  that wants the backtest, not an argument.
- **No change to `src/lib/projection/minutes.ts`, `expectedPoints.ts`, `fixture.ts`,
  `pointValues.ts` or anything under `src/lib/scoring/`.**
- **No migration, no UI, nothing under `supabase/` or `src/screens/`.** `player_match_stats.season`
  already exists.
- **No change to the coverage labelling.** It is correct and it is what surfaced this problem.

## Definition of done

- [ ] `.github/workflows/scheduled-jobs.yml` runs the core-insights ingest twice, with
      `CORE_INSIGHTS_SEASON` set to `2025-2026` and `2026-2027`. Grep-checkable: the string
      `2026-2027` appears in that file.
- [ ] **A player with zero current-season minutes projects identically to today.** A unit test
      asserts the two-stage rate equals the current single-stage rate for that case, to the last
      decimal. *(This is the ticket's most important test: the change must be a no-op for the
      population it has no new information about.)*
- [ ] **A player with a full season of current-season minutes converges on his current-season
      rate**, with the historical rate contributing negligibly. Named test.
- [ ] **A player with two current-season matches sits close to his historical rate, not his
      current-season rate.** Named test asserting the blended value is nearer the historical end —
      this is the behaviour the ticket exists to produce and it must be asserted, not assumed.
- [ ] A player with no rows in either season returns the position prior exactly. Named test.
- [ ] The same four cases are covered for the defensive-contribution rate in `defconRate.ts`.
- [ ] **No fixed weighting literal exists.** Grep-checkable: no numeric literal other than the
      existing `SHRINKAGE_K` and defcon `k` constants participates in the blend, and the strings
      `0.7`, `0.3` and `weight` do not appear in `rates.ts` or `defconRate.ts`.
- [ ] `recentMinutes` is drawn from current-season matches first, falling back to historical ones
      only to fill the five. Named test with a player having 2 current-season and 5 historical
      matches, asserting the 2 current ones lead.
- [ ] `job_runs.details` carries the four counters named in Scope, and the three player counts sum
      exactly to the total player count. Asserted arithmetically in a test.
- [ ] Both `rates.ts` and `defconRate.ts` stay pure: the strings `supabase`, `fetch` and
      `process.env` appear in neither.
- [ ] `docs/projection-model-backlog.md` G6 and G2 are updated as described in Scope.
- [ ] No migration file is added and nothing under `supabase/`, `src/screens/` or `src/components/`
      changes. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** every test runs on constructed match rows. Nothing here
      proves the 2026-2027 season directory is published in the shape this code expects, or that its
      column names match last season's. The human check after merge is running `Scheduled jobs` and
      reading the counters: **current-season rows read should be non-zero and should be roughly
      2 gameweeks × ~380 player-matches**, and the three player counts must reconcile exactly. A
      current-season row count of zero means the season directory is not published yet, which is a
      normal state, not a failure — but it means nothing changed.

## Notes for the Analyst / Builder

**The rule, stated as its *because*, so nobody reaches for a percentage.** A fixed weighting is
wrong **because** the right weight depends on how much has been played: two matches of evidence
should barely move a projection, and twenty-five should dominate it. The shrinkage formula already
encodes that — it *is* a weighting, one whose weight rises with sample size — so the fix is to point
it at the right two inputs, not to add a knob on top. If a Builder hits a case this reasoning does
not obviously cover, reason from that sentence rather than inventing a constant.

**Two-stage shrinkage in one line, for the decisions log:** *this season, shrunk toward (last
season, shrunk toward the position average).*

**Ids are not stable across seasons — `code` is.** 453 of 458 players changed FPL element id between
2025/26 and 2026/27, and team ids moved too. `player_match_stats` carries `player_code` for exactly
this reason (`deltas.md` D9, tickets #22 and #32). **Join both seasons on `player_code`, never on
`player_id`**, or last season's rows will attach to the wrong players and the failure will be
silent.

**Filter on `competition = 'prem'` in both seasons.** About 18% of `player_match_stats` rows are
cup and European matches, they score no FPL points, and their xG per 90 is 34% higher than league
matches — a bias landing only on clubs playing in Europe. `project-points.ts` already does this;
the new current-season read must too.

**Every Supabase read must paginate and assert its count.** Adding a second season roughly doubles
the rows read from `player_match_stats` over the season, and Supabase silently caps a query at 1,000
with no error and no flag. Use `scripts/lib/paginate.ts`, as the existing read already does.

**Do not switch the ingest to the current season.** Both are needed: last season *is* the prior, and
deleting it would return the model to a position average for every player. The season identifier
being a parameter is what makes both true at once.

**The residual limitation, to record rather than solve.** Last season's rates were produced under
2025/26 behaviour, and the 2026/27 BPS and defensive-contribution changes will move how players
play. Last season is a good prior for this season's behaviour, not a measurement of it — G6 says so
and it resolves itself as this season accumulates, which is precisely what this ticket sets up.

**This is Tier 2** — it changes the projection model every recommendation rests on. Log it as
HIGH-IMPACT with its *because*.

**Two other tickets may be running in this batch.** One adds a new dispatch-only workflow file and
touches `scripts/build-solver-input.ts`; the other owns `scripts/preflight-check.ts`. This ticket
touches neither — in particular, **do not modify `scripts/build-solver-input.ts` or
`scripts/preflight-check.ts`**, and edit only the one workflow file named in the scope constraint.

## Scope constraint

Nothing outside the following files changes:

- `.github/workflows/scheduled-jobs.yml` (adding the second ingest step only)
- `scripts/project-points.ts`, `scripts/project-points.test.ts`
- `src/lib/projection/rates.ts`, `src/lib/projection/rates.test.ts`
- `src/lib/projection/defconRate.ts`, `src/lib/projection/defconRate.test.ts`
- `docs/projection-model-backlog.md`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/` changes. No other workflow file is touched.
`scripts/ingest-core-insights.ts`, `scripts/build-solver-input.ts`, `scripts/preflight-check.ts`,
`src/lib/projection/minutes.ts`, `src/lib/projection/expectedPoints.ts`,
`src/lib/projection/fixture.ts` and everything under `src/lib/scoring/`, `src/screens/` and
`src/components/` are not modified.
