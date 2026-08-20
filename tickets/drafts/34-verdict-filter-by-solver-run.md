## Context

A correctness fix. **The verdict card's projected-points figure is roughly double the truth**, because
`solver_picks` holds more than one solver run's rows for the same gameweek and the card sums all of
them.

Depends on item 17 (`src/lib/verdict/`, merged) and the gameweek-points fix (ticket #68, merged).

### The evidence, queried live 20 Aug 2026

```
solution_index | lineup_rows | all_rows | lineup_pts
0              |     22      |    31    |    90.2
1              |     22      |    31    |    90.2
2              |     22      |    31    |    89.4
```

**There should be 11 lineup rows per solution per gameweek, and 15 squad rows. There are 22 and 31.**

The arithmetic reconciles exactly against two runs: an earlier solve that recommended a transfer
produced 16 rows (15 squad plus one transferred-out player), and a later solve that rolled the
transfer produced 15. 16 + 15 = 31, and 11 + 11 = 22.

The card then sums solution 0's lineup — 90.2 — and correctly counts the captain again, landing at
about 101. **The true figure for one run is roughly 50, which is a normal FPL gameweek score.** The
projection model is not at fault; neither is the solver, whose own optimisation is unaffected.

### Why it happens, and why the fix is a filter and not a delete

`solver_picks` carries a `run_id` referencing `solver_runs`, and rows from separate runs legitimately
coexist — that history is worth keeping. **`recommendations` already stores `solver_run_id`,
identifying exactly the run its picks came from.** The card does not use it. That is the entire bug:
a pointer that exists precisely for this purpose, unused.

## Scope

**In scope:**

- Filter every read of `solver_picks` in `src/lib/verdict/api.ts` to the recommendation's own
  `solver_run_id`, in addition to the existing gameweek and `solution_index` filters.
- Handle a recommendation whose `solver_run_id` is null.
- A guard that detects the impossible case rather than silently summing it.
- Vitest tests for every rule below.

**Explicitly out of scope:**

- **No deletion of any row from `solver_picks`, and no change to how they are stored.** Run history
  stays. Nothing under `scripts/` changes.
- **No change to `scripts/generate-recommendations.ts`, `scripts/build-solver-input.ts` or
  `src/lib/recommendation/`.** Those carry the same double-counting defect in
  `transfers_made`, and **that half is owned by the distinct-plans ticket running in this same
  batch** — do not fix it here, and do not touch those files.
- **No change to `scripts/preflight-check.ts`.**
- **No new database table, no migration, nothing under `supabase/`.**
- **No change to the pitch, the countdown, `AppShell`, `Surface` or `src/index.css`.**
- **No change to the confidence band, the hit-cost display, the coverage note, the stale logic or
  the captain line.**
- No new dependency.

## Definition of done

**Build**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] **No test that passed before this ticket now fails or was deleted.**
- [ ] No new entry in `package.json`.
- [ ] Nothing outside `src/lib/verdict/` and its tests is modified.

**The filter**

- [ ] Every read of `solver_picks` is filtered on **all three** of `gameweek_id`, `solution_index`
      **and** `run_id` matching the recommendation's `solver_run_id`. Verifiable by search — no read
      of that table omits the run filter.
- [ ] The filter is applied **in the query**, not by fetching and filtering in memory.
- [ ] There is a named test proving that a fixture set containing two runs' worth of picks for the
      same gameweek and solution yields the same figure as the same set containing only one run's.
      **This is the test that would have caught the bug.**
- [ ] **Against the live 20 Aug 2026 shape — 22 lineup rows across two runs summing to 90.2 — the
      derived figure is the single run's total, not the combined one.** There is a named test using
      that composition.

**The null and impossible cases**

- [ ] A recommendation whose `solver_run_id` is null falls back to the **most recent** run for that
      gameweek and solution, rather than summing all of them. `solver_runs.created_at` orders it.
      Named test.
- [ ] **After filtering, a lineup that does not contain exactly 11 players is treated as
      unevaluable** — the figure reports as unavailable rather than rendering a number derived from
      an impossible squad. The decision, captain, band and reasons all still render. Named tests at
      10, 11 and 12.
- [ ] Missing or empty `solver_picks` for the identified run still does not blank the card, exactly
      as the merged behaviour already requires. Named test.

**Sanity**

- [ ] The derived gameweek figure is rendered as a whole number with no decimal point, unchanged from
      the merged behaviour.
- [ ] A stale recommendation still derives its figure from **its own** gameweek, solution and run.
      Named test.
- [ ] **CANNOT VERIFY, expected:** that the live card now reads near 50 rather than near 101. That is
      Keshav's check after merge.
- [ ] Scope constraint: only files under `src/lib/verdict/`, their test files, and this ticket's own
      `decisions/ticket-<number>.md` are added or changed. Nothing under `src/components/`,
      `src/screens/`, `src/lib/recommendation/`, `src/lib/notification/`, `scripts/`, `supabase/` or
      `.github/` changes; `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **Filter; do not delete.** Every run's picks are a legitimate record of what the solver said at
  that moment, and `DELETE` is not granted on `solver_picks`. The recommendation already points at
  the run it came from — use the pointer.
- **The eleven-player guard is the durable half of this ticket.** The filter fixes today's bug; the
  guard catches the next thing that inflates the row set, whatever it turns out to be. A figure
  derived from 22 starters is not a slightly wrong figure, it is a meaningless one, and it should say
  so rather than render.
- **Do not "fix" this by dividing by the number of runs.** Two runs can legitimately differ — one may
  have recommended a transfer and the other a roll — so an average of them is not a projection of
  anything. Identify the run and use it.
- **The same defect exists in `generate-recommendations.ts`'s `transfers_made` count**, which would
  produce a wrong `hit_cost` from GW2 onward. It is deliberately out of scope here because the
  distinct-plans ticket owns that file in this same batch. **If you find yourself needing to touch
  it, stop and report rather than crossing the boundary.**
- **What a substitute cannot catch.** Tests prove the filter and the guard against fixtures,
  including the exact live composition. They cannot prove the figure on the running card is now
  plausible — the bar is simple and it is Keshav's: **around 50, not around 101.**
