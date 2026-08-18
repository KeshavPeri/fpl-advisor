# Decisions — ticket #42

**Note on authorship:** this file is normally written by the orchestrator, not the Builder. It
was written by the Builder during QA revision round 1, as an explicit one-time exception granted
by the orchestrator to land alongside this round's fix in the same commit — see the round-1
QA/orchestrator exchange on this ticket. Not a new pattern.

## HIGH-IMPACT

- **Kept `fetchTargetGameweek`'s existing "first future deadline" logic instead of switching to
  literal `gameweeks.is_next`, because** the brief's binding requirement is behavioral ("a
  gameweek whose deadline has already passed is never presented as upcoming"), which this
  function already satisfies by construction — it self-heals past `is_next` staleness rather than
  depending on the ingest job having run. Changing `fetchTargetGameweek` was out of this ticket's
  scope (`src/lib/squad/api.ts` forbidden, and the ticket explicitly directs "do not add a second
  query for the same row"). This is the same `is_next` vs. computed-deadline divergence documented
  in `decisions/ticket-41.md` for `sync-squad.ts`; resolved the same way, by documentation rather
  than unification, for consistency across the codebase. (Tier 2, Analyst-confirmed)

## ROUTINE

- **Escalation accent set to `--accent-coral`, not `--accent-cyan`** — a closing deadline is a
  time-pressure/warning signal, matching the role coral already carries elsewhere in the app
  (e.g. `.home-incomplete`), not the positive/recommended role cyan carries. (Tier 3)
- **Countdown units — days+hours outside the 24h threshold, hours+minutes inside it, minutes+
  seconds inside the final hour** — pre-answered in the ticket's own notes; implemented exactly as
  specified, not re-litigated. (Tier 3)
- **`HomeScreen` split into two independent pieces of state** (`loadState` for the pitch,
  `countdownState` for the banner), both populated from the one existing `fetchTargetGameweek()`
  call, rather than either duplicating the query or collapsing the two features' loading/error
  semantics into one. Chosen to satisfy the ticket's "no second query for the same row" instruction
  while leaving the pitch's existing loading/error/no-gameweek/no-squad control flow byte-for-byte
  unchanged, since that logic is explicitly out of this ticket's scope. (Tier 3)
- **`formatDeadlineInstant` implemented independently in `src/lib/deadlineCountdown.ts`, rather
  than reusing `src/lib/format.ts`'s `formatSyncTimestamp`** — found, while writing the GW1 named
  test, that `formatSyncTimestamp` does not actually render a comma between the date and the time
  on this runtime's ICU data (renders `"Sat 22 Aug 01:30"`, not the `"Sat 22 Aug, 01:45"` its own
  docstring claims), so reusing it would have failed the DoD's exact-string requirement. Editing
  `format.ts` to fix that was out of this ticket's scope, so `formatDeadlineInstant` builds the
  string from two independent `Intl.DateTimeFormat` instances joined with a literal `", "`
  instead, which sidesteps the ICU dependency entirely. Worth a look outside this ticket:
  `formatSyncTimestamp`'s existing callers (the squad-sync display, ticket #13) may be silently
  missing that comma too — no existing test locks down its exact output. (Tier 3, flagged for
  follow-up)
