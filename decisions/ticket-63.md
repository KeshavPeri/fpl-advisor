# Ticket #63 — Null ClubElo for unmatched clubs

## HIGH-IMPACT

- **The fix does not restore current ClubElo ratings for the three promoted clubs — it makes their
  absence honest, and that absence is a real, ongoing reduction in model precision.** Coventry City,
  Hull City and Ipswich Town will hold `elo = null` after this ships and be rated via FPL's own 1–5
  `team_h_difficulty` / `team_a_difficulty` fallback in `src/lib/projection/fixture.ts` instead.
  Because `data/2026-2027/teams.csv`'s `elo` column was verified empty for all twenty clubs on
  18 Aug 2026 (the source has not published current-season ratings), there was no substitute number
  to use — a guessed rating would have been the same failure as the stale one, with better PR. This
  will stay true until FPL-Core-Insights publishes current-season ClubElo; at that point, switching
  the elo read to the current season while match stats stay on the historical one is flagged as a
  clean, small follow-up ticket (not built here — out of this ticket's scope).

## ROUTINE

- Split the null-write into its own `applyTeamEloNulls()` function rather than folding it into the
  existing `applyTeamEloUpdates()`, because it writes a different value (`null`) for a structurally
  different reason (unmatched club identity vs. a fresh rating) — kept the two write paths textually
  separate for readability, so a future diff touching one doesn't silently touch the other.
- Nulled every row counted under `teamsCodesNotInCsv`, including a `public.teams` row whose `code`
  is itself `null`, not only the promoted-club case the ticket's narrative focuses on — the
  definition of done's wording ("a row whose code is not present in the season's teams.csv") covers
  a null code too, and leaving such a row's stale elo in place would be the same failure via a
  different root cause (bad table data instead of a promoted club).
