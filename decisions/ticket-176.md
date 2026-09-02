# Ticket #176 — Stop nulling known ClubElo ratings, and resolve opponents for the current season

## HIGH-IMPACT

- **Tier 2 — changes what `teams.elo` means and therefore every fixture adjustment the live
  model makes.** `scripts/ingest-core-insights.ts` no longer nulls `teams.elo` when a club is
  absent from the season file or has a blank/malformed elo cell; it preserves the existing
  rating instead, and records the transition into a new nullable `teams.elo_stale_since
  timestamptz` column so "current" and "stale" are distinguishable rather than looking
  identical. **Because** `data/2026-2027/teams.csv` publishes `elo` and `fotmob_name` blank for
  all 20 clubs (verified live at build time, twice), ticket #63's null-on-mismatch rule — right
  in principle, for a club that genuinely leaves the competition — was firing on every run for
  the three promoted clubs, flapping preflight check 6 between 0/20 and 3/20 unrated and pushing
  15 of 50 fixtures in the live five-gameweek horizon onto the coarser FDR fallback
  (`docs/projection-model-backlog.md` G8). A stale rating is strictly better than that fallback.
- **The genuine-removal case #63 was written for and the source-gap case this ticket fixes are
  not distinguished at runtime — the fix always preserves, deliberately.** **Because** row
  identity in `public.teams` is owned entirely by `scripts/ingest-fpl.ts`, which upserts by `id`
  from the *live* `bootstrap-static/` every run: a relegated club's `id` slot is always
  overwritten by whichever club now holds it, so `ingest-core-insights.ts` can never read a row
  for a club that has genuinely left the competition — every row it sees is, by construction, a
  club currently in the league. This claim was independently verified by QA against
  `ingest-fpl.ts`'s actual code (`mapTeams()`, `onConflict: 'id'`), not just taken on the
  Builder's word. The ticket's own permitted fallback — "if they cannot be distinguished, default
  to keeping the rating" — applies exactly.
- **A club-slug fallback (from `name`, then `short_name`, via the existing `slugifyClubName`
  convention) recovers opponent resolution for 2026-2027.** **Because** `fotmob_name` is blank
  for all 20 clubs this season, opponent resolution had gone from 98.9% coverage in 2025-2026 to
  0 of 975 rows. An unresolvable derived slug is counted under the pre-existing named-reason
  mechanism and never fuzzy-matched — verified end-to-end by QA: `"Man Utd"` derives to
  `man-utd`, which correctly fails to match a real `match_id` containing `manchester-united`
  rather than being guessed at.

## ROUTINE

- `teams.elo_stale_since` is set only on the run a row *first* goes stale (left untouched on
  repeat-stale runs), so it records when staleness began rather than when it was last checked;
  cleared back to `NULL` the moment a fresh CSV value arrives. Additive migration
  (`20260901090000_teams_elo_stale_since.sql`), `ADD COLUMN IF NOT EXISTS` with a `COMMENT ON
  COLUMN`, no new `GRANT` needed since the existing table-level grant from the #125 migration
  already covers `teams`.
- Two pre-existing tests that literally asserted the *old, wrong* behaviour Defect 2 requires
  reversing were replaced rather than left in place: one asserting "never falls back to
  name/short_name" (the opposite of the new requirement) was replaced by five new tests covering
  the fallback's exact shapes (single-word, multi-word, short_name-only, unresolvable,
  reconciliation); a blunt identity-column word-list grep test was replaced by a stricter test
  that grep-checks every actual `.update()`/`.upsert()` call against `'teams'` for `name`/
  `short_name` instead of banning the words file-wide. QA independently judged both a tightening
  of the underlying invariant ("never written to `public.teams`"), not a weakening, and confirmed
  this by diffing the before/after test bodies line by line.
- `TEAMS_REQUIRED_COLUMNS` widened to include `name`/`short_name` (read-only, never written to
  `public.teams`) since the fallback now genuinely reads them — keeps the file's existing
  discipline of failing loudly if the source drops a column it depends on, rather than degrading
  silently.
- Slug derivation kept out of `scripts/lib/competition.ts` (permitted by the scope constraint but
  not used): the new fallback is about deriving a slug from `teams.csv`'s own columns, not about
  parsing the `match_id` shape that file already owns, so it stayed local to the ingest job that
  reads `teams.csv`.
