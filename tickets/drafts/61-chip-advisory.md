## Context

**Feature-list item 27. The chip probe (#114) has run, and its output settles the two questions that
blocked this ticket.**

### 1. The chip decision IS machine-readable — in three places

`docs/solver-notes.md` records that the results CSV has no chip column, which is true. But the
probe's stdout carries the decision in structured form. Verified from the real log, 28 August 2026:

**The `Results` table at the very end — one line per solution, with a `chip` column:**

```
Results
  iter  sell         buy        chip        score
     0  Muharemović  Thiaw      TC2, BB4   256.48
     1  Wirtz        Tavernier  TC2, BB4   256.29
     2  Muharemović  Botman     TC2, BB4   255.98
```

`TC2, BB4` means Triple Captain in gameweek 2, Bench Boost in gameweek 4. Empty when no chip is
played. **This is the parse target** — one compact line per `solution_index`, which is exactly the
key `solver_picks` and `recommendations` already use.

Two independent cross-checks exist in the same log: a `CHIP TC` / `CHIP BB` line inside each
gameweek block, and a `Transfer Overview` section rendering `GW2: (TC) Muharemović -> Thiaw`.

### 2. The finding that changes the design: the solver always wants to play chips immediately

**All three solutions played Triple Captain in gameweek 2 and Bench Boost in gameweek 4 — the first
and third gameweeks of a five-gameweek horizon.** That is not a coincidence and it is not a
recommendation to trust.

**A chip's value comes from timing it against a gameweek the solver cannot see.** Bench Boost is
worth playing in a double gameweek; Triple Captain is worth saving for a premium player's easiest
fixture. Our horizon is five gameweeks and rolls forward nightly. **Inside a five-week window, a
chip held is a chip wasted, so the optimiser will burn it at the first opportunity — every single
night, forever.**

**Therefore this ticket does not let the solver's chip choice into the recommendation.** It runs a
second, chip-enabled solve alongside the normal one and reports **the difference between them** as
an advisory. The delta is the information: *"playing Triple Captain this gameweek is worth +N points
across the next five, and the solver cannot see past that."* A number with its limitation stated is
useful; a chip recommendation presented as a decision would be `product-brief.md` §6a's exact
prohibition — no recommendation beats a wrong one.

### A third finding, free from the same log

The probe printed **`Filtered player pool from 612 to 368 players`**. That is the post-filter pool
size ticket #95 said could not be observed from our side, and it confirms the widening worked — 368
players considered, against roughly thirty before. Capture it while we are parsing anyway.

Depends on item 12 (merged, #41), item 25 (merged, #85) and the probe (merged, #114). Nothing
unmerged.

## Scope

**In scope:**

- **A second solve in `.github/workflows/solver-run.yml`**, after the existing one, with
  `bb: 1` and `tc: 1` and **`wc: 0`, `fh: 0`** — identical in every other respect, including the
  same projections CSV, the same `team.json` and the same time limit.
- **`scripts/build-solver-input.ts` emits the chip-enabled config variant** behind the same
  mechanism #114 established. **With that mechanism off, the config it produces is byte-for-byte
  what it produces today.**
- **A new parser, `scripts/lib/solver-output.ts`**, that reads the solver's stdout and returns, per
  `solution_index`: the chips played as `(chipCode, gameweekId)` pairs, and the objective score.
  Pure, no I/O, unit-tested against the real log excerpt above.
- **A cross-check that fails loudly.** The parser also reads the per-gameweek `CHIP XX` lines. **If
  the `Results` table and the per-gameweek lines disagree, the job fails** naming both — it never
  picks one. A silent disagreement here would put a wrong chip in front of a decision.
- **A new table `public.chip_advisories`**, in migration
  **`supabase/migrations/20260828100000_chip_advisories.sql`** — filename pinned; **another ticket
  in this batch also adds a migration**, and two have collided on a timestamp before.
  - One row per (gameweek, solution_index): the chip code, the horizon gameweek it would be played
    in, the chip-enabled objective, the chip-free objective, the **delta**, and the `solver_run_id`
    of the normal run it is being compared against.
  - RLS read-only for `anon`; `SELECT, INSERT, UPDATE` for `service_role`, no `DELETE`. **RLS and
    GRANTs in the same file** — two independent gates, and a local-Postgres test is blind to the
    second (`deltas.md` D8).
- **Storage of the advisory**, keyed to the normal run so the two are always compared like for like.
- **The chip advisory is surfaced on the chips screen**, not the verdict card: the chip, the gameweek,
  the delta as a whole number, and **a plain sentence stating that the solver sees only five
  gameweeks and therefore always favours playing a chip early.**
- **The pool size captured** from `Filtered player pool from N to M players` into
  `job_runs.details`.

**Explicitly out of scope:**

- **The normal recommendation is unchanged.** `chip_limits` stays `{ bb: 0, wc: 0, fh: 0, tc: 0 }` on
  the production solve. Nothing the chip solve produces reaches `recommendations`, `solver_picks`,
  the verdict card or the Telegram message.
- **No Wildcard, no Free Hit.** Both are full-squad rebuilds routed through the solver's `preseason`
  path, which **wipes the stored squad**. That is item 28, deliberately.
- **No "play your chip" instruction anywhere.** The advisory states a number and its limitation. The
  decision is Keshav's.
- **No chip commit, no chip override, no writing to `recommendation_decisions`.**
- **No change to `src/lib/chips/`'s existing state or expiry logic** (#85, #116) beyond rendering the
  new advisory.
- **No change to the projection model, the CSV adapter, or `scripts/project-points.ts`.**
- **No change to the solver's other settings.** Not `horizon`, `xmin_lb`, `keep_top_ev_percent`,
  `ev_per_price_cutoff`, `no_transfer_last_gws`, `decay_base`, `num_iterations`,
  `iteration_criteria`.
- **No re-pinning of the solver commit.**

## Definition of done

- [ ] `supabase/migrations/20260828100000_chip_advisories.sql` exists with exactly that filename, is
      idempotent, and contains both a `CREATE POLICY` and explicit `GRANT` statements.
      Grep-checkable. No `DELETE` is granted to any role.
- [ ] `scripts/lib/solver-output.ts` is pure — the strings `supabase`, `fetch` and `process.env`
      appear nowhere in it.
- [ ] **The parser is tested against the real probe output.** A fixture containing the verbatim
      `Results` block above yields three solutions, each with `TC` in gameweek 2 and `BB` in
      gameweek 4, and the scores 256.48, 256.29 and 255.98. Named test.
- [ ] An empty `chip` column yields no chips for that solution, not an error. Named test.
- [ ] A `Results` table disagreeing with the per-gameweek `CHIP` lines **fails**, naming both
      readings. Named test. **This is the most important test in the ticket.**
- [ ] A missing `Results` table fails loudly rather than returning an empty advisory. Named test —
      *an absent chip and an unparseable log must never look the same.*
- [ ] With the chip mechanism off, `buildSolverConfig` returns byte-for-byte today's config. A
      full-object equality test asserts it, and a named test asserts `chip_limits` is still all
      zeros on the production path.
- [ ] With it on, `chip_limits` is `{ bb: 1, wc: 0, fh: 0, tc: 1 }` and **every other key is
      identical**. Full-object equality test. `preseason` is still `false` in both cases — named
      test.
- [ ] The stored delta equals chip-enabled objective minus the chip-free objective of the run named
      by `solver_run_id`, and a test asserts the two are never taken from different runs.
- [ ] **Nothing the chip solve produces is written to `recommendations` or `solver_picks`.**
      Grep-checkable: neither table name appears in the chip path.
- [ ] The chips screen renders the advisory with the delta as a whole number and the five-gameweek
      limitation stated in words. Asserted on the derived view.
- [ ] `job_runs.details` carries the parsed pool size.
- [ ] `design-reference.md` compliance on the new UI: Geist and Geist Mono with tabular figures, the
      existing `Surface` component, no green, no yellow, no purple, no emoji, sentence case.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the parser is tested against one captured log, not against
      every shape the solver can print — a solve that plays no chip, or plays one in a different
      gameweek, has never been observed. The human check after merge is: apply the migration,
      dispatch `Solver run`, and confirm **the normal recommendation is identical to the previous
      night's** while a chip advisory appears alongside it. **Solve time roughly doubles** — the
      probe's three iterations took 126s, 103s and 117s — so confirm the workflow still completes.

## Notes for the Analyst / Builder

**The rule this ticket encodes, as its *because*.** A five-gameweek horizon cannot see the double
gameweek or easy fixture that makes a chip worth holding, **because** those are twenty weeks away and
the model does not look that far. So the solver's chip timing is not advice about the season — it is
advice about the next five weeks, and it will always say "now". **Report the difference it computes;
never present its timing as a decision.** If a Builder hits a case this reasoning does not cover,
reason from that sentence.

**Parse the `Results` table, cross-check against the `CHIP` lines, fail on disagreement.** Two
readings that agree are evidence; one reading is a guess. This is the same discipline that caught the
doubled `solver_picks` figure in #72 — a number that reconciles from two directions is verified, and
one that nearly reconciles is the finding.

**The chip codes observed are `TC` and `BB`**, immediately followed by the gameweek number with no
separator, comma-space delimited between chips: `TC2, BB4`. **Do not assume `WC` or `FH` format** —
neither has ever been observed, both are out of scope, and a parser that guesses at their shape is a
parser that will be wrong when item 28 arrives.

**Compare against the same run, always.** The delta is only meaningful against the chip-free solve of
the *same* projections CSV and the *same* squad. `solver_picks` already accumulates rows across runs
and that exact trap produced a projected score of roughly double in #72. Store `solver_run_id` and
join on it.

**Solve time doubles and that is the cost of the design.** The alternative — enabling chips on the
single production solve — is cheaper and wrong, because the chip-free baseline is what makes the
delta mean anything, and because a contaminated recommendation is unrecoverable once it reaches the
Telegram message.

**Two migrations in this batch.** Both filenames are pinned explicitly. Check them against each other
before filing, and note that both will need applying by hand after merge.

**This is Tier 2** — it adds a table other work will read and changes what the solver workflow does.
Log it as HIGH-IMPACT with its *because*, including the horizon-bias reasoning.

**Two other tickets may be running in this batch.** One owns `scripts/ingest-core-insights.ts`,
`scripts/build-feature-history.ts`, its own migration and `supabase/README.md`; the other owns
`scripts/calibration-report.ts` and `docs/projection-model-backlog.md`. **This ticket also edits
`supabase/README.md`** — append its migration row at the end of the table and change nothing else in
that file, so the two edits merge cleanly.

## Scope constraint

Nothing outside the following files changes:

- `supabase/migrations/20260828100000_chip_advisories.sql` (new)
- `scripts/lib/solver-output.ts` (new), `scripts/lib/solver-output.test.ts` (new)
- `scripts/build-solver-input.ts`, `scripts/build-solver-input.test.ts`
- `scripts/store-chip-advisory.ts` (new), `scripts/store-chip-advisory.test.ts` (new)
- `.github/workflows/solver-run.yml`
- `src/lib/chips/api.ts`, `src/lib/chips/derive.ts`, `src/lib/chips/types.ts`,
  `src/lib/chips/derive.test.ts`
- `src/screens/ChipsScreen.tsx`, `src/screens/ChipsScreen.css`
- `supabase/README.md` (one appended migration row only)
- `decisions/ticket-<this issue number>.md`

No other workflow file is touched. `scripts/project-points.ts`, `scripts/emit-projections-csv.ts`,
`scripts/store-solver-output.ts`, `scripts/generate-recommendations.ts`,
`scripts/ingest-core-insights.ts`, `scripts/build-feature-history.ts`,
`scripts/calibration-report.ts`, `src/lib/projection/`, `src/components/VerdictCard.tsx` and
`docs/projection-model-backlog.md` are not modified.
