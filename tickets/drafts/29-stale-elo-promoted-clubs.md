## Context

A live data defect. **Three of the twenty clubs are currently rated as if they were a different club
entirely**, and nothing flags it because the value is present rather than null.

Depends on #32 (ClubElo matched by team code) and item 10 (`project-points.ts`) — both merged.

### The arithmetic that exposes it

From the `ingest-core-insights` run of 18 Aug 2026:

```
teamsUpdated: 17        teamsCodesNotInCsv: 3        codesNotInTeams: 3
```

The corrected job matches on `teams.code` and updates `elo` for the **17** clubs present in both the
current `public.teams` and the historical season's `teams.csv`. The other **3** are the newly
promoted clubs — Coventry City, Hull City and Ipswich Town — which played in the Championship last
season and therefore have no row in a 2025-26 file.

**The job counts them and leaves their `elo` untouched.** So they keep whatever was last written —
and what was last written came from the **buggy id-matched era**, before #32, when the job upserted
by `id` from the historical file:

| Current club | Holds the ClubElo rating of |
|---|---|
| Coventry City (id 7) | **Chelsea** |
| Hull City (id 11) | **Leeds** |
| Ipswich Town (id 12) | **Liverpool** |

**Confirmed by the projection run in the same window:** `fixtureEloFallbackCount: 0`. Not one fixture
fell back to FPL's own difficulty rating — which can only be true if all twenty clubs have a non-null
`elo`. Seventeen are right. Three are somebody else's.

### Why it matters

`src/lib/projection/fixture.ts` derives everything fixture-related from the elo gap: the attacking
multiplier, expected goals conceded, and clean-sheet probability. A promoted club carrying a
top-four rating means:

- **Its own players are over-projected** — a strong team is expected to score more and concede less.
- **Its opponents are under-projected on clean sheets**, because they appear to be facing Chelsea.

Every fixture involving one of those three clubs is affected, in both directions, across the whole
five-gameweek horizon. Promoted clubs are normally the softest fixtures in the league; right now the
model treats three of them as among the hardest.

### The obvious fix does not work

`data/2026-2027/teams.csv` exists at the source and lists all twenty current clubs — but **its `elo`
column is empty for every one of them**, verified 18 Aug 2026. The source has not published
current-season ratings. *(A check on 15 Aug recorded values in that column; whether the source
changed or that reading was wrong, it is empty now — treat the file as volatile and re-verify rather
than trusting either observation.)*

So current-season elo is not available from this source, and the fix has to be about honesty rather
than about finding a better number.

## Scope

**In scope:**

- **`scripts/ingest-core-insights.ts`** — for every row in `public.teams` whose `code` is absent from
  the ingested season's `teams.csv`, **set `elo` to null** rather than leaving a stale value in place.
- Report the count of teams nulled, separately from the existing counters.
- Update the file-header comment to record why: an unmatched club's rating is not merely
  out of date, it may belong to a different club entirely.

**Explicitly out of scope:**

- **No new external data source.** Fetching ClubElo directly, or any other ratings provider, is a
  Tier 2 data-source decision needing its own verification and its own ticket. Not three days before
  a deadline.
- **No invented default rating for promoted clubs.** A guessed number is the same failure as a stale
  one, with better PR.
- **No change to `src/lib/projection/`.** The FDR fallback already exists, is already tested, and
  already counts itself. This ticket makes it engage; it does not modify it.
- **No change to the FDR fallback mapping** in `fixture.ts`.
- **No change to `CORE_INSIGHTS_SEASON` or `DEFAULT_SEASON`**, no change to the competition filter,
  the match-stats path, `player_code` handling, or anything else this job does.
- **No new migration, no schema change, nothing under `supabase/`.**
- **No backfill script.** The corrected job fixes the live values on its next run.
- **No UI. Nothing under `src/` changes at all.**
- **No change to any other file in `scripts/` or to `.github/workflows/`.**
- No new npm dependency.

## Definition of done

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] Nothing under `src/` or `supabase/` is added, changed or deleted.
- [ ] A `public.teams` row whose `code` is **not** present in the season's `teams.csv` has its `elo`
      set to `null` by the run. Named test.
