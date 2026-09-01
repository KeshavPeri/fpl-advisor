## Context

**The position priors every projection rests on are computed from survivors only, and the bias is
measured.**

Ticket #168 was asked to diagnose forwards' assist ratio of **0.67x** — the last component outside
±10% on the calibration report. It ruled out both hypotheses it was given, by direct measurement
against the source, and found the real cause in a file it was not allowed to touch:

> the 44 forwards dropped from the current roster since 2025/26 had **higher xA/90 (0.0728)** but
> **lower xG/90 (0.2768)** than the 51 retained — survivorship bias in
> `scripts/project-points.ts`'s current-roster join, shaped exactly right to explain why goals
> project cleanly and assists don't.

**The mechanism is one line.** `scripts/project-points.ts` builds `codeToPlayer` from the live
`players` table and then, walking `player_match_stats`, does:

```ts
const player = codeToPlayer.get(row.player_code)
if (!player) continue // this historical player_code is not among the currently-ingested players
                      // -- contributes no position prior
```

**Every historical row belonging to a player who has since left the Premier League is discarded
before the position priors are built.** The priors are therefore computed from the players who
survived into 2026/27, not from the population that actually produced the data.

**This is the same defect ticket #154 fixed in the backtest, in a different file.** #154 removed
exactly this join for position resolution and the 23% backtest exclusion vanished. `player_match_stats`
has carried its own `element_type` since #146 — **the position of a historical row is available
without asking the live roster at all.**

**Why it produces this specific signature.** The join is not a random sample: it selects for players
who kept a Premier League place. That population is systematically better at scoring and worse at
creating than the one it was drawn from, so the goal prior lands about right and the assist prior
lands low. Goals calibrate at 1.04x; forward assists at 0.67x.

Depends on #146, #148, #154, #162, #168 — all merged. Nothing unmerged.

## Scope

**In scope:**

- **Build the position priors from every qualifying `player_match_stats` row**, resolving each row's
  position from `player_match_stats.element_type` rather than from the live `players` table. A row
  whose `element_type` is null falls back to the roster lookup, and only then is skipped — counted,
  with the reason.
- **The same change for the defensive-contribution position prior**, which is built from the same
  loop and inherits the same bias.
- **Counters in `job_runs.details`**: rows contributing to the priors, rows contributing that have no
  current-roster entry (the population this ticket recovers), and rows skipped with the reason.
- **The projected output is unchanged in shape.** Only players on the current roster can be
  projected — that join stays, because a player who is not in the game cannot be transferred in. This
  ticket changes only which rows inform the *priors*.

**Explicitly out of scope:**

- **No change to anything under `src/`.** `rates.ts`, `defconRate.ts` and `expectedPoints.ts` are
  untouched — `positionPriorRates` and `positionPriorHitRate` are pure functions and this ticket
  changes what is passed to them, not what they do. **In particular, do not add or adjust any assist
  conversion factor.** #148 measured those from source; layering a second correction on top is the
  thing #168 explicitly refused to do.
- **No change to which players get a projection row**, to the CSV the solver reads, or to
  `player_projections`' shape.
- **No change to the two-stage shrinkage, `SHRINKAGE_K`, or the price prior.**
- **No change to `scripts/run-backtest.ts` or `scripts/ingest-core-insights.ts`.** Both are owned by
  other tickets in this batch.
- **No new stored column, no migration.**
- **No edit to `docs/projection-model-backlog.md`.**

## Definition of done

- [ ] Position priors are built from rows resolved via `player_match_stats.element_type`, with the
      roster lookup used only as a fallback for a null. Grep-checkable: the prior-building loop no
      longer skips a row solely because its `player_code` is absent from the live roster.
- [ ] A named test proves a historical row for a player **not** on the current roster now contributes
      to its position's prior, and did not before.
- [ ] A row with neither a stored `element_type` nor a roster entry is skipped, counted, and reported
      with its reason. The counters reconcile arithmetically against rows read.
- [ ] **The set of players receiving a projection row is unchanged.** A named test asserts the
      projected population still comes from the current roster only. **This is the item that stops
      the ticket leaking into the solver's player pool.**
- [ ] Nothing under `src/` changes. Grep-checkable.
- [ ] Every existing test passes **unmodified** except those asserting the old skip behaviour.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests prove the priors now include the recovered rows,
      not that the resulting projections are better. The human check after merge is running
      `Scheduled jobs`, then dispatching `Calibration report` and confirming **forward assists move
      from 0.67x toward 1.00x.** **Two things that must be watched and are not automatically good:**
      **(1)** goals currently calibrate near 1.04x across positions and should stay there — if goals
      drift while assists improve, the prior moved further than intended; **(2)** every position's
      prior changes, not just forwards, so defender and midfielder ratios will move a little. **A
      small movement in every component is expected; a large movement in one is a finding.**

## Notes for the Analyst / Builder

**#168's numbers are the evidence and they were measured, not estimated** — reconstructed from
FPL-Core-Insights over both ingested seasons with the same Premier-League-only filter #148 and #162
used, reproducing the calibration report's own population sizes. Copy them into the decisions file;
do not re-derive them.

**This is the fifth instance of "fixing the instance is not fixing the class"**
(`LEARNINGS-second-build-wave.md` §4, §12). The lesson that historical data must never be joined to
the live roster has now been learned for the FK (#22), for teams (#32), for backtest position (#154)
— and here it is again in the projection job, in a line whose comment states the behaviour plainly
and calls it expected. **Say so in the decisions file.** The generalisable question — *where else does
this repo still join historical rows to a current-season table?* — is worth a repo-wide sweep, and
that sweep is out of scope here.

**The current-roster join is not wrong everywhere, and that is the subtlety.** Projecting a player
requires him to exist in the game today; building a prior does not. The ticket separates those two
uses of the same map. **If a third use turns up while you are in the file, flag it rather than
changing it.**

**Do not chase the 0.67x figure with a constant.** If the recovered priors do not close the gap, that
is a finding for the next ticket, and the decisions file should say so plainly rather than reaching
for a correction factor.

**This is Tier 2** — it changes the priors every projection and therefore every recommendation rests
on. Log it as HIGH-IMPACT with its *because*, including #168's measured figures.

**Two other tickets are running in this batch**, owning `scripts/run-backtest.ts` and
`scripts/ingest-core-insights.ts`. This ticket touches neither, and changes nothing under `src/` that
either could consume.

## Scope constraint

Nothing outside the following files changes:

- `scripts/project-points.ts`, `scripts/project-points.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added. Nothing under `src/`, `supabase/`, `docs/`, `.github/`, `scripts/lib/` or
any other `scripts/*.ts` changes. No dependency is added, removed or upgraded. No build configuration
changes.
