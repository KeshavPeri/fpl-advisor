## Context

**G2 in `docs/projection-model-backlog.md`, narrowed by ticket #113 and still open for the players it
does not reach.**

#113 made the model use this season's form with last season as the prior, which fixes the largest
population — players like Muharemović who have played this season and were invisible because the
ingest pointed at last season only. **It does nothing for a player with no Premier League minutes at
either level**: a summer signing from abroad, or a promoted club's player who has not featured yet.
Those still fall back to a bare position average, and the backlog states the consequence plainly:

> A genuinely good new signing gets an average projection instead of a good one, so **the model will
> not recommend him**, and cannot, until he has played enough Premier League minutes to build a rate.

**The signal we already have and do not use.** `players.now_cost` is FPL's own analysts pricing a
player by expected returns. A £9.0m midfielder and a £4.5m midfielder are not equally likely to
return, and FPL said so before a ball was kicked. The backlog names this as the middle option of
three, above "surface it rather than model it" (done, #79) and below "ingest non-Premier-League
history" (out of scope, a Tier 2 data-source decision).

**Explainable in one sentence, which `product-brief.md` §6d requires of every model input:** *a
player we know nothing about is assumed to be as good as his price says, relative to others in his
position.*

Depends on #113 (merged). Nothing unmerged.

## Scope

**In scope:**

- **A new pure function in `src/lib/projection/rates.ts`** that adjusts a position prior by a
  player's price relative to the median price for his position, returning adjusted per-90 rates.
- **It applies to `xgPer90` and `xaPer90` only.** Saves, CBI and recoveries are left at the position
  prior — see Notes for why.
- **It applies only when the player has zero minutes at both levels** — no current-season and no
  historical rows. A player with any real minutes is unaffected, at either stage of #113's two-stage
  shrinkage.
- **The scale factor is `now_cost / positionMedianCost`, clamped to `[0.6, 1.8]`.** Both bounds are
  pre-answered in Notes.
- **`scripts/project-points.ts` computes the median `now_cost` per position** from the live
  `players` table and passes it in. **Nothing is hardcoded** — same rule `positionPriorRates`
  already follows.
- **Counters in `job_runs.details`**: players receiving the price-adjusted prior, and of those, how
  many were scaled up versus down. The first must equal #113's existing "players with neither"
  counter.
- **`docs/projection-model-backlog.md` G2 updated** — marked as addressed for the xG/xA half, with
  what remains (minutes, defensive volume, and the fact that no calibration exists behind the
  bounds) stated plainly.

**Explicitly out of scope:**

- **No change to any player who has actually played.** Grep-checkable in the tests: a player with
  minutes at either level projects byte-for-byte as today.
- **No change to `computePlayerRates` or `computeTwoStagePlayerRates`.** The adjustment happens to
  the position prior before it enters stage one, not inside the shrinkage.
- **No change to the minutes model.** Price also signals whether a player starts, and
  `src/lib/projection/minutes.ts` is where that would live. **That is a separate ticket** — this one
  touches rates only.
- **No new external data source and no new ingested column.** `players.now_cost` is already
  ingested by `scripts/ingest-fpl.ts`.
- **No price-change prediction.** Explicitly out of scope in `product-brief.md` §3 — FPL ships its
  own predictor. This reads today's price as a static signal, nothing more.
- **No migration, no UI, nothing under `supabase/` or `src/screens/`.**
- **No change to `expectedPoints.ts`, `fixture.ts`, `defconRate.ts`, `bonus.ts` or anything under
  `src/lib/scoring/`.**

## Definition of done

- [ ] The new function lives in `src/lib/projection/rates.ts`, is pure, and is exported. The strings
      `supabase`, `fetch` and `process.env` appear nowhere in that file.
- [ ] **A player with any minutes at either level projects identically to today.** A unit test
      asserts equality to the last decimal for a current-season-only player, a historical-only
      player, and a player with both. *(This is the ticket's most important test: the change must be
      a no-op for everyone the model already has evidence about.)*
- [ ] A no-history player priced at exactly the position median receives the unadjusted position
      prior. Named test. *(The median case must be a no-op, or this becomes a silent global
      recalibration of every unknown player.)*
- [ ] A no-history player priced at twice the position median receives `1.8×` the prior's xG and xA —
      the clamp, not `2.0×`. Named test at the clamp.
- [ ] A no-history player priced at half the median receives `0.6×`. Named test at the lower clamp.
- [ ] `savesPer90`, `cbiPer90` and `recoveriesPer90` are **unchanged** by the adjustment in every
      case. Named test.
- [ ] A position with no players, or a median of zero, returns the unadjusted prior rather than
      dividing by zero. Named test.
- [ ] The position medians are computed from the live `players` table in `project-points.ts`, with
      no numeric literal for any price. Grep-checkable.
- [ ] `job_runs.details` carries the two new counters, and the price-adjusted count equals the
      existing "players with neither" counter exactly. Asserted arithmetically in a test.
- [ ] G2 in `docs/projection-model-backlog.md` is updated as described in Scope.
- [ ] Nothing under `supabase/`, `.github/`, `src/screens/` or `src/components/` is added, changed or
      deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** every test is arithmetic on constructed inputs. **Nothing
      here shows a price-adjusted estimate is closer to reality than a flat one** — that needs the
      backtest, which does not exist yet. The human check after merge is reading the counters, then
      looking at whether an expensive new signing now appears in the solver's transfer options at
      all, where before he could not.

## Notes for the Analyst / Builder

**Why the bounds are 0.6 and 1.8, stated as a *because*.** The price signal is real but weak: FPL
prices on expected returns, and it is right about the ordering far more often than it is right about
the magnitude. **Because** an unclamped ratio would hand a £15m striker three times the position
prior on no evidence at all — manufacturing exactly the false confidence `product-brief.md` §8
forbids — the bounds keep the adjustment to a nudge. They are a deliberate under-correction, not a
calibration, and the backlog entry must say so. **If a Builder finds itself wanting a different
number, that is a measurement question and it belongs to the backtest, not to this ticket.**

**Why xG and xA only.** Price signals attacking expectation, which is what those two measure. It
says very little about how many clearances a defender makes or how many saves a keeper faces — those
are functions of his team's shape and the fixture, not his transfer fee. Adjusting them would import
noise dressed as signal.

**Why the median and not the mean.** A handful of £14m forwards drag a mean upward and would make
every ordinary player look cheap, which would scale most unknown players *down*. The median is the
typical player at that position, which is what "relative to others in his position" actually means.

**This must not double-count with #113's shrinkage.** The adjustment replaces the position prior for
a player with no evidence; the moment he has minutes, shrinkage moves him toward his own numbers and
the prior's influence fades on its own. Do not apply it inside either shrinkage stage, and do not
apply it to a player who has any minutes.

**Read `src/lib/projection/rates.ts`'s header before writing anything.** #113 documented the
two-stage rule and why a fixed percentage was rejected; this ticket sits one layer beneath it and
must not disturb it.

**This is Tier 2** — it changes the projection model every recommendation rests on. Log it as
HIGH-IMPACT with its *because*.

**Two other tickets may be running in this batch.** One owns `scripts/build-solver-input.ts` and
`docs/solver-notes.md`; the other adds a new migration and a new script under `scripts/`. This ticket
touches neither.

## Scope constraint

Nothing outside the following files changes:

- `src/lib/projection/rates.ts`, `src/lib/projection/rates.test.ts`
- `scripts/project-points.ts`, `scripts/project-points.test.ts`
- `docs/projection-model-backlog.md`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/` changes. No workflow file is touched.
`scripts/build-solver-input.ts`, `src/lib/projection/expectedPoints.ts`,
`src/lib/projection/minutes.ts`, `src/lib/projection/defconRate.ts`, `src/lib/projection/bonus.ts`,
`src/lib/projection/fixture.ts`, everything under `src/lib/scoring/`, `src/screens/` and
`src/components/`, and `docs/solver-notes.md` are not modified.
