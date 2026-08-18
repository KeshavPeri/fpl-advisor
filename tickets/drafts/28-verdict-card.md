## Context

Feature-list item 17 — **the recommendation, on the screen it was designed for.** Depends on item 13
(`recommendations` and `recommendation_reasons`, merged, populated) and item 16 (the pitch, merged
and polished) — plus item 18 (the countdown, merged), which already occupies the slot above it.

`product-brief.md` §1: the home screen, opened on an iPhone on a Thursday evening, is **the one
screen that matters most**, and it shows, in this order — a thin deadline countdown, **the
recommended actions for this gameweek**, and the current squad as a pitch. The first and third exist.
This ticket builds the middle one, and with it the screen the whole app was specified around.

`design-reference.md` names Revolut as the model for a single important number: large, tabular,
generously spaced, with a small quiet label, on a card that does nothing else — and it names this
card explicitly as one of the two places that treatment belongs.

### A second, smaller thing this ticket fixes

`src/screens/HomeScreen.tsx` currently renders **every player with no availability ring**, because
neither `fetchPlayers` nor `fetchExistingSquad` exposes `players.status` or
`chance_of_playing_next_round`. The pitch ticket's Builder reported this honestly in a code comment —
*"a real, reported gap, not a design choice"* — and noted it is one line to change once those fields
are readable. `deriveAvailability` is already written and tested against the real rules.

`design-reference.md` requires injury and suspension rings, so today that requirement silently does
nothing. Fixing it is two fields and one line, and it belongs with the other work on this screen.

## Scope

**In scope:**

- **`src/lib/verdict/api.ts`** — reads the current gameweek's `recommendations` (Plan A) and its
  `recommendation_reasons` from Supabase.
- **`src/components/VerdictCard.tsx`** and its CSS — renders the recommendation.
- Rendered on the home screen **between the countdown and the pitch**.
- Loading, no-recommendation, stale-recommendation and error states.
- **Availability fix:** add `status` and `chanceOfPlayingNextRound` to what `fetchPlayers` returns,
  and feed them to the existing `deriveAvailability` call in `HomeScreen.tsx`.
- Vitest tests for any pure derivation the card needs.

**Explicitly out of scope:**

- **No commit action, no "accept", no tap-to-apply.** Item 19. The card displays; it does not act.
- **No override registration and no decision ledger.** Item 20.
- **No reasoning screen and no navigation to one.** Item 21. Reason lines shown here are the ones
  already stored; there is no "see more" destination yet.
- **No Plan B or Plan C rendering.** Plan A only. The alternatives belong on the reasoning screen,
  and another ticket in this batch is changing how they are generated.
- **No writes of any kind.** This screen only reads.
- **No new database table, no migration, nothing under `supabase/`.**
- **No change to `src/lib/recommendation/`** — another ticket in this batch owns it, and it is pure
  logic with no I/O for this screen to call.
- **No change to `src/lib/notification/`, `scripts/`, or `.github/workflows/`.**
- **No change to the pitch's layout, the countdown, or `src/lib/squad/positions.ts`.** The only
  `src/lib/squad/` change permitted is adding the two availability fields to the players read.
- No new dependency. No chart, no sparkline, no icon pack.
- No light theme, no theme toggle.

## Definition of done

**Build**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] No new entry in `package.json`.
- [ ] **No test that passed before this ticket now fails or was deleted.**

**What the card shows — `product-brief.md` §2 and §8**

- [ ] **The decision is the headline** and is the largest text on the card: the transfer to make, or
      that the transfer is being rolled. Nothing precedes it.
- [ ] **A rolled transfer renders as a confident answer, not an empty state.** `design-reference.md`
      is explicit that "roll your transfer" is a real answer and must read as one. `is_roll` drives
      this — it is never inferred from null columns.
- [ ] The captain and vice-captain are shown.
- [ ] **The confidence band is shown as a word** — clear, marginal or coin-flip — never as a number,
      a percentage, a bar or a meter.
- [ ] **When the band is `coin-flip`, the card says plainly that the top options are too close to
      separate.** §8 requires this in words, not only as a label.
- [ ] **When `hit_cost` is greater than zero, the cost and the net are both shown explicitly**, as
      whole numbers. §6d requires it. When it is zero, no hit language appears at all.
- [ ] **No decimal point appears anywhere in the card's rendered output.** Points come from
      `net_points_rounded` and `gross_points_rounded`, which are already stored rounded precisely so
      the view layer never rounds. Verifiable by a test asserting the rendered text contains no
      decimal in a projected-points position.
- [ ] At least one reason line from `recommendation_reasons` is rendered, in `order_index` order.
- [ ] **A player the model has no history for is flagged in words** on the card, from the stored
      `coverage` column. `product-brief.md` §8's data-coverage rule binds this ticket by name.
