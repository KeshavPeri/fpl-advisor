## Context

**The single largest known gap in `baseline-v1`.** `docs/projection-model-backlog.md` G3: bonus points
are not modelled at all — `src/lib/projection/expectedPoints.ts` passes `bonusPoints: 0` to
`totalMatchPoints`, deliberately, as a stated out-of-scope line in ticket #33.

**Why it matters more than it sounds.** Bonus is the term that most favours attackers and high-BPS
defenders, so omitting it compresses the gap between the best players and the rest — which is
precisely the gap a transfer or captaincy recommendation turns on. The G3 addendum in the backlog
records the worked GW1 case, recomputed from raw inputs and confirmed arithmetically exact:

| Component | Haaland (FWD) | B. Fernandes (MID) |
|---|---|---|
| Goals | 3.49 | 1.91 |
| Assists | 0.30 | 1.24 |
| Appearance | 1.80 | 2.00 |
| Clean sheet | 0 | 0.34 |
| Defensive contribution | 0.00 | 0.30 |
| **Bonus** | **0** | **0** |
| **Total** | 5.59 | **5.79** |

A 0.20 gap on a ~5.7 projection decided the captaincy. The one term missing entirely plausibly
favours Haaland by more than that.

Serves `product-brief.md` §6d (the in-house projection model) and feature-list "what to build next"
item 1. Depends on nothing unmerged.

### The method, and why this one

**The binding constraint: we cannot compute a real BPS total.** The published BPS system scores
around thirty match actions. `player_match_stats` carries six of the relevant ones — minutes, goals,
assists, saves, the CBI actions, and recoveries — and carries no passing, dribbling, shots-on-target,
key-pass or big-chance data at all. **Any method that depends on an accurate absolute BPS number is
unsound from the start.** What the available data does support is the *relative* ordering and the
*spread* between players in a match, which is all a share-based allocation needs.

Two alternatives were considered and rejected, and both rejections belong in the ticket so nobody
re-proposes them:

- **Rank allocation** — compute expected BPS, rank, award 3/2/1 via the existing
  `src/lib/scoring/bonus.ts` `allocateBonusPoints`. Rejected: it is winner-take-all. It hands the
  top-ranked player the full 3 points every gameweek, when in reality a premium striker tops the BPS
  chart perhaps one week in four, and gives exactly zero to everyone else. It would overstate the top
  player roughly threefold and manufacture exactly the false confidence `product-brief.md` §8
  forbids.
- **Proportional to total expected BPS** — rejected in the opposite direction. Every player who
  lasts an hour banks a large appearance BPS floor, so shares come out nearly equal at about 0.27
  points each. That is *flatter* than reality, and flatness is the specific error G3 describes.

**Adopted: share the six bonus points in proportion to expected BPS *above* a bare-appearance
baseline.** In one sentence: *the six bonus points available in a match are shared out according to
how much each player is expected to do beyond simply turning up.*

Because the appearance term is the only BPS every participating player earns regardless of
performance, and every other modelled term is non-negative, the "excess" is exactly the sum of the
non-appearance terms — no subtraction or clamping to zero is needed in the code.

## Scope

**In scope:**

- **BPS constants for the terms we can model**, added to `src/lib/scoring/bps.ts` as named exports
  alongside the CBI, tackled and save functions already there. Values verified against the official
  Premier League BPS table and the official 2026/27 BPS-changes article at ticket-writing time
  (sources in Notes below) — **do not take any of these from training data**:

  | Term | BPS | Note |
  |---|---|---|
  | Playing 1–60 minutes | 3 | unchanged for 2026/27 |
  | Playing over 60 minutes | 6 | unchanged for 2026/27 |
  | Goal scored, goalkeeper or defender | 12 | unchanged |
  | Goal scored, midfielder | 18 | unchanged |
  | Goal scored, forward | 24 | unchanged |
  | Assist | 9 | unchanged |
  | Clean sheet, goalkeeper or defender | 12 | unchanged; midfielders and forwards earn 0 |
  | Each save | 2 | 2026/27 value, already `ORDINARY_SAVE_BPS` in `bps.ts` |
  | Every 3 CBI | 1 | 2026/27 change, already `CBI_ACTIONS_PER_BPS` in `bps.ts` |
  | Every 3 recoveries | 1 | unchanged |

