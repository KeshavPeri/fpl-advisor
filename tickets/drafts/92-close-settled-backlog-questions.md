## Context

**Three questions in `docs/projection-model-backlog.md` are recorded as open. All three were
settled by evidence already in the repo, and none of the three entries says so.** Two further
findings from the 2 September model review have no backlog entry at all. The cost of leaving this
is concrete and has already been paid once this wave: a ticket written against a settled question
spends a night measuring something the repo already knows, and a finding with no entry gets
re-derived from scratch by the next reader.

This is `docs/model-review-2026-09-02.md`'s **R5**, verbatim in intent: *"Close three open
questions in the backlog from evidence already in hand, one small documentation ticket ... Cheap,
and it prevents three future tickets being written against settled questions."*

**No code changes. No model changes. No new measurement.** Every figure this ticket records is
quoted from a report or a review already in the repository, and the ticket names the source for
each one. If the Builder finds itself computing a number rather than copying one, it has
misread the scope — stop and report instead.

### What is settled and unrecorded

**1. G10's second open question — defensive contribution — is CLOSED as cold start.** G10 (line
~473) sets out two competing explanations for defcon's signed error (a "cold-start" explanation,
where the estimator is correctly cautious with little evidence and converges as `prior_matches`
rises, and a "level" explanation, where the shrinkage formula or `k = 5` is miscalibrated) and
explicitly defers the verdict to a live run's bucket table. That run has happened. Backtest report
7's by-`prior_matches` defcon signed error reads:

| prior_matches bucket | 1–4 | 5–9 | 10–19 | 20+ |
|---|---|---|---|---|
| defcon signed error | −0.057 | −0.059 | −0.045 | **+0.006** |

A gap that closes to approximately zero as evidence accumulates is the cold-start explanation, not
the level one. G10's own stated test — *"a shrinking gap across rising buckets points at cold
start; a flat gap points at a level problem"* — is therefore answered. G10's standing instruction
**"do NOT tune `k`, the shrinkage formula, or any constant in `defconRate.ts`"** now holds for a
stronger reason than caution: the estimator is behaving correctly, and `k = 5` is confirmed as not
the problem.

One caveat that must be recorded alongside the verdict, or the numbers above look better than
their history: report 7's defcon figures are only readable because ticket **#154** first fixed the
*harness's* own defcon artefact (`buildDefconMatches` returned a single averaged match, capping a
player's own evidence at 1 against `k = 5` forever, which made `n` structurally 0 or 1 and the
overall defcon error read −0.191). The bucket table above measures the model. The earlier figures
measured the instrument. Do not present the improvement from −0.191 to −0.035 as a model gain.

**2. G8 — "Fixture sensitivity may be too narrow" — is ANSWERED IN REVERSE.** The review's §1b
bucket table (n=698 resolvable 2025-26 team-matches) shows the model's response to fixture
difficulty is too *wide*, not too narrow, on both sides of the ball: on goals the model's implied
slope is 2.9 per unit of `expectedScore` against a measured ≈1.43, and on clean sheets the model
spans 11%→48% across the extreme buckets against an actual 9%→39%. Ticket **#184** damped the
attacking half (`attackingMultiplier` from `2 × es` to `0.5 + es`). The defensive half is
untouched — see G12 below. G8 should be marked answered, with its conclusion inverted and the
attacking half marked addressed by #184.

**3. The forward-assist chase is CLOSED — 0.70x is expected, not actionable.** Calibration report
6 reads forward assists at 0.70x *after* #148, #168 and #177, and three hypotheses have now been
raised and refuted against it. The explanation is the instrument's design, not a model defect:
that report compares the 2026/27 roster's projections against the 2025/26 population's actuals,
and #168 measured the difference between those two populations to be precisely assist-shaped
(departed forwards xA/90 **0.073**; retained forwards **0.055**). A cross-population
distributional comparison cannot resolve a within-position component level below roster-churn
size. The better instrument — the backtest, which is paired point-in-time — puts the whole assist
component's signed error at **−0.020 points per row**. The construction itself was also tested and
stands: predicting assists from shrunk actual assist rates instead of xA gains nothing (season
Spearman 0.325 vs 0.326). Record that 0.70x on that report is expected and the workstream is
closed.

### What has no entry at all

