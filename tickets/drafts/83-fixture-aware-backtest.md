## Context

**The backtest cannot see fixtures, and that is the last thing standing between this project and a
real answer about whether the model works.** From the 31 Aug run:

| Ranking | Season Spearman |
|---|---|
| The model | **0.306** |
| "Rank by prior minutes per match" | **0.293** |
| "Rank by prior xG+xA per match" | 0.134 |
| Constant (zero-skill floor) | 0.000 |

**The model beats "whoever plays the most minutes" by 0.013.** For forwards the naive baseline
*wins* (0.393 vs 0.388); midfielders are a tie. **That number is not yet a verdict, because the
instrument is fixture-blind:** `scripts/run-backtest.ts` projects every one of its measured rows with
`LEAGUE_BASELINE_GOALS_PER_TEAM` and a neutral fixture, so `expectedScore` is exactly 0.5 and every
multiplier is exactly 1.0. Fixture difficulty is one of the five inputs `product-brief.md` §6d names,
and the harness has never been able to see it (`docs/projection-model-backlog.md` G9, approximation 2).

**Goalkeeper Spearman of 0.037 is the same artefact, sharper.** A keeper's points are almost entirely
clean sheets, clean-sheet probability is a function of the opponent, and under a neutral fixture every
keeper in the league receives the identical probability. Keeper ranking is structurally near zero
whatever the model does — no goalkeeper work can be judged until this lands.

### The data now exists

Ticket #167 stored the substrate and it is applied and populated:

- `player_match_stats.team_code` — **15,340 of 15,340 rows** for 2025-2026.
- `player_match_stats.opponent_team_code` — **12,613 of 12,754** Premier League rows (98.9%).
- `feature_history.team_code` — 18,588 of 18,588 rows, 565 players, gameweeks 1–38.

**The 141 unresolved Premier League rows are mid-season transfers, and this is a property of the
source, not a defect.** The ingest's own reason counter says *"own team_code not found among the
match_id's two club slugs"*. `players.csv` stores one club per player for a whole season, so a player
who moved in January carries his new club while appearing in matches for his old one.
**Exclude those rows with their own named reason. Do not guess a club for them.**

Depends on #146, #152, #154, #159, #167 — all merged, migration applied. Nothing unmerged.

## Scope

**In scope:**

- **Read `feature_history.team_code`** for the player's own club and **`player_match_stats.opponent_team_code`**
  for the club he faced, per measured (player, gameweek).
- **A point-in-time team strength table**, built from `player_match_stats` rows for gameweeks
  **strictly before** the row being projected, per (season, team_code):
  - **goals conceded** per match — for each (match, team), the maximum `team_goals_conceded` across
    that team's players in that match (a player who lasted the full match saw every goal; the column
    is per-player-on-pitch, not a team total — see the #167 migration's own header).
  - **goals scored** per match — the opponent's conceded figure for that same match.
- **An `expectedScore` per measured row**, derived from those two strengths, replacing the fixed 0.5.
  The shape is specified in the Notes; **its scale constant must be calibrated against the live
  elo-derived distribution, not chosen.**
- **A new exclusion reason** for a row whose own or opponent club cannot be resolved, counted and
  reported in the population section, with the reconciliation still balancing exactly.
- **A fixture-coverage line in the report**: how many measured rows used a real fixture and how many
  fell back to neutral, with the neutral fallback used only where a club is genuinely unresolvable.
- **Every existing headline re-reported unchanged in structure** — MAE, signed error, by position, by
  gameweek, components, defcon buckets, ranking, and the three naive baselines — so the before/after
  is directly comparable.

**Explicitly out of scope:**

- **No change to anything under `src/`.** The model is not touched. This ticket changes what the
  harness *feeds* it, exactly as #154 did.
- **No use of `teams.elo`.** That column holds a current-season rating and 3 of 20 clubs are null;
  using it for 2025-2026 is both a cross-season mismatch and a lookahead into the season being
  predicted.
- **No change to the minutes approximation or the availability assumption.** G9's other two
  approximations stand; this ticket closes one of three.
- **No change to `scripts/ingest-core-insights.ts`, `build-feature-history.ts`, `project-points.ts`
  or any other `scripts/*.ts`.** Two other tickets in this batch own two of those files.
- **No new stored column, no migration, no new Supabase read beyond the two columns above.**
- **No edit to `docs/projection-model-backlog.md`.**
- **No tuning of the model in response to whatever the new numbers show.** Reading them is the next
  conversation.

## Definition of done

- [ ] Team strength is built **only** from gameweeks strictly before the row being projected. A named
      test proves a gameweek-N row sees no gameweek-N or later data — **the lookahead guard, and the
      most important test in the ticket.**
