## Context

Ticket #219's penalty-duty diagnostic ran and **its method failed**, which is a useful result. It
identified takers by looking for players whose goals persistently exceeded their xG, and produced a
list of twenty that includes Romero, Mount, Madueke, Doku and Dorgu — none of whom take penalties.
Its own two cross-checks refuted it: **0 of 20** flagged players have a missed penalty on record in
`players.penalties_missed`, and **0 of 8** measured gameweeks had a flagged player as the
top-projected player. The residual measured finishing variance and small samples, not penalty duty.

The same diagnostic answered the question that matters: **FPL's own `bootstrap-static` publishes
`penalties_order`, and it is live — 64 of 652 elements carry a non-null value.** That is the real
taker list, published by the people who set it, with no inference at all. `scripts/ingest-fpl.ts`
reads twenty-odd fields from that same payload and does not read this one; `public.players` has
`penalties_saved` and `penalties_missed` but no `penalties_order` column.

`docs/model-review-2026-09-02.md` §1g called penalty duty the one absence with concentrated cost,
"because it inflates a handful of exactly the players captaincy turns on". This ticket gets the
data, then decides from measurement whether it changes the model.

## The question that must be settled first, before any model change

**Does the ingested xG already include penalties?** FPL-Core-Insights' `expected_goals` is a
standard xG figure, and standard xG models assign a penalty roughly 0.76. If penalties are already
inside `prior_xg`, then a taker's penalty value is *already* in the model and adding a separate
penalty term would double-count it — the same class of error `docs/projection-model-backlog.md` G1
and the review's §1d inventory record.

If that is true, the defect is not a missing term. It is that `computePlayerRates` shrinks every
player's xG rate toward a position prior with the same `SHRINKAGE_K = 3`, and a taker's rate is
**more persistent than a non-taker's** — a penalty recurs by appointment, an open-play chance does
not — so shrinking both equally under-credits the taker.

**Settle this from the data before writing a single line of model code**, and say plainly which
answer you got. It decides which of the two treatments below is even coherent.

## Scope

**In scope:**

- A migration adding `penalties_order` (nullable smallint, no default) to `public.players`, with
  RLS unchanged and no new GRANT needed (table-level grants already cover it). Idempotent, listed
  in `supabase/README.md` as not yet applied.
- `scripts/ingest-fpl.ts` reads `penalties_order` from `bootstrap-static` and writes it, in the same
  shape as every other field it maps. Counters in `job_runs.details` for how many players carry a
  non-null value, so a source change is visible rather than silent.
- **Settle the xG question above**, and record the answer in
  `docs/projection-model-backlog.md`.
- **Measure both candidate treatments in the harness, reported, before applying either:**
  1. **Reduced shrinkage for takers** — an identified first-choice taker's xG rate is shrunk less
     toward the position prior, on the grounds that his rate is more persistent. Reuse
     `shrunkRate`'s existing shape; the only change is the effective `K` for that population.
  2. **An explicit penalty term** — only coherent if the xG question comes back "penalties are NOT
     in the ingested xG". If it does, the per-team penalty rate must come from a source that has
     actually been read, never from memory or from a figure this ticket asserts.
- Apply the winning treatment **only if it clears the falsification check below.** If neither does,
  ship the ingest and the finding, apply no model change, and say so.

**Explicitly out of scope:**

- **The residual method from #219 is dead. Do not revive it, extend it, or blend it with
  `penalties_order`.** Its own cross-checks refuted it; a refuted method does not become sound by
  being combined with a sound one.
- No change to assists, clean sheets, defensive contribution, saves, bonus, minutes, or the fixture
  multipliers.
- No new external data source. `bootstrap-static` is already ingested; `penalties_order` is a field
  on a payload this job already fetches.
- No change to the solver, the app, any confidence threshold, or any workflow.
- No new fitted constant that is not derived from measured data and stated with its derivation.

## Falsification check — STOP AND REPORT

A model change ships only if it moves a figure it should move
(`LEARNINGS-second-build-wave.md` §17).

- **Forward and midfield goal calibration must improve** on the calibration report's goals
  component, and the backtest's five-gameweek Spearman for those positions must not fall.
- **The players the treatment lifts must be the `penalties_order` list**, not #219's residual list.
  Report the overlap explicitly — if the lifted set looks like the twenty residual names, something
  is wired to the wrong column.
- If neither treatment clears this, **do not apply one.** The ingest and the written finding are a
  complete, valuable ticket on their own.

## Definition of done

- [ ] The migration is idempotent, adds one nullable column, and is listed in `supabase/README.md`
      as not yet applied.
- [ ] `scripts/ingest-fpl.ts` writes `penalties_order`, and `job_runs.details` reports how many
      players carry a non-null value. A named test covers null, 1, 2 and 3.
- [ ] The xG-includes-penalties question is answered from data, in writing, in the backlog.
- [ ] Both treatments are measured and reported side by side over the same population, with the
      lifted-player overlap against the `penalties_order` list stated.
- [ ] Whichever treatment ships, its effect on both horizons and on goal calibration is reported —
      or, if neither ships, the report says so and no model file changes.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` exit 0.
- [ ] Scope constraint: one new migration, `scripts/ingest-fpl.ts`, `scripts/project-points.ts`,
      `src/lib/projection/rates.ts`, `src/lib/projection/expectedPoints.ts`, their test files,
      `supabase/README.md`, `docs/projection-model-backlog.md`, and this ticket's own
      `decisions/ticket-<issue>.md`. Nothing under `src/components/` or `src/screens/`, and
      `scripts/run-backtest.ts` does not change.

## The human check after merge

Apply the migration by hand, then:

```
cd ~/Projects/fpl-advisor && gh workflow run "Scheduled jobs" && sleep 20 && gh run list --workflow="Scheduled jobs" --limit 1
```

Then confirm the column populated:

```sql
select count(*) as players_total,
       count(penalties_order) as with_penalties_order,
       count(*) filter (where penalties_order = 1) as first_choice_takers
from public.players;
```

Expect roughly 64 with a value and around 20 at order 1 — one first-choice taker per club, give or
take. A count near zero means the ingest is reading the wrong key.

## Notes for the Analyst / Builder

- `penalties_order` is 1, 2, 3 or null. Only order 1 is a first-choice taker; 2 and 3 are backups
  who take penalties rarely and should not be treated as takers without evidence.
- This is a live-data field that changes during a season — a taker loses the job, or is sold. Store
  it, do not cache a derived list.
- Ids are not stable across seasons; `players` is keyed per season, so nothing here crosses a season
  boundary, but do not join this to `player_match_stats` on an element id (`deltas.md` D9).
- The temptation is to skip the xG question and just add points to the twenty players FPL names.
  That is how G1's double-count happened, and the review's §1d inventory exists to stop it repeating.
