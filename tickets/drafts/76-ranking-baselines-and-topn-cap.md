## Context

**#147's ranking numbers still cannot be read, and two of its guards do not look where the problem
appears.** `LEARNINGS-second-build-wave.md` §13 and §14 record both defects; neither has been fixed,
and the 30 Aug backtest run reproduces them.

### Defect 1 — the primary number has no comparator

Season Spearman is **0.305 (n=10,474)**. Nobody can say whether that is good. #147's ticket asserted
an absolute band of 0.3–0.6, invented from general intuition about regression models and not derived
from anything about weekly FPL scoring — and because it was written into a definition of done, the
Builder, QA and the reader all treated a guess as an established fact. Predicting a single gameweek
is largely predicting who scores a goal; the ceiling may be near 0.3.

**A model that beats a naive benchmark has skill. A model that does not is decoration.** That
comparison costs almost nothing to compute and is the only thing that makes the primary number mean
anything.

### Defect 2 — a top-N metric is meaningless when N approaches the population

Goalkeeper top-20 overlap reads **696 of 698 (99.7%)**. `topNOverlap` already caps N at the
population — that part works — but a per-gameweek goalkeeper population is roughly 19, so "how many
of the top 20 are in the top 20" over 19 rows is ~100% by arithmetic. Forwards' 71.9% is the same
artefact at lower resolution. **The cap prevents an impossible number; it does not prevent a
meaningless one.**

### Defect 3 — the leak alarm is checked in one place and the artefact appears in another

The sanity bound fails the report on a top-10 overlap above 9/10. It is applied to the season
aggregate and to each position's **top-10** only. **The 99.7% figure is a top-20, and it sailed
through.** A guard written to catch exactly this shape did not look where the shape appeared.

### Unverified, and it should be treated as unverified

Defender and Midfielder report **byte-identical** overlaps — `75 of 370` and `226 of 740` — on
populations of 3,632 and 4,860. The identical *denominators* are legitimate (both positions clear 10
and 20 rows in all 37 measured gameweeks). The identical *numerators* are suspicious but
`summarizeRankingByPosition` filters correctly per position on inspection, and the same two figures
differed in the 29 Aug run (DEF 75/231, MID 82/239). **This may be coincidence. Do not write a
ticket, a test or a decisions entry that asserts it is a bug** — this ticket adds the per-gameweek
breakdown that makes it distinguishable on the next run, and nothing more.

Depends on #152 and #154, both merged. Nothing unmerged.

## Scope

**In scope:**

- **Naive ranking baselines, computed over the identical measured population**, reported beside the
  model's own Spearman at the season aggregate and per position:
  - **prior minutes per match** (`prior_minutes / prior_matches`) — "rank by who plays most"
  - **prior xG + xA per match** (`(prior_xg + prior_xa) / prior_matches`) — "rank by attacking rate"
  - **a constant ranking** — the zero-skill floor, whose Spearman must land at or near 0 and which
    therefore doubles as a self-test of the correlation code
- **A stated verdict line** naming which baselines the model beats and by how much, printed in the
  report — a difference, not a threshold.
- **Refuse a top-N figure whose N is a large fraction of its population**, applying the same
  "too small to read" discipline #147 already applies to gameweeks under 50 rows. The threshold is
  a judgement and must be marked as one.
- **The leak bound applied at every level the report prints** — season aggregate and per position,
  top-10 **and** top-20.
- **A per-gameweek × per-position top-N breakdown**, so the identical DEF/MID figures above resolve
  into "coincidence" or "defect" on the next run without anyone re-deriving it by hand.

**Explicitly out of scope:**

- **No change to anything under `src/`.** This ticket changes what the harness measures and reports,
  never the model.
- **No use of `players.now_cost` as a baseline, and this is a decision, not an omission.** Ranking by
  price is the obvious naive benchmark and it is **wrong here**: `now_cost` is the 2026/27 price of a
  player being measured on 2025/26 gameweeks — both a cross-season mismatch and a lookahead, since
  the price reflects what happened in the season being predicted. Every baseline in this ticket comes
  from `feature_history`'s strictly-before columns only.
- **No change to the measured population, the exclusions, the reconciliation, or any Supabase read.**
  The population is #154's and stays exactly as it is.
