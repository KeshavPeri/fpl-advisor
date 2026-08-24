# Ticket #103 — Add the decision history

## HIGH-IMPACT

- **Override history entries render only "what was recorded," with an explicit honest note that
  the original recommendation was not preserved and cannot be shown or compared** — the DoD's
  three named tests (captain-only, transfer-only, both-differ) are reframed from field-level
  diff assertions to assertions that the recorded decision renders correctly and the gap note
  appears consistently. **Because** `recommendation_decisions.snapshot` (ticket #84) stores only
  seven decided-value keys (`is_roll`, `transfer_in_player_id`, `transfer_out_player_id`,
  `captain_player_id`, `vice_captain_player_id`, `hit_cost`, `solver_run_id`) with no
  `recommended_*` sibling anywhere in it, and `recommendations`/`solver_picks` are upserted in
  place by every nightly solver run with no history — so a live join to reconstruct "what was
  recommended" would silently show today's recommendation mislabeled as yesterday's, which is
  exactly what ticket #103's own Notes forbid ("a history that re-reads `recommendations` would
  silently rewrite the past") and what `product-brief.md` §6a's "no recommendation beats a wrong
  one" rules out. #103 is scoped with no migration and no change to `src/lib/commit/` or
  `src/lib/override/`, so there is no in-scope way to persist or reconstruct the recommended
  side. A real fix needs a new snapshot field captured at commit/override write time — a
  separate future ticket. Classified Tier 2 (not Tier 1: no real money, personal data, account/
  credential, or destructive live-data op involved) because this reinterprets acceptance tests
  that any future decision-history work will inherit, which is expensive to reverse once QA and
  downstream tickets are built against it.

## ROUTINE

(to be appended by the orchestrator as further routine decisions are reported by the Builder)
