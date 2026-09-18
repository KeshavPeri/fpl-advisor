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

**Validated for the first time — ticket #224, 11 Sep 2026. The "no validation exists" line above
is no longer true, from a different source than `player_match_stats`.** The unfalsifiability
described above is specific to `player_match_stats` (FPL-Core-Insights), and that source's gap is
permanent — see the previous two paragraphs, unchanged and still correct about that source. It is
not the only possible source, though: the FPL API's own `event/{gw}/live/` endpoint
(`stats.bonus`, `stats.bps`), fetched by hand and verified on 11 Sep 2026, carries both fields
verbatim, for the current season. Ticket #224 adds `public.gameweek_live_stats` (one row per
finished, past-lockdown gameweek × `player_code`, populated by `scripts/ingest-gameweek-live-stats.ts`
reusing `scripts/settle-predictions.ts`'s own lockdown rule) and `scripts/bonus-validation-report.ts`
(read-only), which compares `player_projections.components.points.bonusPoints` against this real
figure — mean projected bonus, mean actual bonus, and the signed error between them, both overall
and restricted to each gameweek's own top 20 projected players by `expected_points` ("because that
is the population the allocator actually moves" — docs/model-review-2026-09-02.md §1h, which asked
for exactly this).

**The limitation is permanent in the other direction, and is exactly as real as `player_match_stats`'s
own gap.** `event/{gw}/live/` serves the CURRENT season only — there is no equivalent for a past
season, and never will be. This instrument can validate 2026/27 gameweeks as they finish (three, as
of this ticket) and can never look further back than that. It is not a substitute for a full-season
backtest (item 32) — it is a slow, always-current accumulator: exactly one more gameweek of evidence
every week the app runs, forever bounded to "this season and no earlier."

