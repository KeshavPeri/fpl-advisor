## Problem

Every club's fixture-difficulty rating is four months out of date, and the
model has been running on last season's team strengths for the whole of
2026/27.

`data/2026-2027/teams.csv` in FPL-Core-Insights publishes an **empty `elo`
cell for all twenty clubs** (verified 12 Sept 2026 by fetching the file
directly). Ticket #176 made `scripts/ingest-core-insights.ts` PRESERVE the
existing rating rather than null it when the source cell is blank, and stamp
`teams.elo_stale_since`. That was the right call — it stopped the ratings
being wiped — but the consequence is that every club is still carrying the
value from `data/2025-2026/teams.csv`, unchanged, and the stale mark is
re-applied on every nightly run.

Confirmed against live data (12 Sept 2026):

- `teams.elo` for Arsenal is 2064. `data/2025-2026/teams.csv` gives Arsenal
  2064. Identical. The same holds for every other established club.
- All seventeen established clubs carry a non-null `elo_stale_since`.
- The three promoted clubs (IPS, HUL, COV) sit at the hand-seeded 1650 and
  have never had a real rating at all.
- `api.clubelo.com` returns **502** as of 12 Sept 2026, so there is no
  upstream to re-probe. This is not a transient blip that will self-heal.

### The measured consequence

Gameweek 4, `player_projections.components`, fixture 39 (Man Utd home v Man
City):

| Player | club | `expectedScore` | `attackingMultiplier` |
|---|---|---|---|
| B.Fernandes | MUN | 0.513 | 1.013 |
| Haaland | MCI | 0.487 | 0.987 |

Man City are 1971, Man Utd 1915. The gap is 56; `HOME_ADVANTAGE_ELO` is 65;
so the model makes Man Utd net favourites by 9 points and rates the fixture a
coin flip. Chelsea are 1831 — rated **below** Man Utd — so Palmer's fixture
advantage comes only from the opponent being a promoted club on 1650, never
from Chelsea being strong.

This is the direct cause of two recommendation defects the user reported for
gameweek 4: a transfer out of Palmer's bracket and a captaincy pick of
B.Fernandes away from a Chelsea alternative.

## The fix

This repo already contains a working, tested, calibrated point-in-time
team-strength construction — ticket #175's, in `scripts/run-backtest.ts`. It
is built only from `player_match_stats` rows strictly before the row being
projected, it is pure with no I/O, and its one free parameter `SCALE =
5.6225` was calibrated specifically so its output spread matches the spread
of the live elo-derived `expectedScore`. It is the correct instrument and it
is already here.

Move it into the shared projection library and have the live projection use
it whenever the elo table cannot be trusted.

### Precedence for a fixture's `expectedScore`

Applied in this exact order:

1. Both clubs have a non-null `teams.elo` **and** a null
   `teams.elo_stale_since` — use the elo formula, exactly as today. This
   keeps current behaviour and makes the job self-heal automatically if
   ClubElo ever comes back.
2. Otherwise, if both clubs have at least `MIN_TEAM_PRIOR_MATCHES` resolvable
   current-season prior matches — use `computeFixtureExpectedScore`.
3. Otherwise, if both clubs have a non-null `teams.elo` (stale) — use the elo
   formula. Better than nothing early in a season.
4. Otherwise — the existing FPL-FDR fallback, unchanged.

### Home advantage

`computeFixtureExpectedScore` has no home/away term; the elo formula does.
Add an OPTIONAL fourth parameter `homeAdjustment`, defaulting to `0`.

- `scripts/run-backtest.ts` passes nothing, so its behaviour is
  byte-identical to today. Its legs do not carry a venue and must not start
  guessing one.
- The live path passes `isHome ? HOME_EXPECTED_SCORE_BONUS :
  -HOME_EXPECTED_SCORE_BONUS`, applied to the delta before the existing
  `[0, 1]` clamp.
- `HOME_EXPECTED_SCORE_BONUS = 0.0927`, derived in a code comment as the
  exact expected-score equivalent of `HOME_ADVANTAGE_ELO` at parity:
  `1 / (1 + 10 ** (-65 / 400)) - 0.5`. Not a chosen number. Tier 3.

### `eloFallbackUsed`

Today `eloFallbackUsed` is `teamElo === null || opponentElo === null`, which
is a proxy for "the FDR fallback was used". Under the new precedence those
two stop being the same thing. Redefine it as exactly `fixtureSource ===
'fdr'` so it keeps meaning what its name and its `job_runs.details` counter
have always meant, and add a new `fixtureSource` field to the projection
components with the values `'elo' | 'team-strength' | 'stale-elo' | 'fdr'`.

