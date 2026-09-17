// The Odds API club name -> public.teams.code map — ticket #238.
//
// Copied VERBATIM from the ticket text. Do not re-derive it, do not normalise it, and do not add
// a fallback matcher (fuzzy name matching is exactly the failure mode that cost four gameweeks
// when FPL-Core-Insights' fotmob_name went blank and every opponent_team_code silently became
// null — see src/lib/projection/teamStrength.ts's own header). An unmapped name must be skipped
// and counted, never guessed — see scripts/ingest-match-odds.ts.
//
// Verified 15 Sept 2026 against a live soccer_epl h2h response (20 of 20 names resolved) and
// data/2026-2027/teams.csv. `code` is `public.teams.code` — the stable cross-season key
// (deltas.md D9: never short_name, never the FPL team id).
//
// THIS TABLE NEEDS A NEW ROW EVERY TIME A CLUB IS PROMOTED. That is the one predictable way it
// breaks, it happens once a year, and scripts/ingest-match-odds.ts's 80%-resolution-floor check
// is what will catch it when it does.
export const ODDS_CLUB_NAME_TO_TEAM_CODE: ReadonlyMap<string, number> = new Map([
  ['Arsenal', 3],
  ['Aston Villa', 7],
  ['Bournemouth', 91],
  ['Brentford', 94],
  ['Brighton and Hove Albion', 36],
  ['Chelsea', 8],
  ['Coventry City', 9],
  ['Crystal Palace', 31],
  ['Everton', 11],
  ['Fulham', 54],
  ['Hull City', 88],
  ['Ipswich Town', 40],
  ['Leeds United', 2],
  ['Liverpool', 14],
  ['Manchester City', 43],
  ['Manchester United', 1],
  ['Newcastle United', 4],
  ['Nottingham Forest', 17],
  ['Sunderland', 56],
  ['Tottenham Hotspur', 6],
])
