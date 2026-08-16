## Context

Feature-list item 13 — **the loop's last piece of thinking.** Depends on item 12 (`solver_runs` and
`solver_picks`, merged, migration applied, first real solve stored) and item 10
(`player_projections`, merged). Items 14 and 15 turn what this ticket stores into a Telegram
message; they do not re-derive it.

The solver already produces a squad plan. `product-brief.md` §2 asks for something narrower and
more human: **one clear primary decision for this gameweek — including "roll your transfer" —
plus a captain, a starting XI and bench order, with Plan B and Plan C**, a confidence band, an
explicit hit cost when a −4 is recommended, and stored reasoning.

§6c names the mechanism: the solver's `num_iterations` / `iteration_criteria` generate alternative
solutions, "which is exactly the Plan A / Plan B / Plan C requirement." `num_iterations` is
currently `1`. This ticket raises it and interprets the result.

### What the first real solve actually produced, 16 Aug 2026

Read from the stored output, so nobody has to guess at the shape:

- One solution (`iter` 0), five gameweeks, fifteen players per gameweek plus transfers.
- Per row: `week`, `id`, `name`, `pos`, `type`, `team`, `buy_price`, `sell_price`, `xP`, `xMin`,
  `squad`, `lineup`, `bench`, `captain`, `vicecaptain`, `transfer_in`, `transfer_out`,
  `multiplier`, `xp_cont`, `chip`, `iter`, `ft`, `transfer_count`.
- `bench` is `-1` for a starter and `0`–`3` for a bench slot — **not a boolean**, and `0` is a real
  bench position, not a false.
- `multiplier` is `2` for the captain and `0` for a benched player, so `xp_cont` (contribution) is
  zero for the bench.
- `ft` carries the free-transfer count in that gameweek and `transfer_count` the transfers made —
  and **both arrive as floats with binary noise** (`0.9999999999999996` for one transfer,
  `1.0000000000000044` for another). They must be rounded, never compared for equality.

## Scope

**In scope:**

- Raise `num_iterations` in `scripts/build-solver-input.ts` so the solve produces **three**
  solutions, and set `iteration_criteria` explicitly.
- **`src/lib/recommendation/`** — pure functions, no I/O: the confidence band, the hit-cost
  arithmetic, and the derivation of "what changed between this plan and the current squad."
- **`scripts/generate-recommendations.ts`** — reads `solver_runs` and `solver_picks` for the current
  gameweek, builds Plan A/B/C, and upserts them.
- **`supabase/migrations/20260817090000_recommendations.sql`** — creates `recommendations` and
  `recommendation_reasons`, with RLS **and** GRANTs in the same file.
- A step in `.github/workflows/solver-run.yml`, after the solver-output store.
- Vitest tests for every pure function.
- One `job_runs` row per execution.

**Explicitly out of scope:**

- **No UI, no route, no component.** Nothing under `src/screens/` or `src/components/` changes.
  The verdict card is item 17 and the reasoning screen is item 21.
- **No Telegram, no notification, no scheduling of a notification.** Items 14 and 15.
- **No change to the projection model or to `src/lib/projection/`.** Another ticket in this batch
  measures it; this one consumes whatever it produces.
- **No change to `scripts/project-points.ts` or `scripts/emit-projections-csv.ts`.**
- **No chip recommendation.** `chip_limits` stay at `0`. Items 25–27.
- **No override registration, no decision ledger, no commit action.** Items 19 and 20.
- **No re-running or re-implementing the solve.** This ticket reads stored solver output only.
- No new npm dependency.

## Definition of done

**Build**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] Nothing under `src/lib/recommendation/` imports `@supabase/supabase-js`, `node:fs`, React or
      any `.css` file, and nothing there calls `fetch`. Verifiable by search.
- [ ] No new entry in `package.json`.

**The three plans**

- [ ] `num_iterations` is **3** and `iteration_criteria` is set explicitly rather than left to the
      shipped default. The value chosen is stated in `decisions/ticket-<number>.md`.
- [ ] Plans are ordered by the solver's own score, best first, and stored as `plan_index` `0`, `1`,
      `2`. Plan A is `0`.
- [ ] **A solve that returns fewer than three distinct solutions stores what it got** and records
      the shortfall in `job_runs.details`. It is not an error and does not fail the run.
- [ ] Every plan carries, for the **current gameweek only**: the player transferred in and out (or
      an explicit "no transfer"), the captain, the vice-captain, the starting XI, and the bench in
      order.
- [ ] **Bench order is read from the solver's `bench` column treating `-1` as "starter" and `0`–`3`
      as bench positions.** There is a named test proving bench slot `0` is not treated as a
      starter — this is the single most likely off-by-one in the ticket.
- [ ] `ft` and `transfer_count` are rounded before use. No equality comparison is made against a
      raw float from the solver. There is a named test using `0.9999999999999996` as a one-transfer
      input.

**"Roll your transfer" is an answer, not an absence**

- [ ] A plan whose current gameweek makes no transfer is stored as an explicit
      **roll-the-transfer recommendation**, with its own reason, not as a null or an empty plan.
- [ ] `design-reference.md`'s interface-writing rule applies to the stored text: this reads as a
      confident answer, not as the app having nothing to say.

**Hit cost and confidence — the two the brief is specific about**

- [ ] When a plan makes more transfers than the available free transfers, the recommendation stores
      **the hit cost, the gross projected gain, and the net after the hit**, as three separate
      values. `product-brief.md` §6d: "When a hit is recommended, the app must state the cost and
      the net explicitly."
