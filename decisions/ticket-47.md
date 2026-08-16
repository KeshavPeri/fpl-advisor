# Decisions — ticket #47

## HIGH-IMPACT

- **`transfers_made` and `free_transfers_available` are derived, not read from the solver's own
  `ft`/`transfer_count` CSV columns** — **because** those columns arrive as noisy floats (a true
  `1` can show up as `0.9999999999999996`) and, on inspection, `scripts/store-solver-output.ts`
  (ticket #41, out of this ticket's scope) never persists either column into `solver_picks` —
  only the transfer-in/out flags and the squad's own free-transfer count are available.
  `transfers_made` is instead counted as an exact integer from the `is_transfer_in` flags;
  `free_transfers_available` is read from `squads.free_transfers` — the same number the solver
  itself was given. Both are still routed through the rounding guard as a defensive no-op.
  Verified independently by QA against `store-solver-output.ts` and the `solver_output`
  migration — the workaround is correct, not a scope violation. (Tier 2)
- **Each plan's ranking score is reconstructed from the stored lineup/captaincy flags
  (Σ captaincy-multiplier × expected points over `is_lineup` picks) rather than read from a
  single stored per-iteration objective** — **because** only `solver_runs.objective_value` (one
  figure for the whole run) is stored, not a per-solution score. This is the only per-solution
  ranking signal actually available in `solver_picks`, and it mirrors the solver CSV's own
  `xp_cont` semantics exactly. (Tier 2)
- **`recommendations.coverage` (jsonb array) added as a structured column beyond the migration's
  initially-planned fields** — **because** the definition of done asks for both a *stored flag
  per named player* (structured, queryable) and a *prose reason* for coverage gaps (text), and
  only the prose existed after the first implementation pass. A future screen can filter or
  badge on this without re-parsing reasoning text. (Tier 2)

## ROUTINE

- **Confidence thresholds `CLEAR ≥ 2.0`, `MARGINAL 0.5–2.0`, `COIN-FLIP < 0.5`** — pre-answered
  by the ticket itself, named as constants in one place, and explicitly logged here as
  **uncalibrated**: `product-brief.md` §9 open question 2 says the real thresholds should come
  from the backtest once it exists. (Tier 3)
- **A single-solution solve (no Plan B to compare against) defaults to `clear` confidence** —
  nothing to hedge against — with the coverage floor still applied per plan. Flagged as a
  non-blocking observation by QA: a lone plan isn't more confident than a close pair, it's just
  uncontested, worth a second look once real multi-plan data exists. (Tier 3)
- **Coverage is checked for transfer-in, transfer-out, captain and vice-captain** (not the full
  15-man squad) — these are what's "named in a recommendation" per `product-brief.md` §8's own
  example. (Tier 3)
- **Single-row primary-key lookups (`squads` by `gameweek_id`, `solver_runs` by `id`) are plain
  queries, not paginated** — matches the precedent already established in `decisions/ticket-43.md`
  that small/bounded reads are exempt; pagination + count-check is applied to every genuinely
  multi-row read (`solver_picks`, `players`, `player_match_stats`). QA independently confirmed
  both are real primary keys, so the exemption is correctly scoped, not used to dodge pagination
  on a multi-row read. (Tier 3)
- **The new "Generate recommendations" workflow step is gated on
  `steps.store.outcome == 'success'` in addition to `squad_found`**, so a failed store step
  can't silently let this job re-process stale picks under an otherwise-green run. (Tier 3)
- **Reasoning wording follows `design-reference.md`'s interface-writing rules** — sentence case,
  plain verbs, no filler, FPL's own vocabulary, no emoji, confident roll-your-transfer phrasing
  ("Roll your transfer. No changes recommended this gameweek.", not a null or hedge). (Tier 3)
