## Context

Follow-up to #12, which merged on 11 Aug 2026. It is a prerequisite for feature-list item 9
(defensive-contribution hit rates) and item 10 (the baseline projection model) — both join
per-match history to the current `players` table, and today that join cannot work.

`player_match_stats` stores `player_id` and no stable key. QA on #12 verified on real data that
**FPL element ids are not stable across a season boundary**: of 458 players matched between the
2025/26 and 2026/27 snapshots, only 5 kept the same id and 453 changed. #12 correctly dropped the
foreign key on that evidence, but did not add the stable key in its place, so every historical row
it ingested is currently unjoinable to the current squad.

The mapping is already in hand at ingest time and being discarded: `scripts/ingest-core-insights.ts`
fetches the season's `players.csv`, which carries **both** `player_code` and `player_id`, and
already validates that both columns are present.

## Scope

**In scope:**

- A migration adding a nullable `player_code integer` column to `public.player_match_stats`, with
  an index on it, in the same idempotent style as the existing migrations.
- `scripts/ingest-core-insights.ts` populates `player_code` on every row it writes, by building a
  `player_id -> player_code` map from the same season's `players.csv` it already fetches.
- Rows whose `player_id` has no entry in that season's `players.csv` are still written, with
  `player_code` left null, and the count of such rows reported in the job's `job_runs` row.
- Re-running the ingest against `2025-2026` backfills the existing rows, since the job already
  upserts on (`player_id`, `match_id`).
- A short note in `decisions/ticket-<this number>.md` recording that `code` is the cross-season
  join key and `id` is not.

**Explicitly out of scope:**

- **No foreign key** from `player_match_stats.player_code` to `players.code`. The same reasoning
  #12 used still applies: the reference tables are refreshed per season and a hard constraint
  would reject historical rows. `player_code` is stored as a join key, not as a constraint.
- No change to the primary key or to the (`player_id`, `match_id`) upsert key — `player_id`
  remains the natural key *within* a season and is what makes the upsert idempotent.
- No modelling, no hit-rate computation, no projection — those are items 9 and 10.
- No change to `scripts/ingest-fpl.ts` or to the reference schema. `players.code` already exists.
- No `src/` changes, no UI.
- No deletion of existing rows.
- No new stored personal data.

## Definition of done

- [ ] `npm run build` passes clean.
- [ ] `npm run lint` passes clean.
- [ ] `npm run test` passes clean.
- [ ] The new migration applies twice against an empty local Postgres, both runs exit 0, the second
      creating nothing new.
- [ ] The migration **GRANTs** on any object it creates, per `deltas.md` D8 — if it only adds a
      column to an existing table, state in the handback that no new grant was required and why.
- [ ] After running the ingest against `2025-2026`, **more than 95% of `player_match_stats` rows
      have a non-null `player_code`.** Report the actual percentage.
- [ ] Spot-check: pick any five rows at random and confirm their `player_code` matches what that
      season's `players.csv` gives for the same `player_id`.
- [ ] Rows whose `player_id` is absent from `players.csv` are written with a null `player_code`,
      not skipped, and the count appears in the `job_runs` row for that execution.
- [ ] Re-running the ingest immediately leaves the row count unchanged and does not null out any
      `player_code` already set.
- [ ] `SELECT count(*) FROM player_match_stats pms JOIN players p ON p.code = pms.player_code`
      returns a non-zero count against the live-shaped schema — this is the join items 9 and 10
      depend on, and it is the whole point of the ticket.
- [ ] Scope constraint: only `supabase/migrations/`, `scripts/ingest-core-insights.ts` and
      `decisions/` change.

## Notes for the Analyst / Builder

- **`code` is stable across seasons, `id` is not.** This is now verified on real data, not assumed.
  Anywhere in this codebase that persists a player reference intended to outlive a season should
  carry `code`. `players.code` already exists from #9.
- Keep `player_id` exactly as it is. It is the correct key *within* a season and the upsert depends
  on it. This ticket adds a second column; it does not re-key the table.
- The `players.csv` for a season is the authoritative `id -> code` mapping **for that season**. Do
  not try to derive the mapping from `bootstrap-static/`, which only knows the current season.
- The percentage threshold in the DoD is deliberately 95% rather than 100%: the source's per-match
  files and its season roster file are generated separately and a small number of unmatched rows is
  expected, not a defect. Report the real number so the gap is visible rather than assumed away.
- Adding the column is a **Tier 2** data-structure decision, pre-approved here with the because
  above. Log it; do not escalate.