**4. G12 (new) — the defensive multiplier overshoots symmetrically and must not be damped without
its own in-harness measurement.** The same §1b bucket table that justified #184 shows
`expectedGoalsConceded` / `defensiveMultiplier` overshooting the same way the attacking side did.
It was deliberately left alone, and the reason needs recording so that a future reader does not
treat #184's derivation as transferable: goalkeeper and defender ranking is this model's clearest
win and depends on that spread — a neutral-fixture variant collapses GK Spearman from **0.168 to
−0.017** — and the empirical clean-sheet curve is steeper than Poisson-with-damped-λ, so damping λ
and keeping `pCleanSheet = exp(−λ)` would not simply narrow the response, it would change its
shape. `src/lib/projection/fixture.ts`'s own comment on `ATTACKING_MULTIPLIER_OFFSET` already
carries the warning ("Do not extend this reasoning to `defensiveMultiplier` without its own
separate measurement and ticket"); the backlog should carry the matching entry, so the question is
findable from the backlog and not only from a source comment.

What would settle it, recorded as the entry's own next step: an in-harness variant sweep over the
defensive slope in `scripts/run-backtest.ts`, read on GK and DEF Spearman and on clean-sheet
calibration, not on MAE alone. **That work conflicts with any ticket editing
`scripts/run-backtest.ts` and must not be batched alongside one.**

**5. G13 (new) — the 5-gameweek quality oracle was mis-specified, and the specification defect is
the lesson.** The oracle in ticket #183 was specified as "quality estimated from actual results
outside the target window" without requiring that the estimate be expressed in the *target's own
units*. The result: a per-match rate oracle scored against a totals target, which produced the
impossible-looking ordering **model 0.672 > oracle 0.507** — an oracle that knows the answer
scoring below the model it is meant to bound. The number was never a model finding; it was the
metric being wrong. The review's independent reconstruction of the same comparison reads model
0.425 against oracle 0.485, which is the expected ordering. Ticket **#89** reconciles the two
constructions and fixes the oracle to estimate a total (out-of-window points-per-match ×
out-of-window appearance rate). Record the defect, the two figure pairs, and the general form: **a
bound is only a bound if it is computed in the same units as the thing it bounds.**

## Scope

`docs/projection-model-backlog.md` only.

1. **G10** — add a subsection closing question 2 with the bucket table above, the cold-start
   verdict, the standing "do not tune `k`" instruction restated with its now-stronger basis, and
   the #154 instrument caveat. Do not rewrite G10's existing text; append the verdict beneath it
   so the reasoning that produced the diagnostic stays readable.
2. **G8** — mark answered, inverted. State the measured slopes (model 2.9 vs measured ≈1.43) and
   the clean-sheet spans (model 11%→48% vs actual 9%→39%), mark the attacking half addressed by
   #184, and cross-reference G12 for the defensive half.
3. **The forward-assist entry** — record 0.70x on calibration report 6 as expected and not
   actionable, with the population figures (0.073 vs 0.055 xA/90), the backtest's −0.020 signed
   error, and the refuted alternative construction (0.325 vs 0.326). If no standing entry covers
   the assist workstream, add one; do not attach this to an unrelated G-item.
4. **G12** — new entry, defensive multiplier unmeasured. Include the GK collapse figure (0.168 →
   −0.017), the clean-sheet-curve-shape reason, the pointer to the `fixture.ts` comment, and the
   stated next step plus its batching conflict.
5. **G13** — new entry, oracle mis-specification. Include both figure pairs (0.672/0.507 and
   0.425/0.485), the cause, the pointer to #89, and the general rule.

Follow the file's existing conventions exactly: `## Gn — <title>` headings, a status marker in the
heading where the file already uses one (`ADDRESSED by ticket #nn, <date>` / `OPEN`), the
`---` separators between entries, and dates in the `2 Sept 2026` form the file already uses.

## Definition of done

- [ ] `docs/projection-model-backlog.md` contains all five changes above.
- [ ] Every figure in the new text is traceable to a named source in the repository — backtest
      report 7, calibration report 6, `docs/model-review-2026-09-02.md`, or a numbered ticket —
      and the text names that source at the point of use. **A figure that cannot be traced must be
      omitted, not approximated.**
- [ ] No file outside `docs/` is modified. `git diff --name-only` against the base branch lists
      exactly one path.
- [ ] G8, G10's question 2, and the forward-assist question are each unambiguously marked settled,
      such that a reader scanning headings alone can see they are closed without reading the body.
- [ ] G12 and G13 exist as their own numbered entries, in file order after G11.
- [ ] The existing G1–G11 bodies are unchanged except for the appended G10 verdict and the G8
      status change. `git diff` shows no reflowing, renumbering or reformatting of untouched
      entries.
- [ ] The `#154` instrument caveat appears in the G10 verdict, so the −0.191 → −0.035 improvement
      is not readable as a model gain.

## Notes for the Analyst / Builder

**This ticket has no tests and needs none** — it changes no executable code. Do not add a test that
asserts on documentation text; do not add a lint rule for the backlog file. If the repo's checks
require a test file to exist for a changed path, that is a signal the scope is wrong, not a reason
to write one.

**Do not draw new conclusions.** Every verdict here is already reached in a source document. The
Builder's job is transcription with attribution, not analysis. In particular: do not extend the
cold-start verdict to any other shrunk estimator, do not propose a defensive-multiplier value, and
do not recommend a `k` or `SHRINKAGE_K` change anywhere in the new text.

**The instrument-vs-model distinction is the through-line of four of these five entries** (G10's
#154 caveat, G8's inversion, the assist closure, G13's oracle). Where the entry is about the
instrument being wrong, say so in those words. This wave has repeatedly spent nights chasing model
defects that were measurement defects, and the backlog is the only place that pattern accumulates
where the next reader will find it.

**Length is not the goal.** These are five entries in an existing document, not a report. The
existing G-items run 20–60 lines each; match that. An entry that restates the review at length is
worse than one that states the verdict, the figures and the source.

## Scope constraint

Modify **only** `docs/projection-model-backlog.md`.

Do not modify any file under `src/`, `scripts/`, `supabase/`, `.github/`, or `tickets/`. Do not
modify `docs/model-review-2026-09-02.md`, `docs/ui-audit-2026-08-31.md`, `docs/my-ui-problems.md`,
`docs/solver-notes.md`, or anything under `docs/reports/`. Do not add any new file.

This batch runs alongside tickets editing `scripts/run-backtest.ts` and
`src/lib/projection/minutes.ts`. This ticket touches neither, and must not — including to "keep a
comment in sync" with what it records here.
