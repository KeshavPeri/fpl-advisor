## Context

**Two defects in the model's input data, with one cause: the ingest captures less than the source
provides, and every consumer draws conclusions the data cannot support.** This is the
highest-priority open item — the first defect affects every projection the app currently produces.

All figures below were verified directly against the source files on 17 Aug 2026, not inferred.

### Defect 1 — `player_match_stats` is not Premier-League-only

The `match_id` slug carries the competition: `25-26-<competition>-<home>-vs-<away>`. Sampling 31 of
the 38 gameweek files (7 returned HTTP 429 mid-check, so true totals are ~15% higher):

| Competition | Rows | Share |
|---|---|---|
| `prem` | 10,381 | **82.1%** |
| `champions-league` | 954 | 7.5% |
| `efl-cup` | 650 | 5.1% |
| `europa-league` | 444 | 3.5% |
| `conference-league` | 219 | 1.7% |

**About 18% of the rows are cup and European matches**, and FA Cup rows are in the seven files the
sample missed. `GW12/playermatchstats.csv` alone holds **19 distinct `match_id` values — ten Premier
League fixtures and nine European ones**; 130 players have more than one row in that folder.

**How it was spotted:** the calibration report's top-20 tables list players with 49, 50, 52 and 54
matches in a 38-game season. Impossible numbers, printed on the page.

**Why it matters.** Cup and European matches score **no FPL points at all**, yet every consumer
treats a row as a Premier League appearance:

- **`scripts/project-points.ts` builds per-90 xG and xA rates from these rows.** Measured: **xG per
  90 is 0.128 in Premier League rows and 0.172 in cup and European rows — 34% higher**, because EFL
  Cup fixtures are against lower-league opposition and European games are more open. **This bias is
  not uniform.** It inflates the rates of players at clubs *in Europe* and leaves everyone else
  alone, systematically flattering big-six players against a Brentford or Fulham player — which is
  exactly the comparison a transfer recommendation turns on.
- **The last-five-matches minutes window is not the last five league games** for any club in Europe.
  Mean minutes on appearance are close (65.1 league, 64.4 cup), so this effect is smaller than the
  rate effect, but the window is not measuring what it claims.
- **The shrinkage denominator is wrong.** `(total + k × prior) / (ninetiesPlayed + k)` counts cup
  minutes toward `ninetiesPlayed`, so a European club's player is shrunk toward the prior *less* than
  intended, on rates that are already inflated. The errors compound in the same direction.
- **The defensive-contribution hit-rate estimator (#28) reads the same rows.**
- **The calibration report scores cup matches as though they earned FPL points.**

### Defect 2 — clean sheets are reconstructed from a goalkeeper-only column

The calibration report's own component table implies these clean-sheet rates:

| Position | Actual clean-sheet pts/90 | Worth | Implied rate |
|---|---|---|---|
| Defender | 3.81 | 4 | **95.3%** |
| Midfielder | 0.91 | 1 | **91.0%** |
| Goalkeeper | 1.18 | 4 | 29.5% |

A clean sheet needs the *team* to concede nothing, which happens about 30% of the time. 95% is not
surprising, it is impossible. The defender row also reports a concession penalty of **−0.00**.

**The cause, verified:** `player_match_stats.goals_conceded` is a **goalkeeper** stat. It is
populated on **73.9%** of goalkeeper rows and **1.1%** of outfield rows. Empty for a defender means
the reconstruction sees zero conceded, credits a clean sheet in every match, and applies no penalty.
Goalkeepers come out at 29.5% — correct — which is what a column populated for one position and not
the others looks like.

**And the fix is already in the source, unused.** `playermatchstats.csv` carries a separate column,
**`team_goals_conceded`**, which the ingest has never captured and no migration has ever created:

| | `team_goals_conceded` present | Implied clean-sheet rate |
|---|---|---|
| Outfield rows, 60+ minutes | **97.4%** | **28.0%** |
| Goalkeeper rows, 60+ minutes | 96.5% | 25.8% |

**28.0% against a real-world ~30%.** The right column exists, is well populated for every position,
and produces a realistic answer. This is a missing-ingest bug, not a data gap.

**Why these two are one ticket.** They touch the same migration, the same ingest job and the same
report. Split, they produce two migrations, two edits to `ingest-core-insights.ts`, two edits to the
report, and a guaranteed merge conflict if both are ever queued together. Both are the same defect
shape: the ingest captured less than the source offered, and consumers silently drew wrong
conclusions.

Depends on #12/#22 (`player_match_stats`), item 10 (`project-points.ts`) and the calibration report —
all merged.

## Scope

**In scope:**

- **`supabase/migrations/20260818100000_match_stats_competition_and_team_goals.sql`** — adds
  `competition text` (indexed) and `team_goals_conceded integer` to `player_match_stats`. Both
  nullable. No new GRANT (table-level grants already cover new columns — same reasoning the
  `player_code` migration documented).
- **`scripts/ingest-core-insights.ts`** — derive `competition` from the `match_id` slug and capture
  `team_goals_conceded` from the source CSV, on every row. **Fail loudly on a slug whose competition
  token is not in a known list.**
- **`scripts/project-points.ts`** — filter every read of `player_match_stats` to Premier League rows,
  for the rate history, the minutes window **and** the defcon match set.
- **`scripts/calibration-report.ts`** — apply the same filter, and reconstruct clean sheets and the
  concession penalty from `team_goals_conceded` for **all** positions.
- A bounds check on every reconstructed rate that has a known real-world limit.
- Correct the report's cross-position tables (see the definition of done).
- Row counts read and excluded, in each job's `job_runs.details`.
- Vitest tests for the slug parser, the filtering, and the clean-sheet reconstruction.

**Explicitly out of scope:**

- **Do not delete or stop ingesting the non-Premier-League rows.** They are stored, they cost nothing,
  and a future ticket with an opposition-strength adjustment may want them. This ticket makes
  consumers *ignore* them. `DELETE` is not granted on this table and must not be.
- **No opposition-strength adjustment, no competition weighting.** That needs the backtest to
  calibrate.
- **No change to the projection formulas.** Nothing under `src/lib/projection/` or `src/lib/scoring/`
  is edited — those are pure and take data passed in. Both bugs are in what is passed in.
- **Do not change how defensive contribution is computed.** The source also ships a precomputed
  `defensive_contributions` column; we deliberately compute ours from the raw action counts via the
  verified scoring module. Adopting the source's column is a separate decision, not this ticket.
- **No point-in-time backtest.** Still feature item 29.
- **No change to `scripts/emit-projections-csv.ts`, `scripts/build-solver-input.ts`,
  `scripts/store-solver-output.ts`, `scripts/generate-recommendations.ts`,
  `scripts/send-telegram.ts` or `scripts/sync-squad.ts`.**
- **No UI. Nothing under `src/` changes at all.**
- **No change to `CORE_INSIGHTS_SEASON` or `DEFAULT_SEASON`.**
- No new npm dependency.

## Definition of done

**Migration and ingest**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] Nothing under `src/` is added, changed or deleted.
- [ ] The migration adds both columns, indexes `competition`, is idempotent (`ADD COLUMN IF NOT
      EXISTS`, `CREATE INDEX IF NOT EXISTS`), and uses the same role guard every prior migration uses.
      It adds no GRANT and says why in the file header.
