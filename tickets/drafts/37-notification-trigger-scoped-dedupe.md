## Context

**A live defect that silently swallowed a notification, found by reading `job_runs` on 22 August
2026.** The 10-hour reminder before the GW1 deadline was never delivered, and the schedule job
reported success every hour for ten hours while sending nothing.

### What the log shows

```
17:17 UTC  notification-schedule  success  fired deadline_10h for gameweek 1 (0.21h remaining).
17:17 UTC  send-telegram          skipped  an identical message was already sent for gameweek 1
                                           (notifications.id=5) — skipping to avoid a duplicate send.
16:17 UTC  notification-schedule  success  fired deadline_10h for gameweek 1 (1.21h remaining).
16:17 UTC  send-telegram          skipped  an identical message was already sent ...
15:20 UTC  ... and so on, every hour from the 10-hour mark down to the deadline.
```

`public.notifications` for gameweek 1 contains exactly two rows: a `manual` send on 18 August and a
`deadline_24h` send on 20 August. **There is no `deadline_10h` row at all.**

### Why

Two independent duplicate-suppression mechanisms disagree about what a duplicate is.

- `supabase/migrations/20260819090000_notification_trigger.sql` guards at the database level with a
  partial unique index on `(gameweek_id, trigger) WHERE outcome = 'sent'`. **That index would have
  allowed the 10-hour row** — a different trigger is a different row, by design.
- `scripts/send-telegram.ts`'s `runSend()` guards separately, and its query filters on
  `gameweek_id`, `outcome = 'sent'` and `message_text` — **and not on `trigger`.** The 24-hour
  message text was byte-identical to the 10-hour one, because the recommendation had not changed and
  the message carries no time-remaining marker. So the send was suppressed.

The suppression writes no `notifications` row. `src/lib/notification/schedule.ts` reads which
triggers have already been sent from that table, sees nothing, and correctly concludes that
`deadline_10h` is still unsent — so it re-decides to fire it on the next hourly run, and the next,
until the deadline passes.

**And the reporting hides it.** `runSend()` returns `true` for a benign skip — reasonable in itself,
since a skip is not a failure of that run — but `scripts/notification-schedule.ts` line ~270 turns
that `true` into the word **"fired"**. A job reported success ten times for a message that was never
sent. That is precisely the class of failure `LEARNINGS-second-build-wave.md` §2 is about.

### Why the 10-hour send matters

`product-brief.md` §2 specifies two sends per deadline. They are not two copies of one message: the
24-hour one is "here is the plan", the 10-hour one is the last chance to act. Suppressing it because
the plan has not changed removes the more urgent of the two — and "the plan has not changed" is the
*normal* case, so this suppresses the 10-hour send almost every gameweek, not occasionally.

Depends on ticket #59 (merged). No dependency on anything unmerged.

## Scope

**In scope:**

- **Scope the identical-message check in `scripts/send-telegram.ts`'s `runSend()` to the trigger.**
  The query gains `.eq('trigger', trigger)` alongside the existing `gameweek_id`, `outcome` and
  `message_text` filters. A resend within the *same* trigger is still suppressed; a different
  trigger's send is not.
- **Distinguish the 10-hour message from the 24-hour one in `src/lib/notification/message.ts`**, so
  a reader who receives both can tell them apart at a glance. The pre-answered decision is in Notes:
  a short leading marker naming which window this is, and nothing else changed about composition.
- **Stop `scripts/notification-schedule.ts` reporting "fired" when nothing was sent.** `runSend()`
  must report back whether a message was actually delivered or merely skipped, and the schedule job's
  `job_runs.message` and `status` must reflect the difference. A skipped send is `status: 'skipped'`,
  not `'success'`, and the message must say so in words.
- Unit tests for both the trigger-scoped suppression and the three-way sent / skipped / failed
  reporting.

**Explicitly out of scope:**

- **No migration and no change to the partial unique index.** The database guard is already correct
  and is the real double-send protection; this ticket brings the application check into line with it,
  not the other way round.
