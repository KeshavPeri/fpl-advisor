## Context

**Feature-list item 25.** The app has no idea what chips Keshav has left. `squads.chips_used`
already stores the raw state — `entry/{id}/history/`'s chips array, written by
`scripts/sync-squad.ts` since #14 — and **nothing reads it.** A column with no consumer is the
dangerous kind (`deltas.md` D9): it is unverified until the first thing depends on it.

This is the unblocker for the rest of wave 7. Item 26 (chip expiry warnings) and item 27 (chip
recommendation, which enables the solver's chip flags) both depend on it, and item 28 (wildcard and
free-hit full-squad solving) depends on 27. **Three further items sit behind this one.**

`product-brief.md` §6d, verified against the Premier League's own 2026/27 announcements at
ticket-writing time (sources in Notes): **eight chips, two sets of four — Wildcard, Free Hit,
Triple Captain, Bench Boost. The first set must be used before the Gameweek 19 deadline, 13:30 GMT
on Saturday 2 January 2027 (21:30 Singapore time). Unused chips from the first set do not carry
over.**

Depends on item 7, squad sync (merged, #14). Nothing unmerged.

## Scope

**In scope:**

- **A new pure module `src/lib/chips/`** — `derive.ts` (all logic, no I/O), `types.ts`, `api.ts`
  (the Supabase read only). Same shape as the existing `src/lib/verdict/` and `src/lib/reasoning/`
  modules.
- **Derived chip state**, from `squads.chips_used` and the `gameweeks` table:
  - Which of the eight chips have been used, and **in which gameweek** each was used.
  - Which chips remain **in the currently active set**.
  - Which chips remain in the set that has not started yet, if any.
  - Whether the first set has expired, decided by comparing now against the **Gameweek 19 deadline
    read from `public.gameweeks`** — never a hardcoded date.
  - How long the active set has left, expressed in **both gameweeks and calendar time**, since a
    chip deadline is a gameweek boundary that a person experiences as a date.
- **A `/chips` screen** (`src/screens/ChipsScreen.tsx`), registered in `src/App.tsx`, reachable from
  the home screen. Reads nothing but the module above.
- **Chips used are shown with the gameweek they were used in**, not just as a struck-through name —
  "when did I play my wildcard" is the question this screen answers.
- **An unrecognised chip name is surfaced, never dropped.** FPL has added and removed chips before
  (the Assistant Manager chip existed and was removed); a name this code does not know must appear
  as an unknown used chip rather than vanishing from the count.

**Explicitly out of scope:**

- **No warnings, no escalation, no countdown urgency.** That is item 26 and it depends on the
  notification schedule. This screen states the position; it does not nag.
- **No chip recommendation and no change to the solver.** That is item 27. `chip_limits` stay all
  zero, deliberately — **do not enable any solver chip flag in this ticket.**
- **No writes of any kind.** Read-only. No new table, no migration, nothing under `supabase/`.
- **No change to `scripts/sync-squad.ts` or any other job.** The data is already being written; this
  ticket only reads it.
- **No change to the home screen's existing order or content** beyond the single link through to the
  new screen. `design-reference.md` fixes the home screen as countdown, verdict, pitch.
- No new npm dependency.

## Definition of done

- [ ] `/chips` renders as a route in `src/App.tsx` and is reachable from the home screen.
- [ ] `src/lib/chips/derive.ts` is pure: the strings `supabase`, `fetch` and `useEffect` appear
      nowhere in it, and it reads no clock — **the current instant is a parameter**, matching
      `src/lib/notification/schedule.ts`'s established convention, so the module is testable with no
      faked clock.
- [ ] The four chip names are mapped from the FPL API's own identifiers to display names, and the
      mapping is stated in one named exported constant with a source comment. An identifier not in
      that map renders as an unknown used chip and is still counted. Named test.
- [ ] **No date literal for the Gameweek 19 deadline appears anywhere in `src/lib/chips/`.**
      Grep-checkable: the strings `2027`, `01-02` and `13:30` do not appear in that directory. The
      deadline is read from `public.gameweeks`.
- [ ] The gameweek number that splits the two sets is a single named constant with a comment citing
      the Premier League source, not an inline `19`.
- [ ] Given a `chips_used` array containing a wildcard used in gameweek 8 and a bench boost used in
      gameweek 14, and a current instant before the Gameweek 19 deadline, the derived state reports:
      first set active, two of four used, Free Hit and Triple Captain remaining, and the second set
      not yet available. Named test asserting each of those.
- [ ] Given the same input and a current instant **after** the Gameweek 19 deadline, the derived
      state reports the first set expired with two chips lost, and all four of the second set
      available. Named test.
- [ ] An empty `chips_used` array (the default) produces "no chips used", not an error and not a
      blank screen. Named test.
- [ ] Time remaining is stated in both gameweeks and calendar terms, formatted per
      `product-brief.md` §8 — Asia/Singapore, `Sat 2 Jan` weekday-first date ordering, 24-hour
      times, British English, FPL's own vocabulary.
- [ ] The Supabase read uses the most recently synced `squads` row rather than assuming a row exists
      for the next gameweek — a gameweek's row does not exist until that gameweek's sync has run.
      Named test for the no-row case.
- [ ] Every Supabase read paginates, per the convention `src/lib/verdict/api.ts` establishes.
- [ ] `design-reference.md` compliance: Geist and Geist Mono with tabular figures for every number;
      translucent layered surfaces via the existing `Surface` component, not flat bordered cards; no
      green, no yellow, no purple; no emoji; sentence case, plain verbs, no filler.
- [ ] Nothing under `supabase/`, `scripts/` or `.github/` is added, changed or deleted.
      Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** every test runs on constructed `chips_used` arrays. Nothing
      here proves the live column holds what this code expects — it has never had a consumer, so its
      real shape is unverified in production. The human check after merge is opening `/chips` on the
      preview URL with the real squad synced and confirming the state shown matches the FPL app.

## Notes for the Analyst / Builder

**Sources, verified 22 August 2026 at ticket-writing time — not recalled.** Eight chips in two sets
of four (Wildcard, Free Hit, Triple Captain, Bench Boost), the first set expiring at the Gameweek 19
deadline of 13:30 GMT on Saturday 2 January 2027, with no carry-over, is confirmed by the Premier
League's own 2026/27 changes announcement. The chip system is otherwise **unchanged from 2025/26**.
One related change worth knowing but out of scope here: the extra December free transfers awarded in
2025/26 are not being awarded in 2026/27, because there is no Africa Cup of Nations in this window.

**The FPL API's chip identifiers are not the display names.** `entry/{id}/history/`'s chips array
uses short internal identifiers rather than the names a person sees. **Do not assume the identifier
strings from memory — read them from the live API or from the real stored column at build time**,
and make the mapping a single constant so a future change is a one-line edit. An identifier the map
does not know must still be counted as a used chip; dropping it would silently under-report how many
chips remain, which is the one number this screen exists to get right.

**Why the current instant is a parameter.** `src/lib/notification/schedule.ts` already establishes
this convention and its reasoning applies identically here: a module that reads the system clock
cannot be tested deterministically, and the expiry rule is the whole point of this ticket.

**Europe/London observes daylight saving; Asia/Singapore does not.** The Gameweek 19 deadline is
13:30 **GMT** in January, so it is not the same UK-clock time as an August deadline. **Do the
arithmetic between UTC instants and convert only for display** — `gameweeks.deadline_time` is
`timestamptz` and already carries the correct instant. Never treat a zone as a fixed offset here.

**`chips_used` is cumulative, not per-gameweek.** It is the whole season's chips as of the last sync
for that squads row, so the latest synced row holds the full picture — do not attempt to union rows
across gameweeks.

**This ticket establishes a genuinely new surface**, so the `frontend-design` skill **is** invoked
per `CLAUDE.md`'s design-pass rule. It must nonetheless reuse the existing design tokens, the
`Surface` component and the established type scale — a new surface is not a new design system.
**Impeccable and emil-design-eng are NOT invoked**; this is not a polish ticket.

**Two other tickets may be running in this batch.** One owns `scripts/build-solver-input.ts` and
`.github/workflows/solver-run.yml`; the other owns `src/components/VerdictCard.tsx`, a new
`src/lib/commit/` and a new migration. This ticket touches none of them — in particular, **do not
modify `src/components/VerdictCard.tsx`**, and **do not add any migration file**; if the chip state
appears to need stored data, it does not, and that would be a scope deviation to report rather than
to act on.

## Scope constraint

Nothing outside the following files changes:

- `src/lib/chips/api.ts` (new), `src/lib/chips/derive.ts` (new), `src/lib/chips/types.ts` (new),
  `src/lib/chips/derive.test.ts` (new)
- `src/screens/ChipsScreen.tsx` (new), `src/screens/ChipsScreen.css` (new)
- `src/screens/HomeScreen.tsx`, `src/screens/HomeScreen.css` (the link through only)
- `src/App.tsx` (the route registration only)
- `decisions/ticket-<this issue number>.md`

No migration file is added. No workflow file is touched. Nothing under `scripts/` or `supabase/`
changes. `src/components/VerdictCard.tsx` is not modified.
