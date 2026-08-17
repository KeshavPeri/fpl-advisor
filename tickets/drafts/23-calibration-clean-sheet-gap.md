## Context

A defect fix in the calibration report itself, filed immediately because the report is now the
instrument used to judge the projection model and **its headline conclusion is currently wrong.**

The first report (17 Aug 2026) concluded that defenders are **under**-projected at 0.55×. That
conclusion is an artefact. The evidence is in the report's own component table:

| Position | Actual clean-sheet pts/90 | CS worth | **Implied clean-sheet rate** |
|---|---|---|---|
| Defender | 3.81 | 4 | **95.3%** |
| Midfielder | 0.91 | 1 | **91.0%** |
| Goalkeeper | 1.18 | 4 | 29.5% |

**A clean sheet requires the team to concede zero, which happens in roughly 30% of team-matches.**
95% is not a surprising result, it is an impossible one. The defender row also reports goals-conceded
points of **−0.00**, when a defender playing a full season concedes constantly and should carry
roughly −0.45.

Both symptoms have one cause: **`player_match_stats.goals_conceded` is populated for goalkeepers and
not for outfield players.** With it null or zero for a defender, the reconstruction sees
`goals_conceded = 0` and `minutes >= 60`, credits a clean sheet in **every match**, and applies no
concession penalty. Goalkeepers come out at 29.5% — realistically correct — which is exactly what a
column populated for one position and not the others looks like.

**Correcting for it reverses the report's conclusion.** Substituting a realistic 30% clean-sheet rate
and a realistic concession penalty:

| Position | Actual, corrected | Projected | Ratio |
|---|---|---|---|
| Goalkeeper | 3.35 | 3.65 | 1.09× |
| Defender | **3.95** | 3.88 | **0.98×** |
| Midfielder | **4.37** | 4.48 | **1.03×** |
| Forward | 4.85 | 5.04 | 1.04× |

The model is calibrated within a few per cent across all four positions. The report says it is out by
45% on defenders. **That is the bug: a measuring instrument reading wrong in a way that would send
the next three tickets chasing a problem that does not exist.**

Depends on the calibration report (merged) and #12/#22 (`player_match_stats`).

## Scope

**In scope:**

- **Establish what `player_match_stats.goals_conceded` actually contains**, by position, and record
  the finding in the report itself and in `decisions/ticket-<number>.md`.
- **Stop reconstructing clean sheets and goals-conceded points from a column that cannot support
  them.** Where the column is not reliably populated for a position, those two components are
  reported as **not comparable**, with the reason, rather than as a number.
- **Exclude them from both sides of the total** for any position where they are not comparable, so
  the headline totals stay like-for-like — the same principle the report already applies to bonus.
- Report the corrected headline: whether defenders are over- or under-projected, on the components
  that can actually be measured.
- **Report the excluded components separately and explicitly**, with the implied rates above, so the
  gap is visible rather than quietly dropped.
- Record the per-position count of match rows with a non-null, non-zero `goals_conceded`, so a future
  run detects the moment the source starts populating it.
- Vitest tests for the exclusion logic and the not-comparable reporting path.

**Explicitly out of scope:**

- **No change to the projection model.** Nothing under `src/lib/projection/` is edited. The model
  does **not** read `goals_conceded` from history — it derives expected concessions from ClubElo — so
  this bug is confined to the report's actual-side reconstruction and the projections are unaffected.
- **No change to `scripts/project-points.ts`, `scripts/emit-projections-csv.ts`,
  `scripts/build-solver-input.ts`, `scripts/store-solver-output.ts` or
  `scripts/generate-recommendations.ts`.**
- **No change to `scripts/ingest-core-insights.ts`.** Fetching a different source column, or a
  different source, is a separate ticket with its own verification — do not start it here.
- **No new database table, no migration, nothing under `supabase/`.**
- **No point-in-time backtest.** Still feature item 29, still out of scope.
- **No UI, nothing under `src/`.**
- No new npm dependency.

## Definition of done

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] Nothing under `src/` is added, changed or deleted.
- [ ] **The report states, per position, how many match rows carry a non-null and non-zero
      `goals_conceded`**, as a count and as a percentage of that position's rows.
- [ ] **A component whose source column is not reliably populated for a position is rendered as
      `not comparable` with a one-line reason, not as a number.** No ratio is printed for it.
- [ ] **Both sides of the position total exclude any not-comparable component**, and the report says
      which components were excluded from which positions. There is a named test proving the actual
      and projected totals exclude the same set.
