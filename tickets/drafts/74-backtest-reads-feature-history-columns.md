## Context

Ticket #146 added `element_type`, `prior_defcon_qualifying_matches` and `prior_defcon_hits` to
`feature_history`, at 100% coverage for season 2025-2026 with an implied hit rate of 0.195.
**Nothing reads them.** `scripts/run-backtest.ts` still resolves position by joining to the live
`players` table and still reconstructs the defensive-contribution hit rate from cumulative totals.
Both defects #146 was built to fix are therefore unchanged, exactly as #146's own scope predicted —
see `LEARNINGS-second-build-wave.md` §15.

Confirmed against the backtest run of 29 Aug 2026, 16:30 UTC:

- **excluded — unresolved `player_code`: 4,175 of 18,246 rows read (23%)**
- **Defensive contribution: mean actual 0.259, mean projected 0.068 — the largest component error
  in the model**, and the largest single contributor to the −0.418 overall bias.

### Defect 1 — position is resolved through the wrong table

`run-backtest.ts:1792` reads `players.code, players.element_type` and builds `codeToPosition`.
`players` holds the **current** season's registered players. A 2025-2026 player who is no longer in
the 2026/27 game has no row, so `classifyRow` (line ~860) returns `unresolvedPlayerCode` and the row
is dropped before any other test is applied. That is the entire 23%.

`feature_history.element_type` exists precisely so nothing has to make this join — it is copied from
the ingested season's own `players.csv` via `player_match_stats.element_type`, never from the live
table. See the #146 migration's own header.

### Defect 2 — the defcon hit rate is shrunk as if every player had exactly one match of evidence

This is the mechanism behind the flat bucket table, and it is arithmetic, not a hypothesis.

`buildDefconMatches` (line ~556) returns **an array of exactly one synthetic match** — the player's
per-match averages — for every row, regardless of how much history the row carries.
`estimateDefconHitRate` then computes:

```
estimate = (hits + SHRINKAGE_K * positionPrior) / (n + SHRINKAGE_K)
```

with `SHRINKAGE_K = 5` and **`n` always equal to 0 or 1**. So a player with 30 prior qualifying
matches is shrunk toward the position prior exactly as hard as a player with one — the estimate can
never be more than 1/6 his own evidence. **The shrinkage never relaxes, at any amount of history.**

That is precisely the shape #140's diagnostic reported and could not explain:

| prior_matches | n | Mean signed error |
|---|---|---|
| 1–4 | 2315 | −0.128 |
| 5–9 | 1747 | −0.173 |
| 10–19 | 2287 | −0.229 |
| 20+ | 2271 | −0.231 |

**Flat at the top, which #140 said would point at a level problem.** It does — but the level problem
is in the harness, not in `defconRate.ts`. The calibration report, which uses real per-match data,
reports defcon at 0.88x for defenders and 0.84x for midfielders — nearly right. **Both instruments
are correct and they were measuring different things.** `docs/projection-model-backlog.md` G10 left
this open pending exactly this read.

Depends on #146 and #152, both merged. Nothing unmerged.

## Scope

**In scope:**

- **Read `element_type` from `feature_history`** and use it as the primary source of a row's
  position. Fall back to the existing `codeToPosition` map only when the column is null; keep
  `unresolvedPlayerCode` as the exclusion when both are unavailable.
- **Read `prior_defcon_qualifying_matches` and `prior_defcon_hits`** and feed the real qualifying
  count and hit count into the defensive-contribution estimate, replacing the single synthetic
  averaged match.
- **New counters in the report's population section and in `job_runs.details`:** how many rows
  resolved their position from `feature_history.element_type`, how many from the fallback map, how
  many from neither; and how many rows carried non-null defcon counters versus fell back to the old
  averaged-match path.
- **The population reconciliation still balances.** Measured + every exclusion = rows read, printed
  as it is today.

**Explicitly out of scope:**

- **No change to anything under `src/`.** `defconRate.ts`, `minutes.ts`, `rates.ts`,
  `expectedPoints.ts` and `fixture.ts` are all untouched. This ticket changes what the harness
  *feeds* the model, never the model. **Do not tune `SHRINKAGE_K`, `k`, or any constant in
  `defconRate.ts`** — that is a later ticket, and it cannot be specified until this run's numbers
  exist.
