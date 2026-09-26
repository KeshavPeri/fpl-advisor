# Ticket #285 — Preflight green when healthy

## HIGH-IMPACT

- Chose to have a teams.csv-derived slug resolution silently discard itself (keep the literal
  `coreClubSlugs` map's answer) rather than route the collision through the existing
  "ambiguous duplicate — remove both" logic, because the literal map is hand-verified against
  real 2026-27 fixture data and is strictly higher-confidence than a teams.csv-derived guess;
  treating it as an ambiguous duplicate would delete the *correct* answer whenever teams.csv
  happens to independently produce the same slug string, which defeats the point of making the
  literal map the first resolver.

## ROUTINE

- `buildClubCodeBySlug`'s new third parameter (the slug map) is optional and defaults to the
  real `CORE_CLUB_SLUG_TO_TEAM_CODE` map, so every existing call site and test keeps
  compiling/passing unless it explicitly wants isolation — matches the file's existing style
  for other optional/defaulted parameters (`elementTypeByPlayerId`, `teamCodeByPlayerId`).
- Kept the new check 6's `player_projections`/`players` reads fully independent from check 3's
  already-fetched rows, per `preflight-check.ts`'s own stated "per-check, non-shared query"
  convention.
- Did not add a new "resolved via core_club_slugs" count to the ingest job's log
  message/`job_runs.details` — only added the `ClubSlugSource` enum value itself. The ticket's
  DoD didn't ask for that observability; judged scope creep, left as an easy follow-up.
- Check id/title `live-model-projections` / "Live model projections" taken directly from the
  ticket title, no alternative considered.
