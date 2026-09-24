# Ticket #259 — Turn match odds into expected goals, and load four seasons of historical odds

## HIGH-IMPACT

None this ticket.

## ROUTINE

- `remove_overround` was generalised to take an arbitrary outcome-name → odds mapping rather than
  fixed home/draw/away keys, because the same function also serves the two-way over/under 2.5
  market used internally by `goal_expectancy`'s optional O/U fit — avoids a second near-duplicate
  proportional-overround function for a market with a different shape.
- `history.load_odds_history()` outputs `kickoff_date` as a `datetime64` column (via
  `pd.to_datetime`) rather than a string, because the contract didn't specify a format and R2-T1's
  own join description ("date ±1 day") needs a comparable date type, not a string to re-parse.
- Unmapped team names in `history.py` are skipped and the count is printed to stdout rather than
  raised or returned as a second value — the definition of done only required the mapping to be
  correct (zero unmapped across the four finished seasons), not a structured return of the count.
