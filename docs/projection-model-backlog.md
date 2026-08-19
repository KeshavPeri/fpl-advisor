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

## G1 — Goalkeeper saves do not scale with fixture difficulty

**The gap.** In `src/lib/projection/expectedPoints.ts`, expected saves are
`savesPer90 × minutesFraction`. Every other attacking and defensive term is adjusted by the
ClubElo-derived fixture number; this one is not. A goalkeeper facing the best attack in the league
is projected for exactly the same number of saves as one facing the worst.

**Why it is wrong.** Saves are a *function of being under pressure*. The same fixture difficulty
that raises a keeper's expected goals conceded should raise his expected saves — they are two
consequences of the same cause. Because save points accumulate in complete groups of three with **no
cap** (`product-brief.md` §6d — a different function from defensive contribution, and a genuinely
uncapped one), the upside for a busy keeper is real and this term is the one that captures it.

**Direction of the error.** Goalkeepers at weaker clubs are **undervalued** — they face more shots
than the model credits them for. Keepers at dominant clubs are marginally overvalued on saves,
though they gain most of their points from clean sheets anyway. The error is partly self-cancelling:
a hard fixture already lowers a keeper's clean-sheet and goals-conceded terms, so the total moves in
roughly the right direction for the wrong reason. That is not the same as being correct, and it
means the model cannot distinguish "cheap keeper at a bad club who saves a lot" — a well-known FPL
value archetype — from "cheap keeper at a bad club who simply concedes."

**Shape of the fix.** The defensive mirror of the attacking multiplier already exists in
`fixture.ts`: `expectedGoalsConceded` is `leagueBaselineGoals × 2 × (1 - expectedScore)`. A saves
multiplier is the same quantity in ratio form — `2 × (1 - expectedScore)`, clamped, applied to
`savesPer90`. That keeps the "explainable in one sentence" property: *a keeper facing a team twice
as likely to score faces roughly twice the shot volume.* It is a small, pure, testable change
confined to `expectedPoints.ts` and `fixture.ts`.

**What to be careful about.** Shots faced and goals conceded are correlated but not identical — a
keeper's save count depends on shot volume, while goals conceded depends on shot quality and his own
shot-stopping. Scaling saves by the *same* factor as goals conceded double-counts the fixture
slightly. Whether that matters more than the current gap is a judgement worth making with the
backtest (item 32) rather than by argument.

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

## G3 — Bonus points are not modelled

`bonusPoints` is passed to `totalMatchPoints` as `0`. Bonus needs a BPS distribution across all 22
players in a match, which is a different shape of input than a per-player projection has. This is a
stated out-of-scope line in ticket #33, not an oversight.

**Direction of the error.** Systematically **undervalues** the players who attract bonus most —
high-BPS defenders and goalkeepers, and attackers who score. Because it undervalues them roughly in
proportion to how good they already are, it compresses the gap between the best players and the
rest, which is precisely the gap a transfer recommendation turns on. `src/lib/scoring/bps.ts` and
`bonus.ts` already implement the 2026/27 rules and the allocation — the missing piece is projecting
BPS per player, not scoring it.

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
