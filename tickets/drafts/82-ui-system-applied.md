## Context

**The design system exists after the foundations ticket. This ticket applies it to every screen.**

`docs/ui-audit-2026-08-31.md` produced 51 findings. The foundations ticket — merged manually before
this run — took the tokens, the material and the navigation bar. **This ticket takes the remaining
findings: every panel, every screen, and the four accepted motion opportunities.**

The audit's verdict frames the work: *"Every other good decision in this codebase was implemented at
roughly 8% of the strength required to see it. The design did not collapse into the default; it was
rendered at the default … about forty CSS values and one component — not a redesign."* The component
is done. These are the values.

**Read `docs/ui-audit-2026-08-31.md` before writing any code.** Every finding below carries an exact
current value and an exact proposed value in that document. Do not re-derive them and do not
substitute your own without saying why.

## Scope

**In scope — these audit findings, and no others:**

- **Countdown** — F21 (a caption, not a figure), F22 (escalation is a 2px font-size change), F23
  (`formatRemaining` jitters once a second because it does not zero-pad — `tabular-nums` fixes digit
  *width*, not digit *count*), F24 (`transition: font-size`).
- **Pitch and bench** — F25 (boxed inside 82px of chrome), F26 (shirts sized to survive the box), F27
  (row gap is 23% of row height), F28 (the bench is a second identical panel), F29 (the shirt
  silhouette is invisible). Also delete `Pitch.css`'s now-inert `animation-delay: 90ms`, left behind
  deliberately by the foundations ticket.
- **Verdict card** — F30 (two 36px elements on one card), F31 (ends in a stack of three competing
  actions), F32 (`Commit` acknowledges itself least of any action in the app).
- **Accuracy card** — F34 (competes with the verdict for the same role), F35 (cyan miscodes the MAE),
  F36 (nested scroll region on the home screen), F37 (the copy).
- **Home screen** — F38 (delete the wordmark and the header link row), F39 (screen order after the
  fixes).
- **Chips** — F40 (reorder to *what do I have, when do I lose it, is now a good time*), F41 (the
  advisory caveat sits below the number it qualifies), F42 (seven panels of equal weight).
- **Decisions** — F43 (a flat list of identical panels), F44 (commit and override are visually
  identical by construction), F45 (a defined slot for the outcome).
