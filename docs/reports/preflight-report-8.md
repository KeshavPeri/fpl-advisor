# Preflight check

**Overall: WARN**

Gameweek 3 — deadline Sat 5 Sept 01:30 (Asia/Singapore) — 57.79h remaining.

Generated: 2026-09-02T07:42:49.075Z · Job: `preflight-check`

## Checks
| # | Check | Verdict | Reason |
|---|---|---|---|
| 1 | Next gameweek | PASS | Gameweek 3, deadline in 57.79h. |
| 2 | Squad | PASS | squad for gameweek 3: 15 picks, 11 starting, 1 captain, 1 vice-captain. |
| 3 | Projections | PASS | 629 projection rows cover 100.0% of 629 players. all-zero breakdown: 119 total (119 unavailable, 0 no fixture, 0 available). |
| 4 | Recommendation | PASS | recommendation for gameweek 3 is at least as recent as the last solver run. |
| 5 | Solver | PASS | most recent solve for gameweek 3 is a proven optimum. |
| 6 | Team ratings | WARN | 3/20 team(s) have no ClubElo rating; 15/50 fixture(s) in the 5-gameweek horizon fall back to FPL difficulty. |
| 7 | Match data | PASS | every player_match_stats row carries a competition; no player exceeds 38 Premier League matches in a season. |
| 8 | Job freshness | PASS | every tracked job's most recent run is healthy and fresh. |
| 9 | Notifications | PASS | gameweek 3, 57.8h remaining — deadline_24h: not yet due; deadline_10h: still reachable. |
| 10 | Configuration | PASS | all 5 tracked environment variable(s) are set. |
| 11 | League baseline goals | PASS | leagueBaselineGoalsSource is "computed", value 1.550 within the plausible range 1-2.5 (20 finished fixture(s) on record). |

## Details

### 1. Next gameweek — PASS

Gameweek 3, deadline in 57.79h.

Values: markedNextCount=1, gameweekId=3, gameweekName="Gameweek 3", hoursRemaining=57.79132361111111

### 2. Squad — PASS

squad for gameweek 3: 15 picks, 11 starting, 1 captain, 1 vice-captain.

Values: gameweekId=3, squadExists=true, pickCount=15, startingCount=11, captainCount=1, viceCaptainCount=1

### 3. Projections — PASS

629 projection rows cover 100.0% of 629 players. all-zero breakdown: 119 total (119 unavailable, 0 no fixture, 0 available).

Values: gameweekId=3, modelVersion="baseline-v1", projectionRowCount=629, playersCount=629, coverage=1, allZeroRowCount=119, unavailableZeroRowCount=119, noFixtureZeroRowCount=0, availableZeroRowCount=0, unresolvedTeamRowCount=0

### 4. Recommendation — PASS

recommendation for gameweek 3 is at least as recent as the last solver run.

Values: gameweekId=3, hasRecommendation=true, updatedAtMs=1788334614048, lastSolverRunAtMs=1788334607307

### 5. Solver — PASS

most recent solve for gameweek 3 is a proven optimum.

Values: targetGameweekId=3, solverGameweekId=3, solverStatus="Optimal", createdAtMs=1788334607307

### 6. Team ratings — WARN

3/20 team(s) have no ClubElo rating; 15/50 fixture(s) in the 5-gameweek horizon fall back to FPL difficulty.

Values: nullEloTeamsCount=3, totalTeamsCount=20, fixturesFallbackCount=15, totalFixturesInHorizon=50

### 7. Match data — PASS

every player_match_stats row carries a competition; no player exceeds 38 Premier League matches in a season.

Values: totalRows=16355, nullCompetitionRows=0, maxMatchesForAnyPlayerSeason={"playerCode":481655,"season":"2025-2026","count":38}, maxAllowedMatchesPerSeason=38

### 8. Job freshness — PASS

every tracked job's most recent run is healthy and fresh.

Values: staleHoursThreshold=36, jobs={"ingest-fpl":{"verdict":"pass","reason":"\"ingest-fpl\": success, 0.2h ago.","status":"success","ageHours":0.18146083333333332},"ingest-core-insights":{"verdict":"pass","reason":"\"ingest-core-insights\": success, 0.2h ago.","status":"success","ageHours":0.18512416666666667},"sync-squad":{"verdict":"pass","reason":"\"sync-squad\": success, 0.2h ago.","status":"success","ageHours":0.1761002777777778},"project-points":{"verdict":"pass","reason":"\"project-points\": success, 0.2h ago.","status":"success","ageHours":0.1801113888888889},"emit-projections-csv":{"verdict":"pass","reason":"\"emit-projections-csv\": success, 0.1h ago.","status":"success","ageHours":0.12342694444444445},"solver-run":{"verdict":"pass","reason":"\"solver-run\": success, 0.0h ago.","status":"success","ageHours":0.03901972222222222},"generate-recommendations":{"verdict":"pass","reason":"\"generate-recommendations\": success, 0.1h ago.","status":"success","ageHours":0.09477444444444444}}

### 9. Notifications — PASS

gameweek 3, 57.8h remaining — deadline_24h: not yet due; deadline_10h: still reachable.

Values: gameweekId=3, hoursRemaining=57.79132361111111, sent24h=false, sent10h=false, deadline24hReachable=true, deadline10hReachable=true

### 10. Configuration — PASS

all 5 tracked environment variable(s) are set.

Values: present=["SUPABASE_URL","SUPABASE_SECRET_KEY","TELEGRAM_BOT_TOKEN","TELEGRAM_CHAT_ID","FPL_ENTRY_ID"], missing=[]

### 11. League baseline goals — PASS

leagueBaselineGoalsSource is "computed", value 1.550 within the plausible range 1-2.5 (20 finished fixture(s) on record).

Values: finishedFixtureCount=20, minFinishedFixturesForBaseline=20, source="computed", leagueBaselineGoals=1.55
