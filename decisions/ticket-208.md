# Ticket #208 — Learned model, second slice

## HIGH-IMPACT

None. The model choice below is recorded as ROUTINE per the Analyst's ruling (Tier 3) — see
that entry for the reasoning.

## ROUTINE

- **Marked complete with the gate unread.** The Builder sandbox has no Supabase credentials, so
  the result table and gate pass/fail are delivered as tested, working code rather than
  populated numbers, per the ticket's own note ("no live database read is required at build
  time … the same way `build-training-features.ts` runs") and the identical pattern already
  shipped in #133 (backlog entry G9), #147 (G11) and #203 — the gate is read by Keshav (or the
  next scheduled/dispatched job) post-merge, not by this run. Classified Tier 3 by the Analyst:
  this doesn't structure data, choose a framework, or commit to a hard-to-reverse dependency —
  it applies a pattern this repo has already settled three times before.
- **Model: hand-written gradient-boosted regression trees, no npm ML dependency** — 60 trees,
  max depth 3, learning rate 0.08, min 40 samples/leaf, fixed before touching real data (no
  tuning against the gate). Chosen because the ticket's scope constraint forbids a
  `package.json` edit and asked for something small and inspectable, not a neural network.
- **15 feature columns used** (`FEATURE_NAMES`): element type; prior-matches count; unshrunk
  xG/xA per 90; last-5-match minutes average (falls back to season average); season average
  minutes; shots-on-target per match; defensive-contribution hit rate plus its evidence volume;
  own-club goals-scored/conceded-per-match plus evidence volume; opponent(s)
  goals-scored/conceded-per-match pooled across a double gameweek, computed live via
  `computeTeamStrengthAsOf` since `training_features` doesn't store it; fixture count.
- **Columns dropped: none new.** The four already recorded in backlog entry G15 (total shots,
  chances created, big chances missed, touches in opposition box) remain un-ingested; nothing
  else was available to drop.
- **Split: gameweek-block (≤28 train / &gt;28 eval), not row-random** — required so a
  five-gameweek window's legs never straddle both folds. A named leakage test proves fitting on
  the train fold is unaffected by values planted only in eval-fold rows.
- **Five-gameweek leg construction** mirrors ticket #193/backlog-entry-G13's discipline (form
  pinned at window start, only fixture identity varies per leg), reapplied to the learned model,
  with dedicated tests proving it.
