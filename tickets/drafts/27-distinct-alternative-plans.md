## Context

A defect fix in Plan A / B / C generation. Depends on item 13 (`recommendations`, merged) and item
12 (`scripts/build-solver-input.ts`, merged).

The first real recommendation run produced three plans that are not three choices:

| Plan | Transfer in | Transfer out | Captain | Score |
|---|---|---|---|---|
| A | Collins | Pedro Porro | Guéhi | 289 |
| B | Collins | Murillo | Guéhi | 289 |
| C | Collins | Lacroix | Guéhi | 289 |

**Same player in. Same captain. Identical scores.** The only thing that varies is which of three
players goes out — and all three were benched or already out of the starting XI, so selling any of
them changes the projected score by nothing. The confidence band correctly reported `coin-flip` and
the reason line correctly said the plans were statistically close: **the system was honest about
it.** The fault is upstream, in how the alternatives are asked for.

**The cause.** `scripts/build-solver-input.ts` sets `iteration_criteria: 'this_gw_transfer_in_out'`,
which requires an alternative to differ in this gameweek's transfer **in or out** pair. Varying the
*out* player is nearly free for the optimiser, so it took that route every time. Read at the pinned
commit, `dev/solver.py` supports these criteria (lines 1098–1138):
`this_gw_transfer_in`, `this_gw_transfer_out`, `this_gw_transfer_in_out`, `chip_gws`,
`target_gws_transfer_in`, `this_gw_lineup`. **`this_gw_transfer_in` forces the incoming player to
differ**, which is the decision a human is actually choosing between.

**Why it matters beyond tidiness.** Presenting three equal-scoring options as Plan A, B and C
manufactures the appearance of a choice. That is the same failure `product-brief.md` §8 bans
decimals for — false precision dressed as information. §8's own rule applies directly: *"When the top
options are statistically indistinguishable, the app must say so plainly rather than inventing a
preference."* Three padded plans invent one.

**Written before the corrected data was available.** The numbers above predate the Premier-League
match filter (ticket #54), so the specific players and scores will change once the projections are
rebuilt. **The mechanism defect does not depend on those numbers** — varying the outgoing bench
player is structurally cheap regardless of what the projections say. Re-check the shape of the
output after this merges; do not re-derive the diagnosis.

## Scope

**In scope:**

- Change `iteration_criteria` in `scripts/build-solver-input.ts` to `this_gw_transfer_in`.
- **Stop padding to three.** `scripts/generate-recommendations.ts` stores as many *genuinely
  distinct* plans as the solve produced, between one and three.
- **A distinctness test in `src/lib/recommendation/`** — pure: two plans are the same decision when
  they share the incoming player, the captain, and a projected score within a stated tolerance.
- Collapse same-decision plans, keeping the highest-scoring, and record how many were collapsed.
- When only one distinct plan survives, the stored reasoning says there is **one clear course of
  action with no meaningfully different alternative** — a confident answer, not an apology.
- Report raw solutions returned, distinct plans stored, and plans collapsed, in `job_runs.details`.
- Vitest tests for every rule below.

**Explicitly out of scope:**

- **No change to the projection model, to `src/lib/projection/`, or to `scripts/project-points.ts`.**
- **No change to the message text or to `src/lib/notification/`.** Another ticket in this batch owns
  notification scheduling.
- **No change to the confidence-band thresholds.** They are provisional (`product-brief.md` §9 open
  question 2) and belong to the backtest, not to this ticket.
- **No widening of the solver's player pool.** `xmin_lb`, `keep_top_ev_percent` and
  `ev_per_price_cutoff` are not touched here. That is a real and separate finding — see the Notes.
- **No raising of `num_iterations` above 3**, and no chip criteria (`chip_gws`,
  `target_gws_transfer_in`).
- **No UI, no route, no component.** Nothing under `src/screens/` or `src/components/` changes.
- **No new database table and no migration.** `recommendations` already allows `plan_index` 0–2 and
  nothing here needs a fourth.
- No new npm dependency.

## Definition of done

**Build**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] Nothing under `src/lib/recommendation/` imports `@supabase/supabase-js`, `node:fs`, React or
      any `.css` file, and nothing there calls `fetch`. Verifiable by search.
- [ ] No new entry in `package.json`.

**The criterion**

- [ ] `iteration_criteria` is `this_gw_transfer_in`, set from a single named constant, with a comment
      recording that `this_gw_transfer_in_out` produced three plans differing only in a benched
      outgoing player. There is a named test asserting the emitted config value.
- [ ] `num_iterations` stays at `3`.
- [ ] No other solver setting changes. `horizon`, `xmin_lb`, `keep_top_ev_percent`,
      `ev_per_price_cutoff`, `preseason`, `team_data` and all four `chip_limits` are byte-for-byte
      unchanged. Verifiable by diff.

**Distinctness**

- [ ] Two plans are the **same decision** when all three hold: identical incoming player (including
      both being a roll with no transfer), identical captain, and projected scores within a stated
      tolerance. The tolerance is one named constant with a comment.
