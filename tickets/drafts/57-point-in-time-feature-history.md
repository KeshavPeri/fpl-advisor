## Context

**The first slice of feature-list item 29 — the single largest item on the list, and the gate for
five of the seven remaining ones.** Items 30 (OpenFPL retrain), 31 (swap the projection source), 32
(season simulation harness) and 33 (mini-league comparison) all depend on it, directly or through
each other. Nothing else on the feature list is buildable without it.

### What it is, in plain terms

To ask "would this model have recommended well in October?", you need to know **what the model could
have known before October's deadline** — not what we know now. Today's `player_match_stats` holds
every match of a season at once, so any rate computed from it for a past gameweek is contaminated by
matches that had not happened yet. That contamination is called lookahead, and a backtest built on it
reports a model far better than it is.

**This ticket builds the lookahead-free substrate and nothing else:** for each player and each
gameweek of an ingested season, the **cumulative totals of that player's matches strictly before
that gameweek**.

### Why it is deliberately raw totals and not rates

The rate model is a moving target — it has changed three times this month (#78 added CBI and
recoveries, #113 made it two-stage, and another ticket may be adjusting the position prior right
now). **Storing rates would freeze one version of a model into a table that outlives it.** Storing
the raw prior-match totals stores a fact about football that never changes, and any version of the
rate model can be applied to it afterwards.

That also keeps this slice honest about its size: it is a data reconstruction job with an
arithmetic definition of done, not a modelling ticket.

