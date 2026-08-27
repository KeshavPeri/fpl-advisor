## Context

**Three related defects, all surfaced by ticket #121's Builder, all in the same two files.** They
are grouped because fixing any one alone leaves the feature-history table unusable.

### 1. `team_goals_conceded` does not exist, and the README says it does

`supabase/README.md`'s row for `20260818100000_player_match_stats_competition.sql` claims that
migration *"Adds `competition` (indexed) and `team_goals_conceded` to `player_match_stats`"* and
that `team_goals_conceded` *"is the column clean sheets must be read from"*.

**Verified against the file: that migration adds `competition` and nothing else.** No migration in
the repository has ever added `team_goals_conceded`; `grep -rl team_goals_conceded
supabase/migrations/` returns nothing. `scripts/calibration-report.test.ts` even carries an explicit
assertion that the source does **not** reference it.

**The README has been wrong since 18 August**, and ticket #121 was written from it — which is why
`scripts/build-feature-history.ts` reads a column that is not there and fails loudly on every real
run. That failure is correct behaviour and the reason nothing silently produced wrong totals.

**The column exists in the source.** Verified at ticket-writing time by fetching
`data/2025-2026/By Gameweek/GW1/playermatchstats.csv` from FPL-Core-Insights: the header carries
`team_goals_conceded` alongside `goals_conceded`. We have simply never ingested it.

**Nothing in production is wrong because of this.** The projection model derives clean-sheet
probability from the ClubElo-based expected goals conceded, not from match stats, so no live figure
depends on the missing column. Only the feature history does.

### 2. `feature_history` rows are sparse where they should be dense

#121's Builder emitted a row only for a (player, gameweek) pair where that player had a contributing
Premier League match that gameweek, and flagged the deviation. **A backtest needs to ask "what was
knowable before gameweek 12" for every player who was selectable then** — including one who was
injured or rotated that week and therefore has no match row. With sparse rows, the consumer must
carry forward the last row itself, which is easy to get wrong, easy to forget, and invisible when
wrong.

### 3. Bonus and BPS are not in the source, and that should be written down

