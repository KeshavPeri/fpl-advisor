# Decisions — ticket #33

## HIGH-IMPACT

- **Flipped `tsconfig.scripts.json`'s `allowImportingTsExtensions` from `false` to `true`** —
  one line, outside this ticket's own enumerated scope list — **because** this is the first
  `scripts/*.ts` job required to import from `src/lib/`. Every prior job (`sync-squad.ts`
  explicitly says so in its own header comment) deliberately duplicates logic instead of
  crossing that boundary, since `scripts/` and `src/` are separate TypeScript projects with
  different module-resolution rules. This ticket's own premise — "the mapping from database
  rows onto the pure modules' input types lives in `scripts/`... This is the first ticket that
  reads Supabase *and* uses the pure modules" — requires `scripts/project-points.ts` to
  actually import `computePlayerRates`, `estimateMinutes`, `positionPriorHitRate`,
  `projectPlayerGameweek`, etc. from `src/lib/projection/`, not reimplement them (the DoD says
  as much explicitly for the defcon functions). `tsc -b` type-checks every transitively-imported
  file under the *importing* project's compiler options, and `src/lib/projection/`'s own
  internal imports use `.ts` extensions (required under `tsconfig.app.json`'s
  `allowImportingTsExtensions: true`) — which fail under `tsconfig.scripts.json`'s stricter
  `nodenext` rules without this flag. The change is purely permissive: every existing
  `scripts/*.ts` file's `.js`-extension imports still resolve identically (verified — `npm run
  build`, `npm run lint` and `npm run test` all still pass clean for the whole repo). Verified by
  grep that no `scripts/*.ts` file imported from `src/` before this ticket, so nothing else was
  silently relying on the old, stricter setting. Flagging this prominently for human review since
  it is a deviation from the ticket's literal file list, even though it was necessary to satisfy
  that same ticket's own DoD ("`npm run build`... must pass clean") and architecture. (Tier 2)

- **The attacking multiplier (from `fixture.ts`) scales expected goals and assists; expected
  goals conceded (also from `fixture.ts`) scales clean-sheet and goals-conceded points** —
  **because** the ticket's own module description says `fixture.ts` produces "the attacking
  multiplier and expected goals conceded derived from [the ClubElo expected result]", but no DoD
  bullet pins down which combiner component consumes the attacking multiplier specifically. The
  natural reading — favourable fixture ⇒ more expected attacking output, tougher fixture ⇒ less
  — is what `attackingMultiplier` is for; `expectedGoalsConceded` is the separate defensive-side
  number. This shapes every non-defensive point in the model, so it's logged here even though the
  individual formula pieces (`expectedScore`, `attackingMultiplier`, `expectedGoalsConceded`)
  were all pre-answered numerically in the ticket. (Tier 3, logged as HIGH-IMPACT because of its
  reach across the model rather than its formal tier)

## ROUTINE

- **Goals-conceded and save-point exposure scale continuously with `expectedMinutes / 90`,
  while clean-sheet points use the discrete `pSixtyPlus` gate the DoD specifies explicitly.**
  Real FPL scoring gates the clean-sheet bonus on reaching 60 minutes but does not gate the
  goals-conceded penalty the same way (it accrues from goals conceded while actually on the
  pitch, proportionally). The DoD's own worked example ("a defender playing the full match")
  is consistent with either reading at full-90 minutes, so this is a judgement call beyond
  the ticket's literal Poisson-math formulas. (Tier 3)
- **`savesPer90` reuses `rates.ts`'s identical shrunk-rate machinery** (same `k = 3`, same
  formula) rather than a separate module or a goals-conceded-derived heuristic ratio, because
  `player_match_stats.saves` already exists as real per-match data — grounding goalkeeper save
  projections in observed history rather than an invented conversion constant, and keeping
  `rates.ts`'s "no rate literal outside `SHRINKAGE_K` and test fixtures" rule intact. (Tier 3)
- **`NEUTRAL_AVAILABILITY = 0.5`** for a status the DoD doesn't enumerate (e.g. `'d'` without a
  published `chance_of_playing_next_round`, or a future status the API adds) with a null chance
  figure — the same "no evidence ⇒ maximum uncertainty, not an assertion" convention
  `defconRate.ts`'s `NEUTRAL_PRIOR` already established in this codebase. (Tier 3)
- **No-history minutes fallback: 45 minutes, a 0.25 rate of reaching 60+** — named
  `NO_HISTORY_BASELINE_MINUTES` / `NO_HISTORY_BASELINE_SIXTY_PLUS_RATE` — a stated "fringe
  squad player" assumption for a promoted-club signing or new arrival, still scaled by
  availability. `pAppears` for this case is availability alone (unaffected by the fallback),
  matching the general rule that `pAppears` always equals availability regardless of history.
  (Tier 3)
- **Elo-null fallback mapping** (`DIFFICULTY_EXPECTED_SCORE` in `fixture.ts`): FPL FDR 1→0.75,
  2→0.625, 3→0.5, 4→0.375, 5→0.25 — anchored so FDR 3 (an average fixture) lands exactly on the
  same 0.5 an even elo matchup gives, spread evenly either side. An out-of-range FDR value (should
  not occur against real data) falls back to the same neutral 0.5 rather than erroring. (Tier 3)
- **`fixtures.team_h_difficulty` / `team_a_difficulty` being null** (should not occur once
  ingested, but defensively handled) defaults to FDR 3 (neutral) in `scripts/project-points.ts`
  before the elo-fallback mapping is applied. (Tier 3)
- **Horizon selection uses an index-slice over the ascending-by-id `gameweeks` list**
  (`gwRows.slice(nextIndex, nextIndex + 5)`) rather than literal `nextId, nextId+1, ..., nextId+4`
  arithmetic — robust to gameweek ids that aren't perfectly contiguous integers, and naturally
  returns fewer than 5 gameweeks near the end of a season instead of erroring. (Tier 3)
- **Upsert batch size of 500 rows per call** in `scripts/project-points.ts`, for the
  ~600-player × up to 5-gameweek payload (up to ~3000 rows/run) — keeps each request well under
  any PostgREST payload-size concern; no prior job in this repo writes enough rows in one run to
  have needed this. (Tier 3)
- **`GOAL_POINTS`/`CLEAN_SHEET_POINTS` in `pointValues.ts` are keyed on bare position-code
  literals (`1`/`2`/`3`/`4`, commented) rather than the imported `GOALKEEPER`/`DEFENDER`/...
  constants** — those constants are typed as the widened `Position` union in
  `src/lib/scoring/types.ts` (not literal types), so using them as computed object keys made
  TypeScript infer an index signature instead of the intended exact `Record<Position, number>`.
  Documented in-file so it doesn't read as an inconsistency. (Tier 3)
- **`job_runs.details` field names**: `playersWithHistoricalMatches` /
  `playersWithNoHistoricalMatches` (the two counts the DoD asks for by name),
  `fixtureEloFallbackCount` (every player-fixture pairing that used the FDR fallback, not a
  distinct-fixture count — a fixture shared by 22 players contributes up to 22 to this number,
  which is the more useful figure for judging how much of a run's output leaned on the
  fallback), `leagueBaselineGoalsSource` (`'computed' | 'fallback'`) plus the resolved
  `leagueBaselineGoals` value itself, `gameweeksProjected` (the actual list of ids projected,
  which may be fewer than 5 near season end), `rowsWritten`. (Tier 3)
- **`player_match_stats` is queried with no `season` filter** — only one season's data exists in
  the table today (per the ticket's own notes), so this is currently equivalent to filtering on
  it. Left unfiltered rather than hardcoding `'2025-2026'` (which would need updating the moment
  a second season's rows appear) or adding new scope (a season-selection concept isn't asked for
  by this ticket). Worth a follow-up ticket once 2026/27 match data starts landing alongside
  2025/26 in the same table. (Tier 3)
- **`player_projections.player_id`/`gameweek_id` carry real foreign keys**, unlike
  `player_match_stats.player_id` (which deliberately has none — see that migration's header).
  The difference: this table projects the *current* season's players against the *current*
  season's gameweeks, both freshly ingested immediately before this job runs, so a real FK
  catches a mapping bug loudly instead of silently writing an orphan row. `player_code` is
  still carried alongside, unenforced, matching the `squad_picks.player_code` precedent, as a
  convenience for a consumer that only has the code. (Tier 3)
