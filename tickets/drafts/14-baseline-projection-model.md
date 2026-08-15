## Context

Feature-list item 10. Depends on #11 (`players`, `teams`, `fixtures`, `gameweeks` in Supabase),
#12 (`player_match_stats`), #22 (`player_match_stats.player_code`), #15 (the scoring module) and
#28 (the defcon hit-rate estimator) — all merged.

`product-brief.md` §6d specifies the v1 projection model: **five inputs, each explainable in one
sentence** — minutes probability, xG and xA rates, ClubElo fixture difficulty, clean-sheet
probability, and defensive-contribution hit rate. #28 supplies the last one. This ticket builds the
other four, combines all five into expected points per player per gameweek, and stores the result.

**This is the first ticket that reads Supabase *and* uses the pure modules.** That makes the
boundary the most important thing in it: `src/lib/projection/` stays pure — no I/O, no `fetch`, no
Supabase — exactly as #15 and #28 left it, and the mapping from database rows onto the pure modules'
input types lives in `scripts/`, not in `src/lib/projection/`.

Item 11 (the projections CSV, the solver seam) reads the table this ticket creates. It is a separate
ticket and must not be anticipated here.

## Scope

**In scope:**

- New pure modules under `src/lib/projection/`, all exported from `src/lib/projection/index.ts`:
  - **`minutes.ts`** — expected minutes, probability of appearing, and probability of reaching 60
    minutes, from a player's recent match minutes plus an availability factor.
  - **`rates.ts`** — shrunk per-90 xG and xA rates from a player's own history plus a position prior.
  - **`fixture.ts`** — ClubElo-based expected result for a team in one fixture, and the attacking
    multiplier and expected goals conceded derived from it.
  - **`pointValues.ts`** — the 2026/27 standard scoring point values as named constants (see Notes).
  - **`expectedPoints.ts`** — the combiner: one player, one fixture, in → expected points and the
    individual point components out.
- Vitest tests covering every rule in the definition of done.
- **`scripts/project-points.ts`** — the job. Reads Supabase, maps rows onto the pure modules' input
  types, computes projections for the next `PROJECTION_HORIZON` gameweeks, and upserts them.
- **`supabase/migrations/20260815120000_player_projections.sql`** — creates `public.player_projections`
  with RLS **and** GRANTs in the same file.
- One new step in `.github/workflows/scheduled-jobs.yml`, after the existing "Run FPL ingest" step.
- One `job_runs` row per execution, same shape as every other job in `scripts/`.

**Explicitly out of scope:**

- **No I/O of any kind in `src/lib/projection/`.** No `@supabase/supabase-js`, no `fetch`, no
  `node:fs`, no React, no `.css`. That property is what makes the model provable without a database
  and it is worth more than any convenience it costs.
- **No CSV emission, no solver, no solver config, no `data/` directory.** The projections CSV is
  item 11 and the seam is the single thing this ticket must not touch.
- **No recommendation, no captain choice, no transfer suggestion, no Plan A/B/C.** Item 13.
- **No bonus-point projection.** Bonus needs a BPS distribution across all 22 players in a match,
  which needs a different shape of input than this model has. `bonusPoints` is passed as `0`.
- **No card, own-goal or penalty-miss projection.** Small, noisy, and not worth the surface.
- No accuracy tracking, no scoring against actuals, no snapshotting of past projections — item 23.
- No UI, no component, no route, no change to `src/screens/` or `src/components/`.
- **No changes to `src/lib/scoring/`, `src/lib/squad/`, `scripts/ingest-fpl.ts`,
  `scripts/ingest-core-insights.ts` or `scripts/sync-squad.ts`** — consume them, do not edit them.
  Another ticket in this batch owns `scripts/ingest-core-insights.ts`.
- No new dependency.
- No new personal data. This ticket stores model output about public players only.

## Definition of done

**Build and boundary**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] Nothing under `src/lib/projection/` imports `@supabase/supabase-js`, `node:fs`, `node:path`,
      React or any `.css` file, and nothing there calls `fetch`. Verifiable by search.
- [ ] Every new pure module is exported from `src/lib/projection/index.ts`.
- [ ] `src/lib/projection/pointValues.ts` is the **only** place in the repository where the goal,
      assist, clean-sheet, appearance and goals-conceded point values appear. They are not restated
      as bare numbers in `expectedPoints.ts` or in `scripts/project-points.ts`. *(This does not
      conflict with `src/lib/scoring/`, which deliberately holds no standard point values — see the
      comment at the top of `totalMatchPoints.ts`.)*

