## Context

Ticket #219 ingested FPL's own `penalties_order` onto `public.players` and **deliberately applied no
model change**, because its own scope said a treatment ships only if it clears a falsification
check, and the question underneath it was not yet settled. The migration is applied, the ingest
runs, and the column carries values for roughly 64 of 655 players. This ticket spends that data or
closes the question.

The route that got us here is worth remembering. Ticket #218's diagnostic tried to identify penalty
takers from a goals-minus-xG residual and produced twenty names including Romero, Mount, Madueke and
Doku. Both of its own cross-checks refuted it: **0 of 20** had a missed penalty on record, and
**0 of 8** measured gameweeks had a flagged player as the top-projected player. That method is dead
and must not be revived, extended, or blended with this one.

`docs/model-review-2026-09-02.md` §1g called penalty duty "the one absence with concentrated cost —
it inflates a handful of exactly the players captaincy turns on."

## The question that decides everything, and it must be answered first

**Does the ingested xG already include penalties?** FPL-Core-Insights' `expected_goals` is a
standard xG figure, and standard xG models score a penalty at roughly 0.76. If penalties are already
inside `prior_xg`, a separate penalty term would double-count — precisely the error
`docs/projection-model-backlog.md` G1 records and the review's §1d inventory exists to prevent.

**Answer it from data before writing any model code**, and write the answer down. A clean test is
available: a known first-choice taker's `xg` in `player_match_stats` for a match in which he scored
a penalty will sit near 0.76 plus his open-play chances if penalties are included, and well below
that if they are not. Note that `event/{gw}/live/` (verified 11 Sep 2026) also publishes
`expected_goals` and `penalties_missed` per player per gameweek, which gives a second, independent
way to check — though another ticket in this batch owns that ingest, so read the endpoint directly
if needed rather than depending on its table.

## Scope

**In scope:**

- Settle the xG question above and record it in `docs/projection-model-backlog.md`.
- **Measure both candidate treatments in the harness, reported, before applying either:**
  1. **Reduced shrinkage for takers.** A first-choice taker's xG rate is shrunk less hard toward
     the position prior, on the grounds that a penalty recurs by appointment and an open-play
     chance does not, so his rate is genuinely more persistent. Reuse `shrunkRate`'s existing
     formula; the only change is the effective `K` for that population. **No new formula, no new
     shrinkage convention.**
  2. **An explicit penalty term.** Coherent only if the xG answer comes back "penalties are NOT
     included". If it does, the per-team penalty rate must come from data that has actually been
     read, never asserted from memory.
- Apply the winning treatment **only if it clears the falsification check below**. If neither does,
  record the finding, change no model file, and say so plainly.

**Explicitly out of scope:**

- **#218's residual method.** Dead. Do not revive it, extend it, or combine it with
  `penalties_order` — a refuted method does not become sound by keeping company with a sound one.
- Orders 2 and 3. Only `penalties_order = 1` is a first-choice taker; backups take penalties rarely
  and treating them as takers without evidence is inventing a population.
- No change to assists, clean sheets, defensive contribution, saves, bonus, minutes, or the fixture
  multipliers.
- No new external data source; `penalties_order` is already ingested.
- No change to `scripts/run-backtest.ts`, and nothing under `src/components/` or `src/screens/`.

## Falsification check — STOP AND REPORT

**This ticket's gate cannot be evaluated by the Builder, and that is now a known property of this
pipeline rather than a surprise** — `LEARNINGS-second-build-wave.md` §20 records that a gate whose
only instrument is a manual workflow dispatch can never run before a merge. So the gate is written
as a human check and the Builder's job is to make it readable, not to pretend it ran.

The Builder must:

- Report both treatments' effect on goal calibration and on both backtest horizons **from whatever
  it can compute in-session**, and state clearly which figures it could not produce.
- **Report the overlap between the players a treatment lifts and the `penalties_order = 1` list.**
  If the lifted set resembles #218's twenty residual names, something is wired to the wrong column —
  that check needs no live data and must be in the PR body.
- Ship a treatment only if the in-session evidence supports it, and say so if it does not.

Keshav's post-merge check is the calibration report and a fresh backtest: forward and midfield goal
calibration must improve, and five-gameweek Spearman for those positions must not fall. **If either
moves the wrong way, revert — the whole change is one constant and one population filter.**

## Definition of done

- [ ] The xG-includes-penalties question is answered from data, in writing, in the backlog, with
      the test that produced the answer described.
- [ ] Both treatments are measured and reported side by side over the same population.
- [ ] The lifted-player overlap against the `penalties_order = 1` list is stated explicitly in the
      PR body.
- [ ] Whichever treatment ships, the file it changes and the constant it introduces are named in
      the decisions log with a full *because*; or, if neither ships, no file under `src/` changes.
- [ ] A named test proves a player with `penalties_order = null` is completely unaffected.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` exit 0.
- [ ] Scope constraint: `scripts/project-points.ts`, `src/lib/projection/rates.ts`,
      `src/lib/projection/expectedPoints.ts`, their test files,
      `docs/projection-model-backlog.md`, and this ticket's own `decisions/ticket-<issue>.md`.
      `scripts/ingest-fpl.ts` is unchanged — the column is already ingested.

## Batch coupling

The bonus-validation ticket in this batch adds a new ingest script and a new table, and is told not
to touch `scripts/ingest-fpl.ts` or anything under `src/`. This ticket does not touch its files
either. Neither should need the other's output; if this one wants
`event/{gw}/live/`'s `expected_goals` for the xG test, read the endpoint directly rather than
depending on a table that may not be applied yet.

## Notes for the Analyst / Builder

- `penalties_order` is live data that changes mid-season — a taker loses the job or is sold. Read
  the column at projection time; never cache a derived list of names.
- This is a small population, about twenty players. Small does not mean unimportant here: it is the
  population captaincy is chosen from, which is the review's entire argument for looking at all.
- **"Neither treatment earns its place" is a good outcome.** The ingest is already done and is
  useful on its own — surfacing "this player takes penalties" on the reasoning screen would be a
  reasonable later ticket even if the model never uses it.
