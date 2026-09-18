# Ticket #248 — Ingest per-gameweek price, bonus and BPS history

## HIGH-IMPACT

- **Tier 2 — `now_cost` is stored verbatim as decimal millions (e.g. `5.8`), not integer tenths
  as the ticket's own text specified.** **Because** live verification — fetching both season
  `playerstats.csv` files directly and cross-checking against a live `bootstrap-static/` fetch
  the same day — showed `playerstats.csv`'s `now_cost` is already decimal-millions, unlike
  `players.now_cost`/`bootstrap-static`'s integer-tenths format. Writing the ticket's literal
  "integer tenths, verbatim" column comment would have baked a false claim into the schema, so
  the comment states the verified true unit instead. Accepted by Keshav as-is (18 Sep 2026): "My
  ticket asserted the wrong unit. Your verified comment is correct — keep it."
- **Tier 2 — `bonus`, `bps`, `starts` are season-cumulative-to-date snapshots, not single-gameweek
  deltas.** **Because** tracing one player's rows across consecutive gameweeks showed monotonic
  (non-resetting) values, not per-gameweek resets. Keshav confirmed this was also wrong in his
  own ticket text and asked that the column comments state it "unmissably, since any future
  reader will assume per-gameweek" — the revision round rewrote all three `COMMENT ON COLUMN`
  statements and the matching `scripts/ingest-core-insights.ts` comment to lead with
  "NOT A PER-GAMEWEEK DELTA" in capitals before explaining the cumulative semantics, and to spell
  out that a consumer wanting a single gameweek's value must difference consecutive rows for the
  same `player_code`.
- **Tier 2 — G19 in `docs/projection-model-backlog.md` corrected, scope widened by the ticket
  owner.** The original ticket scoped only the G3 correction; G19's claim that price history
  "does not exist in FPL-Core-Insights" is also disproved by this ticket's own work (the
  `player_gameweek_history` table, sourced from `playerstats.csv`'s `now_cost` column). Keshav
  explicitly widened scope by exactly this one entry post-review: "fix G19 ... Leave the
  historical reasoning, mark it superseded, name this ticket." Corrected in the same style as
  the G3 correction — original text left in place, marked superseded, ticket #248 named as what
  disproves it.

## ROUTINE

- Migration filed as `20260917100000` rather than the `*090000` convention, to avoid a
  date-prefix collision with the concurrently-landed `fixture_odds` migration (#238) — same
  precedent `supabase/README.md` already documents for an earlier collision.
- Three named, non-guessed skip reasons for unresolved `playerstats.csv` rows:
  `invalid_or_missing_id`, `player_code_not_found`, `invalid_numeric_field` (last one defensive,
  never observed in real data) — following this file's existing "named reason, never guessed"
  convention.
- Non-200/404 on `playerstats.csv` fails the run loudly, matching `teams.csv`'s treatment rather
  than `players.csv`'s "season not yet published" tolerance (reserved for detecting whether a
  season exists at all).

## Process note

Keshav corrected the ticket's own Definition of Done (18 Sep 2026): a live-data hand-run against
Supabase is an owner step after merge and must never block the PR, since this pipeline has no
Supabase access from any cloud session, ever (per `decisions/ticket-175.md`). He will apply
`supabase/migrations/20260917100000_player_gameweek_history.sql` and hand-run the ingest for both
seasons himself after merge.
