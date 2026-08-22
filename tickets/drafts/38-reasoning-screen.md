## Context

**Feature-list item 21. The app cannot currently explain itself.** The only way to see why a
recommendation was made is a SQL query against `player_projections.components`. The verdict card
shows a decision and a single number; everything behind it is invisible.

`design-reference.md` commits to this explicitly — *"Reasoning lives on its own screen, with a
one-line summary on the verdict card so a bare number is never the whole story"* — and names the
reasoning screen as **the one place in this app where information density is correct**, against the
Linear reference. Everywhere else stays calm; here, density is the point.

`product-brief.md` §8's data-coverage rule binds this ticket by name: *"The reasoning screen must
state the coverage — how much history the estimate is built on — alongside the numbers, not instead
of them."*

Depends on item 13 (`recommendations` / `recommendation_reasons`, merged) and item 17 (the verdict
card, merged, corrected by #68 and #72). Nothing unmerged.

### Two things this screen must carry that nothing else does

**1. The horizon total.** Ticket #68 correctly changed the verdict card's primary figure to *this
gameweek's* projected points, because a five-gameweek total labelled as one gameweek was a real bug.
The horizon total is still a real and useful number — `recommendations.gross_points` /
`net_points` are horizon-wide, and a hit is judged across the horizon, not one week. It has had
nowhere to live since #68. **It lives here**, explicitly labelled with the number of gameweeks it
covers.

**2. A confidence signal on the captain choice.** `product-brief.md` §8 requires the *transfer*
decision to state when the top options are statistically indistinguishable. **That was never
extended to captaincy, and captaincy is where it bit.** The GW1 recommendation captained on a
0.20-point gap over the next-best option — B. Fernandes 5.79 against Haaland 5.59, verified
arithmetically exact and recorded in the G3 addendum of `docs/projection-model-backlog.md`. A
coin-flip was presented as a decision. Same failure the brief already forbids elsewhere; the fix is
the same mechanism, applied to the captain.

## Scope

**In scope:**

- **A new route and screen** — `/reasoning`, rendered by a new `src/screens/ReasoningScreen.tsx`,
  registered in `src/App.tsx` alongside the existing `/` and `/squad` routes.
- **A link to it from the verdict card**, per `design-reference.md`'s "one-line summary on the
  verdict card". The card keeps its existing one-line headline and gains a way through to the full
  reasoning; nothing else about the card changes.
- **A new `src/lib/reasoning/` module** following the established `src/lib/verdict/` shape exactly —
  `api.ts` (Supabase reads, resolves player names), `derive.ts` (pure, all display logic),
  `types.ts`. **`derive.ts` must be pure and directly unit-testable**, and the screen component must
  do no derivation of its own, exactly as `VerdictCard` / `deriveVerdictView` already do.
- **The screen renders, for Plan A of the most recent recommendation:**
  - **Every** stored reason line from `recommendation_reasons`, in `order_index` order. The verdict
    card shows only line 0; this screen shows all of them.
  - **The horizon total**, labelled with the number of gameweeks it covers, read from
    `solver_runs.horizon` for the recommendation's own `solver_run_id` — never a hardcoded 5.
  - **The hit**, when there is one: cost, gross and net, stated as horizon figures.
  - **A per-player component breakdown** for the players the recommendation turns on — the transfer
    in, the transfer out, the captain and the vice-captain — read from
    `player_projections.components.points`: appearance, goals, assists, clean sheet, goals conceded,
    saves, defensive contribution, bonus. **This is the one screen where raw numbers with decimals
    are permitted** (`product-brief.md` §8: *"Raw numbers may appear on the reasoning screen, where
    the context makes them honest"*), and the breakdown must be rendered from whatever the stored
    components actually contain rather than from a hardcoded list of which components exist.
  - **The data coverage**, per `product-brief.md` §8: for each of those players, whether the
    projection rests on real Premier League history or on a position prior, and how much history —
    read from `recommendations.coverage` and `player_projections.components.playerLevel`.
  - **The confidence band** already stored on the recommendation, and its meaning in words.
  - **The model version** (`player_projections.model_version`) and when the projection was computed.
- **A captain confidence band**, derived in `src/lib/reasoning/derive.ts` from the gap between the
  chosen captain's projected points and the next-highest projected starter in the same
  recommendation's starting XI. Thresholds are pre-answered in Notes. When the band is `coin-flip`,
  **the screen must say in words that the two options cannot be separated**, in the same register
  §8 already requires for the transfer decision.
- **A graceful, specific empty state** when no recommendation exists, per
  `design-reference.md`'s interface-writing rules — not a spinner that never resolves and not
  "Something went wrong".

**Explicitly out of scope:**

- **No change to the projection model, the solver, any `scripts/*.ts` job, or any database
  migration.** This is a read-only display ticket. It adds no column and stores nothing.
- **No commit action, no override registration, no accept button.** Those are items 19 and 20.
- **No Plan B or Plan C rendering.** Plan A only (`plan_index = 0`), matching the verdict card's
  existing scope.
- **No rolling accuracy figure.** That is item 24 and reads a different table.
- **No hardcoded statement of which point components the model does or does not include.** Render
  what is stored. A bonus figure of zero shows as zero today and as a real number the moment the
  bonus-projection ticket lands, with no edit to this screen — **this is deliberate, and it is why
  this ticket can run in the same batch as that one.**
- **No change to `src/lib/verdict/`.** The verdict card gains a link and nothing else.
- No new dependency, no charting library, no icon set.

## Definition of done

- [ ] `/reasoning` renders as a route in `src/App.tsx` and is reachable by tapping through from the
      verdict card on the home screen.
- [ ] `src/lib/reasoning/derive.ts` is pure: the strings `supabase`, `fetch` and `useEffect` appear
      nowhere in it. All Supabase access lives in `src/lib/reasoning/api.ts`.
- [ ] The screen renders **every** `recommendation_reasons` row in `order_index` order — asserted by
      a unit test on `derive.ts` with at least four reason lines.
- [ ] The horizon total is labelled with the gameweek count taken from `solver_runs.horizon`.
      Grep-checkable: no integer literal `5` is used as a horizon anywhere in
      `src/lib/reasoning/`.
- [ ] The per-player component breakdown is built by iterating the stored `components.points`
      object, not from a hardcoded list of component names — asserted by a unit test that adds an
      unknown component key and confirms it still renders.
- [ ] Coverage is stated in words for every player shown, and a player with no Premier League
      history is described as such rather than shown with a bare number.
- [ ] **Captain confidence:** `derive.ts` exports a function returning `clear` / `marginal` /
      `coin-flip` from the captain's gap over the next-best starter, using the thresholds in Notes.
      Unit tests cover a gap of `0.20` (→ `coin-flip`), `0.9` (→ `marginal`), `2.4` (→ `clear`), and
      the boundary values `0.5` and `1.5` exactly.
- [ ] A `coin-flip` captain band renders a sentence saying the two options cannot be separated, and
      names the alternative player. Asserted by a unit test.
- [ ] **No projected-points value on this screen is presented without its context.** Decimals are
      permitted here and only here; the verdict card and every other surface still show whole
      numbers. Grep-checkable: `toFixed` appears nowhere under `src/components/` or
      `src/screens/HomeScreen.tsx` as a result of this ticket.
- [ ] `design-reference.md` compliance, all grep- or eye-checkable: Geist and Geist Mono only, no
      Inter; every number in Geist Mono and tabular; translucent layered surfaces via the existing
      `Surface` component, not flat cards with 1px borders; no green, no yellow, no purple; no emoji;
      no "AI" framing.
- [ ] The empty state is a specific sentence naming what is missing and what to do, not a generic
      error. Asserted by a unit test on the derived view.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** nothing here verifies the screen on a phone. Density is
      the one design property this screen is judged on and it cannot be asserted from code. The
      human check is Keshav opening the PR preview URL on the iPhone PWA and confirming the screen
      is readable at a glance and does not scroll horizontally.

## Notes for the Analyst / Builder

**The captain confidence thresholds, pre-answered with their *because*.** A gap of **less than 0.5
points is `coin-flip`**, **0.5 to 1.5 is `marginal`**, and **above 1.5 is `clear`**.
**Because** `product-brief.md` §8 states that gaps of under one point are "routinely under one
point, well inside the model's own error" — so a gap must clearly exceed one point before it can
honestly be called a decision, and a gap of a fraction of a point is not a preference, it is noise.
The GW1 case that motivated this ticket was 0.20. If a Builder hits a case these numbers do not
obviously cover, reason from that sentence rather than from the numbers.

**Compare against the next-best *starter*, not the next-best player in the squad.** A captain can
only be chosen from the eleven who start, so the gap that matters is against the best alternative
captain. Use the same starting-XI filter the verdict card already applies — `is_lineup = true`, for
the recommendation's own `gameweek_id`, `solution_index` **and `solver_run_id`**.

**`solver_picks` accumulates rows across solver runs — filter by run or every figure doubles.**
Two runs for one gameweek coexist by design. `recommendations.solver_run_id` points at the right
one. This exact bug shipped once already (ticket #72) and produced a projected score of about 101
for a single gameweek. `src/lib/verdict/api.ts` already does this correctly — read it before writing
the query.

**Every Supabase read must paginate.** `player_projections` holds roughly 600 rows per gameweek and
Supabase silently caps a query at 1,000 with no error and no flag. Use the shared helper at
`scripts/lib/paginate.ts`'s convention — or, since this is browser-side, the equivalent explicit
range-and-assert pattern `src/lib/verdict/api.ts` already establishes. A truncated read is
indistinguishable from missing data at the call site.

**This ticket qualifies for the `frontend-design` skill** under `CLAUDE.md`'s design-pass rule — it
establishes a genuinely new surface with its own register. It must nonetheless reuse the existing
design tokens, the `Surface` component and the established type scale; a new surface is not a new
design system. **Impeccable and emil-design-eng are NOT invoked** — this is not a polish ticket.

**Read `design-reference.md`'s "three looks AI design currently defaults to" before writing any
CSS.** A dark page with flat cards and one bright accent is the default, not this brief, and is a
stated reason to reject the work. The differentiator is translucent layered material.

**A denser screen still obeys the writing rules.** Sentence case, plain verbs, no filler, FPL's own
vocabulary. Errors say what happened and what to do.

## Scope constraint

Nothing outside the following files changes:

- `src/App.tsx`
- `src/screens/ReasoningScreen.tsx` (new), `src/screens/ReasoningScreen.css` (new)
- `src/lib/reasoning/api.ts` (new), `src/lib/reasoning/derive.ts` (new),
  `src/lib/reasoning/types.ts` (new), `src/lib/reasoning/derive.test.ts` (new)
- `src/components/VerdictCard.tsx`, `src/components/VerdictCard.css` (the link through only)
- `decisions/ticket-<this issue number>.md`

No migration file is added. No workflow file is touched. No file under `scripts/` changes, and
nothing under `src/lib/verdict/`, `src/lib/projection/` or `src/lib/scoring/` is modified.
