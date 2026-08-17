## Context

**A defect fix in the model's input data. This is the highest-priority open item — it affects every
projection the app currently produces.**

`player_match_stats` does not contain only Premier League matches. It contains **every competition
the source publishes**, all stamped with whichever gameweek folder they fall in. Verified directly
against the source on 17 Aug 2026.

The `match_id` slug carries the competition: `25-26-<competition>-<home>-vs-<away>`. Sampling 31 of
the 38 gameweek files (7 returned HTTP 429 during the check, so the true totals are ~15% higher):

| Competition | Rows | Share |
|---|---|---|
| `prem` | 10,381 | **82.1%** |
| `champions-league` | 954 | 7.5% |
| `efl-cup` | 650 | 5.1% |
| `europa-league` | 444 | 3.5% |
| `conference-league` | 219 | 1.7% |

**Roughly 18% of the rows are not Premier League matches**, and FA Cup rows will be in the seven
files the sample missed. `data/2025-2026/By Gameweek/GW12/playermatchstats.csv` alone contains **19
distinct `match_id` values — ten Premier League fixtures and nine European ones.** 130 players have
more than one row in that single gameweek folder.

**How this was spotted:** the calibration report's top-20 tables show players with 49, 50, 52 and 54
matches in a 38-game season. Those are impossible numbers and they were on the page.

### Why this matters more than it sounds

**Cup and European matches score no FPL points at all.** Every consumer of this table treats a row
as a Premier League appearance:

- **`scripts/project-points.ts` builds per-90 xG and xA rates from these rows.** Measured today:
  **xG per 90 is 0.128 in Premier League rows and 0.172 in cup and European rows — 34% higher**,
  because EFL Cup fixtures are against lower-league opposition and European games are more open. This
  is not a uniform bias. It inflates the rates of players at clubs *in Europe* and leaves everyone
  else alone, so it systematically flatters big-six players against a Brentford or a Fulham player.
  **That is precisely the comparison a transfer recommendation turns on.**
- **The last-five-matches minutes window is not the last five Premier League matches** for any club
  in Europe. Mean minutes on appearance are close (65.1 Premier League, 64.4 cup — so this effect is
  smaller than the rate effect), but the window is still not measuring what it claims to.
- **The shrinkage denominator is wrong.** `(total + k × prior) / (ninetiesPlayed + k)` counts cup
  minutes toward `ninetiesPlayed`, so a European club's player is shrunk toward the prior less than
  intended, on rates that are themselves inflated. The two errors compound.
