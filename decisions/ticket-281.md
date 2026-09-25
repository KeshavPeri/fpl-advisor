# Ticket #281 — Season replay: measure the best hit threshold on 2025-26 with gbm-v1 and the real solver

## HIGH-IMPACT

- **Faked the pinned solver's own live `bootstrap-static`/`fixtures` calls via its own
  `utils.cached_request` file cache, seeded from vaastav's 2025-26 snapshot data**, instead of
  patching the solver's source. **Because** the pinned `dev/solver.py` at commit
  `45131c5a41...ca7a2` unconditionally calls the *live* FPL endpoints with no override hook, and
  FPL element ids are not stable across a season boundary (verified directly against the pinned
  source), so there is no other way to run "the real solver" (ticket's own item 4) against a past
  season without either editing its code — ruled out, since the ticket asks for the unmodified
  solver — or intercepting the cache layer it already ships, which uses the mechanism as
  designed rather than working around it.
- **GW1's from-scratch build (`preseason: true`) is excluded from hit-cost accounting, independent
  of which `hit_cost` setting is under test.** Because the ILP prices the mandatory 15-transfer
  build as a constant `15 × hit_cost` added to every feasible squad's objective at GW1 (verified
  against the pinned solver source), which cannot change which squad gets picked but would
  otherwise bias the season-long comparison against higher `hit_cost` settings purely as an
  artefact of how they're tested — the opposite of what item 5 needs to measure cleanly.
- **The never-transfer baseline never calls the solver.** Held-squad best-XI/captain selection is
  a pure enumeration over 8 valid formations, solved exactly in `rules.pick_best_lineup`, rather
  than routed through the ILP. Because a squad that by definition never changes has no transfer
  decision to solve for, and running it through the solver anyway would add ~37 needless calls
  while adding solver-noise (timeouts, near-ties) to the one baseline meant to be the cleanest
  comparison point.
- **`hit_limit: 0`** (a hard ILP constraint the pinned solver exposes) is used for the "no hits"
  setting, rather than a large `hit_cost` meant to deter hits economically. Because it matches
  "FT-only" exactly rather than approximately, and using the solver's own first-class option
  avoids picking an arbitrarily-large deterrent value that would itself need justifying.
- **Season-long prices/actuals are read once via `sources.load_history(('2026-27', 1))`**, which
  returns the full 2025-26 season (matching `evaluate.py`'s own established convention), rather
  than adding a second data-loading path. Because it keeps one source of truth for points,
  price (`value`), team and position across both the retraining evaluation code and this new
  replay code — a second path would be a second thing to drift, which `CLAUDE.md`'s
  "Sharing code between `scripts/` and `src/`" rule already flags as the wrong call for anything
  beyond a trivial helper.

## ROUTINE

- GW1's initial free-transfer ledger is set to exactly `1` for GW2 (not read from the solver's
  own `fts` output) — matches FPL's real "no banking before your first week played" rule and the
  pinned solver's own `calculate_fts` convention.
- Price fallback in `_bootstrap_elements`: vaastav `value` for the latest played gameweek before
  the decision gameweek, else `players_raw.csv`'s `now_cost` (applied uniformly pre-GW1) — kept
  internally consistent between what the solver's faked bootstrap uses to build the budget
  constraint and what `replay.py` records as each player's purchase price.
- Added JSON checkpointing (`--checkpoint-path`), writing after every completed gameweek — not
  asked for in the ticket, but the smoke run itself proved it necessary: an untested first attempt
  without it was killed mid-run by the sandbox and lost all progress. Trained fold models are
  deliberately *not* checkpointed — retraining at a fold cutoff is deterministic and cheap next to
  a solver call, so there's nothing worth persisting there.
- `fixture_lambda={}` passed to `project_horizon` for the whole replay — it only affects output
  metadata (`has_odds` / `lambda_for` / `lambda_against`) that this replay never reads; the
  model's actual odds *input* features still come from `combined_odds` and are unaffected.
- GW1's squad is built once per setting rather than shared across settings, even though all five
  settings start from the same GW1 state — each matrix job in the GitHub Actions workflow
  rebuilds it independently for job isolation, a deliberate, modest extra-compute trade-off in
  exchange for not needing cross-job state passing in the workflow.

## Builder's own report on tier classification

Builder flagged none of the above as needing the Analyst — none touch real money, personal data,
new accounts/credentials, or destructive live-data operations (escalation.md Tier 1), so no
ticket-blocking question was raised and the batch proceeded straight to QA.
