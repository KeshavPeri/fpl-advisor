## Context

Feature-list item 18. Depends on #8 (app shell, design tokens, `Surface`) and #11 (the FPL ingest
that populates `gameweeks.deadline_time`) — both merged.

`product-brief.md` §1 names the home screen as **the one screen that matters most**, and
`design-reference.md` fixes its order: **thin deadline countdown, then the verdict, then the squad
as a pitch.** This ticket builds the first of those three. It is the top element on the screen and
currently nothing occupies that slot.

The countdown is also the app's answer to the problem it exists to solve. `product-brief.md` §1:
Keshav already receives FPL's own deadline reminders, acknowledges them, and still misses deadlines.
**A countdown alone is therefore not the fix** — the notification carrying the recommendation is.
This element's job is narrower and honest: when the app is open, it says how long is left, without
shouting.

## Scope

**In scope:**

- A `DeadlineCountdown` component under `src/components/`, rendering time remaining to the next
  gameweek deadline.
- A pure helper module for the time arithmetic and the formatting, unit-testable with no clock and
  no DOM.
- Reading the next gameweek from Supabase, reusing `fetchTargetGameweek` from
  `src/lib/squad/api.ts`.
- Rendering it as the **topmost** element of the home screen, above whatever else is there.
- The escalation behaviour `design-reference.md` requires: understated by default, more present
  inside 24 hours.
- A live tick, and cleanup of whatever drives it.
- Loading, past-deadline, and no-deadline-available states.

**Explicitly out of scope:**

- **No notifications, no reminders, no Telegram, no push, no service-worker scheduling.** Items 14
  and 15. This is an on-screen element only.
- **No verdict card, no recommendation, no projected points, no reading of `player_projections`,
  `solver_runs` or `solver_picks`.** Item 17.
- **No change to the pitch, to `src/components/Pitch*` or to any squad rendering.** A separate
  ticket may be revising those and this one must not touch them.
- **No new stored data, no writes, no migration, nothing under `supabase/`.**
- **No changes to `scripts/`, `.github/workflows/`, `src/lib/scoring/` or `src/lib/projection/`.**
- No new dependency. **No date library** — no `date-fns`, no `dayjs`, no `luxon`, no `moment`.
  `Intl.DateTimeFormat` and plain arithmetic are sufficient and are already available.
- No light theme, no theme toggle, no new colour token.
- No "add to calendar", no link out to FPL.

## Definition of done

**Build**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] No new entry in `package.json` `dependencies` or `devDependencies`. The strings `date-fns`,
      `dayjs`, `luxon` and `moment` appear nowhere in the repo.

**Correctness — the time arithmetic**

- [ ] The time arithmetic lives in a **pure module** that takes the deadline and "now" as arguments.
      It calls neither `Date.now()` nor `new Date()` with no argument, so every test is
      deterministic without faking a clock. Verifiable by search.
- [ ] `gameweeks.deadline_time` is stored as `timestamptz` in UTC. The countdown is the difference
      between that instant and now, and **is therefore timezone-independent** — there is a named
      test proving the remaining time is identical whichever timezone the runtime reports.
- [ ] The **date and time shown to the user are rendered in Asia/Singapore**, explicitly, not in the
      browser's local zone. The string `'Asia/Singapore'` appears in the code. There is a named test
      proving the rendered date is correct when the runtime's own zone is something else.
- [ ] Format follows `product-brief.md` §8: weekday-first dates (`Sat 22 Aug`), 24-hour times
      (`01:30`), British English. There is a named test asserting the exact rendered string for the
      GW1 deadline instant `2026-08-21T17:30:00Z`, which is **`Sat 22 Aug, 01:30`** Singapore time.
      *(UTC+8, no DST — check this before writing the test; the deadline crosses midnight into the
      following day in Singapore, which is exactly why the brief requires the date to be shown.)*
- [ ] **The date is always unambiguous**, never a bare time. §8 is explicit: deadlines routinely
      fall after midnight Singapore time, so "01:30" alone is actively misleading about which day.
- [ ] The next gameweek is the one FPL marks `is_next`. A gameweek whose deadline has already
      passed is never presented as upcoming.
- [ ] Remaining time is rendered through the `.num` class so the digits are tabular Geist Mono and
      **do not jitter as the countdown ticks.** `design-reference.md` names this explicitly.

**States**