- **Two new shrunk per-90 rates** in `src/lib/projection/rates.ts`: `cbiPer90` (clearances + blocks +
  interceptions, matching the CBI definition in `bps.ts` — **tackles are not CBI**) and
  `recoveriesPer90`. Both use the existing `SHRINKAGE_K` formula and the existing
  `positionPriorRates` mechanism, so a player with no history returns the position prior exactly, by
  construction. `positionPriorRates` computes both from the supplied match data — nothing hardcoded,
  same as the existing three rates.

- **Expected event counts surfaced on `FixtureProjection`** in
  `src/lib/projection/expectedPoints.ts`. `projectPlayerFixture` already computes `expectedGoals`,
  `expectedAssists`, `expectedSaves` and `pCleanSheet` internally and throws them away, returning
  only points. Add an `expectedEvents` field carrying those plus `expectedCbi`, `expectedRecoveries`,
  `pAppears` and `pSixtyPlus`, so a second pass can consume them without recomputing anything.
  `bonusPoints` stays `0` in this function — it is not the function that can know.

- **A new pure module `src/lib/projection/bonus.ts`**, exported from
  `src/lib/projection/index.ts`, with two functions:
  - `expectedBps(position, events)` — the sum of the modelled terms:
    `3 × (pAppears − pSixtyPlus) + 6 × pSixtyPlus`, plus `expectedGoals × goalBps(position)`, plus
    `expectedAssists × 9`, plus `pCleanSheet × pSixtyPlus × cleanSheetBps(position)`, plus
    `expectedSaves × 2`, plus `expectedCbi / 3`, plus `expectedRecoveries / 3`. **The CBI and
    recovery terms divide, they do not floor** — flooring an expectation is wrong, and `bpsFromCbi`'s
    existing `Math.floor` is correct for a finished match and must not be reused here.
  - `allocateFixtureBonus(entries)` — takes every player projected for one fixture and returns each
    player's share of the six available bonus points, in proportion to `expectedBps` minus the
    appearance term. Clamped at 3.0 per player (the real maximum a single player can earn), with the
    clamped residual left unallocated rather than redistributed.

- **A second, fixture-grouped pass in `scripts/project-points.ts`.** The job currently loops player →
  gameweek → fixture and pushes a finished row per player-gameweek. It must instead stage the
  per-(player, gameweek, fixture) projections, then after the player loop and before the upsert,
  group by `fixtureId`, allocate bonus across every player in that fixture, write the result into
  that fixture's `components.bonusPoints`, and **recompute that fixture's expected points by calling
  `totalMatchPoints` again with the filled-in components** — not by adding the bonus onto the
  existing total. The gameweek aggregation and the upsert then run unchanged on the corrected values.

- **New counters in `job_runs.details`**, per `LEARNINGS-second-build-wave.md` §8:
  `fixturesBonusAllocated`, `fixturesZeroExcess`, `playerFixturesBonusClamped`,
  `maxProjectedBonusPerPlayerFixture`, `meanProjectedBonusAmongLikelyStarters`.

- **`docs/projection-model-backlog.md` G3 updated** — marked as addressed by this ticket, stating
  plainly what is still not modelled and that the allocation is a proportional share, not a simulated
  BPS ranking.

- **`scripts/calibration-report.ts`'s caveat text corrected.** It currently tells the reader
  "**The projected side is compared on the same basis** — `src/lib/projection/expectedPoints.ts`
  hardcodes bonusPoints to 0 too". After this ticket that sentence is false, and a comment stating an
  obsolete convention is the D10 second-order effect the learnings name explicitly. Text and comments
  only — **no behavioural change to that script.**

**Explicitly out of scope:**

- **No new data source and no new ingested column.** The BPS terms this model cannot see —
  passing, dribbling, shots on target, key passes, big chances created, and every negative BPS term —
  stay unmodelled. Do not add an ingest step, do not call a new endpoint.
