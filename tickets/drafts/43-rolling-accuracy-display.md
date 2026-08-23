## Context

**Feature-list item 24.** `prediction_log` has been filling since ticket #73 and **nothing reads
it.** A column with no consumer is the dangerous kind (`deltas.md` D9) — unverified until the first
thing depends on it, and then wrong in production.

`product-brief.md` §2 specifies the whole loop: *"every projection stored, scored against actuals
after gameweek lockdown, and shown as a rolling figure in-app."* #73 built the first two thirds.
This ticket builds the third, and it is the only thing in the app that answers **"is this model any
good?"**

Depends on item 23 (merged, #73). Nothing unmerged.

### What the data actually looks like

One row per gameweek × player × model version. `projected_points` and `projected_minutes` are
written pre-deadline and frozen. `actual_points`, `actual_minutes`, `settled_at` and `error` are
written once, post-lockdown, by `scripts/settle-predictions.ts`. **`error` is
`actual_points − projected_points`**, so positive means the model **under**-projected — read the
column comment in the migration before writing any sign logic.

**A row with `settled_at IS NULL` has not been measured.** That is a genuinely different state from
a measured zero, and the migration's own header calls collapsing the two "a prediction log that lies
about what it has actually measured". **Never treat an unsettled row as a zero.**

### The measurement trap this ticket must not fall into

Roughly one player in six is injured, suspended or never plays, and the model correctly projects
them at zero. They then score zero. **Including those rows makes the model look near-perfect** — a
mean absolute error dominated by hundreds of correct zeros is a number that means nothing.

`LEARNINGS-second-build-wave.md` §3 records exactly this failure once already: a calibration report
that was internally consistent, carried its sample sizes, listed three honest caveats, and was still
wrong, because nothing compared its output against reality. **An instrument needs its own
verification.**

## Scope

**In scope:**

- **A new pure module `src/lib/accuracy/`** — `api.ts` (the Supabase read), `derive.ts` (all
  arithmetic and display logic, no I/O), `types.ts`. Same shape as `src/lib/verdict/`,
  `src/lib/reasoning/` and `src/lib/chips/`. `derive.ts` must be pure and directly unit-tested.
- **The rolling figures, computed only over settled rows** (`settled_at IS NOT NULL`) at the current
  `model_version`:
  - **Mean absolute error per player-gameweek**, over the **measured population** defined below.
  - **Mean signed error (bias)** over the same population, stated in words as over- or
    under-projecting rather than as a bare sign.
  - **Per-gameweek figures** as well as the rolling total, so a bad week is visible rather than
    averaged away.
  - **The sample size behind every figure** — gameweeks settled, and players measured.
- **The measured population is defined and stated on screen:** rows where
  `projected_minutes > 0 OR actual_minutes > 0` — a player the model expected to feature, or who
  actually featured. Rows where both are zero are counted and reported **separately** as correctly
  predicted non-appearances, never folded into the headline.
- **An accuracy card on the home screen**, below the pitch. `design-reference.md` fixes the home
  screen order as countdown, verdict, pitch — this goes after them, and the feature list's "visible,
  not buried" is satisfied by it being on the home screen at all, not by pushing it above the
  decision.
- **An honest empty state.** Until a gameweek has settled there is nothing to show, and the card
  must say what it is waiting for — settlement happens after lockdown, 09:00 UK the morning after
  the gameweek's final match — rather than showing a spinner or a zero.

**Explicitly out of scope:**

- **No change to `scripts/snapshot-predictions.ts` or `scripts/settle-predictions.ts`**, and nothing
  under `scripts/` at all. This ticket reads what those jobs already write.
- **No migration, nothing under `supabase/`.**
- **No comparison between model versions.** `model_version` is read so the figures come from one
  model, not so two can be raced. That is a later ticket and needs a second model to exist first.
- **No charts, no graphing library, no sparkline.** Figures and words. Adding a chart library is a
  Tier 2 framework decision this ticket has no reason to make.
- **No per-player accuracy table, no "worst predictions" list.** Interesting, and a different
  ticket — this one establishes the headline figure.
- **No change to the verdict card, the reasoning screen, or the chips screen.**
- No new npm dependency.

## Definition of done

- [ ] `src/lib/accuracy/derive.ts` is pure: the strings `supabase`, `fetch` and `useEffect` appear
      nowhere in it.
- [ ] **Unsettled rows are excluded from every figure.** A unit test mixes settled and unsettled
      rows and asserts the unsettled ones affect neither the means nor the counts.
- [ ] **A row with `settled_at` set and `actual_points = 0` is included** as a real measured zero.
      Named test, distinguishing it from the unsettled case above.
- [ ] The measured population is `projected_minutes > 0 OR actual_minutes > 0`. A unit test asserts
      that a row with both at zero is excluded from the mean and counted in the separate
      non-appearance figure.
- [ ] Mean absolute error and mean signed error are computed from `actual_points` and
      `projected_points` directly, **not** by averaging the stored `error` column blindly — and a
      unit test asserts the two agree on a fixture where they should, so a wrong-signed or
      wrong-order `error` value would be caught rather than propagated.
- [ ] Bias is stated in words: a positive mean signed error reads as the model **under**-projecting.
      Named test asserting the wording for a positive and a negative case, because this sign is easy
      to invert and impossible to spot once rendered.
- [ ] **Sanity bound, asserted in a test and stated in the ticket's PR body:** mean absolute error
      over the measured population should land roughly between **1.0 and 3.5 points** per
      player-gameweek. A figure below 1.0 almost certainly means non-appearances have leaked back
      into the population. The test asserts the derive function produces a value in that range for a
      realistic constructed dataset — it does **not** assert anything about live data.
- [ ] Every figure is rendered with its sample size beside it. A mean over fewer than 50 measured
      rows is labelled as too small to read rather than presented as a result.
- [ ] The empty state names what it is waiting for and when settlement happens. Asserted by a unit
      test on the derived view with zero settled rows.
- [ ] Every Supabase read paginates, per `src/lib/verdict/api.ts`'s convention — `prediction_log`
      grows by roughly 600 rows a gameweek and will pass 1,000 within two, and Supabase silently
      caps at 1,000 with no error and no flag.
- [ ] `design-reference.md` compliance: Geist and Geist Mono with tabular figures; translucent
      layered surface via the existing `Surface` component; no green, no yellow, no purple; no
      emoji; no "AI" framing. **Decimals are permitted here** — an accuracy figure is a measurement,
      not a projection, and §8's no-decimals rule is about projected points in the recommendation UI.
- [ ] Nothing under `scripts/`, `supabase/` or `.github/` is added, changed or deleted.
      Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** every test runs on constructed rows. Nothing here proves
      the live `prediction_log` holds what this code expects — it has never had a consumer, so its
      real shape is unverified in production, and settlement itself has only just started running for
      real. The human check after merge is opening the preview URL and asking whether the figure is
      *plausible*: a mean absolute error near zero, or above five, is the code being wrong, not the
      model being brilliant or broken.

## Notes for the Analyst / Builder

**The one number that decides whether this ticket is any good, stated as a *because*.** A mean
absolute error is only meaningful over players the model made a real claim about. **Because** about
one player in six correctly projects at zero and then scores zero, including them turns the headline
into a measure of how many players are injured rather than of how good the model is. If a Builder
hits a population question this rule does not obviously cover, reason from that sentence.

**Read the migration's column comments before writing any arithmetic.**
`supabase/migrations/20260821090000_prediction_log.sql` states the sign convention for `error` and
the meaning of a null `settled_at` explicitly, and both are easy to get backwards.

**Report "not enough data" rather than a number.** `LEARNINGS-second-build-wave.md` §3: *"A report
that says 'I cannot measure this' is trustworthy; one that says '0.30, probably' is not."* At the
time this ships there may be exactly one settled gameweek, which is not a rolling figure — say so.

**Do not compute accuracy against the recommendation.** This measures the projection model against
what players actually scored. Whether the *recommendation* was good is a different question,
answered later against `recommendation_decisions`, and conflating them would make both unreadable.

**This ticket extends existing UI rather than establishing new visual direction** — it is a card on
an existing screen — so the `frontend-design` skill is **not** invoked, and Impeccable is **not**
invoked (`CLAUDE.md`'s design-pass rule). Match the verdict card's existing components and tokens.

**Two other tickets may be running in this batch.** One owns `scripts/build-solver-input.ts` and
`docs/solver-notes.md`; the other owns `src/lib/chips/`, `src/screens/ChipsScreen.tsx`
and `src/lib/notification/message.ts`. This ticket touches none of
them — in particular, **do not modify `src/App.tsx`**; this is a card on the existing home screen,
not a new route.

## Scope constraint

Nothing outside the following files changes:

- `src/lib/accuracy/api.ts` (new), `src/lib/accuracy/derive.ts` (new),
  `src/lib/accuracy/types.ts` (new), `src/lib/accuracy/derive.test.ts` (new)
- `src/components/AccuracyCard.tsx` (new), `src/components/AccuracyCard.css` (new)
- `src/screens/HomeScreen.tsx`, `src/screens/HomeScreen.css` (mounting the card only)
- `decisions/ticket-<this issue number>.md`

No migration file is added. No workflow file is touched. Nothing under `scripts/` or `supabase/`
changes. `src/App.tsx`, `src/components/VerdictCard.tsx` and `src/lib/chips/` are not modified.
