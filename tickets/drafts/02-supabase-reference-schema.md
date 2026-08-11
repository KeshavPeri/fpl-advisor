## Context

Feature-list item 2. The Supabase project is connected but has **no tables at all** — `src/App.tsx`'s
connectivity check works precisely by querying a table that does not exist. This ticket creates the
reference schema that every ingest job and every projection later reads from: teams, players,
fixtures, gameweeks. No dependencies.

It produces migration **files**. Applying them to the live Supabase project is an owner action, not
an agent action.

## Scope

**In scope:**

- A SQL migration under `supabase/migrations/`, timestamp-prefixed, creating four reference tables:
  `teams`, `players`, `fixtures`, `gameweeks`.
- Columns shaped to what the FPL API actually returns from `bootstrap-static/` (`teams`, `elements`,
  `events`) and `fixtures/`. FPL integer ids as primary keys.
- Row Level Security enabled on all four tables, with exactly one policy each granting `select` to
  the anon role. No insert/update/delete policy — writes come from the Action using the secret key,
  which bypasses RLS.
- Sensible indexes on the columns later jobs will filter by (fixture kickoff, gameweek id, player
  team).
- `supabase/README.md` giving Keshav the literal steps to apply the migration in the Supabase
  dashboard SQL editor, and how to tell it worked.

**Explicitly out of scope:**

- **Does not apply anything to the live Supabase project.** Running migrations against live data is
  owner-only (Tier 1 — destructive operations on live data). The Builder writes the file; Keshav
  runs it.
- **Does not add any new personal-data category.** These are reference tables about footballers and
  fixtures. Keshav's squad, entry id and overrides are #13 and #14, and are already pre-approved
  by `product-brief.md` §5.
- No squad, picks, overrides or decision-ledger tables.
- No ingest logic, no fetching, no scripts — #11 fills these tables.
- No generated TypeScript types, no client-side queries, no `src/` changes.
- No destructive SQL: no `drop`, no `truncate`, no `delete`, no `alter ... drop column`.

## Definition of done

- [ ] `npm run build` passes clean.
- [ ] `npm run lint` passes clean.
- [ ] The migration applies against an empty local PostgreSQL database with exit code 0
      (`psql -v ON_ERROR_STOP=1 -f supabase/migrations/<the file this ticket adds>`, exit code 0).
- [ ] Applying it a **second time** against the same database also exits 0 and creates nothing new —
      every statement is guarded (`create table if not exists`, `create index if not exists`,
      `drop policy if exists` / `create policy`).
- [ ] After apply, `\dt` lists `teams`, `players`, `fixtures`, `gameweeks`.
- [ ] `gameweeks` has a `deadline_time timestamptz` column and `fixtures` has a
      `kickoff_time timestamptz` column.
- [ ] Every timestamp column in the migration is `timestamptz`. The bare token `timestamp` without
      time zone appears nowhere in the file.
- [ ] Each of the four tables has `row level security` enabled and exactly one policy, and that
      policy is `for select`.
- [ ] The migration file contains none of: `drop table`, `truncate`, `delete from`.
- [ ] `players` carries at minimum: FPL element id (PK), web name, team id, element type, current
      price, `status`, `chance_of_playing_next_round`, `defensive_contribution`, `expected_goals`,
      `expected_assists`.
- [ ] `supabase/README.md` exists and states, in order, the exact clicks and the exact success
      signal for applying a migration in the Supabase dashboard.
- [ ] Scope constraint: the only files added or changed are under `supabase/`. Nothing under `src/`,
      `.github/` or `public/` changes, and `package.json` is untouched.

## Notes for the Analyst / Builder

- The apply and idempotency items are runnable, not judgement calls. State in the handback the exact
  `psql` invocation used and the exit code of both runs.
- **PostgreSQL is available on the cloud VM** used by the overnight run (`App Factory` environment —
  the image ships git, jq, ripgrep, Node 22, Python, Docker and Postgres). Use it to satisfy the
  apply and idempotency items. If Postgres genuinely is not available in your session, report that
  as a blocker — do not mark those items verified from reading the SQL.
- **Column shapes, verified live 11 Aug 2026.** `https://fantasy.premierleague.com/api/bootstrap-static/`
  returns JSON with no authentication. Top-level keys: `chips`, `events`, `game_settings`,
  `game_config`, `phases`, `teams`, `total_players`, `element_stats`, `element_types`, `elements`.
  `events[0]` is `{"id": 1, "name": "Gameweek 1", "deadline_time": "2026-08-21T17:30:00Z"}`.
  `elements[]` carries `defensive_contribution`, `expected_goals`, `status` and
  `chance_of_playing_next_round`. `fantasy.premierleague.com` is on the run environment's network
  allowlist, so you can fetch it to confirm shapes before writing the DDL.
- **Use FPL ids as primary keys** — `players.id` is the FPL element id, `teams.id` is the FPL team
  id, `gameweeks.id` is the FPL event id. This is a **Tier 2** data-structure decision, already made
  here: every downstream source (the FPL API, FPL-Core-Insights, the solver's CSV) keys on FPL
  element ids, and introducing surrogate keys would mean a join on every ingest. Log it with the
  because; do not escalate it.
- **Store every time as UTC `timestamptz`.** Conversion to Asia/Singapore is a display concern
  (`product-brief.md` §8), not a storage one. Storing local time is expensive to reverse.
- Prices: FPL returns tenths of a million as an integer (`now_cost: 85` means £8.5m). Store the
  integer as returned and format at the edge. Do not store a float.
- The next ticket (#10) writes a heartbeat row from a GitHub Action, and the one after that
  (#11) fills these tables. **Both depend on Keshav having applied this migration by hand
  first.** Say so plainly in the handback so it reaches the morning review.
