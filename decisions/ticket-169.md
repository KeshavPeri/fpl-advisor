# Ticket #169 — Apply the design system to every screen

## HIGH-IMPACT

- **Deleted the home screen's wordmark header and its "Decisions →" / "Chips →" link row
  outright (F38), because both destinations now live in the persistent `AppBar` the foundations
  ticket built, and the wordmark spent the highest-value real estate on the screen — the very
  top — on zero information in a single-user app.** `DeadlineCountdown`'s gameweek name is now
  the app's first `<h1>`, so the screen still opens with a heading; it's just one that carries
  information instead of a logo. This is Tier 2 because it changes what the home screen *is* —
  its top-of-screen identity — not merely how it's styled.

## ROUTINE

- **F23's zero-padding fix was implemented as a component-local, module-private formatter
  inside `DeadlineCountdown.tsx`, not in `src/lib/deadlineCountdown.ts`.** The scope constraint
  forbids touching `src/lib/`, but F23 is a formatting defect (`formatRemaining` doesn't
  zero-pad, so the countdown's character count jitters). The fix operates on the same pure
  `RemainingTime` fields the lib function already returns, purely as a presentation-layer
  re-formatting step, leaving the lib file and its existing tests untouched. Flagged rather than
  silently worked around.
- **Shirt size tokens (F26: 56px/40px) composed via `calc()` from existing `--space-*` tokens**
  (`calc(var(--space-12) + var(--space-2))` etc.), rather than defining a new spacing token in
  `index.css` (out of scope) or hand-typing a pixel value. Mirrors the pattern the foundations
  ticket already uses in `AppShell.css`'s `.bleed`.
- **PlayerShirt's player-name font-size left at 11px**, not bumped to 13px as F26 suggested it
  "could move back to" — that needs empirical re-verification against real long `web_names` at
  the new shirt width, and no browser/device harness was available to check it. Left as-is and
  flagged rather than guessed.
- **`AccuracyCard` given a `variant` prop** (`summary` on the home screen, `full` on the
  reasoning screen), each mount owning its own fetch — matches this app's established
  every-card-owns-its-own-read convention rather than threading data through a shared parent.
- **F37's copy fix was partial.** The figure label, sample-size copy, and both "too small"
  strings were rewritten in the component. The bias sentence was recomposed from
  `AccuracyView`'s raw `biasWord`/`meanSignedError` fields to match the audit's shorter proposed
  copy. The empty-state message was left unchanged — it is a single canned string from
  `src/lib/accuracy/derive.ts` with no structured fields behind it, and fixing it would mean
  editing `src/lib/`, out of scope for this ticket.
- **Skeleton-pulse `@keyframes` (six near-duplicate blocks, ~1.6s duration) were left
  un-tokenized.** No `--dur-*` token in the system matches their duration, and consolidating them
  is a distinct should-fix item in the audit that wasn't attempted here. Read the DoD's "no
  hand-typed duration...in any file this ticket touches" as governing motion this ticket adds or
  changes, not as retroactively tokenizing untouched, unmatched pre-existing values.

## Should-fix findings not reached

- **M2 (screen transitions)** — its natural home is `App.tsx` / `AppShell.tsx`, both explicitly
  out of this ticket's scope. Not worked around by duplicating a transition animation across the
  five screen files instead.

## Scope contradiction reported, not worked around

- **F48's DoD item ("no `<input>` or `<select>` in the app renders below 16px") cannot be
  fully satisfied by this ticket.** `OverrideScreen.css`'s input is fixed. `SquadEntryScreen.css`
  has the identical defect on an identical class name, but `SquadEntryScreen.tsx/.css` are not
  in this ticket's allowed-file list. **An app-wide grep for this check will still fail** until a
  ticket scoped to that file fixes it. Recorded here rather than silently expanding this ticket's
  scope to cover it.

## CANNOT VERIFY — device judgements for Keshav (audit Part 4)

These require a physical device and are not decisions; recorded here per the ticket's own DoD so
they aren't lost between the Builder's report and QA:

1. F48 — whether iOS Safari actually stops auto-zooming on these forms, and doesn't zoom back out.
2. F13/F17 — whether the floating bar's blur reads as material or fog on a real device.
3. F13 — whether the fixed blurred bar holds 60fps scrolling over the pitch.
4. F17 — bar position against the home indicator, in Safari and installed-to-home-screen.
5. F25/F26 — whether the full-bleed pitch at 344px/393px reads as generous or merely adequate.
6. F2/F29 — contrast values (including the F29 badge-recess/shirt-lift rework) in a real
   low-light viewing scene.
7. F23 — how distracting the now-fixed-width countdown reflow is at 48px, at arm's length.
8. F21/F22 — whether 48px→56px reads as escalation at phone viewing distance.
