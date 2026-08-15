## Context

A defect fix, filed ahead of item 12 because item 12 feeds this file to the solver.

The first live run of `scripts/emit-projections-csv.ts` reported this in `job_runs.details`:

```json
{
  "rowsWritten": 587,
  "distinctGameweeksCovered": 5,
  "playersWithNoProjectionAtAll": 381,
  "playerGameweekPairsZeroFilled": 1935,
  "lowExpectedMinutesPlayerCount": 415
}
```

**The arithmetic is the whole diagnosis.** 587 players × 5 gameweeks = 2,935 player-gameweek pairs.
1,935 were zero-filled, so **exactly 1,000 real projections were found.** Not approximately — exactly.

`scripts/project-points.ts`'s own run wrote **2,935 rows** covering all 587 players across gameweeks
1–5, so every one of those pairs exists in `public.player_projections`. The projections are there.
**The reader is not seeing them.**

1,000 is PostgREST's default `db-max-rows` ceiling on a single request. A `.select()` with no
explicit range is silently capped at that number — no error, no warning, no indication in the
response that the result was truncated. Everything past row 1,000 looks, to this job, exactly like a
player with no projection, and the zero-fill path — which exists for a good reason — dutifully
filled 1,935 pairs with zeroes.

**Consequence if this ships.** The CSV currently tells the solver that roughly two-thirds of the
Premier League is projected to score nothing and play no minutes. The solver would return a
confident, internally consistent, completely wrong squad, and it would look entirely plausible. The
inflated `lowExpectedMinutesPlayerCount` of 415 is the same bug seen from the other side — a
zero-filled player has zero expected minutes by construction.

This is the same class of failure as `deltas.md` D8 and D9: a silent gate that a local substitute
cannot see, producing output that passes every test.

Depends on item 11 (`scripts/emit-projections-csv.ts`) and item 10 (`player_projections`) — both
merged.

## Scope

**In scope:**

- Make every Supabase read in `scripts/emit-projections-csv.ts` **paginate** until the source is
  exhausted, rather than issuing one unbounded `.select()`.
- Apply the same fix to every other read in the file that can exceed 1,000 rows — the `players`
  read is close to the ceiling already at 587 and will cross it as FPL adds players through the
  season.
- **Assert the result set is complete** rather than trusting it: compare rows fetched against the
  table's own count for the same filter, and fail loudly if they disagree.
- Record the fetched-row count and the expected count in `job_runs.details`.
- Audit `scripts/project-points.ts` for the same defect on **its** reads — in particular
  `player_match_stats`, which currently holds over 15,000 rows and is read to build the rate and
  defcon histories.
- Vitest tests for the pagination helper.

**Explicitly out of scope:**

- **No change to the CSV's shape, columns, header, ordering or quoting.** The format is correct and
  is item 11's contract with the solver. This ticket changes only how many rows reach it.
- **No removal of the zero-fill path.** Zero-filling a genuinely missing projection is correct and
  deliberate — an omitted player cannot be transferred in by the solver. The bug is that the path
  was being triggered by a truncated read, not that the path exists.
- **No change to the projection model, to `src/lib/projection/`, or to how projections are
  computed.**
- **No new database table, no migration, nothing under `supabase/`.**
- **No change to `.github/workflows/`** — another ticket in this batch may own a workflow file, and
  this fix needs no schedule change.
- No new dependency. No Supabase client upgrade.
- No UI, nothing under `src/`.

## Definition of done

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] **A single shared pagination helper** is used for every affected read, rather than the range
      logic being repeated per call site.
- [ ] Every read that can return more than 1,000 rows fetches in explicit pages until a short page
      is returned. The helper has a named test proving it fetches all of a 2,500-row source, and a
      named test proving it terminates on an exactly-page-sized final page rather than looping
      forever.
- [ ] **The job compares rows fetched against an independent count of the same filter** — a
      `count`-only query — and **fails loudly with a non-zero exit and a failed `job_runs` row**
      naming both numbers when they disagree. This is the guard that would have caught the original
      bug, and it is the point of the ticket.
- [ ] `job_runs.details` records, as separately named fields: projection rows fetched, projection
      rows expected by count, and the number of pages issued.
- [ ] **After this fix, against the current live data, `playersWithNoProjectionAtAll` is `0` and
      `playerGameweekPairsZeroFilled` is `0`** — every one of the 587 players has a real projection
      for all five gameweeks. *(Verifiable only by a live run — see the note on substitutes below.)*
- [ ] `scripts/project-points.ts` is audited for the same defect. If any of its reads can exceed
      1,000 rows, they use the same helper. If the audit finds none, that conclusion is stated in
      `decisions/ticket-<number>.md` with the reads that were checked named individually — "we
      looked and here is what we looked at", not silence.
- [ ] Neither script's `job_runs` row shape changes other than by the added fields above.
- [ ] Neither script deletes a row. `.delete(` appears in neither.
- [ ] Scope constraint: only `scripts/emit-projections-csv.ts`, `scripts/project-points.ts`, a new
      shared helper module under `scripts/`, their test files, and this ticket's own
      `decisions/ticket-<number>.md` are added or changed. Nothing under `src/`, `supabase/` or
      `.github/` changes; `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **The diagnosis is not a hypothesis to re-derive.** 2,935 total pairs minus 1,935 zero-filled is
  exactly 1,000, and `project-points` independently reported writing 2,935 rows. Confirm the
  projections exist with a count query if you like, but do not spend the run re-investigating
  whether the data is there. It is.
- **Do not "fix" this by raising a limit.** `.limit(50000)` may appear to work and will fail again
  the moment the data outgrows whatever number is picked, silently and in exactly the same way.
  Paginate until exhausted, then verify against a count. The verification is the part that makes
  this fix durable — the pagination alone just moves the cliff.
- **`db-max-rows` is a server-side setting on the Supabase project, not something this repo
  controls.** Do not propose changing it. A client that is correct regardless of the server's
  ceiling is the right answer, and the ceiling exists for a good reason.
- **This class of bug is why `job_runs.details` carries counts at all.** The original ticket asked
  for those counters and they are exactly what surfaced this within one run of shipping. Keep
  adding them.
- **A truncated read is indistinguishable from missing data at the call site.** That is the whole
  lesson: there is no error, no flag, and no partial-result marker in the response. Any future read
  of a table that grows must either paginate or be provably bounded, and "it returned rows so it
  worked" is not evidence.
- **What a substitute cannot catch.** A mocked Supabase client can prove the pagination helper
  loops and terminates correctly. It **cannot** reproduce PostgREST's row cap, because the cap is
  server-side behaviour of the real service — the same blindness `deltas.md` D8 describes for
  GRANTs. So the two headline numbers in this DoD (`playersWithNoProjectionAtAll` and
  `playerGameweekPairsZeroFilled` both reaching zero) can only be confirmed by a live run after
  merge, and QA should mark them CANNOT VERIFY rather than claiming them. That live run is Keshav's
  check and it is the one that actually closes this ticket.