- [ ] Goals conceded per (match, team) is the maximum `team_goals_conceded` across that team's
      players in that match, and goals scored is the opponent's conceded. Named tests for a normal
      match, a match where a player was substituted before a late goal, and a 0-0.
- [ ] `expectedScore` is computed per measured row, is clamped to `[0, 1]`, and is exactly `0.5` when
      two teams have identical prior records. Named test.
- [ ] **The scale constant is calibrated, not chosen.** The decisions file records the observed
      distribution of `expectedScore` in live `player_projections.components` (the elo-derived
      values) and the distribution this ticket's construction produces, and states how the constant
      was set so the two spreads match. **An asserted constant with no comparator is the defect
      `LEARNINGS-second-build-wave.md` §13 records — do not repeat it.**
- [ ] A row with an unresolvable own or opponent club is excluded under its own named reason,
      counted, and reported as a percentage. **Roughly 141 Premier League rows are expected**; a much
      larger number is a finding, not a pass.
- [ ] The population reconciliation still balances exactly: measured + every exclusion = rows read.
- [ ] The report states how many measured rows used a real fixture.
- [ ] Every existing section of the report is still produced, with the same structure and the same
      three naive baselines.
- [ ] Every existing test passes **unmodified** except where one asserts the neutral-fixture
      construction directly.
- [ ] Nothing under `src/`, `supabase/`, `docs/`, `.github/` or any other `scripts/*.ts` is added,
      changed or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests prove the arithmetic and the strictly-before
      guarantee on constructed rows, not that the resulting figures are meaningful. The human check
      after merge is dispatching `Backtest` and reading **whether the model's Spearman now beats
      "prior minutes per match" by more than 0.013, and whether goalkeeper Spearman rises off
      0.037.** **Both outcomes are findings.** A model that still barely beats the naive baseline
      *with* fixtures is a real and important result about this app, not a bug in this ticket.
      **What will also change and must not be mistaken for the fixture effect:** the measured
      population moves regardless, because `feature_history` grew from 18,246 to 18,588 rows when it
      was rebuilt after #167. Report both counts.

## Notes for the Analyst / Builder

**The construction, pre-answered so nobody guesses at 3am.** `src/lib/projection/fixture.ts` defines
`expectedGoalsConceded(baseline, expectedScore) = baseline × 2 × (1 − expectedScore)` and
`attackingMultiplier(expectedScore) = 2 × expectedScore`, with `0.5` meaning an even fixture. So
`expectedScore` is "how much better is my team than this opponent", on `[0, 1]`, centred at `0.5`.
The point-in-time analogue of that, using only prior gameweeks:

```
strength(team)   = (priorGoalsScored − priorGoalsConceded) / priorMatches
expectedScore    = clamp(0.5 + (strength(own) − strength(opponent)) / SCALE, 0, 1)
```

**`SCALE` is the one free parameter and it must be measured.** Set it so the spread of
`expectedScore` this produces matches the spread of the elo-derived `expectedScore` already stored in
`player_projections.components` on live data. Record both distributions. **Do not pick a round
number because it looks reasonable** — that is exactly how #147's 0.3–0.6 band became a fact.

**A team with no prior matches has no strength.** Gameweek 1 has no prior anything, and an early
gameweek has very little. Decide explicitly what happens — falling back to `expectedScore = 0.5` for
a team below some minimum prior-match count is defensible and is what the rest of this harness does
elsewhere — and **state the minimum as a judgement in the code comment**, not as a derived value.

**`team_goals_conceded` is per-player-on-pitch, not a team total.** A defender substituted at 80
minutes before a 90th-minute goal carries `0` while his goalkeeper carries `1`. That is correct for
FPL's clean-sheet rule and wrong for a team-level tally — hence the maximum, not the average and not
the first row found. This is documented in the #167 migration header and is easy to get wrong.

**Do not extend this to season 2026-2027.** Its `opponent_team_code` is null on all 975 rows because
the source publishes a blank `fotmob_name` for every club this season. Another ticket in this batch
addresses that. This ticket measures 2025-2026 and says so.

**This is Tier 2** — it changes the instrument every model judgement is now read from, and reports
before it are not comparable to reports after it. Log it as HIGH-IMPACT with its *because* and say
that plainly.

**Two other tickets are running in this batch.** One owns `scripts/ingest-core-insights.ts`; the
other owns `scripts/project-points.ts`. This ticket touches neither.

## Scope constraint

Nothing outside the following files changes:

- `scripts/run-backtest.ts`, `scripts/run-backtest.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added. Nothing under `src/`, `supabase/`, `docs/`, `.github/`, `scripts/lib/` or
any other `scripts/*.ts` changes. No dependency is added, removed or upgraded. No build configuration
changes.
