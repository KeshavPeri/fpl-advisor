# Ticket #175 — Make the backtest fixture-aware

## HIGH-IMPACT

- **Tier 2 — changes the instrument every model judgement is now read from.** The backtest
  (`scripts/run-backtest.ts`) previously projected every measured row with a neutral fixture
  (`expectedScore` exactly 0.5, every multiplier 1.0), so it could not distinguish a real model
  edge from an artefact of fixture-blindness — most sharply for goalkeepers, whose points are
  almost entirely clean sheets, a function of the opponent, and therefore structurally near-zero
  Spearman (0.037) under a neutral fixture regardless of model quality. A point-in-time
  team-strength construction (goals scored/conceded per prior match, strictly before the row
  being projected — the lookahead guard) now replaces the neutral fixture wherever both teams
  have at least `MIN_TEAM_PRIOR_MATCHES` resolvable prior matches. **Because** the ticket's own
  text states it plainly: reports from before this ticket are not directly comparable to reports
  after it, and both the 0.306-vs-0.293 Spearman edge over "prior minutes per match" and the
  0.037 goalkeeper figure must be re-read once this lands, not assumed unchanged.
- **`SCALE = 5.6225`, calibrated against measured data, not chosen.** The one free parameter in
  `expectedScore = clamp(0.5 + (ownRate - opponentRate) / SCALE, 0, 1)` is set as the ratio of
  two independently measured spreads:
  - **Target** — the live elo-derived `expectedScore` distribution already stored in
    `player_projections.components` (excluding FDR-fallback rows): n=3181, mean=0.5003,
    **population stdDev=0.1701**, min=0.1238, max=0.8762. Supplied directly by Keshav via a
    hand-run Supabase query, because this pipeline has no Supabase read access at all — see the
    process note below.
  - **This construction's own spread** — n=698 (349 resolvable 2025-2026 fixtures × 2 team
    perspectives), mean=0.0000 (exact, by construction), **population stdDev=0.9564** — built by
    fetching all 38 gameweeks of FPL-Core-Insights' public `playermatchstats.csv` plus
    `players.csv`/`teams.csv` directly (no credential needed, per `product-brief.md` §6b) and
    reusing `scripts/ingest-core-insights.ts`'s own unmodified exported pure functions
    (`buildClubCodeBySlug`, `buildTeamCodeMap`, `toMatchStatRow`) to reconstruct the same rows
    actually stored in `player_match_stats`, then running them through this ticket's own
    `buildTeamMatchRecords`/`computeTeamStrengthAsOf`/`teamStrengthRate`.
  - `SCALE = 0.9564 / 0.1701 = 5.6225`. **Because** the reconstruction was sanity-checked against
    three population figures already on record for 2025-2026 (15,340 total `player_match_stats`
    rows, 12,754 Premier League rows, 12,613 of those with `opponent_team_code` resolved —
    98.9%) and landed as an exact match on all three — independently corroborated by QA against
    `tickets/drafts/83-fixture-aware-backtest.md`, a pre-existing record written before this
    round of work — the delta distribution is trusted as faithful to live data rather than a
    divergent reimplementation that happens to look plausible. Both distributions and this
    reconciliation are recorded permanently in the `SCALE` constant's own code comment.
- **Process correction, not a modelling decision, but binding on future tickets:** the DoD's
  original phrasing — "calibrated against... an in-run read" — was a specification error.
  **This pipeline's cloud session has no Supabase credentials or MCP tool and never will**;
  confirmed absent in two independent worktrees and the orchestrator's own session. The
  Builder's first round correctly refused to guess a constant and instead left `SCALE` as an
  explicitly-labelled placeholder with the calibration formula documented — the right call. The
  unblock came from Keshav supplying the target distribution directly, with the construction's
  own side computed from the public CSV source instead of a live DB read. **Any future ticket
  needing a live-data comparator should ask for the number, or for the read to happen outside the
  pipeline, rather than specifying "an in-run read" as if this session could perform one.**

## ROUTINE

- `MIN_TEAM_PRIOR_MATCHES = 3` — a documented judgement call (ticket text: "state the minimum as
  a judgement in the code comment," not derived): high enough to smooth a one-match outlier (one
  red card or own goal swinging a single-match average), low enough that most of the season gets
  a real fixture signal (every team has played its 3rd match by gameweek 4, absent an early
  postponement) rather than sitting at the neutral fallback.
- `NEUTRAL_EXPECTED_SCORE_VALUE = 0.5` deliberately matches `fixture.ts`'s own "0.5 = a coin
  flip / an average fixture" convention — the same value `DIFFICULTY_EXPECTED_SCORE[3]` and an
  even elo matchup both resolve to — rather than inventing a second number for the same idea.
- `eloForExpectedScore`, a closed-form inversion of `fixture.ts`'s own elo logistic, feeds an
  arbitrary point-in-time `expectedScore` through `expectedPoints.ts`'s existing elo-based
  combiner unmodified, since the ticket's scope forbids touching anything under `src/`. Verified
  bit-identical to the pre-#175 neutral path at `expectedScore = 0.5`, and round-tripped against
  `fixture.ts`'s own formula for six other values, both in tests.
- New `unresolvedFixtureTeams` exclusion reason wired through the same reconciliation invariant
  (`measured + every exclusion = rows read`) the file's five pre-existing exclusion reasons
  already use — no new invariant introduced.
- Row-level "used a real fixture" in the new fixture-coverage report section is conservative for
  a multi-fixture row: every one of its fixtures must individually clear
  `MIN_TEAM_PRIOR_MATCHES`, or the whole row counts toward the neutral-fallback bucket.
- One pre-existing test's hard-coded `player_match_stats` select-column regex was updated,
  forced by the ticket's own required scope (reading `team_code`/`opponent_team_code`) changing
  that literal select list — not a scope deviation, the one named exception beyond the DoD's
  "neutral-fixture construction" carve-out.
- The calibration script used to compute the construction's own delta spread
  (`scripts/_calibrate-scale.ts`) was written, run, and deleted — never committed — since the
  ticket's scope constraint permits only `scripts/run-backtest.ts` and
  `scripts/run-backtest.test.ts`. Confirmed absent from both commits and the working tree by QA.