**The join — the load-bearing one**

- [ ] `scripts/project-points.ts` joins `player_match_stats` to `players` on
      **`player_match_stats.player_code = players.code`**, never on `player_id = id`. The job
      contains no expression joining `player_match_stats.player_id` to `players.id`. Verifiable by
      search.
- [ ] The run's `job_runs.details` records how many `players` rows resolved to at least one
      historical match row and how many resolved to none, as two separately named counts.

**Minutes**

- [ ] Minutes are estimated from the player's **last five match rows, all of them** — the 60-minute
      qualifying rule belongs to #28's defcon estimator and must not be applied here. Given last-five
      minutes of `[90, 90, 90, 62, 20]` and
      an availability factor of `0.75`: expected minutes is `52.8`, probability of reaching 60
      minutes is `0.60`, and probability of appearing at all is `0.75` — each within `0.001`.
- [ ] Expected appearance points for that player is `1.35` within `0.001` — `pAppears × 1` plus
      `pSixtyPlus × 1`, per the 1-point/2-point appearance rule.
- [ ] Availability is derived from `players.status` and `players.chance_of_playing_next_round`:
      `status = 'a'` with a null chance gives `1.0`; a non-null chance gives `chance / 100`; a
      status of `'i'`, `'s'` or `'u'` with a null chance gives `0.0`. Each case has its own test.
- [ ] A player with **no** history rows returns a stated, named fallback rather than zero, an
      error or `NaN`, and every such player is counted in `job_runs.details`.

**Rates**

- [ ] Per-90 rates are shrunk toward a position prior: `(total + k × prior) / (ninetiesPlayed + k)`
      with **`k = 3`**. Given `900` minutes played, total xG `4.3`, and a position prior of `0.30`
      per 90, `xgPer90` is **exactly `0.40`** (`5.2 / 13`). *Check the arithmetic before writing the
      test; if the implementation disagrees, the implementation is wrong.*
- [ ] A player with zero minutes returns the position prior exactly.
- [ ] Position priors are computed from the data passed in, not hardcoded. No probability or rate
      literal appears in `rates.ts` outside `SHRINKAGE_K` and test fixtures.

**Fixture difficulty from ClubElo**

- [ ] `expectedScore(eloFor, eloAgainst, isHome)` is
      `1 / (1 + 10 ** ((eloAgainst - eloFor - h) / 400))` with `h = +65` when home and `-65` when
      away. With equal elo at home the result is between `0.592` and `0.593`.
- [ ] `expectedScore(a, b, true) + expectedScore(b, a, false) === 1` within `1e-12`, for at least
      three distinct elo pairs.
- [ ] The attacking multiplier is `2 × expectedScore`, clamped to `[0, 2]`, and equals `1.0` exactly
      at `expectedScore = 0.5`.
- [ ] Expected goals conceded is `leagueBaselineGoals × 2 × (1 - expectedScore)`, clamped at zero
      from below.
- [ ] **A fixture whose team has a null `elo` falls back to FPL's own `team_h_difficulty` /
      `team_a_difficulty` from `fixtures`**, via a documented mapping, and every such fixture is
      counted in `job_runs.details`. It is never treated as elo `0`.

**Clean sheets and goals conceded**

- [ ] Clean-sheet probability is `Math.exp(-lambdaConceded)`. At `lambdaConceded = 1.4` the result
      is between `0.246` and `0.247`.
- [ ] Clean-sheet points are `pCleanSheet × pSixtyPlus × cleanSheetPoints(position)` — the 60-minute
      requirement is applied, not assumed away.
- [ ] Goals-conceded points use the true Poisson expectation of `-floor(GC / 2)`, summed over
      `k = 0..10`, **not** a linear `-lambda / 2` approximation. At `lambdaConceded = 1.4` a defender
      playing the full match scores between `-0.47` and `-0.46`. *(The linear form gives `-0.70` and
      overstates the penalty by roughly half — that is the specific wrong implementation this item
      exists to catch.)*
- [ ] Goals-conceded points are zero for midfielders and forwards.

**Saves and defensive contribution**

- [ ] Goalkeeper save points use the Poisson expectation of `floor(saves / 3)`, summed over
      `k = 0..15`. At an expected `3.0` saves the result is between `0.66` and `0.67`.
