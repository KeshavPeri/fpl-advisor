## Context

**Feature-list item 28, first slice — and the last unbuilt item that does not sit behind the model
retrain.** It became buildable when item 27 merged: the chip advisory (#126) established the pattern
this ticket extends, and `chip_advisories` already stores exactly the shape needed.

Wildcard and Free Hit are the two chips deliberately excluded from #126, for a reason its Notes state
plainly: **both are full-squad rebuilds, routed through the solver's `preseason` mode, which replaces
the entire squad.** `product-brief.md` §3 puts full-squad building out of scope until this item, and
`scripts/build-solver-input.ts`'s own header records that `preseason: true` is set to `false`
**explicitly, never omitted**, because the shipped `data/user_settings.json` ships it as `true` and
inheriting it would wipe the squad.

**That is the risk this ticket has to handle, and it is a real one.** `preseason` does not touch our
database — `team.json` is built from our `squads` / `squad_picks` and is never written back — but a
solve run in that mode produces a completely different squad, and if any of its output reached
`solver_picks`, `recommendations` or the Telegram message, the app would confidently tell you to make
fourteen transfers.

### What this ticket answers

**"Is my squad far enough from optimal that a wildcard is worth playing?"** That is a genuinely
useful question and it is answerable with a number: the difference between the best squad the solver
can build from scratch within the budget, and the best it can do with the squad you have.

**And the same horizon caution from #126 applies, harder.** A five-gameweek window cannot see the
double gameweek or fixture swing that makes a wildcard worth holding. The delta is reportable; the
timing is not. **This ticket reports a gap, never an instruction to play a chip.**

Depends on item 12 (merged, #41) and item 27 (merged, #126). Nothing unmerged.

## Scope

**In scope:**

- **A `workflow_dispatch`-only workflow, `.github/workflows/squad-rebuild-probe.yml`.** No schedule.
  It runs deliberately, because it is expensive and because its answer changes slowly.
- **It runs two solves**: the normal chip-free solve as a baseline, and a **`preseason: true`,
  `wc: 1`** rebuild solve. Both on the same projections CSV and the same horizon.
- **`scripts/build-solver-input.ts` emits the rebuild config variant** behind the same environment
  mechanism #114 and #126 established. **With that mechanism off, the config it produces is
  byte-for-byte what it produces today, including `preseason: false`.**
- **A new `scripts/store-squad-advisory.ts`** that parses both logs with the existing
  `scripts/lib/solver-output.ts` and writes **one `chip_advisories` row** — the existing table, no
  migration — carrying the chip code, the horizon gameweek, both objectives and the delta.
- **The rebuilt squad is uploaded as a workflow artefact**, never stored. Reading which fifteen
  players the solver would pick is the point of looking; storing them is a different feature.
- **Free Hit is covered by the same mechanism but a separate run.** `fh: 1` with `preseason: true`
  differs from a wildcard only in that the squad reverts afterwards, which the solver models and we
  do not need to. **One variant flag, two possible values, one at a time.**
- **The advisory is surfaced on the chips screen** alongside #126's, with the delta as a whole number
  and **a sentence stating that it is a five-gameweek view and that a wildcard's real value depends on
  fixtures the model cannot see.**
- **`docs/solver-notes.md` records** what `preseason: true` actually does, that it is safe only in an
  isolated solve that stores nothing, and the exact guard rails below.

**Explicitly out of scope — and the first three are the whole safety case:**

- **Nothing from the rebuild solve reaches `solver_picks`, `recommendations` or `notifications`.**
  Not one row.
- **`preseason` stays `false` on the production path**, and on any path that stores picks. The only
  place it may be `true` is inside this probe's own solve.
- **No Telegram send from this workflow**, at all.
- **No change to `solver-run.yml`** or to the nightly chain.
- **No stored rebuilt squad, no "apply this squad" action, no commit or override path.**
- **No chip state change.** `squads.chips_used` is read by item 25's screen and written by
  `sync-squad`; this ticket touches neither.
- **No migration.** `chip_advisories` already has the right shape and grants.
- **No change to `scripts/lib/solver-output.ts`.** Another ticket in this batch owns it — **this
  ticket consumes it as it will exist after that fix, including `-` as an empty cell.**

## Definition of done

- [ ] `.github/workflows/squad-rebuild-probe.yml` exists, has `workflow_dispatch` and **no**
      `schedule` key. Grep-checkable.
- [ ] **The workflow contains no step that writes picks, recommendations or notifications.**
      Grep-checkable: `store-solver-output`, `generate-recommendations`, `send-telegram` and
      `snapshot-predictions` appear nowhere in that file. **This is the ticket's safety case and its
      most important assertion.**
- [ ] With the rebuild mechanism off, `buildSolverConfig` returns byte-for-byte today's config — a
      full-object equality test — and `preseason` is `false`. Named test.
- [ ] With it on, `preseason` is `true`, `chip_limits` carries `wc: 1` **or** `fh: 1` but never both,
      and **every other key is identical**. Full-object equality test for each variant.
- [ ] A named test asserts that **no code path can produce `preseason: true` together with a config
      destined for the production solve**. Whatever form that takes — a separate function, an
      explicit flag on the return — it must be provable from the tests, not from reading carefully.
- [ ] One `chip_advisories` row is written per run, with both objectives and their difference, and
      the delta equals the rebuild objective minus the baseline objective **of the same run**. Named
      test.
- [ ] The rebuilt squad is uploaded as an artefact with `if: always()`, so a failed store still
      leaves the squad readable.
- [ ] The chips screen renders the advisory with the delta as a whole number and the five-gameweek
      limitation in words. Asserted on the derived view.
- [ ] `design-reference.md` compliance: Geist and Geist Mono with tabular figures, the existing
      `Surface` component, no green, no yellow, no purple, no emoji, sentence case. **The advisory is
      not coloured as a warning** — a large delta is information, not an alarm.
- [ ] `docs/solver-notes.md` records the `preseason` behaviour and the guard rails.
- [ ] No migration file is added and nothing under `supabase/` changes. `solver-run.yml` is not
      modified. `scripts/lib/solver-output.ts`, `scripts/store-chip-advisory.ts` and
      `scripts/calibration-report.ts` are not modified. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** **a new `workflow_dispatch` workflow cannot be run until
      its file is on the default branch**, so no run is asked for here, and no test can prove the
      solver behaves sanely in `preseason` mode — it has never been run in this project. The human
      check after merge, **in this order**: dispatch `Squad rebuild probe`; confirm the rebuilt-squad
      artefact contains fifteen players within budget; confirm **no new `solver_picks` or
      `recommendations` rows** were created by it; and only then dispatch a normal `Solver run` and
      confirm the recommendation is unchanged.

## Notes for the Analyst / Builder

**The safety rule, stated as its *because*.** `preseason: true` makes the solver discard the squad
and build a new one. **Because** every downstream consumer — the verdict card, the Telegram sender,
the notification schedule — reads "the most recent solve" and has no way to tell a probe from the
real thing, **a probe row in `solver_picks` or `recommendations` would silently become the app's
answer.** #126 made the same argument for the chip probe; here the consequence is a fourteen-transfer
recommendation rather than a slightly wrong one. Isolation is not tidiness, it is the entire design.

**Why the delta and not the timing, again.** Five gameweeks cannot see the fixture swing that makes a
wildcard worth holding, so the solve will always be able to find a better squad than the one you
have — that is what an optimiser does. **The number that matters is how much better**, and whether it
is large enough to be worth burning a chip you cannot get back. Report the gap; say what it cannot
see; let Keshav decide.

**Expect a large delta, and do not treat that as a bug.** The rebuild solve is unconstrained by your
current squad and by transfer costs, so it will beat the baseline comfortably even when a wildcard
would be a bad idea. **A delta that looks implausibly good is the expected shape of this measurement**
— which is exactly why the ticket reports it as a gap rather than a recommendation.

**Read `scripts/build-solver-input.ts`'s header before touching it.** It documents why `preseason` is
set explicitly rather than omitted, and that comment is now load-bearing in a second way — do not
weaken it.

**Free Hit and Wildcard differ in what happens afterwards, not in the solve.** A Free Hit squad
reverts the following gameweek. Modelling that difference across the horizon is a real refinement and
it is **not** in this slice: report both as one-gameweek rebuild gaps and say so.

**One variant at a time.** Never `wc: 1` and `fh: 1` together — the solver would be free to play both
and the delta would answer no question anyone asked.

**This is Tier 2** — it enables a solver mode that has never been run here and that is destructive if
its output escapes. Log it as HIGH-IMPACT with its *because*, including the isolation argument.

**Two other tickets may be running in this batch.** One owns `scripts/lib/solver-output.ts`,
`scripts/store-chip-advisory.ts` and `scripts/calibration-report.ts`; the other owns
`scripts/run-backtest.ts`, a new `backtest.yml` and `docs/projection-model-backlog.md`. This ticket
touches none of them — in particular, **do not edit `scripts/lib/solver-output.ts`**, even though you
depend on its fix, and **do not edit `docs/projection-model-backlog.md`**; this ticket owns
`docs/solver-notes.md`.

## Scope constraint

Nothing outside the following files changes:

- `.github/workflows/squad-rebuild-probe.yml` (new)
- `scripts/build-solver-input.ts`, `scripts/build-solver-input.test.ts`
- `scripts/store-squad-advisory.ts` (new), `scripts/store-squad-advisory.test.ts` (new)
- `src/lib/chips/api.ts`, `src/lib/chips/derive.ts`, `src/lib/chips/types.ts`,
  `src/lib/chips/derive.test.ts`
- `src/screens/ChipsScreen.tsx`, `src/screens/ChipsScreen.css`
- `docs/solver-notes.md`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/` changes. No other workflow file is touched —
`solver-run.yml`, `scheduled-jobs.yml`, `prediction-log.yml`, `preflight-check.yml`,
`send-notification.yml`, `calibration-report.yml` and `solver-chip-probe.yml` are all left alone.
`scripts/lib/solver-output.ts`, `scripts/store-chip-advisory.ts`, `scripts/calibration-report.ts`,
`scripts/run-backtest.ts`, `src/components/VerdictCard.tsx` and `docs/projection-model-backlog.md`
are not modified.