- **No change to MAE, signed error, the component table, or the defcon buckets.**
- **No re-tuning of the model in response to whatever the baselines show.**
- **No edit to `docs/projection-model-backlog.md`.** Record findings in this ticket's decisions file.
- **No new stored data, no migration.**

## Definition of done

- [ ] Three baseline rankings are computed over the same `MeasuredRow` set the model's own Spearman
      uses — no separate population, no second Supabase read.
- [ ] Each baseline's Spearman is reported at the season aggregate and per position, beside the
      model's.
- [ ] **The constant-ranking baseline's Spearman is at or near 0**, asserted by a named test. This is
      the self-test: a correlation implementation that scores a constant ranking well is broken.
- [ ] The report prints a verdict line stating, for the season aggregate, the model's Spearman minus
      each baseline's — **as a difference, never against an asserted threshold.**
- [ ] A top-N figure is reported as "too small to read" when N is a large fraction of the
      population, rather than printed. **The fraction is a judgement and the code comment says so**,
      naming what it is protecting against (a top-20 over ~19 goalkeepers).
- [ ] A named test reproduces the goalkeeper case — a 19-row population asked for a top-20 — and
      asserts it is refused, not reported as ~100%.
- [ ] The leak sanity bound is applied to **top-10 and top-20, at the season aggregate and at every
      position.** A named test asserts a 99.7% top-20 at one position fails the report.
- [ ] A per-gameweek × per-position top-N breakdown is printed.
- [ ] Every existing test passes **unmodified** except where one asserts a bound's old scope. Any
      changed expected value is computed by hand in the test's own comment, never copied from
      failing output.
- [ ] Nothing under `src/`, `supabase/`, `docs/`, `.github/`, `src/screens/`, `src/components/`,
      `scripts/lib/` or any other `scripts/*.ts` is added, changed or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests prove the statistics on constructed rankings, not
      that the live figures mean anything. The human check after merge is dispatching `Backtest` and
      reading **whether 0.305 beats the two evidence-based baselines, and by how much.** **Both
      outcomes are findings and neither should be assumed** — a model that does not beat "rank by
      who plays most" is a real and important result about this app, not a bug in this ticket.
      **What will NOT change:** MAE, signed error, the component table, the defcon buckets and the
      measured population are all untouched.

## Notes for the Analyst / Builder

**Every threshold this ticket introduces is a judgement and must be labelled as one in the code
comment** (`LEARNINGS-second-build-wave.md` §16d). #147's 0.3–0.6 band became fact purely because it
was written in a definition of done. Do not repeat that: the verdict line reports a **difference
between two measured numbers**, never a pass/fail against a number someone imagined.

**The baselines must be strictly-before, like everything else in this harness.** `prior_minutes`,
`prior_matches`, `prior_xg` and `prior_xa` are already read and already carry
`feature_history`'s strictly-before guarantee. A row with `prior_matches = 0` is already excluded
before ranking, so the division is safe — **assert that rather than guarding it defensively**, so a
future change that admits such a row fails loudly.

**Ties matter and the tie correction already exists.** The minutes-per-match baseline will produce
many ties (players on identical averages); `spearmanCorrelation`'s existing average-rank tie handling
covers this. **Add a named test for a heavily-tied baseline ranking** — it is the case this ticket
makes common and #147's tests did not.

**The DEF/MID identity is unverified.** Say so in the decisions log in those words. If the new
per-gameweek breakdown makes it obviously a defect while you are building, **report it and stop
rather than silently fixing it** — a fix outside this ticket's stated scope is a scope deviation to
flag, and the pipeline handles that correctly (`deltas.md` D10).

**This is Tier 2** — it changes an instrument whose readings are used to reason about the model, and
reports from before it are not directly comparable to reports after it. Log it as HIGH-IMPACT with
its *because*.

**One companion ticket is running in this batch**, touching `scripts/build-solver-input.ts`,
`scripts/store-squad-advisory.ts` and `docs/solver-notes.md`. This ticket touches none of them and
imports nothing from either.

## Scope constraint

Nothing outside the following files changes:

- `scripts/run-backtest.ts`, `scripts/run-backtest.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added. Nothing under `src/`, `supabase/`, `docs/`, `.github/`,
`src/screens/`, `src/components/`, `scripts/lib/` or any other `scripts/*.ts` changes. No dependency
is added, removed or upgraded. No build configuration changes.
