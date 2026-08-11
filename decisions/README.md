# Decisions log — one file per ticket

Each ticket's decisions live in `decisions/ticket-<number>.md`, written by the orchestrator on
that ticket's own branch and landing on `main` when the PR merges.

**Why not one shared file.** Until 11 Aug 2026 every decision was appended to `decisions.md` in
the repo root. The batch limit is two tickets per run, both branches fork from the same `main`
tip, and neither can see the other — so both appended at the identical point in that file and
the second merge always conflicted. Git conflicts on *position*, not on content, so giving each
entry a ticket-scoped number would not have fixed it. Two branches touching two different files
merge cleanly, always.

`decisions.md` in the repo root is the archive of everything logged before the split. It is
read-only; nothing appends to it now.

## Shape of a file

```
# Decisions — ticket #NN

## HIGH-IMPACT
- Chose X **because** the brief says Y. (Tier 2)

## ROUTINE
- Accent hex set to #NNNNNN. (Tier 3)
```

HIGH-IMPACT is every Tier 2 decision and must state the *because* — a reader has to be able to
spot a misread brief in three seconds. ROUTINE is everything else worth a line. If a ticket
genuinely produced no decisions, say so in the file explicitly rather than omitting it: an empty
log and a log that stopped being written look identical.