- **No change to `src/lib/notification/schedule.ts`'s window logic.** The 24h/10h rule, the
  boundaries and the "fire the tightest unsent window" behaviour are all correct and untouched. Once
  a `deadline_10h` row exists, the re-fire loop stops on its own — this ticket does not need to and
  must not change that module to fix it.
- **No change to the hourly cron.** Twenty-four runs a day of which twenty-two decide nothing is the
  designed behaviour of a window-with-a-floor rule, and it is not a defect.
- No change to the `manual` dispatch path's behaviour beyond the shared query above.
- No retroactive backfill of the missing GW1 `deadline_10h` row. That deadline has passed; a
  notification row claiming a send that never happened would be a lie in an append-only log.

## Definition of done

- [ ] The duplicate-suppression query in `scripts/send-telegram.ts` filters on `trigger` in addition
      to `gameweek_id`, `outcome` and `message_text`. Grep-checkable: `.eq('trigger'` appears in that
      query.
- [ ] A unit test asserts that with a stored `deadline_24h` row whose `message_text` is identical, a
      `deadline_10h` send **is** attempted; and that a second `deadline_10h` send with the same text
      **is** suppressed.
- [ ] `runSend()` communicates three distinct outcomes to its caller — sent, skipped, failed — rather
      than a boolean. Every existing caller is updated.
- [ ] `scripts/notification-schedule.ts` writes `status: 'skipped'` and a message containing the word
      `skipped` when the send was suppressed, and only uses the word `fired` when a Telegram call
      actually succeeded. Asserted by a unit test.
- [ ] The 24-hour and 10-hour messages produced from an identical recommendation are **not**
      byte-identical. Asserted by a unit test comparing the two composed strings.
- [ ] `product-brief.md` §8's formatting rules still hold for the new marker: no emoji, no decimal
      points, British English, 24-hour times. Asserted by the existing message tests still passing
      plus one new assertion that the composed message contains no emoji.
- [ ] No file under `supabase/migrations/` is added or modified — grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** `api.telegram.org` is not reachable from a cloud run
      (`deltas.md`), so no test here proves a real message arrives. Tests compose and assert; the
      human check is Keshav confirming two distinguishable messages arrive before the next deadline,
      roughly 24 and 10 hours out.

## Notes for the Analyst / Builder

**The pre-answered decision on the message marker, with its *because*.** Add a short leading line
naming the window — the 24-hour message says it is the first look, the 10-hour one says the deadline
is close. **Because** `product-brief.md` §1 makes the message a thing that is acted on from a phone,
two identical notifications a day apart read as a bug and train the reader to ignore the second one,
which is the one that matters. Keep it to one short line: §8 forbids emoji and decimals, and
`design-reference.md`'s interface-writing section forbids exclamation and urgency theatre. **Do not
put a live countdown or an exact hours figure in the text** — the message is composed once and read
later, so a number that was true at composition time is a lie by the time it is read.

**Why suppression-scoped-to-trigger is the right fix and widening the message text is not.** Making
the two texts differ would also unblock the send, and it is *also* being done here for readability —
but relying on it alone would leave a system whose correctness depends on two strings never
coinciding. The trigger-scoped check is the fix; the message marker is a product improvement that
happens to sit next to it.

**Why this is Tier 3.** It changes when an already-designed notification is sent, stores no new data,
and touches no schema. The one thing that would make it Tier 2 — altering the database's double-send
guarantee — is explicitly out of scope.

**A related observation, deliberately not fixed here.** `runSend()` returning `true` for a benign
skip is defensible on its own terms; the defect is that its caller reports that `true` as "fired".
Fix the reporting, not the return-value philosophy, and do not refactor `send-telegram.ts` beyond
what the three-way outcome requires.

**Do not attempt to reach `api.telegram.org` from a test.** It is unreachable from a cloud run and a
test that tries will fail for a reason unrelated to this ticket.

## Scope constraint

Nothing outside the following files changes:

- `scripts/send-telegram.ts`, `scripts/send-telegram.test.ts`
- `scripts/notification-schedule.ts`, `scripts/notification-schedule.test.ts`
- `src/lib/notification/message.ts`, `src/lib/notification/message.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added or modified. No workflow file is touched.
`src/lib/notification/schedule.ts` is not modified.
