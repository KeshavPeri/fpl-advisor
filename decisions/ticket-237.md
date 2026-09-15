# Ticket #237 — The bonus allocator is too flat — sharpen the share

## HIGH-IMPACT

- **`ALPHA` shipped as a placeholder value of 1 (a no-op) rather than a fitted
  value.** The ticket's own methodology requires fitting on gameweek 2's
  row-level `player_projections`/`gameweek_live_stats` data (n=616) and
  evaluating on gameweek 3 held out (n=652). This environment has no
  Supabase credentials at all (confirmed independently across all three
  tickets in this run, matching the precedent in `decisions/ticket-229.md`),
  so no row-level data is reachable from this session. **Chose to ship the
  sharpening mechanism fully implemented and tested, with `ALPHA` left at its
  no-op value**, rather than fabricate a fitted number — the ticket explicitly
  warns against exactly that ("without fooling ourselves"). The Builder
  additionally derived and documented a scale-invariance shortcut in
  `bonus.ts`'s `ALPHA` doc comment: because gameweeks 2 and 3 have zero
  clamped player-fixtures at ALPHA=1, every stored `bonusPoints` value is
  already exactly proportional to that player's excess, so the real fit and
  the real falsification gate can both be computed in one read-only session
  with no code change. **The sharpened allocator has not been deployed to
  production by this ticket** — it has been made deployable in one line.

- **Inferred a per-fixture "clamped" flag from `bonusPoints` hitting the cap
  exactly (`>= MAX_BONUS_POINTS_PER_PLAYER_FIXTURE - 1e-9`), instead of adding
  a new stored clamped flag to `project-points.ts`'s `components` shape.**
  Chose inference because the ticket explicitly says to stop and report if
  `allocateFixtureBonus`'s call site must change, and ticket #235 in this same
  batch also touches `project-points.ts` — adding a schema field there would
  have widened scope into a file this ticket lists as out of scope. This is a
  data-structure decision (Tier 2 test: would be expensive to reverse once
  another consumer starts reading a differently-shaped clamped flag) but is
  accurate for GW2/GW3 specifically, since neither gameweek contains a
  double-gameweek fixture pairing that would make the inference ambiguous.

- **Per-fixture bonus totals reconstructed via `components.fixtures[].fixtureId`
  (already stored, previously unused by the validation report), with
  blank-gameweek and double-gameweek rows excluded from the per-fixture
  reconstruction and counted separately.** Chose this over changing what
  `project-points.ts` stores, for the same call-site-stability reason above.
  Follows the existing `docs/projection-model-backlog.md` G10 convention
  ("count both, report both, fix neither") for multi-fixture rows, since a
  double-gameweek's summed `bonusPoints` genuinely cannot be split back into
  its two legs without re-deriving each one.

## ROUTINE

- `TOTAL_BONUS_POINTS_PER_FIXTURE` and `MAX_BONUS_POINTS_PER_PLAYER_FIXTURE`
  exported from `bonus.ts` (previously module-private) so
  `bonus-validation-report.ts` references the real constants rather than
  retyping the literal `3.0`.
- Used backlog entry number **G20** for the new entry, not G14 — G14 is
  already in use by ticket #197's oracle-ceiling diagnosis, and the backlog
  has several duplicated G-numbers from parallel batches. Cross-referenced
  correctly from `bonus.ts`'s doc comment.

## Falsification gate — NOT YET EVALUATED

`scripts/bonus-validation-report.ts` now reports the clamped player-fixture
count and the mean per-fixture allocated total, and all five named DoD tests
pass against constructed data. But **the actual before/after comparison on
gameweek 3 has not been run**: this session has no Supabase credentials, so
the gate's three conditions (top-20 mean signed error < 0.033 on GW3;
all-players mean signed error stays within 0.020; clamped count and mean
per-fixture total reported, with the latter not falling below 5.70) are
unevaluated. The "before" figures are reproduced verbatim from the ticket
(GW3 top-20 signed error +0.066, GW3 all-players +0.006, 0 clamped, 6.00
mean per-fixture — all at ALPHA=1). **No "after" figures exist because ALPHA
is still 1** — sharpening is implemented but dormant.

Per the ticket's own text — "Stop and report — do not merge — unless all
three hold" — **this PR must not be merged until someone with production
Supabase credentials**: (1) runs the fit-on-GW2/evaluate-on-GW3 procedure
documented in `bonus.ts`'s `ALPHA` doc comment (the scale-invariance
shortcut means this needs no new query shape), (2) sets `ALPHA` to the
fitted value, and (3) re-runs `scripts/bonus-validation-report.ts` on GW3 to
confirm the three gate conditions. This is flagged in the PR body.
