## Why

The nightly preflight (`preflight-check.yml`, 19:30 UTC) fails every day, so nobody reads it, and a real
failure would be missed (the same trap as #124). Last run on Keshav's Mac (25 Sept): **3 fail, 9 pass.**
- **Check 10 (configuration):** missing Telegram / FPL entry vars. **Local only.** The workflow has the
  secrets, so this is not a fault. Leave it alone.
- **Check 6 (team ratings):** "3/20 teams have a ClubElo rating stale beyond 10 days". **Obsolete.**
  Since #238 market odds are the top fixture tier, ClubElo is abandoned (handoff §8), and since
  25 Sept `gbm-v1` makes the picks and doesn't read ratings at all. This check guards nothing.
- **Check 12 (current-season match data):** `opponentTeamCodeNullShare=64.1%` on 1,996 current-season
  `prem` rows. **A real data gap.** `scripts/ingest-core-insights.ts` resolves the opponent from
  `match_id` club slugs via `teams.csv` `fotmob_name`, which is blank for every 2026-27 club (#167/#176).
  It matters for `baseline-v1`, which is still the per-player fallback and the explainer.

Meanwhile nothing checks that the **live** model ran. That's the check that matters now.

## Build

1. **Retire check 6.** Replace it with **"Live model projections"**: fail if `player_projections` has no
   `gbm-v1` rows for the next gameweek, or if the newest `computed_at` for them is older than 30 h. Warn
   (don't fail) if fewer than 90% of `public.players` have a `gbm-v1` row for that gameweek. Read the
   active model name from `scripts/lib/activeModelVersion.ts` rather than hardcoding `gbm-v1`.
2. **Fix check 12's cause in the ingest.** Add `scripts/lib/coreClubSlugs.ts`: an **explicit, literal**
   map from the club slug used in FPL-Core-Insights `match_id` to FPL team `code`. Build it once, by hand,
   from Core's own `data/2026-2027/By Gameweek/GW{n}/fixtures.csv` rows where `tournament == 'prem'`:
   those carry `match_id` **and** `home_team`/`away_team` as team codes, so every slug's code is
   visible. Include the three promoted clubs. No fuzzy matching (same rule as `oddsClubNames.ts`). Use it
   in `ingest-core-insights.ts` as the first resolver, ahead of the `fotmob_name`/name fallback. Keep
   skip-and-count for anything still unmapped.
3. Check 12's threshold and wording stay as they are. It should pass on its own once the ingest is
   fixed and has re-run.

## Definition of done — offline only

- `npm run build`, `npm run lint`, `npm test` clean.
- Tests: the new check fails with no active-model rows, fails on stale rows, warns under 90%, passes
  when healthy; `coreClubSlugs` maps every slug in a fixture of real 2026-27 `match_id`s (include at least
  one match for each of the 20 clubs) and the opponent resolver returns the right code both home and
  away; an unknown slug is still skipped and counted.

## Post-merge owner check (does not block this PR)

The orchestrator dispatches `scheduled-jobs.yml` (re-ingest) then `preflight-check.yml`, and expects
green. **Not a gate.**

## Files

Edit: `scripts/preflight-check.ts` + `.test.ts`, `scripts/ingest-core-insights.ts` + its test. New:
`scripts/lib/coreClubSlugs.ts` + `.test.ts`. **Not** `store-squad-advisory.ts`, workflows, `src/`,
`model/`, or `supabase/`.