Also verified at ticket-writing time from the same CSV header: **there is no `bonus` column and no
`bps` column.** This matters because it permanently rules out validating the bonus-points projection
(#78) against per-match actuals from this source — a question that will otherwise be asked again.
Record it; do not act on it.

Depends on #121 (merged, migration applied 28 Aug). Nothing unmerged.

## Scope

**In scope:**

- **A migration adding `team_goals_conceded` to `public.player_match_stats`**, in
  **`supabase/migrations/20260828090000_player_match_stats_team_goals_conceded.sql`** — filename
  pinned, because two tickets in one batch have collided on a timestamp before.
  - `integer`, nullable, no default. **Nullable and undefaulted on purpose**: a row ingested before
    this column existed genuinely has no value, and that is different from a real zero.
  - A `COMMENT ON COLUMN` stating that this is the team-level figure clean sheets must be read from,
    and that the pre-existing `goals_conceded` is a goalkeeper-only stat (74% populated on
    goalkeeper rows, 1.1% on outfield rows).
  - **No `GRANT` needed** — this is `ADD COLUMN` on an existing table whose grants already cover it,
    matching the #54 migration's own precedent. State that in the file header rather than leaving
    the reader to wonder.
  - Idempotent: `ADD COLUMN IF NOT EXISTS`.
- **`scripts/ingest-core-insights.ts` reads and writes it.** Add `team_goals_conceded` to the CSV
  column list and to the row mapping, using the same `toInt` treatment as `goals_conceded`.
  **No separate backfill script**: the job upserts every row on every run, exactly as `competition`
  was back-stamped in #54, so one ingest run fills the column for the whole season.
- **A counter in `job_runs.details`**: rows written carrying a non-null `team_goals_conceded`. It
  must equal rows written once a full re-ingest has run.
- **`scripts/build-feature-history.ts` emits a dense row set**: one row per (player, gameweek) for
  **every** gameweek from the player's first Premier League match in that season through the last
  gameweek present in the data, whether or not he played that gameweek. A gameweek he missed carries
  the totals unchanged from the gameweek before it.
- **`supabase/README.md` corrected**: the `20260818100000` row's description no longer claims to add
  `team_goals_conceded`, and a row is added for the new migration marked not yet applied.
- **`docs/solver-notes.md` is NOT touched.** The bonus/BPS finding goes in the new migration's file
  header and in the decisions log — see Notes.

**Explicitly out of scope:**

- **No change to the projection model.** Nothing under `src/` at all. Clean-sheet probability
  continues to come from ClubElo, not from this column.
- **No use of `goals_conceded` as a substitute**, anywhere, ever. It is a goalkeeper stat.
- **No ingesting of any other source column.** The CSV carries many we do not use — `shots_on_target`,
  `chances_created`, `big_chances_missed`, `defensive_contributions`, `xgot`, `goals_prevented`,
  `penalties_scored`, `penalties_missed`. **Each is a separate decision**; adding them here would
  hide a data-model change inside a defect fix.
- **No backfill script, no one-off migration data write.** The ingest re-stamps.
- **No change to `feature_history`'s schema.** Dense rows are a change to what the job writes, not
  to the table.
- **No wiring of `build-feature-history.ts` into a workflow.** Still hand-run, per #121.
- **No attempt to source bonus or BPS.** Verified absent; recorded, not solved.

## Definition of done

- [ ] `supabase/migrations/20260828090000_player_match_stats_team_goals_conceded.sql` exists with
      exactly that filename, is idempotent, and adds the column as nullable with no default.
- [ ] `scripts/ingest-core-insights.ts` reads `team_goals_conceded` from the CSV and writes it on
      every row. Grep-checkable: the string appears in both the column list and the row mapping.
- [ ] `goals_conceded` is still ingested and still written, unchanged. Named test. *(The two are
      different measurements and both are wanted.)*
- [ ] A source row with a blank or missing `team_goals_conceded` cell writes `null`, not `0`. Named
      test. **This is the most important test in the ingest half** — a fabricated zero would read as
      a real clean sheet.
- [ ] `job_runs.details` carries the non-null `team_goals_conceded` count.
- [ ] **`build-feature-history.ts` emits a dense row set.** A named test with a player who plays in
      gameweeks 1, 2 and 5 asserts rows exist for gameweeks 1, 2, 3, 4 and 5, and that the gameweek
      3 and 4 rows carry the gameweek 2 totals unchanged.
- [ ] The strictly-before rule still holds in the dense set: the gameweek 5 row contains gameweeks 1
      and 2 only, never gameweek 5's own match. Named test — #121's boundary tests must still pass
      **unmodified**.
- [ ] A player's row count for a season equals the number of gameweeks from his first match to the
      last gameweek in the data, inclusive. Asserted arithmetically in a test.
- [ ] `prior_team_goals_conceded` is populated from the newly ingested column and **never** from
      `goals_conceded`. Grep-checkable: `goals_conceded` appears in `build-feature-history.ts` only
      as part of the string `team_goals_conceded`.
- [ ] `supabase/README.md`'s `20260818100000` row no longer claims that migration adds
      `team_goals_conceded`, and states plainly that the column was added later by this ticket.
- [ ] `supabase/README.md` gains a row for the new migration, marked not yet applied.
- [ ] Nothing under `src/` or `.github/` is added, changed or deleted, and no file under `scripts/`
      other than `ingest-core-insights.ts`, `build-feature-history.ts` and their tests changes.
      Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests run on constructed CSV rows and constructed match
      rows. Nothing proves the live source populates `team_goals_conceded` at the rate expected, or
      that a full re-ingest back-stamps 15,000 rows without incident. The human check after merge, in
      order: apply the migration; run `Scheduled jobs`; confirm the non-null count equals rows
      written; then run `build-feature-history.ts` for `2025-2026` and confirm it now completes.
      **`prior_matches` for any player in gameweek 38 must not exceed 37**, and a spot-checked
      player's final-gameweek totals plus that gameweek's own match must equal his season totals.

## Notes for the Analyst / Builder

**Why the three are one ticket, stated as its *because*.** They are not three unrelated small fixes
bundled for convenience — **because** the feature-history table is unusable until all three land:
the column must exist, it must be populated, and the rows must be dense enough to read. Fixing one
leaves the table exactly as unusable as before. The README correction rides along because it is the
document that caused the defect.

**Verified at ticket-writing time, not recalled.** The source CSV header was fetched from
`raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data/2025-2026/By%20Gameweek/GW1/playermatchstats.csv`
on 28 August 2026. `team_goals_conceded` is present. `bonus` and `bps` are **absent**, and so is any
`team_h_score`/`team_a_score` pair. **Record the bonus/BPS absence in the decisions log**: it
permanently rules out validating #78's bonus projection against per-match actuals from this source,
and it will otherwise be re-investigated.

**Do not add a backfill script.** `scripts/ingest-core-insights.ts` upserts every row of every
gameweek file on every run; that is exactly how `competition` was back-stamped onto existing rows in
#54, with no separate migration data write. Follow that precedent rather than inventing a second
mechanism — and note that the first run after this merges will therefore be doing real work on
15,000+ rows.

**Nullable, not zero-defaulted, and this is the load-bearing choice.** A row ingested before the
column existed has no value; a team that conceded nothing has zero. Collapsing those two states
would make a table that lies about what it has measured — the same argument
`20260821090000_prediction_log.sql`'s own header makes about `actual_points`.

**Dense means dense from a player's first match, not from gameweek 1.** A player signed in January
has no meaningful "prior state" in September, and emitting zero-rows for him from gameweek 1 would
claim he was selectable and blank when he was not in the league. Start at his first match; carry
forward from there.

**The dense change must not disturb the strictly-before rule.** #121's boundary tests are the
guard-rail; if one needs changing, the change has gone too far.

**This is Tier 2** — it changes an ingested data model that other work will build on. Log it as
HIGH-IMPACT with its *because*, including the nullable decision and the bonus/BPS finding.

**Two other tickets may be running in this batch.** One owns `scripts/project-points.ts` and
`scripts/emit-projections-csv.ts`; the other owns `scripts/calibration-report.ts` and
`docs/projection-model-backlog.md`. This ticket touches none of them.

## Scope constraint

Nothing outside the following files changes:

- `supabase/migrations/20260828090000_player_match_stats_team_goals_conceded.sql` (new)
- `scripts/ingest-core-insights.ts`, `scripts/ingest-core-insights.test.ts`
- `scripts/build-feature-history.ts`, `scripts/build-feature-history.test.ts`
- `supabase/README.md`
- `decisions/ticket-<this issue number>.md`

No workflow file is touched. Nothing under `src/` changes. `scripts/project-points.ts`,
`scripts/emit-projections-csv.ts`, `scripts/calibration-report.ts`, `docs/solver-notes.md` and
`docs/projection-model-backlog.md` are not modified.
