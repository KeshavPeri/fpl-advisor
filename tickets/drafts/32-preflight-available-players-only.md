## Context

A fix to the preflight check's own projections assertion. **The check is currently red for a
non-reason, and a check that cries wolf is worse than no check** — it teaches the reader to ignore
it, which destroys the only thing it was built for.

Depends on the preflight check (merged, ticket #69).

### What happened

The first live run reported **8 pass, 1 warn, 1 fail**, and the fail was:

```
Projections — FAIL — 87 of 595 projection row(s) have zero expected_points AND zero expected_minutes.
```

Those 87 rows were queried directly against live data on 20 Aug 2026. **Every single one belongs to
an unavailable player:**

| `players.status` | Count |
|---|---|
| `i` — injured | 47 |
| `u` — unavailable | 37 |
| `s` — suspended | 3 |
| **available (`a`)** | **0** |

The most expensive names in the set are Ekitiké, J. Timber, Kulusevski, Saliba, Mitoma and
Joelinton — all carrying a real injury flag on `players.status`.

**The model is behaving exactly as specified.** `src/lib/projection/minutes.ts` resolves availability
to `0.0` for `status` in `i` / `s` / `u` with a null chance, which correctly zeroes expected minutes
and everything downstream. Ticket #33's definition of done required precisely this, with a named test
per case.

**The defect is in the assertion.** Ticket #69's scope said the projections check should confirm
"none of them all-zero". That was wrong: an all-zero projection is the **correct** output for at
least three legitimate populations —

1. a player who is injured, suspended or unavailable;
2. a squad member whose recent appearances are all zero minutes and who simply never plays;
3. a player whose team has no fixture that gameweek.

Roughly 15% of a Premier League player list falls into those categories at any time. The check as
written can effectively never pass.

## Scope

**In scope:**

- Narrow the projections check's failure condition to **all-zero projections for players who are
  available and do have a fixture** — the only population for which an all-zero row is genuinely
  wrong.
- Keep reporting the total all-zero count, and break it down by cause, as **informational values**
  that do not by themselves set the verdict.
- Vitest tests for every rule below.

**Explicitly out of scope:**

- **No change to the projection model.** Nothing under `src/lib/projection/` or
  `scripts/project-points.ts` is edited. The model is correct; the assertion is not.
- **No change to any of the other nine checks**, their thresholds, their verdicts or their reasons.
- **No change to the report's structure, the artifact, the workflow, the schedule, or the exit-code
  behaviour.**
- **No new database table, no migration, nothing under `supabase/`.**
- **No relaxing of the check into a warn.** A fit, fixtured player projecting zero must remain a
  hard fail — that is a real defect and the reason this check exists.
- **No UI. Nothing under `src/` changes at all.**
- No new npm dependency.

## Definition of done

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] Nothing under `src/` or `supabase/` is added, changed or deleted.
- [ ] No file other than the preflight check and its test is modified.

**The narrowed assertion**

- [ ] The projections check **fails** when one or more players meeting **all three** conditions has
      an all-zero projection: `players.status = 'a'`; `chance_of_playing_next_round` is null or 100;
      and the player's team has at least one fixture in that gameweek.
- [ ] The check **does not fail** on an all-zero row for a player whose `status` is `i`, `s`, `u` or
      `d`. Named test per status value.
- [ ] The check **does not fail** on an all-zero row for an available player whose
      `chance_of_playing_next_round` is below 100. Named test.
- [ ] The check **does not fail** on an all-zero row for a player whose team has no fixture in that
      gameweek. Named test.
- [ ] **Against the live 20 Aug 2026 shape — 87 all-zero rows, all of them `i`/`u`/`s` — the check
      passes.** There is a named test using exactly that composition (47 / 37 / 3 / 0) asserting a
      pass verdict.
- [ ] A single fit, fixtured, all-zero player among otherwise healthy data produces a **fail**, and
      the reason **names that player** — an unnamed count is not actionable at 3am on a Friday.
      Named test.

**Reporting**

- [ ] The check's values still include the total `allZeroRowCount`, plus a breakdown by cause: rows
      attributable to unavailability, to no fixture, and to an available player (the failing
      population), as separately named counts that sum to the total.
- [ ] The reason string states the breakdown even on a pass, so the number stays visible rather than
      disappearing when it stops being a failure. A silent count is one nobody notices changing.
- [ ] The existing coverage assertion — projection row count against player count — is unchanged and
      still contributes to the verdict.
- [ ] The check's identifier, position and title in the report are unchanged.

**Robustness**

- [ ] The fixture lookup is filtered in the database and uses the shared pagination helper, matching
      how every other check in this file reads.
- [ ] A player whose team id does not resolve to any team is counted separately and treated as
      **unable to evaluate**, which per the check's own governing rule is a fail, not a pass.
- [ ] Scope constraint: only `scripts/preflight-check.ts`, `scripts/preflight-check.test.ts`, and
      this ticket's own `decisions/ticket-<number>.md` are added or changed. Nothing under `src/`,
      `supabase/` or `.github/` changes; no other file in `scripts/` changes; `package.json` is
      untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **This is a specification defect being corrected, not a check being weakened.** The failure
  condition gets *narrower and sharper*: it now fires only on the population where an all-zero row is
  unambiguously wrong, and it names the offending player. Do not turn it into a warn, and do not add
  a tolerance threshold — one fit, fixtured player projecting zero is one too many.
- **The three legitimate causes are already enumerated above; check for them in that order** —
  unavailability first, no fixture second, everything remaining is the failing population. Anything
  that cannot be attributed to a cause belongs in the failing population, not in a fourth bucket.
- **`status` values are `a` / `d` / `i` / `s` / `u` / `n`**, straight from the FPL API — see the
  reference-schema migration's own column comment. `d` is doubtful and legitimately produces a
  reduced, non-zero projection; if a `d` player comes out all-zero it is because of thin minutes
  history, not availability, so it is still not a failure.
- **Keep the count visible on a pass.** The point of the breakdown is that a jump from 87 to 200
  unavailable players would be worth noticing even while the check is green. A number that only
  appears on failure is a number nobody watches.
- **Do not "fix" this by excluding unavailable players from the projection job.** They need a row —
  the projections CSV feeds the solver's player pool, and a player missing from it cannot be
  transferred in at all. Zero is the right value and the row must exist.
- **This ticket exists because the check worked.** Eight of ten assertions passed and confirmed the
  chain healthy two days before the deadline; the warn correctly surfaced the three promoted clubs
  with no ClubElo rating. Only the tenth was mis-specified. Fixing it is what keeps the other nine
  worth reading.
- **Another ticket may be running in this batch** that owns `scripts/build-solver-input.ts`,
  `scripts/generate-recommendations.ts` and `src/lib/recommendation/`. This ticket touches none of
  them.
- **What a substitute cannot catch.** The tests prove every branch, including the exact live
  composition observed on 20 Aug. They cannot prove the check now passes against the real database —
  **run the workflow manually the moment this merges.** Green, with the 87 still reported in the
  reason, is the outcome that closes this ticket.
