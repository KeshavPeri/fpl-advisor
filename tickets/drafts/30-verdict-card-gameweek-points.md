## Context

A correctness fix on the verdict card, found by looking at the running app on 19 Aug 2026.

The card renders:

```
Projected points
280
```

**280 is the projected total across the whole five-gameweek solver horizon, not this gameweek.** A
normal FPL gameweek score is around 50–60, and the same solve reported roughly 58 a gameweek. The
number is correct; the label is wrong, and wrong in the way that matters — a card whose headline is
*this week's transfer*, showing a figure called "Projected points" with no period attached, reads as
this week's score.

**This is a specification defect, not a build defect.** Ticket #61's Notes said "the one important
number is the net projected points" and never said over what period. `VerdictCard.tsx` renders
`view.netPoints`, which `deriveVerdictView` takes from `recommendations.net_points_rounded` — a
horizon total, correctly stored and correctly read.

`product-brief.md` §8 bans decimals on projected points because "the gap between the top three
transfer options is routinely under one point… rendering '4.2 versus 4.0' manufactures false
confidence." A figure five times larger than the reader expects fails the same test from the other
direction.

**Second, smaller defect on the same card.** The captain line renders:

```
Captain Guéhi. Vice-captain Bruno G..
```

A doubled full stop, because `web_name` is already `Bruno G.` and the sentence template appends
another.

Depends on item 17 (`src/lib/verdict/`, `src/components/VerdictCard.tsx`) and item 12
(`solver_picks`) — both merged.

## Scope

**In scope:**

- **Show this gameweek's projected points as the card's primary figure**, derived from
  `solver_picks` for the recommendation's own gameweek and solution: the sum of `expected_points`
  across the starting XI, with the captain counted twice.
- Read the extra rows in `src/lib/verdict/api.ts`; do the arithmetic in a pure, tested function in
  `src/lib/verdict/derive.ts`.
- Label the figure so its period is unambiguous.
- Handle the case where those rows cannot be found, without blanking the card.
- **Fix the doubled full stop** in the captain line.
- Vitest tests for every rule below.

**Explicitly out of scope:**

- **No new database column and no migration.** Everything needed is already stored. `solver_picks`
  carries per-player, per-gameweek expected points; `recommendations` carries the `solution_index`
  and `gameweek_id` that identify which rows belong to Plan A.
- **No change to `scripts/generate-recommendations.ts`, `scripts/build-solver-input.ts`,
  `scripts/store-solver-output.ts` or anything else under `scripts/`.** Another ticket in this batch
  may own the recommendation scripts.
- **No change to `src/lib/recommendation/`.** The verdict feature deliberately keeps its own local
  types (see `src/lib/verdict/types.ts`'s header) and that separation stays.
- **No change to the horizon total's storage or meaning.** `net_points_rounded` and
  `gross_points_rounded` remain what they are; this ticket changes what the card shows, not what is
  stored.
- **No Plan B or Plan C rendering, no reasoning screen, no commit action, no link out.** Items 19,
  21.
- **No change to the pitch, the countdown, `AppShell`, `Surface` or `src/index.css`.**
- **No change to the confidence band, the coverage note, the hit-cost display or the stale-recommendation
  logic**, beyond whatever the hit figures need to stay consistent with the new primary number (see
  the definition of done).
- No new dependency. No new token in `src/index.css`.

## Definition of done

**Build**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] **No test that passed before this ticket now fails or was deleted.**
- [ ] No new entry in `package.json`.
- [ ] `src/lib/verdict/derive.ts` remains pure — no `@supabase/supabase-js`, no `fetch`, no
      `node:fs`, no React, no `.css`. Verifiable by search.

**The figure**

- [ ] The card's primary number is **this gameweek's projected points** — the sum of
      `solver_picks.expected_points` over rows where the player is in the starting lineup, for the
      recommendation's `gameweek_id` and its `solution_index`, **with the captain's contribution
      counted twice**.
- [ ] There is a named test for the captain doubling: a lineup of eleven players where the captain
      projects 5 returns a total 5 higher than the same lineup with no captain flagged.
- [ ] **Bench players are excluded.** Named test with a fifteen-row set proving the four bench rows
      do not contribute.
- [ ] The figure is rendered as a **whole number**, with no decimal point anywhere in the card's
      output. `product-brief.md` §8. Verifiable by a test asserting the rendered text.
- [ ] **The label states the period unambiguously** — the reader must not have to infer whether the
      number covers one gameweek or several. The gameweek's own name is already available on the
      card's data; use it.
- [ ] If the horizon total is still shown anywhere on the card, it carries its own explicit period
      label and is visually subordinate to the gameweek figure. **`design-reference.md` allows one
      dominant number, not two** — if both cannot be shown without competing, show only the gameweek
      figure and leave the horizon to the reasoning screen.
