## Context

**G1 in `docs/projection-model-backlog.md`, recorded on the day `baseline-v1` first ran and untouched
since. Read that entry before this ticket.**

In `src/lib/projection/expectedPoints.ts`, expected saves are:

```
const expectedSaves = playerRates.savesPer90 * minutesFraction
```

**Every other attacking and defensive term in the model is adjusted by the fixture; this one is
not.** A goalkeeper facing the best attack in the league is projected for exactly the same number of
saves as one facing the worst.

**Why that is wrong.** Saves are a function of being under pressure. The same fixture difficulty
that raises a keeper's expected goals conceded should raise his expected shots faced — they are two
consequences of one cause. And because save points accumulate in complete groups of three **with no
cap** (`product-brief.md` §6d — a genuinely different function from the capped defensive
contribution), the upside for a busy keeper is real and this is the term that captures it.

**Direction of the error.** Goalkeepers at weaker clubs are **undervalued** — they face more shots
than the model credits them for. The error is partly self-cancelling, since a hard fixture already
lowers the same keeper's clean-sheet and goals-conceded terms, so the total moves roughly the right
way for the wrong reason. **That is not the same as being correct**, and it means the model cannot
distinguish the well-known FPL archetype — *cheap keeper at a bad club who saves a lot* — from
*cheap keeper at a bad club who simply concedes*.

**The mirror already exists.** `src/lib/projection/fixture.ts` computes
`expectedGoalsConceded(leagueBaselineGoals, expectedScore)` as
`leagueBaselineGoals × 2 × (1 − expectedScore)`. The ratio form of the same quantity —
`2 × (1 − expectedScore)` — is the saves multiplier, and it is the exact defensive counterpart of
`attackingMultiplier`'s `2 × expectedScore` that the model already applies to goals and assists.

Depends on nothing unmerged. Confined to two pure modules and their tests.

## Scope

**In scope:**

- **A new pure `defensiveMultiplier(expectedScoreValue)` in `src/lib/projection/fixture.ts`**,
  returning `2 × (1 − expectedScore)` clamped to `[0, 2]` — the exact mirror of the existing
  `attackingMultiplier`, and the ratio form of the existing `expectedGoalsConceded`. **Express it as
  that mirror**, so the two cannot drift apart.
- **Apply it to expected saves in `expectedPoints.ts`**: `savesPer90 × minutesFraction ×
  defensiveMultiplier(expectedScore)`.
- **Surface it in `modelInputs`** alongside the existing `expectedSaves`, so the reasoning screen
  and any future calibration can see which multiplier was applied. The reasoning screen already
  renders `modelInputs` generically and needs no change.
- **`docs/projection-model-backlog.md` G1 updated** — marked as addressed by this ticket, retaining
  the double-counting caveat below as the remaining open question, and stating that it was fixed
  before the backtest existed rather than after.

**Explicitly out of scope:**

- **No other projection term changes.** Not goals, not assists, not clean sheets, not goals
  conceded, not defensive contribution, not appearance, not bonus. **The value of this ticket is
  that exactly one term moved**, so its effect on recommendations is attributable.
- **No change to `attackingMultiplier`, `expectedGoalsConceded`, `expectedScore` or the FPL-FDR
  fallback.** The new function is added beside them, not folded into them.
- **No change to `savesPer90` itself, to `rates.ts`, or to the shrinkage formula.**
- **No new ingested column, no new data source.** Shots faced is not in `player_match_stats` and
  this ticket does not add it — the multiplier is derived from the fixture, exactly as every other
  fixture adjustment already is.
- **No change to `scripts/project-points.ts`**, which calls `projectPlayerGameweek` and needs no
  edit. If it turns out one is needed, flag it rather than widening scope silently.
- **No migration, no UI, nothing under `supabase/` or `src/screens/`.**
- **No addressing of G2, G4, G5 or G8.** One backlog entry, this ticket.

## Definition of done

- [ ] `defensiveMultiplier` exists in `src/lib/projection/fixture.ts`, is pure, and returns exactly
      `1.0` at `expectedScore = 0.5`. Named test. *(An even fixture must leave the term unadjusted,
      the same property `attackingMultiplier` already has — a change in the league-average case
      would be a silent global recalibration of every keeper.)*
- [ ] It is clamped to `[0, 2]` and returns `2.0` at `expectedScore = 0` and `0.0` at
      `expectedScore = 1`. Named tests at both ends.
- [ ] **It agrees with `expectedGoalsConceded` by construction:** a test asserts
      `expectedGoalsConceded(b, s) === b × defensiveMultiplier(s)` across at least five values of
      `s`, so the two can never drift.
