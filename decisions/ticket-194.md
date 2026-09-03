# Ticket #194 — UI polish round two

## HIGH-IMPACT

None. Nothing in this ticket's build failed the "expensive to reverse after ten more
tickets" test — every decision below was a design/convention choice within a design-pass
ticket, not a structural or data one.

## ROUTINE

- **Shared `--nav-bar-reserve` token** (7rem, `src/index.css`) replaces two independently
  hand-typed bottom-padding constants that had drifted apart (`4rem` in
  `AppShell.css`, `6.5rem` in `AppBar.css`'s scroll scrim). Because a single source of
  truth for "how much room the floating bar needs" was the actual fix for rendering fault
  A3 — two constants meant to agree but weren't kept in sync is exactly how that fault
  happened in the first place.
- **Panel/hero/bar material RGB and blur/saturation values** (`--material-1/2/3`,
  `--material-hero-blur`, `--material-hero-saturate`) were derived numerically to satisfy
  the DoD's strict-inequality constraints (material-2 luminance below its prior value,
  every alpha ≤ 0.55, bar blur/saturation strictly above panels, hero strictly between bar
  and panels) rather than picked by eye, then locked in by assertions in
  `src/index.css.test.ts`.
- **Verdict card confidence line wording** — "Plan confidence: X · Captain confidence: Y"
  — is the Builder's own phrasing; the ticket specified the band must render next to plan
  confidence but not the exact copy.
- **AccuracyCard summary line rewrite** drops the self-labelling "Model accuracy:" prefix
  and folds the bias clause into one sentence, per design-reference's interface-writing
  rule against the app explaining itself.
- **DecisionHistoryScreen demoted summary line** — "N gameweeks this season · N commits, N
  overrides · N with no decision" — is the Builder's own format for the quiet line that
  replaced the four oversized stat numbers (section G).
- **Chips panel headings** — "Chip timing" / "Squad rebuild" — name the two split
  surfaces (section F); not specified verbatim by the ticket.
- **Starting-XI shirt width set to 60px** (from 56px), horizontal gap left unchanged at
  16px — widening the gap further alongside the shirt would have pushed the five-shirt row
  past the retained side margin at 393px; shirt width alone clears the 96%-of-remaining-
  width DoD bound.
- **`.bleed-narrow` retains an 8px margin** (half the column's 16px) as the Builder's own
  reading of "narrow" per the owner's 3 Sep decision to keep a side margin rather than run
  full-bleed (departs from audit F25, corrected in `docs/ui-audit-2026-08-31.md`).

### Animation pass (section H) — accept/reject log

Run against `emil-design-eng` and `apple-design`, cross-checked against the prior #166
audit's own M1–M4/9-rejection analysis (`docs/ui-audit-2026-08-31.md` Part 3) rather than
re-deciding from first principles.

**Accepted:**
- **M2 — screen transitions** (fade + 8px translateY on `.app-shell__column`, `--dur-enter`
  / `--ease-out`, bar structurally excluded as a sibling of `<Routes>` that never
  remounts). Accepted in the prior audit but never shipped; built here. Simplified from
  spec: no forward/back direction mirroring — this app's tab-bar IA has no real push/pop
  stack to key direction off, and threading `useNavigationType` across six screens for a
  distinction that doesn't map onto lateral tab switches wasn't worth the risk. Reduced
  motion covered by the existing global near-zero-duration rule (audit F8), no local
  override needed.
- **Secondary buttons' `:active { scale(0.97) }`** — not a fresh animation decision; matches
  the app's own established press-feedback convention (Commit, AppBar items already do
  this). Gate: does every pressable element acknowledge press? Consistency, not decoration.
- M1 (Commit morph), M3 (ambient wash escalation), M4 (override confirm step) — already
  implemented in prior tickets, verified still present and unchanged.

**Rejected** (gate question that killed each):
- Home circle's route-active state — inherits `.app-bar__item`'s existing transition; no
  bespoke motion needed for the new shape.
- Grain layer motion — seen on every open, every screen, permanently on-frame; any
  animation would be pure decoration with no state to indicate (frequency gate).
- New captain-confidence line — static text, not interactive/toggled; no purpose.
- Verdict-card hero "materialize" on mount — seen every open; the card's material is a
  permanent design decision, not a state change (frequency gate).
- Pitch, bar baseline, list rows, badges — consistent with the prior audit's identical
  rejections; nothing in this ticket changed that reasoning.
- Chips advisory split / remaining-chips headline demotion — static layout changes, no
  runtime state to animate.

Rejections (9) outnumber acceptances (2 new + 1 convention-reuse), consistent with the
ticket's "reject more than you accept" instruction.
