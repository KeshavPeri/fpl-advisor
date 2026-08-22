# Ticket #83 — Fail loudly when the solver has no squad to solve

## HIGH-IMPACT

None. This ticket's behaviour was fully pre-specified by its own definition of done (exact
message content, exact workflow condition); no Tier 2 call was left for the Builder to make.

## ROUTINE

- **The `squad_picks`-count-mismatch path required no change.** It already threw
  `BuildInputError` on a count other than 15, which flows through the same catch block into a
  `job_runs` failure row and a non-zero exit — the same treatment this ticket adds for a missing
  `squads` row. Confirmed unchanged by both the Builder and, independently, by QA. Recorded here
  per the ticket's own definition-of-done item requiring this be stated one way or the other.
- **The no-squad failure was implemented as an exported, directly-testable `failNoSquad()`
  function** rather than inlined in `main()`, so the `$GITHUB_OUTPUT` write and the failure
  message could each be asserted by a real unit test without introducing Supabase mocking into a
  test file that has deliberately avoided it. Matches the file's existing pure-function-testing
  convention (e.g. the `squad_picks`-count check).