- [ ] Hit cost is `4 × (transfers made − free transfers available)`, floored at zero. There is a
      named test for zero, one and two hits.
- [ ] A confidence band of **`clear` / `marginal` / `coin-flip`** is stored per recommendation,
      derived from the score gap between Plan A and Plan B across the horizon. Thresholds are named
      constants (see Notes) and each band has its own named test.
- [ ] **When Plan A and Plan B are statistically indistinguishable, the stored reasoning says so
      plainly** rather than asserting a preference. `product-brief.md` §8 requires this in words,
      not only as a band value.
- [ ] Projected-points values are stored at full precision **and** a whole-number value is stored
      alongside for display, so item 17 never has to round in the view layer. §8 forbids decimals in
      the recommendation UI.

**Data-coverage honesty — `product-brief.md` §8**

- [ ] For every player named in a recommendation, the run checks whether that player has any
      historical match rows behind their projection, and **stores a coverage flag per recommended
      player**.
- [ ] **A recommendation whose transfer-in has no history drops one confidence band** and stores a
      reason saying the model has no Premier League record for that player. This is the brief's
      binding rule, not a nicety — 45% of the player list is in that state at GW1.

**Storage**

- [ ] The migration creates `recommendations` (keyed on gameweek and `plan_index`, carrying the
      transfer in/out, captain, vice-captain, hit cost, gross and net gain, confidence band, and the
      solver run it came from) and `recommendation_reasons` (one row per reason line, ordered, so
      item 21 has something structured to render).
- [ ] **The same migration issues `GRANT SELECT` to `anon` and `GRANT SELECT, INSERT, UPDATE` to
      `service_role` on both tables**, and enables RLS with a `SELECT` policy for `anon`. No
      `DELETE`. *(`deltas.md` D8.)*
- [ ] The migration is idempotent, with the same role guard every prior migration uses.
- [ ] The job upserts and never removes rows. It issues no Supabase row-removal call at all.
- [ ] Re-running for the same gameweek replaces that gameweek's plans rather than accumulating
      duplicates.
- [ ] The job reads exactly `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. No `VITE_`-prefixed variable.
- [ ] **Every Supabase read uses the shared pagination helper** added by the row-cap fix, and
      asserts its row count against an independent count. *(`deltas.md`: a truncated read is
      indistinguishable from missing data.)*
- [ ] No solve for the current gameweek exits **zero** with a named message and writes nothing.
- [ ] Scope constraint: only files under `src/lib/recommendation/`,
      `scripts/generate-recommendations.ts` and its test file, `scripts/build-solver-input.ts`,
      `supabase/migrations/20260817090000_recommendations.sql`,
      `.github/workflows/solver-run.yml`, and this ticket's own `decisions/ticket-<number>.md` are
      added or changed. **Plus any build-configuration file an instructed import genuinely
      requires, logged as a decision.** Nothing under `src/screens/`, `src/components/`,
      `src/index.css`, `index.html`, `src/lib/projection/` or `src/lib/scoring/` changes;
      `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **Confidence bands — Tier 3, decided here, and explicitly provisional.** Using the difference in
  total horizon score between Plan A and Plan B: **`clear` at 2.0 points or more, `marginal` from
  0.5 to 2.0, `coin-flip` below 0.5.** `product-brief.md` §8 observes that the gap between the top
  three options "is routinely under one point, well inside the model's own error", which is why the
  coin-flip threshold is where it is. These numbers are a starting point and `product-brief.md` §9
  open question 2 says the real ones should come from the backtest. **Name them as constants in one
  place and say in the decisions log that they are uncalibrated.**
- **The band is a floor, not a ceiling.** The data-coverage rule can only lower it. A recommendation
  can never be upgraded to `clear` by any rule in this ticket.
- **`iteration_criteria` should be the shipped `this_gw_transfer_in_out`** unless there is a reason
  to differ — it makes the alternatives differ in *this week's transfer*, which is precisely what
  Plan B and Plan C mean here. A criterion that varies a gameweek-4 decision produces three plans
  that are identical this week and useless as alternatives.
- **The current gameweek is the first week in the solver's own output**, not "gameweek 1" and not
  today's date. Read it from the stored rows.
- **Reasons are stored, not generated prose.** One row per reason, each a short factual line —
  what changed, why the model prefers it, what the alternative was, what the hit costs. Item 21
  renders them and item 14 puts the headline into Telegram. Do not write a paragraph.
- **`design-reference.md` binds the wording even though there is no UI here**, because these strings
  are shown verbatim later: sentence case, plain verbs, no filler, FPL's own vocabulary, no emoji,
  and errors that say what happened and what to do.
- **Do not add "differential" or "effective ownership" reasoning.** `product-brief.md` §1 is
  explicit: mini-league position may be displayed but must never enter the objective, and ownership
  is display data. A reason line that says "low-owned differential" is out of scope and wrong.
- **The solve this reads may be running on a narrow player pool.** The first real run only ever
  surfaced three distinct transfer targets across five gameweeks, because the solver's pool filters
  are aggressive. That is a separate finding and a separate ticket — **do not widen the filters
  here**, and do not treat a small set of alternatives as a bug in this ticket.
- **What a substitute cannot catch.** Pure tests prove the bands, the hit arithmetic, the bench
  indexing and the float rounding without a database. They cannot prove the GRANTs (a local
  Postgres runs as superuser — `deltas.md` D8), and they cannot prove three genuinely distinct
  solutions come back from a real solve, because that needs the solver. **The workflow file already
  exists on `main`, so this one CAN be dispatched after merge** — unlike item 12, which could not.
  That run is Keshav's check and it is what closes the ticket.
