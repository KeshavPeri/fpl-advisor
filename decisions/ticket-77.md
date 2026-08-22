# Ticket 77 — Treat an FPL overall rank of zero as unranked

## HIGH-IMPACT

None. This ticket is Tier 3 throughout — a sentinel-value coercion at a single API-parsing
boundary, pre-classified as Tier 3 by the ticket itself. No Tier 1/2 decision was hit.

## ROUTINE

- Added `overallRankCoercedToNull: boolean` to the `EntryData` interface rather than inferring
  coercion later from `overallRank === null`, because that inference would be ambiguous — a
  genuinely-null/absent API value and a coerced `0` both end up `null`, and the ticket explicitly
  wants them distinguishable in `job_runs`.
- Stored the `job_runs.details` field as an integer `0`/`1` rather than a boolean, matching the
  ticket's own wording ("a counter... 0 or 1").
- Applied the rank note ("FPL reports no overall rank yet...") to all four `job_runs.message`
  paths that actually write/reconcile a `squads` row (picks-not-published, diff-detected,
  established, confirmed) rather than just one, so the explanation is visible regardless of which
  branch the sync takes on a given night. Correctly omitted on the "no deadline passed yet" path,
  since that path writes no squads row.
- Coercion treats negative numbers as unranked too, not just exactly `0`, per the ticket's
  explicit `-1 → null` DoD case and the "permanent rule about the API's sentinel" framing in the
  ticket's notes.