- [ ] Every number renders through the `.num` class — tabular Geist Mono.
- [ ] Money is `£8.5m`, one decimal, via `formatMoney`. *(Money is exempt from the no-decimals rule;
      §8's money format requires the decimal. Do not "fix" a price to a whole number.)*

**States**

- [ ] **No recommendation for the current gameweek** renders an invitation, not a shrug — it says the
      recommendation has not been generated yet and what produces it.
- [ ] **A recommendation whose gameweek is older than the current one is labelled stale, with its
      age**, and is never presented as current. `product-brief.md` §6a: "It must never present stale
      recommendations as current."
- [ ] **Loading** renders a placeholder that does not shift the pitch below it when data arrives.
- [ ] **A failed read** says what happened and what to do. The words "Something went wrong", "Oops"
      and "Sorry" appear nowhere in the new files.
- [ ] Every state is reachable in a test or by a documented manual step.

**Availability rings**

- [ ] `fetchPlayers` returns `status` and `chanceOfPlayingNextRound`, and `HomeScreen.tsx` passes them
      to `deriveAvailability` instead of the hardcoded `'a', null`.
- [ ] The hardcoded call `deriveAvailability('a', null)` no longer appears in `src/`. Verifiable by
      search.
- [ ] A player with `status` `i`, `s` or `u` renders a **solid** coral ring; `d`, or a non-null chance
      below 100, renders a **hollow** one; `a` with no chance renders none. `deriveAvailability` is
      **not** modified — it already implements these rules and is tested.
- [ ] The code comment in `HomeScreen.tsx` describing this as an unfixed gap is removed, not left
      contradicting the code.

**Design constraints — grep-checkable**

- [ ] The card is built from the existing `Surface` component. No new panel component is created and
      no `box-shadow` is introduced as an elevation mechanism.
- [ ] Every colour, spacing, radius and font value in the new CSS is a `var(--…)` token. **No raw hex
      colour, no `rgb(`/`rgba(` literal, no `px` spacing outside a border width.** No new token is
      added to `src/index.css`.
- [ ] The recommended action uses `--accent-cyan`; risk language — a hit, a stale recommendation, an
      unavailable player — uses `--accent-coral`. **No green, no yellow, no purple.** The strings
      `#aa3bff`, `#c084fc`, `#4ade80`, `#f87171`, `Inter`, `system-ui` and `-apple-system` appear
      nowhere in `src/`.
- [ ] No emoji, no icon, no "AI" framing — no sparkle, no "AI suggests", no chat bubble.
      `design-reference.md`: it is a model and should present as an instrument.
- [ ] Sentence case, plain verbs, no filler, FPL's own vocabulary.
- [ ] `prefers-reduced-motion` is respected by any transition introduced.
- [ ] The card sits **between** the countdown and the pitch, and **the decision is reachable without
      scrolling** at a 390px-wide viewport with the countdown above it. `design-reference.md` states
      this as a layout requirement.

**Device**

- [ ] Legible and non-overflowing from 320px upward.
- [ ] **CANNOT VERIFY, expected:** appearance on the installed iPhone PWA.
- [ ] Scope constraint: only new files under `src/components/` and `src/lib/verdict/`, changes to
      `src/screens/HomeScreen.tsx`, `src/screens/HomeScreen.css` and `src/lib/squad/api.ts` (and
      `src/lib/squad/types.ts` if the two new fields need a type), their test files, and this
      ticket's own `decisions/ticket-<number>.md` are added or changed. Nothing under
      `src/lib/recommendation/`, `src/lib/notification/`, `src/lib/projection/`, `src/lib/scoring/`,
      `scripts/`, `supabase/` or `.github/` changes; `src/index.css` gains no new token;
      `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **Plan A only, and that is deliberate.** Another ticket in this batch is changing how the
  alternatives are generated, because the first run produced three plans that were the same decision
  described three ways. Rendering Plan B here would be building a view onto something actively being
  reshaped. The band already tells the user when the alternatives are close; that is enough for this
  screen.
- **Read Plan A as `plan_index = 0`.** It is the solver's own best-scoring plan, already ranked.
  Do not re-rank, re-score, or recompute anything — every number this card shows is stored.
- **The rounded columns exist so the view layer never rounds.** `net_points_rounded` and
  `gross_points_rounded` are stored alongside the full-precision values precisely so a UI ticket
  cannot accidentally break the no-decimals rule. Use them, and do not call any rounding function on
  a points value.
- **Money keeps its decimal; points do not.** This is not an inconsistency — `product-brief.md` §8
  sets both rules deliberately. Prices are in-game currency, Tier 3, formatted `£8.5m`. Projected
  points are model output where a decimal manufactures false confidence.
- **The one important number is the net projected points**, and Revolut is the reference for it:
  large, tabular, generously spaced, one small quiet label, on a surface doing nothing else. Resist
  putting a second figure at the same weight — the gross, the hit and the reason lines are supporting
  detail and should read as such.
- **This screen must stay calm.** `design-reference.md` reserves density for the reasoning screen and
  requires the home screen to be readable in under two seconds. If the card needs a fourth element to
  make sense, that element probably belongs on item 21's screen instead.
- **Do not add a link to a reasoning screen that does not exist.** Item 21 builds it. A dead link is
  worse than none.
- **The availability fix is two fields and one line.** `deriveAvailability` is already written and
  already tested against the real status rules — **do not reimplement or modify it**. The work is
  exposing `status` and `chance_of_playing_next_round` through the players read and passing them in.
  If the existing read shape makes that awkward, extend it rather than adding a second query.
- **Two other tickets are running in this batch.** One owns `src/lib/notification/` and
  `scripts/send-telegram.ts`; the other owns `src/lib/recommendation/`,
  `scripts/build-solver-input.ts` and `scripts/generate-recommendations.ts`. Neither touches
  `src/components/`, `src/screens/` or `src/lib/squad/`. Stay inside the scope list and none of the
  three can collide.
- **What a substitute cannot catch.** A build at 320px and 390px proves layout, the no-decimals rule,
  the state coverage and the ring logic. It cannot prove the card reads as calm and decisive on a
  real phone at 11pm on a Thursday — which is the entire creative premise and the only test that
  finally matters. That one is Keshav's, in a private tab, because the PWA service worker caches CSS
  on iOS and a correct change can look absent.
