**Type: polish.** Impeccable and emil-design-eng are allowed. Match the existing visual direction (another
ticket tonight owns the nav, card material and tokens). This screen becomes the **Why** tab.

## Why

Keshav: the reasoning screen is "littered … too much overwhelming text … too much technical jargon which
doesn't make sense to a user. Make it clean and easy to look at and absorb info." Screenshots in
`docs/ui-refs/`: `current-why-top.jpg`, `current-why-player-cards.jpg`, `current-why-alternatives.jpg`,
`current-why-footer-accuracy.jpg`. Full list: `docs/ui-audit-2026-09-25.md` R1–R5 and
"Round 2 → Reasoning". **Target: someone understands the plan and why in 10 seconds.**

## Build

1. **Hero.** One line: "Rogers in · Wirtz out · Captain Haaland". Under it, one confidence badge ("Close
   call" / "Leaning" / "Clear") and one short plain sentence at most. Delete the bullet list that repeats
   the heading (R1) and every repeated "coin-flip".
2. **Headline number with context (R2).** Replace "Projected across 5 gameweeks 362" with something
   meaningful, e.g. "56 pts expected this gameweek" plus a small "vs 55 if you roll the transfer".
   Use data the screen already has. If the comparison isn't available, show only the gameweek figure.
3. **Player cards:** role label, name, team, and "5.6 pts next gameweek". Up to 3 **reason chips in
   plain football language, built from each driver's value**, not its feature name. Put a
   `reasonChip(driver)` in `derive.ts` that returns text or `null`. Examples:
   - `r1_minutes` ≥ 80 → "Played 90 mins last game"
   - `transfers_rank` high → "Managers are buying him", low → "Managers are selling him"
   - `own_pct_rank` high → "Owned by most managers"
   - `value` high → "Premium, nailed starter"
   - `lambda_for` high → "Team expected to score"
   - `p_cs` high → "Good clean-sheet chance"
   - `r5_*`/`p90_*` goal stats high → "Scoring regularly"
   Never show "pushes up / pulls down", feature names, or "gbm-v1". No chip is better than a vague one.
4. **Delete** "X — built on real Premier League match history." everywhere (G4).
5. **"See the numbers"**: the 8-row points breakdown goes behind a per-player disclosure, closed by
   default, with plain labels.
6. **Other options (R3):** "Alternatives considered" becomes a collapsed "Other options" list, one line
   per plan: "Schade instead of Rogers · same points", "Tarkowski instead of Rogers · 1 pt less". Expand
   for details. No duplicated transfer sentence.
7. **Footer bug.** "Model: baseline-v1 · Computed 11:35" is wrong. `derive.ts` (line ~676) takes the model
   and time from the first projection row. Show the recommendation's own solve time only, as
   "Updated Fri 25 Sep, 11:41". No model name.
8. **Remove `<AccuracyCard variant="full" />` from this screen** (R5). Home keeps accuracy. Do not edit
   `AccuracyCard` itself.
9. No "MAE", "projection", "explainable model", "solutions", model names or ALL-CAPS label soup on this
   screen. Sentence case labels.

## Definition of done — offline only

- `npm run build`, `npm run lint`, `npm test` clean.
- `derive.test.ts`: `reasonChip` for each example above plus an unknown feature (→ null); max 3 chips;
  the footer uses the recommendation's time, not a projection's; the hero line for transfer + captain and
  for a rolled transfer; the one-line "Other options" text for 0 and −1 point gaps.
- PR packet: before/after screenshots at 390 px. The whole top section (hero + first player card) fits
  in one phone screen.

## Post-merge owner check (does not block this PR)

Keshav reads the Why tab on his phone. **Not a gate.**

## Files

Edit: `src/screens/ReasoningScreen.tsx` + `.css`, `src/lib/reasoning/derive.ts` + `derive.test.ts`,
`src/lib/reasoning/types.ts`, `src/lib/reasoning/api.ts` (only if the recommendation's solve time isn't
already read). **Not** `AccuracyCard*`, `Surface*`, `AppShell*`, `AppBar*`, `NavIcons.tsx`, `index.css`,
or anything on Home.
