# Decisions — ticket #54

## HIGH-IMPACT

None this ticket.

## ROUTINE

- **`scripts/lib/competition.ts` sorts its known-competition tokens longest-first before
  prefix-matching against the `match_id` slug**, rather than matching in declaration order.
  **Because** none of today's six competition tokens collide as prefixes of one another, but a
  future addition might (the ticket's own notes name the FIFA Club World Cup, the Community
  Shield and the UEFA Super Cup as plausible next additions), and a silent false-match on a new
  token is exactly the class of contamination this ticket exists to stop. Purely local to the
  parser's private constant, trivially reversible — does not meet the Tier 2 bar on its own
  (QA's read on this matches the orchestrator's), logged here as a routine defensive choice.
  (Tier 3)
- **The two exclusion-count queries added to `scripts/calibration-report.ts` are scoped to
  `TARGET_SEASON`**, matching every other read already in that file, rather than left
  season-unscoped. **Because** an unscoped count would mix in prior-season rows that have
  nothing to do with this report's job, undermining the very exclusion counts item 54 exists to
  make trustworthy. (Tier 3)
- **`matchRowsWithCompetition` is computed and reported in `ingest-core-insights.ts`'s
  `job_runs.details` even though it is currently always equal to `matchRowsWritten` by
  construction** (an unknown-competition slug throws and aborts the whole run before any row is
  upserted, so every row that does get written necessarily carries a non-null `competition`).
  **Because** the definition of done asks for this count explicitly, and computing it
  defensively rather than assuming the invariant holds costs nothing and stays correct if the
  fail-loud behaviour is ever relaxed later. (Tier 3)
