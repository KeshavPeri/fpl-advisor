## Context

**Every multi-page Supabase read in this repository issues its pages with no `ORDER BY`, and
Postgres guarantees no stable row order between separate queries without one.** Paging a 14-page
table means fourteen independent queries; between any two of them the server may return rows in a
different order, so one row arrives on two pages and another arrives on none.

`scripts/lib/paginate.ts` (ticket #43) was built to stop a *truncated* read. It does that
correctly. **Its count assertion is structurally blind to this failure** — one row duplicated and
one row dropped leaves the total unchanged, so `assertRowCountMatches` passes on a corrupt read.
`LEARNINGS-second-build-wave.md` §12 records this as the fourth instance of "fixing the instance is
not fixing the class": the fix was written against the symptom observed (truncation), and nobody
enumerated the class's other failure modes.

### The confirmed instance

**Preflight check 7 currently FAILS: `player_code 487676 has 39 Premier League matches in season
2025-2026`.** A direct SQL query against the same data returns exactly 38 rows, one `player_id`,
gameweeks 1–38, no duplicates. **The data is correct; the paginated read is wrong.**
`scripts/preflight-check.ts:1508` pages `player_match_stats` filtered to `competition = 'prem'` —
13,192 rows, 14 pages, no `.order()`. One row came back twice.

### The exposure, stated honestly — this is not the same as damage

Live row counts, 29 Aug 2026:

| Read | Rows | Pages | State |
|---|---|---|---|
| `feature_history` | 18,246 | 19 | multi-page, unordered |
| `player_match_stats` (all) | 15,991 | 16 | multi-page, unordered |
| `player_match_stats` (`competition = 'prem'`) | 13,192 | 14 | **confirmed mis-reading (check 7)** |
| `player_projections` (5-gameweek horizon) | 3,110 | 4 | multi-page, unordered |
| `prediction_log` (unsettled) | 1,238 | 2 | multi-page, unordered |
| `solver_picks` | 623 | 1 | single page today, grows every run |
| `players` | 622 | 1 | single page today |
| `prediction_log` (settled) | 599 | 1 | single page today, grows ~600/gameweek |

**Only check 7 is confirmed damage.** Everything else in that table is exposure. In particular:

- **The projections CSV handed to the solver has NOT been corrupted.** `emit-projections-csv.ts`
  already counts every player-gameweek pair it had to zero-fill, in
  `job_runs.details.playerGameweekPairsZeroFilled`. The last ten runs all report **0** against
  3,110 rows over 4 pages. The recommendation path is clean on the evidence.
- **Do NOT write into this ticket, its decisions log or the PR body that the backtest and
  calibration numbers are known to be wrong.** They are *unverifiable*, which is a different
  claim and the only one the evidence supports. Asserting more would repeat exactly the defect
  `LEARNINGS-second-build-wave.md` §13 records — a guess written into a specification and then
  treated as established fact by QA, the reviewer and the human.

### Why it has mostly held so far, and why that is not safety

Unordered row order is *unspecified*, not *random*. A small table written once and read by one job
returns the same scan order in practice. Reordering shows up on large tables read while another job
is writing them — which is exactly where the one confirmed symptom lives. **Every table here only
grows**, so the current margin is a function of row count, not of correctness.

Depends on nothing unmerged.

## Scope

**In scope:**

- **A guard inside `scripts/lib/paginate.ts` that REFUSES a page request carrying no ordering.**
  This is the half that makes it a class fix rather than 31 more things for 31 future authors to
  remember. See the Notes for the mechanism, which must be verified against the installed
  `@supabase/postgrest-js`, not assumed.
- **A deterministic `.order()` on the table's full primary key at every unordered paginated call
  site** — 22 in `scripts/*.ts`, 9 more in `scripts/preflight-check.ts` via its own
  `safeFetchAllPages` wrapper. The enumeration is in the Notes.
- **Fixing `src/lib/accuracy/api.ts`, which has an `.order()` and is still wrong.** It pages
  `prediction_log` ordered by `gameweek_id` alone — roughly 600 rows tie on every value, so their
  relative order across pages is unspecified. **An `.order()` on a non-unique column is not a fix.**
- **A row in `decisions/ticket-<number>.md` for every call site**, naming the table, the ordering
  applied, and the primary key it matches.

**Explicitly out of scope:**

- **No migration, no schema change, no index.** Every table already has a primary key; this ticket
  orders by keys that exist.
- **No change to what any job computes, reports or writes.** Only the order rows arrive in.
- **No change to `assertRowCountMatches`'s behaviour or to the count queries.** The count assertion
  stays; it is not the guard being added and it is not being replaced.
- **No re-running of the backtest, the calibration report or `project-points` as part of this
  ticket**, and no edit to `docs/projection-model-backlog.md`. Reading the corrected instruments is
  a later ticket's work.
- **No `DEFAULT_PAGE_SIZE` change.** The 1,000 ceiling is a server-side project setting and is not
  what this ticket is about.
- **No new dependency.**

## Definition of done

- [ ] `scripts/lib/paginate.ts` throws a named error (e.g. `UnorderedPaginationError`) when
      `fetchPage` returns a query that carries no ordering, **before** the first page is awaited.
- [ ] **The guard fails closed.** If the returned object's shape is not recognisable — a future
      `@supabase/postgrest-js` that no longer exposes the query URL, or a hand-rolled stub — the
      guard **throws** rather than passing the call through. A named test asserts this with a plain
      object. **This item is what stops the guard silently disabling itself on a dependency bump.**
- [ ] A test asserts an ordered query passes the guard and an unordered one throws, both against a
      query built by the real installed client, not a hand-written mock of it.
- [ ] Every paginated call site listed in the Notes carries an `.order()` chain matching that
      table's **full primary key**, in a fixed direction, ordered outermost-key first.
- [ ] `src/lib/accuracy/api.ts` orders by `(gameweek_id, player_id, model_version)` — the full
      primary key — not by `gameweek_id` alone.
- [ ] **Grep-checkable:** every `.range(` in `scripts/` and `src/` appears in a chain that also
      contains `.order(`. No exceptions, including single-page reads.
- [ ] `decisions/ticket-<number>.md` carries a table of call site → table → ordering applied →
      primary key, and one HIGH-IMPACT entry with its *because*.
- [ ] Every existing test passes **unmodified** except where a test asserts on the absence of
      ordering. No test's expected value is copied from failing output.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the tests prove the guard fires and the chains compile.
      They cannot prove a live read is now stable, because a corrupt read and a clean one are
      indistinguishable after the fact. **The human check after merge is dispatching `Preflight
      check` and confirming check 7 passes** — the one place where a wrong read produces a number
      that is provably impossible (39 matches in a 38-match season). **What will NOT change:** the
      backtest's MAE, signed errors and Spearman figures may move slightly or not at all, and
      either outcome is consistent with this ticket being correct. Do not read a small movement as
      evidence of anything.

## Notes for the Analyst / Builder

**The guard cannot be built the obvious way, and this is the crux of the ticket.** `fetchAllPages`
takes an opaque thunk `(from, to) => PromiseLike<PageResponse<T>>`. It cannot see whether the caller
ordered anything, so "refuse an unordered request" is not implementable against that signature as
written.

**The mechanism that does work, verified against the installed dependency on 29 Aug 2026.** The
thunk returns the PostgREST builder *synchronously*, before it is awaited, and `order()` in
`node_modules/@supabase/postgrest-js/dist/index.mjs` writes its clause into
`this.url.searchParams` under the key `order`. So `fetchAllPages` can inspect the returned object
and throw before awaiting a single page. **Two things the Builder must handle rather than assume:**

- `url` is declared `protected` in the shipped `.d.ts`, so this needs a narrow, commented
  structural access — not a blanket `any`.
- **A referenced-table ordering writes a different key** (`<table>.order`), so the guard checks for
  the bare `order` key specifically.

**If that mechanism turns out not to work against the installed version, say so and stop rather
than substituting a weaker guard.** A required `ordering` parameter that each caller passes and the
helper never verifies is not a guard — it is the same invariant, moved. That is a legitimate Tier 2
escalation and it should be logged, not worked around.

**Ordering must be on a UNIQUE key.** This is the whole reason `src/lib/accuracy/api.ts` is in
scope: it already calls `.order()` and is still broken. A ticket that adds
`.order('gameweek_id')` to `feature_history` would look finished and would fix nothing.

**The enumeration. 31 unordered sites, plus one non-unique.** Line numbers are as of `2de45fd` and
are a locator, not an authority — match on the query.

`scripts/build-feature-history.ts:559` `player_match_stats` → `(player_id, match_id)`
`scripts/calibration-report.ts:1188` `players` → `(id)`
`scripts/calibration-report.ts:1236` `player_match_stats` → `(player_id, match_id)`
`scripts/calibration-report.ts:1304` `player_projections` → `(gameweek_id, player_id, model_version)`
`scripts/emit-projections-csv.ts:400` `players` → `(id)`
`scripts/emit-projections-csv.ts:447` `player_projections` → `(gameweek_id, player_id, model_version)`
`scripts/emit-projections-csv.ts:512` `player_projections` → same
`scripts/generate-recommendations.ts:426` `solver_picks` → `(solution_index, gameweek_id, player_id)`
`scripts/generate-recommendations.ts:474` `solver_picks` → same
`scripts/generate-recommendations.ts:731` `player_match_stats` → `(player_id, match_id)`
`scripts/generate-recommendations.ts:769` `players` → `(id)`
`scripts/notification-schedule.ts:211` `notifications` → `(id)`
`scripts/project-points.ts:511` `players` → `(id)`
`scripts/project-points.ts:610` `player_match_stats` → `(player_id, match_id)`
`scripts/run-backtest.ts:1791` `players` → `(id)`
`scripts/run-backtest.ts:1818` `feature_history` → `(season, gameweek_id, player_code)`
`scripts/run-backtest.ts:1862` `player_match_stats` → `(player_id, match_id)`
`scripts/send-telegram.ts:405` `recommendations` → `(gameweek_id, plan_index)`
`scripts/settle-predictions.ts:453` `prediction_log` → `(gameweek_id, player_id, model_version)`
`scripts/settle-predictions.ts:522` `fixtures` → `(id)`
`scripts/settle-predictions.ts:577` `prediction_log` → same
`scripts/snapshot-predictions.ts:269` `player_projections` → `(gameweek_id, player_id, model_version)`

Via `safeFetchAllPages` in `scripts/preflight-check.ts`:
`:1259` `squad_picks` → `(gameweek_id, squad_position)`
`:1298` `player_projections` → `(gameweek_id, player_id, model_version)`
`:1315` `players` → `(id)`
`:1325` `teams` → `(id)`
`:1332` `fixtures` → `(id)`
`:1454` `teams` → `(id)`
`:1470` `fixtures` → `(id)`
`:1508` `player_match_stats` → `(player_id, match_id)` — **this is the failing check 7**
`:1575` `notifications` → `(id)`

Non-unique ordering, already present, still wrong:
`src/lib/accuracy/api.ts:~82` `prediction_log` — currently `(gameweek_id)`, must become
`(gameweek_id, player_id, model_version)`

**Already correct — do not touch, and do not "tidy":** `scripts/notification-schedule.ts:174`,
`scripts/send-telegram.ts:380`, `scripts/send-telegram.ts:471`,
`scripts/snapshot-predictions.ts:226`, `scripts/preflight-check.ts:1220`.

**Order single-page reads too, and this is deliberate.** `players` at 622 rows and `teams` at 20 are
one page today and safe today. They will not stay that way, and a call site that is "safe because
the table is small" is a comment nobody will re-check when the table grows. The guard refuses them
anyway, so the choice is between ordering them and exempting them; exempting them is how this class
of bug returns.

**`src/` and `scripts/` are separate compilation environments and the sharing rule runs one way**
(`scripts/` may import `src/lib/`, never the reverse — `CLAUDE.md`). `src/lib/accuracy/api.ts`
therefore cannot import the guard and keeps its own loop. **Fix its ordering; do not restructure it
to share code**, and do not add a `src/`-side copy of the guard. That is a real limitation and it
belongs in the decisions log as such.

**This ticket is the sweep the pipeline cannot normally do.** `LEARNINGS-second-build-wave.md` §16a
records that a scope constraint naming exact files is what makes a batch safe *and* what guarantees
no agent is ever permitted to ask "does this mistake exist elsewhere". This ticket asks that
question deliberately, which is why its file list is long and why it runs with at most one
companion that touches `src/lib/projection/` only.

**This is Tier 2** — it changes how every job in the repository reads data. Log it as HIGH-IMPACT
with its *because*, and state in the entry that the guard is the point, not the 31 `.order()`
calls.

**One companion ticket may be running in this batch**, touching `src/lib/projection/` and
`decisions/` only. This ticket touches neither, and **must not change any exported signature in
`src/lib/projection/`** — `scripts/run-backtest.ts` is edited here and imports that module, so a
type change on either side breaks `tsc -b` on the second merge even though the file lists are
disjoint (`LEARNINGS-second-build-wave.md` §11).

## Scope constraint

Nothing outside the following files changes:

- `scripts/lib/paginate.ts`, `scripts/lib/paginate.test.ts`
- `scripts/build-feature-history.ts`, `scripts/calibration-report.ts`,
  `scripts/emit-projections-csv.ts`, `scripts/generate-recommendations.ts`,
  `scripts/notification-schedule.ts`, `scripts/preflight-check.ts`, `scripts/project-points.ts`,
  `scripts/run-backtest.ts`, `scripts/send-telegram.ts`, `scripts/settle-predictions.ts`,
  `scripts/snapshot-predictions.ts`
- The matching `*.test.ts` beside any of the above, **only** where an existing test asserts on query
  shape and must change
- `src/lib/accuracy/api.ts`, `src/lib/accuracy/api.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/`, `docs/`, `src/screens/`,
`src/components/`, `src/lib/projection/`, `src/lib/scoring/` or `.github/` changes. No build
configuration changes — this ticket adds no import across the `scripts/` ↔ `src/lib/` boundary, so
`tsconfig.scripts.json` is not touched. No dependency is added, removed or upgraded.
