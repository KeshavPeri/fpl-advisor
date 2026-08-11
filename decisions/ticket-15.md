# Decisions — ticket #15

## HIGH-IMPACT
- Chose Vitest as the test runner **because** it shares Vite's existing config and transform
  pipeline, needs no separate build step, and the project already runs Vite 8. (Tier 2,
  pre-approved in the ticket text.)

## ROUTINE
- Used a standalone `vitest.config.ts` rather than reusing `vite.config.ts` because the app's
  Vite config wires in `vite-plugin-pwa` and React, which this pure-computation, no-I/O module
  and its tests don't need — keeping it separate avoids the PWA plugin running during
  `npm run test`. (Tier 3)
- `totalMatchPoints` is a pure aggregator over caller-supplied component values rather than a
  re-derivation of goals/assists/cards/clean-sheet point values, because the brief (§6d) lists
  only defensive contribution, GK saves, BPS and bonus as load-bearing 2026/27 changes — the
  unchanged categories aren't specified in the ticket or brief, so hardcoding them would be the
  training-data guess the ticket explicitly warns against. (Tier 3)
- `allocateBonusPoints` implemented via standard competition ("1224") ranking — one general
  formula (rank = 1 + count of strictly-greater entries; bonus 3/2/1/0 by rank) reproduces all
  four published tie cases exactly, including N-way ties beyond two, without special-casing tie
  sizes. (Tier 3)
- Position codes (1 GK, 2 DEF, 3 MID, 4 FWD) defined locally in `src/lib/scoring/types.ts` per
  the ticket's explicit instruction not to import the reference schema — confirmed no existing
  position schema exists elsewhere in the codebase to conflict with. (Tier 3)
