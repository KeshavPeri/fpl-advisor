# Ticket #189 — Close three settled backlog questions and record G12/G13

## HIGH-IMPACT

None. This ticket is documentation-only — no code, model, or measurement changes, and every
figure it records is quoted verbatim from a report or review already in the repository.

## ROUTINE

- G8 heading suffix worded `— ANSWERED, INVERTED: 2 Sep 2026 model review`, matching the file's
  existing `— ADDRESSED by ticket #X, date` convention for closed items.
- New forward-assist entry named `## Forward assists — CLOSED, 2 Sep 2026: expected
  roster-churn artefact, not actionable`, a standalone (non-`Gn`) heading following the
  precedent already set by the file's `## G3 addendum` entry, rather than attaching it to an
  unrelated G-item.
- The new assist entry and G12/G13 were appended after G11 at the end of the file, matching the
  file's existing pattern of appending new entries at the end rather than inserting mid-file.

## Note

The 0.672/0.507 five-gameweek oracle-vs-model figure pair recorded in G13 is quoted from ticket
#189's own text (sourced from ticket #183) rather than independently re-derivable from any file
in this repository — QA confirmed the entry's wording matches that source and does not overstate
it as independently re-verified.

G12 records that its proposed next step — an in-harness variant sweep over the defensive slope
in `scripts/run-backtest.ts` — conflicts with ticket #187, which is editing that same file in
this same batch, and so must wait for a future batch.
