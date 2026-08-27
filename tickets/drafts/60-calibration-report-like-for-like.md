## Context

**The calibration report is the instrument built to settle whether the model over-projects
defenders, and ticket #78 quietly broke it.**

The report compares projected points against actual points reconstructed from
`player_match_stats`. Its own text tells the reader why that comparison is fair:

> **Neither side includes bonus or cards.** `player_match_stats` carries neither, so the actual
> figures below are an under-count. … **The projected side is compared on the same basis** —
> `src/lib/projection/expectedPoints.ts` hardcodes bonusPoints to 0 too — so this is like-for-like,
> not a thumb on the scale.

**That sentence is now false.** #78 added a bonus projection, so the projected side includes bonus
and the actual side still cannot. Every comparison the report makes is now biased **against** the
model by roughly the size of the bonus term, concentrated exactly where it matters most — the
players at the top of the distribution, who are the subject of the Top-20 tables and of the whole
defender question.

**And it cannot be fixed by improving the actuals side.** Verified at ticket-writing time by
fetching the source CSV header from FPL-Core-Insights: **there is no `bonus` column and no `bps`
column.** Per-match bonus is not available from this source at all, so the actual side can never
include it. **This is a settled fact, not an open question** — record it so nobody investigates it
again.

**Why this matters beyond tidiness.** `LEARNINGS-second-build-wave.md` §3 records that this exact
report has already been wrong once, in the opposite direction, and that acting on it would have sent
three tickets chasing a problem that did not exist:

> A measuring instrument can be wrong, and it is the most expensive kind of wrong.

G7 in `docs/projection-model-backlog.md` names a re-run of this report as one of the two artefacts
that would settle the defender-versus-forward question. **Re-running it as it stands would produce a
confidently wrong answer.**

Depends on #78 (merged). Nothing unmerged.

## Scope

**In scope:**

- **Restore like-for-like by excluding bonus from the projected side, inside the report only.** The
  report reads `player_projections.components`, which carries `bonusPoints` as its own named
  component; subtract it when building the projected figure the report compares.
- **The stored projection is not altered.** Nothing writes to `player_projections`. This is a
  reporting decision, not a modelling one.
- **The report states both figures.** Alongside each projected total it reports the bonus that was
  excluded, so the reader can see the size of what is being set aside rather than taking the
  adjustment on trust.
- **The caveat text is rewritten to be true**, stating: that the projected side now models bonus but
  the comparison excludes it; that the actual side cannot include it because the source has no
  bonus column, verified; and what that means for reading the Top-20 tables.
- **A headline bound.** The excluded bonus per player-appearance should sit near the arithmetic
  maximum of 6 points shared across a match. If the mean excluded bonus among measured players falls
  outside **0.05 to 1.00**, the report says so prominently rather than proceeding — an instrument
  that cannot bound its own adjustment is not one to trust.
- **`docs/projection-model-backlog.md` updated**: G3 records that bonus is now modelled but cannot be
  validated against per-match actuals from this source, with the verification noted; G7 records that
  the calibration re-run is now meaningful again and remains the outstanding artefact.

**Explicitly out of scope:**

- **No change to the projection model, the bonus allocation, or anything under `src/`.**
- **No change to `player_projections` or any stored value.** Report-side only.
- **No new data source, and no attempt to obtain bonus from anywhere.** Verified absent from this
  source; sourcing it elsewhere is a Tier 2 data-source decision and a whole ticket of verification.
- **No re-running of the report as part of this ticket**, and **no conclusion drawn about defenders
  versus forwards.** That is a human reading of the output, after merge. Writing a verdict into the
  code would be exactly the failure §3 records.
- **No change to the report's structure, its sections, its workflow or its dispatch-only schedule.**
- **No change to any other check, job or script.**
- No migration, no UI.

## Definition of done

- [ ] The projected figure the report compares excludes `components.points.bonusPoints`. Named unit
      test asserting a projection of 5.79 with 0.22 bonus is compared as 5.57.
- [ ] A projection whose components carry no `bonusPoints` key is treated as zero bonus and compared
      unchanged. Named test. *(Rows written before #78 have no bonus and must not be dropped or
      error.)*
