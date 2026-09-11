# Ticket #225 — Decide penalties_order — settle whether xG already contains penalties, then apply a treatment or reject both

## HIGH-IMPACT

None. The ticket's central question — whether ingested xG already includes penalty value — turned
out to already be settled, and its two candidate treatments already measured and rejected, by
ticket #219 (merged, `docs/projection-model-backlog.md` entry G18) before this run began. No new
model-structure or methodology decision was made here; the Builder verified #219's finding still
holds and did not re-open it.

## ROUTINE

- **Scoped the ticket down at run time to the two DoD items #219/G18 did not already cover**,
  rather than re-running the xG-inclusion check or re-measuring Treatment A. The Builder stopped
  before writing code and reported that #225's own premise ("the question was not yet settled") no
  longer matched `main`: G18 already confirms xG-includes-penalties (25 isolated penalty-shot rows,
  mean xG 0.7899, stdev 0.0003) and already measured and rejected Treatment A (reduced shrinkage for
  `penalties_order = 1` takers) at K=3/2/1/0.5, finding it monotonically worsens Forward/Midfielder
  calibration. Dispatched the Analyst, which independently re-verified G18's content, the migration
  status in `supabase/README.md`, and the absence of any penalty-specific logic in
  `src/lib/projection/rates.ts` / `expectedPoints.ts` directly against the files rather than trusting
  the Builder's paraphrase, and classified continuing on this basis as Tier 3 — not a data-structure
  or methodology decision, just executing the ticket's own already-written DoD items minus the ones
  a prior ticket already satisfied. Re-dispatched the Builder to ship only: (1) the independent
  `event/{gw}/live/` cross-check the ticket's own text calls for, which #219 had not done (it used
  only FPL-Core-Insights CSVs), and (2) a model-layer regression test proving a
  `penalties_order = null` player's projection is unaffected, which the ingest-layer test in
  `scripts/ingest-fpl.test.ts` does not cover. This avoids both duplicate re-derivation of an
  already-rigorous finding and the risk of a fresh run's sampling noise being mistaken for a reason
  to second-guess it — `docs/projection-model-backlog.md`'s own Thread 3 already warns against
  re-tuning a constant already measured this way.
- **New backlog entry filed as G19**, cross-referencing G18 rather than duplicating its
  measurements — matches the file's existing numbering convention for entries that extend a prior
  G-entry's finding rather than standing alone.
- **Used `penalties_missed` (not `expected_goals` alone) as the independent cross-check's signal**
  from `event/{gw}/live/`, because that endpoint has no `penalties_scored` field — a miss is the
  only unambiguous "an attempt happened" signal it exposes, matching the same evidentiary logic
  ticket #218/#219 already used for `players.penalties_missed`.
- **The new regression test attaches `penalties_order` via a spread onto a typed variable
  (`{ ...takerLike, penalties_order: 1 } as PlayerProjectionInput`) rather than an inline object
  literal**, so TypeScript's excess-property check doesn't mask the exact leak scenario under test —
  a future caller passing the field through without the input type declaring it.
- Confirmed via direct diff against `origin/main` that `src/lib/projection/rates.ts` and
  `src/lib/projection/expectedPoints.ts` are unchanged by this ticket, and `scripts/project-points.ts`
  does not select `penalties_order` at all — the "ship neither treatment" outcome from #219 stands.