- **The defensive-contribution hit-rate estimator (#28) reads the same rows**, so defcon rates carry
  the same contamination.
- **The calibration report scores cup matches as though they earned FPL points**, which is part of
  why its actual figures do not reconcile.

Depends on #12/#22 (`player_match_stats`), item 10 (`project-points.ts`) and the calibration report
— all merged.

## Scope

**In scope:**

- **`supabase/migrations/20260818100000_player_match_stats_competition.sql`** — adds
  `competition text` to `player_match_stats`, nullable, indexed. No new GRANT needed (table-level
  grants already cover new columns — same reasoning as the #22 migration).
- **`scripts/ingest-core-insights.ts`** — derive `competition` from the `match_id` slug at ingest and
  write it on every row, existing and new. **Fail loudly on a slug whose competition token is not in
  a known list**, so a new competition appearing at the source is a visible event rather than silent
  contamination.
- **`scripts/project-points.ts`** — filter every read of `player_match_stats` to Premier League rows
  only, for rate history, the minutes window **and** the defcon match set.
- **`scripts/calibration-report.ts`** — same filter on the actual side, and report the excluded row
  count.
- Report, in each job's `job_runs.details`, how many rows were read and how many were excluded as
  non-Premier-League.
- Vitest tests for the slug-to-competition parser and for the filtering.

**Explicitly out of scope:**

- **Do not delete or stop ingesting the non-Premier-League rows.** They are already stored, they cost
  nothing, and they are potentially useful later with an opposition-strength adjustment. This ticket
  makes consumers *ignore* them; it does not remove them. `DELETE` is not granted on this table and
  must not be.
- **No opposition-strength adjustment, no competition weighting, no attempt to use cup data
  usefully.** That is a modelling change and needs the backtest to calibrate.
- **No change to the projection formulas themselves.** Nothing under `src/lib/projection/` or
  `src/lib/scoring/` is edited — those modules are pure and take data passed in. The bug is in what
  is passed in.
- **No fix to the calibration report's clean-sheet reconstruction.** That is a separate open ticket
  and it must be built **after** this one, against the filtered numbers.
- **No change to `scripts/emit-projections-csv.ts`, `scripts/build-solver-input.ts`,
  `scripts/store-solver-output.ts`, `scripts/generate-recommendations.ts`,
  `scripts/send-telegram.ts` or `scripts/sync-squad.ts`.**
- **No UI. Nothing under `src/` changes at all.**
- **No change to `CORE_INSIGHTS_SEASON` or `DEFAULT_SEASON`.**
- No new npm dependency.

## Definition of done

**The column and the parser**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] Nothing under `src/` is added, changed or deleted.
- [ ] The migration adds `competition text` with an index, is idempotent (`ADD COLUMN IF NOT EXISTS`,
      `CREATE INDEX IF NOT EXISTS`), and uses the same role guard every prior migration uses. It adds
      no GRANT and the file says why — table-level grants already cover a new column, exactly as the
      `player_code` migration documented.
- [ ] The competition parser takes a `match_id` and returns the competition token. There are named
      tests for **`prem`, `efl-cup`, `fa-cup`, `champions-league`, `europa-league`,
      `conference-league`**, using real slug shapes:
      `25-26-prem-manchester-united-vs-arsenal`,
      `25-26-champions-league-bayern-münchen-vs-arsenal`,
      `25-26-efl-cup-manchester-city-vs-huddersfield-town`.
- [ ] **A slug whose competition token is not in the known list makes the ingest fail loudly**, with
      a non-zero exit, a failed `job_runs` row, and the offending `match_id` in the message. It does
      **not** default to `prem` and does **not** silently store null. A new competition at the source
      is a fact somebody must see.
- [ ] The parser handles a non-ASCII team name (`bayern-münchen`) without mangling the competition
      token. There is a named test.
- [ ] The parser does not depend on the season prefix being `25-26` — it must work for `26-27` and
      any later season. There is a named test with a `26-27-` slug.

**Backfill**

- [ ] Re-running the ingest **stamps `competition` on rows that already exist**, because the upsert
      conflict target is `(player_id, match_id)` and the column is part of the upserted row. No
      separate backfill script is written.
- [ ] The run reports how many rows were written and how many now carry a non-null `competition`.

**The consumers — this is the part that fixes the model**

- [ ] **Every read of `player_match_stats` in `scripts/project-points.ts` filters to Premier League
      rows.** All three uses are covered: the per-90 rate history, the last-five-matches minutes
      window, and the defensive-contribution match set. Verifiable by search — no unfiltered read of
      that table remains in the file.
- [ ] `scripts/calibration-report.ts` applies the same filter to the actual side.
- [ ] Both jobs record, in `job_runs.details`, the rows read and the rows excluded as
      non-Premier-League, as two named counts.
- [ ] The filter is applied **in the query**, not by filtering in memory after fetching, so it
      composes with the pagination helper and the row-count assertion rather than fighting them.
- [ ] The row-count assertion still passes — it compares against a count query **using the same
      filter**. There is a named test proving the count query and the data query use identical
      filters. *(A count over unfiltered rows against filtered data would fail the assertion and look
      like the pagination bug returning.)*
- [ ] **After this ships, no player's Premier League match count exceeds 38.** That is the check that
      proves the fix end to end. *(Live-run only — see below.)*

**Robustness**

- [ ] Rows whose `competition` is null (not yet re-stamped) are **excluded** from consumer reads
      rather than assumed to be Premier League, and the exclusion is counted separately from the
      known-non-Premier-League count. A consumer running before the ingest has re-stamped must
      under-count rather than silently include cup matches.
- [ ] Neither job issues a Supabase row-removal call. `DELETE` is not granted on this table and no
      migration in this ticket grants it.
- [ ] Scope constraint: only `supabase/migrations/20260818100000_player_match_stats_competition.sql`,
      `scripts/ingest-core-insights.ts`, `scripts/project-points.ts`,
      `scripts/calibration-report.ts`, a new shared competition-parser module under `scripts/`, their
      test files, and this ticket's own `decisions/ticket-<number>.md` are added or changed. Nothing
      under `src/`, `.github/` changes; no other file in `scripts/` changes; `package.json` is
      untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **Premier-League-only is the correct answer, and it is not a judgement call.** FPL awards points for
  Premier League matches and nothing else. A goal in the EFL Cup is worth zero FPL points. A model
  predicting FPL points must be built from the matches that score them. Using cup data would require
  an opposition-strength adjustment this model does not have — and the measured 34% xG-per-90 gap
  between competitions is exactly how large that adjustment would need to be.
- **Derive the competition, do not pattern-match at the call site.** A `LIKE '%-prem-%'` filter
  scattered across three files works today and is a landmine: it is invisible to a reader, it cannot
  be tested independently, and it silently includes anything new whose slug happens to contain the
  substring. One parsed column, one filter, one test suite.
- **Fail loudly on an unknown competition. This is the most important line in the ticket.** The whole
  defect exists because unexpected rows arrived and nothing objected. Defaulting an unrecognised
  competition to `prem`, or to null-and-continue, reproduces the bug for the next competition the
  source adds. The FIFA Club World Cup, the Community Shield and the UEFA Super Cup are all plausible
  future additions.
- **Do not stop ingesting cup rows.** Storing them costs nothing, `DELETE` is deliberately not
  granted on this table, and a future ticket with an opposition adjustment may want them. Filter at
  read time.
- **The null-competition rule is deliberately conservative.** Between this migration being applied and
  the next ingest run, existing rows have no competition value. Treating null as "unknown, exclude"
  means the projection under-counts for one run; treating it as "probably Premier League" means it
  keeps doing exactly what this ticket exists to stop. Under-counting is recoverable and visible in
  the counts; the alternative is neither.
- **Expect the projections to move, and that is the point.** Attacking rates for players at clubs in
  Europe should come down. If nothing changes after this ships, the filter is not working — that is
  the first thing to check, not a relief.
- **This does not fix the calibration report's clean-sheet problem.** That is a separate ticket, and
  it must be written against the filtered numbers, so it comes after this one. Do not attempt both.
- **Two other tickets are running in this batch.** One owns the home screen; the other owns
  `src/lib/notification/`, `scripts/send-telegram.ts` and its own migration. Neither touches
  `scripts/ingest-core-insights.ts`, `scripts/project-points.ts` or
  `scripts/calibration-report.ts`. Pin the migration filename exactly as given so two migrations in
  one batch cannot collide on a timestamp — that has happened once already.
- **What a substitute cannot catch.** Tests prove the parser and the filters against fixtures. They
  cannot prove the live table's rows get stamped, cannot prove the 38-match ceiling now holds, and
  cannot prove the projections actually moved. Those are live-run checks after merge: apply the
  migration, run the ingest, run the projection, then confirm no player exceeds 38 Premier League
  matches and compare a European club's attacking rates before and after. QA should mark them CANNOT
  VERIFY and say why.
