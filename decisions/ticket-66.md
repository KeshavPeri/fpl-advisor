# Ticket #66 — Chip cross-check: solution indexing and body layout

## HIGH-IMPACT

None. The mapping (`Solution N` -> `iter N-1`) and the header format (`** GW n:`) were both
pinned by the ticket's own Context section against the real captured log, not judgment calls —
every decision below is a convention choice within that spec.

## ROUTINE

- `parseGameweekChipLines` now returns a small discriminated union
  (`{perSolution:false, chips}` vs. `{perSolution:true, chipsByIterIndex}`) instead of a flat
  `ChipPlay[]`, rather than always building a per-solution map. Because a real log always carries
  `Solution N` headers, that branch (`perSolution:false`) exists ONLY so #132's existing tests —
  written against #126's flat, no-`Solution`-header model — keep passing unmodified, per the
  ticket's own scope constraint. It is not a format the real solver is expected to print.
- `mapSolutionNumberToIterIndex(n) = n - 1` is pulled into its own one-line named function rather
  than inlined at the two call sites (building the map, and documented in the file header) — the
  ticket's own wording ("The mapping lives in one named place with a comment stating the evidence
  above") asked for exactly that.
- `GW_HEADER_RE` was widened to match both the real `** GW n:` shape and the original bare `GW n`
  shape in one regex (`/^\*{0,2}\s*GW\s*(\d+)\s*:?\s*\*{0,2}$/i`) rather than trying the real
  pattern first and falling back to the old one — one regex is simpler than two, and the
  anchored-end-of-line requirement already keeps it from matching a Transfer Overview line like
  `GW2: (TC) Muharemović -> Thiaw`, which has real content after the colon.
- The whole-log fixtures (`FULL_CHIP_FREE_LOG`, `FULL_CHIP_ENABLED_LOG`) are the captured logs
  starting at `Filtered player pool from ...`, not from the very top of the raw stdout. The HiGHS
  solver's own console trace above that line (three repeated MIP solve blocks, ~120 lines each)
  carries no `Solution`/`GW`/`CHIP`/`Results` text and cannot affect the parse either way; keeping
  it out of the fixture is not "tidying" in the sense ticket #132 warned against — nothing
  structurally relevant was trimmed, only solver-internal noise this module never reads.
- The "naive same-number mapping would wrongly accept" regression test (DoD item 2) is built as a
  fresh minimal fixture, not a variant of the two full captured logs — the real logs all agree
  under the naive mapping too by coincidence of their content (every solution plays the same
  chips), so only a purpose-built fixture can distinguish "correct N-1 mapping" from "naive N
  mapping" behaviourally.
