# Ticket #85 — Track chip state and set expiry

## HIGH-IMPACT

None. No decision here fails the "expensive to reverse after ten more tickets" test — the data
shape, the module boundary and the constant citing the Gameweek 19 source were all specified by
the ticket itself.

## ROUTINE

- **The `squads` read is filtered to `source = 'api_sync'`.** The manual-entry screen (#13) never
  populates `chips_used` — it defaults to `[]` — so ordering across all sources by recency could
  return a later, empty manual row instead of an earlier, real synced one. The DoD's own phrase is
  "most recently *synced*," and only `api_sync` rows are synced.
- **`ChipSetView` carries a `slots` field** (a four-per-set used/remaining/lost checklist) beyond
  what the DoD literally named, so the screen renders each chip's status without re-deriving
  anything client-side — keeps the established fetch → derive → render split other screens use.
- **A chip usage with no recorded gameweek is classified `set: 'unknown'`.** It stays counted in
  `usedChips` / `hasUsedAnyChip` but is excluded from either set's `usedCount` / `remaining` /
  `slots` maths, since attributing it to a set without a gameweek would be a guess.
- **Calendar formatting for the chip-window deadline reuses `formatDeadlineInstant` from
  `src/lib/deadlineCountdown.ts`** rather than re-implementing Asia/Singapore weekday-first
  formatting a second time.
- **`src/lib/chips/api.test.ts` was added**, outside the ticket's originally listed file set. The
  DoD's "named test for the no-row case" exercises the Supabase query construction (source filter,
  ordering, limit) that lives only in `api.ts`, not in `derive.ts` — no fixture-only test could
  cover it. Uses the same fake-Postgrest pattern already established in
  `src/lib/verdict/api.test.ts`. QA reviewed this as a legitimate, necessary deviation rather than
  scope creep and endorsed keeping it.
- **Round 2 fix:** the summary headline count, both chip-set status-line counts, and the
  unclassified-chip gameweek number in `ChipsScreen.tsx` were not wrapped in the `.num` (Geist
  Mono, tabular figures) class on first pass — QA caught this against `design-reference.md`'s
  "tabular figures for every number" rule. Fixed by wrapping only the numeric portion of each,
  matching `VerdictCard.tsx`'s established pattern of not styling the surrounding prose words.