- [ ] The report includes a **sanity check on every reconstructed rate that has a known real-world
      bound**: an implied clean-sheet rate above 60% for any position is reported as an explicit
      data-quality warning in the report body, not left for a reader to spot. *(This is the guard
      that would have caught the original bug on its first run.)*
- [ ] The corrected headline sentence states whether defenders are projected above or below
      midfielders and forwards, and whether they actually were, **on the comparable components
      only**, and names the excluded ones in the same breath.
- [ ] The report retains its existing caveats section, its per-position sample sizes, its
      component tables and its top-20 distribution tables. **Nothing is removed except numbers that
      were not meaningful.**
- [ ] **The top-20 "actual scorers" tables are corrected too, and this is not optional.** They are
      built from the same reconstruction, so every defender and midfielder total in them is inflated
      by the phantom clean sheets — Virgil at 388 points across 49 matches is 7.9 per match, which no
      defender achieves. Either recompute those totals excluding the not-comparable components, or
      **label the tables as position-internal rankings only and state in the table caption that
      totals must not be compared across positions.** A reader glancing at those tables today would
      conclude a defender outscored Haaland, which is the specific wrong inference this ticket exists
      to prevent.
- [ ] The report states in one line that **a season total is not a captaincy signal** — it rewards
      availability as much as per-match quality, and the model's own inputs are per-90 rates and
      fixture difficulty, never a season total. The top-20 actual table is a validation artefact, not
      a model input, and the report should not read as though it were a ranking to pick from.
- [ ] The report notes that **2,873 of 15,340 match rows (19%) were skipped** because their
      `player_code` is not in the current `players` table — players who left the league — and states
      that this biases the actual sample toward players still in the game. The existing provenance
      section already carries the counts; this adds the one-line interpretation.
- [ ] Every Supabase read still uses the shared pagination helper and still asserts its row count
      against an independent count.
- [ ] The job still writes exactly one `job_runs` row, `job_name = 'calibration-report'`, and still
      writes to no other table.
- [ ] `job_runs.details` carries the corrected per-position ratios **and** a flag naming any
      component excluded as not comparable.
- [ ] Scope constraint: only `scripts/calibration-report.ts`, its test file, and this ticket's own
      `decisions/ticket-<number>.md` are added or changed. Nothing under `src/`, `supabase/` or
      `.github/` changes; no other file in `scripts/` changes; `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **The diagnosis is not a hypothesis to re-derive.** The three implied clean-sheet rates in the
  Context table are computed from the report's own published numbers, and 95% is arithmetically
  impossible. Confirm what the column holds with a per-position count — that is a definition-of-done
  item — but do not spend the run re-litigating whether the finding is real.
- **Do not "fix" this by inventing a clean-sheet rate.** The corrected figures in the Context table
  used an assumed 30% to demonstrate the size of the error; they are not a substitute for data.
  **Reporting "not comparable" is the correct output.** A report that says "I cannot measure this"
  is trustworthy; one that says "0.30, probably" is not, and this file's whole job is to be
  trustworthy.
- **The projection side is not wrong and must not be adjusted.** `src/lib/projection/` derives
  expected goals conceded from ClubElo and a league baseline, never from `goals_conceded`. Check
  that for yourself before touching anything, then leave it alone.
- **Deriving team-level concessions from elsewhere is tempting and does not work yet.** `fixtures`
  holds scores only for the ingested season, which is 2026/27 and has no results. The `match_id`
  slug (`25-26-prem-arsenal-vs-chelsea`) names the teams but carries no score. Populating last
  season's results is a real option and a separate ticket — not this one.
- **The sanity-check requirement is the most valuable line in this ticket.** The original report was
  internally consistent, carried its sample sizes, listed three honest caveats, and was still wrong,
  because nothing checked a reconstructed rate against reality. Any derived rate with a known bound
  — a clean-sheet rate, an appearance rate, a probability — should be bounds-checked and the breach
  reported in the artefact. Generalise it beyond clean sheets if it is cheap.
- **What the corrected numbers mean, so the report's tone is right.** The model comes out calibrated
  within a few per cent on every position, and the top-20 tables independently agree: Raya is the
  top projected goalkeeper and was the top actual scorer, Haaland is first in both forward lists.
  **This report's job is now to say that clearly.** The earlier alarm about defenders was mine and it
  was wrong — the solver captaining a defender was a correct read of one specific squad containing
  two top-decile defenders, not a positional bias.
- **What a substitute cannot catch.** Tests prove the exclusion logic and the bounds-check fire
  correctly on fixtures. They cannot prove what the live column contains — that is what the
  per-position count is for, and it only means anything after a real run. Keshav re-runs the
  workflow and reads the artefact; that is what closes this.