- [ ] Save points are zero for every outfield position.
- [ ] Defensive-contribution points come from `estimateDefconHitRate` and
      `expectedDefensiveContributionPoints`, imported from `src/lib/projection/defconRate.ts` —
      neither is reimplemented. Weighted by `pSixtyPlus`: a hit rate of `0.5` and a `pSixtyPlus` of
      `0.60` yields `0.60` points, within `0.001`.
- [ ] Goalkeepers score `0` defensive-contribution points, as #28 already enforces.

**The combiner**

- [ ] The per-fixture total is produced by `totalMatchPoints` from `src/lib/scoring/`, with every
      component this ticket does not model passed as `0`. `expectedPoints.ts` contains no
      hand-rolled sum of the components.
- [ ] A player whose team has **two** fixtures in one gameweek is projected as the **sum** of both
      fixtures, and their expected minutes is the sum of both. There is a named test for this.
- [ ] A player whose team has **no** fixture in a gameweek is projected as `0` expected points and
      `0` expected minutes, without erroring. There is a named test for this.
- [ ] Every returned expected-points value is a finite number for every input tested. No `NaN`, no
      `Infinity`, in any test.

**Storage and the job**

- [ ] `supabase/migrations/20260815120000_player_projections.sql` creates `public.player_projections`
      with primary key `(gameweek_id, player_id, model_version)` and columns at least:
      `gameweek_id`, `player_id`, `player_code`, `expected_points numeric NOT NULL`,
      `expected_minutes numeric NOT NULL`, `components jsonb NOT NULL`, `model_version text NOT NULL`,
      `computed_at timestamptz NOT NULL DEFAULT now()`.
- [ ] **The same migration file issues `GRANT SELECT` to `anon` and `GRANT SELECT, INSERT, UPDATE`
      to `service_role` on the new table**, and enables RLS with a `SELECT` policy for `anon`.
      `DELETE` is not granted. *(RLS and GRANTs are two independent gates — `deltas.md` D8.)*
- [ ] The migration is idempotent: `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`,
      policies dropped-then-recreated, and the same `anon`/`service_role` role guard every prior
      migration in this repo uses. Running it twice creates nothing the second time.
- [ ] `components jsonb` carries, per row, each of the five model inputs and each point component
      by name, so item 13's reasoning screen and item 23's accuracy tracker have something to read.
