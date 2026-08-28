## Context

**Two defects in `feature_history` with one root cause: the table stores cumulative totals but not
the two things a point-in-time projection actually needs.** They are one ticket because the second
cannot be computed without the first.

### 1. The defensive-contribution error is a harness limitation, not a model defect

The backtest reports defcon projected at **0.070** against an actual **0.259** — 27%, and the largest
single component error in the model. The prior-matches diagnostic (#140) settled what kind of problem
it is:

| prior_matches | signed error |
|---|---|
| 1–4 | −0.124 |
| 5–9 | −0.174 |
| 10–19 | −0.232 |
| 20+ | −0.220 |

**It gets worse with more evidence and then plateaus.** A cold-start problem would shrink toward
zero, so this is not the shrinkage and `k` is not the fix.

**But the calibration report, which has per-match data, puts defcon at 0.88x for defenders — nearly
right.** Two instruments disagreeing threefold on the same quantity, and the difference is exactly
what they are built from:

`src/lib/projection/defconRate.ts` computes a **hit rate**: the proportion of *qualifying* matches
(60+ minutes) in which the player reached his position's threshold — 10 CBIT for defenders, 12 CBIRT
for midfielders and forwards. **That is a per-match determination.** `feature_history` stores
cumulative totals — `prior_clearances`, `prior_blocks`, `prior_interceptions`, `prior_tackles`,
`prior_recoveries` — from which a hit rate **cannot be recovered**. A player with 30 clearances over
10 matches might have hit the threshold three times or never; the totals cannot tell you.

**So the backtest approximates it, and the approximation is bad.** This would have cost three tickets
"fixing" a model that is probably fine.

### 2. Position is not stored, so 23% of the population is thrown away

The backtest excludes **4,209 of 18,243 rows (23%)** for an unresolved `player_code`, and the
calibration report skips 2,520 for the same reason.

**The cause is not a bug, it is a missing column.** `feature_history` is keyed on `player_code` and
carries no position, so every consumer joins to `players` to get one — and `players` holds the
**current** season's 616 players, while 2025-26 had 841. Anyone who left the league has no row, and
their entire history is dropped.

**The position was available at build time and was not stored.** `scripts/ingest-core-insights.ts`
already fetches that season's own `players.csv` — it logs *"fetched 841 player row(s)"* — which
carries the position as it was that season.

**This is the cross-season identity problem again** (`deltas.md` D9, tickets #22 and #32): a table
built to outlive a season must carry what it needs, not borrow it from a table that does not.

Depends on #121 and #125 (merged, table populated with 18,243 rows). Nothing unmerged.

## Scope

**In scope:**

- **A migration adding three columns to `public.feature_history`**, in
  **`supabase/migrations/20260829090000_feature_history_position_and_defcon.sql`** — filename pinned.
  - `element_type smallint` — the FPL position code **as it was in the ingested season**.
  - `prior_defcon_qualifying_matches integer` — count of prior matches with 60+ minutes.
  - `prior_defcon_hits integer` — count of those in which the position threshold was reached.
  - All nullable with no default: a row written before this migration genuinely has no value, and
    that is different from a real zero.
  - **No new `GRANT` needed** — `ADD COLUMN` on an existing table whose grants already cover it,
    matching the #54 and #125 precedent. State that in the file header.
  - Idempotent: `ADD COLUMN IF NOT EXISTS`.
- **`scripts/build-feature-history.ts` populates all three**, using the existing pure modules:
  `isQualifyingMatch` and `reachedThreshold` from `src/lib/projection/defconRate.ts` and
  `src/lib/scoring/defensiveContribution.ts`, **imported, never reimplemented**.
- **The position comes from the ingested season's own player list**, not from the live `players`
  table. If the ingest does not currently persist it, **that is part of this ticket** — see Notes.
- **The strictly-before rule applies to the new counters exactly as it does to the totals**: a
  gameweek's row counts qualifying matches and hits from matches *strictly before* it.
- **Counters in `job_runs.details`**: rows written carrying a non-null `element_type`, and rows
  carrying non-null defcon counters. Both must equal rows written after a full rebuild.
- **`supabase/README.md`** gains a row for the new migration, marked not yet applied.

**Explicitly out of scope:**

- **No change to the projection model.** Nothing under `src/lib/projection/` or `src/lib/scoring/` is
  modified — both are imported as they are. **In particular no change to `k`, to any threshold, or to
  `estimateDefconHitRate`.**
- **No change to `scripts/run-backtest.ts`.** Another ticket may own it; consuming the new columns is
  a follow-up, and this ticket's value is that the data finally exists.
- **No change to the existing `prior_*` totals.** They stay; the counters are additional.
- **No backfill script.** The job rebuilds the season on demand — see Notes.
- **No fix to `scripts/calibration-report.ts`'s own skipped rows.** Same root cause, different
  consumer, separate ticket.

## Definition of done

- [ ] The migration exists with exactly the pinned filename, is idempotent, and adds all three
      columns as nullable with no default.
- [ ] `element_type` is populated from the ingested season's player list. **A named test asserts a
      player who is absent from the current `players` table still receives a position** — that is the
      entire point of the column.
- [ ] `prior_defcon_qualifying_matches` counts only matches with 60+ minutes, strictly before the
      row's gameweek. Named test with a mix of full and cameo appearances.
- [ ] `prior_defcon_hits` uses the position's own threshold — 10 CBIT for defenders, 12 CBIRT for
      midfielders and forwards, and **the goalkeeper case is handled explicitly** rather than falling
      through. Named test per position.
- [ ] **A player with 30 clearances across 10 matches who never reached a threshold records 0 hits.**
      Named test — this is the exact case cumulative totals cannot express and the reason the ticket
      exists.
- [ ] The strictly-before rule holds for the new counters: the gameweek 3 row counts gameweeks 1 and
      2 only. Named test, and #121's existing boundary tests pass **unmodified**.
- [ ] A row for a gameweek with no prior qualifying match records `0`, not null. Named test —
      *zero qualifying matches is a real measurement; null means never computed.*
- [ ] `isQualifyingMatch` and `reachedThreshold` are imported, not reimplemented. Grep-checkable: no
      local `60`, `10` or `12` threshold literal appears in the job.
- [ ] `job_runs.details` carries both new counters and they equal rows written after a rebuild.
- [ ] Every Supabase read paginates and asserts its count — `player_match_stats` holds 15,000+ rows
      for one season, well past the silent 1,000-row cap.
- [ ] `supabase/README.md` carries the new migration row, marked not yet applied.
- [ ] Nothing under `src/` or `.github/` is added, changed or deleted, and no file under `scripts/`
      other than `build-feature-history.ts` and its test changes. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests run on constructed rows. The human check after
      merge is: apply the migration, rebuild the season, and confirm **`element_type` is non-null on
      every row** and that the defcon hit rate implied by the counters
      (`prior_defcon_hits / prior_defcon_qualifying_matches`) sits **between roughly 5% and 30%** for
      players with 10+ qualifying matches. A rate near zero means the threshold logic is wrong; a
      rate near 100% means the qualifying filter is.

## Notes for the Analyst / Builder

**Why a hit rate cannot be recovered from totals, as its *because*.** The defcon rule is a per-match
threshold, not a rate — a player either reached 10 CBIT in a match or he did not. **Because** a
cumulative total sums across matches, it cannot distinguish one huge game from ten ordinary ones, and
those have very different hit rates. This is a property of the measurement, not a limitation to work
around: the counters must be computed match by match at build time or not at all.

**Where the position comes from, and check before assuming.** `scripts/ingest-core-insights.ts`
fetches the season's `players.csv` and logs the row count, but **verify whether it persists the
position anywhere** before writing the job. If it does not, persisting it is in scope — and if that
requires a column on `player_match_stats`, add it in the same migration rather than reaching for the
live `players` table, which is the whole thing this ticket is escaping.

**No backfill script, deliberately.** `build-feature-history.ts` rebuilds a whole season on demand
and upserts, so one hand-run after the migration fills every row — the same pattern
`ingest-core-insights.ts` used to back-stamp `competition` in #54 and `team_goals_conceded` in #125.
Do not invent a second mechanism.

**Nullable, not zero-defaulted, and it is load-bearing.** A row written before this migration has no
value; a player with no qualifying matches has zero. Collapsing those makes a table that lies about
what it has measured — the same argument `20260821090000_prediction_log.sql`'s header makes.

**Do not touch the model on this evidence.** The bucketed diagnostic says the defcon error is a level
problem, and the calibration report says the level is nearly right on per-match data. **The most
likely explanation is that the harness is wrong, not the model** — and this ticket is what makes that
testable. Any change to `defconRate.ts` before the rebuilt data has been read would be exactly the
mistake `LEARNINGS-second-build-wave.md` §3 records.

**This is Tier 2** — it changes a table other model work will be built on. Log it as HIGH-IMPACT with
its *because*, including that the defcon question remains open until the rebuilt data is read.

**Two other tickets may be running in this batch.** One owns `scripts/run-backtest.ts` and
`docs/projection-model-backlog.md`; the other owns `src/lib/projection/`. This ticket touches
neither — in particular, **do not modify anything under `src/`**, and do not edit either docs file.

## Scope constraint

Nothing outside the following files changes:

- `supabase/migrations/20260829090000_feature_history_position_and_defcon.sql` (new)
- `scripts/build-feature-history.ts`, `scripts/build-feature-history.test.ts`
- `scripts/ingest-core-insights.ts`, `scripts/ingest-core-insights.test.ts` (only if the season's
  position is not already persisted — see Notes; if it is, these files are not touched)
- `supabase/README.md` (one appended migration row only)
- `decisions/ticket-<this issue number>.md`

No workflow file is touched. Nothing under `src/` or `docs/` changes. `scripts/run-backtest.ts`,
`scripts/calibration-report.ts` and `scripts/project-points.ts` are not modified.
