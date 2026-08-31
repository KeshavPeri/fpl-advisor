## Context

**The backtest cannot see fixtures, and that is now the single thing blocking every judgement about
the model.** The 31 Aug run showed why:

| Ranking | Season Spearman |
|---|---|
| The model | **0.306** |
| "Rank by prior minutes per match" | **0.293** |
| "Rank by prior xG+xA per match" | 0.134 |
| Constant (zero-skill floor) | 0.000 |

**The model beats "whoever plays the most minutes" by 0.013.** By position it is worse: forwards
0.388 against the baseline's 0.393 — the naive baseline **wins** — and midfielders are a tie
(0.379 vs 0.377).

**That number is not yet a verdict on the model, because the instrument is fixture-blind.**
`scripts/run-backtest.ts:638` projects every measured row with `LEAGUE_BASELINE_GOALS_PER_TEAM` and
a neutral fixture, so `expectedScore` is exactly 0.5 and every multiplier is exactly 1.0 for all
10,474 rows. Fixture difficulty is one of the five inputs `product-brief.md` §6d names, and the
harness cannot see it. `docs/projection-model-backlog.md` G9 lists this as the second of three
documented approximations.

**Goalkeeper Spearman of 0.037 is the same artefact, sharper.** A keeper's points are almost entirely
clean sheets, clean-sheet probability is a function of the opponent, and under a neutral fixture every
keeper in the league gets the identical probability. **Keeper ranking is structurally near zero
whatever the model does.** No goalkeeper ticket can be judged until this is fixed.

### Why this ticket builds data rather than the measurement

Making the backtest fixture-aware needs, per measured row, **which team the player was on and which
team he faced.** Neither exists today:

- `player_match_stats` has **no team column at all**. Its `match_id` is the source's own slug
  (e.g. `25-26-prem-brighton-hove-albion-vs-fulham`) — it names both clubs but says nothing about
  which one the player belongs to.
- `feature_history` has no team column either.
- Joining to the live `players` table for a past season's team is the exact defect ticket #154 just
  removed for position, and #146's migration header forbids it: **453 of 458 element ids and 15 of
  20 team ids change across a season boundary; `code` is the stable key** (`deltas.md` D9).

