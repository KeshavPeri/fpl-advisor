// FPL-Core-Insights match_id club slug -> public.teams.code — ticket #285.
//
// THE INCIDENT THIS MAP EXISTS TO FIX. data/2026-2027/teams.csv has published a blank
// `fotmob_name` for all twenty clubs since the season began (#167/#176), so
// scripts/ingest-core-insights.ts's own club-slug map was built almost entirely from the
// name/short_name fallback — which does NOT match match_id's slug for clubs whose `name` cell is
// already an abbreviation ("Man Utd", "Spurs", "Nott'm Forest", ...). The result: preflight check
// 12 (ticket #236) found opponent_team_code null on 64.1% of current-season player_match_stats
// rows. teams.csv is not this app's only source of truth for what a club is called in a
// match_id — FPL-Core-Insights' OWN fixtures.csv already carries the answer directly, as
// `home_team`/`away_team` (a `public.teams.code`-shaped integer) alongside that same match_id.
//
// This table is built BY HAND, not derived, from that source — a genuine `-vs-` slug next to a
// genuine team code needs no CSV-column guessing at all. Verified 26 Sept 2026 directly against
// live fetches of:
//   https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data/2026-2027/By%20Gameweek/GW1/fixtures.csv
//   https://raw.githubusercontent.com/olbauday/FPL-Core-Insights/main/data/2026-2027/By%20Gameweek/GW2/fixtures.csv
// filtered to rows with tournament == 'prem' (GW2's file also carries efl-cup rows, which use a
// different match_id shape entirely and are out of scope here — see scripts/lib/competition.ts).
// GW1 alone covers all 20 clubs, once each; GW2's prem rows were cross-checked and produce the
// identical slug for every club that reappears, confirming the slug is stable week to week.
// Every one of the three promoted clubs for 2026-27 (Coventry City, Hull City, Ipswich Town) is
// included — their codes match scripts/lib/oddsClubNames.ts's own ODDS_CLUB_NAME_TO_TEAM_CODE map
// exactly, an independent source built the same way (ticket #238) from a different provider,
// which is further confirmation these codes are right.
//
// NO FUZZY MATCHING — same rule as oddsClubNames.ts. A slug this map does not recognize is
// skipped and counted by scripts/ingest-core-insights.ts's existing resolveOpponentTeamCode
// (reason: "club slug not found among known team codes"), never guessed at.
//
// THIS TABLE NEEDS A NEW ROW EVERY TIME A CLUB IS PROMOTED. That is the one predictable way it
// goes stale, it happens once a year, and preflight check 12 (current-season match data
// completeness, scripts/preflight-check.ts) is what will catch it when it does.
export const CORE_CLUB_SLUG_TO_TEAM_CODE: ReadonlyMap<string, number> = new Map([
  ['arsenal', 3],
  ['aston-villa', 7],
  ['afc-bournemouth', 91],
  ['brentford', 94],
  ['brighton-hove-albion', 36],
  ['chelsea', 8],
  ['coventry-city', 9],
  ['crystal-palace', 31],
  ['everton', 11],
  ['fulham', 54],
  ['hull-city', 88],
  ['ipswich-town', 40],
  ['leeds-united', 2],
  ['liverpool', 14],
  ['manchester-city', 43],
  ['manchester-united', 1],
  ['newcastle-united', 4],
  ['nottingham-forest', 17],
  ['sunderland', 56],
  ['tottenham-hotspur', 6],
])
