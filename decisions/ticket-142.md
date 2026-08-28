# Ticket #142 — Set ft_value_list explicitly

## HIGH-IMPACT

None. This ticket is Tier 3 by its own classification: it stores no data, changes no schema, and
is deliberately a no-op on solver behaviour — it converts an already-inherited schedule
(`{"2": 2, "3": 1.6, "4": 1.3, "5": 1.1}`) into an explicitly-set, documented one. No Tier 1 or
Tier 2 question was hit.

## ROUTINE

- **FT-schedule key-direction, confirmed from `dev/solver.py` before writing the comment.** No
  copy of `dev/solver.py` is vendored in this repo — the solver is checked out fresh at CI time
  in `.github/workflows/solver-run.yml` from the pinned commit
  `45131c5a41d7caadb5cb626c012bfa9111dca7a2` and never committed here — so the source was fetched
  directly (`curl` against `raw.githubusercontent.com` at that exact commit SHA, cross-checked
  with a `WebFetch` read of the same URL) rather than assumed. The relevant lines
  (`dev/solver.py`, ~812–818):
  ```python
  ft_state_value = {}
  for s in ft_states:  # ft_states = [0, 1, 2, 3, 4, 5]
      ft_state_value[s] = ft_state_value.get(s - 1, 0) + ft_value_list.get(str(s), ft_value)
  ```
  This is a running total over `s`: `ft_state_value[s]` builds on `ft_state_value[s - 1]`, so
  `ft_value_list`'s own entry at key `s` is the *marginal* value added by the transition that
  *arrives at* `s` banked free transfers. **Confirmed: the keys are the transfer count being
  moved TO, not moved from** — key `"2"` prices going from 1 to 2 banked transfers, not from 2 to
  3 — exactly the direction product-brief.md and the ticket's own Context describe ("going from
  one transfer to two is worth 2 points"). This is recorded in `FT_VALUE_LIST`'s own comment in
  `scripts/build-solver-input.ts` so a future tuner does not have to re-derive it.
- **The inherited-settings audit `docs/solver-notes.md` has tracked since #95 is now closed.**
  `ft_value_list` was the one key `data/user_settings.json` ships that `buildSolverConfig` still
  left to silently inherit, after #108 (`no_transfer_last_gws`) and #120 (`decay_base`) closed the
  two scalars. `docs/solver-notes.md`'s audit table now shows every key as overridden, and its
  closing paragraph says so plainly.
- The value is exposed as a named exported constant, `FT_VALUE_LIST`, following the naming
  convention of the ticket's own precedent constants (`KEEP_TOP_EV_PERCENT`,
  `EV_PER_PRICE_CUTOFF` from #95; `NO_TRANSFER_LAST_GWS` from #108; `DECAY_BASE` from #120). Its
  comment states the shipped schedule, what it prices, the verified key direction (quoted above),
  and that it was reviewed and kept rather than inherited.
- The existing full-object-equality tests for `buildSolverConfig`'s and
  `buildRebuildSolverConfig`'s output (production baseline, `CHIP_PROBE`-unset, `CHIP_PROBE`-set,
  and both `wc`/`fh` rebuild variants) were all extended to include
  `ft_value_list: { "2": 2, "3": 1.6, "4": 1.3, "5": 1.1 }` rather than adding a separate one-off
  assertion, so any future accidental edit to any other key — not just `ft_value_list` — continues
  to fail the same guard, per #95/#108/#120's precedent that this is the most important test in
  tickets of this shape. Named tests were also added for the exact schedule value and for the
  chip-enabled/rebuild variants carrying the identical `ft_value_list`, per the ticket's DoD.
- No behaviour change: `npm run build`, `npm run lint` and `npm test` all pass clean (one
  pre-existing, unrelated failure in `scripts/ingest-core-insights.test.ts` — a migration-status
  string drift outside this ticket's scope constraint — was confirmed present on `origin/main`
  before this ticket's changes and is left untouched). A human must still dispatch a real
  `Solver run` after merge to confirm stored plans, horizon figures and the roll-versus-transfer
  decision are unchanged from the previous run, since the objective is built inside the Python
  solver at run time and cannot be verified from this repo alone.