- **No validation against actual bonus or actual BPS.** Nothing in the database records either.
  Measuring this model against reality is deferred to the backtest (feature-list item 32); this
  ticket ships sanity bounds, not a calibration.
- **No change to `src/lib/scoring/bonus.ts`.** `allocateBonusPoints` is the correct rule for scoring
  a *finished* match and settlement will need it. Projection needs a share, settlement needs a rank.
  Two different jobs — **do not delete, rewrite, or "unify" that function.**
- **No sharpening exponent, no tuning parameter.** Raising the excess to a power to concentrate
  bonus further is a real option and it is deliberately not taken here. Ship the plain proportional
  version; a dial with no measurement behind it is what `LEARNINGS-second-build-wave.md` §7 warns
  against. A later ticket may add one, alone, with a number.
- **No database migration.** `player_projections.components` is `jsonb`; the bonus figure lands in
  the existing `points.bonusPoints` key, which already exists and is currently always zero.
- **No change to `scripts/emit-projections-csv.ts`, the solver, the verdict card or any UI.** They
  read `expected_points` and will pick the improved figure up automatically. That is the intended
  consequence, not a task.
- **No change to `src/lib/scoring/bps.ts`'s `bpsFromSave` behaviour.** Only new constants are added
  to that file. (See Notes — there is a separate, unrelated question about that function.)

## Definition of done

- [ ] `src/lib/projection/bonus.ts` exists, exports `expectedBps` and `allocateFixtureBonus`, and is
      pure: the strings `supabase`, `fetch`, `process.env` and `import(` appear nowhere in it.
- [ ] It is re-exported from `src/lib/projection/index.ts`.
- [ ] The BPS constants in the Scope table above exist as named exports in `src/lib/scoring/bps.ts`,
      each carrying a comment naming which of the two sources in Notes it came from.
- [ ] `PlayerRates` carries `cbiPer90` and `recoveriesPer90`; `computePlayerRates` shrinks both with
      the existing `SHRINKAGE_K` formula; `positionPriorRates` derives both from the supplied matches
      with no hardcoded literal. A unit test asserts a player with zero minutes returns the prior
      exactly for both new rates.
- [ ] `FixtureProjection` carries an `expectedEvents` field with `expectedGoals`, `expectedAssists`,
      `expectedSaves`, `expectedCbi`, `expectedRecoveries`, `pCleanSheet`, `pAppears`, `pSixtyPlus`.
- [ ] `projectPlayerFixture` still returns `bonusPoints: 0` — a unit test asserts it, so the second
      pass is provably the only thing that sets bonus.
- [ ] **For any fixture where at least one player has a positive excess and no player was clamped,
      the allocated bonus across that fixture's players sums to 6.00 ± 0.01.** Asserted by a unit
      test over at least three constructed fixtures of different shapes.
- [ ] Where a player was clamped, that fixture's total is strictly less than 6.00 and
      `playerFixturesBonusClamped` is greater than zero. Asserted by a unit test.
- [ ] A fixture in which every player has zero excess allocates zero bonus and does not divide by
      zero. Asserted by a unit test.
- [ ] No player-fixture is assigned more than 3.0 projected bonus. Asserted by a unit test.
- [ ] `scripts/project-points.ts` calls `totalMatchPoints` to recompute each fixture's expected
      points after bonus is written in. The bonus figure is never added to a previously computed
      total by hand — grep for it: no `+ bonus` style arithmetic on `expectedPoints` anywhere in the
      file.
- [ ] `job_runs.details` carries all five counters named in Scope, and
      `meanProjectedBonusAmongLikelyStarters` (players with `pSixtyPlus >= 0.5`) falls between
      **0.15 and 0.60** on a real run. *(Six points shared over roughly 22 likely starters is about
      0.27; a figure outside this range means the allocation is wrong, not the world.)*