FPL-Core-Insights' own per-season `players.csv` carries `team_code`, and `scripts/ingest-core-insights.ts`
already reads that file — it is where `element_type` comes from (#146). **The team identity is one
column away, from a file the job already opens.**

**This ticket stores it. A follow-up consumes it.** That split is deliberate and is the rule
`LEARNINGS-second-build-wave.md` §15 exists to enforce: a ticket that builds a substrate must state
what will not change and name the follow-up. **Nothing about the backtest's numbers will move when
this merges.**

Depends on #146, #152, #154 — all merged. Nothing unmerged.

## Scope

**In scope:**

- **A migration adding a stable team identifier to `player_match_stats`** — `team_code`, matching
  the `code`-not-id rule every other cross-season key in this repo follows — and the equivalent
  column on `feature_history`, plus an **opponent** identifier on `player_match_stats` derived from
  the match slug.
- **`scripts/ingest-core-insights.ts` populates them**, reading `team_code` from that season's own
  `players.csv` exactly as it already reads `element_type`, and resolving the opponent from
  `match_id`'s two club slugs given the player's own club.
- **`scripts/build-feature-history.ts` copies the team identifier through**, the same way it copies
  `element_type` today.
- **Counters in `job_runs.details`** for both jobs: rows written with a resolved team, rows written
  with a resolved opponent, and rows where either could not be resolved, **with the reason.**
- **The `supabase/README.md` applied-migrations table is updated** in the same PR.
- **A GRANT in the same migration file** if any new object needs one — RLS and GRANTs are two
  independent gates (`deltas.md` D8).

**Explicitly out of scope:**

- **No change to `scripts/run-backtest.ts`.** It is the consumer and it is a separate ticket. **The
  backtest's MAE, signed errors, Spearman and baselines will be byte-identical after this merges.**
- **No change to anything under `src/`.** No projection, no scoring, no UI.
- **No change to `scripts/project-points.ts`, `calibration-report.ts`, or any solver-path file.**
- **No back-computation of historical team strength, no elo reconstruction, no expected-score
  derivation.** This ticket stores identity only. Turning identity into fixture difficulty is the
  follow-up's entire job.
- **No use of `teams.elo`.** That column holds a current rating; using it for a past season is the
  cross-season mismatch this ticket exists to avoid.
- **No re-run of any job as part of the ticket.** Applying the migration and re-ingesting are
  Keshav's post-merge steps.

## Definition of done

- [ ] A single migration file adds the new columns, is idempotent, and issues any GRANT it needs in
      the same file.
- [ ] `ingest-core-insights.ts` populates team and opponent on every row it writes, for either
      configured season, resolving team from that season's own `players.csv` and **never** from the
      live `players` table. Grep-checkable: the live table is not read for this purpose.
- [ ] **Opponent resolution is exact, not inferred.** Given a `match_id` slug and the player's club,
      the opponent is the other club named in that slug. A slug that does not resolve to exactly two
      known clubs is **counted and reported, never guessed.** Named test covering a normal slug, a
      hyphenated club name (`brighton-hove-albion`), and an unresolvable slug.
- [ ] `build-feature-history.ts` carries the team identifier through to `feature_history`.
- [ ] Both jobs report the new counters in `job_runs.details`, and the counts reconcile
      arithmetically against rows written.
- [ ] `supabase/README.md`'s applied table has a row for the new migration, marked not-yet-applied
      until Keshav applies it.
- [ ] Every existing test passes **unmodified**.
- [ ] Nothing under `src/`, `.github/`, `docs/` or any other `scripts/*.ts` is added, changed or
      deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests prove slug parsing on constructed rows, not that
      the live data resolves. The human check after merge is: apply the migration, re-run
      `Scheduled jobs`, re-run `build-feature-history.ts` by hand, then confirm from `job_runs`
      that **team and opponent are resolved on ~100% of rows for 2025-2026** and that the
      unresolvable count is zero or explained. **What will NOT change, and must not be read as a
      failure: the backtest's numbers.** The Spearman stays 0.306, the baselines stay where they
      are, the goalkeeper figure stays 0.037. **This ticket builds the substrate; the follow-up
      ticket makes the backtest fixture-aware and only then do those numbers move.**

## Notes for the Analyst / Builder

**`code`, never `id`.** 15 of 20 team ids referred to a different club across the 2025/26 → 2026/27
boundary; `teams.code` was stable for all 17 clubs present in both seasons (`deltas.md` D9). This is
the fourth time this repo has had to learn that lesson — do not add a fourth instance of it.

**The slug is the only opponent source and it is text.** `scripts/lib/competition.ts` already parses
this same slug for the competition token and establishes the discipline: **fail loudly on an
unknown shape rather than defaulting.** Follow it exactly. Club slugs contain hyphens, so splitting
on `-vs-` is right and splitting on `-` is not.

**A column with no consumer is the dangerous one** (`deltas.md` D9). This one gets a consumer in the
very next batch — say so in the decisions file, and name it.

**This is Tier 2** — a stored identifier that every future fixture-aware measurement will depend on.
Log it as HIGH-IMPACT with its *because*. The migration itself is Keshav's to apply; no agent
touches live data.

**Two other tickets are running in this batch.** One owns `src/lib/projection/`; the other owns
`src/screens/` and `src/components/`. This ticket touches neither, and `scripts/run-backtest.ts` is
deliberately untouched by all three.

## Scope constraint

Nothing outside the following files changes:

- One new file under `supabase/migrations/`
- `supabase/README.md`
- `scripts/ingest-core-insights.ts`, `scripts/ingest-core-insights.test.ts`
- `scripts/build-feature-history.ts`, `scripts/build-feature-history.test.ts`
- `scripts/lib/competition.ts` and its test, **only** if opponent parsing genuinely belongs beside the
  existing slug parser — if so, additively, with no change to `parseCompetition`'s signature
- `decisions/ticket-<this issue number>.md`

Nothing under `src/`, `docs/`, `.github/` or any other `scripts/*.ts` changes —
`scripts/run-backtest.ts` in particular is untouched. No dependency is added, removed or upgraded.
No build configuration changes.
