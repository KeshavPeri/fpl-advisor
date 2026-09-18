# Ticket #249 — Measure captaincy: regret and rank against a naive baseline

## HIGH-IMPACT

- **Tier 2 — `prediction_log.projected_points` used as the naive-baseline captain's projection,
  not a field on `notifications.plan_snapshot`.** **Because** `plan_snapshot` only carries the
  whole plan's aggregate `expectedPoints`, with no per-player figure anywhere in the database —
  the settled `prediction_log` row's `projected_points` is the closest available proxy for what
  the projection stood at when the plan was issued, verified by tracing `scripts/settle-predictions.ts`
  to confirm it writes `projected_points` back unchanged at settlement. Accepted by Keshav as the
  right proxy, with the requirement that the code say plainly it is a proxy, not the frozen
  snapshot figure itself — added as explicit comments in `scripts/recommendation-scorecard.ts`
  (the file-header block and the `PredictionLogRow.projected_points` field doc).

## ROUTINE

- **Tier 3 — "chosen captain" = the effective (post-armband-promotion) captain**, not the
  literal named one. When the named captain plays 0 minutes, FPL itself promotes the armband to
  the vice — that's who actually got doubled on Keshav's scoreboard, so regret and rank score
  against that player. The separate vice-captain report compares the named captain's actual (0)
  against the named vice's actual, only for the gameweeks where this triggered.
- **Tier 3 — rank tie-break: standard competition ranking** (ties share the better rank; the next
  distinct score skips ranks accordingly). "1 = best" was specified in the ticket; the tie
  convention wasn't.
- **Tier 3 — best-available / naive-captain tie-break: lowest player id wins**, for a
  deterministic single answer with no football meaning attached.
- **Tier 3 — population is every gameweek with a stored Plan A, independently re-checked for a
  `plan_snapshot`.** A gameweek scored via the mutable-table fallback elsewhere in the scorecard
  is still excluded here by name (`noSnapshot`), never silently reused — matches the ticket's
  explicit "never fall back" instruction.

All four Tier 3 calls above and the Tier 2 proxy decision were accepted as-is by Keshav (18 Sep
2026), who additionally corrected his own original DoD text: a live-data hand-run is an owner
step after merge and must not block the PR, since this pipeline has no Supabase access from any
cloud session (per `decisions/ticket-175.md`).