- [ ] G3 in `docs/projection-model-backlog.md` is updated as described in Scope.
- [ ] The obsolete "same basis" sentence in `scripts/calibration-report.ts` is corrected and no
      behaviour in that script changes.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch**, stated in the PR body: every test here is arithmetic on
      constructed inputs. **No test in this ticket can tell whether the projected bonus resembles
      real bonus**, because nothing in the database records actual bonus. The human check is reading
      the counters on the first live run and asking whether the named players at the top of the
      bonus distribution are the ones a human would expect.

## Notes for the Analyst / Builder

**Sources, verified 22 August 2026 — these were checked at ticket-writing time, not recalled.**
The core BPS values (appearance 3/6, goals 12/18/24 by GK-DEF / MID / FWD, assist 9, clean sheet 12
for GK and DEF, save 2, recoveries 1 per 3) come from the Premier League's own BPS explainer at
`premierleague.com/en/news/106533`. The 2026/27 changes — CBI moving to 1 BPS per three actions, the
removal of the tackled penalty, and the revised goalkeeper save treatment — come from
`premierleague.com/en/news/4679946`. One third-party site (`fplai.app`) publishes the goal values
inverted (24 for goalkeepers and defenders, 12 for forwards); **it is wrong, the Premier League's own
table is right**, and this is noted here so nobody "corrects" the constants toward it later.

**Why the appearance term is excluded from the share, stated as a *because*.** Appearance BPS is the
one component every participating player banks regardless of how he plays, so it carries no
information about who deserves bonus. Including it is what makes the naive proportional method go
flat. If a Builder hits a case this rule does not obviously cover, reason from that sentence.

**Why the fixture group is not exactly 22 players.** The job projects every player at both clubs,
which is roughly fifty per fixture, not the twenty-two who start. This is deliberate and needs no
filter: a player's excess scales with his expected minutes, so squad players contribute close to
nothing on their own. Inventing a "predicted starting eleven" filter would add a second guess on top
of the minutes model that already encodes it.

**Double gameweeks fall out for free.** A player with two fixtures in one gameweek is allocated bonus
in each fixture group independently and the gameweek aggregation sums them, exactly as it already
does for every other component.

**Goalkeeper saves are approximated at a flat 2 BPS per save**, deliberately and with the owner's
agreement. `bpsFromSave` in `bps.ts` also awards conditional bonuses for a save inside the box or
against a big chance, and `player_match_stats.saves` is a plain count with no such detail — those
flags are not in our data and will not be. Goalkeepers rarely decide a bonus allocation; this is an
accepted approximation, not an oversight.

**Do not reuse `bpsFromCbi` for the projection.** It floors, which is right for a finished match and
wrong for an expectation. Two different functions, and the ticket wants both to exist.

**A ClubElo caveat worth knowing.** Three promoted clubs have no ClubElo rating, so some fixtures use
FPL's coarser difficulty fallback (`eloFallbackUsed: true`). Bonus inherits that same fixture
weighting through `expectedGoals` and `pCleanSheet`; it introduces no new dependency and needs no new
handling. Do not add one.

**The `scripts/` to `src/lib/` import boundary is already crossed** — `tsconfig.scripts.json`
already sets `allowImportingTsExtensions`, established by ticket #33. No build-config change is
needed by this ticket. If one turns out to be needed anyway, flag it loudly per `deltas.md` D10
rather than duplicating logic into `scripts/` to stay inside the lines.

## Scope constraint

Nothing outside the following files changes:

- `src/lib/scoring/bps.ts`, `src/lib/scoring/bps.test.ts`
- `src/lib/projection/bonus.ts` (new), `src/lib/projection/bonus.test.ts` (new)
- `src/lib/projection/rates.ts`, `src/lib/projection/rates.test.ts`
- `src/lib/projection/expectedPoints.ts`, `src/lib/projection/expectedPoints.test.ts`
- `src/lib/projection/index.ts`
- `scripts/project-points.ts`, `scripts/project-points.test.ts`
- `scripts/calibration-report.ts`, `scripts/calibration-report.test.ts` (caveat text and comments
  only — no behavioural change)
- `docs/projection-model-backlog.md`
- `decisions/ticket-<this issue number>.md`

No migration file is added. No workflow file is touched. `src/lib/scoring/bonus.ts` is not modified.
