# Ticket #12 — FPL-Core-Insights ingest job

## HIGH-IMPACT

- **No foreign key from `player_match_stats.player_id` to `players.id`, because
  verified live data shows FPL element ids are not stable across season
  boundaries.** Cross-referencing FPL-Core-Insights' `player_code` field
  against the live FPL `bootstrap-static` matched 458 players by name/code
  (99.1% match rate), but of those 458, only 5 kept the same `player_id`
  between the 2025-2026 Core-Insights snapshot and the current (2026-2027
  preseason) `bootstrap-static` — 453 changed. A hard FK would have rejected
  nearly all historical rows the moment a new season's `players` table was
  ingested. The alignment the ticket assumed holds only *within* one season,
  not across the season boundary this app is about to cross for real (GW1 is
  10 days away). This is a data-structuring decision — expensive to reverse
  once item 9's defcon modelling is built on top of it — so downstream
  consumers must join `player_match_stats` to `players` by `player_code`/name,
  not by raw id, once cross-season joins are needed. See the migration file's
  header comment for the full method and numbers.

## ROUTINE

- **`csv-parse` added as a dependency**, because the source's data does not
  currently contain quoted commas, but a hand-rolled splitter would silently
  corrupt data the day it does. The ticket itself flagged this as a Tier 2,
  proceed-and-log choice.
- **`upsertTeams` writes full team rows (id, name, short_name, strengths,
  pulse_id, elo), not an elo-only patch**, because this ticket's own DoD check
  (`teams.elo` populated for all 20 teams after a standalone 2025-2026 run)
  must pass without depending on ticket #11 — built concurrently, not
  guaranteed to run first — having already inserted team rows. An elo-only
  upsert's INSERT branch would violate `teams.name`/`short_name` NOT NULL
  constraints for a team that doesn't exist yet. Every field written has a
  same-named source in `teams.csv`.
- **Gameweeks are walked sequentially 1..38, stopping at the first 404**
  (treated as "not published yet, normal"), while a 200 with zero data rows is
  treated as "not played yet" and the walk continues. This distinction is what
  lets the job run correctly against a season whose fixtures haven't started.

## Flagged for QA / human attention (not a decision, a factual note)

**The ticket's premise that `data/2026-2027/` "does not exist yet" was true
when the ticket was written (11 Aug 2026) but is false as of this Builder run**
— `players.csv`, `teams.csv`, and `GW1`–`GW38` `playermatchstats.csv` under
`2026-2027` now all return HTTP 200 with header rows only (zero match data,
`teams.elo` empty). The DoD's literal "run against 2026-2027, script exits
zero, writes no rows, job_runs says season directory not found" can no longer
be demonstrated against that literal season string, because the directory now
exists (empty). The equivalent code path — a season whose directory genuinely
404s — was verified instead against `2027-2028`. QA should decide whether to
re-verify DoD wording against whatever season is genuinely unpublished at
review time, and Keshav should know the ground truth moved under this ticket.