- [ ] `team_goals_conceded` is added to the ingest's required-columns check, so the job **fails loudly
      naming the file** if the source ever stops publishing it — the existing schema-change guard,
      extended, not weakened.
- [ ] `COMMENT ON COLUMN` states that `goals_conceded` is a goalkeeper stat (1.1% populated for
      outfield rows) and that `team_goals_conceded` is the column to use for clean sheets. The next
      person must not have to rediscover this.

**The competition parser**

- [ ] The parser takes a `match_id` and returns the competition token, with named tests for
      **`prem`, `efl-cup`, `fa-cup`, `champions-league`, `europa-league`, `conference-league`**, using
      real slug shapes: `25-26-prem-manchester-united-vs-arsenal`,
      `25-26-champions-league-bayern-münchen-vs-arsenal`,
      `25-26-efl-cup-manchester-city-vs-huddersfield-town`.
- [ ] **An unrecognised competition token makes the ingest fail loudly** — non-zero exit, failed
      `job_runs` row, the offending `match_id` in the message. It does **not** default to `prem` and
      does **not** store null and continue.
- [ ] A non-ASCII team name (`bayern-münchen`) does not mangle the token. Named test.
- [ ] The parser does not depend on the season prefix — a `26-27-` slug works. Named test.

**Backfill**

- [ ] Re-running the ingest **stamps both new columns on rows that already exist**, because the
      upsert conflict target is `(player_id, match_id)`. No separate backfill script is written.
- [ ] The run reports rows written and how many now carry a non-null `competition`.

**The consumers — this is the part that fixes the model**

- [ ] **Every read of `player_match_stats` in `scripts/project-points.ts` filters to Premier League
      rows.** All three uses covered: rate history, minutes window, defcon match set. Verifiable by
      search — no unfiltered read of that table remains in the file.
- [ ] `scripts/calibration-report.ts` applies the same filter.
- [ ] The filter is applied **in the query**, not in memory after fetching, so it composes with the
      pagination helper and the row-count assertion.
- [ ] The row-count assertion compares against a count query **using the same filter**. Named test
      proving both queries use identical filters. *(A count over unfiltered rows against filtered
      data would fail and look like the pagination bug returning.)*
- [ ] Both jobs record rows read and rows excluded as non-Premier-League, as two named counts in
      `job_runs.details`.
- [ ] Rows whose `competition` is null are **excluded** from consumer reads, counted separately, and
      never assumed to be Premier League.

**Clean sheets, done properly**

- [ ] Clean sheets and the concession penalty are reconstructed from **`team_goals_conceded`**, for
      every position. `goals_conceded` is used only where a goalkeeper-specific figure is genuinely
      wanted, and the report says which is which.
- [ ] A clean sheet is `team_goals_conceded = 0` **and** `minutes_played >= 60`, scoring 4 for
      goalkeepers and defenders, 1 for midfielders, 0 for forwards. Named test per position.
