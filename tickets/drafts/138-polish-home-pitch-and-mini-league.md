**Type: polish.** Impeccable and emil-design-eng are allowed. Match the existing visual direction. Don't
invent a new one (another ticket tonight owns the nav, the card material and the tokens).

## Why

Keshav's review of Home (`docs/ui-audit-2026-09-25.md`, items H1–H5 and "Round 2 → Mini-league").
Screenshots in `docs/ui-refs/`: `current-home-bench-accuracy-minileague.jpg`, `current-home-verdict.jpg`.
His words: bench players "too small, make them same size as main team". The accuracy sentence is a
"random line" that needs "a tile, and be intentional". The mini-league card is "very bad and super
unsatisfying. Make it satisfying yet premium".

## Build

1. **Bench same size as the starting XI.** Drop the `bench` size in `PlayerShirt`, or make it equal to
   `starting`, prices included. The bench row still reads as the bench through the "Bench" label and
   spacing. It still fits a 375 px wide screen without horizontal scroll.
2. **Team colours on shirts.** Today every shirt is the same dark placeholder (H3). Add
   `src/lib/teamColours.ts`: primary and secondary colour per club, keyed on team `short_name`, for the
   20 clubs in `public.teams` this season. `fetchPlayers` already returns `teams(short_name)`. Pass it
   through `PitchPlayer` and colour the shirt body and trim. Fall back to today's neutral shirt for an
   unknown club.
3. **Orange ring (H4).** It shows a doubtful player. Add a tiny legend or a status dot with an accessible
   label, so it isn't a mystery.
4. **Verdict card (H5).** Say the confidence once: one badge ("Close call" for coin-flip, "Clear" /
   "Leaning" for the other bands). Delete the repeated sentence.
5. **Accuracy becomes a titled tile (H1).** `AccuracyCard variant="summary"` becomes a small tile titled
   "Prediction accuracy" with one big figure and one plain line. No stray sentence. Keep its props and
   export unchanged (the Why screen ticket stops using it).
6. **Mini-league redesign:**
   - Hero: your rank, large, with a movement chip (▲2 / ▼1 / –).
   - Points count up on first view (reduced-motion: static).
   - A gap bar: points to the place above, or your lead over 2nd when you're 1st ("Leading by 26").
   - Rows: top 3, plus you ±1 if you're outside them, with a divider for skipped ranks. Team name
     prominent, manager name small, your row glowing.
   - Leading gets one subtle premium moment (a crown glyph or glow). No confetti.
   - Update `src/lib/miniLeague/derive.ts` to return exactly these rows and gaps.

## Definition of done — offline only

- `npm run build`, `npm run lint`, `npm test` clean.
- Tests: `derive` rows for you at 1st, 2nd, 10th of 21 (top 3 + you ±1, no duplicates), lead/gap
  numbers; `teamColours` covers every `short_name` in the fixture list and falls back for an unknown one;
  bench and starting shirts render at the same size (`Pitch.layout.test.ts`).
- PR packet: before/after screenshots of Home at 390 px.

## Post-merge owner check (does not block this PR)

Keshav looks at Home on his phone. **Not a gate.**

## Files

Edit: `src/screens/HomeScreen.tsx` + `.css`, `src/components/Pitch.tsx` + `.css` + `Pitch.layout.test.ts`,
`src/components/pitchLayout.ts` + `pitchLayout.test.ts`, `src/components/PlayerShirt.tsx` + `.css` +
`PlayerShirt.truncation.test.ts`, `src/components/pitchAvailability.ts` + test, `src/components/VerdictCard.tsx`
+ `.css` + `VerdictCard.test.ts`, `src/components/AccuracyCard.tsx` + `.css`, `src/components/MiniLeagueCard.tsx`
+ `.css`, `src/lib/miniLeague/derive.ts` + `derive.test.ts`, `src/lib/miniLeague/types.ts`. New:
`src/lib/teamColours.ts` + `teamColours.test.ts`. **Not** `Surface*`, `AppShell*`, `AppBar*`,
`index.css`, or anything reasoning.
