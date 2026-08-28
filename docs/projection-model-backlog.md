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

## G8 — Fixture sensitivity may be too narrow

Surfaced while investigating G7 and untested.

The clean-sheet swing between the easiest and hardest fixture, at `LEAGUE_BASELINE_GOALS_PER_TEAM =
1.45`, is roughly 0.24 to 0.48 probability — about one point of projected value for a defender. Real
FPL experience suggests the gap between facing a promoted club and facing a title contender is worth
more than a point.

Two candidates, both untested: the elo-to-goals mapping (`2 × (1 - expectedScore)`) may compress the
range, and `leagueBaselineGoals` is still on its pre-season fallback constant rather than computed
from results. **The second resolves itself once the season has fixtures with scores** — which makes
this worth re-measuring after a few gameweeks rather than tuning now.

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
