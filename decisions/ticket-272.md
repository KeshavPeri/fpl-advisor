# Decisions — ticket #272

## HIGH-IMPACT
None this ticket. The ticket text fully specified the selection rule (≥3 settled gameweeks of
the active model to display it directly, else fall back to the version with the most settled
rows), the `pendingActive` shape, and the exact copy for the new muted line — leaving no
Tier 2 judgement call for the Builder to make.

## ROUTINE
- The `≥3 settled gameweeks` threshold is defined once as an exported constant in
  `src/lib/accuracy/derive.ts` and imported into `AccuracyCard.tsx` for the UI copy, rather than
  hardcoded a second time in the component string, because the ticket's own DoD ties the
  message's "3" directly to the gating threshold and a single source prevents the two drifting
  apart on a future tuning change. (Tier 3)
- `pendingActive.settledGameweeks` counts distinct settled gameweeks for the **active** model
  version specifically (not the fallback version's count), because the UI sentence reports the
  active model's own progress toward eligibility even while the card is still showing a
  different model's figures. (Tier 3)
- `config/projection-model.json` is read into `src/lib/accuracy/api.ts` via a Vite build-time
  JSON import rather than `node:fs`, matching CLAUDE.md's src/scripts compilation-boundary
  convention (the browser bundle uses the JSON-import path; `scripts/lib/activeModelVersion.ts`
  already uses the Node path for the same file). (Tier 3)