`scripts/preflight-check.ts` reads `teams` and `fixtures` directly and never
reads `player_projections.components`, so this redefinition does not touch
it. Confirmed by reading the check-6 block.

### Data the job needs

`scripts/project-points.ts` already pages the whole of `player_match_stats`
filtered to `competition = 'prem'`. Add four columns to that SAME select —
`match_id`, `team_code`, `opponent_team_code`, `team_goals_conceded` — and
build the team-match records from the rows it already has. **No additional
Supabase round trip.** Filter the records to `CURRENT_SEASON` before building
the strength table: last season's results must not feed this season's
strength, or the fix reproduces the bug it is fixing.

`team_goals_conceded` is a per-player-on-pitch figure. Take the MAX across a
club's players in a match, never the average or the first row — this is
already documented in `run-backtest.ts`'s header and already implemented
correctly in `buildTeamMatchRecords`. Reuse it; do not re-derive it.

## Falsification gate

The premise is a causal claim about a measured number: that the stale ratings
are what produced the coin-flip fixture. Two figures must move.

Add `scripts/team-strength-diagnostic.ts`, writing a report to
`./out/team-strength-diagnostic.md`, which prints for the next gameweek's
fixtures, side by side: the frozen-elo `expectedScore`, the point-in-time
`expectedScore`, and which source the new precedence selects.

**Stop and report — do not merge — if either of these fails:**

1. For the Man Utd v Man City fixture in gameweek 4, the point-in-time
   `expectedScore` for Man Utd is **still >= 0.5**. That would mean the
   reported defect survives the fix and the diagnosis was wrong.
2. The population standard deviation of the point-in-time `expectedScore`
   across the horizon's fixtures is **lower** than that of the frozen-elo
   `expectedScore` over the same fixtures. A flatter fixture signal is a
   worse one, not a better one, and would mean this construction is not yet
   usable on four gameweeks of data.

Paste the report into the PR body either way.

## Definition of done

- The #175 construction lives in one place only. `scripts/run-backtest.ts`
  imports it; there is no second copy. Its own tests move with it and still
  pass unchanged.
- `npm run build`, `npm run lint`, `npm test` all clean.
- Named tests for the new precedence: fresh elo wins over sufficient history;
  stale elo loses to sufficient history; stale elo beats insufficient
  history; nothing available falls to FDR. Named test that
  `homeAdjustment` defaults to `0` and that the backtest path is unchanged.
- Named test that last season's matches are excluded from the strength table.
- The diagnostic report is committed under `./out/` being gitignored — paste
  it into the PR body, do not commit the file.

## Out of scope

- Changing `ATTACKING_MULTIPLIER_OFFSET` or any damping constant. #184's
  slope may well be an artefact of the broken elo it was measured against,
  but re-measuring it needs this ticket landed first and is its own ticket.
- Deriving or ingesting a replacement elo series from any other provider.
  `deltas.md` D11 forbids substituting another provider's elo because of
  scale mismatch, and that still stands.
- Anything in `scripts/ingest-core-insights.ts`. Its preservation behaviour
  is correct and stays.
- Scheduling the diagnostic. Do not add it to `.github/workflows/`, and do
  not add its job name to `scripts/preflight-check.ts`'s check-8 tracked-job
  list. It is a hand-run diagnostic for this ticket's gate.
- `scripts/preflight-check.ts`. Check 6 is failing to notice the stale
  ratings, and that is a separate ticket in this same batch — do not touch
  the file.

## Files

- `src/lib/projection/teamStrength.ts` (new — the moved #175 construction
  plus `HOME_EXPECTED_SCORE_BONUS`)
- `src/lib/projection/teamStrength.test.ts` (new)
- `src/lib/projection/expectedPoints.ts` (precedence, `fixtureSource`,
  `eloFallbackUsed` redefinition)
- `src/lib/projection/expectedPoints.test.ts`
- `src/lib/projection/index.ts` (re-export)
- `scripts/project-points.ts` (four extra columns on the existing
  `player_match_stats` select; `elo_stale_since` and `code` on the `teams`
  select; build and pass the strength records)
- `scripts/project-points.test.ts`
- `scripts/run-backtest.ts` (delete the moved block, import instead)
- `scripts/run-backtest.test.ts`
- `scripts/team-strength-diagnostic.ts` (new)
- `scripts/team-strength-diagnostic.test.ts` (new)
