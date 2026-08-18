## Context

Feature-list item 15 — **the last piece of the value loop.** Items 1–14 are shipped and merged;
this closes it.

Depends on item 14 (`scripts/send-telegram.ts`, `src/lib/notification/`, `notifications`, merged,
migration applied, and **confirmed working end to end — a real message was received on 17 Aug 2026**)
and #11 (`gameweeks.deadline_time`).

`product-brief.md` §2: the notification carries the decision at **24 hours and 10 hours before each
deadline**. §1 is why: Keshav already receives FPL's own reminders, acknowledges them, and still
misses deadlines — so the notification has to arrive carrying the recommendation, twice, at times
chosen so that one of them lands when he can act.

### What exists and what does not

- `.github/workflows/send-notification.yml` is **`workflow_dispatch` only**, by design — ticket #55
  explicitly scoped scheduling out.
- `scripts/send-telegram.ts` sends the current gameweek's Plan A, or a failure notice, and writes one
  `notifications` row per attempt.
- `notifications` records `send_kind` (`current` / `stale` / `infeasible` / `no_recommendation`) and
  `outcome` (`sent` / `failed`). **It records what was sent. It does not record why now** — there is
  no concept of which scheduled trigger fired, so nothing can currently tell a 24-hour send from a
  10-hour send from a manual one, and nothing prevents a double-send.

## Scope

**In scope:**

- **`supabase/migrations/20260819090000_notification_trigger.sql`** — adds `trigger text NOT NULL
  DEFAULT 'manual'` to `notifications` with a `CHECK` constraint, plus a **partial unique index that
  makes double-sending impossible at the database level**.
- **`src/lib/notification/schedule.ts`** — pure: given the deadline instant, the current instant, and
  the set of triggers already sent for that gameweek, decide which trigger should fire now, or none.
- **`scripts/notification-schedule.ts`** — reads the next gameweek and the already-sent triggers,
  asks the pure module, and either sends or exits zero having done nothing.
- A **schedule** added to `.github/workflows/send-notification.yml`, keeping its existing
  `workflow_dispatch` path intact.
- Vitest tests for every rule below.
- One `job_runs` row per execution.

**Explicitly out of scope:**

- **No change to the message text, its composition, or `src/lib/notification/message.ts`.** This
  ticket decides *when*, never *what*. Item 14 owns the content.
- **No change to how a recommendation is generated or ranked.** Nothing under
  `src/lib/recommendation/`, `scripts/generate-recommendations.ts` or
  `scripts/build-solver-input.ts` changes — another ticket in this batch owns those.
- **No mid-week "the recommendation changed" notification.** `product-brief.md` §9 open question 3
  leaves that unresolved and names notification fatigue as the exact failure mode this app exists to
  fix. Two sends per gameweek, no more.
- **No daily projection re-run, no "Run now" button.** Item 22.
- **No UI, no route, no component.** Nothing under `src/screens/` or `src/components/` changes.
- **No change to `.github/workflows/solver-run.yml`, `scheduled-jobs.yml`, `calibration-report.yml`
  or `solver-smoke.yml`.**
- No new npm dependency. **No date library** — `Date` arithmetic on two instants is sufficient.

## Definition of done

**Build**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] `src/lib/notification/schedule.ts` imports no I/O of any kind and takes "now" as an argument —
      it never calls `Date.now()` or argument-less `new Date()`. Every test is deterministic with no
      faked clock. Verifiable by search.
- [ ] No new entry in `package.json`. The strings `date-fns`, `dayjs`, `luxon` and `moment` appear
      nowhere in the repo.

**The rule — fire the tightest unsent window**

- [ ] `trigger` takes exactly one of `manual`, `deadline_24h`, `deadline_10h`.
- [ ] **More than 24 hours before the deadline: nothing fires.** Named test at 24.5 hours.
- [ ] **Between 24 and 10 hours, with nothing sent: `deadline_24h` fires.** Named tests at exactly
      24.0 hours and at 15 hours.
- [ ] **At or inside 10 hours, with nothing sent: `deadline_10h` fires and `deadline_24h` never
      does.** Named test at 8 hours with no prior sends. *(A missed 24-hour window is stale news; it
      must not be sent late alongside the 10-hour one.)*
- [ ] **Inside 10 hours with `deadline_24h` already sent: `deadline_10h` fires.** Named test.
- [ ] **A trigger already sent for this gameweek never fires again.** Named tests for each.
- [ ] **After the deadline has passed, nothing fires**, including at exactly zero hours remaining.
      Named test at −0.5 hours.
- [ ] The boundaries are inclusive-at-the-threshold and there is a named test at exactly 10.0 hours
      proving which side it falls on.

**Idempotency is a database guarantee, not a promise**

- [ ] The migration creates a **partial unique index on `(gameweek_id, trigger)` where
      `outcome = 'sent'`**, so two successful sends of the same trigger for the same gameweek cannot
      both exist. A **failed** send does not consume the slot, so a retry is still possible.