- [ ] `model_version` is written from a single named constant with the value `'baseline-v1'`.
- [ ] `scripts/project-points.ts` reads exactly `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, matching
      every other job in `scripts/`. No `VITE_`-prefixed variable appears in it.
- [ ] The job projects the next `PROJECTION_HORIZON = 5` gameweeks, determined from
      `gameweeks.is_next` and the four following ids.
- [ ] The job **upserts** on the primary key and never deletes a row. `.delete(` does not appear in
      `scripts/project-points.ts`.
- [ ] If `player_projections` does not exist, the job fails with a message naming the table and the
      migration file path, matching the `isMissingTable` pattern the other jobs already use.
- [ ] One `job_runs` row per execution with `job_name = 'project-points'`, never upserted, carrying
      the gameweeks projected, the row count written, and every count named elsewhere in this DoD.
- [ ] The new workflow step is added **after** the existing "Run FPL ingest" step in
      `.github/workflows/scheduled-jobs.yml`, passes `SUPABASE_URL` and `SUPABASE_SECRET_KEY`, and
      **the existing heartbeat, core-insights, FPL-ingest and squad-sync steps all still exist and
      are unmodified in the merged file.**
- [ ] Scope constraint: only files under `src/lib/projection/`, `scripts/project-points.ts`,
      `supabase/migrations/20260815120000_player_projections.sql`,
      `.github/workflows/scheduled-jobs.yml`, and this ticket's own `decisions/ticket-<number>.md`
      are added or changed. Nothing under `src/lib/scoring/`, `src/lib/squad/`, `src/components/`,
      `src/screens/` changes; no other file in `scripts/` changes; `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

**The 2026/27 standard point values, verified 15 Aug 2026** against two independent published
scoring tables (draftfantasy.com and worldinsport.com), both agreeing. Put these in
`pointValues.ts` with that verification date in a comment. Do **not** take them from training data,
and do not restate them anywhere else in the repo:

| Category | GK | DEF | MID | FWD |
|---|---|---|---|---|
| Goal | 10 | 6 | 5 | 4 |
| Clean sheet (60+ mins) | 4 | 4 | 1 | 0 |
| Assist | 3 | 3 | 3 | 3 |
| Appearance | 1 for 1–59 mins, 2 for 60+ | | | |
| Goals conceded | −1 per 2 conceded | −1 per 2 conceded | 0 | 0 |
| Saves | 1 per 3 saves | — | — | — |

Note the goalkeeper goal value is **10**, not 6. That is the current published figure and it is
worth a comment in the file so nobody "corrects" it back.

**Why the goals-conceded and saves terms use a real Poisson expectation.** Both scoring rules are
step functions — `floor(GC / 2)`, `floor(saves / 3)` — and the expectation of a step function is not
the step function of the expectation. The linear shortcut `-lambda / 2` overstates the
goals-conceded penalty by about 50% at realistic values, which would systematically under-rank every
defender in the app. Summing `k = 0..10` (or `0..15` for saves) is about six lines and is exactly
right. This is Tier 3, decided here.

**`leagueBaselineGoals`.** Compute it at runtime from `public.fixtures` — the mean of
`(team_h_score + team_a_score) / 2` across finished fixtures. If fewer than 20 finished fixtures
exist (true before GW1 2026/27), fall back to the named constant
`LEAGUE_BASELINE_GOALS_PER_TEAM = 1.45`, and **record in `job_runs.details` which path was taken**.
The constant is Tier 3, decided here, and must carry a comment saying it is a placeholder that the
runtime computation supersedes as soon as the season has results.

**Home advantage of 65 elo points** is Tier 3, decided here, and is the conventional value in
elo-rating football models. One named constant, one comment. Do not fit it.

**The elo fallback is not optional.** `teams.elo` is null for any club the FPL-Core-Insights
`teams.csv` never covered, and a null must not silently become elo `0` — that would make the club
the worst team in the league by a mile and quietly break every fixture it appears in.
`fixtures.team_h_difficulty` / `team_a_difficulty` (FPL's own 1–5 FDR) is the documented fallback;
map it with a small stated table and count the fixtures that used it.

**A ticket running alongside this one repairs `teams.elo`.** It changes how `elo` is written, not
what this ticket reads, and it touches only `scripts/ingest-core-insights.ts` — no overlap with any
file here. This ticket's DoD does not depend on the elo *values* being right, only on the code
handling them correctly.

**Historical data is last season's, joined by `player_code`.** `player_match_stats` currently holds
**2025-2026** rows keyed by that season's `player_id`, which is meaningless against the current
`players` table — 453 of 458 players changed id across the season boundary (#12/#22). The join is
`player_match_stats.player_code = players.code` and nothing else. Getting this wrong produces a
model that silently trained on almost nothing and looks fine, which is the single most expensive
failure available in this ticket.

**Promoted-club players and new signings will have no history at all.** That is normal for GW1, not
an error. Return the stated fallback, count them, and move on. Do not invent history and do not
drop the player — a player with no rows still needs a projection or the CSV in item 11 will have a
hole in it.

**Store the projection; do not just compute it.** Item 11 reads the table, item 13 reads
`components` for stored reasoning, and item 23 scores it against actuals. Recomputing in each
consumer would put three copies of the model in the codebase. This is Tier 2, decided here.

**One row per `(gameweek, player, model_version)`, overwritten by each daily run.** The
projection-as-made-at-the-deadline snapshot that item 23 needs is item 23's problem and will add its
own table or its own key column. Do not build it here. `model_version` exists so that item 31
(swapping the projection source behind the CSV seam) can write alongside `baseline-v1` rather than
over it — that is the whole reason the column is in the primary key.

**Horizon of 5.** The solver's default horizon is 3. Projecting 5 means item 12 can raise its
horizon without a change to this job. Tier 3, decided here.

**What a local substitute cannot catch.** Unit tests prove every formula above without a database,
and that is most of this ticket. They cannot prove the migration's GRANTs are correct, because a
local Postgres runs the test as a superuser for whom grants are irrelevant — `deltas.md` D8, and
the exact bug that cost a failed run on 11 Aug. They also cannot prove the `player_code` join
returns rows against live data. Both are human verification steps after merge: apply the migration,
run the workflow, and check the row count in `job_runs.details`.
