v1.0 — opened 15 Aug 2026, the day `baseline-v1` first ran against live data.

# Projection model — known gaps in `baseline-v1`

Every entry here is a **deliberate, understood limitation** of the v1 baseline projection model
(feature-list item 10, ticket #33), not a defect. `product-brief.md` §6d requires each of the five
v1 inputs to be explainable in one sentence, and several of the gaps below are the price of that
constraint. They are recorded here so a future ticket can be written from evidence rather than from
someone re-noticing the same thing.

**This file is not a backlog you work through in order.** Read it before writing any ticket that
touches `src/lib/projection/`, and before item 30/31 (the OpenFPL retrain and the swap behind the
CSV seam) — several of these disappear entirely once a trained model replaces the baseline, and
building them into `baseline-v1` first would be wasted work.

`model_version` on `player_projections` exists precisely so a successor can be written alongside
`baseline-v1` rather than over it. Nothing here needs to be fixed in place.

---

## G1 — Goalkeeper saves do not scale with fixture difficulty — ADDRESSED by ticket #109, 25 Aug 2026

**Addressed before the backtest existed, not after.** Ticket #109 shipped the fix described
below — `defensiveMultiplier(expectedScore) = 2 × (1 - expectedScore)`, clamped to `[0, 2]`, the
exact mirror of `attackingMultiplier` and the ratio form of `expectedGoalsConceded` — while item 32
(the backtest) still does not exist. `expectedSaves` in `expectedPoints.ts` is now `savesPer90 ×
minutesFraction × defensiveMultiplier(expectedScore)`, and the multiplier used is surfaced as
`modelInputs.savesMultiplier`. Nothing else in the model moved: not goals, assists, clean sheets,
goals conceded, defensive contribution, appearance, or bonus — this term alone.

**What this does NOT resolve — the caveat stands, deliberately.** Shots faced and goals conceded
are correlated but not identical: a keeper's save count depends on shot volume, while goals
conceded depends on shot quality and his own shot-stopping. Scaling saves by the *same* factor as
goals conceded double-counts the fixture slightly. Ticket #109 shipped anyway on the judgement that
a term with no fixture adjustment at all is further from the truth than one adjusted slightly too
hard, and shipping now beats waiting for a backtest that sits behind the largest piece of work on
the feature list. Whether the double-counting matters more than the gap it replaces is still a
question for the backtest (item 32), not for argument — see G7/G8's "do not act from argument
alone" precedent.

**The original gap, for context.** In `src/lib/projection/expectedPoints.ts`, expected saves were
`savesPer90 × minutesFraction`. Every other attacking and defensive term was adjusted by the
ClubElo-derived fixture number; this one was not. A goalkeeper facing the best attack in the league
was projected for exactly the same number of saves as one facing the worst.

**Why it was wrong.** Saves are a *function of being under pressure*. The same fixture difficulty
that raises a keeper's expected goals conceded should raise his expected saves — they are two
consequences of the same cause. Because save points accumulate in complete groups of three with **no
cap** (`product-brief.md` §6d — a different function from defensive contribution, and a genuinely
uncapped one), the upside for a busy keeper is real and this term is the one that captures it.

**Direction of the error, before the fix.** Goalkeepers at weaker clubs were **undervalued** — they
faced more shots than the model credited them for. Keepers at dominant clubs were marginally
overvalued on saves, though they gained most of their points from clean sheets anyway. The error was
partly self-cancelling: a hard fixture already lowered a keeper's clean-sheet and goals-conceded
terms, so the total moved in roughly the right direction for the wrong reason. That was not the same
as being correct, and it meant the model could not distinguish "cheap keeper at a bad club who saves
a lot" — a well-known FPL value archetype — from "cheap keeper at a bad club who simply concedes."

See the "ADDRESSED" note above for what shipped and the caveat that remains open — not restated
twice in this entry.

---

## G2 — Players with no Premier League history in EITHER season get a generic projection with no signal

**xG/xA half ADDRESSED by ticket #119, 26 Aug 2026 — see below for what remains open.**
Everything else in this entry (the population, why it's not urgent, the non-price parts of the
fix) is otherwise unchanged from the #113 narrowing.

**Narrowed by ticket #113, 26 Aug 2026.** Before #113, "no history" meant no match rows at all,
across the single season then ingested. Now that both the current season and last season are
ingested (see G6), a player only falls back to the pure position prior if he has **no qualifying
rows in either season** — a player with even a couple of 2026/27 appearances now gets a
personal, evidence-shaped projection instead (see G6 for the mechanism). This entry is
narrowed to the population that's left, not resolved: the underlying cause — `player_match_stats`
holds Premier League matches only, and a player who has never featured in one has nothing to read
— is unchanged.

**The gap, as it stands after #113.** The model's rate inputs come from `player_match_stats`. A
player with zero qualifying rows **in both the current season and every historical season ingested**
falls back to the position prior for xG/xA and to the stated no-history default for minutes. Before
#113, on the first live run (15 Aug 2026), **265 of 587 players — 45% — had no historical match rows
at all**; that figure was for a single season and needs re-measuring against the narrower
post-#113 population once the current-season directory is publishing (`job_runs.details`'s
`playersWithNeitherSeasonRows` counter, added by #113, is exactly this number going forward — no
more re-deriving it from a live run by hand).

**Who they are.** Three populations, and only one of them is obvious:

1. Players at the three promoted clubs, who played in the Championship last season **and have not
   yet played a current-season Premier League minute either.**
2. Players signed from outside the Premier League this summer, similarly still waiting on their
   first current-season Premier League appearance.
3. **The largest group, and the one that surprises people: squad-listed players who exist in FPL but
   never played a Premier League minute** — academy players, third-choice goalkeepers, long-term
   injured players, and fringe squad members at established clubs. Every club carries several.

Group 3 is harmless — those players correctly project near zero and would never be recommended.
Groups 1 and 2 are the real cost, and #113 shrinks them the moment either player takes the pitch —
that's the whole point of making the current season load-bearing.

