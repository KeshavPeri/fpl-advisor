# Ticket #97 — Warn before an unused chip expires

## HIGH-IMPACT

None. No decision met the "expensive to reverse after ten more tickets" test — the escalation
bands and thresholds were fully pre-specified in the ticket, and every judgment call below is a
convention choice within that spec.

## ROUTINE

- `ChipExpiryWarning` is a discriminated union (`{band:'none'}` vs.
  `{band:'noted'|'pressing'|'final', gameweeksRemaining, chipsAtRisk}`) rather than nullable
  fields, so `gameweeksRemaining`/`chipsAtRisk` can never be read stale when `band` is `'none'`.
- The chip-count escalation only nudges an already-active band up one level
  (`noted→pressing→final`); two or more unused chips beyond the 8-gameweek window still resolves
  to `none`, matching the table's own "nothing to warn about" row for that range rather than
  inventing a fifth band.
- `appendChipExpiryLine` in `src/lib/notification/message.ts` takes plain resolved values
  (`band`, `chipNames`, `gameweeksRemaining`) rather than importing `src/lib/chips/` types,
  matching that file's existing "compose from resolved inputs" convention.
- The warning copy is identical across all three active bands (`noted`/`pressing`/`final`) —
  escalation is carried entirely by CSS weight/colour on the chips screen, not by different
  wording, per `design-reference.md`'s "understated by default, escalates" register.
- `appendChipExpiryLine` is built and unit-tested but intentionally **not yet wired into
  `scripts/send-telegram.ts`'s `runSend()`** — the ticket's own scope constraint forbids touching
  anything under `scripts/`, and its DoD explicitly requires no new call to `runSend`. The line
  will not appear in a live Telegram message until a follow-up ticket wires it in. Noted here so
  it reads as a deliberate scope boundary, not an oversight.
