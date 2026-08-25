# Ticket #108 — Stop inheriting no_transfer_last_gws from the solver

## HIGH-IMPACT

- **Set `no_transfer_last_gws` to `0` explicitly in `buildSolverConfig`, overriding the solver's shipped default of `2`, because our horizon is 5 gameweeks and rolls forward every night, so there is no "end of season" for the shipped constraint to protect — any non-zero value bans transfers in gameweeks (4 and 5 of the horizon) we will genuinely use, which was silently distorting the multi-week plan, mis-valuing rolled free transfers via `ft_value_list`, and therefore biasing even the gameweek-1 recommendation.** This changes the behaviour of the optimiser at the heart of every recommendation, which is expensive to reverse once other work (Plan A/B/C horizon totals, free-transfer valuation) is built on top of it.

## ROUTINE

- Expressed the value as a named exported constant (`NO_TRANSFER_LAST_GWS`) with a comment documenting the shipped default, what the setting does, and why zero is correct — matching the existing convention for `preseason`, `xmin_lb`, `keep_top_ev_percent` and `ev_per_price_cutoff` in the same file, so the next Builder sees why it's explicit rather than inferring it.
- Added a full-object equality test asserting every other key in the built config is unchanged, following the same guard pattern ticket #95 established, so an accidental edit to an unrelated solver setting fails the build.
- Moved `no_transfer_last_gws` from the "inherited" to "overridden" column of `docs/solver-notes.md`'s audit table, leaving `decay_base: 0.9` as the sole remaining deliberately-inherited setting per the ticket's explicit scope.
