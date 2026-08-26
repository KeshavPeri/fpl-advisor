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

## G2 — Players with no Premier League history get a generic projection with no signal

**The gap.** The model's rate inputs come from `player_match_stats`, which holds **Premier League
matches only**. A player with no rows falls back to the position prior for xG/xA and to the stated
no-history default for minutes. On the first live run (15 Aug 2026) **265 of 587 players — 45% —
had no historical match rows at all.**

**Who they are.** Three populations, and only one of them is obvious:

1. Players at the three promoted clubs, who played in the Championship last season.
2. Players signed from outside the Premier League this summer.
3. **The largest group, and the one that surprises people: squad-listed players who exist in FPL but
   never played a Premier League minute** — academy players, third-choice goalkeepers, long-term
   injured players, and fringe squad members at established clubs. Every club carries several.

Group 3 is harmless — those players correctly project near zero and would never be recommended.
Groups 1 and 2 are the real cost.

**Direction of the error.** A genuinely good new signing gets an average projection instead of a
good one, so **the model will not recommend him**, and cannot, until he has played enough Premier
League minutes to build a rate. For a GW1 deadline this is a live blind spot: exactly the players a
human is most excited about are the ones the model is quietest about.

**Why it is not urgent, and why it is honest.** At GW1 *nobody* has 2026/27 data — every projection
in the system is running on last season's Premier League form. A player with no such form is a
genuine unknown, and returning the position prior is the truthful answer rather than a confident
wrong one. `product-brief.md` §6a's rule applies: **no recommendation beats a wrong one.** The gap
also shrinks every week of the season as real 2026/27 matches accumulate.

**Shape of the fix, in increasing order of effort.**

- **Surface it rather than model it.** The cheapest and most valuable step. A projection built on
  zero history should be *labelled* as such wherever it is shown, and should drop a confidence band
  (`product-brief.md` §8's clear / marginal / coin-flip). `player_projections.components` already
  carries enough to detect it. This belongs in item 13 or 21, not in a projection ticket.
- **Use price as a weak prior.** FPL's own analysts price a new signing according to expected
  returns, so `players.now_cost` carries real information about a player the model otherwise knows
  nothing about. Blending a price-derived prior into the position prior, weighted only when history
  is absent, is a small change and a genuine improvement. Needs a stated calibration, so it wants
  the backtest.
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

## G6 — Every projection is currently built on 2025/26 form, under 2026/27 scoring rules

`scripts/ingest-core-insights.ts` ingests the **2025-2026** season by design — 2026/27 has no played
matches yet. But the 2026/27 BPS rebalance and the defensive-contribution rules mean last season's
raw actions are being scored under this season's rules. That is the correct thing to do and it is
what `src/lib/scoring/` exists for.

The residual risk is **behavioural, not arithmetic**: players change how they play when the rules
reward different actions. Defensive-contribution thresholds already changed how midfielders press in
2025/26; the 2026/27 BPS change to CBI will move it again. Last season's rates are a good prior for
this season's behaviour, not a measurement of it. This is the same caveat `product-brief.md` §9
open question 4 raises about backtest fidelity, and it resolves itself as 2026/27 matches
accumulate.

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
