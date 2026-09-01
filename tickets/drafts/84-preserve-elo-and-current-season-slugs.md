## Context

**One upstream gap is causing two live defects, and one of them is degrading the recommendation
right now.**

The source's `data/2026-2027/teams.csv` publishes the `elo` and `fotmob_name` columns **empty for all
20 clubs.** Verified directly against the file on 1 Sept 2026:

```
code,id,name,short_name,strength,...,pulse_id,elo,fotmob_name
3,1,Arsenal,ARS,,4,5,0,0,0,0,1,,
7,2,Aston Villa,AVL,,3,4,0,0,0,0,2,,
```

The 2025-2026 file has both populated. The columns exist for the new season; the values do not.

### Defect 1 — we overwrite ClubElo ratings we already have with null

`scripts/ingest-core-insights.ts` reports, for season 2025-2026:

> 17 team(s) updated (elo, matched on code), 3 CSV code(s) not in public.teams, **3 public.teams
> row(s) with no matching CSV code (3 elo value(s) nulled rather than left stale, ticket #63)**

and for 2026-2027:

> **20 row(s) with a malformed elo cell skipped**

The three unrated clubs are the promoted ones. They appear only in the 2026-2027 file, whose elo is
blank, so nothing populates them — and ticket #63's rule then **nulls whatever rating they already
had.** Preflight check 6 has now flapped three times between 0/20 and 3/20 unrated clubs, and the
consequence is not cosmetic: **15 of 50 fixtures in the current five-gameweek horizon are on the
FPL-difficulty fallback**, including fixtures inside the GW3 recommendation.

**#63's rule is right in principle and wrong here.** It exists so a club that genuinely leaves the
data does not keep a stale rating forever. It was not written for the case where the source
temporarily publishes nothing — and a stale rating is strictly better than falling back to FDR, which
is a coarser instrument (`docs/projection-model-backlog.md` G8).

### Defect 2 — the current season has no opponents at all

Opponent resolution maps a `match_id` club slug to a `team_code` via `fotmob_name`. For 2026-2027
that column is blank on every row, so the ingest reports **20 teams with a blank `fotmob_name`
(opponent slug unresolvable)** and **0 of 975 rows carrying a non-null `opponent_team_code`.**

Ticket #167's substrate is therefore complete for 2025-2026 (12,613 of 12,754 Premier League rows,
98.9%) and **empty for the season the app actually runs on.** It fails silently — only a counter
shows it.

Depends on #63 and #167, both merged. Nothing unmerged.

## Scope

**In scope:**

- **Stop nulling a known elo when the source has no value for that club.** A club absent from the
  season file, or present with a blank or malformed elo cell, **keeps its existing rating**. A club
  present with a valid value is updated as now.
- **Record when a rating went stale**, so "we have a rating and it is current" and "we have a rating
  and the source stopped supplying it" are distinguishable — a column, a timestamp, or a counter, the
  Builder's call, but the two states must not look identical.
- **Preserve the deliberate case #63 was written for.** A club that is genuinely no longer in the
  competition must still be able to lose its rating. State in the decisions file how the two cases
  are told apart, and if they cannot be, say so and default to keeping the rating.
- **A club-slug fallback when `fotmob_name` is blank**, derived from the row's own `name` or
  `short_name` using the same slug convention `match_id` uses, so opponent resolution works for
  2026-2027. **Fail loudly on an ambiguous or unresolvable slug** — count it by reason, exactly as
  the existing opponent resolution already does. Never guess.
- **Counters in `job_runs.details`** for both: elo values preserved rather than nulled, and opponent
  slugs resolved via the fallback rather than `fotmob_name`.

**Explicitly out of scope:**

- **No new external data source for ClubElo.** The promoted clubs have never had a rating from this
  source; this ticket stops us destroying ratings we hold, it does not manufacture missing ones.
  Sourcing elo elsewhere is a Tier 2 data-source decision and a separate ticket.
- **No change to `preflight-check.ts`.** Check 6 will keep warning while clubs are genuinely unrated,
  and that is correct behaviour.
- **No change to `src/lib/projection/fixture.ts` or the FDR fallback itself.** G8's question about
  whether fixture sensitivity is too narrow is a different ticket.