- **No migration.** All three columns exist and are applied.
- **No change to the ranking section (#147), its sanity bounds, or the top-N logic.** Those are a
  separate ticket. This ticket will move their numbers because it moves the population; that is
  expected and is not a defect.
- **No change to the fixture approximation** (every row still projected against a neutral fixture),
  the minutes approximation, or the availability assumption. G9's three documented approximations
  are reduced by one here — the defcon one — and the other two stand.
- **No edit to `docs/projection-model-backlog.md`.** Record findings in this ticket's decisions file.
- **No re-run of `build-feature-history.ts`** and no change to it.

## Definition of done

- [ ] The `feature_history` select list includes `element_type`,
      `prior_defcon_qualifying_matches` and `prior_defcon_hits`.
- [ ] A row's position comes from `feature_history.element_type` when non-null, from the
      `players` fallback map when it is null, and the row is excluded as `unresolvedPlayerCode`
      only when neither resolves. A named test covers all three paths.
- [ ] The defensive-contribution estimate uses the stored counters as its qualifying-match count
      and hit count. **A named test proves the arithmetic on hand-computed values**: for
      `prior_defcon_qualifying_matches = 20`, `prior_defcon_hits = 5`, `SHRINKAGE_K = 5` and a
      position prior of `0.2`, the estimate is `(5 + 5 × 0.2) / (20 + 5) = 0.24`, computed by hand
      in the test's own comment.
- [ ] **A named test proves the old behaviour was the defect:** the same input under the previous
      single-synthetic-match path yields a materially different, more heavily shrunk value. This is
      the test that documents why the ticket exists.
- [ ] A row with null defcon counters falls back to the existing averaged-match path rather than
      throwing or being excluded, and is counted in the new fallback counter.
- [ ] Goalkeepers still return exactly 0 defensive contribution. Named test.
- [ ] The report prints the new resolution and defcon-source counters, and the population
      reconciliation still balances exactly.
- [ ] Every existing test passes **unmodified** except where a test asserts the single-synthetic-
      match construction directly. No expected value is copied from failing output.
- [ ] Nothing under `src/`, `supabase/`, `docs/`, `.github/`, `src/screens/` or `src/components/` is
      added, changed or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests prove the arithmetic on constructed rows, not
      that the live population is now right. The human check after merge is dispatching `Backtest`
      and reading three things: **(1)** the unresolved-`player_code` exclusion falls sharply from
      4,175; **(2)** the measured population rises from 8,620 — **by less than 4,175**, because
      newly-resolved rows still face the `didNotFeature` and `noPriorMatches` tests, so a rise of
      the full 4,175 would itself be a bug; **(3)** the defcon bucket table is no longer flat, or is
      flat at a materially smaller error. **What will NOT change:** goals, assists, saves and
      appearance calibration are untouched by this ticket, and the headline MAE may move in either
      direction purely because the population changed — **that movement is not evidence about the
      model** and must not be read as such.

## Notes for the Analyst / Builder

**The single-synthetic-match construction is the finding, and it should be written into the
decisions log with its arithmetic.** `estimateDefconHitRate`'s `n` is the length of the qualifying
subset of the array it is given. `buildDefconMatches` gives it one element. With `SHRINKAGE_K = 5`,
the maximum weight a player's own evidence can ever carry is `1/6`. Every measured defcon figure
this project has ever produced from the backtest carries that ceiling. **This closes G10's open
question in `docs/projection-model-backlog.md`** — the level explanation is correct and the level
was in the harness.

**Do not construct the fix by synthesising N identical matches unless that is genuinely the
clearest code.** It is arithmetically exact — `estimateDefconHitRate` reads only the qualifying
count and the hit count — and it keeps this ticket inside one file, which is why it is permitted.
If it reads badly, a small **additive** exported helper in `src/lib/projection/defconRate.ts` is
acceptable instead, but **only additive**: no existing export's signature may change, because
`scripts/calibration-report.ts` is being edited by the other ticket in this batch and imports the
same module (`LEARNINGS-second-build-wave.md` §11). If the Builder takes the helper route, the
scope constraint below is extended by exactly those two files and the deviation must be logged.

**`element_type` maps to `Position` the same way `players.element_type` already does** — do not
invent a second mapping. Read how `codeToPosition` casts it today and reuse that.

**This is Tier 2** — it changes the population every backtest figure is computed over, and the
comparability of every number in every prior backtest report. Log it as HIGH-IMPACT with its
*because*, and state plainly in the entry that **backtest reports from before this ticket are not
comparable to reports after it.**

**One companion ticket is running in this batch**, touching `scripts/calibration-report.ts` only.
This ticket touches neither that file nor anything it exports.

## Scope constraint

Nothing outside the following files changes:

- `scripts/run-backtest.ts`, `scripts/run-backtest.test.ts`
- `decisions/ticket-<this issue number>.md`

Plus, **only if** the Builder takes the additive-helper route described in the Notes and logs the
deviation: `src/lib/projection/defconRate.ts` and `src/lib/projection/defconRate.test.ts`, with no
change to any existing export's signature.

No migration file is added. Nothing under `supabase/`, `docs/`, `.github/`, `src/screens/`,
`src/components/`, `scripts/lib/` or any other `scripts/*.ts` changes. No dependency is added,
removed or upgraded. No build configuration changes.