- [ ] A row whose `team_goals_conceded` is null is **excluded from the clean-sheet and concession
      figures and counted**, rather than treated as zero conceded. Named test.
- [ ] **After this ships, the implied clean-sheet rate for defenders is between 20% and 40%.** The
      source data gives 28.0%. *(Live-run only.)*

**Guards that would have caught both bugs**

- [ ] **Any reconstructed rate breaching a known real-world bound is reported as an explicit
      data-quality warning in the report body** — an implied clean-sheet rate above 60% for any
      position, for instance. Not left for a reader to spot. Named test.
- [ ] **No player's Premier League match count exceeds 38**, and a count above 38 is reported as a
      data-quality warning. *(Live-run only, but the warning path is testable.)*
- [ ] **The top-20 "actual scorers" tables are corrected.** They are built from the same
      reconstruction, so every defender and midfielder total in them is currently inflated — Virgil
      at 388 points across 49 matches is 7.9 a match, which no defender achieves. Recompute them from
      the filtered, correctly-reconstructed data.
- [ ] The report states in one line that **a season total is not a captaincy signal** — it rewards
      availability as much as per-match quality, and the model's inputs are per-90 rates and fixture
      difficulty, never a season total. The top-20 actual table is a validation artefact, not a
      ranking to pick from.
- [ ] The report notes that **2,873 of 15,340 rows (19%) were skipped** for a `player_code` not in the
      current `players` table — players who left the league — and that this biases the actual sample
      toward players still in the game.
- [ ] The report retains its caveats section, its per-position sample sizes, its component tables and
      its distribution tables.

**Robustness**

- [ ] No job issues a Supabase row-removal call. No migration here grants `DELETE`.
- [ ] Scope constraint: only
      `supabase/migrations/20260818100000_match_stats_competition_and_team_goals.sql`,
      `scripts/ingest-core-insights.ts`, `scripts/project-points.ts`,
      `scripts/calibration-report.ts`, a new shared competition-parser module under `scripts/`, their
      test files, and this ticket's own `decisions/ticket-<number>.md` are added or changed. Nothing
      under `src/` or `.github/` changes; no other file in `scripts/` changes; `package.json` is
      untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **Premier-League-only is not a judgement call.** FPL awards points for Premier League matches and
  nothing else. A goal in the EFL Cup is worth zero FPL points. A model predicting FPL points must be
  built from the matches that score them, and the measured 34% xG-per-90 gap between competitions is
  exactly how large an opposition adjustment would have to be if you wanted to use the rest.
- **Derive the competition into a column; do not pattern-match at the call site.** A
  `LIKE '%-prem-%'` filter in three files works today and is a landmine: invisible to a reader,
  untestable in isolation, and it silently admits anything new whose slug contains the substring.
- **Fail loudly on an unknown competition. This is the most important line in the ticket.** Both
  defects exist because unexpected or absent data arrived and nothing objected. Defaulting to `prem`,
  or to null-and-continue, reproduces the bug for the next competition the source adds — the Club
  World Cup, the Community Shield and the UEFA Super Cup are all plausible.
- **The clean-sheet fix is a column swap, not a modelling change.** `team_goals_conceded` is already
  in the source CSV, is 97% populated for outfield players, and yields 28.0% clean sheets. Do not
  invent a rate, do not derive one from `fixtures` (which holds 2026/27 only, with no results yet),
  and do not report "not comparable" — the data is there.
- **The projection side is not wrong on clean sheets and must not be touched.**
  `src/lib/projection/` derives expected concessions from ClubElo and a league baseline, never from
  `goals_conceded`. Check that for yourself, then leave it alone.
- **Expect the projections to move, and that is the point.** Attacking rates for players at clubs in
  Europe should come down. If nothing changes after this ships, the filter is not working — that is
  the first thing to check, not a relief.
- **The null-competition rule is deliberately conservative.** Between the migration applying and the
  next ingest run, existing rows have no competition value. Treating null as "exclude" means one run
  under-counts, visibly, in the counts. Treating it as "probably Premier League" means the bug
  continues. Under-counting is recoverable; the alternative is not.
- **The source also ships a precomputed `defensive_contributions` column.** We deliberately compute
  ours from the raw action counts through the verified scoring module, and that stays. But the
  source's column is a free cross-check on our own arithmetic, and comparing the two would be a cheap
  and worthwhile future ticket. Not this one — note it in the decisions log.
- **Two other tickets are running in this batch.** One owns the home screen; the other owns
  `src/lib/notification/`, `scripts/send-telegram.ts` and its own migration. Neither touches this
  ticket's files. **Pin the migration filename exactly as given** so two migrations in one batch
  cannot collide on a timestamp — that has already happened once.
- **What a substitute cannot catch.** Tests prove the parser, the filters and the clean-sheet
  arithmetic against fixtures. They cannot prove the live rows get stamped, that the 38-match ceiling
  now holds, that defenders' clean-sheet rate lands near 28%, or that the projections actually moved.
  All are live-run checks after merge: apply the migration, run the ingest, run the projection, run
  the report. QA should mark them CANNOT VERIFY and say why.
