## Context

**A live defect, found by reading job output on 22 August 2026.** The `Scheduled jobs` workflow has
been failing since the GW1 deadline. The cause is one row in `job_runs`:

```
sync-squad: squads upsert failed: new row for relation "squads"
violates check constraint "squads_overall_rank_check"
```

**What is happening.** `supabase/migrations/20260811190000_squad_api_sync_fields.sql` defines
`overall_rank integer CHECK (overall_rank IS NULL OR overall_rank >= 1)` — nullable on purpose,
because "not synced yet" is a real state. `scripts/sync-squad.ts`'s `parseEntryData` reads
`summary_overall_rank` from the public `entry/{id}/` endpoint via `numOrNull`, which returns any
finite number unchanged. **The FPL API returns `0` for a manager who has no overall rank yet** — the
season's first gameweek has been played but no points have been scored and no ranking published.
Zero is finite, so it passes `numOrNull`, and then fails the check constraint.

**The constraint is correct and must not be relaxed.** A rank of zero is not a rank; it is the API's
way of saying "none yet", and the column already has a value for that: `NULL`. Widening the
constraint to `>= 0` would let a meaningless zero into the column and every consumer would then have
to know that zero means absent — the exact ambiguity the `prediction_log` migration's own header
argues against for `actual_points`.

**The blast radius is the whole value chain, and this is the important part.** The preflight check
run of 21 August reported five failures. **Four of them are this one bug:**

| Preflight check | Verdict | Cause |
|---|---|---|
| 2. Squad | FAIL — `no "squads" row exists for gameweek 2` | this bug |
| 4. Recommendation | FAIL — `no "recommendations" row at plan_index 0 for gameweek 2` | downstream of it |
| 5. Solver | FAIL — `most recent solver_runs row is for gameweek 1, not 2` | downstream of it |
| 8. Job freshness | FAIL — `most recent "sync-squad" run failed` | this bug |

The mechanism for the two downstream failures is worth stating explicitly, because it is silent.
`.github/workflows/solver-run.yml` gates its solve, store, generate-recommendations and send steps
on `steps.build-input.outputs.squad_found == 'true'`. `scripts/build-solver-input.ts` builds
`team.json` from `squads` / `squad_picks` for the target gameweek. **With no `squads` row for
gameweek 2, `squad_found` is false, every one of those steps is skipped, and the workflow exits
green having produced nothing.** The GitHub Actions list shows a tick; no solve happened, no
recommendation exists, and nothing anywhere reports a failure.

`sync-squad` also runs as a step inside `.github/workflows/scheduled-jobs.yml`, whose run does go
red — that is currently the only visible symptom of a chain that has stopped working end to end.

Serves `product-brief.md` §6a (the public FPL API, graceful failure on every external fetch).
Depends on nothing.

## Scope

**In scope:**

- In `scripts/sync-squad.ts`, treat a non-positive `summary_overall_rank` from `entry/{id}/` as
  **absent**, not as a value: it becomes `null` before it reaches the upsert.
- Apply the same rule to `summary_overall_points` and `last_deadline_total_transfers` **only where
  the API's sentinel is genuinely meaningless** — see Notes; the pre-answered decision is that
  **points and transfers keep a real zero** and only rank is coerced.
- Record the coercion in `job_runs.details` as a counter (`overallRankCoercedToNull`, 0 or 1) so a
  reader can tell an unranked sync from a normal one rather than seeing an unexplained null.
- Unit tests covering `summary_overall_rank` of `0`, `null`, a missing key, a negative number, and a
  normal positive rank.

**Explicitly out of scope:**

- **No migration, and no change to any check constraint.** The database rule is right; the job was
  feeding it a bad value.
- No change to any other field parsed from `entry/{id}/`, beyond the pre-answered decision above.
- No change to `.github/workflows/scheduled-jobs.yml` — the workflow is correct, its step was
  failing for a real reason.
- No change to squad reconciliation, chip parsing, or `squad_picks` handling.

## Definition of done

- [ ] `parseEntryData` (or the code path between it and the upsert) converts an `overallRank` of `0`
      or any value below 1 to `null`.
- [ ] A unit test asserts each of these inputs for `summary_overall_rank` produces the stated
      `overallRank`: `0` → `null`; `-1` → `null`; `null` → `null`; key absent → `null`;
      `1` → `1`; `1523104` → `1523104`.
- [ ] `summary_overall_points` of `0` still produces `overallPoints: 0`, asserted by a unit test —
      zero points is a real, meaningful measurement.
- [ ] `job_runs.details` carries `overallRankCoercedToNull`.
- [ ] The job's `job_runs.message` on a coerced run says in words that the FPL API reported no
      overall rank yet, rather than being silent about it.
- [ ] No file under `supabase/migrations/` is added or modified — grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the unit tests prove the coercion, not that the live API
      is actually sending `0`, and nothing here proves the chain downstream recovers. The human check
      after merge is, in order: dispatch `Scheduled jobs` and confirm `sync-squad` succeeds with
      `overall_rank` null in `public.squads`; then dispatch `Solver run` and confirm it produces a
      `solver_runs` row for the next gameweek rather than skipping on `squad_found == 'false'`; then
      re-run `Preflight check` and confirm checks 2, 4, 5 and 8 have all turned green.

## Notes for the Analyst / Builder

**Why only rank is coerced, stated as a *because*.** Zero is a legitimate value for overall points
(a manager who has scored nothing) and for total transfers (a manager who has made none). It is
never a legitimate value for a rank, because ranks start at 1 — which is exactly what the existing
check constraint already encodes. Coerce the field whose zero is impossible; leave the fields whose
zero is real. If a Builder finds another field in this response whose zero is impossible, apply the
same reasoning rather than the same list.

**This is a Tier 3 decision, not Tier 2.** It changes how one external sentinel value is
interpreted at the edge of the system. It stores no new data, changes no schema, and is trivially
reversible.

**Do not "fix" this by removing the check constraint or by defaulting to a large sentinel rank.**
Both hide the state rather than representing it, and a fabricated rank would flow into anything that
later reads the column.

**Expect this to recur every season.** The same zero will come back at the start of 2027/28. The
fix should therefore read as a permanent rule about the API's sentinel, not as a patch for this
week — a comment in the code saying so is worth more than the code change itself.

## Scope constraint

Nothing outside the following files changes:

- `scripts/sync-squad.ts`
- `scripts/sync-squad.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added or modified. No workflow file is touched. No file under `src/` changes.