- [ ] A row whose `code` **is** present has its `elo` set to the CSV value, exactly as now. Named test
      — the existing behaviour must not regress.
- [ ] A CSV row whose `elo` cell is empty or non-numeric still **skips** that team rather than
      nulling a good value, and is still counted in `malformedEloRows`. Named test. *(Nulling and
      skipping are different outcomes for different reasons and must not be conflated.)*
- [ ] `job_runs.details` gains a named count of teams whose `elo` was nulled, alongside the existing
      `teamsUpdated`, `teamsCodesNotInCsv`, `codesNotInTeams`, `malformedEloRows` and
      `duplicateCodeConflicts`.
- [ ] The job still writes only `elo` and `updated_at` to `public.teams`. The strings `short_name`,
      `strength_overall_home`, `strength_attack_home`, `strength_defence_home` and `pulse_id` appear
      nowhere in the file outside `TEAMS_REQUIRED_COLUMNS` and comments. Verifiable by search — #32's
      guarantee must survive intact.
- [ ] No `upsert` into `teams` is introduced. The write path stays a read-then-update matched on
      `code`.
- [ ] The file-header comment records the finding, the three affected clubs, the ratings they were
      holding, and the verification date.
- [ ] **After this ships, `project-points`'s `fixtureEloFallbackCount` is greater than zero.** It is
      `0` today, which is the symptom. *(Live-run only — see below.)*
- [ ] Scope constraint: only `scripts/ingest-core-insights.ts`, its test file, and this ticket's own
      `decisions/ticket-<number>.md` are added or changed. Nothing under `src/`, `supabase/`,
      `.github/` changes; no other file in `scripts/` changes; `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **Null is the correct answer, and it is not a cop-out.** `src/lib/projection/fixture.ts` already
  falls back to FPL's own `team_h_difficulty` / `team_a_difficulty` when a team's elo is null, maps it
  onto the same expected-score space, and counts every fixture that used it. That machinery was built
  in item 10 specifically for this case and has never once engaged, because the column has never been
  null. FPL's own difficulty ratings correctly treat a promoted club as an easy fixture, so the
  fallback lands in the right direction — unlike the current value, which lands in exactly the wrong
  one.
- **A wrong number is worse than no number, and this is the reason why.** A null triggers a
  documented fallback and increments a visible counter. A stale value from a different club produces
  a confident, plausible, wrong projection with no signal anywhere. That is the same failure shape as
  `deltas.md` D9 — a column nothing was reading, so nothing objected.
- **Do not confuse "no row in the CSV" with "empty elo cell in the CSV".** They need opposite
  handling: a club absent from the file has no current rating and must be nulled; a club present with
  an unreadable value should be skipped so a good stored rating survives a one-off source glitch.
  Both are already counted separately — keep them that way.
- **Do not reach for the 2026-2027 file.** Verified empty across all twenty clubs on 18 Aug 2026.
  Adding a second season fetch to chase a column that holds nothing is wasted work and a new failure
  mode. When the source does publish current-season ratings, switching the elo read to the current
  season while match stats stay on the historical one is a clean, small future ticket.
- **This does not fix the underlying gap — it makes it visible.** Three clubs will have no ClubElo
  rating until the source publishes one, and their fixtures will be rated by FPL's coarser 1–5 scale.
  That is a real reduction in model quality for those fixtures, honestly reported, and it is strictly
  better than the alternative. Note it in `docs/projection-model-backlog.md`? **No — that file is not
  in this ticket's scope list.** Put the finding in `decisions/ticket-<number>.md` and let Keshav fold
  it in. *(`deltas.md` D10 — a Notes instruction naming a file the scope list omits is a
  contradiction, and this ticket is deliberately not repeating it.)*
- **What a substitute cannot catch.** Tests prove the null-on-unmatched rule against fixtures. They
  cannot prove the live table currently holds three wrong ratings, and they cannot prove the fallback
  then engages — that needs a real run. **After merge: run the ingest, confirm three teams show a null
  elo, then run the projection and confirm `fixtureEloFallbackCount` is no longer zero.** QA should
  mark both CANNOT VERIFY and say why.