- [ ] `expectedSaves` in `projectPlayerFixture` is multiplied by it, and `modelInputs` carries the
      multiplier used.
- [ ] **A goalkeeper's projected save points are strictly higher in a hard fixture than an easy one,
      all else equal.** Named test with two fixtures and one identical keeper — this is the whole
      point of the ticket, stated as an assertion.
- [ ] **Outfield players' projections are byte-for-byte unchanged.** A test asserts that for a
      defender, midfielder and forward with identical inputs, every component matches the
      pre-ticket value. *(`savesPer90` is near zero for outfield players, so this should hold
      trivially — assert it rather than assume it.)*
- [ ] Every existing test in `expectedPoints.test.ts` and `fixture.test.ts` that does not concern
      goalkeeper saves passes **unmodified**. Any keeper-saves test that legitimately changes must
      have its new expected value **computed by hand in the test's own comment**, not copied from
      the failing output. *(`LEARNINGS-first-build-wave.md` §2: if a definition of done states a
      number, compute it.)*
- [ ] The FPL-FDR fallback path (`eloFallbackUsed: true`, three promoted clubs with no ClubElo
      rating) flows through the new multiplier identically to the elo path — it is the same
      `expectedScore` either way. Named test.
- [ ] G1 in `docs/projection-model-backlog.md` is updated as described in Scope.
- [ ] Nothing under `scripts/`, `src/screens/`, `src/components/`, `supabase/` or `.github/` is
      added, changed or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** every test is arithmetic on constructed inputs. **Nothing
      here shows the adjusted figure is closer to reality than the unadjusted one** — that needs the
      backtest (item 32), which does not exist. The human check after merge is running
      `project-points` and looking at whether cheap keepers at weak clubs have moved up relative to
      keepers at strong clubs, and whether that ordering looks right to someone who watches football.

## Notes for the Analyst / Builder

**The known caveat, carried forward deliberately and not solved here.** Shots faced and goals
conceded are correlated but not identical: a keeper's save count depends on shot *volume*, while
goals conceded depends on shot *quality* and his own shot-stopping. Scaling saves by the *same*
factor as goals conceded therefore double-counts the fixture slightly. **The backlog says so, and
this ticket ships anyway** — **because** a term with no fixture adjustment at all is further from
the truth than one adjusted slightly too hard, and the alternative is waiting for a backtest that is
five items away behind the largest piece of work on the feature list. Record this in the decisions
log and leave G1's caveat standing in the backlog rather than deleting it.

**Do not invent a separate shots-faced rate.** `player_match_stats` carries `saves` and no shots
column. Deriving a distinct volume model would need a new external source — a Tier 2 data-source
decision and a whole ticket of verification — and the backlog explicitly says not to start there.

**Express the new function as the mirror it is.** `attackingMultiplier` is `2 × expectedScore`;
this is `2 × (1 − expectedScore)`. Write it that way, beside it, with a comment naming the
relationship, so the next reader sees one idea rather than two coincidences.

**Save points are uncapped and accumulate in threes** — `expectedSavePoints` already models this
with a Poisson sum over `Math.floor(k / 3)`. That non-linearity is why this change matters more than
its size suggests: a keeper moved from an expected 3.2 saves to 4.4 crosses a scoring boundary, and
the existing function already handles that correctly. **Do not touch it.**

**These modules are pure and must stay pure** — `CLAUDE.md`'s rule for `src/lib/projection/` and
`src/lib/scoring/`. No I/O, no clock, no environment.

**This is Tier 2** — it changes the projection model, which every downstream recommendation rests
on. Log it as HIGH-IMPACT with its *because*.

**Two other tickets may be running in this batch.** One owns `src/lib/override/`,
`src/lib/decisions/` and two screens; the other owns `scripts/build-solver-input.ts` and
`docs/solver-notes.md`. This ticket touches neither — in particular, **do not modify
`docs/solver-notes.md`**, and nothing under `scripts/`.

## Scope constraint

Nothing outside the following files changes:

- `src/lib/projection/fixture.ts`, `src/lib/projection/fixture.test.ts`
- `src/lib/projection/expectedPoints.ts`, `src/lib/projection/expectedPoints.test.ts`
- `docs/projection-model-backlog.md`
- `decisions/ticket-<this issue number>.md`

No migration file is added. No workflow file is touched. Nothing under `scripts/`, `supabase/`,
`src/screens/` or `src/components/` changes. `src/lib/projection/rates.ts`,
`src/lib/projection/minutes.ts`, `src/lib/projection/defconRate.ts`, `src/lib/scoring/` and
`docs/solver-notes.md` are not modified.