- **No change to `scripts/run-backtest.ts` or `scripts/project-points.ts`.** Both are owned by other
  tickets in this batch.
- **No migration unless recording staleness genuinely requires one** — if it does, it is a single
  additive column with its GRANT in the same file (`deltas.md` D8), and `supabase/README.md` is
  updated in the same PR.
- **No backfill of historical data.**

## Definition of done

- [ ] A club whose season file row is absent, or carries a blank or malformed elo, **retains its
      existing `teams.elo`.** Named tests for all three shapes.
- [ ] A club with a valid elo value is still updated, matched on `code` and never on `id`
      (`deltas.md` D9). Named test.
- [ ] The stale-versus-current distinction is recorded and is visible in `job_runs.details`.
- [ ] The genuine removal case #63 was written for is documented in the decisions file, with how it
      is distinguished — or an explicit statement that it cannot be, and that keeping the rating is
      the chosen default, with its *because*.
- [ ] When `fotmob_name` is blank, the club slug is derived from `name` or `short_name` using the
      same convention `match_id` uses. Named tests for a single-word club, a multi-word club
      (`wolverhampton-wanderers`), and a club whose derived slug matches no fixture — which must be
      counted, not guessed.
- [ ] Both new counters appear in `job_runs.details` and reconcile arithmetically.
- [ ] Every existing test passes **unmodified** except those asserting the old nulling behaviour.
- [ ] Nothing under `src/`, `docs/`, `.github/` or any other `scripts/*.ts` is added, changed or
      deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** the human check after merge is running `Scheduled jobs`,
      then dispatching `Preflight check` and confirming **check 6 reports 0 of 20 clubs unrated and 0
      of 50 horizon fixtures on the FDR fallback** — provided those clubs had a rating before this
      run. Then confirming from `job_runs` that **2026-2027 rows now carry a non-null
      `opponent_team_code`**, up from 0 of 975. **What will NOT change:** the three promoted clubs
      gain no *new* rating from this ticket — if they had none before it, they still have none, and
      check 6 will still warn. That is the upstream gap, not this ticket failing.

## Notes for the Analyst / Builder

**Read the source file before writing code.** `data/2026-2027/teams.csv` publishes both columns
empty; `data/2025-2026/teams.csv` publishes both populated. The verification date is 1 Sept 2026 and
the file can change — **check it again at build time** rather than trusting this ticket
(`LEARNINGS-first-build-wave.md` §5).

**Distinguish "blank" from "malformed" from "absent" and handle all three the same way for elo, but
count them separately.** The ingest already separates them in its message; keep that resolution.

**Slug derivation is the risky half.** `match_id` uses forms like `brighton-hove-albion` and
`afc-bournemouth` — punctuation, `AFC`/`FC` prefixes and ampersands are all live cases. **A derived
slug that matches no club in the fixture must be counted as unresolvable, never fuzzy-matched.**
`scripts/lib/competition.ts` sets the discipline for parsing this same slug: fail loudly on an
unknown shape rather than defaulting.

**Do not weaken #63, replace it.** Its author was solving a real problem. The decisions entry should
say what #63 got right, what case it did not anticipate, and why the new default is safer — not that
it was wrong.

**This is Tier 2** — it changes what `teams.elo` means and therefore every fixture adjustment the
live model makes. Log it as HIGH-IMPACT with its *because*.

**Two other tickets are running in this batch**, owning `scripts/run-backtest.ts` and
`scripts/project-points.ts`. This ticket touches neither.

## Scope constraint

Nothing outside the following files changes:

- `scripts/ingest-core-insights.ts`, `scripts/ingest-core-insights.test.ts`
- `scripts/lib/competition.ts` and its test, **only** if slug derivation genuinely belongs beside the
  existing slug parser — if so, additively, with no change to any existing export's signature
- One new file under `supabase/migrations/` and the `supabase/README.md` applied table, **only** if
  recording staleness requires a column
- `decisions/ticket-<this issue number>.md`

Nothing under `src/`, `docs/`, `.github/` or any other `scripts/*.ts` changes —
`scripts/run-backtest.ts`, `scripts/project-points.ts` and `scripts/build-feature-history.ts` in
particular are untouched. No dependency is added, removed or upgraded.
