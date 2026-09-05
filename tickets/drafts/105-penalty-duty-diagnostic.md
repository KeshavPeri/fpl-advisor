## Context

`docs/model-review-2026-09-02.md` §1g audited what the model leaves out — cards, own goals, penalty
misses — and concluded almost all of it should stay out. **It named exactly one exception:**

> Penalty *duty* is the one absence with concentrated cost — it inflates a handful of exactly the
> players captaincy turns on, and it is cheaply measurable (a persistent positive per-player
> goals-minus-xG residual identifies takers) — worth one diagnostic, not a build.

Nothing has been done about it since. It matters more than its size suggests because of where it
lands: a penalty taker's goal rate is systematically above his xG, and the captain is by definition
the squad's highest-projected player. An error concentrated in five or six players is invisible in
a season MAE and decisive in a captaincy call.

**This is a diagnosis ticket and it changes no projection.** The deliverable is a number and a
recommendation.

## What the repo actually has, checked before writing this

The review says the source carries `penalties_scored`. **It does not, in this repo.**
`player_match_stats` has no penalty column, and `public.players` carries only `penalties_saved` and
`penalties_missed` — season totals from `bootstrap-static`, not per-match, and not "who takes them".

So the residual method the review named is not a fallback, it is the method: a player whose goals
persistently exceed his xG across a season is taking penalties, and the size of that residual is
the size of the error. Everything needed is already in `player_match_stats`.

There is also a cleaner source worth checking: FPL's `bootstrap-static` publishes `penalties_order`
per player, which names the taker directly. `scripts/ingest-fpl.ts` does not read it and no column
stores it. Verify whether that field is present in the live payload — this ticket does not add the
ingest, but whether it exists changes the recommendation.

## Scope

**In scope:**

- A standalone hand-run diagnostic script. It reads `player_match_stats` for the ingested seasons,
  computes each player's goals-minus-xG residual per 90 over a full season, and ranks it.
- **Quantify the cost, do not just list the players.** Three figures: how many players carry a
  residual large enough to be penalty duty rather than finishing noise; how much projected-points
  error that residual represents for those players over a five-gameweek horizon; and how often one
  of them is the top-projected player in a gameweek — the captaincy case.
- Cross-check the identified takers against `players.penalties_missed`, which is real if indirect
  evidence: a player with missed penalties on record took penalties.
- Confirm whether `penalties_order` is present in the live `bootstrap-static` payload.
- A written finding in `docs/projection-model-backlog.md` with a recommendation: model it, ingest
  `penalties_order` and use it, or leave it alone and record why.

**Explicitly out of scope:**

- **No model change.** Nothing under `src/lib/projection/` is touched, no projection moves, no
  recommendation changes.
- **No new ingest column and no migration.** If the finding is "ingest `penalties_order`", that is
  the follow-up ticket, with its own definition of done.
- No change to `scripts/run-backtest.ts`, to `scripts/project-points.ts`, or to any report that
  already exists. This is a new script that stands alone.
- No threshold asserted as a bound. Every figure is reported, nothing gates anything.

## Definition of done

- [ ] The script is pure over its inputs where the logic lives, with named tests: a player whose
      goals match his xG scores a residual near zero; a player with a large persistent surplus is
      identified; a single high-scoring gameweek does not qualify a player on its own.
- [ ] The separation rule between "penalty taker" and "good finisher" is stated explicitly, with its
      reasoning, and flagged as a judgement rather than a derived threshold.
- [ ] The three cost figures above are reported, with sample sizes.
- [ ] Small populations are refused, not guessed — the same "too small to read" discipline the
      backtest already applies.
- [ ] The `penalties_order` availability question is answered yes or no from the live payload.
- [ ] The backlog entry ends in one recommendation, argued.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` exit 0.
- [ ] Scope constraint: one new script and its test under `scripts/`,
      `docs/projection-model-backlog.md`, and this ticket's own `decisions/ticket-<issue>.md`.
      Nothing else, and nothing that any other ticket in this batch touches.

## What a good outcome looks like

"Six players carry a residual consistent with penalty duty, worth about N points each over five
gameweeks, and one of them is the top-projected player in M gameweeks out of 38" is a finding that
decides the follow-up either way.

**"It is small, leave it alone" is an equally good outcome and must be reported as plainly.** The
review already concluded that cards, own goals and penalty misses stay out; this is checking whether
duty belongs in the same bucket. Confirming it does closes a question rather than opening a ticket.

## Notes for the Analyst / Builder

- Filter to `competition = 'prem'` on every read — roughly 18% of `player_match_stats` rows are cup
  and European matches, and cup xG per 90 runs 34% higher (`docs/projection-model-backlog.md`).
- Key on `player_code`, never an element id (`deltas.md` D9).
- Pass an explicit ordering to every paginated read; `scripts/lib/paginate.ts` fails closed without
  one.
- This is the second-to-last item on the review's own list that has never been acted on. Whatever
  the answer, write it down so it is not rediscovered in six months.
