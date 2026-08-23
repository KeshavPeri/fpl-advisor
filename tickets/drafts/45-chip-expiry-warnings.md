## Context

**Feature-list item 26.** The chip state screen (item 25, merged as ticket #85) shows which chips
remain. Nothing tells Keshav when they are about to be lost.

**Unused chips from the first set expire and do not carry over** — verified against the Premier
League's own 2026/27 announcements at ticket-writing time: eight chips in two sets of four
(Wildcard, Free Hit, Triple Captain, Bench Boost), the first set expiring at the **Gameweek 19
deadline, 13:30 GMT on Saturday 2 January 2027** (21:30 Singapore time). The chip system is
otherwise unchanged from 2025/26.

`product-brief.md` §1's whole framing is that the app exists so Keshav does not have to remember to
look. A chip lost to inattention is the exact failure it is meant to prevent, and it is the one
mistake in FPL that is completely irreversible.

Depends on item 15, the notification schedule (merged, #59, refined by #90) and item 25, chip state
(merged, #85). Nothing unmerged.

### Why this is not just "add a red banner"

`design-reference.md` is explicit about register: the countdown **"is understated by default and
escalates inside 24 hours… It should feel like the app leaning forward, not like an alarm."** The
same rule governs this. A warning that shouts in September about a January deadline is noise, and
noise is what teaches someone to ignore the one message that mattered.

The escalation must also be **honest about scale**: a chip deadline is a gameweek boundary that a
person experiences as a date, and there are still roughly seventeen gameweeks to go. **Gameweeks
remaining is the unit that matters**, not days.

## Scope

**In scope:**

- **Extend `src/lib/chips/derive.ts`** with a pure urgency band for the active chip set, computed
  from the number of gameweeks remaining before the set expires and how many of its chips are still
  unused. Thresholds are pre-answered in Notes. **The current instant stays a parameter**, per that
  module's existing convention.
- **The band is `none` when there is nothing to warn about** — no unused chips in the active set, or
  the active set is the second one, which does not expire before the season ends.
- **Surface it on the chips screen** (`src/screens/ChipsScreen.tsx`): the warning sits with the chip
  state it refers to, in the register the band calls for, naming which chips are at risk and how
  many gameweeks are left.
- **One line in the deadline notification**, added to the message composed by
  `src/lib/notification/message.ts` and sent by the existing 24-hour and 10-hour triggers — **only
  when the band is at its top two levels.** One short line, no emoji, no decimals, British English,
  per `product-brief.md` §8.
- **The notification line names the chips at risk and the gameweeks remaining**, and says nothing
  about which chip to play — that is item 27.

**Explicitly out of scope:**

- **No chip recommendation and no change to the solver.** `chip_limits` stay all zero. Item 27.
- **No new notification trigger, no new schedule, no extra send.** This ticket adds a line to
  messages that already go out; it never causes a message that would not otherwise have been sent.
  **Do not touch `src/lib/notification/schedule.ts`** — the 24h/10h window logic is correct and
  settled.
- **No migration, nothing under `supabase/`.** Chip state is derived from `squads.chips_used`, which
  is already written.
- **No change to `src/lib/chips/api.ts`'s read**, beyond whatever the new derived field requires.
- **No countdown, no live timer, no per-day escalation.** Gameweeks are the unit.
- **No change to the home screen, the verdict card or the reasoning screen.**
- No new npm dependency.

## Definition of done

- [ ] The urgency band is computed in `src/lib/chips/derive.ts` and that file stays pure: the
      strings `supabase`, `fetch` and `useEffect` appear nowhere in it, and it reads no clock — the
      current instant remains a parameter.
- [ ] Named unit tests for each band boundary listed in Notes, including both sides of each
      threshold.
- [ ] The band is `none` when every chip in the active set has been used. Named test.
- [ ] The band is `none` when the active set is the second one. Named test. *(The second set does
      not expire before the season ends, so there is nothing to warn about.)*
- [ ] The band accounts for **how many** chips are unused, not only the time left: two unused chips
      with four gameweeks to go is more urgent than one. Named test comparing those two cases.
- [ ] The chips screen renders the warning only when the band is not `none`, and the text names the
      specific unused chips and the gameweeks remaining. Asserted on the derived view.
- [ ] The notification line appears **only** at the top two bands. Named test asserting it is absent
      at the lower bands and present at the top two.
- [ ] The composed message contains no emoji and no decimal figures, and the existing message tests
      still pass unchanged. Grep-checkable for emoji.
- [ ] **No message is sent that would not have been sent anyway.** Grep-checkable: this ticket adds
      no call to `runSend`, no new trigger value, and does not modify
      `src/lib/notification/schedule.ts`.
- [ ] The gameweek that splits the two sets is still read from the single named constant established
      by #85, and the Gameweek 19 deadline is still read from `public.gameweeks` — **no date literal
      is introduced.** Grep-checkable: the strings `2027`, `01-02` and `13:30` do not appear under
      `src/lib/chips/`.
- [ ] `design-reference.md` compliance: understated by default, escalating; coral for risk, never
      green or yellow; Geist and Geist Mono with tabular figures; translucent layered surfaces; no
      emoji; sentence case, plain verbs, no filler; the copy states what is at stake and what to do,
      never "Warning!".
- [ ] Nothing under `supabase/` or `.github/` is added, changed or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** `api.telegram.org` is unreachable from a cloud run
      (`deltas.md`), so no test proves the line arrives in a real message, and the top bands cannot
      occur for another four months so they will not be seen in production for a long time. The
      human check after merge is opening `/chips` and confirming the current state shows **no**
      warning — it is August and the correct behaviour today is silence.

## Notes for the Analyst / Builder

**The escalation bands, pre-answered with their *because*.** Measured in gameweeks remaining before
the active set expires, and only when at least one chip in that set is unused:

| Gameweeks remaining | Band | Behaviour |
|---|---|---|
| more than 8 | `none` | Nothing. The chips screen still shows the state; there is no warning |
| 5 to 8 | `noted` | A quiet line on the chips screen. No notification |
| 3 or 4 | `pressing` | More present on the chips screen. One line in the deadline notification |
| 2 or fewer | `final` | Most present. One line in the deadline notification |

**And one adjustment:** when **two or more** chips in the active set are unused, the band moves up
one level, **because** two chips cannot both be played in the last gameweek — the time needed scales
with the number of chips left, not just with the deadline. A single unused chip at three gameweeks
out is `pressing`; two unused chips at three gameweeks out is `final`.

**Why the thresholds are in gameweeks and start at 8.** A chip is played *in* a gameweek, so the
real question is how many chances are left, not how many days. Eight gameweeks is roughly two months
— early enough to plan around, late enough that a warning is information rather than nagging. If a
Builder hits a case these numbers do not obviously cover, reason from that sentence.

**Do not escalate by date within a gameweek.** The deadline countdown already owns per-hour urgency
for the transfer decision. Two things escalating on two different clocks on the same screen is
exactly the noise `design-reference.md` bans.

**Europe/London observes daylight saving; Asia/Singapore does not.** The Gameweek 19 deadline is
13:30 **GMT** in January, which is not the same UK-clock time as an August deadline. Do the
arithmetic between UTC instants and convert only for display — `gameweeks.deadline_time` is
`timestamptz` and already carries the correct instant. #85 established this; do not undo it.

**Read `src/lib/chips/derive.ts` and `src/lib/notification/message.ts` before writing anything.**
Both were built recently to a specific shape and this ticket extends them rather than adding a
parallel path. `message.ts` in particular was just changed by ticket #90 to distinguish the 24-hour
and 10-hour messages — **read that change first**, and add the chip line in a way that survives
both.

**This ticket extends existing UI rather than establishing new visual direction**, so the
`frontend-design` skill is **not** invoked and Impeccable is **not** invoked (`CLAUDE.md`'s
design-pass rule). Match the chips screen's existing components and tokens.

**Two other tickets may be running in this batch.** One owns `src/lib/accuracy/`,
`src/components/AccuracyCard.tsx` and `src/screens/HomeScreen.tsx`; the other owns
`scripts/build-solver-input.ts` and `docs/solver-notes.md`. This ticket touches none of them — in
particular, **do not modify `src/screens/HomeScreen.tsx`, `src/App.tsx` or
`scripts/build-solver-input.ts`.**

## Scope constraint

Nothing outside the following files changes:

- `src/lib/chips/derive.ts`, `src/lib/chips/derive.test.ts`, `src/lib/chips/types.ts`
- `src/lib/chips/api.ts` (only if the new derived field needs an additional column read)
- `src/screens/ChipsScreen.tsx`, `src/screens/ChipsScreen.css`
- `src/lib/notification/message.ts`, `src/lib/notification/message.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/` changes. No workflow file is touched.
Nothing under `scripts/` changes. `src/lib/notification/schedule.ts`, `src/App.tsx`,
`src/screens/HomeScreen.tsx` and `src/components/VerdictCard.tsx` are not modified.