**SUPERSEDED for the full-past-season case — ticket #248, 17 Sep 2026. The paragraph above is
correct about `event/{gw}/live/` itself and is left in place; it is wrong as a statement about
what can be validated at all.** `event/{gw}/live/` is not the only source of real bonus/BPS — a
different FPL-Core-Insights file, `data/<season>/playerstats.csv` (a per-gameweek snapshot,
distinct from the per-match `playermatchstats.csv` that ticket #127 checked and found lacking),
carries `bonus` and `bps` verbatim for **every gameweek of a full past season**, verified directly
against the live source on 17 Sep 2026 (29,978 rows for 2025-2026 alone). Ticket #224's
"never" was true of its own instrument and false as a claim about the source as a whole — #127
had already established the identical narrower fact for `playermatchstats.csv` specifically;
#224 over-generalised it to bonus/BPS from FPL-Core-Insights entirely. Ticket #248 adds
`public.player_gameweek_history`, populated by `scripts/ingest-core-insights.ts`, as the
full-past-season complement to `gameweek_live_stats`'s current-season one. **One caveat carries
over unchanged, not newly discovered:** `playerstats.csv`'s `bonus`/`bps`/`starts` columns are
season-cumulative-to-date snapshots, not single-gameweek deltas (see the migration's own column
comments) — a future validation ticket must difference consecutive gameweek rows before comparing
against a per-gameweek projected figure; #248 is substrate only and does not build that
comparison. (G19, below, makes the identical over-generalised "does not exist in
FPL-Core-Insights" claim about per-gameweek price history specifically — out of this ticket's
scope, which is G3 only, and left untouched here; noted for whichever ticket corrects it.)

**"Not yet run against live data" — SUPERSEDED, first read 15 Sep 2026, ticket #237.** The
paragraph immediately below this one is kept for its own sake (it correctly recorded that no run
had happened yet, as of 11 Sep 2026) but is no longer current — it has now been run, and it found
exactly the shape the "flat allocator" theory predicted. Restricted to each gameweek's own top 20
projected players, the model was short by roughly HALF: real bonus outscored projected bonus by
+0.209 pooled (+0.262 on GW2, +0.066 on GW3), while the whole-population signed error stayed within
0.008–0.039 — the level (total bonus handed out) was right, the shape (who gets it) was flat. Full
table:

| Population | n | Mean projected | Mean actual | Signed error |
|---|---|---|---|---|
| Pooled, all matched players | 1867 | 0.064 | 0.103 | +0.039 |
| Pooled, top 20 projected | 60 | 0.224 | 0.433 | +0.209 |
| GW2, top 20 | 20 | 0.338 | 0.600 | +0.262 |
| GW3, top 20 | 20 | 0.334 | 0.400 | +0.066 |
| GW2, all players | 616 | 0.097 | 0.106 | +0.008 |
| GW3, all players | 652 | 0.092 | 0.098 | +0.006 |

**What #237 did in response.** `allocateFixtureBonus` (`src/lib/projection/bonus.ts`) generalised
its linear share (`share_i = excess_i / totalExcess * 6`) to a power-law share
(`share_i = excess_i^ALPHA / sum_j(excess_j^ALPHA) * 6`) — `ALPHA = 1` is an exact, bit-for-bit
reproduction of the line above, so this is a strict generalisation, not a replacement, and the
per-fixture total still sums to 6 whenever nothing clamps, for any `ALPHA`. A higher `ALPHA`
concentrates the six points on the highest-excess players, closing the gap the table above measures.
`scripts/bonus-validation-report.ts` now also reconstructs, per fixture (via
`components.fixtures[].fixtureId`, already stored — no new column), the clamped player-fixture count
and the mean per-fixture allocated total, so a future ALPHA change can be checked for the specific
failure mode a sharper share risks: clamping eating the pool until fixtures stop summing anywhere
near 6.

**`ALPHA` itself is a PLACEHOLDER (value 1, a no-op) — the live fit could not be completed by the
Builder session that shipped this mechanism, for the identical reason the first live read of this
very report was itself blocked for eleven days (11–15 Sep 2026, the two paragraphs on this page):
no Supabase credentials in a Builder session.** Ticket #237's own text specifies the fit exactly —
minimise the absolute top-20 mean signed error on GW2 (n=616) alone, then evaluate (never re-fit)
on GW3 (n=652) held out — and `src/lib/projection/bonus.ts`'s own `ALPHA` doc comment records the
full procedure plus a scale-invariance shortcut that makes the fit a same-session, read-only query
once real access exists (no code change needed to compute it). Until that hand-run query happens
and the constant is updated, `ALPHA = 1` means the sharpening described above ships as dormant,
tested, unused machinery — the table's gap is not yet closed in production.

**BPS is stored but not yet compared.** `gameweek_live_stats.bps` is ingested alongside `bonus` (the
allocator models a *share of BPS*, so bps may turn out the more informative comparison — see that
table's own migration header) but no persisted "projected BPS" figure exists anywhere in this repo
to compare it against: `expectedBps` (`src/lib/projection/bonus.ts`) is an intermediate value
`scripts/project-points.ts` computes and discards, never written to `player_projections`. Comparing
against real bps is future work for whichever ticket adds that persisted figure — not attempted here.

**Other `event/{gw}/live/` `stats` fields exist and are not ingested by this ticket — noted as a
future surface, deliberately left alone.** The endpoint's `stats` object also carries `starts`,
`defensive_contribution`, `saves`, `yellow_cards`, `red_cards`, `penalties_saved`,
`penalties_missed`, `own_goals`, `influence`, `creativity`, `threat`, `ict_index`,
`clearances_blocks_interceptions`, `recoveries`, `tackles`, the `expected_*` family
(`expected_goals`, `expected_assists`, `expected_goal_involvements`, `expected_goals_conceded`) and
`in_dreamteam`/`played` — none of these are written to `gameweek_live_stats`, per this ticket's own
scope ("this ticket is about bonus"). Most already have a projected or actual counterpart elsewhere
in this repo (`player_match_stats` for the defensive/attacking counts, `players` for the season
cumulative FPL-published versions); a per-gameweek, current-season-only copy of them would only be
worth adding if a future ticket finds a concrete use `player_match_stats` cannot already serve.

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

## G12 — MEASURED AND CONFIRMED by ticket #244, 17 Sept 2026 — the defensive multiplier IS
## damped, mirroring #182's attacking fix, and its own replacement clean-sheet gate PASSES.

**Historical record below, unchanged — this is what the measurement answered.** The same review
§1b bucket table that resolved G8 showed `expectedGoalsConceded` / `defensiveMultiplier`
overshooting real outcomes in the same direction and by a similar shape as the attacking side did
— **deliberately left alone**, unlike the attacking multiplier (#182/#184), until its own
in-harness measurement existed. Ticket #244 is that measurement.

**The measurement (`scripts/fixture-slope-report.ts`, `./out/fixture-slope-report.md`, 17 Sept
2026).** Actual team goals CONCEDED, bucketed by point-in-time `expectedScore`, SAME method and
buckets #182 used for goals scored, n=758 (the goals-SCORED table this same run reproduces
matches #182's published bucket means within 0.002 in every bucket — the harness is trusted).
Fitted slope: endpoint ≈−1.43, weighted least-squares ≈−1.50 — essentially the exact mirror of
the goals-SCORED slope (+1.43 / +1.50) measured in the same run, and roughly half the model's
implied −2.9. That is outside the ticket's ±15% materiality band, so per its decision rule this
constant is damped, not left alone: `defensiveMultiplier(es) = clamp(1.5 − es, 0, 2)` (was
`2 × (1 − es)`), the exact mirror of `attackingMultiplier`'s own `0.5 + es`. Full derivation:
`src/lib/projection/fixture.ts`'s `DEFENSIVE_MULTIPLIER_OFFSET` comment.

**Why this entry said a same-shape fix was "not safe", and what settled it.** This entry
previously argued that damping `expectedGoalsConceded`'s slope changes the *shape* of the
clean-sheet curve (`pCleanSheet = exp(−λ)` is non-linear in λ), not just its ends the way the
linear goals-scored comparison narrowed the attacking side — and that the fix therefore needed
confirming against the real, observed clean-sheet rate, not just the goals-conceded bucket table
alone. Ticket #244's ORIGINAL gate 3 said the same thing but specified it as a live
`scripts/calibration-report.ts` before/after run against Supabase — mis-specified, since a
Builder session has no credentials to run it and, per `LEARNINGS-second-build-wave.md` §20,
should not be asked to write a gate it cannot itself evaluate. **Keshav replaced it** with a gate
computable from the exact same measured rows, no Supabase: per bucket, the ACTUAL observed
clean-sheet rate (share of the bucket's team-matches with 0 goals conceded) against the mean of
`exp(−λ)` for the OLD formula (`λ = leagueBaselineGoals × 2 × (1−es)`) and this ticket's NEW
damped formula (`λ = leagueBaselineGoals × (1.5−es)`), each pooled directly over the bucket's own
rows (never a two-level mean-of-means). Verdict: PASS when NEW's mean absolute error against
ACTUAL is lower than OLD's.

**The result (same 17 Sept 2026 run, `./out/fixture-slope-report.md`):**

| es bucket | n | ACTUAL CS rate | OLD predicted | NEW predicted |
|---|---|---|---|---|
| 0.00–0.35 | 123 | 0.0894 | 0.1173 | 0.1649 |
| 0.35–0.45 | 138 | 0.2029 | 0.1769 | 0.2035 |
| 0.45–0.55 | 236 | 0.2669 | 0.2352 | 0.2347 |
| 0.55–0.65 | 138 | 0.2971 | 0.3136 | 0.2709 |
| 0.65–1.01 | 123 | 0.3902 | 0.4941 | 0.3380 |

MAE vs ACTUAL: OLD = 0.0412, NEW = 0.0373. **NEW < OLD, so this gate PASSES** — the damped formula
tracks the real, observed clean-sheet rate better than the pre-#244 formula did, at both extreme
buckets in particular (where the pre-#244 formula's overshoot was worst). The non-linearity risk
this entry originally raised did not materialize: a linear slope match on goals conceded also
produced a better clean-sheet probability curve, not merely a better-looking goals figure.
**`DEFENSIVE_MULTIPLIER_OFFSET = 1.5` is confirmed, not merely fitted** — this backlog no longer
carries an open verification item for it.

**Known, accepted scope collision — sequencing, not a blocker on the measurement.** Changing
`defensiveMultiplier`'s formula changes `expectedGoalsConceded`'s OUTPUT VALUE (not its
signature) for every non-neutral fixture, which breaks several hardcoded pre-existing assertions
in `src/lib/projection/expectedPoints.test.ts` that encode the OLD constant's numeric output
(ticket #109's and #182's own "byte-identical to the pre-ticket formula" snapshots) —
`expectedPoints.ts`/`.test.ts` are explicitly out of #244's scope, owned by ticket #238 in the
same batch. #244's own ticket text anticipated exactly this ("if it turns out any of those files
must change, stop and report") — #244 stopped and reported rather than editing that file itself,
and per Keshav's own reply, **#244 waits for #238 to merge, then rebases and updates
`expectedPoints.test.ts`'s stale assertions** — not attempted here. See decisions/ticket-244.md
and the Builder's reports for the full detail.

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

---

## G14 — Ticket #197, 4 Sep 2026: the one-gameweek oracle-ceiling failure is not a defect in
## either construction. The ASSERTION is wrong, not the oracle — a quality-only hindsight ranker
## was never entitled to bound a model that also has genuine, non-hindsight fixture knowledge

**Diagnosis-only ticket, per its own scope. Nothing below changed `checkOracleCeiling`,
`computeOracleFeaturedRate`, `computeOracleAppearanceRate`, `computeOracleFiveGameweekEstimate`, or
any model figure. The Backtest job still exits 1, and it should keep doing so until a follow-up
ticket acts on the proposal at the bottom of this entry.**

### The failure, restated

`checkOracleCeiling` fails at the one-gameweek horizon: the leave-target-out quality oracle scores
season Spearman **0.336**, the model it is meant to bound scores **0.345**, over the same
10,460-row population. By position: Goalkeeper oracle **0.035** vs model **0.157**; Defender 0.265
vs 0.286; Midfielder 0.402 vs 0.400; Forward 0.403 vs 0.428. The same construction, at five
gameweeks, sits the other way round and comfortably so — oracle 0.506 vs model 0.397 (G13's
addendum) — so whatever is wrong is specific to the one-gameweek horizon, not to "the oracle" as a
general idea.

### Ruled out first, by reading the code rather than reasoning about it

**Tie handling is not the cause — it is byte-identical.** The one-gameweek oracle's ranking
(`oracleOneGwSeason`) and the model's own ranking (`rankingSeason`) are both built by
`summarizeGenericSeasonRanking`/`summarizeSeasonRanking`, and both call the exact same
`spearmanCorrelation` → `rankDescending`, the standard average-rank tie correction. There is only
one tie rule in this file and both sides of the comparison use it. Nothing to fix here.

**Population identity is exact, confirmed from the construction, not merely read off the report.**
The one-gameweek oracle loop iterates `measured[i]` — the identical `MeasuredRow[]` array the
model's own ranking is built from — and only ever drops a row when `computeOracleRate` returns
`null` (the player has literally no season match outside the one excluded gameweek). That drop
count is `oracleOneGwInsufficientData`, printed in the report as "row(s) skipped"; the report reads
0. So both sides rank the exact same 10,460 rows, and both read `actual` from the exact same
`row.actualPoints` field — never independently recomputed. Population identity holds by
construction, and the live run confirms the one place it could have silently diverged is empty.

**The model already sees real, opponent-specific fixture data at one gameweek — this is the
load-bearing fact.** Before ticket #175, every one-gameweek row was projected under a neutral
fixture (`expectedScore` exactly 0.5). Ticket #175 changed that: `main()` now computes a
point-in-time `expectedScore` per row from real team-strength history
(`computeTeamStrengthAsOf`/`computeFixtureExpectedScore`) and only falls back to neutral when a
club has too little prior history to trust. Report 7 measured this at 9,930 of 10,460 measured rows
(95%) using a real, computed fixture. The one-gameweek oracle has never had access to any of this —
`computeOracleRate` is a bare season points-per-match average, blind to who the player faces, in
every report before and after #175.

### The mechanism

**A leave-target-out quality rate answers "how good is this player, generally". It cannot answer
"what does he face this week" — and at one gameweek, for the positions whose scoring is dominated
by a near-binary, opponent-driven outcome, the second question carries more of that week's variance
than the first.** The model, since #175, answers both; the oracle, by design, only ever answers the
first. `checkOracleCeiling`'s one-gameweek half implicitly assumes a quality-only ranker is an upper
bound on any model scored against it. That assumption does not require a leak to be false — a model
with strictly more legitimately-knowable information than the comparator can beat it fairly, and a
"ceiling" that isn't actually a ceiling failing is not evidence of a defect in either side.

**The goalkeeper figures are the sharpest confirmation, and the DoD requires addressing them
explicitly — done here.** A goalkeeper's variable points are overwhelmingly appearance (near-fixed),
clean sheet (worth 4, and `pCleanSheet = exp(-λ)` is driven almost entirely by the opponent's
`expectedScore` this specific week — see `fixture.ts`), and saves (also fixture-scaled since ticket
#109/G1). There is very little left over that is a *persistent, player-specific* skill difference
between two similarly-tiered clubs' goalkeepers for a season-average rate to usefully rank on — most
of what separates one week's goalkeeper score from another's is which opponent he faces that
particular week, which the oracle cannot see by construction and the model can. This is not a new
claim invented for this ticket: `docs/model-review-2026-09-02.md`'s own neutral-fixture ablation —
independently built, validated against this harness within ~0.005–0.02 (G12) — found forcing every
fixture to neutral collapses goalkeeper season Spearman from 0.168 to **−0.017**: below zero, i.e.
worse than random. Remove fixture information from the model and its goalkeeper ranking skill is
gone entirely. That is not a small contributor to the model's one-gameweek goalkeeper edge over the
oracle — on the evidence available, it is essentially the whole of it.

**Confirmed fresh, on this run's own population, not only on an older reconstruction — the new
diagnostic this ticket adds (in scope: "a variant computed inside the harness and reported, never
asserted").** `scripts/run-backtest.ts` now also re-projects every one-gameweek measured row through
the SAME `projectRow` combiner a second time, with no `fixtureExpectedScores` argument at all — the
function's own documented default, which forces every fixture to the same neutral construction the
#175 coverage gate already falls back to for thin-history clubs. This is REPORTED ONLY, under a new
"Diagnostic (ticket #197)" heading directly beneath the oracle-ceiling check, and asserts nothing —
`checkOracleCeiling` reads none of it. **This session cannot dispatch a live Supabase run** (the
same limitation G9/G11 recorded for their own first readings), so the live figures from this new
section are not yet read; the next scheduled Backtest run will print them, and the prediction to
check against is: goalkeeper Spearman for the neutral-fixture model variant should sit close to the
one-gameweek oracle's own 0.035 (both are now quality-blind — well, fixture-blind — rankers over the
same population) and well below the model-as-run's 0.157; defender should move by a smaller amount
than goalkeeper (see below); midfielder and forward should barely move at all. **This prediction, not
this entry, is what should be read against the report — if it is wrong, this diagnosis needs
revisiting, and the discipline that opened this ticket (§18: suspect the instrument before the
model) applies here too.**

**Why the gap shrinks from goalkeeper to defender, and nearly vanishes at midfielder and forward —
the same mechanism, read by position.** Defenders also earn the clean-sheet bonus, but unlike
goalkeepers they have a second, genuinely persistent, largely fixture-independent skill dimension the
season-rate oracle CAN see: defensive contribution (tackles/interceptions/clearances — a matter of
role and profile more than opponent) and attacking returns for the forward-leaning defenders. That
gives the oracle something real to rank defenders on that it structurally cannot offer goalkeepers,
which is consistent with the measured gap being an order of magnitude smaller for defenders (0.021)
than goalkeepers (0.122). Midfielders and forwards score overwhelmingly from goals, assists and
bonus — components tied to a persistently good attacking player far more than to this week's specific
opponent (the attacking fixture multiplier has always been the gentler of the two multipliers, and
`docs/model-review-2026-09-02.md` §1b found it was, if anything, too steep before #184 damped it, not
too narrow) — so a season-quality rate is close to measuring the same thing the model's attacking
components measure, and the two rankers land close together (MID: oracle fractionally ahead, 0.402 vs
0.400; FWD: model fractionally ahead, 0.428 vs 0.403, plausibly the residual fixture and bonus edge).
**No part of this account is inconsistent with the by-position table; the size of every gap moves in
the direction this mechanism predicts.**

### The falsification check, addressed explicitly

The ticket requires the explanation to account for both horizons in terms of the two constructions,
not by assertion, or to say plainly that it cannot.

**1. Why the one-gameweek oracle scores below the model.** Answered above: the model has real,
non-hindsight, opponent-specific fixture information from ticket #175 onward, and the oracle's
construction — a leave-target-out season rate — structurally cannot have any. For the positions
whose weekly score is dominated by a near-binary fixture-driven event (clean sheets, most acutely for
goalkeepers), that missing information costs the oracle more than its full-season quality-measurement
precision buys back at a one-week horizon. This is not a leak: every input the model uses at one
gameweek was genuinely knowable before that gameweek was played (team strength computed strictly
before the row's own gameweek, per ticket #175's own lookahead guard) — it is real information the
oracle's construction simply excludes by design.

**2. Why the same construction bounds the model at five gameweeks.** This file's own "FIVE-GAMEWEEK
RANKING TARGET" section header states the construction directly: "only the FIXTURE identity varies
leg by leg" — each of the five legs G..G+4 uses a *different* opponent, drawn from the published
schedule. A player's TRUE underlying quality is systematic and contributes to every leg alike, so its
effect on a five-leg SUM scales with the horizon (5×); each leg's fixture-driven deviation is close to
independent of the others (different opponent each week), so the fixture-noise component of the SUM
grows only like the square root of the horizon (~√5×), the standard result for summing near-independent
noise terms. The model's fixture-information edge is real in every individual leg, but it does not
compound the way persistent quality does — while the oracle's evidence base for that quality (a whole
season, ~30+ matches per player, versus the model's shrunk in-season rate) is far more precise, and
that precision compounds with the horizon exactly as `docs/model-review-2026-09-02.md` already found
("aggregation averages the week noise away and quality knowledge compounds"). At five gameweeks the
signal-to-noise balance the check depends on has flipped, in terms of the construction, not by
assertion: quality's contribution to the target scales linearly with the horizon and is measured with
season-length precision; fixture-driven variance partially cancels across five independent legs. **Both
conditions of the falsification check are satisfied by the same underlying fact — fixture identity is
per-leg and independent, quality is per-player and persistent — read at two different window widths.**

### Proposal — the ASSERTION is wrong, not either oracle construction

**Neither oracle needs to change.** `computeOracleRate` (one-gameweek) and
`computeOracleFeaturedRate`/`computeOracleAppearanceRate`/`computeOracleFiveGameweekEstimate`
(five-gameweek) are both exactly what their own comments say they are — leak-free, out-of-window,
quality-only estimators — and both are correctly built (confirmed above: same tie rule, same
population, no leak). What is wrong is `checkOracleCeiling`'s one-gameweek half: it asserts that a
quality-only hindsight ranker must sit above a model that also has real, non-hindsight fixture
knowledge, and at one gameweek that assertion has no reason to be true and the evidence above says it
isn't, structurally, not by bad luck on one report.

**For the follow-up ticket to choose between, not decided here:**

1. **Cheapest and recommended: stop treating the one-gameweek comparison as a pass/fail ceiling.**
   Remove the one-gameweek branch of `checkOracleCeiling`'s assertion (the five-gameweek branch is
   untouched — it is a genuine ceiling and must keep failing the job if a future model or a future
   leak ever beats it). Keep the one-gameweek oracle fully computed and reported, exactly as today,
   including the new fixture-forced-neutral diagnostic this ticket adds — it remains a useful reading
   on how much of the model's one-gameweek skill is fixture-driven vs quality-driven, position by
   position. It simply stops being something the job exits non-zero over.
2. **More work, not recommended unless someone wants a true one-gameweek ceiling for its own sake:**
   build a genuinely fair one-gameweek bound — a "quality + fixture" oracle that knows both a
   player's true season quality AND this week's real opponent (the same team-strength data the model
   already reads), so it is no longer missing information the model has. That would be a new,
   different construction, not a rewrite of the existing one, and it would need its own leak-guard
   tests exactly as rigorous as the ones `computeOracleRate` already has — real effort for a bound
   this repo does not currently need, since the five-gameweek ceiling already does the job of
   catching a lookahead leak (twice, per G13).

**Do not read this as license to relax, widen, or remove `checkOracleCeiling`'s five-gameweek half.**
That half is untouched, correct, and stays exactly as it is — this entry's proposal is scoped to the
one-gameweek assertion only, and only option 1 above should be attempted without also re-deriving
this diagnosis on a fresh live run first.

---

## G15 — Ticket #203, 4 Sep 2026: learned-model training substrate (R6, first slice) — the
## column list and the gate, recorded

**Substrate only. No model is trained here, no model is evaluated here, and baseline-v1 is
untouched.** This mirrors the #146 → #154 pattern exactly: store the substrate in one ticket,
consume it (train + evaluate) in the next. Nothing in this entry changes any live projection,
recommendation, or backtest number — the next backtest run will look exactly like report 10.

**Why now.** Report 10 (4 Sep 2026) measured the model losing to a naive "rank by prior minutes
per match" baseline on the five-gameweek target at midfield (0.412 vs 0.464) and forward (0.452 vs
0.476) — see `docs/model-review-2026-09-02.md`'s question 4 and this file's own R6 recommendation.
The remaining headroom is player-quality resolution that shrunk in-season xG/xA cannot supply. The
response is a small learned model on the columns this repo already ingests, written behind the
`player_projections` CSV seam as a second `model_version` — never OpenFPL's 196-206 undocumented
features (`product-brief.md` §6d: "the ticket shape this pipeline handles worst").

### The gate — stated here so a later ticket is judged against exactly this table, not a recollection

The review's original gate ("beat the repaired baseline's per-position Spearman on the
five-gameweek target") is **too weak and must not be used** — report 10 shows the naive minutes
baseline already beating the repaired baseline. The gate for learned-v1 is the **naive baseline**,
per position, on the five-gameweek target, on the same measured population with the same
exclusions:

| Position | Must beat |
|---|---|
| Goalkeeper | 0.240 (the model's own figure — it beats the baseline here) |
| Defender | 0.374 (the model's own figure, for the same reason) |
| Midfielder | **0.464** (the naive minutes baseline) |
| Forward | **0.476** (the naive minutes baseline) |

The hindsight ceiling for reference is 0.201 / 0.479 / 0.521 / 0.562 (GK/DEF/MID/FWD). The winnable
band at midfield and forward is roughly 0.06 to 0.09 of Spearman, and that is the whole prize.

### The column list actually assembled, in `public.training_features`

One row per (`season`, `gameweek_id`, `player_code`), admitted only when `prior_matches > 0` (no
row-of-zeros for a debut gameweek, unlike `feature_history`). See
`supabase/migrations/20260904090000_training_features.sql` for the full column-by-column "because"
— summarised here as the record the ticket's DoD asks for:

- **`element_type`, `team_code`** — position and own club, copied through from `feature_history`.
- **`prior_matches`** — evidence volume, copied through, so a consumer can bucket by history depth
  the way G10's own cold-start bucketing already did for defcon.
- **`xg_rate_per90`, `xa_rate_per90`** — plain, UNSHRUNK per-90 rates computed from
  `feature_history`'s own `prior_xg`/`prior_xa`/`prior_minutes` — deliberately NOT
  `src/lib/projection/rates.ts`'s shrunk rate (Tier 2: shrinkage and the position prior are
  baseline-v1-specific, moving modelling choices; baking them in would tie a "learned" model to
  baseline-v1's own current tuning instead of letting it see the raw signal).
- **`prior_recent_minutes`** (copied through) **and `season_avg_minutes`** (computed:
  `prior_minutes / prior_matches`) — the minutes structure, both the true last-five-match window and
  the season-long share. `docs/model-review-2026-09-02.md` §1f found the plain season-average
  *beats* the 5-match window for midfielders at the 5-gameweek horizon (0.473 vs 0.444) — a learned
  model gets to see both and find its own blend, rather than the live model's own fixed shrink.
- **`prior_shots_on_target`** — a NEW strictly-before cumulative total, computed directly from
  `player_match_stats.shots_on_target` (not stored on `feature_history`), using the identical
  strictly-before rule `feature_history`'s own `prior_*` totals use.
- **`prior_defcon_qualifying_matches`, `prior_defcon_hits`** — the two defensive-contribution
  counters, copied through from `feature_history`.
- **`opponent_team_codes`** — this gameweek's own scheduled fixture(s), an array (covers a double
  gameweek). Schedule, not result — legitimately knowable in advance; see G14 above for why fixture
  identity is not hindsight the way a result is. Built via `scripts/run-backtest.ts`'s
  `buildClubFixtureSchedule`/`lookupClubFixtureSchedule`, reused unmodified.
- **`team_strength_matches`, `team_strength_goals_scored`, `team_strength_goals_conceded`** — the
  player's own club's point-in-time raw record (never a derived expected-score ratio — that
  construction's `SCALE` constant is itself a calibrated, revisitable choice, see G8/G12), via
  `scripts/run-backtest.ts`'s `buildTeamMatchRecords`/`computeTeamStrengthAsOf`, reused unmodified
  (Tier 2: reusing already-reviewed, already-tested-at-scale logic rather than a second
  hand-written implementation that could silently drift from the first).

**Four named columns dropped — not ingested anywhere in this repo, per the ticket's own
instruction not to add a new ingest.** The ticket named five "shots/chances/touches" candidates:
total shots, shots on target, chances created, big chances missed, and touches in the opposition
box. Checked directly against `public.player_match_stats`'s actual schema (every migration through
`20260902090000`) and against `scripts/ingest-core-insights.ts`'s own
`MATCH_STATS_REQUIRED_COLUMNS`/`MatchStatRow`: only `shots_on_target` exists. There is no
total-shots column, and no `chances_created` / `big_chances_missed` / `touches_in_opposition_box`
column at all — also confirmed by `tickets/drafts/58-complete-match-stats-and-dense-history.md`'s
own explicit list of source columns this repo has deliberately never ingested. All four are simply
absent from `training_features`; no new ingest was added to obtain them.

### What this ticket does not do

No model is trained or evaluated. `baseline-v1`, everything under `src/lib/projection/`,
`scripts/project-points.ts`, `scripts/run-backtest.ts` and the projections CSV are all untouched.
The next backtest run looks exactly like report 10. The follow-up ticket that actually trains and
evaluates `learned-v1` against the gate above is the next slice — this entry exists so that ticket
is judged against exactly this column list and exactly this gate table, not a recollection of
either.
## G15 — Ticket #201, 4 Sep 2026: G14's follow-up landed (option 1) — the one-gameweek ceiling is
## retired, and the five-gameweek ceiling is now checked per position, which immediately found a
## real breach the aggregate-only check was blind to

**G14's pre-registered prediction was confirmed on a live run (report 10):** forcing every one-gameweek
fixture to neutral drops goalkeeper Spearman to **−0.021**, against the one-gameweek quality oracle's
**0.035** and the model-as-run's **0.157** — both now fixture-blind rankers landing close together, well
below the model's real, fixture-aware figure, exactly as G14's mechanism predicted. Defender moved by a
visibly smaller amount (0.034); midfielder and forward barely moved. All four positions moved in the
direction G14's account requires. The diagnosis in G14 stands confirmed, not merely argued.

**Part 1 of this ticket applied G14's recommended option 1, verbatim.** `checkOracleCeiling` no longer
takes or asserts anything about the one-gameweek horizon — its signature dropped from four numbers
(one-gameweek model/oracle, five-gameweek model/oracle) to `(fiveGwModelSeasonSpearman,
fiveGwOracleSeasonSpearman, fiveGwModelByPosition, fiveGwOracleByPosition)`. The one-gameweek oracle and
the #197 fixture-forced-neutral diagnostic are still fully computed and printed in the report, completely
unchanged — they simply no longer feed a pass/fail assertion. **Neither oracle construction changed. The
five-gameweek half's own assertion logic (season aggregate, `>=` not `>`, null-skips) is untouched.**

**Part 1 also extended the five-gameweek half to every position, per this ticket's own scope (not part of
G14's proposal, which only asked for the one-gameweek removal) — and this is not a hypothetical
tightening.** On report 10's own figures the five-gameweek season aggregate check PASSES (model 0.397
below oracle 0.506), but the goalkeeper breakdown alone is already a breach: **model 0.240 against oracle
0.201 — the model sitting ABOVE its own hindsight ceiling.** The old aggregate-only check could not see
this; a per-position check catches it immediately, on the very first report it ran against. This is the
exact shape `LEARNINGS-second-build-wave.md` §14 already described for the ranking-sanity bounds (a bound
checked only at the aggregate does not protect the breakdown) — the oracle-ceiling check had the identical
gap, now closed the same way.

**This newly-exposed goalkeeper five-gameweek breach is NOT diagnosed or fixed here — ticket #201's own
scope forbids it ("do not fix the goalkeeper five-gameweek breach in this ticket... it needs its own
entry, not a patch made in passing").** The likely mechanism is the same fixture-knowledge asymmetry G14
already describes for the one-gameweek horizon — goalkeeper scoring is dominated by a near-binary,
fixture-driven clean-sheet outcome, and the model's real fixture knowledge may be compounding across the
five legs in a way the oracle's out-of-window quality rate cannot match — but G14's own falsification
account for why the *five*-gameweek horizon should sit the other way round (quality's contribution scales
linearly with the horizon at season precision; fixture noise only partially cancels across five
independent legs) is exactly what predicts the oracle should stay ahead at five gameweeks. That it does
not, for goalkeepers specifically, is a genuine finding needing its own diagnosis ticket — restating G14's
mechanism without re-deriving it for this specific case would be exactly the kind of asserted-not-derived
explanation `docs/model-review-2026-09-02.md`'s own falsification check exists to catch. **The Backtest job
will still exit 1 after this ticket merges — on this new per-position finding, not on the retired
one-gameweek assertion. That exit is the check working, not a regression.**

**What follow-up work should NOT do:** relax, widen, or remove the five-gameweek check (per position or
aggregate) to make the job pass again. The check is correct; the model is what needs investigating.

---

## G16 — Ticket #208, 4 Sep 2026: learned model, second slice — trained and harnessed, GATE NOT YET
## READ (no live Supabase project in this Builder session, same limitation as G9/G11/G13's first readings)

**What this ticket built.** `scripts/train-and-evaluate-learned-model.ts` reads ticket #203's
`training_features` (18,023 rows) and `public.player_match_stats`/`public.feature_history`, fits a
small model, and evaluates it against exactly the gate table G15 recorded — reusing
`scripts/run-backtest.ts`'s own `classifyRow`/`classifyFiveGameweekRow`/
`summarizeGenericBaselineSpearman`/`summarizeBaselines`/`summarizeFiveGameweekBaselines`
unmodified, never a second implementation of any ranking metric (grep-checkable: the new file
defines no Spearman correlation, no rank function, and no five-gameweek window classifier of its
own). `run-backtest.ts` itself is untouched — ticket #209 edits that same file concurrently in this
batch, on a different branch.

**The model.** A hand-written gradient-boosted regression-tree ensemble (`buildRegressionTree` /
`fitGradientBoostingModel`, greedy CART on squared-error loss, deterministic — no random row/feature
subsampling), not an npm ML dependency: the ticket's own scope constraint forbids a `package.json`
edit ("one new script ... under scripts/. Nothing else"), and the review's own recommendation reads
"gradient boosting on ~15 columns, not a neural network" — small enough to write and read by eye.
Hyperparameters, fixed before any real data is read (no tuning against the gate): 60 trees, max depth
3, learning rate 0.08, min 40 samples per leaf.

**The 15 columns**, in the fixed order `FEATURE_NAMES` documents: FPL position code; prior-matches
evidence volume; unshrunk xG/xA per 90 (`training_features.xg_rate_per90`/`xa_rate_per90`, the
deliberately non-baseline-v1-shrunk rate that table stores); the last-five-match minutes average
(falling back to the season average when the window is empty); the season-long minutes average
itself (`docs/model-review-2026-09-02.md` 1f: this alone beats the 5-match window for midfielders at
five gameweeks — the model sees both and finds its own blend); shots-on-target per match; the
defensive-contribution hit rate and its own evidence volume; the player's own club's point-in-time
goals-scored/goals-conceded-per-match and evidence volume; the scheduled opponent(s)' point-in-time
goals-scored/goals-conceded-per-match, POOLED across a double gameweek, computed live via
`computeTeamStrengthAsOf` (never stored on `training_features` — that table's own migration header
leaves this to whichever ticket trains a model); and the fixture count itself (0/1/2). No column
named in the ticket turned out to be un-ingestable beyond the four G15 already recorded as dropped
(total shots, chances created, big chances missed, touches in the opposition box) — this ticket
introduced no new drop.

**The five-gameweek total mirrors G13's own discipline, reapplied to a second model.**
`predictLearnedFiveGameweekTotal` reads every FORM input (xG/xA rates, minutes structure, defcon,
the player's own team strength) exactly once, from the window's START gameweek G — never a leg's own
later gameweek — and only the fixture identity (opponent codes, via the published schedule) and
opponent STRENGTH-as-of-G vary leg by leg. Three of this ticket's own tests exist specifically to
prove this: that mutating a form feature never changes a leg's prediction leg-to-leg, that a leg's
opponent identity comes from the schedule and never from the window-start row's own stored
`opponent_team_codes`, and that opponent strength is evaluated strictly before G for every leg,
never before the leg's own (later) gameweek.

**The split — the thing this ticket's DoD is most exacting about.** `splitByGameweekCutoff`
partitions every row by its OWN `gameweekId` against a fixed cutoff (gameweek 28 of 38, ~74%
training) — never a random row-level split, because a five-gameweek window's legs would then span
both folds unpredictably. The model is fit ONLY on the training fold; the held-out fold (gameweeks
29-38) is scored once. The named test the ticket's DoD asks for ("no gameweek in the evaluation set
contributed to fitting") constructs a season where the held-out gameweeks carry an unmistakable
outlier target (999) absent from every training-fold row, fits on the training fold alone, and
proves the fitted model's own starting point — and therefore every downstream residual — reads as
the training-fold mean, nowhere near 999. A second test confirms mutating the eval fold's own data
AFTER fitting cannot retroactively change an already-fitted model, since fitting was never handed a
reference to it.

**GATE NOT YET READ — stated plainly, not a near miss and not a pass.** Exactly the same limitation
G9's and G11's first readings recorded: this Builder session has no live Supabase project and no
`SUPABASE_URL`/`SUPABASE_SECRET_KEY` in its environment, so `scripts/train-and-evaluate-learned-model.ts`
has been proven correct on constructed rows (40 tests, all passing, no live database) but has never
executed against the real 18,023 `training_features` rows. **No number in this entry is a measured
gate result — there isn't one yet.** The confirming step: run
`SUPABASE_URL=... SUPABASE_SECRET_KEY=... npx tsx scripts/train-and-evaluate-learned-model.ts` (reads
`training_features`, `feature_history`, `player_match_stats`, `players`; writes
`out/learned-model-report.md` and one `job_runs` row) and read the report's own Gate table — GK/DEF
compared against the incumbent's own figure from THAT SAME run (never a quoted past number, since
ticket #207 is reverting `src/lib/projection/minutes.ts` on its own branch in this same batch and the
report records the exact git commit SHA it ran against precisely so a reader can tell which state of
that file it reflects), MID/FWD compared against the FIXED report-10 naive-baseline figures (0.464 /
0.476) this entry inherits from G15 without re-deriving them. **Do not tune `TRAIN_EVAL_GAMEWEEK_CUTOFF`,
`DEFAULT_GBM_HYPERPARAMETERS`, or `FEATURE_NAMES` from a disappointing first reading** — the ticket's
own instruction is fit once, evaluate once, report what comes out; a failed gate after that budgeted
attempt is a real, useful result, not a defect to iterate away.
## G16 — Ticket #209, 4 Sep 2026: the goalkeeper five-gameweek breach diagnosed — option 1, goalkeeper
## exempted from the per-position check at five gameweeks, for the same structural reason G14 gave at one

**The finding this ticket investigates, restated with its numbers.** The per-position five-gameweek
oracle-ceiling check the second G15 entry above (ticket #201) added immediately found a breach the
season aggregate could not see: at five gameweeks, goalkeeper model Spearman **0.240** sits above its
own hindsight oracle's **0.201**. Defender, also clean-sheet-driven, sits comfortably the other way
round: model **0.374** against oracle **0.479**. This entry extends G14 — it does not restate it — to
explain why the same mechanism G14 diagnosed at one gameweek produces a genuine breach at five for
goalkeepers only, and reaches this ticket's required decision.

### Line of enquiry 1 — the same mechanism, measured by how much each horizon's variance the oracle explains

G14 already established the mechanism at one gameweek: the model has real, non-hindsight fixture
knowledge (ticket #175) the quality-only oracle structurally cannot have, and for goalkeepers almost
none of the weekly score is persistent, fixture-independent skill — both scoring components (clean
sheets, and saves since ticket #109/G1) are themselves fixture-scaled. G14 also predicted this would
wash out over five gameweeks: a persistent-quality signal compounds roughly linearly with the horizon
(measured with season-length precision), while independent per-leg fixture variance only partially
cancels (√5-ish), so a real quality-only oracle should eventually out-run a fixture-only model. That
prediction held for three of the four positions and did not for goalkeepers. Why, in terms of the two
constructions, is answered by looking at how much each oracle's rank correlation actually grew.

Squaring each reported Spearman figure as the standard proxy for "share of rank variance explained"
(not a rigorous variance decomposition — a heuristic, same spirit as G8/G12's use of the same
correlations) and comparing the oracle's own growth from one gameweek to five, using every figure
already on record in this file (one-gameweek: G14; five-gameweek: G15/#201 for goalkeeper and
defender, the #203 gate table's reference ceiling and this same batch's report-10 reading — "the model
losing to a naive... baseline... at midfield (0.412 vs 0.464) and forward (0.452 vs 0.476)" — for
midfielder and forward's own model figure):

| Position | 1-GW oracle r² | 5-GW oracle r² | 1-GW model r² | 5-GW model r² | Oracle−model gap, 1-GW | Oracle−model gap, 5-GW | Change in gap |
|---|---|---|---|---|---|---|---|
| Goalkeeper | 0.0012 (0.035²) | 0.0404 (0.201²) | 0.0246 (0.157²) | 0.0576 (0.240²) | **−0.0234** | **−0.0172** | **+0.0062** |
| Defender | 0.0702 (0.265²) | 0.2294 (0.479²) | 0.0818 (0.286²) | 0.1399 (0.374²) | −0.0116 | **+0.0895** | +0.1011 |
| Midfielder | 0.1616 (0.402²) | 0.2714 (0.521²) | 0.1600 (0.400²) | 0.1697 (0.412²) | +0.0016 | **+0.1017** | +0.1001 |
| Forward | 0.1624 (0.403²) | 0.3158 (0.562²) | 0.1832 (0.428²) | 0.2043 (0.452²) | −0.0208 | **+0.1115** | +0.1323 |

Every position's oracle-minus-model gap moves in the direction G14's compounding argument predicts —
the horizon genuinely helps the oracle everywhere, goalkeeper included (+0.0062 is a real, positive
move, not zero). But for defender, midfielder and forward that move is **roughly +0.10 to +0.13 of r²**,
comfortably flipping a small one-gameweek deficit (all four positions start with the model at or above
the oracle at one gameweek — G14's own point) into a clear five-gameweek lead for the oracle. For
goalkeeper the same mechanism moves the gap by **+0.0062 — about a sixteenth the size of the smallest
of the other three moves.** The compounding argument is not failing for goalkeepers; it is operating on
a starting quantity that is, by the oracle's own reading, close to zero: goalkeeper's one-gameweek
oracle r² (0.0012) is roughly 55–135 times smaller than the other three positions', which is exactly
what "goalkeepers have almost no independent, fixture-blind persistent-quality signal for a season
rate to measure" (G14's own diagnosis) predicts a quality-only oracle should look like before any
compounding happens at all. Five gameweeks of linear compounding applied to "almost nothing" is still a
small absolute number (5-GW oracle r² of 0.0404 — the smallest of any position by a wide margin: roughly
a sixth of defender's, a seventh of midfielder's and forward's) — smaller, in fact, than the
model's own modest five-gameweek fixture-based r² for the same position (0.0576, itself the smallest
model r² of the four positions). **Goalkeeper does not have an unusually powerful model; it has an
unusually powerless oracle, for a reason the oracle's own numbers state directly at both horizons.**

### Line of enquiry 2 — the population, addressed with a number

Report 10's five-gameweek measured population is **616** goalkeeper rows against **4,276** midfielder
rows (this ticket's own text; goalkeeper is, as expected, the smallest position by a wide margin — one
starting XI slot against up to five for outfield positions). The standard-error heuristic for a Spearman
correlation, SE(ρ) ≈ 1/√(n−1), gives:

- Goalkeeper (n=616): SE ≈ 1/√615 ≈ **0.0403**.
- Midfielder (n=4,276): SE ≈ 1/√4,275 ≈ **0.0153**.

The goalkeeper breach itself — model 0.240 minus oracle 0.201 = **0.039** — is almost exactly **one
SE** for a correlation measured on 616 rows: on its own, a gap that size is not distinguishable from
sampling noise by any conventional significance bar (a two-sided 95% test would want roughly 1.96 SE),
and this heuristic if anything understates the noise, since it treats the two correlations as
independent draws when they are in fact two rankings scored against the identical actual outcomes on
the identical rows — a proper paired test would not shrink that uncertainty. Contrast the midfielder
margin the other way (oracle 0.521 minus model 0.412 = 0.109, roughly **7 SE** at n=4,276) or
defender's 0.105 gap (also several SE at a population that report 10's one-gameweek section shows runs
into the thousands) — those are not close calls.

**This does not mean the finding is "just noise" and should be ignored — it means the opposite, once
read together with enquiry 1.** The population size explains why *this run's specific number* (0.039)
should not be treated as a precise, stable figure — a re-run could plausibly show it at anywhere from
roughly 0 to 0.08, or even briefly negative, by chance alone. What enquiry 1 shows, independently of
this run's sample noise, is *why* the true gap should sit near zero for goalkeepers regardless: the
oracle has almost no independent signal to offer at this position at either horizon, confirmed by its
own by-position pattern rather than by this one comparison alone. The small sample size is why the
sign of the observed gap bounces around; the near-zero true quality signal is why it bounces around
*zero* rather than settling clearly on either side, the way every other position's gap does.

### Line of enquiry 3 — does the same shape appear for defenders? Yes, and it is why they diverge

Defenders also earn the clean-sheet bonus (the same fixture-driven component goalkeepers have), so the
same "compounding favours the oracle" argument should, on the clean-sheet component alone, apply
equally weakly to them. It does not, because defenders have a **second** scoring dimension the
quality-only oracle CAN measure and goalkeepers structurally cannot: defensive-contribution rate
(tackling, clearing, intercepting — chiefly a matter of role and profile, largely independent of this
week's specific opponent) plus attacking returns for advanced defenders. G14 already used exactly this
distinction to explain the one-gameweek gradient from goalkeeper (0.122 gap) to defender (0.021 gap) to
midfielder/forward (near zero). It is the same distinction, unchanged, that explains why defender's
oracle has real quality to compound at five gameweeks (one-gameweek oracle r² of 0.070, already 57
times goalkeeper's 0.0012) while goalkeeper's does not: a goalkeeper's *second* scoring component,
saves, is **also** fixture-scaled (G1/ticket #109) — there is no defender-defcon equivalent for
goalkeepers, no fixture-independent second dimension at all. This is not a new mechanism invented for
five gameweeks; it is G14's own gradient, read at a different horizon, and it produces exactly the
ordering observed: goalkeeper (breach), defender (comfortably bounded, smaller margin than
midfielder/forward), midfielder and forward (comfortably bounded, largest margins) — a monotonic
relationship with how much fixture-independent scoring each position actually has.

### The falsification check, addressed explicitly

1. **Why does the goalkeeper five-gameweek model sit above its oracle?** The model has real,
   non-hindsight, per-leg fixture knowledge (published schedule + team strength as of the window's
   start, ticket #175/#193, leak-guarded per G13) that legitimately predicts a meaningful share of a
   near-binary, opponent-driven outcome (clean sheets) across all five legs. The oracle's season-quality
   rate, by construction, cannot see any of that, and — confirmed independently by
   `docs/model-review-2026-09-02.md`'s own neutral-fixture ablation collapsing goalkeeper ranking
   *below zero* when fixture information is removed — there is almost no fixture-independent quality
   left in goalkeeper scoring for a season rate to measure instead. A model with strictly more
   legitimately-knowable information than its comparator can rank above it fairly; that is not evidence
   the ceiling was leaked, it is evidence the ceiling was never a ceiling for this position.
2. **Why does the defender five-gameweek model, also clean-sheet driven, sit comfortably below its
   oracle?** Because defenders, unlike goalkeepers, have a second scoring dimension — defensive
   contribution, plus attacking returns for advanced defenders — that is genuinely persistent and
   largely fixture-independent, giving their season-quality rate real signal to compound over five legs
   that goalkeepers structurally do not have (enquiry 3, extending G14's own one-gameweek gradient).
3. **Why is the same goalkeeper gap larger at one gameweek (0.157 vs 0.035) than at five (0.240 vs
   0.201)?** G14's compounding argument is real and does operate on goalkeepers — enquiry 1 measures a
   genuine, positive move in the oracle's favour (+0.0062 of r²) at five gameweeks, in the same
   direction as every other position. It is simply compounding a starting quantity that is, by the
   oracle's own numbers, close to zero — 55 to 135 times smaller than the other three positions' — so
   the horizon damps the raw Spearman gap (0.122 → 0.039) without having enough underlying signal to
   flip it, while the other three positions' far larger starting quality signal flips comfortably.

All three conditions are satisfied by one mechanism — the size of each position's fixture-independent,
season-measurable quality signal, established in G14 for one gameweek and unchanged in kind at five,
read now through the numbers that were not available at the time (this ticket does not need a new
model construction or a new live run to make the case; every figure above is already recorded in this
file or this ticket's own text).

### The decision — option 1: exempt goalkeeper from the per-position check, at five gameweeks only

**Recommendation: option 1** — the oracle is not a valid ceiling for goalkeepers at five gameweeks, for
the same structural reason G14 gave at one gameweek, and the per-position half of `checkOracleCeiling`
now skips goalkeeper by name (`scripts/run-backtest.ts`, both the function's own comment and the loop
itself point back to this entry). The season-aggregate check and every other position's per-position
check are untouched.

**Why not option 2 (build a fixture-aware oracle).** It would be the more thorough fix — a quality *and*
fixture oracle would be a genuinely fair bound at both horizons for every position — but it is real,
separate work: a new construction, not a rewrite, needing its own leak-guard tests as rigorous as
`computeOracleRate`'s own (a fixture-aware oracle that accidentally reads inside its target window would
be a much larger, quieter leak than either one this file already records). This ticket's own scope
forbids attempting it here, and enquiry 1 shows the goalkeeper-specific mechanism is already understood
well enough to act on without it — building a bound this repo does not currently need, when the
five-gameweek season-aggregate and three-position check already does the leak-catching work (twice, per
G13), is not the most useful next ticket.

**Why not option 3 (something else is wrong).** Every other candidate explanation was checked and ruled
out or subsumed: tie handling and population identity were already confirmed byte-identical in G14's own
diagnosis and are unchanged by this entry; the five-gameweek construction itself was independently fixed
and confirmed correct by G13's addendum (the club-schedule fix) before this breach was ever visible; and
the population-size concern (enquiry 2) explains why the *specific number* 0.039 is noisy, not why the
*direction* the mechanism predicts is wrong — enquiry 1's r²-growth comparison holds regardless of which
side of zero any single run's goalkeeper gap happens to land on.

### A falsifiable prediction for the next live run

If this diagnosis is right, the goalkeeper five-gameweek gap should keep hovering close to parity —
sometimes the model narrowly ahead, sometimes the oracle narrowly ahead — as the season lengthens and
both estimates' sample sizes grow, **never opening into a gap of the size defender, midfielder or
forward show (roughly 0.09–0.13 of r², i.e. very roughly 0.10–0.15 of Spearman).** If a future report
instead shows the goalkeeper oracle pulling decisively ahead of the model by a margin comparable to
defender's or midfielder's, that would refute the "goalkeepers have almost no fixture-independent
quality signal" account, and the exemption should be revisited rather than assumed permanent — this
entry's own falsification check would then need re-doing, not waved past.

### What this ticket did not do

No oracle construction changed. No model figure moved — `src/lib/projection/` is untouched. No
constant was tuned. The season-aggregate check and the defender/midfielder/forward per-position checks
are exactly as strict as ticket #201 left them. The Backtest job's five-gameweek section will now pass
on report 10's own goalkeeper figures (0.240/0.201) specifically because of this named exemption, not
because the underlying numbers changed — the report states this explicitly, in the oracle-ceiling
section itself, every time it runs, so a passing job is never silently read as "goalkeeper ranking beat
its own ceiling and that's fine" when what actually happened is "goalkeeper is exempt, and here is why."
## G16 — Ticket #207, 4 Sep 2026: the minutes model v2 (#191) is REVERTED — pre-registration worked
## exactly as intended, and it said no

**#191's own definition of done pre-registered its revert condition, and #207 acts on it.** #191
(commit `e652df7`) replaced the plain windowed mean in `src/lib/projection/minutes.ts` with a
start-probability x minutes-given-start split that dropped the single lowest value from a full
five-match window, stating up front: "if any position moves away from 1.00 [on the
appearance-ratio calibration check], revert rather than tune." Three of four positions did, the
day it shipped. The revert was deferred at the time, openly, on the grounds that the backtest was
the better instrument for the question and was broken. That instrument is now honest (ticket
#201), and all three lines of evidence agree.

**1. The pre-registered calibration criterion, failed and still failing.** Appearance ratios by
position:

| Report | GK | DEF | MID | FWD |
|---|---|---|---|---|
| 7 — before #191 | 1.06 | 1.00 | 0.96 | 0.92 |
| 8 — after #191 | 1.05 | 0.98 | 0.93 | 0.89 |
| 9 — after #191, five days on | 1.05 | 0.98 | 0.94 | 0.89 |

Three positions moved away from 1.00 and stayed there. Two independent readings, same answer.

**2. The honest backtest, both horizons.** Ticket #201 reconstructed the pre-#191 minutes model
inside the harness and ran both side by side over the identical population, with every other
input held constant (backtest report 11):

| Ranking | Pre-#191 | Shipped (#191) |
|---|---|---|
| One gameweek, season | 0.354 | 0.345 |
| Five gameweek, season | 0.407 | 0.397 |
| One gameweek, midfield | 0.411 | 0.400 |
| One gameweek, defence | 0.296 | 0.286 |
| Five gameweek, midfield | 0.421 | 0.412 |
| Five gameweek, defence | 0.385 | 0.374 |

The shipped model wins only at goalkeeper on one gameweek (0.157 against 0.149) and at goalkeeper
and forward on five (0.240/0.452 against 0.228/0.442). It loses the season aggregate at both
horizons and loses midfield and defence at both.

**3. The independent prediction.** `docs/model-review-2026-09-02.md` §3 predicted a correct
live-window minutes model would score 0.354 at one gameweek, from a reconstruction built
separately in Python with no lookahead. The pre-#191 construction scores exactly that. #191 moved
the model away from the review's predicted state, not toward it.

At five gameweeks the naive "prior minutes per match" baseline scores 0.407 and the shipped model
scores 0.397 — the model currently loses to a one-line ranker. The pre-#191 model scores 0.407.
Reverting closes that deficit entirely.

**What #207 did.** `src/lib/projection/minutes.ts` restored to its exact pre-`e652df7` state — the
plain mean of the recent-minutes window, no `dropSingleLowest`, no
`splitFeaturedFromSample`/start-minutes-given-start. `estimateMinutes`'s exported signature and
`MinutesEstimate` shape are unchanged, so no consumer needed editing. `src/lib/projection/
expectedPoints.test.ts` and `scripts/run-backtest.test.ts` had hardcoded expectations tied to
#191's shipped numbers on shared worked windows (`[90,90,90,10,10]`, `[90,90,20,0,0]`) — these
were updated to the reverted model's actual output as a direct, mechanical consequence of the
revert, the same kind of fast-follow #191 itself needed for `expectedPoints.test.ts` when it
shipped. No change to `scripts/run-backtest.ts` itself, `src/lib/projection/expectedPoints.ts`, or
any other projection input.

**#191 was not a bad idea, and its execution was measured properly the moment a working
instrument existed.** Averaging `90, 90, 90, 90, 0` down to 72 expected minutes genuinely does
understate a nailed starter who missed one match to rotation — that observation was real, and the
underlying data behind it (77 players, 1,232 five-match windows, the "next match after a
one-zero window looks almost identical to the next match after a clean window" finding) was real
too. The idea was sound. It lost anyway, on a fair measurement, at every horizon and every
position except goalkeeper and (at five gameweeks) forward, and it lost the season aggregate
outright. That is pre-registration working exactly as intended: a clearly stated revert
condition, honoured once the instrument to check it existed. **Do not re-propose the
start/minutes-given-start split, or any other single-lowest-drop variant, without new evidence
that addresses why it lost the honest backtest — restating the `90,90,90,90,0` motivating case
again is not new evidence; it is the case that was already measured and lost.**

---

## Ticket #215, 5 Sep 2026: penalty-duty diagnostic — MEASURED, and the review's proposed method does not work. Recommendation: leave it alone

`docs/model-review-2026-09-02.md` §1g named penalty duty the one excluded absence with
"concentrated cost", proposed a method ("a persistent positive per-player goals-minus-xG
residual identifies takers"), and asked for one diagnostic, not a build. `scripts/
penalty-duty-diagnostic.ts` (hand-run, not wired into any workflow) is that diagnostic. This
entry reports what running it found. **No model change. `src/lib/projection/` is untouched.**

**How the numbers below were produced.** This Builder session has no live Supabase project —
the same limitation G9/G11 record for the backtest and ranking-skill slices. Rather than ship
untested guesses, the diagnostic's exact logic (`aggregateSeasonTotals` +
`computeGoalsMinusXgResidualPerNinety` + the stated threshold) was reproduced directly against
FPL-Core-Insights' public per-gameweek CSVs for the complete, already-ingested 2025-2026
season — the identical source `scripts/ingest-core-insights.ts` reads. The reproduction's row
counts match this codebase's own previously-documented figures for that table exactly (15,340
total rows, 12,754 Premier-League rows after the competition filter — see G13's "15,340 of
15,340" and the opponent-resolution figures elsewhere in this file), so these are a faithful
run of the shipped script against 2025-2026, not a synthetic stand-in. The one figure this
could not reproduce — cost figure 3, captaincy overlap, which needs the CURRENT season's live
`player_projections` — is reported as not yet read, below, exactly as G9/G11 reported their own
first live numbers as "not yet read" until a session with real Supabase credentials ran them.

### Population and the separation rule

339 of 565 players carried >= 900 minutes (`MIN_SEASON_MINUTES`) of 2025-2026 Premier-League
football — the qualifying population the threshold was applied against. At
`PENALTY_DUTY_RESIDUAL_THRESHOLD_PER_90 = 0.10`, **21 of 339 (6.2%) are flagged as candidates.**

### Cost figure 1 — points-impact, at face value

Summed at face value (residual x 5 x `goalPoints(position)`, the DoD's specified figure), the
21 candidates' combined five-gameweek "impact" is real-sized — several points per candidate.
**This figure is reported because the DoD asks for it, and it is exactly the number that
figures 2 and 3 below show should not be trusted as evidence of an actual model gap.**

### Cost figure 2 — cross-check against real penalty records: 76% false positives

The ticket's specified cross-check (`players.penalties_missed`) is season-mismatched by
construction — that column is always the *current* season's total (from live
`bootstrap-static/`), while a season-long residual needs a *completed* season, and 2026-27 has
only 2 finished gameweeks as of this ticket (1 player, Thiago, with any penalty miss on
record). A materially stronger, matched-season check exists in the same source used for the
residual itself: FPL-Core-Insights' per-gameweek CSV already carries `penalties_scored` and
`penalties_missed` per match for 2025-2026 (see "A discovery" below — this repo just doesn't
ingest them). Cross-checking the 21 flagged candidates against those same-season columns:

**only 5 of 21 (24%) have any penalty attempt — scored or missed — on record for 2025-2026 at
all.** 76% of what the residual method flags has no evidence of ever taking a penalty.

### The method fails a direct correlation check, not just the cross-check

Across all 339 qualifying players, the Pearson correlation between season residual and season
penalty-attempt count is **r = 0.002** — no relationship. Worse, the players with the most real
penalty involvement are not merely absent from the flagged list, they rank in the **bottom
third** of the entire 339-player residual ranking: Palmer (5 scored) ranks 234th, Calvert-Lewin
(4 scored) 274th, B. Fernandes (4 scored) 284th, Mateta (4 scored) 317th, Raúl (4 scored) 318th
of 339. The two best-known 2025-26 penalty takers who DO score positively, Haaland (3 scored,
+0.037/90) and Gyökeres (3 scored, +0.067/90), rank 64th and 37th respectively — nowhere near
the threshold, buried among finishers with zero penalty involvement.

**Why: the model's own input already prices penalty duty in, to first order.**
`src/lib/projection/rates.ts` projects goals from shrunk **xG** per 90, not shrunk actual
goals — and FPL-Core-Insights' own xG model assigns a penalty kick real expected-goal value
(0.79-0.90 in the specific penalty-attempt rows checked while building this ticket, both from
the per-match CSV and cross-referenced against live `bootstrap-static`'s individual penalty
entries). A designated taker's season `prior_xg` already carries that elevated value from every
penalty he attempts, whether he scores it or not. Real Premier League penalty conversion sits
close to that same 0.79-0.90 range, so **in expectation, taking penalties does not push actual
goals persistently above what the model's own xG-based rate already assumes** — which is
exactly why the residual doesn't correlate with penalty duty: there is very little systematic
gap left for it to detect. What's left in the residual is ordinary shot-conversion variance —
the same "small, noisy, near-unrankable" territory G4 already excluded cards, own goals and
penalty misses from, for the same reason.

**This does not mean penalty duty is worthless to a player's total, only that it isn't a hidden
model error.** Ground truth, same season: of the 22 players with >= 2 penalty attempts,
penalty goals account for **27% of their combined goal-scoring points on average** (range
6%-60% per player, e.g. Palmer 50%, B. Fernandes 44%, Thiago 36%). That's a real, large,
concentrated number — and it is already substantially reflected in those players' `prior_xg`,
per the mechanism above, which is why it does not show up as a model gap in the residual.

### Cost figure 3 — captaincy overlap: not yet read

Requires the current season's live `player_projections`, which this Builder session cannot
reach and which 2026-27 (2 finished gameweeks) does not yet have enough of regardless. The
diagnostic implements and tests `computeTopProjectedPerGameweek` /
`computeCaptaincyOverlap` fully; a future run with real credentials against a season with >= 5
gameweeks of stored projections will read it. Given the mechanism finding above — the players a
captaincy call turns on (Haaland, Watkins, etc.) show unremarkable residuals — a large effect
here would be surprising, not expected.

### penalties_order — CONFIRMED PRESENT

Checked directly against a live `bootstrap-static/` fetch while building this ticket, 5 Sep
2026: **yes, `penalties_order` is present** on every element, non-null for 64 of 652 players —
an explicit 1-4 priority ranking per club, naming takers directly rather than inferring them.

### A discovery this ticket did not expect, and does not act on

FPL-Core-Insights' per-gameweek `playermatchstats.csv` — the exact file
`scripts/ingest-core-insights.ts` already fetches for every other `player_match_stats` column —
**also publishes `penalties_scored` and `penalties_missed` per match, populated with real
values** (verified directly: 3 nonzero `penalties_scored` rows in the 2025-2026 GW1 file alone).
`ingest-core-insights.ts`'s row mapping simply never selects those two columns. This is a
cheaper, more direct, same-season ground truth than `penalties_order` — it needs no new
external source, only two more field mappings on an ingest job already running, versus a new
bootstrap-static read. **Recorded for completeness, not actioned:** ticket scope forbids any
ingest or migration change here, and per the recommendation below, the projection-accuracy
question this ticket was asked to answer does not call for either source to be ingested.

### Recommendation: leave it alone

1. **The review's proposed method (goals-minus-xG residual) does not work and should not be
   built on.** r = 0.002 against real penalty attempts; known heavy takers rank in the bottom
   third of the very ranking meant to surface them; 76% of what it flags has no penalty record
   at all.
2. **The underlying worry — captaincy-relevant players carrying unpriced penalty inflation —
   is not supported by the mechanism.** The model's xG-based rate already substantially prices
   in penalty duty, because the source's own xG model values a penalty kick near its real
   conversion rate. There is little bias left for a correction to remove.
3. **Do not chase this via `penalties_order` or the newly-found `penalties_scored`/
   `penalties_missed` CSV columns for projection-accuracy purposes.** Both are real, both are
   cheap, and neither is needed here — the mechanism argument in point 2 already answers the
   question those sources would be ingested to answer. (Either might earn its own ticket for a
   different reason — e.g. an informational "penalty taker" badge in the UI — but that is a
   product decision this diagnostic was not asked to make and does not argue for.)
4. **Close this line of the review.** Penalty duty joins cards, own goals and penalty misses
   (G4) in the "stays out" bucket — not because it's untested, now, but because it was tested
   and the concentrated cost the review worried about did not materialize. If this is ever
   reopened, start from the mechanism argument above, not from re-proposing the residual.
## G17 — Ticket #214, 5 Sep 2026: the learned-model gate was measuring a threshold seam, not a
## finding — fixed to compare every position against the incumbent, live, across repeated splits.
## GATE NOT YET READ (no live Supabase project in this Builder session, same limitation as
## G9/G11/G16's first readings)

**The defect, restated precisely.** Ticket #208's own gate table (as read on its first live run,
report 12) mixed two kinds of threshold in one comparison: Goalkeeper and Defender were judged
against the incumbent baseline-v1 model, computed live on the held-out fold (gameweeks 29-38).
Midfielder and Forward were judged against `GATE_MIDFIELDER_NAIVE_BASELINE_SPEARMAN` (0.464) and
`GATE_FORWARD_NAIVE_BASELINE_SPEARMAN` (0.476) — literal constants copied from report 10, a
FULL-SEASON figure. The held-out fold scores every ranker higher than its full-season number
(incumbent 0.503 on the fold vs 0.407 across the season; naive minutes baseline 0.479 vs 0.407) —
a gap of roughly 0.05-0.07 of Spearman that has nothing to do with model quality and everything to
do with which tenth of the season the fold happens to cover. The reported "2 of 4 lines passed"
therefore split along that threshold seam, not along a real per-position finding. Read like-for-like
instead (same fold, same population, every ranker): the learned model beats the incumbent in exactly
one place, midfield, by 0.016 — a real result, but not evidence yet on a single arbitrary split.

**What #214 changed — the evaluation only, per its own scope. No retraining.** Same model type
(gradient-boosted regression trees), same `DEFAULT_GBM_HYPERPARAMETERS` (60 trees, depth 3,
learning rate 0.08, 40 samples/leaf) and same `FEATURE_NAMES` (15 columns) as #208 — none of that
changed. `scripts/train-and-evaluate-learned-model.ts`:

1. **`TRAIN_EVAL_GAMEWEEK_CUTOFFS` replaces the single fixed `TRAIN_EVAL_GAMEWEEK_CUTOFF`** — four
   independent train/eval splits (gameweek 22, 25, 28, 31), each with its own model fit on that
   split's training fold alone and its own held-out evaluation. A one-split result can no longer
   pass as a finding.
2. **The gate compares EVERY position against the incumbent** — the naive-baseline gate for
   Midfielder/Forward is gone entirely. No figure in the gate table is a literal constant carried
   over from any report, for any position; the incumbent AND all three naive baselines are computed
   fresh, on each split's own held-out fold, in the same run.
3. **`buildGateResults` produces a three-way verdict per position** — `ship` (learned beats
   incumbent on a majority of comparable splits), `do-not-ship` (incumbent wins a majority), or
   `too-close-to-call` (an exact tie — with four splits, 2-2). A fourth state, `insufficient-data`,
   covers a position with no comparable split at all. Nothing is ever guessed into `ship` or
   `do-not-ship` when the evidence does not support it — this is a direct, structural answer to the
   ticket's own worry that "a 0.016 midfield edge that halves under a second split is not evidence
   of anything yet": a result that flips sign across splits now reads as `too-close-to-call` by
   construction, not as a coin flip dressed up as a pass.
4. **The report shows every ranker side by side, per split, per horizon** — learned, incumbent, and
   all three naive baselines (minutes, xG+xA, constant) — plus a cross-split per-position summary
   table of the learned-minus-incumbent margin at every cutoff, with min/max/spread columns, so the
   "does the edge survive every split" question is a number in the report, not something a reader
   has to reconstruct from four separate sections by eye.
5. **The leakage test is now parameterized over every cutoff** in `TRAIN_EVAL_GAMEWEEK_CUTOFFS` —
   the DoD's own sharpening from #208's single-cutoff proof ("a named test proving no gameweek in
   the evaluation set contributed to fitting") to "at every cutoff", since a separate model is now
   fit per split and the leak-guard needs to hold at each one independently.

**Still reuses, never reimplements.** Every ranking figure is produced by
`summarizeGenericBaselineSpearman`/`summarizeBaselines`/`summarizeFiveGameweekBaselines`, imported
from `scripts/run-backtest.ts`, unedited by this ticket (grep-checkable: the file defines no
Spearman correlation and no rank function of its own) — and `run-backtest.ts` itself was not
touched, since #215 edits that file concurrently in this same batch on a separate branch.

**GATE NOT YET READ — stated plainly, exactly the limitation G9/G11/G16 already recorded for their
own first readings.** This Builder session has no live Supabase project and no
`SUPABASE_URL`/`SUPABASE_SECRET_KEY` in its environment, so the rewritten harness has been proven
correct on constructed rows (47 tests, all passing, no live database) but has never executed
against the real `training_features`/`feature_history`/`player_match_stats` rows. **No per-position,
per-split figure in this entry is a measured result — there isn't one yet.** The confirming step:
run `SUPABASE_URL=... SUPABASE_SECRET_KEY=... npx tsx scripts/train-and-evaluate-learned-model.ts`
and read the report's own per-split tables, cross-split summary, and Gate section. The report
records the git commit SHA it ran at and a plain-language note on which minutes model that SHA
reflects (this ticket's own commit, `30bfd1672ab916dbe5ebcc6723cb393186f5798d`, was written on a
branch forked from `main` at `6bad91c...` — BEFORE ticket #213's concurrent widening of
`PlayerProjectionInput`/`estimateMinutes` on its own branch in this same batch, so a run of this
exact commit reflects today's `main` minutes model, not #213's). **Do not compare a live run's
numbers against report 12's figures** — report 12 used a single arbitrary split; this harness uses
repeated splits, a different methodology, not a like-for-like re-read of the same measurement.

**No tuning against the gate, and no retraining — unchanged from #208's own discipline, restated
for four splits instead of one.** The hyperparameters, the four cutoffs and the feature list are
all fixed before this file's own `main()` ever reads a row of real data. If every position reads
`do-not-ship` or `too-close-to-call` on the first live run, that is this ticket's own anticipated
honest outcome (its own notes: "the honest outcome here may well be 'do not ship any of it'"), not
a defect to iterate away.

---

## G18 — Ticket #219, 5 Sep 2026: `penalties_order` ingested; xG-includes-penalties CONFIRMED
## independently; Treatment A (reduced shrinkage for first-choice takers) measured and REJECTED —
## it makes goal calibration worse, not better. NO MODEL CHANGE SHIPPED.

Builds directly on ticket #218's penalty-duty diagnostic (the "#215" entry immediately above this
one — the diagnostic ticket, PR #218 — the residual method is DEAD and this entry does not revive
it). That entry answered whether the review's *proposed* fix works (no) and recommended, correctly,
not chasing `penalties_order` for projection-accuracy purposes *without first measuring a candidate
treatment*. This ticket does the measuring: it ingests the field for real (#218 only diagnosed
against a live fetch, it wrote no migration and no ingest column), independently re-verifies the
xG mechanism #218 argued for with a cleaner instrument, and tests the one candidate treatment #218
did not build (a persistence-based shrinkage change, as opposed to the residual identification
method #218 already killed). **Both are different questions from #218's — this entry does not
repeat that measurement, it extends it.**

### What shipped: the ingest only

`supabase/migrations/20260905090000_players_penalties_order.sql` adds `public.players.penalties_order`
(nullable smallint, no default — NOT YET APPLIED, see `supabase/README.md`).
`scripts/ingest-fpl.ts`'s `mapPlayers` now reads it verbatim from `bootstrap-static/`, and
`job_runs.details.playersWithPenaltiesOrder` reports the non-null count on every run.
Live-checked while building this ticket, 5 Sep 2026: **61 of 652 elements** carry a non-null value,
distributed 1: 20, 2: 17, 3: 15, 4: 6, 5: 3 — close to, not identical to, #218's own "64 of 652"
figure from the same week (normal squad-list churn over a few days: transfers, injuries, position
changes — not a data problem, and not investigated further here). Note the range: FPL publishes
priority ranks up to **5**, not just the 1–3 the ticket's own definition of done anticipated;
`mapPlayers` applies no range check and stores whatever the source sends, per the migration's own
header.

### Question 1 — does the ingested xG already include penalty value? CONFIRMED YES, independently,
### with a cleaner instrument than #218's

#218 already answered this ("the model's own input already prices penalty duty in, to first
order") from individual live `bootstrap-static` penalty rows and eyeballed per-match CSV values
(0.79–0.90 xG). This ticket's own instructions require settling it again "from the actual ingested
data / source code," so it was re-measured with a cleaner, lower-noise method: **isolate player-match
rows where the player's entire shot count that match WAS the penalty attempt** (`total_shots ==
penalties_scored + penalties_missed`), so the match's whole `xg` figure is attributable to the
penalty alone — no dilution from open-play shots mixed into the same aggregate.

**Method and source.** Every one of FPL-Core-Insights' 38 `playermatchstats.csv` files for the
complete 2025-2026 season (the same public source, over plain HTTPS, `scripts/ingest-core-insights.ts`
already reads), fetched directly — this Builder session has no live Supabase project (the same
limitation recorded throughout this file for G9/G11/G16/G17), but it does have outbound network
access to the same public sources those jobs read, confirmed live at the start of this ticket.

**Result: 25 isolated single-shot-penalty rows across the full season.**

| Statistic | Value |
|---|---|
| n | 25 |
| mean xG per penalty | 0.7899 |
| median | 0.7900 |
| min / max | 0.7884 / 0.7900 |
| population stdev | 0.0003 |

Every one of the 25 rows falls in a 0.0016-wide band around 0.79 — this is not noisy shot-level
variation, it is FPL-Core-Insights' xG model treating "penalty kick" as close to a fixed-value
event, independent of whether it was scored or missed (25 rows include both outcomes). This
corroborates #218's 0.79–0.90 finding with a tighter, purpose-built instrument and the same
conclusion, and traces the exact code path: `scripts/ingest-core-insights.ts` writes this CSV's
`xg` column straight into `player_match_stats.xg` (`xg: toNumeric(record.xg)`);
`src/lib/projection/rates.ts`'s `computePlayerRates`/`computeTwoStagePlayerRates` shrink that same
column into `xgPer90`; `src/lib/projection/expectedPoints.ts`'s `expectedGoals = playerRates.xgPer90
× minutesFraction × attackMultiplier × goalConversionFactor(position)` consumes it directly. There
is no point in that chain where penalty value could be stripped out even if a designer wanted it
to be — it is baked into the same number as every other shot the moment the CSV is read.

**CONFIRMED: penalty value is already inside the ingested xG, at a nearly-fixed ~0.79 per attempt,
regardless of outcome. Treatment B (an explicit penalty scoring term) would double-count against
this and MUST NOT be built** — exactly the ticket's own stated condition for ruling it out, and
exactly the G1-class defect (a second term pricing in value a first term already prices in) the
ticket named as the risk. **Not built. `src/lib/projection/` has no penalty-specific scoring term
before or after this ticket.**

### Question 2 — Treatment A (reduced shrinkage for `penalties_order === 1` takers): MEASURED,
### and it makes calibration WORSE, not better. REJECTED.

**The hypothesis being tested**, stated in the ticket: a penalty taker's rate is more persistent
than an equivalent-magnitude open-play rate (a penalty recurs by appointment; open play doesn't),
so shrinking a taker's observed rate toward the position prior with the same `SHRINKAGE_K = 3` as
everyone else under-credits him relative to a lower-`K` treatment that trusts his own observed rate
more. This is a real, distinct, testable claim from Question 1 — the xG mechanism answers
*whether* penalty value is in the rate, this asks whether the model shrinks that rate correctly.

**Why a within-season split, not a live backtest.** This Builder session has no live Supabase
project (same limitation as every "not yet read" entry in this file — G9/G11/G16/G17/§Question 1
above), so `scripts/run-backtest.ts`'s live 5-gameweek harness cannot be run, and this ticket's
scope forbids editing that file regardless (a different ticket owns it this batch). Reproducing the
model's exact shrinkage formula and goal-conversion constants against the complete, already-played
2025-2026 season — the same technique #218 used for its own residual measurement — gives a real,
if within-season, test: split the 38-gameweek season into a "build" half (GW1–19, standing in for
the personal-prior-building history a live projection would use) and a "held-out" half (GW20–38,
standing in for the gameweeks a projection is trying to predict).

**Reused, not reinvented:** `SHRINKAGE_K = 3` and the exact `shrunkRate` formula from
`src/lib/projection/rates.ts`; `GOAL_CONVERSION_MIDFIELDER = 0.98` and `GOAL_CONVERSION_FORWARD =
0.97` from `src/lib/projection/expectedPoints.ts`, verbatim, not re-derived. No fixture multiplier
is applied on either side (this measurement isolates the shrinkage question only, exactly as
`docs/model-review-2026-09-02.md`'s own neutral-fixture variant technique does elsewhere in this
file for the same reason — isolating one mechanism from another).

**Population.** Current (2026/27) `penalties_order === 1` players (20 total, live bootstrap-static,
5 Sep 2026), joined to their 2025-2026 season record via the stable FPL `code` (never the
per-season element id — same join rule this file states repeatedly, e.g. G6/G13). Of those, **16**
had >= 450 minutes (5 nineties) in the held-out half (GW20–38) and so have a real actual-goals
figure to calibrate against: Groß, Buendía, Gibbs-White, Szoboszlai, Calvert-Lewin, Haaland,
Palmer, Saka, Kroupi.Jr, Thiago, Barry, Mateta, B.Fernandes, Solanke, Diarra, Osula. The remaining
**175** qualifying Midfielders/Forwards (>= 450 held-out-half minutes, any penalty role or none)
serve as the position-level population the falsification check's own wording ("forward and
midfield goal calibration") asks about.

**Treatment A tested at three shrinkage strengths, applied ONLY to the 16 takers** (`K = 2`, `1`,
`0.5`, against the shipped `K = 3` baseline) — a lower `K` trusts the taker's own observed
build-half rate more and the position prior less, exactly the direction the hypothesis argues for:

**Takers subgroup — goal calibration (actual / predicted, summed over all 16):**

| K | Sum actual | Sum predicted | Actual / Predicted | MAE |
|---|---|---|---|---|
| 3 (shipped) | 98 | 98.15 | **0.998** | 2.384 |
| 2 (Treatment A) | 98 | 99.88 | 0.981 | 2.395 |
| 1 (Treatment A) | 98 | 102.01 | 0.961 | 2.430 |
| 0.5 (Treatment A) | 98 | 103.39 | 0.948 | 2.453 |

The shipped `K = 3` default is already calibrated almost exactly right for this specific
population — 0.998, effectively 1.0. **Every tested reduction in `K` moves the ratio further from
1.0, monotonically, not closer.** MAE moves the same direction, monotonically, though more mildly.
This is the opposite of the ticket's own hypothesis: there is no under-crediting here for a lower
`K` to recover.

**The same effect holds at the full position level, once the 16 takers are blended back into the
175 controls (191 total) — the literal population the falsification check names:**

| Position | K | Sum actual | Sum predicted | Actual / Predicted |
|---|---|---|---|---|
| Forward (n=39) | 3 (shipped) | 203 | 206.08 | 0.9851 |
| Forward (n=39) | 1-for-takers (Treatment A) | 203 | 208.09 | **0.9755 (worse)** |
| Midfielder (n=152) | 3 (shipped) | 312 | 331.67 | 0.9407 |
| Midfielder (n=152) | 1-for-takers (Treatment A) | 312 | 333.51 | **0.9355 (worse)** |

Both positions already run slightly hot (predicted > actual) even at `K = 3`; Treatment A pushes
both further in that same direction. **This alone fails the falsification check's primary bar
("Forward and midfield goal calibration must IMPROVE") outright — it does not merely fail to help,
every tested strength makes it worse, and worse in proportion to how aggressively it is applied.**

**Spearman rank correlation (predicted vs actual), same 191-player population, `K = 1` for
takers only vs the `K = 3` baseline — checked per the falsification check's second bar even
though the first bar already fails:**

| Population | K=3 baseline | Treatment A (K=1-for-takers) |
|---|---|---|
| All Forward + Midfielder (n=191) | 0.7214 | 0.7209 |
| Forward only (n=39) | 0.6648 | 0.6688 |
| Midfielder only (n=152) | 0.6511 | 0.6507 |

Flat to negligible in both directions — a wash, not a clean pass or fail on this bar alone, and
irrelevant given the calibration bar already failed decisively.

**Why, mechanistically — tied back to Question 1's finding.** The ticket's hypothesis assumed a
taker's true output needs recovering from under a too-strong shrinkage. But Question 1 established
that penalty credit is real, present, and reliably ~0.79 per attempt in the taker's OWN observed
xG regardless of scoring outcome — his elevated rate is already sitting in the number `K = 3`
shrinks, not missing from it. Shrinkage's job is to guard against one half-season's own sampling
noise being over-trusted; for this specific population (already-established, high-minutes
players), `K = 3`'s existing level was already tuned about right for that noise, and reducing it
does not recover a missing signal — it re-injects exactly the single-half noise the shrinkage
exists to dampen. This is the same shape of finding G10 recorded for defcon's own `k = 5`:
shrinkage strength is generic across the underlying count it shrinks (`rates.ts`'s own header
states this explicitly), and there was no population-specific persistence gap here for a
population-specific `K` to fix.

**Overlap check — measured exactly, not argued.** The falsification check requires stating whether
the players a treatment lifts match `penalties_order`, "not the dead residual method's ... list."
Reusing `scripts/penalty-duty-diagnostic.ts`'s own exported `aggregateSeasonTotals`/
`identifyPenaltyDutyCandidates` (unmodified — this ticket does not touch that file) against the
same 2025-2026 CSVs and the live `penalties_order` list: the residual method flags **20** candidates
season-long; the current `penalties_order === 1` list has **20** players; **only 3 names appear on
both** (Kroupi.Jr, Osula, Solanke) — an 85% disjoint pair of lists, confirming by direct
measurement, not by construction alone, that Treatment A's population (gated explicitly on
`penalties_order`) is a different population from the dead residual method's own flagged list. (The
qualifying-population and candidate-count figures here — 369/20 — differ slightly from #218's own
339/21 due to this reproduction's simpler position resolution; the overlap conclusion is
insensitive to that small difference either way.)

**Sample-size caveat, stated plainly.** 16 takers, ~98 held-out-half actual goals, is a real but
modest-scale sample. The direction is unambiguous and monotonic across four tested `K` values (3,
2, 1, 0.5), which is a strong shape for a genuine effect rather than sampling noise, but a future
re-measurement across an actual season boundary (build on 2025-26, evaluate on 2026-27 as it
completes) would be a stronger instrument than this within-season half-split, were this ever
revisited. Not attempted here — out of this ticket's scope, and not warranted by a result this
one-directional.

### Recommendation: SHIP NEITHER TREATMENT

1. **Treatment B (explicit penalty scoring term): not built.** Question 1 confirms it would
   double-count against xG's own ~0.79-per-attempt penalty credit — exactly the ticket's own
   stated condition for ruling it out before writing a line of it.
2. **Treatment A (reduced shrinkage for first-choice takers): built as a measurement only, not
   shipped.** It fails the falsification check's primary bar outright — Forward and Midfielder
   goal calibration get WORSE at every tested strength, not better — so per the ticket's own
   instruction, it is not applied.
3. **`src/lib/projection/rates.ts` and `src/lib/projection/expectedPoints.ts` are UNCHANGED by
   this ticket.** Reading them was necessary to answer both questions; nothing found in either
   measurement warranted editing them.
4. **Penalty duty stays closed**, per #218's own recommendation, now reaffirmed with a second,
   independent xG instrument and one tested (not merely argued) candidate fix that did not clear
   its own bar. If this is ever reopened, start from a genuine season-boundary backtest (the
   caveat above), not from re-proposing either treatment measured here on the same within-season
   evidence.
5. **What this ticket DOES leave behind:** `public.players.penalties_order`, ingested and counted,
   for any future, separately-scoped use (e.g. a UI "penalty taker" badge) — see the migration's
   own header for why that is a live option this ticket does not itself pursue.
## Ticket #220, 5 Sep 2026: closing out the model programme — three threads recorded together,
## because they are the same finding read three times: this model is at its ceiling, an
## experiment answered its question inside budget, and a correctly-specified gate did not stop
## a merge it should have stopped

This entry is bookkeeping, not measurement. **No model code changed here — everything under
`src/lib/projection/` is exactly as #216/#217/#218 left it.** Written on branch
`claude/ticket-220-close-out-model-programme`, at commit `06d0d92` (forked from `main` at
`cff8fd3`). Ticket #219, in the same batch, is concurrently editing `src/lib/projection/rates.ts`
on its own unmerged branch — nothing below was recomputed against that branch, and nothing below
should be read as reflecting whatever #219 lands. The three figures this entry carries forward
(the #217 falsification result, the #216 four-split margin table, and the baseline-v1 five-
gameweek headline) are #216's/#217's own already-measured results, not something re-derived here
— this session has no live Supabase project, the same limitation G9/G11/G15/G16/G17 above all
record for their own first readings, so nothing quantitative in this entry claiming to be a fresh
measurement is one; where a number could not be recomputed live it is named as inherited, not
reproduced.

### Thread 1 — the #217 shrinkage: measured to be immaterial, and its own falsification gate did
### not stop the merge

**The gate, stated in #217's own ticket text.** "At five gameweeks, midfield must rise from 0.421
toward 0.464 and forward from 0.442 toward 0.476. If neither moves materially, stop, do not
merge." 0.464 and 0.476 are G15's own naive-minutes-baseline gate figures (above) — the thing
#217's shrinkage was built to close some of the gap toward.

**What the backtest actually measured — backtest report 13, read after #217 had already merged.**
Midfield **0.426** (against a target of 0.464 — a move of **+0.005** against a needed **+0.043**),
forward **0.446** (against a target of 0.476 — a move of **+0.004** against a needed **+0.034**).
Neither move is material by any reasonable reading of #217's own pre-registered bar. **The gate's
own condition was met, and the ticket merged anyway.** Both facts are recorded here because the
ticket asked for both, not because this entry is assigning blame. The mechanical reason THIS could
happen — not just that it did — sits in `.github/workflows/backtest.yml`'s own header: the Backtest
job is "workflow_dispatch only, deliberately no schedule ... run by hand, on demand." Producing the
number the gate needed requires a human to manually trigger that workflow and read its report; no
step in this pipeline computes it automatically, and nothing ties that manual step to the PR review
or merge decision. #217's own Builder session pre-registered the gate correctly from
`docs/model-review-2026-09-02.md`'s existing figures (the ones it could see without dispatching
anything), but could not itself produce the post-change number the gate needed to be checked against
— the same "no live Supabase project in this Builder session" limitation this file's own G9/G11/
G16/G17 entries record for their first readings. See the drafted learnings-entry text at the bottom
of this section for the fuller process reading, which belongs in `app-factory`'s own learnings
file, not here.

**Why it moved so little — the hypothesis this ticket was asked to test first: the window and
season means are usually already close.** Ticket #220 adds a diagnostic to
`scripts/run-backtest.ts` (`computeWindowSeasonMinutesGap` /
`bucketWindowSeasonMinutesGap` / `summarizeWindowSeasonMinutesGap`) that reports, over the exact
same single-gameweek measured population every other diagnostic in that file uses, the
distribution of `|recent-minutes window mean − season minutes-per-match mean|` — the precise
quantity #217's shrinkage formula pulls one value toward the other by. Bucketed `<5 / 5–10 / 10–20
/ 20–40 / 40+` minutes, with the same `MIN_BUCKET_SAMPLE_SIZE` (50) "too small to read" rule every
other bucketed diagnostic in that file already uses. **This diagnostic's live figures are NOT YET
READ — this Builder session has no live Supabase project, the same limitation every earlier
first-reading entry in this file records.** The confirming step is the next scheduled Backtest
run; read the new "Window vs season minutes" section it prints, immediately after the
ticket-#187 minutes-evidence section.

**A second, complementary mechanism — derivable from the formula itself, without live data, and
worth reading alongside whatever the distribution above eventually shows.** `estimateMinutes`'s
shrinkage weight on the season figure is `SHRINKAGE_K / (windowLength + SHRINKAGE_K)` — with
`SHRINKAGE_K = 3` (`src/lib/projection/rates.ts`) and a full five-match window
(`RECENT_MATCH_COUNT = 5`, `src/lib/projection/minutes.ts`), that weight is `3 / (5 + 3) =
0.375`. **Even for a player whose window and season means genuinely differ, the shipped model can
only close 37.5% of that gap for a nailed starter with a full window** — the naive "prior minutes
per match" baseline, by contrast, is the season mean outright: 100% of the gap, by construction.
Players with shorter windows (early in the season, or returning from injury) get pulled harder —
weight `3/4 = 0.75` at window length 1 — but the measured population this backtest scores is
weighted toward established players with fuller windows, exactly the population where the cap
bites hardest. This is a real, code-derivable property of the fixed formula #217's own scope
required reusing unmodified (no new fitted parameter), not a criticism of the choice to reuse it.

**Left as an open question — deliberately, per this ticket's own instruction not to invent an
answer.** Two candidate explanations for the tiny observed move now exist — (a) most players'
window and season means are already close (the distribution this ticket's diagnostic will read),
and (b) even a real gap is only ever partially closed by the fixed `SHRINKAGE_K = 3` weight — and
this entry cannot yet say how much each contributes, or whether either fully accounts for the
remaining gap to the naive baseline's 0.464/0.476. **Do not tune `SHRINKAGE_K`, `RECENT_MATCH_COUNT`,
or any constant in `minutes.ts`/`rates.ts` from this entry** — that is exactly the kind of
reach-for-a-constant move G10's own precedent (§ "do NOT tune `k`... from this evidence") warns
against, and neither candidate explanation has been measured yet. The next scheduled Backtest run's
new diagnostic section is the next real evidence; read it, and (a) if most gaps are small, (a)
is confirmed as the dominant story; if gaps are typically large but the move is still small, (b) is
implicated instead, and a future ticket would need to weigh whether the fixed shrink weight itself
should be revisited — a Tier 2 modelling decision this bookkeeping ticket does not make.

### Thread 2 — learned-v1: measured and parked, not failed

Ticket #216's fair-gate re-run — every threshold computed live on each split's own held-out fold,
across four independent train/eval cutoffs (gameweek 22/25/28/31), never a baseline lifted from a
different report (the mixed-threshold defect ticket #214 fixed, per that ticket's own G17 entry
above; #216 is the first live run against that fixed harness). The full four-split result, carried
forward verbatim:

| Position | Splits won vs incumbent | Verdict | Margins |
|---|---|---|---|
| Goalkeeper | 0 of 4 | do-not-ship | losing by up to 0.193 |
| Defender | 2 of 4 | too-close-to-call | not separately itemised in this ticket's source text |
| Midfielder | 4 of 4 | **ship** (arithmetically) | +0.001, +0.005, +0.005, +0.024 |
| Forward | 0 of 4 | do-not-ship | not separately itemised in this ticket's source text |

**Midfielder's own mean edge: (0.001 + 0.005 + 0.005 + 0.024) / 4 ≈ 0.009** — matching the ~0.009
this ticket's own text states. Against #216's own stated instrument resolution of roughly ±0.01
(this entry does not re-derive that figure — #216's own report is the source, not this file's own
season-scale `SE(ρ) ≈ 1/√(n−1)` heuristic from G16's enquiry 2, which is not directly comparable at
a single split's smaller fold size), a 0.009 mean edge is **inside the noise floor of the
instrument used to measure it.** Three of the four individual splits (+0.001, +0.005, +0.005) are
smaller than that resolution on their own; only one split (+0.024) would clear it in isolation, and
a single split out of four is exactly the "not evidence of anything yet" case #214's own gate
redesign was built to stop a false read on.

**The verdict table's own "ship" label for midfielder is arithmetically correct and substantively
too small to act on — both statements are true at once, and this entry states both rather than
picking one.** `buildGateResults`'s majority-of-splits rule (G17, ticket #214) counted the wins
correctly: 4 of 4 splits favoured the learned model, so "ship" is the right output of that
function, given its own stated rule. It is a different question whether a mean edge of ~0.009,
against a resolution of ~0.01, is a result to act on — and it is not.

**This is "measured and parked", not "failed".** `product-brief.md` §6c's own governing property
of the projection seam is that a model can be replaced without touching the solver, the app, the
data layer or the notifications — which is exactly what makes an experiment like `learned-v1`
cheap to run and cheap to set down again. The experiment asked a well-posed question (does a
small gradient-boosted model, given `training_features`' 15 columns, out-rank the incumbent on a
fair, repeated-split gate) and answered it inside its own budget: no, not by a margin this
instrument can distinguish from noise, at any position. That is the seam working as intended, not
a wasted ticket. **`learned-v1` is parked, not deleted** — `scripts/train-and-evaluate-learned-
model.ts` and `public.training_features` (G15/G16) stay in the repo as a substrate a future
attempt could restart from (a different feature set, a different model family, more seasons of
data) without repeating #203's/#208's own groundwork. Nothing here recommends restarting it
without new evidence that the edge would clear the instrument's own resolution.

### Thread 3 — baseline-v1: at its ceiling

At the five-gameweek horizon, on the same honest backtest instrument this file already treats as
the trustworthy reading (G13's addendum, G17): the shipped model scores **0.409**, the naive
"prior minutes per match" ranker scores **0.407**, and the leave-target-out hindsight ceiling sits
at **0.506**. The model and the simplest possible baseline are, at this horizon, within noise of
each other. **Every remaining constant the 2 September model review tested was worth ≤0.01** of
Spearman at this horizon — this ticket's own framing, not re-derived here — and the two most
recent, most directly measured confirmations of that ceiling sit in this same file: #217's minutes
shrinkage (Thread 1 above, +0.005/+0.004) and #216's learned-model gate (Thread 2 above, a mean
midfield edge of ~0.009, the only position that came close to clearing anything). Both are
comfortably inside the same "≤0.01" band.

**The standing rule, from this point forward: no further constant already measured against these
metrics is to be re-tuned against them.** `SHRINKAGE_K`, `RECENT_MATCH_COUNT`, the attacking
fixture multiplier's offset (#184), and the learned-model hyperparameters/feature list
(#208/#214/#216) have each now been measured, directly or by a documented proxy, as worth `≤0.01`
of Spearman at this horizon — at or below what this file's own instrument (a Spearman correlation
on a population in the low thousands, per position) can distinguish from sampling noise.
Continuing to re-tune any of THESE SPECIFIC constants against these same season-level Spearman/MAE
figures is asking the same instrument to answer a question it has already answered for them. **This
freeze does not extend to work this file has explicitly left open** — most notably G12's
defensive-multiplier measurement, which this file already states must not be touched "without its
own separate measurement and ticket" (its own words, unchanged by this entry) precisely because it
has NOT yet been measured the way the constants above have. `docs/model-review-2026-09-02.md`'s
other remaining open items (a genuinely fixture-aware oracle per G14's option 2, more seasons of
`training_features` for a future learned-model attempt) are likewise untouched by this freeze —
they are different levers, not smaller turns of the ones already exhausted here. A future ticket
proposing to re-tune one of the already-measured constants against the season Spearman or MAE
figures should point to *new* evidence — a different population, a different horizon, a different
instrument — not another pass over the same backtest with the same constants.

### Drafted learnings-entry text — for `app-factory/LEARNINGS-second-build-wave.md`, pasted by hand

This repo cannot write to `app-factory`. The text below is drafted in full for the orchestrator to
carry into that file's own numbered-finding style; it is not written anywhere in this repo other
than here and in this ticket's own PR body/report.

> **Finding: a correctly-specified falsification gate did not stop a merge it required to stop —
> the second time this shape of gap has appeared.**
>
> Ticket #217 (fpl-advisor) pre-registered its own revert condition before shipping: "at five
> gameweeks, midfield must rise from 0.421 toward 0.464 and forward from 0.442 toward 0.476. If
> neither moves materially, stop, do not merge." Backtest report 13 — read only after #217 had
> already merged — measured midfield at 0.426 (a move of +0.005 against a required +0.043) and
> forward at 0.446 (+0.004 against a required +0.034). Neither move is material by the gate's own
> stated bar. The ticket merged anyway.
>
> The threshold was not vague, was not missed for lack of a check, and the check was not run
> against the wrong data — it simply could not run before the merge decision was made, and nothing
> in the pipeline required it to. The Backtest job that alone can compute this figure
> (`.github/workflows/backtest.yml`) is `workflow_dispatch`-only, by explicit design ("a
> measurement job, not a scheduled one ... run by hand, on demand") — no Builder session, and no
> automated step in this pipeline, can trigger it or read its report. The Builder session that
> shipped #217 could see the model review's EXISTING figures (the ones the gate's own threshold
> values were drawn from) but had no way to produce the post-change number the gate needed to be
> checked against before proposing the diff as done — the same "no live Supabase project in this
> Builder session" limitation this repo's own `docs/projection-model-backlog.md` records, by name,
> for nearly every ticket that has touched the projection model this build wave. A ticket can
> pre-register a falsification gate in its own prose with complete honesty and still have no way to
> enforce it, because the one instrument that can evaluate it is human-triggered and asynchronous to
> the PR review and merge process. Nothing here failed to follow the process; the process itself has
> no step that connects "the gate exists" to "the gate is checked before merge."
>
> This is a process finding, not a blame note — the check itself was correctly designed and
> correctly specified; nothing downstream of it was positioned to act on its result before the
> point of no return. **This is the second time this has happened — a similar §17 finding in this
> same file was the first.** This entry does not restate that earlier finding's own content
> (fpl-advisor's own working copy of this file has no access to re-read it) — it is named here only
> so the two are counted together, as the ticket that requested this entry asked. Two occurrences of
> "a check existed, fired, and its result did not stop the thing it was meant to stop" is a pattern,
> not a coincidence, and in this case the pattern has an identifiable cause: a check whose only
> instrument is a human-triggered, on-demand GitHub Action has no way to run before a merge decision
> unless a human is deliberately made to run it first.
>
> **A concrete fix, for a future revision of this pipeline to weigh, not adopted here:** a ticket
> that states a numeric falsification gate against a report only a manual workflow dispatch can
> produce should not be eligible to leave `status:for-review` for a merge until that report has
> actually been read against the gate — either by requiring the draft PR to carry an explicit
> "gate: UNCONFIRMED, needs a live Backtest read" note that a human must clear before merging, or by
> giving the orchestrator (which already holds the GitHub tools this pipeline trusts) a way to
> dispatch that one workflow and block the ticket on its result, the same way a Tier 1 stop already
> blocks a ticket rather than the run. Either way, the fix is a process step, not a sharper-worded
> instruction to the Builder — the Builder in this instance could not have done anything differently
> with the tools it had.

---

## G19 — Ticket #225, 11 Sep 2026: G18's verdict reconfirmed via a second, independent live
## endpoint; a regression test now locks the non-coupling in code; still SHIP NEITHER TREATMENT

**This entry does not re-litigate G18.** Ticket #225 asked the same two questions G18 (ticket
#219, PR #221, merged) already answered — this Builder session's first act was re-reading G18 in
full and confirming, from `git log` and `supabase/README.md`, that #219 is on `main`. Redoing its
measurement from scratch would have repeated work already done and risked second-guessing a
result that was rejected on a real, monotonic calibration failure, not on absence of evidence —
exactly what the "close out the model programme" entry above (ticket #220, Thread 3) already warns
against ("no further constant already measured against these metrics is to be re-tuned"). So this
entry adds only the two things G18 did not cover, per the orchestrator/Analyst's explicit scoping:
an independent cross-check via a second live endpoint, and a regression test at the model layer.
**Nothing in `src/lib/projection/rates.ts` or `src/lib/projection/expectedPoints.ts` changed as a
result — both are confirmed still exactly as G18 left them.**

### The independent check: `event/{gw}/live/`, read directly, 11 Sep 2026

G18's xG-includes-penalties finding was built entirely from FPL-Core-Insights' per-match CSVs.
This ticket's own text asked for the second source it names: FPL's own `event/{gw}/live/`
endpoint, which publishes `expected_goals` and `penalties_missed` **per player per gameweek** —
read directly (no dependency on ticket #224's new table, which this ticket does not assume exists
on `main`).

**What the endpoint actually contains, checked before trusting it.** `event/{gw}/live/`'s
per-element `stats` block has `penalties_missed` (a count) and `expected_goals` (a per-gameweek
total), but **no `penalties_scored` field at all** — confirmed by inspecting the raw JSON directly.
So, unlike G18's isolated-single-shot-row method (which could isolate a scored penalty because the
source CSV carries `penalties_scored`/`penalties_missed`/`total_shots` per match), this endpoint
can only give a clean, unambiguous signal on a **missed** penalty: a miss proves an attempted spot
kick without needing to disentangle it from open-play goals in the same match.

**Live read, 2026/27 season, gameweeks 1–3 (the only finished gameweeks as of 11 Sep 2026):
scanning every element's `stats.penalties_missed` across all three gameweeks turns up exactly one
match with a penalty miss — Thiago (`penalties_order = 1`), gameweek 1.** His full `event/1/live/`
line: 82 minutes, 0 goals, `penalties_missed: 1`, **`expected_goals: "1.00"`**, 0 points. This is
the same player #218's own cross-check named as "the 1 player, Thiago, with any penalty miss on
record" for 2025-2026 — the pattern repeats in the new season on the new endpoint.

**Reading it against the hypothesis.** If FPL's own live `expected_goals` figure excluded penalty
value, a missed spot kick — zero goals, one shot from open play plus whatever else he did that
match — would not plausibly reach 1.00 xG in a single 90. Landing at exactly that level on a match
where he is independently known to have missed a penalty is consistent with the same ~0.79-ish
penalty credit G18 measured from the CSV source being present here too, on a different data
provider path (FPL's own official live stats, not FPL-Core-Insights). **This corroborates G18's
Question 1 finding from the second, independent instrument the ticket asked for. It does not
overturn it, and one match is not a new statistical claim — it is a single-point sanity check,
reported as exactly that, not inflated into its own measurement.**

**Current `penalties_order = 1` roster, re-checked live, 11 Sep 2026 (for the record, since
populations drift — G18 itself notes this): 20 players** — B.Fernandes, Barry, Buendía,
Calvert-Lewin, Clarke, Diarra, Gibbs-White, Gonzalo, Groß, Haaland, Kroupi.Jr, Mateta, McBurnie,
Osula, Palmer, Saka, Solanke, Szoboszlai, Thiago, Wright. Four names (Clarke, Gonzalo, McBurnie,
Wright) were not on G18's own 5 September list — ordinary squad/role churn, exactly as G18's own
"1: 20, 2: 17..." vs "1: 20, 2: 19..." note anticipated, not investigated further here (out of
this ticket's scope).

**The overlap check this ticket's own text asks for, restated against the current list, not
recomputed from scratch (G18 already did the measurement; recomputing it against the same
2025-2026 CSVs would reproduce the same 3/20 figure G18 reports).** None of the four names this
ticket's own context paragraph uses as its illustration of #218's dead residual method (Romero,
Mount, Madueke, Doku) appear anywhere in the current `penalties_order = 1` list above. This is
consistent with, not a replacement for, G18's own directly-measured figure: the residual method's
20 flagged candidates and the `penalties_order = 1` list of 20 overlap on only 3 names (Kroupi.Jr,
Osula, Solanke) — an 85% disjoint pair. Since neither treatment ships (next section), there is no
"lifted" population for this ticket to check in the first place; the check that matters is that
the population Treatment A *would* have touched is not the dead method's own list, and G18 already
proved that directly.

### Regression test added: a player is unaffected by `penalties_order` at the model layer

**Why this needed a real test, not just an observation.** `scripts/project-points.ts`'s own
players `select(...)` (the query that reads `public.players` into this job) does not select
`penalties_order` at all — confirmed by reading it. Combined with G18's finding that
`src/lib/projection/rates.ts` and `expectedPoints.ts` were left unchanged, the field cannot reach
the model layer today, by construction. `scripts/ingest-fpl.test.ts` already covers the ingest
layer's own null-handling (FPL sends `null` for a player with no recorded penalty-taking role, and
`mapPlayers` must store `null`, never coerce it to `0`) — that is a different layer and does not
cover the claim this ticket's DoD makes, which is about the *model* never varying its output
because of this field.

**The test:** `src/lib/projection/expectedPoints.test.ts`, new `describe` block, ticket #225 named
in its title. Builds one `PlayerProjectionInput` shaped like a real first-choice penalty taker
(non-zero `xgPer90`, realistic minutes, a live, non-neutral fixture) and calls `projectPlayerFixture`
twice: once on that object as-is, once on a shallow copy with an extra `penalties_order: 1`
property attached (simulating what would happen if a future `project-points.ts` change started
passing the raw column through without wiring it into the formula, the exact leak this ticket
exists to guard against) — then asserts the two `FixtureProjection` results are `toStrictEqual`.
A second case repeats it with `penalties_order: null` explicitly, and a third with the property
absent entirely, all three asserted equal to each other. **`PlayerProjectionInput` has no
`penaltiesOrder`/`penalties_order` field in its own type today, so `projectPlayerFixture` cannot
read it — this test is what turns that structural fact into an enforced regression: if a later
ticket adds such a field to the type and starts branching on it, this test fails until it is
deliberately updated, which is exactly the point.**

### Recommendation: unchanged — SHIP NEITHER TREATMENT (reaffirming G18, not re-deciding it)

1. Treatment B: still not built, still ruled out as double-counting (G18, reconfirmed by the
   `event/{gw}/live/` read above).
2. Treatment A: still not shipped. G18's within-season measurement (fails Forward/Midfielder
   calibration monotonically at every tested `K`) is the only measurement of this treatment that
   exists or was needed; nothing in this ticket's narrower scope re-ran it, per the
   orchestrator/Analyst's explicit instruction not to re-litigate an already-measured constant.
3. `src/lib/projection/rates.ts` and `src/lib/projection/expectedPoints.ts`: **confirmed
   unchanged** by this ticket — the only edit under `src/` is the new regression test in
   `expectedPoints.test.ts`, which asserts current behaviour, it does not alter it.
4. Penalty duty stays closed, now reconfirmed a third time (review → #218 → #219/G18 → this
   ticket), each from an independent instrument, all agreeing.
## G19 — Ticket #223, 11 Sep 2026: the 2025/26 recommendation-level replay cannot be built — no
## historical price record exists anywhere in this database

**Recorded, not solved.** feature-list item 32's remaining, larger piece — replaying what the
solver would have recommended across the whole 2025/26 season, and scoring that replay against the
real mini-league result (`product-brief.md` §2's "Backtest harness simulating 2025/26 against the
actual mini-league result") — is not attempted by this ticket and should not be attempted by a
future one without first reading this entry.

**Why it cannot be built from what this database holds.** A season-length replay is a claim about
what the solver would have picked *under a real transfer budget, every week* — optimising under a
budget constraint is the solver's whole job (`product-brief.md` §6c), and a replay that ignores it
does not measure the solver, it measures a fantasy version of the solver that never has to choose.
No table in this database records what any player cost during 2025/26:

- `player_match_stats` (the only 2025/26-scoped table with per-player rows at all — see G9/G10's
  backtest harness) has no price column. It was never meant to carry one; it is FPL-Core-Insights'
  match-statistics export, not a price history.
- `players.now_cost` holds exactly one number per player — the CURRENT price, overwritten every
  ingest (`scripts/ingest-fpl.ts`) — never a per-gameweek history for any season, past or present.
- No other table stores a price at any point in time for any past gameweek.

A replay built on today's prices instead (the only prices this database has) would be silently
wrong in a specific, well-understood direction: it would let the replayed solver "afford" transfers
that were actually well outside 2025/26's budget (most players' prices only rise over a season) and
would misprice the budget trade-offs that made real transfer decisions hard in the first place. That
is not a smaller, honest approximation the way G9's neutral-fixture or single-averaged-match
approximations are (both stated and bounded, both revisited and improved by later tickets) — it is
a different, unbounded error with no sanity check available to catch it, because there is no
historical price ground truth in this database to check it against either.

**What would unblock it.** A per-gameweek price history for 2025/26 — every player's `now_cost` as
it stood at each gameweek's deadline, not just today's value. This does not exist in
FPL-Core-Insights (verified against its published CSVs for this ticket's own #78/#127 precedent of
checking a source's actual columns rather than assuming — see G3) and would need either a new
external source or a reconstruction from FPL's own historical `element-summary`/`history` endpoints
if those retain season-long price series. Either path is a **new external data source or a new,
substantial ingest** — a Tier 2 decision (`escalation.md`) requiring its own verification ticket,
exactly the shape of work `product-brief.md` §6a/§6b's existing source decisions went through. Nothing
about it is attempted here.

**SUPERSEDED on the "does not exist in FPL-Core-Insights" claim — ticket #248, 17 Sep 2026. The
paragraph above is wrong about the source; it is left in place because the surrounding replay
analysis (budget-constrained solver, below) is still correct and still not attempted.** A
per-gameweek price history DOES exist in FPL-Core-Insights, just not in the file this entry
checked: `data/<season>/playerstats.csv` (a per-gameweek snapshot, distinct from the per-match
`playermatchstats.csv` that #78/#127 checked and found lacking bonus/BPS — the identical
over-generalisation G3's own SUPERSEDED entry names, made here about price instead of bonus)
carries a `now_cost` column, verbatim, for every gameweek of both the 2025-2026 and 2026-2027
seasons — verified directly against the live source on 17 Sep 2026 (29,978 and 2,583 rows
respectively). Ticket #248 adds `public.player_gameweek_history`, populated by
`scripts/ingest-core-insights.ts`, storing this column exactly as sourced (already decimal
million-pounds, NOT the integer-tenths format `public.players.now_cost` carries — see the
migration's own column comment before joining the two). This closes the specific gap named
above — a per-gameweek price at each historical gameweek of a full past season now exists — but
does **not** by itself unblock the season-length recommendation replay this entry is really
about: that still needs the full budget-constrained solver run described below, which #248 is
substrate for and does not attempt. The "new external source / Tier 2 ingest" framing in the
paragraph above no longer applies to the price-history piece specifically; it may still apply to
whatever the replay itself needs beyond price (see the next paragraph).

**What was built instead, and why it is the better use of the same instinct.** Ticket #223 built
`scripts/recommendation-scorecard.ts` — a scorecard that scores the recommendations THIS APP HAS
ACTUALLY ISSUED, this season, against what actually happened, using only `recommendations`,
`recommendation_decisions` and `prediction_log` (all of which already carry a real price-aware
decision — the solver ran under the real budget at the time, whatever it was). It cannot answer "how
would the 2025/26 season have gone" — nothing can, without the missing price history above — but it
answers a related, forward-looking, and arguably more useful question every week from now on: was
each transfer and captaincy call actually good. Ticket #223's own scope text states this plainly:
"the value here is that it compounds… by December it is the most important report in the repo." The
sample is three or four gameweeks today and grows by one every week; the 2025/26 replay's sample
would be one season, once, and frozen the day this repo stops being able to answer "what did that
player cost."

---

## G20 — Ticket #237, 15 Sep 2026: the bonus share is sharpened by an exponent; ALPHA needs
## re-fitting once ten finished gameweeks exist, not two

See G3's own entry (updated by this ticket) for the full first-measurement table and what #237
built in response. This entry records the one thing that is this ticket's own, going forward: a
standing instruction about `ALPHA`'s durability, not a restatement of G3.

**Two gameweeks is thin, and the instrument gains exactly one gameweek per week.**
`gameweek_live_stats` can only ever hold CURRENT-SEASON, finished, past-lockdown gameweeks — see
that table's own migration header, and G3's "the limitation is permanent in the other direction"
paragraph. `ALPHA`'s fit-on-GW2/evaluate-on-GW3 methodology is the most rigorous split two
gameweeks allow (fit and holdout genuinely separate, never the same data scoring itself), but it is
still a fit on one gameweek and a check on one more — a single unusual fixture round (a run of
red cards, an unusually bonus-heavy set of matches) could swing either figure meaningfully, and
nothing in a two-gameweek sample would distinguish "ALPHA is wrong" from "this fortnight was
unusual."

**Standing instruction: `ALPHA` must be RE-FITTED and RE-CHECKED once ten finished gameweeks are on
record — not tuned incrementally as each new gameweek lands, and not left untouched indefinitely
either.** Ten is a judgement call, stated as one (same discipline `teamStrength.ts`'s
`MIN_TEAM_PRIOR_MATCHES` comment uses for its own judgement call): enough gameweeks that one unusual
week's influence on the fit is diluted rather than dominant, small enough that the wait is a matter
of weeks, not a full season. When the re-fit happens, it should use the SAME discipline this
ticket's methodology establishes — a genuine fit/holdout split (e.g. fit on the first n-2
gameweeks, evaluate on the most recent 2, never fit and evaluate on the same rows) — not a pooled
fit across every gameweek at once, which would make every future re-check circular in exactly the
way G3/#237's own text warns against ("Fitting on both and then scoring on both would be
circular").

**What would make this urgent rather than routine.** If a future `scripts/bonus-validation-report.ts`
run (any gameweek, not just a scheduled ten-gameweek checkpoint) shows the top-20 signed error
drifting back toward its pre-#237 magnitude, or the mean per-fixture allocated total drifting toward
or below the falsification gate's 5.70 floor, that is a signal to re-fit immediately rather than
waiting for the ten-gameweek mark — the standing cadence above is a ceiling on how long to wait, not
a floor on how soon a re-fit is allowed.