- [ ] There are named tests for: same in-player and same captain and equal scores → same decision;
      same in-player but different captain → **different** decisions; different in-player → different
      decisions; both plans rolling the transfer with the same captain → same decision.
- [ ] **The outgoing player is not part of the comparison.** There is a named test proving two plans
      that differ only in who goes out are treated as the same decision — that is precisely the
      degenerate case this ticket exists to remove, and it must be caught even if the criterion
      change alone would have prevented it.
- [ ] When plans collapse, the **highest-scoring survivor is kept** and `plan_index` values are
      re-assigned contiguously from `0`, so a stored set is always `0`, or `0,1`, or `0,1,2` — never
      `0,2`. Named test.
- [ ] Storing fewer than three plans is a normal outcome. Nothing errors, nothing warns, and no
      placeholder row is written.
- [ ] Re-running for the same gameweek **removes plans that no longer exist** rather than leaving a
      stale `plan_index` 2 behind from a previous run that produced three. Named test for
      three-then-one. *(`recommendation_reasons` cascades on its parent, so its rows follow.)*

**The reasoning, when there is only one plan**

- [ ] With a single distinct plan, the stored reasoning states there is one clear course of action
      and no meaningfully different alternative. It does **not** apologise, hedge, or read as though
      something is missing — `design-reference.md`: an empty state is an invitation to act, not a
      mood, and a single confident answer is a real answer.
- [ ] With a single distinct plan, the confidence band is **not** forced to `coin-flip` merely
      because there is nothing to compare against. The band's meaning is "how close are the top
      options", and with one option the coverage and solver-status rules still govern it. There is a
      named test.
- [ ] With two or three distinct plans, the existing band logic is unchanged.

**Reporting**

- [ ] `job_runs.details` records raw solutions returned by the solver, distinct plans stored, and
      plans collapsed, as three named counts.
- [ ] **If the solver returns three solutions and all three collapse to one, that is logged as a
      notable event** with the reason — it means the player pool is offering no real alternative, and
      that is a finding rather than a routine outcome.
- [ ] Scope constraint: only `scripts/build-solver-input.ts`,
      `scripts/generate-recommendations.ts`, files under `src/lib/recommendation/`, their test files,
      and this ticket's own `decisions/ticket-<number>.md` are added or changed. Nothing under
      `src/screens/`, `src/components/`, `src/lib/notification/`, `src/lib/projection/`,
      `src/lib/scoring/`, `src/lib/squad/`, `supabase/` or `.github/` changes; no other file in
      `scripts/` changes; `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **Both halves of the fix are needed, and neither is sufficient alone.** Changing the criterion stops
  the solver generating decisions that differ only in an irrelevant sale. The distinctness test
  catches every other way two plans can turn out to be the same decision — and it is the part that
  survives if a future ticket changes the criterion again.
- **One plan is a legitimate, and often correct, output.** Some gameweeks genuinely have one right
  move. `product-brief.md` §2 lists "roll your transfer" as a first-class recommendation for the same
  reason. The failure mode being fixed is padding to three, not having fewer than three.
- **Do not resolve this by widening the player pool.** That is a real and separate finding: the first
  solve surfaced only three distinct transfer targets across five gameweeks, because
  `keep_top_ev_percent` (5) and `ev_per_price_cutoff` (30) prune hard. Loosening them may well be
  right, but it changes which players are considered — a different decision, needing its own ticket
  and its own evidence. **Changing both at once would make it impossible to tell which one worked.**
  Record the observation in `decisions/ticket-<number>.md`.
- **The tolerance is a judgement and must be labelled as one.** Projected scores are horizon totals in
  the high hundreds; two plans within a fraction of a point are the same decision in any sense a
  human cares about. Pick a value, name it, comment it, and say in the decisions log that it is
  uncalibrated and belongs to the backtest.
- **`iteration_difference` is left at its shipped default of 1.** Raising it would force alternatives
  further apart and is worth trying — but it interacts with the pool width above, so it is one more
  variable to change in isolation later, not now.
- **This is a Tier 2 decision and the reason belongs in the log.** How alternatives are generated
  shapes every recommendation the app will ever make, and would be expensive to reverse once the
  verdict card, the reasoning screen and the notification all render "Plan B". State the *because*.
- **Two other tickets are running in this batch.** One owns `src/lib/notification/`,
  `scripts/send-telegram.ts`, `scripts/notification-schedule.ts` and a migration; the other owns
  `src/components/`, `src/screens/` and `src/lib/squad/`. Neither touches anything here.
- **What a substitute cannot catch.** Pure tests prove the distinctness rule and the collapse
  behaviour exactly, without a solver. They cannot prove the new criterion actually yields different
  incoming players against real data — that needs a live solve. **After merge: run the solver
  workflow and check whether the stored plans now name different players coming in.** If they still
  do not, the pool is too narrow and that is the next ticket, not a failure of this one.
