## Context

Feature-list item 4. Depends on the Supabase reference schema (#9) and the scheduled Action
scaffold (#10), and on Keshav having applied both migrations in the Supabase dashboard.

This is the first job that puts real data in the database. Everything downstream — the projection
model, the solver CSV, the recommendation, the Telegram message — reads from the tables this job
fills. `product-brief.md` §6a names the official FPL API as the authoritative source for prices,
availability, fixtures and defensive-contribution totals, and records that it needs no credential.

## Scope

**In scope:**

- `scripts/ingest-fpl.ts`: fetch `https://fantasy.premierleague.com/api/bootstrap-static/` and
  `https://fantasy.premierleague.com/api/fixtures/`, and upsert into `teams`, `players`, `gameweeks`
  and `fixtures`.
- Upsert keyed on the FPL id. Rows that vanish from the API are left in place, not deleted.
- A `job_runs` row per execution recording status and per-table row counts in `details`.
- Retry with backoff on network errors and 5xx. On final failure: exit non-zero, write a failed
  `job_runs` row, and name the endpoint and status code in the message.
- On an unexpected response shape — a missing top-level key, an empty `elements` array — fail
  loudly rather than writing partial or empty data over good data.
- A step added to the existing `.github/workflows/scheduled-jobs.yml`, after the heartbeat step.

**Explicitly out of scope:**

- **No authenticated endpoint, ever.** `my-team/` is not used, not referenced, and not "supported
  later". No login flow, no cookie, no session, no stored FPL credential. Any such proposal is a
  Tier 1 stop — this is the single reason the app needs no credentials at all
  (`product-brief.md` §6a).
- No `entry/{id}/`, no `picks/`, no squad data. That is #14.
- No `element-summary/{id}/` per-player match history.
- No mini-league standings.
- No new stored personal data. This job stores footballers and fixtures, nothing about Keshav.
- No deletion of any existing row.
- No projection, scoring or modelling logic.
- No `src/` changes, no UI.

## Definition of done

- [ ] `npm run build` passes clean.
- [ ] `npm run lint` passes clean.
- [ ] `npx tsx scripts/ingest-fpl.ts` against a local Postgres with the #9 and #10
      migrations applied populates `teams`, `players`, `gameweeks` and `fixtures`, each with a
      non-zero row count, and prints those counts.
- [ ] Running it again immediately leaves every table's row count unchanged — it upserts, it does
      not duplicate.
- [ ] After a successful run, the `gameweeks` row with id 1 has `deadline_time` equal to
      `2026-08-21T17:30:00Z`. *(Verified live from the API on 11 Aug 2026 — this is a fixed value
      the reviewer can check, not a judgement.)*
- [ ] After a successful run, `teams` contains 20 rows.
- [ ] A `job_runs` row is written on success with per-table counts in `details`.
- [ ] Pointing the base URL at an unreachable host makes the script exit non-zero, write a `job_runs`
      row with a failed status, and print the endpoint and the failure reason. No table is left
      half-written.
- [ ] The only remote host referenced anywhere in the script is `fantasy.premierleague.com`.
- [ ] The strings `my-team`, `Cookie`, `pl_profile`, `Authorization` and `login` appear nowhere in
      `scripts/`.
- [ ] The workflow's ingest step runs after the heartbeat step, and the workflow file still parses
      as valid YAML.
- [ ] Scope constraint: the only files added or changed are under `scripts/`, plus
      `.github/workflows/scheduled-jobs.yml` and — only if genuinely shared with the app — new type
      files under `src/lib/`. No component, no CSS, no migration changes.

## Notes for the Analyst / Builder

**Verified live 11 Aug 2026, unauthenticated, no key, no headers:**

- `https://fantasy.premierleague.com/api/bootstrap-static/` returns JSON with top-level keys
  `chips`, `events`, `game_settings`, `game_config`, `phases`, `teams`, `total_players`,
  `element_stats`, `element_types`, `elements`.
- `events[0]` is `{"id": 1, "name": "Gameweek 1", "deadline_time": "2026-08-21T17:30:00Z"}` — which
  is 01:30 Singapore time on Saturday 22 August 2026, the GW1 target in `product-brief.md` §2.
- `elements[]` carries `defensive_contribution`, `expected_goals`, `status` and
  `chance_of_playing_next_round`. The first element currently has `defensive_contribution: 0` and
  `status: "a"` — the season has not started, so zeroes are correct, not a bug.

Pre-answers:

- **Carry the availability fields through.** `status`, `chance_of_playing_next_round` and `news` are
  what later produce the injury and suspension rings on the pitch view (`design-reference.md`), and
  re-ingesting them later is a wasted night.
- **Prices stay integers.** `now_cost: 85` means £8.5m. Store what the API returns; format at the
  edge per `product-brief.md` §8. Do not convert to a float on the way in.
- **All in-game money here is Tier 3.** Prices, bank, squad value and the −4 hit cost have no
  connection to any real payment method (`product-brief.md` §4). Do not escalate anything about them.
- **The API is undocumented and changes without notice.** An unexpected shape is a failure to
  report, not a shape to guess at. `product-brief.md` §6a is explicit: the app must never present
  stale data as current, and no data beats wrong data.
- `fantasy.premierleague.com` is on the run environment's network allowlist, so you can call it live
  from your session to confirm shapes before writing the upsert.
- If you need a CSV or schema-validation library, that is a **Tier 2** choice — proceed, but log it
  with the because. Node 22 has `fetch` built in; do not add an HTTP client.
