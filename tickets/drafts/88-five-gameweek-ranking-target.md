## Context

**The app plans over five gameweeks and measures over one, and the review showed that is the wrong
thing to measure.**

`scripts/build-solver-input.ts` sets a five-gameweek horizon, `decay_base` discounts across it, and
`ft_value_list` prices a banked transfer against it. Every recommendation the app makes is a
five-gameweek judgement. **The backtest measures a single gameweek.**

`docs/model-review-2026-09-02.md` built a **quality oracle** to establish the ceiling: for each
player it estimates quality from that player's actual results in every gameweek *except* the one
being predicted, then ranks on it. It knows exactly how good everyone is and still cannot see the
specific week — so it is the best score any model could reach, and everything below it is luck.

| Horizon | Model | Oracle ceiling | Gap |
|---|---|---|---|
| 1 gameweek | **0.323** | **0.332** | 0.009 |
| 5 gameweeks | **0.425** | **0.485** | **0.060** |

**On a single gameweek the model is at roughly 85–90% of what is achievable — there is almost nothing
left to win.** On five gameweeks the gap is nearly seven times larger, and it is widest at forwards
(~0.13). **All of the remaining headroom in this project is on a horizon the instrument does not
report.**

Depends on #147, #159, #175 — all merged. Nothing unmerged.

## Scope

**In scope, all of it additive:**

- **A five-gameweek ranking section**, alongside the existing single-gameweek one: for each measured
  (player, starting gameweek), sum **actual** points across that gameweek and the next four, sum
  **projected** points across the same, and report Spearman and top-N overlap — season aggregate, per
  position, and per starting gameweek, on the same grid the single-gameweek section already uses.
- **The same three naive baselines** (`prior minutes per match`, `prior xG+xA per match`, constant)
  computed on the five-gameweek target, so the new figure has a comparator from the moment it exists.
- **A quality-oracle row**, constructed exactly as the review describes: each player's quality
  estimated from his actual results in every gameweek **outside the target window**, then ranked.
  Reported for both horizons and at every position. **Labelled, in the report itself, as a ceiling
  computed with hindsight — not a model, never a target to tune toward.**
- **Explicit handling of truncated windows.** Gameweeks 35–38 have fewer than five gameweeks ahead.
  Decide whether they are excluded or reported on a shorter window, state which in the report, and
  count them either way.
- **Population reporting**: how many (player, starting gameweek) pairs the five-gameweek section
  measures, and how that reconciles against the single-gameweek population.

**Explicitly out of scope:**

- **Every existing figure stays exactly as it is.** MAE, signed error, by position, by gameweek,
  components, defcon buckets, the single-gameweek ranking section and its baselines are all
  **unchanged in construction and in value.** Another ticket in this batch changes the model, and it
  must remain judgeable on the metric it was written against.
- **No change to the measured population, the exclusions or the reconciliation.**
- **No change to anything under `src/`.**
- **No reading of `feature_history.prior_recent_minutes`.** That column is being added by another
  ticket in this batch, is not yet applied to live Supabase, and its consumer is the next batch.
  **Do not anticipate it.**
- **No change to `scripts/build-feature-history.ts`, `project-points.ts` or `ingest-core-insights.ts`.**
- **No new stored column, no migration, no new Supabase read.**
- **No tuning of anything in response to the new numbers**, and **no sanity bound derived from the
  oracle.** The oracle is a measurement, not a threshold.
- **No edit to `docs/projection-model-backlog.md`.**

## Definition of done

- [ ] The five-gameweek section reports Spearman and top-N overlap at the season aggregate, per
      position, and per starting gameweek, with the same "too small to read" gating the
      single-gameweek section applies.
- [ ] All three naive baselines are computed on the five-gameweek target, and the report states the
      model's figure minus each baseline's — **a difference, never checked against an asserted
      threshold** (`LEARNINGS-second-build-wave.md` §13).
- [ ] The oracle is computed leaving out the entire target window, and a **named test proves no
      gameweek inside the window contributes to its own estimate.** **This is the most important test
      in the ticket** — an oracle that peeks is not a ceiling, it is a leak, and it would look like a
      spectacular result.
- [ ] The oracle's constant-ranking self-test still holds: a constant ranking scores 0 on the
      five-gameweek target too. Named test.
- [ ] The report labels the oracle, in its own prose, as a hindsight ceiling and states that no model
      can be expected to reach it and nothing should be tuned toward it.
- [ ] Truncated end-of-season windows are handled by a stated rule, counted, and reported.
- [ ] **Every existing figure in the report is byte-identical** for the same input. A test asserts the
      single-gameweek section is unchanged. **The second most important item here** — the companion
      model ticket is judged on those numbers.
- [ ] The five-gameweek population is reported and reconciles against the single-gameweek one.
- [ ] Every existing test passes **unmodified**.
- [ ] Nothing under `src/`, `supabase/`, `docs/`, `.github/`, `scripts/lib/` or any other
      `scripts/*.ts` is added, changed or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests prove the statistics and the leave-out guarantee
      on constructed rankings, not that the live figures are meaningful. The human check after merge
      is dispatching `Backtest` and reading **the five-gameweek Spearman against its three baselines
      and against the oracle**, which the review predicts at roughly 0.425 model against 0.485 oracle.
      **A model figure materially above the oracle is a leak, not a triumph, and should be treated as
      a failure of this ticket.** **What will NOT change:** every single-gameweek number, including
      the headline MAE and the 0.323 Spearman.

## Notes for the Analyst / Builder

**This ticket adds a measurement; it does not replace one.** The single-gameweek section stays
because the companion model ticket in this batch is written against it. Once both have landed and
been read, deciding which horizon is the project's primary metric is a conversation, not a code
change.

**The oracle is the delicate part.** It uses actual outcomes, which is hindsight — legitimate for a
ceiling, catastrophic if the leave-out is wrong by even one gameweek. Build the leave-out first, test
it first, and make the test name say what it protects.

**Five gameweeks means five projections, not one multiplied.** The projected side must sum the
model's own per-gameweek projections across the window, each built from that gameweek's own
strictly-before feature history. **Do not project once and multiply by five** — that would remove
exactly the fixture variation across the window that makes the five-gameweek target interesting.

**Baselines get the same treatment as the target.** "Prior minutes per match" for a five-gameweek
window means the same prior quantity ranked against the five-gameweek actual total — the ranking rule
does not change, only what it is scored against.

**This is Tier 2** — it introduces the metric this project's remaining work will be judged on. Log it
as HIGH-IMPACT with its *because*, and record that the single-gameweek metric is now known to be near
its ceiling, so it should no longer be the primary number anyone reads.

**Two other tickets are running in this batch**, owning `src/lib/projection/fixture.ts` and
`scripts/build-feature-history.ts` plus a migration. This ticket touches neither. **The
`fixture.ts` change will move this report's numbers when both land — that is expected**, and the
decisions file should note that the first run after this batch reflects both tickets, so neither is
individually attributable from that run alone.

## Scope constraint

Nothing outside the following files changes:

- `scripts/run-backtest.ts`, `scripts/run-backtest.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added. Nothing under `src/`, `supabase/`, `docs/`, `.github/`, `scripts/lib/` or
any other `scripts/*.ts` changes. No dependency is added, removed or upgraded. No build configuration
changes.