- **Reasoning** — F46 (twelve identical panels).
- **Override** — F48 (`<select>` at 15px triggers iOS focus zoom), F50 (the confirm step teleports).
- **Press feedback** — F49 (two of the app's four buttons have no press feedback), using the motion
  tokens the foundations ticket defined.

**Explicitly out of scope:**

- **`src/index.css`, `Surface`, `AppShell`, the navigation component and `src/App.tsx`.** The
  foundations ticket owns the system. **Consume the tokens; do not add to them, retune them, or
  work around them.** If a token you need does not exist, **say so and stop** rather than defining
  one here — that is a real finding and it belongs in the decisions file.
- **Every finding marked optional** — F9, F33, F47, F51 — and every one of the audit's **nine
  rejected** animation opportunities. The rejections are decisions, not omissions:
  `surface-arrive` in particular stays deleted.
- **Anything under `src/lib/`, `scripts/`, `supabase/` or `.github/`.**
- **No new dependency.** No animation library, no UI library, no icon set.
- **No new screen, no new route, no change to what any screen fetches or computes.** This is
  presentation only.
- **No light mode, no toggle, no change to `#0b0f19`, no green, no yellow, no purple, no Inter, no
  emoji as icons, no decimal projected-points values in the recommendation UI, and the pitch stays a
  pitch.** See `docs/my-ui-problems.md`'s constraints section.

## Definition of done

- [ ] **Every must-fix finding listed in Scope is addressed**, each with a code comment citing its
      finding number.
- [ ] **Should-fix findings are addressed after every must-fix is done.** If the ticket runs out of
      room, **stop and report which should-fix findings were not reached** in the PR body and the
      decisions file. **A complete must-fix pass with three should-fixes reported as deferred is a
      good outcome; a half-finished sweep of all of them is not.**
- [ ] `formatRemaining` zero-pads, so the countdown's character count is constant through the final
      hour. Named test on the exact boundary (F23).
- [ ] No `<select>` or `<input>` in the app renders below 16px. Grep-checkable (F48).
- [ ] The pitch renders full-bleed using the escape mechanism the foundations ticket documented, not
      a negative margin invented here (F25).
- [ ] The bench is visually subordinate to the eleven by something other than a text label (F28).
- [ ] Exactly one element on the home screen carries the display type size (F30, F34).
- [ ] Commit and override are distinguishable at a glance in the decision history without reading
      the label (F44).
- [ ] All four accepted motion opportunities use the foundations ticket's duration and easing
      tokens. **No hand-typed duration or cubic-bezier appears in any file this ticket touches.**
- [ ] `prefers-reduced-motion` is respected on every new motion.
- [ ] **Grep-checkable:** no element carrying `.num` has its font family or numeric variant
      overridden by a rule added or changed in this ticket. The foundations ticket fixed this class
      of bug; do not reintroduce it (F1).
- [ ] Every existing test passes **unmodified** except where one asserts a value this ticket
      deliberately changes.
- [ ] Nothing under `src/index.css`, `src/components/Surface.*`, `src/components/AppShell.*`, the
      navigation component, `src/App.tsx`, `src/lib/`, `scripts/`, `supabase/`, `docs/` or
      `.github/` is added, changed or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch, and here it is most of the ticket.** Whether the full-bleed
      pitch reads as generous, whether the escalated countdown reads as escalation, whether the new
      elevation is visible at arm's length in a dark room, and whether the blurred bar holds 60fps
      over a scrolling pitch are all device judgements — the audit's Part 4 lists eight of them.
      **These come back as CANNOT VERIFY and land on Keshav's own list.** QA's job here is that every
      cited finding was addressed, the constraints hold, and nothing regressed.

## Notes for the Analyst / Builder

**The audit is the specification and it is not optional reading.** Cite finding numbers in code
comments, in the decisions file and in the PR body, and list any finding you did not reach.

**This is the largest ticket this pipeline has attempted.** The honest failure mode is doing all of
it badly rather than most of it well. **Must-fix first, in the order listed, and report what you did
not reach.** A ticket that stops and says so is the mechanism working
(`LEARNINGS-second-build-wave.md` §5).

**Restraint on motion is a hard requirement, not a preference.** The audit accepted 4 opportunities
and rejected 9, with reasons. **Do not implement a rejected one because it seemed cheap while you
were in the file.** Per Emil Kowalski's "You Don't Need Animations", a frequently-seen element that
animates for decoration makes the app feel slower.

**On P4's resolution, already decided — do not relitigate it.** The countdown is the largest *figure*;
the verdict is the loudest *statement*. Size and loudness are different axes. `design-reference.md`'s
"understated by default" governs the countdown's treatment, not its size.

**Copy is design material.** F37 and F41 are writing fixes, not layout fixes. `design-reference.md`'s
interface-writing rules bind: sentence case, plain verbs, no filler, errors that say what to do, an
action that keeps its name through the whole flow. If a sentence reads like an assistant explaining
itself, rewrite it.

**This is Tier 3 for the most part** — layout, spacing and formatting decisions the brief already
governs. Log routinely. **The exception is F38** (deleting the wordmark and the header link row),
which changes what the home screen is; log that one as HIGH-IMPACT with its *because*.

**Two other tickets are running in this batch.** One owns `scripts/ingest-core-insights.ts`,
`scripts/build-feature-history.ts` and a new migration; the other owns `src/lib/projection/`. This
ticket touches neither, and imports nothing from either.

## Scope constraint

Nothing outside the following files changes:

- `src/components/DeadlineCountdown.tsx` / `.css`, `Pitch.tsx` / `.css`, `PitchSkeleton.tsx` / `.css`,
  `PlayerShirt.tsx` / `.css`, `VerdictCard.tsx` / `.css`, `AccuracyCard.tsx` / `.css`
- `src/screens/HomeScreen.tsx`, `ChipsScreen.tsx`, `DecisionHistoryScreen.tsx`, `ReasoningScreen.tsx`,
  `OverrideScreen.tsx`, and their stylesheets
- The matching `*.test.ts` beside any of the above
- `decisions/ticket-<this issue number>.md`

`src/index.css`, `src/components/Surface.tsx` / `.css`, `src/components/AppShell.tsx` / `.css`, the
navigation component added by the foundations ticket, `src/App.tsx` and `index.html` are **not
modified** — they are the system this ticket consumes. Nothing under `src/lib/`, `scripts/`,
`supabase/`, `docs/` or `.github/` changes. No dependency is added, removed or upgraded. No build
configuration changes.
