# Ticket #120 — Set decay_base explicitly

## HIGH-IMPACT

None. This ticket is Tier 3 by its own classification: it stores no data, changes no schema, and
is deliberately a no-op on solver behaviour — it converts an already-inherited value (`0.9`) into
an explicitly-set, documented one. The scalar audit begun in #95 and continued in #108 is now
complete; `ft_value_list` remains the one inherited (non-scalar) key, left for its own future
ticket as the ticket's Notes specify.

## ROUTINE

- The value is exposed as a named exported constant, `DECAY_BASE`, following the same naming
  convention as the ticket's own precedent constants (`KEEP_TOP_EV_PERCENT`, `EV_PER_PRICE_CUTOFF`
  from #95). Its comment states the shipped value (`0.9`), the discount mechanics
  (`decay_base^n` per gameweek offset into the horizon), the effective weight of the last
  gameweek of a 5-gameweek horizon (`0.9^4 ≈ 0.656`, ~66%), and that the value was reviewed and
  kept rather than inherited.
- The existing full-object-equality tests for `buildSolverConfig`'s output (three baselines,
  covering the `CHIP_PROBE`-unset and `CHIP_PROBE`-set cases) were extended to include
  `decay_base: 0.9` rather than adding a separate one-off assertion, so any future accidental
  edit to any other key — not just `decay_base` — continues to fail the same guard, per #95 and
  #108's precedent that this is the most important test in tickets of this shape.
