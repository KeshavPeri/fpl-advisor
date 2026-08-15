# Ticket #41 — Run the solver on our own data and store what it produces

## HIGH-IMPACT

- **`solver_runs` is append-only (one row per execution, never overwritten); `solver_picks` is
  upserted in place, keyed `(solution_index, gameweek_id, player_id)`, with a `run_id` foreign
  key back to the `solver_runs` row that produced it.** Because the app's "Run now" button
  (product-brief.md §2) can solve the same gameweek more than once in a day, and losing earlier
  attempts would erase exactly the evidence needed to tune `xmin_lb` and the horizon over time —
  but `solver_picks`' job is "the current best plan for a gameweek," not a full history of every
  attempt, so upserting the picks while keeping every run's metadata is the right split.

## ROUTINE

- **Purchase and selling price both set to `players.now_cost`** for the first solve (pre-decided
  in the ticket's own notes) — because `squad_picks` doesn't store what Keshav actually paid, and
  before GW1 nothing has been bought or sold yet, so current price is exact, not an approximation.
  Logged rather than silently invented; a real purchase-price ledger is a follow-up ticket.
- **`xmin_lb` set to 150, overriding the solver's shipped 300** (pre-decided in the ticket's own
  notes) — 300 across a five-gameweek horizon would eliminate every rotation option and a large
  share of the 45% of the squad list the projection model has no match history for. 150 is a
  guess and is labelled as one: the surviving pool size is recorded in `job_runs` every run so it
  can be tuned from evidence.
- **Horizon is derived by counting `{gw}_Pts` columns in the emitted CSV's own header**, never
  re-read from `PROJECTION_HORIZON` independently. Because two independently-hardcoded copies of
  the same fact — the CSV's actual coverage and the solver's assumed coverage — is exactly the
  failure mode the ticket exists to prevent; deriving it from the CSV itself makes the two
  impossible to disagree.
- **`datasource` in the solver config is set to the CSV's own filename stem**, so the config
  value and the file it names are the same string by construction and cannot drift apart.
- **Solver time limit set to 300 seconds; the workflow job's own `timeout-minutes` set to 20.**
  Because the solve must return an incumbent rather than being killed mid-write, and 300s leaves
  ample margin under a 20-minute job ceiling.
- **Target gameweek resolved via `gameweeks.is_next`**, matching `emit-projections-csv.ts`'s own
  anchor column, rather than `sync-squad.ts`'s different "next unpassed deadline" definition —
  chosen for consistency within this one solver pipeline, which reads what `emit-projections-csv.ts`
  wrote.
- **`team.json`'s `transfers.made` field is set to `0`** even though the DoD's minimum field list
  doesn't name it. `dev/solver.py` reads `my_data["transfers"]["made"]` unconditionally at the
  pinned commit; omitting it throws `KeyError` — confirmed empirically by running the solver.
- **The solve step's shell exit code is deliberately not treated as pass/fail** (`set +e` /
  `exit 0` in the workflow step); `store-solver-output.ts`'s own log-based classification decides
  the job's real outcome. Because the pinned solver never checks HiGHS's own solve status and
  reads out a solution unconditionally — exit code alone cannot distinguish "proven optimal" from
  "timed out but usable," or "infeasible" from "timed out with nothing." This was verified by
  running the solver live against four real scenarios (optimal / time-limit-with-incumbent /
  infeasible / time-limit-with-no-incumbent): exit code was 0 in two cases and 1 in the other two,
  and did not line up with which outcomes are actually usable. The HiGHS log text is the only
  reliable signal, so `parseSolverLog`/`classifySolve` parse it directly and are unit-tested
  against fixtures trimmed from these four real runs.
- **Install/checkout-failure `job_runs` write is done as inline Node in the workflow YAML**, not a
  third script — the ticket's scope names exactly two new scripts (`build-solver-input.ts`,
  `store-solver-output.ts`), and a step that only needs to run once, before either script starts,
  didn't justify a third file.
- **The purchase/selling-price note was not written to `docs/projection-model-backlog.md`.** The
  ticket's own Notes section asks for it there, but the ticket's Scope constraint checklist
  enumerates exactly six files/paths and does not include that doc — a contradiction already
  present in the ticket text, not introduced by the Builder. The Builder chose the stricter,
  literally-checkable scope constraint and documented the approximation in
  `build-solver-input.ts`'s header and `buildTeamJson`'s docstring instead. Flagging here rather
  than resolving it by editing a file outside the stated scope.

## Note on the ticket's unverifiable DoD item

The DoD requires proving, by an actual run on GitHub infrastructure, that the new
`solver-run.yml` workflow completes a solve. This cannot be done from an unmerged branch —
`workflow_dispatch` only registers for workflow files already present on the repository's
default branch, confirmed by the Builder getting a hard `404` when attempting to dispatch it.
This is the identical constraint ticket #29's `solver-smoke.yml` hit, and Keshav had already
corrected this exact DoD wording to "CANNOT VERIFY pre-merge" in
`tickets/drafts/17-solver-integration.md` (commit `024715b`) — but that correction was never
copied into the live GitHub issue #41 that was actually queued tonight. The Analyst confirmed
this is Tier 3 (a CI-mechanism fact, not a product or escalation-tier question) and that QA
should mark this DoD item CANNOT VERIFY, with the actual proof deferred to Keshav triggering
`workflow_dispatch` manually after merge — the same shape as #29. **Worth checking the
drafts→issue authoring pipeline**, since this is the second time the same DoD pattern has needed
a manual correction after the fact.

As interim evidence, the Builder ran the actual pinned solver commit
(`45131c5a41d7caadb5cb626c012bfa9111dca7a2`) live end-to-end outside GitHub Actions, across all
three of `product-brief.md` §6c's named failure modes (optimal, time-limit/non-optimal, infeasible)
plus a fourth edge case (time-limit with no incumbent at all), and against a real local Postgres
with actual non-superuser `anon`/`service_role` logins to confirm the GRANTs behave as intended.
