# Decisions — ticket #13

## HIGH-IMPACT

- **Router: react-router v7 (`react-router` package, pinned `^7.18.2`, not v8).**
  Pre-answered in the ticket. Because `feature-list.md` wave 4 has at least four more screens
  coming (pitch view, verdict card, reasoning screen, accuracy display), a router is not
  premature, and retrofitting one after four screens exist is the kind of reversal Tier 2 exists
  to prevent. `react-router` (not `react-router-dom`) because v7 merged the two packages;
  `react-router-dom` is frozen at 7.18.2 as a compatibility shim while the bare `react-router`
  package has already moved on to v8 — pinning `^7.18.2` avoids an accidental v8 upgrade. (Tier 2)

- **Row Level Security on `squads` and `squad_picks`: `SELECT, INSERT, UPDATE, DELETE` granted
  to `anon`, on these two tables only.** Pre-answered in the ticket. Because this app has no
  authentication and no server (product-brief.md §3 puts accounts and auth permanently out of
  scope), so the browser's publishable key is the only writer available, and the data at stake —
  Keshav's own FPL squad — is already public via the unauthenticated `entry/{id}/` endpoint. Every
  reference table from #9 stays read-only; their writer is the ingest Action's secret key. (Tier 2)

- **Exactly-15-picks, exactly-11-starters and formation legality are UI-enforced only, not
  database constraints.** Pre-answered in the ticket. Because each rule spans all fifteen rows of
  a gameweek at once, which needs a deferred constraint trigger — substantial PL/pgSQL to write,
  test and maintain for a single-user app whose only realistic writer is the entry screen itself.
  The database enforces everything a plain (partial) unique index can express — no two picks share
  a squad position (the table's own primary key), no duplicate player, at most one captain, at
  most one vice-captain — and `src/lib/squad/validate.ts` enforces the rest, each rejection naming
  what's wrong and what to do about it. (Tier 2)

- **`squads.gameweek_id` is the primary key, not a surrogate id.** Because this is a single-user
  app (product-brief.md §3), "the squad for gameweek N" is naturally exactly one row; whichever
  process last wrote it — this manual-entry screen today, the API sync in #14, or a registered
  override in wave 4 — overwrites it, and `source` records which. A surrogate key would let two
  "current" squads exist for the same gameweek with no way to say which one counts. (Tier 2)

- **Position codes (1 GK, 2 DEF, 3 MID, 4 FWD) are not read from an `element_types` reference
  table, because that table does not exist.** The ticket's notes say to take them from
  `element_types` "in the reference schema", but #9's migration scoped the reference schema to
  exactly four tables (teams, players, fixtures, gameweeks) and never created `element_types` —
  it only appears in #9's ticket text as one of bootstrap-static/'s top-level JSON keys, not as a
  table it built. Two options existed: add an `element_types` table now (out of scope for a
  squad-state migration, and this ticket has no ingest step to populate it — "no changes to the
  ingest scripts" is explicitly out of scope), or define the codes as named constants once and
  import them everywhere, same convention `players.element_type`'s own column comment already
  documents ("1 GK, 2 DEF, 3 MID, 4 FWD"). Chose the latter: `src/lib/squad/positions.ts`, a new
  small module, is the squad feature's single source for the codes — not scattered magic numbers.
  It does **not** reuse `src/lib/scoring/types.ts`'s identical-looking constants: that module's own
  header states it deliberately has "no dependency on how the rest of the app models a player"
  (ticket #15's own scope), and importing it here would create exactly the coupling that was
  written to avoid. This is a real gap between what the ticket assumed and what #9 actually built;
  flagging it here rather than quietly hardcoding it as if nothing were amiss. (Tier 2)

## ROUTINE

- **Bench order is derived, not a user-editable field.** The four non-starting picks are numbered
  1-4 in `squad_position` order (lowest substituted first) when the squad is saved. A free-choice
  selector would need its own duplicate-order validation for no real benefit at this stage — the
  schema still gets a real, distinct `bench_order` per bench pick.
- **Squad value is a manual `£m` input, matching the ticket's literal wording** ("set … bank and
  squad value"), not auto-computed from the picks — with a read-only "Selected players total: …"
  hint underneath for reference, so a mismatch is visible without forcing one number to always
  equal the other.
- **`free_transfers` got its own manual input (defaulting to 1), even though the ticket's
  screen-scope sentence didn't list it among the fields to set.** The migration's own DoD requires
  the column and it's `NOT NULL`; the schema section of the same ticket does list it as one of the
  three squad-row values. Leaving it with no honest source of truth seemed worse than a small extra
  field.
- Money (`bank`, `squad_value`) is stored and parsed as an integer in tenths of a million, matching
  `players.now_cost`'s own convention (#9) — never a float. `formatMoney` / `parseMoneyInput` /
  `tenthsToInputString` live in `src/lib/format.ts` as the one shared implementation.
- Captain and vice-captain selectors only list starting-XI players — matches real FPL (a bench
  player can't be captained) even though the DoD doesn't explicitly require it; it was equally
  cheap either way and the alternative allows a nonsensical state.
- `Surface.tsx` (#8) now forwards standard `div` attributes (`role`, `aria-*`, …) instead of only
  `children`/`raised`/`className`, so the new validation/save-confirmation panels can use
  `role="alert"` / `role="status"` without a second wrapper element. No visual or behavioural
  change for existing callers (`HomeScreen`).
- `squad_position` 1-15 is assigned by fixed position blocks (1-2 GK, 3-7 DEF, 8-12 MID, 13-15
  FWD), not free assignment, so the table's `PRIMARY KEY (gameweek_id, squad_position)` is
  meaningful and stable rather than an arbitrary tie-breaker.
- Added a Vitest suite (`src/lib/squad/validate.test.ts`) covering the ticket's own worked
  formation examples (2-5-3 rejected, 3-4-3 and 3-5-2 accepted) plus the count/captaincy/money
  rules, matching the existing `src/lib/scoring/*.test.ts` convention in the repo.
