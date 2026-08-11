## Context

Feature-list item 8. No dependencies on any other ticket in this wave — it is pure computation and
can build in parallel with anything.

`product-brief.md` §6d lists the 2026/27 scoring rules as load-bearing and verified on 10 Aug 2026
against the Premier League, with an explicit instruction not to take them from training data:
several of them changed this season and the 2025/26 values are wrong. This module is where those
rules live as testable functions, so the projection model (item 10) and the accuracy tracker (item
23) both score against one implementation rather than two divergent ones.

It is also the first ticket that can be fully verified without a database, a network call or a
running app, so it establishes the test runner the rest of the project uses.

## Scope

**In scope:**

- `src/lib/scoring/` — pure functions, no I/O, implementing the 2026/27 rules:
  - **Defensive contribution**, capped at **+2 per match**. Defenders: threshold 10 CBIT (clearances,
    blocks, interceptions, tackles). Midfielders and forwards: threshold 12 CBIRT — recoveries
    included.
  - **Goalkeeper save points**, **not capped**, accruing in complete groups of three: 3 saves = 1
    point, 6 = 2, 9 = 3.
  - **BPS for 2026/27**: CBI earns 1 BPS per *three* actions; the −1 BPS penalty for being tackled is
    removed; goalkeepers earn 2 BPS for *any* save, +1 for a save inside the box, +1 for saving a big
    chance, and a penalty save is 7 BPS.
  - Bonus allocation from a match's BPS ranking (3 / 2 / 1), **including ties** — see the DoD.
  - Total match points for a player from their component stats.
- Vitest as the test runner, with a `test` script in `package.json`.
- A unit test per rule, named so a failure says which rule broke.

**Explicitly out of scope:**

- No projection model. Minutes probability, xG/xA rates, fixture difficulty and clean-sheet
  probability are item 10 and are a separate ticket.
- No defensive-contribution hit-rate estimation — that is item 9, and it needs the per-match data
  from #12.
- No database reads or writes, no fetching, no file I/O. These are pure functions.
- No UI, no component, no route.
- No solver, no CSV emission.
- No new stored data of any kind.
- No changes to existing app code beyond adding the test script and config.

## Definition of done

- [ ] `npm run build` passes clean.
- [ ] `npm run lint` passes clean.
- [ ] `npm run test` exists in `package.json` and passes.
- [ ] A defender with 9 CBIT scores 0 defensive-contribution points; with 10 scores 2; with 19
      scores 2; with 20 scores 2. *(The cap is +2 per match — reaching double the threshold does not
      score 4.)*
- [ ] A midfielder with 11 CBIRT scores 0; with 12 scores 2; with 25 scores 2.
- [ ] Recoveries count toward the midfielder/forward threshold: a midfielder with 6 CBIT and 6
      recoveries scores 2.
- [ ] Recoveries do **not** count toward the defender threshold: a defender with 9 CBIT and 5
      recoveries scores 0.
- [ ] Goalkeeper saves: 2 saves = 0 points, 3 = 1, 5 = 1, 6 = 2, 9 = 3, 30 = 10. The function has no
      upper bound.
- [ ] BPS from CBI: 2 actions = 0 BPS, 3 = 1, 5 = 1, 6 = 2.
- [ ] Being tackled contributes 0 BPS — there is no −1.
- [ ] Goalkeeper BPS is **per save, and accumulates**: one save = 2; one save inside the box = 3;
      one save of a big chance = 3; one save both inside the box and a big chance = 4; a penalty
      save = 7. Three ordinary saves in a match = 6 BPS, not 2.
- [ ] Bonus allocation handles ties, per the Premier League's published rule:
      - No tie: 3 / 2 / 1 to the top three by BPS.
      - **Tie for first:** both tied players get 3, and the next player gets 1. Nobody gets 2.
      - **Tie for second:** first gets 3, both tied players get 2. Nobody gets 1.
      - **Tie for third:** first gets 3, second gets 2, every player tied for third gets 1.
- [ ] Each of those four tie cases has its own named test.
- [ ] Every rule above has its own named test, and `npm run test` reports them individually rather
      than as one aggregate assertion.
- [ ] Nothing in `src/lib/scoring/` imports `@supabase/supabase-js`, `node:fs`, `node:path`, or
      calls `fetch`. Verifiable by search.
- [ ] Nothing in `src/lib/scoring/` imports React or any `.css` file.
- [ ] Scope constraint: the only files added or changed are under `src/lib/scoring/`, plus
      `package.json`, `package-lock.json` and a Vitest config file. No component, no route, no
      migration, no workflow, no script.

## Notes for the Analyst / Builder

- **Do not take these rules from training data.** They are restated in `product-brief.md` §6d as
  verified against the Premier League on 10 Aug 2026, and several changed for 2026/27. In
  particular: defensive contribution is capped at +2 but goalkeeper saves are *not* capped — these
  are two different functions and implementing one as a variant of the other will be wrong.
  CBI BPS moved from 1-per-2-actions to 1-per-3-actions. The −1 for being tackled is gone. The
  penalty save is 7 BPS, down from 8.
- **CBIT and CBIRT are different thresholds over different stat sets.** Defenders: clearances,
  blocks, interceptions, tackles, threshold 10. Midfielders and forwards: the same four plus
  recoveries, threshold 12. Getting the recoveries inclusion backwards silently mis-scores every
  midfielder in the model.
- **Vitest as the test runner is a Tier 2 library decision, already made here.** Because it shares
  Vite's existing config and transform pipeline, needs no separate build step, and this project
  already runs Vite 8. Log it with the because; do not escalate. Add `"test": "vitest run"` to
  `package.json`.
- Once this lands, **every subsequent ticket's definition of done can include `npm run test`.** Say
  so in the handback — it changes what the following wave's tickets can promise.
- Keep the module free of I/O deliberately. It is the one piece of this system that can be proven
  correct in isolation, and that property is worth protecting against the first convenient reason to
  break it.
- **Goalkeeper save BPS is per save, not per match.** Every BPS component in FPL is a per-action
  count, and the published wording is "2 BPS for any save" — so a keeper making five saves inside
  the box earns 15 BPS from saves, not 3. Do not implement this as a flat per-match award. This is
  distinct from *save points* (the +1 per three saves rule above), which is a separate function
  over the same input; implementing either as a variant of the other will be wrong.
- **Tie handling in bonus allocation is a published rule, not a judgement call.** Verified
  11 Aug 2026 against the Premier League: a tie for first awards 3 to both and 1 to third, with no
  2 given out; a tie for second awards 3 to first and 2 to both tied players, with no 1 given out.
  Ties are common — do not implement a naive sort-and-slice-three.
- Position codes come from FPL's `element_types` (1 GK, 2 DEF, 3 MID, 4 FWD). Take them as inputs;
  do not import the reference schema into this module.