**Direction of the error.** A genuinely good new signing gets an average projection instead of a
good one, so **the model will not recommend him**, and cannot, until he has played at least one
qualifying Premier League minute in some ingested season. Before #113 that meant waiting for enough
history to build a rate at all; after #113, a single current-season match already moves him off the
pure position prior (see G6's two-stage rule) — the wait is shorter, not eliminated.

**Why it is not urgent, and why it is honest.** A player with no Premier League evidence at any
level is a genuine unknown, and returning the position prior is the truthful answer rather than a
confident wrong one. `product-brief.md` §6a's rule applies: **no recommendation beats a wrong one.**
The gap also shrinks every week of the season as real 2026/27 matches accumulate — see G6.

**Shape of the fix, in increasing order of effort.**

- **Surface it rather than model it.** The cheapest and most valuable step. A projection built on
  zero history should be *labelled* as such wherever it is shown, and should drop a confidence band
  (`product-brief.md` §8's clear / marginal / coin-flip). `player_projections.components` already
  carries enough to detect it. This belongs in item 13 or 21, not in a projection ticket.
- **Use price as a weak prior — ADDRESSED for xG/xA by ticket #119, 26 Aug 2026.** FPL's own
  analysts price a new signing according to expected returns, so `players.now_cost` carries real
  information about a player the model otherwise knows nothing about.
  `priceAdjustedPositionPrior`/`priceAdjustmentScale` (`src/lib/projection/rates.ts`) scale a
  no-history player's xG/xA position prior by his price relative to the position's median
  `now_cost`, clamped to `[0.6, 1.8]`. Applied ONLY when a player has zero minutes at every
  ingested level (`scripts/project-points.ts`'s `effectiveRatePositionPrior`) — a player with any
  real minutes is completely unaffected.

  **What this does NOT fix, stated plainly:**
  - **Minutes are untouched.** A no-history player still gets whatever `minutes.ts`'s no-history
    default produces; price says nothing about whether a signing starts, and this ticket does not
    change that model.
  - **Defensive volume (saves, CBI, recoveries) is untouched, deliberately.** Price signals
    attacking expectation, not clearances or tackles — those three rates still fall back to the
    flat position prior for this population, unchanged.
  - **The clamp bounds are not a calibration.** `[0.6, 1.8]` is a stated deliberate
    under-correction — chosen so a correctly-priced outlier can't manufacture false confidence
    (`product-brief.md` §8) — not a value fitted against outcomes. No backtest yet shows the
    price-adjusted estimate lands closer to reality than the flat prior it replaces; that is still
    open work, and belongs with whatever ticket eventually builds the backtest referenced
    throughout this doc.
- **Ingest non-Premier-League history.** Correct in principle, out of scope in practice — it needs a
  new external source, which is a Tier 2 data-source decision and a whole ticket of verification.
  Do not start here.

**Do not "fix" this by dropping the players.** They still need a row in the projections CSV, or the
solver's player pool has a hole in it and it cannot transfer them in at all.

---

## G3 — Bonus points — ADDRESSED by ticket #78, 22 Aug 2026

**Previously:** `bonusPoints` was passed to `totalMatchPoints` as `0`. Bonus needs a BPS
distribution across every player in a match, which is a different shape of input than a
per-player projection has. That was a stated out-of-scope line in ticket #33, not an oversight.

**What ticket #78 did.** `src/lib/projection/bonus.ts` (`expectedBps`, `allocateFixtureBonus`)
projects each match's expected BPS per player from the model's existing inputs — expected goals,
assists, saves, CBI, recoveries, appearance and clean-sheet probability — and shares that
match's 6 real bonus points across every player projected for the fixture **in proportion to
expected BPS above a bare-appearance baseline**. `scripts/project-points.ts` runs this as a
second, fixture-grouped pass after the per-player projection loop, then recomputes each
fixture's `expectedPoints` via `totalMatchPoints` with the allocated bonus filled in.
`projectPlayerFixture` itself still returns `bonusPoints: 0` — projecting bonus needs every
player in the fixture at once, which a single player-fixture function cannot see.

**What this is, stated plainly: a proportional share, not a simulated BPS ranking.** The model
does not attempt to predict which three players will finish 1st/2nd/3rd on BPS and award them
3/2/1 (that is `src/lib/scoring/bonus.ts`'s `allocateBonusPoints`, correct for *settling* a
finished match, wrong for a projection — rejected for this use, see the ticket). It distributes
the six points continuously, in proportion to each player's modelled share of the match's
BPS-above-appearance, clamped at 3.0 per player.

**What is still NOT modelled, unchanged by this ticket.** `player_match_stats` carries six of
the roughly thirty BPS-scoring actions (minutes, goals, assists, saves, CBI, recoveries) — no
passing, dribbling, shots-on-target, key-pass or big-chance data, and no negative BPS terms.
Every BPS term this app cannot see stays invisible to the projection; goalkeeper saves are
approximated at a flat 2 BPS each (no inside-box/big-chance detail); cards remain entirely
unmodelled (G4). **No validation against actual bonus or BPS exists** — `player_match_stats`
records neither, so nothing in this app can currently check whether a projected bonus figure
resembles a real one. That is deferred to the backtest (feature-list item 32).

**Cannot be validated against per-match actuals from this source — settled, verified, ticket
#127, 27 Aug 2026.** The paragraph above already said `player_match_stats` records neither
bonus nor BPS; ticket #127 verified this directly against the source rather than relying on
that recollection — fetching the header of `data/2025-2026/By Gameweek/GW1/playermatchstats.csv`
in FPL-Core-Insights on 28 Aug 2026 confirmed **no `bonus` column and no `bps` column exists at
all**. This is a permanent property of the source, not a temporary ingest gap: there is nothing
to add to `player_match_stats` that would close it, and no future re-ingest fixes it. Sourcing
bonus/BPS from elsewhere is a new-data-source decision (Tier 2) and a whole separate ticket of
verification — not attempted here.

**Consequence ticket #78 introduced for the calibration report, and #127 fixed.** Once this
ticket made the projected side carry real (non-zero) bonus, `scripts/calibration-report.ts` —
which compares projected points against actuals reconstructed from `player_match_stats` — was
comparing a bonus-inclusive projected figure against a bonus-blind actual figure, biasing every
comparison against the model by roughly the size of the bonus term, concentrated at the top of
the distribution (the Top-20 tables, and the G7 defender-captaincy question below). Ticket #127
restored the report to like-for-like by subtracting the projected bonus back out before
comparing — a reporting-side fix only, nothing here in `src/lib/projection/` or in
`player_projections` itself changed. See G7 below for what this means for that open question.

**Direction of the error this fixes.** Before #78, the model systematically **undervalued** the
players who attract bonus most — high-BPS defenders and goalkeepers, and attackers who score —
compressing the gap between the best players and the rest, which is precisely the gap a transfer
or captaincy recommendation turns on (see the worked GW1 case in the addendum below). Ticket #78
narrows that gap; whether it closes it correctly is a question for the backtest, not this file.

---

## G4 — Cards, own goals and penalty misses are not modelled

Small, noisy, and near-impossible to project per-fixture with any skill. Stated out of scope in
ticket #33. Worth revisiting only for players with genuinely extreme booking rates, and probably not
even then.

---

## G5 — The league baseline goals figure is a placeholder until the season has results

`LEAGUE_BASELINE_GOALS_PER_TEAM = 1.45` is used whenever fewer than 20 finished fixtures exist. The
first live run reported `leagueBaselineGoalsSource: "fallback"`, which is correct and expected
before GW1. It supersedes itself automatically once results exist — **but nothing warns anyone if it
somehow never does.** If a `project-points` run in October still reports `"fallback"`, the finished
fixtures are not being ingested and that is a real failure wearing a normal-looking hat.

---

## G6 — ADDRESSED by ticket #113, 26 Aug 2026 — every projection was built entirely on 2025/26 form

**Previously:** `scripts/ingest-core-insights.ts` ingested only the **2025-2026** season, because
2026/27 had no played matches yet at the time it was written. That stopped being true once gameweeks
1 and 2 of 2026/27 were played and published, and nothing read them — a player who had actually
started twice this season was judged purely on last season's form, or on the position prior if he
had none.

**What ticket #113 did.** `.github/workflows/scheduled-jobs.yml` now runs the same
`ingest-core-insights.ts` job twice, once per season (`CORE_INSIGHTS_SEASON=2025-2026` and
`2026-2027`) — no change to the ingest script's own logic, which already took the season as a
parameter. `scripts/project-points.ts` splits each player's `player_match_stats` rows by season
(joined on `player_code`, filtered to `competition = 'prem'` in both) into a current-season set and
a historical set.

**The two-stage rule, stated once, the way every v1 input must be (`product-brief.md` §6d):**
**this season, shrunk toward (last season, shrunk toward the position average).** Concretely, in
`src/lib/projection/rates.ts` and `defconRate.ts`:

1. the player's **historical** rate (or defensive-contribution hit rate), shrunk toward the
   position prior via the existing `SHRINKAGE_K` (rates) / `k = 5` (defcon) formula — this becomes
   his **personal prior**;
2. the player's **current-season** rate, shrunk toward that personal prior, via the identical
   formula.

No fixed percentage anywhere, and no new parameter — the shrinkage formula's own "phantom nineties"
mechanism already produces the right shape: two gameweeks of current-season evidence barely move a
player off his personal prior, and a full season of it dominates. A player with zero current-season
minutes projects identically to the single-stage rate that shipped before this ticket; a player with
no rows in either season still returns the pure position prior, exactly as before. `recentMinutes`
(the last-five-matches window `estimateMinutes` reads) is built the same way — current-season matches
sort ahead of historical ones, so a player who has started twice this season is not judged on last
season's bench appearances. `job_runs.details` now carries `playersWithCurrentSeasonRows`,
`playersWithHistoricalOnlyRows`, `playersWithNeitherSeasonRows` (summing to the total player count)
and `currentSeasonRowsRead`, so the population size behind every figure in this file is checkable
from a live run rather than re-derived by hand.

**What this does NOT resolve — the residual risk is unchanged, and it is behavioural, not
arithmetic.** Both seasons' raw actions are scored under 2026/27's rules (that is what
`src/lib/scoring/` is for, and was already correct before this ticket) — but players change how they
play when the rules reward different actions. Defensive-contribution thresholds already changed how
midfielders press in 2025/26; the 2026/27 BPS change to CBI will move it again. Last season's rates
are a good *prior* for this season's behaviour, not a *measurement* of it. This is the same caveat
`product-brief.md` §9 open question 4 raises about backtest fidelity — ticket #113 makes it resolve
itself faster (current-season evidence now reaches the model at all, and dominates within roughly
`SHRINKAGE_K` nineties, about 3-4 matches for a nailed starter) rather than removing the caveat.

**What this does NOT resolve — the position prior itself.** `positionPriorRates` /
`positionPriorHitRate` are still computed from whatever Premier League rows this job reads across
**both** ingested seasons combined, unchanged by this ticket. Early in the season that is
overwhelmingly last season's data (a couple of current-season gameweeks is a rounding error against
a full season of history), so the position prior itself is not yet meaningfully "this season's
average" — only the *personal* prior, per player, is season-aware. See G2 for the population this
still leaves with no personal signal at all.

---

## G7 — OPEN DIAGNOSIS, 19 Aug 2026: is a defender the right captain?

**Not a known gap — an unresolved question, recorded so it is not lost.** Being worked through
20 Aug 2026.

**The observation.** The GW1 recommendation captained Guéhi, a defender, in a fixture Keshav
identified as a hard one. Across the five-gameweek horizon the solver captained a defender in four of
five gameweeks.

**The mechanism, which is understood.** A defender's projection has a floor a forward's does not:
appearance ≈ 1.95, defensive contribution ≈ 1.15, and a clean sheet worth ≈ 1.4 even in a hard
fixture. That is ≈ 4.5 points before any attacking return, and only the clean-sheet component moves
much with the opponent. A forward starts at 2 for appearing and needs roughly 0.9 expected goals to
reach 5.6 — elite-striker territory. Compounding it, **G3 (bonus not modelled) removes the term that
most favours attackers.**

**What is not yet known.** Whether that floor is *correct*. The 2026/27 defensive-contribution rules
genuinely did raise defender scoring — `product-brief.md` §6d treats defcon as a first-class input for
that reason. So the model may be tracking a real shift, or over-weighting it.

**What settles it, and neither had been run when this was written:**

1. **`player_projections.components` for the gameweek in question**, comparing a top defender against
   the squad's forwards — showing how much of each projection is clean sheet versus defcon versus
   appearance, and what expected-score the fixture was assigned. If the clean-sheet share stays high
   in a hard fixture, fixture weighting is too weak; if it is already low and the defender still tops
   the list, the gap is the missing bonus on the forwards' side.
2. **The calibration report re-run** after the Premier-League filter and the `team_goals_conceded`
   fix — the first time it would run on data that is both league-only and has real clean sheets. If
   defenders genuinely outscore forwards on corrected actuals, the model is right.

**Do not act on this from argument alone.** Both artefacts exist and neither had been read. The
earlier version of this same worry, on 16 Aug, was resolved the *opposite* way by measurement and the
alarm turned out to be unfounded — see the note in G2 and the report's own headline history.

**Artefact 2 is meaningful again — ticket #127, 27 Aug 2026, still outstanding.** Between this
entry being written and now, ticket #78 gave the calibration report's projected side a real
bonus figure while its actual side (built from `player_match_stats`, which has no bonus/BPS
column — verified, see G3) stayed bonus-blind. That silently broke artefact 2: every re-run
would have compared a bonus-inclusive projected total against a bonus-blind actual total,
biasing the comparison against the model by roughly the size of the bonus term — concentrated
exactly at the top of the distribution this question turns on. Re-running it in that state
would have produced a confidently wrong answer to G7, not an answer. Ticket #127 restored the
report to a like-for-like comparison (projected bonus excluded from every total it compares, a
reporting-side fix only — see G3). **Artefact 2 is trustworthy again and is still the
outstanding piece of evidence for G7** — it has not been re-run as part of #127, deliberately
(that ticket's scope is the instrument, not the reading of it). Dispatching the report and
reading its headline is the next step, per the note above: not from argument alone.

## G8 — Fixture sensitivity may be too narrow — ANSWERED, INVERTED: 2 Sep 2026 model review

Surfaced while investigating G7 and untested.

The clean-sheet swing between the easiest and hardest fixture, at `LEAGUE_BASELINE_GOALS_PER_TEAM =
1.45`, is roughly 0.24 to 0.48 probability — about one point of projected value for a defender. Real
FPL experience suggests the gap between facing a promoted club and facing a title contender is worth
more than a point.

Two candidates, both untested: the elo-to-goals mapping (`2 × (1 - expectedScore)`) may compress the
range, and `leagueBaselineGoals` is still on its pre-season fallback constant rather than computed
from results. **The second resolves itself once the season has fixtures with scores** — which makes
this worth re-measuring after a few gameweeks rather than tuning now.

**Answered, and in reverse — 2 Sep 2026.** `docs/model-review-2026-09-02.md` §1b measured this
directly, bucketing every resolvable 2025-26 team-match by point-in-time `expectedScore` and
comparing actual outcomes to the model's implied response. The model's fixture sensitivity is not
too narrow — it is **too wide, on both sides**:

- **Goals.** The model's implied slope is 2.9 points of goals per unit of `expectedScore`
  (`attackingMultiplier = 2 × es`); the measured actual slope is ≈1.43.
- **Clean sheets.** The model's clean-sheet probability spans 11%→48% across the easiest-to-hardest
  fixture buckets; the actual clean-sheet rate spans 9%→39% over the same buckets.

Source: review §1b's bucket table, n=698 resolvable 2025-26 team-matches, bucketed by point-in-time
`expectedScore`.

**The attacking half is addressed — ticket #184.** `attackingMultiplier` changed from `2 × es` to
`0.5 + es` (`src/lib/projection/fixture.ts`'s `ATTACKING_MULTIPLIER_OFFSET`), damping the slope to
match the measured ≈1.43.

**The defensive half is untouched, deliberately — see G12, below.** The same overshoot exists on
the `expectedGoalsConceded`/`defensiveMultiplier` side, and it must not be damped the same way
without its own in-harness measurement first. G12 records why and what that measurement is.

---

## G3 addendum — the worked case, 21 Aug 2026

**Historical record — pre-#78.** The table below reflects the model as it stood before ticket
#78 (22 Aug 2026) projected bonus. It is kept exactly as computed at the time as the evidence
that motivated the ticket; it is not re-run here. See the G3 entry above for what changed and
what did not.

G7's open question resolved into a concrete, verified example. GW1 captaincy, both projections
recomputed from their raw inputs and confirmed arithmetically exact:

| Component | Haaland (FWD) | B. Fernandes (MID) |
|---|---|---|
| Goals | **3.49** | 1.91 |
| Assists | 0.30 | **1.24** |
| Appearance | 1.80 | **2.00** |
| Clean sheet | 0 | **0.34** |
| Defensive contribution | 0.00 | **0.30** |
| **Bonus** | **0** | **0** |
| **Total** | 5.59 | **5.79** |

**The model is not wrong. It is incomplete, and the incompleteness decides the outcome.** Haaland
wins on goals by 1.58 and loses everything else by 1.79 — expected minutes of 72 against 90 scaling
his goal output down a fifth and costing 0.2 appearance points, plus 0.64 points of clean sheet and
defensive contribution a striker cannot earn.

**The 0.20 gap is inside the noise of a ~5.7 projection**, and the one term missing entirely —
bonus — plausibly favours Haaland by more than that. A striker who scores almost always tops the
bonus chart.

**Two secondary observations from the same data.** Haaland's `pSixtyPlus` of 0.8 implies a
one-in-five chance of not reaching an hour, which is pessimistic for a nailed starter. And
Fernandes' fixture used the FPL-difficulty fallback (`eloFallbackUsed: true`, `expectedScore` exactly
0.625) because Manchester United face one of the three promoted clubs with no ClubElo rating — so
the two players were not rated on the same instrument.

**Consequence for the interface, and it is a real requirement:** the captain choice needs its own
confidence signal. A 0.20-point coin-flip is currently presented as a decision, which is exactly
what `product-brief.md` §8 forbids for the transfer decision and never extended to captaincy.

---

## G9 — Backtest harness (item 32, first slice), 28 Aug 2026 — what it measures, what it does not

Ticket #133. Every entry above compared distributions with full-season hindsight, or reasoned
from a single worked example (G7/G8's "do not act from argument alone" — this is the "measure it"
half of that precedent). `scripts/run-backtest.ts` is the first thing in this project that
measures a **per-player, per-gameweek, point-in-time projection** against what actually happened,
using `feature_history`'s strictly-before guarantee (ticket #121/#125) so nothing on the projected
side could not actually have been known before that gameweek.

**What this slice measures.** For every `feature_history` row with `prior_matches > 0` whose
player featured that gameweek (and whose actual reconstruction has a known
`team_goals_conceded`), it projects one points figure from `src/lib/projection/`'s own combiner
and compares it against the actual points reconstructed from `player_match_stats` via
`src/lib/scoring/`. Mean absolute error and mean signed error, overall, by position and by
gameweek. Bonus is absent from both sides (the actual side has no bonus column, verified — #127
— and the projected side's `bonusPoints` is hardcoded to 0 here, never allocated). Two sanity
bounds (overall MAE in [1.0, 3.5]; no position's derived clean-sheet rate above 60%) fail the
report, naming the figure, rather than printing a number nobody checked.

**What this slice deliberately does not measure.** No transfers, no captaincy, no solver, no
season league position — replaying a manager's actual decisions across a season is item 32's
remaining, much larger, work. This slice establishes the measurement substrate only: can the
*projection* be trusted, gameweek by gameweek, with no hindsight. Whether the *recommendation*
built on top of that projection would have been good is still open.

**Three approximations this slice's method carries, all Tier 2, all because `feature_history`
stores cumulative totals rather than a per-match history:**

1. **Minutes and defensive-contribution hit rate are estimated from one averaged "typical match"**
   (average minutes per prior match; average CBIT/CBIRT per prior match), fed unmodified into
   `minutes.ts`'s `estimateMinutes()` and `defconRate.ts`'s `estimateDefconHitRate()` — the same
   functions the live pipeline uses, given a single representative match instead of a true
   last-five-match window or true per-match hit/miss history. This answers "did the *average*
   match cross the threshold", not the real match-to-match distribution — a genuine source of
   error this backtest's own sanity bounds partly exist to catch.
2. **Every row is projected against a neutral fixture** (`fplDifficulty = 3`, which
   `fixture.ts`'s own difficulty table resolves to `expectedScore = 0.5` — every multiplier
   exactly 1.0) because `feature_history` carries no opponent, no elo, no FDR at all. Real
   fixture swings (G8, above) are entirely absent from this slice's projections.
3. **Availability is assumed 1.0 (fully available) for every row** — `feature_history` carries no
   historical `players.status`/`chance_of_playing` for a past season, and today's status says
   nothing about a gameweek two seasons ago.

**Two known data gaps, carried forward, not solved here (ticket text: "count both, report both,
fix neither").** `player_match_stats.team_goals_conceded` is ~98% populated for 2025-2026 (the
~2% gap excludes that row from the measured population, counted under `actualDataIncomplete` —
see the report's own population section); 2,520 `player_match_stats` rows for 2025-2026 have an
unresolvable `player_code` and were already excluded when `feature_history` itself was built
(ticket #121/#125) — this backtest inherits that exclusion rather than re-deriving it.

**The recommendation-level backtest remains open.** Once this slice's own numbers are read (a
live run against the real 18,243 `feature_history` / ~15,000 `player_match_stats` rows — not
possible from the Builder session that shipped this ticket, since a new `workflow_dispatch`
workflow cannot run until its file is on the default branch), the natural next question is
whether the *projection* errors measured here are small enough, and unbiased enough by position,
to trust replaying transfers and captaincy on top of them — item 32's remaining work.

---

## G10 — Ticket #140, 28 Aug 2026: the first backtest run's two open questions, and the fixture-count fix

G9's first live run (28 Aug 2026) passed its sanity bounds — season MAE ~1.83, in
`[MAE_LOWER_BOUND, MAE_UPPER_BOUND]` — and its own output raised two questions the ticket text
answered inside the harness, because both are questions about the measurement, not the model.

**1. Gameweek 33's error was triple the season norm (MAE 2.532 vs ~1.83, n=240 vs ~236 — a
normal sample size, an abnormal error) — CLOSED, the mechanism was real.** G9's three documented
approximations (above) never included one for multi-fixture gameweeks: `feature_history` is one
row per (player, gameweek), so before this ticket the projected side always built exactly one
neutral fixture per gameweek, while the actual side (correctly) summed every matching
`player_match_stats` row — two rows, and double the real points, for a player whose team played
twice. Ticket #140 closes this: `run-backtest.ts` now projects as many neutral fixtures as the
actual side found rows for that (player, gameweek) — `aggregateActualForGameweek`'s own
`matchesFound`, the exact count the actual side already sums — via `projectPlayerGameweek`'s
existing (unmodified) fixture-array summation. The by-gameweek table now carries a
"Multi-fixture rows" column, and a dedicated diagnostic section reports the season headline with
and without multi-fixture player-gameweeks, flagged prominently if excluding them moves the MAE
by more than 0.05. **This was a hypothesis with a clear test, not a confirmed finding, until a
live run reads it** — the human check after merge (dispatching "Backtest" and reading whether
gameweek 33's error came back toward ~1.8) is what confirms it; #140's own tests prove the
arithmetic on constructed rows only.

**2. Defensive contribution's signed error is the model's single largest component error, and
the calibration report disagrees — OPEN, a diagnostic now exists to separate the two
explanations, neither ruled out.** From the same first run: mean actual defcon 0.259, mean
projected defcon 0.070 — the model captures only 27% of it, the largest single component error
and the biggest contributor to the -0.524 overall bias. `scripts/calibration-report.ts`
(full-season hindsight, ticket #133/#127) reports defcon at 0.88x for defenders — nearly
right — over the same season. **Both figures are true simultaneously, and that is the
puzzle, not a contradiction to resolve by picking one.**

Two competing explanations, and this ticket's own text is explicit that **choosing between them
from this evidence alone would be guessing, not measuring:**

- **Cold-start explanation.** `defconRate.ts`'s `estimateDefconHitRate()` shrinks toward the
  position prior using `k = 5` phantom matches. Early in a player's history (few prior matches),
  the estimate is dominated by the position prior rather than his own rate — the model is
  *correctly* cautious with little evidence, and the gap should shrink as `prior_matches` rises
  within a season. If this is the whole story, the error resolves itself as the season
  progresses and needs no model change.
- **Level explanation.** The shrinkage formula, or `k = 5` itself, is miscalibrated — the model
  under-projects defcon even with substantial history, and the gap does not close as
  `prior_matches` rises. If this is (also) true, `calibration-report.ts`'s full-season hindsight
  view is the wrong instrument to have judged this by: full-season rates and point-in-time
  estimates answer different questions, and only the second is what a live, mid-season
  recommendation actually runs on.

**Ticket #140's diagnostic is built to distinguish these, not to answer which is true.**
`run-backtest.ts` now buckets every measured row's defcon signed error (`projected -
actual`, defcon component only) by `prior_matches` — 1–4, 5–9, 10–19, 20+ — with sample size
beside each figure, and a bucket under 50 rows is reported as "too small to read" rather than
guessed at (same rule `src/lib/accuracy/derive.ts`'s `MIN_SAMPLE_SIZE` uses for the in-app
rolling accuracy display, ticket #123). The overall signed error is bucketed identically, for
comparison. **A shrinking gap across rising buckets points at cold start; a flat gap points at a
level problem** — but reading that verdict is explicitly deferred to the human dispatching a
live run, per the ticket text: **do NOT tune `k`, the shrinkage formula, or any constant in
`defconRate.ts` from this evidence** (or from #140 at all — #140 touches
`scripts/run-backtest.ts` only, nothing under `src/`). Whichever explanation the buckets
support is a later ticket's work.

**Two more measurement gaps this ticket reports, not fixes.** A genuine blank gameweek (a
player's team had no fixture at all — a postponement, not a benching) is now its own exclusion
reason, `blankGameweek`, distinct from `didNotFeature` (team played, player just didn't
feature) — inferred from `player_match_stats.match_id`'s own team-slug text, since this job has
no independent fixture-schedule table for a past season. And the unresolved-`player_code`
exclusion — 4,209 of 18,243 rows in the first run, `feature_history`/#121's own known gap — is
now reported as a percentage (23%) alongside the count, so its size doesn't require doing the
division by hand to notice.

**Question 2 CLOSED, 2 Sep 2026 — cold start, not a level problem.** The bucketed diagnostic
this ticket built is read for the first time in backtest report 7 (ticket #175 slice), and the
2 September model review (`docs/model-review-2026-09-02.md`, §1b) confirms the reading:

| prior_matches bucket | 1–4 | 5–9 | 10–19 | 20+ |
|---|---|---|---|---|
| defcon signed error | −0.057 | −0.059 | −0.045 | +0.006 |

A gap shrinking to ~zero as evidence accumulates is exactly this entry's own stated test for
**cold start** ("a shrinking gap across rising buckets points at cold start; a flat gap points at
a level problem") — not the level/miscalibration explanation, which would have stayed flat. The
estimator is behaving correctly: it is appropriately cautious with little evidence and converges
as evidence builds. This entry's standing instruction stands, now on a stronger basis: **do NOT
tune `k`, the shrinkage formula, or any constant in `defconRate.ts`** — `k = 5` is confirmed as
not the problem, not merely un-implicated.

**The #154 instrument caveat — do not read the improvement as a model gain.** Report 7's defcon
figures above are only readable at all because ticket #154 first fixed a defect in the *harness*,
not the model: before #154, `buildDefconMatches` returned a single averaged match, which capped
evidence at 1 against the `k = 5` shrinkage formula forever — `prior_matches` was structurally 0
or 1 for every row, regardless of how much history a player actually had. Under that defect,
overall defcon signed error read −0.191. After #154 restored real per-match evidence counts, the
same overall figure reads −0.035 (report 7's by-component table). **That −0.191 → −0.035 change
measures the instrument being fixed, not the model getting better** — stated explicitly so a
future reader does not credit `defconRate.ts` with an improvement that happened in
`buildDefconMatches` instead.

---

## G11 — Ticket #147, 28 Aug 2026: ranking skill — a different question from calibration, and it is
## still open

G9/G10 (above) measure how close the model's *numbers* are — mean absolute error, mean signed
error, defcon and clean-sheet calibration. **Every decision this app makes is a ranking decision**:
the captain is by definition the squad's highest-projected player, and a transfer is a claim that
one player will outscore another. A model can have a poor absolute error and excellent ranking, or
the reverse — `product-brief.md` §8's confidence bands exist precisely because *"the gap between the
top three transfer options is routinely under one point,"* a statement about ordering, not
magnitude. Nothing before this ticket measured whether that ordering is any good.
`scripts/calibration-report.ts` tried and could not: it compares two independent top-20 lists not
paired by player, because full-season hindsight on both sides gives it no point-in-time basis to
pair them on. `feature_history`'s strictly-before guarantee (the same one G9 uses) provides one.

**What this slice measures, over the exact same measured population G9/G10 already build (no new
Supabase read, no change to the exclusions or the reconciliation).** Two ranking-skill figures,
each reported per gameweek, per position, and as a season aggregate:

- **Spearman rank correlation** between projected and actual points — tied values (common: many
  rows project identically at the position prior) share the average of the ranks they would
  occupy, the standard tie correction. 1 is perfect agreement, −1 is perfect reversal, 0 is no
  relationship.
- **Top-10 / top-20 overlap** — of the rows ranked in the model's top 10 (or top 20) that gameweek
  by projected points, how many were also in the top 10 (or top 20) by actual points. Closer to
  what the app actually does than a correlation coefficient is: a captain choice or a transfer
  looks at the top of a list, not the whole ordering.

A gameweek under 50 measured rows (`MIN_BUCKET_SAMPLE_SIZE`, the same threshold G10's buckets use)
is reported "too small to read", never as a correlation nobody could trust. Sanity bounds — a
Spearman correlation outside [−0.2, 0.9], or a top-10 overlap above 9 of 10 — fail the report,
naming the figure, checked on the season aggregate and on each position. **The upper bound matters
more than the lower one: a suspiciously good correlation is the shape a lookahead leak takes** — if
actual points reached the projected side, the model would appear to predict beautifully and every
population count would still reconcile.

**What this slice deliberately does not measure, still.** No replay of transfers, captaincy against
a real squad, or league position — there is no stored squad for 2025-26 (the app did not exist
that season), so a genuine captaincy replay is not possible and inventing one would measure
nothing. This remains item 32's open, larger work. Whether the model's *ranking* is good enough to
trust a replay on top of it is exactly what this slice exists to answer — and it draws no
conclusion of its own about that; reading the figure is deliberately left to the human dispatching
a live run.

**The live number is not yet read.** As with G9, this Builder session has no live Supabase project
and no way to run a new `workflow_dispatch` job before its file reaches the default branch — every
test here proves the statistics on constructed rankings (perfect agreement, perfect reversal, a
hand-computed 6–8 player case, three tied projections, each sanity bound), not that the figure
produced from the real ~8,500+ measured rows is meaningful. **Read it against expectation before
believing it**, per the ticket's own guidance: something in the 0.3–0.6 Spearman range is what a
real, useful, imperfect projection model looks like; above 0.8 suggests a leak; below 0.1 suggests
the model has no ranking skill at all and the whole recommendation approach needs rethinking. Both
extremes are findings, neither should be assumed, and this is the open question G11 leaves for that
first live run.

---

## Forward assists — CLOSED, 2 Sep 2026: expected roster-churn artefact, not actionable

Calibration report 6 reads forward assists at **0.70x** after three separate tickets aimed at the
assist conversion gap — #148, #168 and #177 — with three hypotheses raised and refuted along the
way. `docs/model-review-2026-09-02.md` §1e explains why the figure would not move further no
matter how many more of those tickets ran, and closes the workstream.

**The explanation is the instrument's design, not the model.** Calibration report 6 compares the
**2026/27 roster's** projections against the **2025/26 population's** actuals — a cross-population
comparison by construction. Ticket #168 measured the difference between those two populations
directly, and it is precisely assist-shaped: departed forwards' xA/90 was 0.073, retained forwards'
0.055. A cross-population distributional comparison cannot resolve a within-position component
level that sits below the size of ordinary summer roster churn — the 0.70x is consistent with
comparing a different set of forwards to a different set of forwards, not with the model
mis-projecting assists for the players actually on the pitch this season.

**The better instrument agrees the component is fine.** The backtest — paired point-in-time,
same players on both sides, no cross-population gap — puts the whole assist component's signed
error at **−0.020 points per row** (backtest report 7's by-component table).

**The construction itself was tested too, and gains nothing.** Predicting assists from shrunk
*actual* assist rates instead of xA — the natural alternative construction — scores season Spearman
0.325, against 0.326 for the xA+factor construction already shipped. No improvement.

**Record:** 0.70x on calibration report 6 is expected, given how that report is built, not a sign
of a model defect. The assist workstream is closed; no further ticket should chase this figure.

---

## G12 — The defensive multiplier overshoots symmetrically to G8's attacking side, and must not be
## damped without its own in-harness measurement

The same review §1b bucket table that resolved G8 shows `expectedGoalsConceded` /
`defensiveMultiplier` overshooting real outcomes in the same direction and by a similar shape as
the attacking side did — **deliberately left alone**, unlike the attacking multiplier (#184).

**Why it must stay alone.** Goalkeeper and defender ranking is this model's clearest measured
win, and it depends on that spread: the review's neutral-fixture variant (multiplier forced to
1.0 for every fixture) collapses goalkeeper Spearman from 0.168 to **−0.017**. Whatever the
defensive multiplier's exact shape error is, removing or naively damping the spread it produces
would cost the one part of the model that is unambiguously working, not just correct a level
error.

**Why a same-shape fix (mirroring #184) is not safe here.** The empirical clean-sheet curve is
steeper than a Poisson model with a damped λ produces — damping `expectedGoalsConceded`'s slope
(and therefore λ, since `pCleanSheet = exp(−λ)`) would change the *shape* of the clean-sheet
curve, not just narrow its ends the way `0.5 + es` narrowed the attacking side. The attacking fix
was a slope change that reproduced the bucket means almost exactly; the same move is not shown to
do that here.

**The findable pointer already exists in code.** `src/lib/projection/fixture.ts`'s own comment on
`ATTACKING_MULTIPLIER_OFFSET` already warns: "Do not extend this reasoning to `defensiveMultiplier`
without its own separate measurement and ticket." This backlog entry is that warning's matching,
findable entry — the measurement it calls for has still not been done.

**Next step, recorded as this entry's own.** An in-harness variant sweep over the defensive slope
in `scripts/run-backtest.ts`, read on goalkeeper and defender Spearman **and** clean-sheet
calibration together — not MAE alone, since MAE would not by itself catch a ranking collapse like
the neutral-fixture variant's.

**Batching conflict — note this before scheduling that work.** That sweep touches
`scripts/run-backtest.ts`. Ticket #187 is editing that same file in this very batch (2 Sep 2026).
G12's proposed work must not be batched alongside a ticket already editing `run-backtest.ts` — it
waits for a future batch.

---

## G13 — CORRECTED, 3 Sep 2026. The 5-gameweek oracle was NOT mis-specified. The model side was
## reading point-in-time state from inside the target window, at three separate lookups

**This entry previously recorded the wrong cause and is superseded by what follows.** It said
ticket #183's 5-gameweek quality oracle was specified in the wrong units — a per-match *rate*
scored against a *totals* target — and that this explained the impossible-looking ordering. That
diagnosis was wrong. The oracle was correctly specified. The defect was on the model side, and it
was a lookahead leak.

**What was actually wrong.** `scripts/run-backtest.ts` builds a 5-gameweek window by projecting
each leg G..G+4 separately and summing. The app it is measuring plans that whole horizon **once,
at G**, from the state visible at G. But `projectAndReconstructWindowGameweek` keyed three
point-in-time lookups on the **leg's** own gameweek G+i instead of the window's **start** G:

1. `featureHistoryByPlayerGameweek.get(windowKey(playerCode, gameweekId))` — the player's
   `prior_*` form, minutes and xG/xA as of G+i.
2. `computeTeamStrengthAsOf(teamMatchRecords, ..., gameweekId)`, at **both** call sites — his own
   club's and his opponent's strength as of G+i.
3. `positionPriors.get(positionPriorKey(gameweekId, position))` — the position baseline as of G+i.

Every one of those reads state from **inside the window being predicted**. A leg-4 projection knew
how the player and both clubs had been going for three gameweeks the app had not yet lived
through. The published fixture *schedule* for G..G+4 is genuinely known at G — who you play and
how often — and that part was always correct and stays keyed on the leg. The *form* of everyone in
it is not.

**Why it produced an impossible ordering.** A hindsight oracle bounds a model only if the model has
no hindsight of its own. With three leaks feeding it, the model scored **0.728** against a genuine
hindsight oracle's **0.506** — the model beating the ceiling built to bound it. That is not a model
finding and never was; it is `checkOracleCeiling` doing exactly its job. **The bound is the thing
that caught this, and it must not be relaxed or removed.**

**Ticket #187's oracle rewrite was a no-op against the real defect.** #187 read the same
impossible ordering, accepted the units diagnosis this entry used to carry, and rewrote the
5-gameweek oracle to `out-of-window points-per-match × out-of-window appearance rate × horizon`.
That rewrite is defensible on its own terms and is left in place — but it addressed a side of the
comparison that was not broken, so the ordering it was meant to fix survived it. The fix is on the
model side: `projectAndReconstructWindowGameweek` now takes `featureGameweekId` (G) and
`legGameweekId` (G+i) as separate, individually-documented arguments, and the three lookups above
read `featureGameweekId`.

**This also settles #187's own flagged residual.** `decisions/ticket-187.md` recorded, as an
explicit unproven hypothesis, that the gap between `docs/model-review-2026-09-02.md`'s independent
prediction (0.425) and the shipped run (0.672) might be the review's Python taking a "one
projection × 5" shortcut. It was the other way round: the review's reconstruction had no lookahead
and this harness did. That hypothesis is closed.

**The general lesson about bounds and units still stands, and is still true** — a bound is only a
bound if it is computed in the same units as the thing it bounds; a rate is not a total. It simply
is not what happened here, and reaching for it first cost a ticket. **The second lesson, which is
the one this episode actually teaches:** when a hindsight bound is breached, suspect the *model*
side first. The oracle is usually the simpler construction and the easier one to re-read, which is
exactly why it attracts the blame.

**A note on how to read the two figure pairs this entry used to present.** 0.672/0.507 (#183's run)
and 0.728/0.506 (post-#187) are both leaked model figures against honest oracles. Neither model
number is a valid measurement of this model's 5-gameweek ranking skill, and neither should be
quoted as a baseline. The first trustworthy 5-gameweek figure is whatever the next full run
produces against the fixed harness.

### G13 addendum — ticket #193, 3 Sep 2026: the 3 Sep fix closed THREE lookups. There was a fourth, larger one, in the same function

**The 3 Sep fix (commit `5a99d6e`) was correct and incomplete.** It closed the three point-in-time
lookups listed above — the `feature_history` row, both `computeTeamStrengthAsOf` calls and the
position prior — each of which had been keyed on the leg's own gameweek G+i. Backtest report 9,
run the same day *with that fix in place*, still failed its oracle-ceiling check at the 5-gameweek
horizon: model **0.619** against a genuine hindsight oracle's **0.506**. A model still beating its
own ceiling means a leak still remained, and it did — in the same function, one paragraph below the
three that were fixed.

**The fourth leak: the leg's fixture count came from the player's own appearances.**
`projectAndReconstructWindowGameweek` took each leg's fixture count from
`aggregateActualForGameweek`'s `matchesFound` — the number of that **player's own**
`player_match_stats` rows for that gameweek — and its opponents from those same rows. So when the
player did not feature in a leg, `actualRows` was empty, `matchesFound` was 0, the projection was
built from an empty fixture array, and the leg projected **exactly 0** against an actual of
**exactly 0**. The harness was telling the model, in advance, which of the five weeks the player
would miss.

That is not a small leak at this horizon. A 5-gameweek points total is dominated by how many of the
five weeks a player turns up for, and `docs/model-review-2026-09-02.md` §1f measures minutes as
carrying roughly **85%** of the model's whole ranking signal. In report 9's own single-gameweek
population, **6,913 of 12,567** rows with a matching actual entry were non-appearances.

**The fix: the club's published schedule, never the player's appearance.** How many fixtures a club
plays in a gameweek, and who it plays, are published *before* the horizon starts — legitimately
known at G, exactly like the opponent identity this entry already said "was always correct and
stays keyed on the leg". Whether *this particular player* is in the team is not. Ticket #193 adds
`buildClubFixtureSchedule`, built from the same `player_match_stats` rows the job already fetches
(no new Supabase read, no new column, no migration), keyed by `(team_code, gameweek)` and returning
one entry per distinct `match_id` — so a double gameweek returns two. Unlike `buildTeamMatchRecords`
it is deliberately **not** filtered on goals-resolvability: a match that happened is a match that
was scheduled, and a schedule needs no goals. Each leg now derives its fixture count and opponents
from that schedule at `(the START row's team_code, the leg's own gameweek)`. `actualRows` supplies
the leg's actual points and nothing else.

Three consequences the report now names and counts: legs whose fixture count came from the club
schedule; legs where the club had **no** fixture (a genuine blank gameweek — 0 fixtures, a
legitimate zero on both sides, never a fabricated neutral fixture); and legs where the club **did**
play but the player did not feature — the exact size of the leak being closed. A window whose start
row carries no `team_code` cannot resolve the schedule for any leg and is excluded by name
(`unresolvedTeamCode`), reconciling like every other reason.

**One approximation, stated not hidden.** The schedule is reconstructed from matches that were
actually *played* — this job still has no independent fixture-schedule table for a past season
(the same limitation G10 records for its team-slug inference). A fixture postponed after its
horizon began is therefore indistinguishable from a club that never had one; both read as a blank
gameweek. That is a known bound on this instrument, not a defect to fix inside it.

**Nothing above the 5-gameweek heading in the report moved.** The single-gameweek section excludes
non-featuring rows before anything is projected, so `matchesFound` is always at least 1 there and
#140's multi-fixture approximation stands exactly as designed. MAE, mean signed error and the
one-gameweek Spearman are unchanged by this ticket.

**Report 9's and report 10's 5-gameweek sections are not comparable to each other**, for the same
reason the note above gives for 0.672 and 0.728: report 9's 0.619 is a leaked figure. It should not
be read as a regression when the number falls — a fall is this fix working. **And the
oracle-ceiling bound stays exactly as it is.** It has now caught two distinct leaks in this one
construction; it is the most productive check in this harness, and the standing instruction not to
relax, widen, downgrade or remove it is reinforced, not weakened, by the fact that it fired twice.

**MEASURED, 3 Sep 2026 — both falsification conditions hold.** Run against live Supabase data on
the ticket branch (workflow run 33757203659), read from the uploaded report:

| Falsification figure | Result |
|---|---|
| Legs where the club had a fixture but the player did not feature | **6,836** of 36,736 G+1..G+4 legs (**18.6%**) |
| 5-gameweek model Spearman | **0.397** (n=9,184), down from report 9's leaked 0.619 |
| 5-gameweek quality oracle Spearman | **0.506** — the model now sits BELOW its own ceiling |

The leg arithmetic reconciles exactly: 36,232 legs with a fixture + 504 blank-gameweek legs =
36,736 = 9,184 windows x 4 legs. The 0.222 fall cannot be an artefact of the new
`unresolvedTeamCode` exclusion, which removes roughly 1% of rows — a population change that size
cannot move a rank correlation that far. **0.397 is the first trustworthy 5-gameweek figure this
project has produced**, and it is the number every later model decision should be read against. It
sits close to `docs/model-review-2026-09-02.md`'s independent leak-free prediction of 0.425, which
is the second, independent confirmation.

**Still open after this ticket:** the ONE-gameweek oracle-ceiling failure (oracle 0.336 below model
0.345). That is a separate problem with a separate cause and gets its own ticket — the Backtest job
will still exit 1 after #193 merges, and that exit is not #193 failing.
