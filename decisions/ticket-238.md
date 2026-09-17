# Ticket #238 — Market odds as the forward fixture term

## HIGH-IMPACT

- **Stored an odds row even when `book_count < 3` (below the read-time usability floor), rather than discarding it, because** the 3-book/48h rule in the ticket text is a *precedence* gate — "a fixture gets the market term when..." — not a storage filter, and the ticket never said thin-book rows should be dropped. Discarding them would destroy diagnosability (no way to see that a fixture had odds but too few books) for no requirement gained. `fixtureSource` still falls through to team-strength for these rows exactly as the precedence table specifies.

## ROUTINE

- Overround removal uses proportional normalisation, per the ticket's own explicit Tier 3 call — alternatives (Shin's method, power method) noted in the code comment for a later ticket to measure.
- `ODDS_API_KEY` preflight check severity set to WARN, not FAIL, because its absence degrades the fixture term gracefully to the next precedence tier (team-strength) rather than producing a guaranteed-wrong or absent result — the same shape as the existing `FPL_ENTRY_ID` WARN, not the `TELEGRAM_*` FAIL.
- `teamEloStale`/`opponentEloStale` fields kept on `FixtureContext`/`TeamMetadata` rather than removed, because `elo_stale_since` is still read independently by preflight check 6; only the now-dead fresh-elo *precedence branch* was removed, not the underlying fields.
- `resolveFixtureIdForOdds` breaks ties between fixtures for the same club pair by nearest `kickoff_time` to the odds row's `commence_time` — a defensive choice for a case the 35-day cap should make unreachable in practice.
- The diagnostic's new liveness/divergence/overround gates are scoped to the next gameweek's own `fixture_odds` rows, matching the diagnostic file's existing "examined gameweek" convention throughout.