- [ ] There is a comment in the migration stating that reasoning explicitly.
- [ ] The migration is idempotent (`ADD COLUMN IF NOT EXISTS`, `CREATE UNIQUE INDEX IF NOT EXISTS`)
      and uses the same `anon` / `service_role` role guard every prior migration uses.
- [ ] `notifications` keeps `SELECT` for `anon` and `SELECT, INSERT` for `service_role`. **No
      `UPDATE`, no `DELETE`** — it is a log. No migration here grants either. *(`deltas.md` D8.)*
- [ ] Existing rows default to `trigger = 'manual'`, which is what they were.
- [ ] `scripts/send-telegram.ts` writes the trigger it was invoked with, defaulting to `manual` when
      invoked directly. **This is the only change permitted to that file** and it must not alter the
      message, the failure paths, or the unset-secret behaviour.
- [ ] A unique-violation on insert is caught and reported as "already sent", not as a crash — two
      workflow runs overlapping is a normal race, not a failure. Named test.

**The job and the schedule**

- [ ] The scheduled workflow runs **hourly**, and the cron is stated in UTC with a comment deriving
      it. GitHub Actions cron is UTC and best-effort — it can be delayed by several minutes, which
      the window rule above tolerates by design.
- [ ] `workflow_dispatch` still works and still sends immediately with `trigger = 'manual'`,
      bypassing the window logic. The existing job, its steps and its secrets are otherwise unchanged.
- [ ] With `TELEGRAM_BOT_TOKEN` or `TELEGRAM_CHAT_ID` unset, the scheduled path logs the missing
      variable, makes no network request and exits zero — the same contract item 14 established.
- [ ] A run that decides nothing should fire exits zero, writes a `job_runs` row saying so with the
      hours remaining, and makes no Telegram request.
- [ ] `job_runs` gets one row per execution, `job_name = 'notification-schedule'`, carrying the
      target gameweek, hours until the deadline, which triggers were already sent, and the decision.
- [ ] **A run inside a window with no usable recommendation still sends the failure notice** rather
      than staying silent — `product-brief.md` §6c and §6d. Silence is the one outcome the product
      forbids.
- [ ] Every Supabase read uses the shared pagination helper.
- [ ] Scope constraint: only `src/lib/notification/schedule.ts` and its test file,
      `src/lib/notification/index.ts`, `scripts/notification-schedule.ts` and its test file,
      `scripts/send-telegram.ts`, `supabase/migrations/20260819090000_notification_trigger.sql`,
      `.github/workflows/send-notification.yml`, and this ticket's own
      `decisions/ticket-<number>.md` are added or changed. Nothing under `src/screens/`,
      `src/components/`, `src/lib/recommendation/`, `src/lib/projection/`, `src/lib/scoring/`,
      `src/lib/squad/` changes; no other file in `scripts/` or `.github/workflows/` changes;
      `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **Hourly, not "at exactly 24 hours before".** A cron cannot target a moving deadline, and GitHub's
  scheduler is best-effort — a job asked for at :00 may arrive at :12, or later under load. So the
  rule is a **window with a floor**, not an instant: fire at the first opportunity at or inside the
  window, and never twice. That makes a delayed run, a skipped run, and an outage all
  self-correcting, which an exact-time match would not be.
- **Fire the tightest unsent window, and let the wider one lapse.** At eight hours out with nothing
  sent, sending both would deliver a "24 hours to go" message fourteen hours late. One notification,
  the correct one, is the right answer. This is a Tier 3 decision, made here.
- **The deadline arithmetic is timezone-free and must stay that way.** `gameweeks.deadline_time` is
  `timestamptz` in UTC and "hours until" is a difference between two instants — no timezone enters
  it. Singapore time appears only in the message text, which item 14 already handles. **Do not
  introduce a timezone into the scheduling logic**; it is the fastest way to fire a day early or a
  day late, and `deltas.md` D2 records that exact mistake being made once already.
- **The unique index is the real guarantee.** Checking "has this been sent?" and then sending is a
  read-then-write race, and two overlapping runs will both pass the check. The database constraint
  is what actually prevents a double-send; the check is only there to avoid pointless work. Treat a
  unique violation as the expected outcome of a race, not an error.
- **Partial on `outcome = 'sent'` for a reason.** A failed send must be retryable on the next hourly
  run, or a transient Telegram outage silently costs a gameweek's notification.
- **Two other tickets are running in this batch.** One owns `src/lib/recommendation/`,
  `scripts/build-solver-input.ts` and `scripts/generate-recommendations.ts`; the other owns
  `src/components/`, `src/screens/` and `src/lib/squad/`. Neither touches anything here. Pin the
  migration filename exactly as given — two migrations in one batch have collided on a timestamp
  before.
- **What a substitute cannot catch.** Pure tests prove every window rule exactly, with no clock. They
  cannot prove GitHub fires the cron on time, cannot prove the unique index behaves under a real
  race, and cannot prove a message actually arrives. Those are live checks: after merge, apply the
  migration and let it run across a real deadline. **With GW1 at 01:30 Singapore on Saturday 22
  August, the 24-hour trigger should fire around 01:30 Friday and the 10-hour around 15:30 Friday —
  that is the first live proof and it happens whether or not anyone is watching.**