- [ ] Nothing writes to `player_projections`. Grep-checkable: no `upsert`, `insert` or `update` call
      against that table appears in `scripts/calibration-report.ts`.
- [ ] The report prints the excluded bonus alongside each projected total it reports.
- [ ] The obsolete "compared on the same basis … hardcodes bonusPoints to 0 too" text is gone.
      Grep-checkable: the string `hardcodes bonusPoints to 0` does not appear in the file.
- [ ] The replacement text states all three facts named in Scope, including that the source carries
      no bonus column.
- [ ] The mean excluded bonus is computed and reported, and a value outside 0.05–1.00 produces a
      prominent warning in the report rather than a silent pass. Named tests at both bounds.
- [ ] The report's existing sections, headings and ordering are unchanged. Every existing test in
      `scripts/calibration-report.test.ts` that does not concern the bonus adjustment passes
      **unmodified**.
- [ ] The existing assertion that the source does not reference `team_goals_conceded` is **left
      alone** — another ticket in this batch owns that column, and this report is deliberately not
      changing what it reads from `player_match_stats`.
- [ ] G3 and G7 in `docs/projection-model-backlog.md` are updated as described in Scope.
- [ ] Nothing under `src/`, `supabase/` or `.github/` is added, changed or deleted, and no file under
      `scripts/` other than `calibration-report.ts` and its test changes. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** every test runs on constructed rows, so nothing proves the
      report's conclusion about defenders is now correct — only that the comparison is fair. The
      human check after merge is dispatching `Calibration report`, reading the headline, and
      **checking its numbers against reality before believing it**: a mean absolute error near zero,
      or a defender bias above 50%, is the instrument being wrong again rather than a discovery.

## Notes for the Analyst / Builder

**Why subtract from the projected side rather than add to the actual side, as its *because*.**
**Because** the actual side cannot have bonus — the source does not carry it, verified — the only
way to make the two comparable is to remove it from the side that has it. Removing a term we can
measure is honest; estimating one we cannot would be inventing the very thing the report exists to
check.

**Verified at ticket-writing time, not recalled.** The header of
`data/2025-2026/By Gameweek/GW1/playermatchstats.csv` in FPL-Core-Insights was fetched on 28 August
2026. It carries `goals_conceded`, `team_goals_conceded`, `saves`, `xg`, `xa`, `tackles`,
`interceptions`, `recoveries`, `blocks`, `clearances`, `defensive_contributions` and much else — and
**no `bonus`, and no `bps`**. Record this in the decisions log and in G3.

**Do not draw the conclusion in the code.** The report's job is to produce a number with its
caveats; the defender question is answered by a person reading it. A report that says "defenders are
over-projected by 45%" was already wrong once, was internally consistent, carried its sample sizes,
listed three honest caveats, and would have sent three tickets chasing nothing.

**Bound every derived figure.** The bonus adjustment has a known arithmetic ceiling — six points per
match shared among the players who appear. That is what makes 0.05–1.00 a real bound rather than a
guess, and it is the practice `LEARNINGS-second-build-wave.md` §2 ranks alongside counters in
`job_runs.details`.

**Reporting "not comparable" is a legitimate output.** If the bound fires, the right behaviour is to
say the comparison cannot be trusted, loudly, in the report itself — not to proceed with a caveat
buried in a footnote.

**This is Tier 2** — it changes what a decision-supporting instrument measures. Log it as
HIGH-IMPACT with its *because*.

**Two other tickets may be running in this batch.** One owns `scripts/ingest-core-insights.ts`,
`scripts/build-feature-history.ts`, a new migration and `supabase/README.md`; the other owns
`scripts/project-points.ts` and `scripts/emit-projections-csv.ts`. This ticket touches neither —
**this ticket owns `docs/projection-model-backlog.md` for this batch**, and the others are instructed
not to edit it.

## Scope constraint

Nothing outside the following files changes:

- `scripts/calibration-report.ts`, `scripts/calibration-report.test.ts`
- `docs/projection-model-backlog.md`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/` changes. No workflow file is touched.
Nothing under `src/` changes. `scripts/project-points.ts`, `scripts/emit-projections-csv.ts`,
`scripts/ingest-core-insights.ts`, `scripts/build-feature-history.ts` and `docs/solver-notes.md` are
not modified.
