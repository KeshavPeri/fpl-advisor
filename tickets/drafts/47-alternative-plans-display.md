## Context

**`product-brief.md` §6c names Plan A / Plan B / Plan C as a core requirement**, and it is the
stated reason the solver was adopted rather than built: *"alternative-solution generation via
`iteration` / `iteration_criteria`, which is exactly the Plan A / Plan B / Plan C requirement."*

**The plans are being generated and stored, and the app has never shown any of them but the first.**
`buildSolverConfig` sets `num_iterations: 3`. `scripts/generate-recommendations.ts` stores up to
three rows per gameweek at `plan_index` 0, 1 and 2, collapses any that are not genuinely distinct
decisions (#60, `src/lib/recommendation/distinctness.ts`), and deletes stale indices. And both
readers hard-filter to the first one:

```
src/lib/verdict/api.ts:101      .eq('plan_index', 0)
src/lib/reasoning/api.ts:102    .eq('plan_index', 0)
```

Plans B and C exist in `public.recommendations` right now, with their own reasons in
`recommendation_reasons`, and nothing in the interface has ever read them.

### Why they belong on the reasoning screen and not the verdict card

`design-reference.md` is explicit: the home screen stays calm, one decision, *"the recommendation is
the loudest thing on the screen"*; and **the reasoning screen is "the one place in this app where
density is correct."** Three plans on the home screen would turn a decision into a menu, which is
the failure mode the whole design guards against. The verdict card keeps showing Plan A alone.

This also completes something the alternatives were built for: `product-brief.md` §8 requires the
app to say plainly **when the top options are statistically indistinguishable**. With only Plan A
visible, a `coin-flip` confidence band names a closeness the reader cannot see. Showing B and C is
what makes that band legible.

Depends on item 13 (merged, #47, refined by #60) and item 21, the reasoning screen (merged, #79).
Nothing unmerged.

## Scope

**In scope:**

- **`src/lib/reasoning/api.ts` reads every stored plan** for the recommendation's gameweek —
  `plan_index` 0, 1 and 2 — with their `recommendation_reasons`, instead of filtering to 0.
- **`src/lib/reasoning/derive.ts` derives an alternatives view**: for each plan beyond A, the
  transfer (or roll), the captain, the confidence band, the hit cost if any, and **how it differs
  from Plan A** — the difference is the point, not the plan in isolation.
- **The reasoning screen renders the alternatives** below Plan A's reasoning, clearly subordinate to
  it. Plan A remains the recommendation; B and C are context for it.
- **The gap between plans is stated.** For each alternative, the difference in projected points
  against Plan A, over the horizon, using the figures already stored on `recommendations`.
- **When fewer than three distinct plans exist, the screen says so plainly** and does not pad. #60
  collapses non-distinct plans deliberately, and a run that produced one plan is a confident answer,
  not a broken one — `design-reference.md`'s interface-writing rule: *"The week where the
  recommendation is 'roll your transfer' is not an empty state — it is a real answer and should read
  as a confident one."*
- **When Plan A's confidence band is `coin-flip`, the alternatives section says explicitly that the
  top options cannot be separated**, and names them. This is the §8 requirement this ticket makes
  legible.

**Explicitly out of scope:**

- **No change to the verdict card or the home screen.** Plan A only there, unchanged.
  `src/lib/verdict/` is not modified.
- **No committing or overriding an alternative plan.** The commit control writes `plan_index = 0`
  and continues to; committing Plan B is a real feature and a separate ticket, and its unique index
  already permits it.
- **No change to how plans are generated, collapsed, ranked or stored.** Nothing under `scripts/`,
  no change to `src/lib/recommendation/`.
- **No migration, nothing under `supabase/`.** All three plans are already stored.
- **No decimal projected-points figures outside the reasoning screen.** Raw numbers are permitted
  here and only here (`product-brief.md` §8).
- No new npm dependency, no charts.

## Definition of done

- [ ] `src/lib/reasoning/api.ts` no longer filters to `plan_index = 0` for the plans read, and
      returns plans ordered by `plan_index` ascending with each plan's own reasons in
      `order_index` order. Grep-checkable: `.eq('plan_index', 0)` no longer appears in that file.
- [ ] `src/lib/reasoning/derive.ts` stays pure: the strings `supabase`, `fetch` and `useEffect`
      appear nowhere in it.
- [ ] Plan A's existing rendering is unchanged — every existing `derive.test.ts` assertion about it
      still passes without modification. **If an existing test needs changing, that is a signal the
      ticket has gone too far.**
- [ ] Each alternative states how it differs from Plan A in words: the transfer, the captain, or
      both. Named unit test for a plan differing in captain only, transfer only, and both.
- [ ] Each alternative states its horizon points gap against Plan A, computed from the stored
      figures. Named test.
- [ ] With only one stored plan, the screen states that no distinct alternative was found and reads
      as a confident answer. Named test asserting the wording contains no apology and no error
      framing.
- [ ] With Plan A at `coin-flip`, the alternatives section states that the top options cannot be
      separated and names the alternative. Named test.
- [ ] A plan whose `recommendation_reasons` are missing renders the plan without its reasons rather
      than dropping the plan or erroring. Named test. *(Reasons cascade on delete; a plan with no
      reason rows is possible and is not a failure.)*
- [ ] Every Supabase read paginates, per `src/lib/verdict/api.ts`'s convention.
- [ ] `design-reference.md` compliance: alternatives are visually subordinate to Plan A; Geist and
      Geist Mono with tabular figures; translucent layered surfaces via the existing `Surface`
      component; no green, no yellow, no purple; no emoji; sentence case, plain verbs.
- [ ] Nothing under `scripts/`, `supabase/` or `.github/` is added, changed or deleted, and
      `src/lib/verdict/`, `src/components/VerdictCard.tsx` and `src/App.tsx` are not modified.
      Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests run on constructed plan sets. Whether three
      plans are *legible* on a phone — subordinate to Plan A without being buried — cannot be
      asserted from code. The human check is opening the PR preview on the iPhone PWA and confirming
      Plan A is still obviously the answer.

## Notes for the Analyst / Builder

**The framing that keeps this ticket honest, as its *because*.** Plans B and C are **not** a menu.
`product-brief.md` §1's whole premise is that the app answers one question with one answer;
alternatives exist so the reader can see *how close the call was*, which is what makes a confidence
band mean something. **Because** of that, every alternative is rendered as a difference from Plan A
rather than as a competing option — and Plan A never loses its position as the answer.

**#60 already collapsed the plans that were not real alternatives.** Before that ticket, a run
produced three plans with the same incoming player and identical scores, differing only in which
bench player was sold. `src/lib/recommendation/distinctness.ts` fixed that upstream. **Do not
re-implement distinctness in the display layer** — whatever is stored is already distinct, and a
second notion of "different enough" in a second place will drift from the first.

**Fewer than three plans is normal and is not a shortfall to report as one.** The generation job
records the shortfall in its own `job_runs` row; the interface's job is to present what exists
confidently.

**`recommendations` also carries `coverage`** — which named players the model has no history for.
`product-brief.md` §8 binds item 21 on stating coverage, and an alternative resting on a
no-history player is exactly the case that rule exists for. The reasoning screen already states
coverage for Plan A; **extend the same treatment to the alternatives rather than inventing a new
one.**

**This ticket extends an existing surface** rather than establishing new visual direction, so the
`frontend-design` skill is **not** invoked and Impeccable is **not** invoked (`CLAUDE.md`'s
design-pass rule). Match the reasoning screen's existing components, density and tokens.

**Two other tickets may be running in this batch.** One owns `scripts/sync-squad.ts`; the other owns
a new `src/lib/decisions/`, a new screen, `src/App.tsx` and `src/screens/HomeScreen.tsx`. This
ticket touches none of them — in particular, **do not modify `src/App.tsx`**; the reasoning screen
already has a route.

## Scope constraint

Nothing outside the following files changes:

- `src/lib/reasoning/api.ts`, `src/lib/reasoning/derive.ts`, `src/lib/reasoning/types.ts`,
  `src/lib/reasoning/derive.test.ts`
- `src/screens/ReasoningScreen.tsx`, `src/screens/ReasoningScreen.css`
- `decisions/ticket-<this issue number>.md`

No migration file is added. No workflow file is touched. Nothing under `scripts/` or `supabase/`
changes. `src/lib/verdict/`, `src/lib/recommendation/`, `src/components/VerdictCard.tsx`,
`src/App.tsx` and `src/screens/HomeScreen.tsx` are not modified.
