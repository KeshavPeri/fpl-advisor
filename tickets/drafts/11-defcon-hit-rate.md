## Context

Feature-list item 9. Depends on #12 (per-match stats in `player_match_stats`) and #15 (the scoring
rules module) — both merged.

`product-brief.md` §6d lists defensive-contribution hit rate as one of the five inputs to the v1
projection model. #15 answers "did this player reach the threshold in *this* match" as a pure
function. This ticket answers the forward-looking question the projection needs: **how likely is
this player to reach it in the next one.**

Pure computation, no I/O, in the same shape as #15 — so it can be proven correct without a
database, a network call or a running app. Item 10 wires it to real rows; this ticket does not.

## Scope

**In scope:**

- `src/lib/projection/defconRate.ts` — pure functions estimating a player's per-match probability of
  reaching their defensive-contribution threshold, from their own match history plus a position
  prior.
- Reuse `cbitCount` and `cbirtCount` from `src/lib/scoring/` — do not reimplement the thresholds.
- A helper that computes a position-level prior hit rate from a set of historical matches, so no
  probability is hardcoded.
- Expected defensive-contribution points for a player: probability × 2 (the per-match cap).
- Vitest tests covering every rule in the definition of done.
- Export from `src/lib/projection/index.ts`.

**Explicitly out of scope:**

- **No database reads or writes, no `fetch`, no file I/O.** These are pure functions over data
  passed in, exactly as #15 is.
- No projection model — minutes probability, xG/xA rates, fixture difficulty and clean-sheet
  probability are item 10 and a separate ticket.
- No CSV emission, no solver, no recommendation. The CSV seam is item 11 and must not be
  anticipated here.
- No UI, no component, no route.
- **No changes to `.github/workflows/`, `scripts/`, or `supabase/migrations/`.** Another ticket is
  running in the same batch and touches the workflow directory.
- No changes to `src/lib/scoring/` — consume it, do not edit it.
- No new stored data of any kind.
- No new dependency.

## Definition of done

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] The threshold check is delegated to `cbitCount` / `cbirtCount`, imported from
      `src/lib/scoring/`. No file in `src/lib/projection/` declares its own threshold constant or
      compares a count against a literal 10 or 12 outside of test fixtures.
- [ ] **Only matches with `minutes_played >= 60` count toward a player's rate.** A defender with ten
      60-minute matches, five of which reached 10 CBIT, and twenty 5-minute cameos reaching nothing,
      has the same estimate as one with only the ten long matches.
- [ ] **A player with no qualifying matches returns the position prior exactly**, not zero and not
      an error.
- [ ] **Shrinkage toward the prior is applied**, so a player with one qualifying match that hit the
      threshold does not return a probability of 1.0. Their estimate sits strictly between the prior
      and 1.0.
- [ ] A player with many qualifying matches converges on their own observed rate: given a position
      prior of **0.40** and 100 qualifying matches of which 40 hit, the estimate is exactly 0.40.
      With a prior of 0.20 and the same 100 matches, the estimate is within 0.01 of 0.39.
      *(These follow from `(hits + k×prior)/(n + k)` with k = 5 — check the arithmetic before
      writing the test, and if your estimator disagrees, your estimator is wrong.)*
- [ ] Every returned probability is in `[0, 1]` inclusive, for every input tested.
- [ ] Recoveries count toward the midfielder and forward estimate and not the defender estimate —
      the same asymmetry #15 enforces, verified end to end through this module.
- [ ] Goalkeepers return a probability of 0 and expected points of 0. Defensive contribution does
      not apply to them; `product-brief.md` §6d gives goalkeepers a separate saves function.
- [ ] Expected defensive-contribution points equal probability × 2, and never exceed 2.
- [ ] The position-prior helper, given a set of matches, returns the observed proportion for that
      position, and returns a stated neutral value when given an empty set rather than dividing by
      zero.
- [ ] Nothing in `src/lib/projection/` imports `@supabase/supabase-js`, `node:fs`, `node:path`,
      React, or any `.css` file, and nothing calls `fetch`. Verifiable by search.
- [ ] Every rule above has its own named test; `npm run test` reports them individually.
- [ ] Scope constraint: only files under `src/lib/projection/`, plus this ticket's own
      `decisions/ticket-<number>.md`, are added or changed. Nothing under `src/lib/scoring/`,
      `src/lib/squad/`, `src/components/`, `scripts/`, `.github/` or `supabase/` changes, and
      `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **The estimator is a shrunk empirical rate.** `(hits + k × prior) / (qualifying matches + k)`,
  with **k = 5**. Decided here, Tier 3. Because it is explainable in one sentence — which
  `product-brief.md` §6d requires of every v1 input — it degrades gracefully to the prior with no
  data, and it stops a single lucky match producing a confident 1.0. Do not substitute a logistic
  regression or any fitted model; that is the OpenFPL work in wave 9, not this.
- **The 60-minute qualifying threshold is deliberate.** Defensive-contribution thresholds are
  per-match totals, so a 20-minute substitute appearance essentially cannot reach 10 CBIT.
  Including cameos would drag every rotation player's estimate down for a reason that has nothing
  to do with their defensive work rate.
- **No probability may be hardcoded.** Position priors are computed from data passed in. A magic
  number here becomes a wrong number the moment the defensive-contribution rules or the league's
  refereeing patterns shift, and nobody would ever notice.
- **Do not read from `player_match_stats` in this module.** The columns exist — `tackles`,
  `interceptions`, `blocks`, `clearances`, `recoveries`, `minutes_played` — and item 10 will map
  them onto the `DefensiveActionStats` interface #15 already defines. Keeping this module free of
  I/O is what makes it provable, and that property is worth protecting.
- `DefensiveActionStats`, `Position`, `DEFENDER`, `MIDFIELDER`, `FORWARD` and `GOALKEEPER` are
  already exported from `src/lib/scoring/types.ts`. Import them; do not define parallel types.
- This ticket runs alongside a solver-environment ticket in the same batch. That one owns
  `.github/workflows/` and `scripts/`; this one owns `src/lib/projection/`. Stay inside your own
  directory and the two cannot collide.