Depends on item 5 (merged, #12) and the current-season ingest (merged, #113). Nothing unmerged.

## Scope

**In scope:**

- **A new table `public.feature_history`**, in migration file
  **`supabase/migrations/20260827090000_feature_history.sql`** — the filename is pinned because two
  tickets in one batch have collided on a migration timestamp before.
  - Primary key `(season, gameweek_id, player_code)`. **`player_code`, never `player_id`** — see
    Notes.
  - Cumulative prior-match totals, all counting **only matches strictly before this gameweek**, and
    only where `competition = 'prem'`: `prior_matches`, `prior_minutes`, `prior_xg`, `prior_xa`,
    `prior_saves`, `prior_clearances`, `prior_blocks`, `prior_interceptions`, `prior_tackles`,
    `prior_recoveries`, `prior_team_goals_conceded`.
  - `computed_at timestamptz`.
  - **RLS enabled with a `SELECT` policy for `anon`, and `GRANT SELECT` to `anon` plus
    `GRANT SELECT, INSERT, UPDATE` to `service_role` — in the same file.** RLS and GRANTs are two
    independent gates and a local-Postgres test is blind to the second (`deltas.md` D8).
  - Idempotent, same guard pattern as every prior migration.
- **A new job `scripts/build-feature-history.ts`** that reads `player_match_stats` for a configured
  season and writes one `feature_history` row per (player, gameweek) with the cumulative totals of
  that player's strictly-earlier matches.
- **The season is a parameter**, read the same way `scripts/ingest-core-insights.ts` reads
  `CORE_INSIGHTS_SEASON`, so the job can be pointed at either season.
- **Counters in `job_runs.details`**: source rows read, rows written, players covered, gameweeks
  covered, and non-Premier-League rows excluded.
- **`supabase/README.md`'s applied-migrations table gains a row** for the new migration, marked not
  yet applied.

**Explicitly out of scope:**

- **No rates, no shrinkage, no projections, no model of any kind.** Raw cumulative totals only.
  Nothing under `src/lib/projection/` is read, imported or modified.
- **No workflow, no schedule, no cron.** This job is run by hand for now. Wiring it into a workflow
  is a later ticket, once its output has been read by a human at least once.
- **No backtest, no simulation, no retrain.** Items 30 and 32.
- **No change to `scripts/ingest-core-insights.ts`, `scripts/project-points.ts` or any other
  existing job.**
- **No deletion or modification of any `player_match_stats` row.** This job reads only.
- **No use of this table by anything.** It will have no consumer until a later ticket — that is
  intended here and is the one place in this repo where a write-with-no-consumer is deliberate,
  because the alternative is a ticket too large to review.

## Definition of done

- [ ] `supabase/migrations/20260827090000_feature_history.sql` exists with exactly that filename, is
      idempotent, and contains both a `CREATE POLICY` and explicit `GRANT` statements.
      Grep-checkable: the strings `GRANT SELECT` and `CREATE POLICY` both appear in it.
- [ ] The primary key is `(season, gameweek_id, player_code)`. Grep-checkable: the string
      `player_id` does not appear in the migration.
- [ ] **The strictly-before rule is exact.** A unit test constructs a player with matches in
      gameweeks 1, 2 and 3 and asserts that the row for gameweek 3 contains the totals of gameweeks
      1 and 2 **only** — not gameweek 3's own match. Both the off-by-one directions are separately
      asserted.
- [ ] The row for a player's first gameweek has `prior_matches = 0` and every total at zero — not
      null, and not absent. Named test. *(Zero prior matches is a real, meaningful measurement; a
      missing row would be indistinguishable from a player who did not exist.)*
- [ ] Non-Premier-League rows are excluded. A named test with a cup match interleaved between two
      league matches asserts the cup match contributes nothing to any total.
- [ ] **The counters reconcile arithmetically**: source rows read = rows contributing to totals +
      non-Premier-League rows excluded, exactly. Asserted in a test.
- [ ] **A second arithmetic reconciliation on real output:** for any player, the totals in his final
      gameweek's row plus that gameweek's own match equal his full-season totals. Asserted in a test
      against a constructed season.
- [ ] The season is read from an environment variable with a documented default, matching
      `ingest-core-insights.ts`'s convention. Grep-checkable.
- [ ] Every Supabase read paginates and asserts its count against an independent count query, per
      `scripts/lib/paginate.ts` — `player_match_stats` holds 15,000+ rows for one season and
      Supabase silently caps a query at 1,000 with no error and no flag.
- [ ] The job issues no `delete` call anywhere. Grep-checkable.
- [ ] `supabase/README.md` carries the new migration row, marked not yet applied.
- [ ] Nothing under `src/`, `.github/` or `docs/` is added, changed or deleted, and no existing file
      under `scripts/` other than the new job is modified. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** every test runs on constructed match rows, so nothing
      proves the job produces sane output against 15,000 real ones. The human check after merge is:
      apply the migration, run the job for `2025-2026`, and read the counters. **`prior_matches` for
      any player in gameweek 38 must not exceed 37, and no player may exceed 38 league matches in a
      season** — the same bound that caught the competition-contamination bug (#54).

## Notes for the Analyst / Builder

**Join and key on `player_code`, never `player_id`.** 453 of 458 players changed FPL element id
between 2025/26 and 2026/27, and team ids moved too (`deltas.md` D9, tickets #22 and #32).
**A table whose whole purpose is to be read across seasons must be keyed on the identifier that
survives one.** This is the single most likely way to get this ticket silently wrong.

**Filter on `competition = 'prem'`.** About 18% of `player_match_stats` rows are cup and European
matches. They score no FPL points, and their xG per 90 is 34% higher than league matches — a bias
landing only on clubs playing in Europe. A backtest built on contaminated totals would measure the
wrong thing, and this is the table it will be built from.

**`goals_conceded` is a goalkeeper stat — use `team_goals_conceded`.** The former is populated on
74% of goalkeeper rows and 1.1% of outfield rows; the latter is 97% populated and yields a realistic
28% clean-sheet rate. Ticket #54 established this and it caught a 95% clean-sheet rate that no test
had questioned.

**"Strictly before" is the entire ticket.** An off-by-one that includes the current gameweek's own
match makes every future backtest look better than the model is, and it would be invisible — the
numbers stay plausible, the reconciliations still balance, and the model just quietly appears to
predict matches it has already seen. **Write the boundary test first.**

**Do not wire this into a workflow yet.** A job with no consumer running nightly is a way to be
surprised later. It runs by hand until somebody has read its output and confirmed it is right.

**This is Tier 2** — it creates a table other work will build on, which is expensive to reverse after
ten more tickets. Log it as HIGH-IMPACT with its *because*, including the raw-totals-not-rates
decision.

**Two other tickets may be running in this batch.** One owns `src/lib/projection/rates.ts`,
`scripts/project-points.ts` and `docs/projection-model-backlog.md`; the other owns
`scripts/build-solver-input.ts` and `docs/solver-notes.md`. This ticket touches none of them — in
particular, **do not import from or modify anything under `src/lib/projection/`**, and do not edit
either docs file.

## Scope constraint

Nothing outside the following files changes:

- `supabase/migrations/20260827090000_feature_history.sql` (new)
- `scripts/build-feature-history.ts` (new), `scripts/build-feature-history.test.ts` (new)
- `supabase/README.md` (the applied-migrations table gains one row, marked not yet applied)
- `decisions/ticket-<this issue number>.md`

No workflow file is touched. Nothing under `src/` or `docs/` changes. No existing file under
`scripts/` is modified — `ingest-core-insights.ts`, `project-points.ts`, `build-solver-input.ts` and
`preflight-check.ts` are all left alone.
