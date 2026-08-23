# Ticket #90 — Scope the notification duplicate check to its trigger

## HIGH-IMPACT

None. The trigger-scoped suppression fix and the three-way sent/skipped/failed reporting are
direct implementations of the ticket's own specified defect fix, not fresh Tier 2 judgment
calls.

## ROUTINE

- The window-marker wording — "First look at this gameweek's plan." (24h) / "Deadline is
  close." (10h) — was pre-answered in the ticket's Notes (no live countdown, no hours figure,
  no emoji/decimals/exclamation). Implemented as one shared `applyWindowMarker()` function
  applied uniformly to whatever message text `runSend()` composes, called once right after
  `messageText` is computed and before both the idempotency check and the notifications insert.
  Applied only to scheduled sends (`deadline_24h` / `deadline_10h`); the `manual` dispatch path
  passes through unchanged, since the ticket's scope only speaks to distinguishing the two
  deadline triggers.