- [ ] When a hit is recommended, the cost and net still read consistently against whichever figure is
      primary. **A net that subtracts a 4-point hit from a five-gameweek total, displayed beside a
      one-gameweek figure, is exactly the confusion this ticket exists to remove.** Whichever basis is
      chosen, the card states it and the test asserts it.

**Robustness**

- [ ] **Missing or empty `solver_picks` for the recommendation's gameweek and solution does not blank
      the card.** The decision, captain, confidence band and reasons all still render; only the
      figure falls back, and it says plainly that the projected score is unavailable rather than
      showing `0`, `NaN` or an empty space. Named test.
- [ ] The new read is a single additional query, filtered in the database rather than fetching all
      of `solver_picks` and filtering in memory.
- [ ] A stale recommendation still renders as stale, and its figure is derived from **its own**
      gameweek's picks, not the current one. Named test.

**The captain line**

- [ ] `Captain Guéhi. Vice-captain Bruno G.` renders with **exactly one** full stop after each name.
      A `web_name` that already ends in a full stop does not gain a second. Named tests for both
      `Bruno G.` and a name with no trailing stop.
- [ ] The fix is in the pure derivation, not in the component, and does not strip punctuation from
      the middle of a name. Named test with a name containing an internal full stop.

**Design**

- [ ] The figure still renders through the `.num` class — tabular Geist Mono.
- [ ] Every colour, spacing, radius and font value added or changed is a `var(--…)` token. No raw hex
      colour, no `rgb(`/`rgba(` literal, no `px` spacing outside a border width. No new token is added
      to `src/index.css`.
- [ ] The strings `#aa3bff`, `#c084fc`, `#4ade80`, `#f87171`, `Inter`, `system-ui` and
      `-apple-system` appear nowhere in `src/`. No emoji.
- [ ] The decision is still reachable without scrolling at 390px with the countdown above it.
- [ ] **CANNOT VERIFY, expected:** appearance on the installed iPhone PWA.
- [ ] Scope constraint: only files under `src/lib/verdict/`, `src/components/VerdictCard.tsx`,
      `src/components/VerdictCard.css`, their test files, and this ticket's own
      `decisions/ticket-<number>.md` are added or changed. Nothing under `src/lib/recommendation/`,
      `src/lib/notification/`, `src/lib/projection/`, `src/lib/scoring/`, `src/lib/squad/`,
      `src/screens/`, `scripts/`, `supabase/` or `.github/` changes; `src/index.css` gains no new
      token; `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **This gameweek is the right primary figure, and here is the because.** It is the number Keshav can
  check against reality on Saturday evening, it is what the accuracy tracker will eventually score
  against, and it is the period the rest of the card is about — the transfer, the captain and the
  starting XI are all decisions for *this* gameweek. The horizon total is the solver's objective, not
  a human's expectation, and a five-gameweek figure on a one-gameweek card invites exactly the
  misreading that produced this ticket. Tier 3, decided here.
- **Do not fix this by relabelling alone.** "Projected points over the next 5 gameweeks: 280" would be
  honest and would still be the wrong number to lead with — the reader wants to know what Saturday
  looks like. Relabelling is the fallback only if deriving the gameweek figure proves impossible from
  what is stored, and in that case say so rather than quietly shipping the weaker fix.
- **`recommendations` already carries both keys you need.** `gameweek_id` and `solution_index` are on
  the Plan A row, and `solution_index` is deliberately stored alongside `plan_index` — the migration's
  own comment says it exists so "the ranked position and the solver's raw index can never be confused
  for each other." Join on the solver's index, not on `plan_index`.
- **Check what `store-solver-output.ts` actually stored before assuming.** If it kept a
  multiplier-applied contribution column as well as the raw per-player projection, use the raw one and
  apply the captain doubling here — the card should own its own arithmetic and prove it in a test
  rather than trusting a column whose meaning is one step removed.
- **The hit-cost basis is the trap in this ticket.** A −4 hit is a one-off cost against a
  multi-gameweek gain, so gross and net only make sense on the horizon. Showing a one-gameweek
  headline beside a horizon-based net is incoherent. Pick one basis, state it in the copy, and write
  the test for it. If that means the hit block moves below the gameweek figure with its own label,
  that is the correct outcome.
- **`design-reference.md` allows one dominant number.** Reference 2 (Revolut) is a single important
  figure, generously spaced, with a small quiet label, on a surface doing nothing else. Two large
  numbers competing is the failure mode. If both periods must appear, the second is small and quiet.
- **Another ticket may be running in this batch that changes how Plan B and Plan C are generated.** It
  owns `scripts/build-solver-input.ts`, `scripts/generate-recommendations.ts` and
  `src/lib/recommendation/`. This ticket touches none of those and must not start.
- **What a substitute cannot catch.** Tests prove the arithmetic, the fallback and the punctuation
  exactly. They cannot prove the figure looks right at a glance on a phone, and they cannot prove the
  number is *plausible* — that is Keshav's check, and the bar is simple: **it should be somewhere near
  50 to 60, not near 280.**
