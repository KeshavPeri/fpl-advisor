# Ticket #101 — Carry the squad forward when the next gameweek's picks are not published

## HIGH-IMPACT

None. No decision met the "expensive to reverse after ten more tickets" test — this is a Tier 3
change per the ticket's own classification (which endpoint the job reads picks from on 404, no
schema or credential change), confirmed against `escalation.md`.

## ROUTINE

- Message-provenance rendering implemented as four small pure functions
  (`picksEstablishedMessage`, `picksConfirmedMessage`, `picksDiffMessage`,
  `picksNotPublishedMessage`) rather than one branching function — specifically so the
  direct-outcome branch could be locked to the exact pre-#101 string via unit test (protecting
  the "byte-for-byte unchanged when target is published" DoD item) while the carried-forward
  wording is independently testable.
- `resolvePicks` takes `priorGameweekIds` pre-sorted (nearest-first) from the caller rather than
  sorting internally — keeps the function a pure "walk this list" primitive, with the actual
  gameweek-adjacency logic staying in `main()` where the rest of the gameweek-selection logic
  already lives.
- The Tier 1 guard regression test lists the four forbidden strings (`my-team`, `login`,
  `cookie`, `Authorization`) as literal test-data values in `scripts/sync-squad.test.ts`, so that
  the test can assert their absence from the implementation file. Judged writing the check
  honestly — rather than obfuscating the literals to dodge a raw `git diff | grep` — as the
  right call; QA confirmed on review that these are genuinely just a regression-test data array,
  not disguised usage, and that the implementation file itself is clean.
