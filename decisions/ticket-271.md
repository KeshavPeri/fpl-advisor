# Decisions — ticket #271

## HIGH-IMPACT
None this ticket. The two judgement calls the Builder flagged were reviewed against the
escalation test question ("expensive to reverse after ten more tickets?") and both land as
Tier 3 — see ROUTINE below.

## ROUTINE
- `LEAGUE_ID = 848654` is duplicated as a plain numeric literal in `src/lib/miniLeague/api.ts`
  instead of importing `config/mini-league.json` on the frontend side, because
  `tsconfig.app.json`'s `include` root doesn't cover `config/`, and this ticket's file scope
  didn't list a tsconfig change to cross that boundary (CLAUDE.md's rule: a ticket crossing this
  boundary for the first time must name the build config file too, or it hands the Builder a
  contradiction). `scripts/ingest-mini-league.ts` reads the same file via `readFileSync` instead,
  so there is exactly one place values could drift (the frontend literal), it's a public,
  non-secret integer, and reversing it later (once a ticket legitimately widens the tsconfig
  boundary) is a one-line change. Not HIGH-IMPACT: trivially reversible, no downstream tickets
  depend on the duplication itself. (Tier 3)
- `last_rank` is stored and displayed as the raw value the FPL API returns, with no special-case
  transform for a manager's first recorded gameweek (where the field may come back as a
  placeholder `0`), because verifying FPL's actual behaviour here needed live network access the
  Builder didn't have this session. Documented as an open, unverified assumption in the
  migration header and in `derive.ts`'s doc comment rather than guessed at. Low risk: it's
  display-only (movement arrow/gap text), not read by the optimiser, and easy to patch once
  observed against a real early-season standings row. (Tier 3)
- Card falls back to showing the league's top 3 rows when Keshav's own entry isn't found in the
  standings yet, rather than rendering nothing, matching the "graceful degrade, don't go blank"
  convention used elsewhere in the app (e.g. `AccuracyCard`'s empty state). (Tier 3)
- Colour convention: cyan for rank-up movement, coral for rank-down, neutral for flat/unknown —
  direct reuse of `design-reference.md`'s existing cyan-good/coral-bad rule (no green/yellow).
  (Tier 3)
- Rank figure sized at `--text-headline`, not `--text-display`, reserving the one `--text-display`
  figure per home screen for the verdict card (design-reference.md), so the new card doesn't
  visually compete with it. (Tier 3)
- Table rows deduplicate by `entryId` (e.g. leader/above collapse to one row when Keshav is 2nd)
  rather than always rendering four fixed slots. (Tier 3)

**Process note:** two new fixture files (`scripts/fixtures/mini-league-standings-page-{1,2}.json`)
and a 3-line addition to `src/screens/HomeScreen.css` were touched outside this ticket's listed
file scope. Both are minimal and directly forced by the definition of done (the two-page
pagination test; card spacing on the screen the ticket explicitly wires the card into) — see the
end-of-run note for visibility to Keshav.
