## Context

**`public.recommendation_decisions` has been filling since the commit action shipped (#84) and the
override screen after it (#91). Nothing reads it back.** A column with no consumer is the dangerous
kind (`deltas.md` D9) — unverified until the first thing depends on it, and then wrong in
production. This is the third time that pattern has appeared in this repo, after
`player_match_stats.competition` and `prediction_log`.

The ledger is the only record of **what Keshav actually did**, as opposed to what he was told to do.
It is append-only by grant (`SELECT, INSERT` only, no `UPDATE`, no `DELETE`), carries `kind` of
`'commit'` or `'override'`, and holds a frozen `snapshot` of the decision — deliberately independent
of the `recommendations` row that produced it, because that row is replaced by every solver run.

**Why it matters now rather than later.** `product-brief.md` §1's premise is that the app earns
trust by being measurable. The rolling accuracy display (item 24, merged) measures the *projection
model*. This measures **the loop** — how often the recommendation was taken, how often it was
overruled, and what was done instead. Without it, the two `kind` values are a distinction nobody
can see.

Depends on item 19 (merged, #84) and item 20 (merged, #91). Nothing unmerged.

## Scope

**In scope:**

- **A new `/decisions` screen** (`src/screens/DecisionHistoryScreen.tsx`), registered in
  `src/App.tsx`, reachable from the home screen.
- **A new pure module `src/lib/decisions/`** — `api.ts` (the Supabase read, player-name resolution),
  `derive.ts` (all display logic, pure), `types.ts`. Same shape as `src/lib/verdict/`,
  `src/lib/reasoning/`, `src/lib/chips/` and `src/lib/accuracy/`.
- **The history, newest first**, one entry per decision: the gameweek, whether it was a commit or an
  override, when it was decided, and the decision itself in words — the transfer or the roll, the
  captain and vice-captain, resolved to player names rather than ids.
- **For an override, the comparison is the entry**: what the model recommended and what was recorded
  instead, and specifically what differed. The override screen already computes this at entry time;
  **the history recomputes it from the stored snapshot**, because the recommendation it was compared
  against may since have been replaced.
- **Headline counts across the season**: decisions recorded, how many were commits, how many were
  overrides, and how many gameweeks have no decision at all. **The gap is as informative as the
  entries** — a season with two recorded decisions in eight gameweeks says something true about the
  loop.
- **An honest empty state** naming what is missing and how a decision gets recorded, per
  `design-reference.md`'s rule that an empty state is an invitation to act.

**Explicitly out of scope:**

- **No judgement of whether an override was right.** That needs settled actuals for the players
  involved and is a genuinely harder measurement — a separate ticket, after the prediction log has
  several settled gameweeks. **Do not compute a "you were right" figure**, and do not imply one.
- **No writes of any kind.** Read-only. The ledger is append-only by grant and this screen does not
  test that.
- **No undo, no edit, no delete.** Not possible by grant, and not a gap to work around here.
- **No migration, nothing under `supabase/`.**
- **No change to the commit control, the override screen, `src/lib/commit/` or
  `src/lib/override/`.**
- **No change to the verdict card or the reasoning screen.**
- No new npm dependency, no charts.

## Definition of done

- [ ] `/decisions` renders as a route in `src/App.tsx` and is reachable from the home screen.
- [ ] `src/lib/decisions/derive.ts` is pure: the strings `supabase`, `fetch` and `useEffect` appear
      nowhere in it.
- [ ] Entries are ordered newest first by `decided_at`. Named test.
- [ ] A `commit` entry states the gameweek and the decision in player names, sourced from the stored
      `snapshot` and **not** from a live read of `recommendations`. Named test asserting the derive
      function is given only the snapshot and still produces a complete entry.
- [ ] An `override` entry states what was recommended and what was recorded, and names the fields
      that differ. Named test for a difference in captain only, transfer only, and both.
- [ ] A snapshot missing an optional field — `transfer_in_player_id` and `transfer_out_player_id`
      are null on a roll, and `hit_cost` is null on every override by design — renders correctly
      rather than showing "null" or erroring. Named test for each case.
- [ ] A player id that cannot be resolved to a name renders as an explicit unknown-player label and
      does not drop the entry. Named test. *(Players are re-keyed between seasons; `code` is the
      stable key. An id from a prior season may not resolve.)*
- [ ] The headline counts reconcile arithmetically: commits + overrides equals decisions recorded,
      and decisions recorded + gameweeks with no decision equals gameweeks elapsed. Asserted by a
      unit test. **A count that nearly reconciles is the finding**
      (`LEARNINGS-second-build-wave.md` §2).
- [ ] The empty state names what is missing and how a decision is recorded. Named test.
- [ ] Every Supabase read paginates, per `src/lib/verdict/api.ts`'s convention.
- [ ] `design-reference.md` compliance: Geist and Geist Mono with tabular figures; translucent
      layered surfaces via the existing `Surface` component; **coral is used for nothing here** — an
      override is not a failure and must not be coloured as one; no green, no yellow, no purple; no
      emoji; sentence case, plain verbs, no filler.
- [ ] Nothing under `scripts/`, `supabase/` or `.github/` is added, changed or deleted, and
      `src/lib/commit/`, `src/lib/override/`, `src/lib/reasoning/` and
      `src/components/VerdictCard.tsx` are not modified. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** every test runs on constructed rows. Nothing here proves
      the live `recommendation_decisions` snapshots hold what this code expects — the column has
      never had a consumer, so its real shape is unverified in production, and there are only a
      handful of real rows. The human check after merge is opening `/decisions` and confirming the
      entries match what you actually did in gameweek 1.

## Notes for the Analyst / Builder

**The framing rule, as its *because*.** An override is not a mistake and must not read like one.
`design-reference.md` calls the override's friction "the feature", **because** a deliberate,
recorded disagreement with the model is exactly the behaviour this app wants — it is what makes the
model measurable at all. Colour, wording and ordering must all treat a commit and an override as two
equally legitimate kinds of decision. **Coral is for risk and injury, not for this.**

**Read the snapshot, not the recommendation.** `recommendations` is upserted by every solver run and
ticket #60 added a `DELETE` grant on it, so the row a past decision referred to may be gone or
changed. That is precisely why `recommendation_decisions.snapshot` exists and why it carries the
seven fields rather than only a foreign key — see the migration header and `decisions/ticket-84.md`.
**A history that re-reads `recommendations` would silently rewrite the past.**

**The snapshot's seven keys are** `is_roll`, `transfer_in_player_id`, `transfer_out_player_id`,
`captain_player_id`, `vice_captain_player_id`, `hit_cost`, `solver_run_id` — written by both
`src/lib/commit/` and `src/lib/override/`. Read both before writing this module; the two write the
same key names deliberately so one query can read both kinds, and that property must not be broken
by assuming a shape from one of them.

**`hit_cost` is null on every override, by design** — ticket #91's own Notes explain why: a
hand-typed points cost will eventually be wrong, and the real figure arrives from the FPL API after
the deadline. Render it as not recorded, never as zero.

**Do not add a "was the override right" figure, even a tentative one.** It needs settled actuals for
the specific players, and a wrong version of that number would be the most damaging thing this
screen could show — `LEARNINGS-second-build-wave.md` §3: an instrument that measures the wrong thing
is the most expensive kind of wrong.

**This ticket establishes a genuinely new surface**, so the `frontend-design` skill **is** invoked
per `CLAUDE.md`'s design-pass rule. It must nonetheless reuse the existing design tokens, the
`Surface` component and the established type scale — a new surface is not a new design system.
**Impeccable and emil-design-eng are NOT invoked**; this is not a polish ticket.

**Two other tickets may be running in this batch.** One owns `scripts/sync-squad.ts`; the other owns
`src/lib/reasoning/` and `src/screens/ReasoningScreen.tsx`. This ticket touches neither — in
particular, **do not modify `src/lib/reasoning/` or the reasoning screen**, even though a decision
history and a reasoning screen are conceptually adjacent.

## Scope constraint

Nothing outside the following files changes:

- `src/lib/decisions/api.ts` (new), `src/lib/decisions/derive.ts` (new),
  `src/lib/decisions/types.ts` (new), `src/lib/decisions/derive.test.ts` (new)
- `src/screens/DecisionHistoryScreen.tsx` (new), `src/screens/DecisionHistoryScreen.css` (new)
- `src/App.tsx` (the route registration only)
- `src/screens/HomeScreen.tsx`, `src/screens/HomeScreen.css` (the link through only)
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/` changes. No workflow file is touched.
Nothing under `scripts/` changes. `src/lib/commit/`, `src/lib/override/`, `src/lib/reasoning/`,
`src/screens/ReasoningScreen.tsx` and `src/components/VerdictCard.tsx` are not modified.