- [ ] **Inside 24 hours the element escalates** — larger and accented — and outside it is
      understated. The threshold is a single named constant. There is a named test for each side of
      it. It reads as the app leaning forward, not as an alarm: no flashing, no red, no pulsing.
- [ ] **After the deadline has passed** but before the next gameweek is marked, the element says so
      plainly rather than counting negative or rendering `NaN`.
- [ ] **No deadline available** (no `is_next` gameweek, or the read fails) renders the fallback text
      rather than a broken or empty element, and says what to do. The words "Something went wrong",
      "Oops" and "Sorry" appear nowhere in the new files.
- [ ] **Loading** does not shift the layout of everything below it when the value arrives.
- [ ] The ticking interval is cleared on unmount. There is no `setInterval` without a matching
      clear.

**Design constraints — grep-checkable**

- [ ] The element is thin and sits at the top of the home screen, above every other element there.
- [ ] Every colour, spacing, radius and font value in the new CSS is a `var(--…)` token from
      `src/index.css`. **No raw hex colour, no `rgb(`/`rgba(` literal, and no `px` spacing value
      outside a border width.** No new token is added to `src/index.css`.
- [ ] The accent used for escalation is `--accent-cyan` or `--accent-coral`. **No green, no yellow,
      no purple.** The strings `#aa3bff`, `#c084fc`, `#4ade80`, `#f87171`, `Inter`, `system-ui` and
      `-apple-system` appear nowhere in `src/`.
- [ ] `prefers-reduced-motion` is respected by any transition this introduces.
- [ ] No emoji, no icon, no clock glyph. Type and spacing carry it.
- [ ] The countdown is announced sensibly to assistive technology — it does not read out a changing
      value every second.

**Device**

- [ ] Legible and non-overflowing at a 390px-wide viewport.
- [ ] **CANNOT VERIFY, expected:** appearance on the installed iPhone PWA.
- [ ] Scope constraint: only new files under `src/components/` and `src/lib/` for the pure time
      helper, changes to `src/screens/HomeScreen.tsx` and `src/screens/HomeScreen.css`, and this
      ticket's own `decisions/ticket-<number>.md` are added or changed. Nothing under
      `src/lib/scoring/`, `src/lib/projection/`, `src/lib/squad/`, `scripts/`, `supabase/` or
      `.github/` changes; `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **Singapore is UTC+8 year-round with no daylight saving.** That makes the arithmetic simple but
  the *date* treacherous: a 17:30 UTC Friday deadline is 01:30 **Saturday** in Singapore. Every
  rendering must carry the date for this reason, and any test fixture must be checked against that
  offset rather than assumed.
- **Use `Intl.DateTimeFormat` with an explicit `timeZone: 'Asia/Singapore'`.** Do not use
  `toLocaleString` without a zone, do not read the browser's zone, and do not add a date library.
  The whole app is single-user and Singapore-based; the zone is a constant, not a preference.
- **The unit to count in is a decision, so here it is:** days and hours outside 24 hours, hours and
  minutes inside it. Do not show seconds outside the final hour — a second-by-second tick on a calm
  screen is exactly the alarm `design-reference.md` says this must not be. Tier 3, decided here.
- **What "escalates" means is deliberately not a pixel spec.** Larger, accented, more present — the
  Builder chooses the specific treatment from the existing tokens. What it must not be: flashing,
  colour-cycling, pulsing, or red. `design-reference.md` bans green and yellow outright, and coral
  is the risk accent — use it sparingly enough that it still means something.
- **A thin element, not a card.** `design-reference.md`'s home-screen order calls it a *thin*
  countdown. Reference 2 (Revolut) is the model for the treatment of a single important number:
  large, tabular, generously spaced, with a small quiet label, on a surface that does nothing else.
  Reference 3 (Apple Weather) is the model for it being readable in under two seconds.
- **Do not put the countdown inside the pitch's `Surface`, and do not restructure the home screen
  around it.** Add it above what is already there. Another ticket may be revising the pitch in the
  same batch; keeping this element self-contained is what makes the two safe together.
- **`fetchTargetGameweek` already exists** in `src/lib/squad/api.ts` and returns `id`, `name` and
  `deadlineTime`. Use it. Do not add a second query for the same row.
- **What a substitute cannot catch.** A pure module with an injected clock proves every formatting
  and threshold rule exactly. It cannot prove the tick behaves over hours in a real browser, that
  the escalation transition looks right rather than merely correct, or that the installed PWA picked
  up the new CSS — iOS caches it in the service worker. Those are Keshav's checks, in a private tab.
