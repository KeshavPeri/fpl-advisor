# Ticket #59 — Send the recommendation 24 and 10 hours before the deadline

## HIGH-IMPACT

- **`scripts/send-telegram.ts`'s `main()` was split into an exported `runSend(trigger, supabase,
  telegramEnv, startedAt)` with no `process.exit`, plus a thin `main(trigger = 'manual')` wrapper
  that owns the process exit.** Because the old `main()` called `process.exit(1)` on several
  failure branches, calling it directly from the new `scripts/notification-schedule.ts` would kill
  the scheduled job's process before it could write its own `job_runs` row — and the definition of
  done requires one `job_runs` row per execution of the scheduled job, on every path, including
  failure. This is a bigger structural change to `send-telegram.ts` than "add a trigger parameter"
  alone, but it was the only way to satisfy that requirement without duplicating the whole
  compose/send/log flow (against CLAUDE.md's sharing-code rule) or spawning a child process (harder
  to test, no existing precedent in this repo). The message text, failure paths and unset-secret
  behaviour are unchanged — `send-telegram.test.ts` was left untouched and still passes all 18
  tests unmodified, which is the evidence the refactor is behaviour-preserving.

## ROUTINE

- The new partial unique index on `(gameweek_id, trigger)` where `outcome = 'sent'` applies to
  `trigger = 'manual'` as well as the two scheduled triggers — not narrowed to exempt manual sends
  — because the ticket's own migration description gives no exemption, and the pre-send
  `existingSent` text-keyed check is left untouched alongside it.
- `scripts/notification-schedule.ts` imports `determineCurrentGameweekId`, `readTelegramEnv`,
  `runSend` and two types directly from `scripts/send-telegram.ts` — the first script-to-script
  import in this repo's `scripts/` directory. Chosen over duplicating the "which gameweek is
  current" and env-reading logic a second time, since script-to-script drift is the same risk
  CLAUDE.md's `src/lib` sharing rule warns about, one level over.
- The new `isUniqueViolation` pure-helper test lives in `scripts/notification-schedule.test.ts`
  rather than in `send-telegram.test.ts` (out of this ticket's scope to change), matching the
  repo's existing convention of unit-testing pure helpers directly rather than building a mocked-
  Supabase integration harness.
