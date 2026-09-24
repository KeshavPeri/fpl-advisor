## Problem

Market odds are live and working — 20 of 20 gameweek-5 fixtures resolved to
`market-odds` on 18 Sept 2026, 100% club resolution, overrounds 1.056–1.066,
diverging from team strength by up to 0.2959. They are already correcting
real errors: team strength had Brighton as home favourites over Arsenal at
0.6122; the market says 0.3163.

But nothing reports how much of the projection horizon they actually cover.

`scripts/project-points.ts` projects five gameweeks. The Odds API served
fixtures from 18 Sept to 12 Oct — about four gameweeks — when measured once,
by hand, on one day. That number is not measured by any job, is not in any
report, and will shrink without warning: coverage depends on when bookmakers
open a market, which varies with cup rounds, international breaks and
rescheduling.

When it shrinks, the far gameweeks silently fall back to team strength, and
team strength is the instrument that rated Brighton above Arsenal. Nobody
would know.

This is the same shape as every defect this project has hit: a signal
degrades quietly because no job counts what it produced. Preflight reports
that every team has a rating; it does not report which instrument priced the
fixtures the model is actually solving over.

## The work

**1. Report coverage where the projection happens.**

`scripts/project-points.ts` already resolves a source per fixture. Add to its
console summary and `job_runs.details`, broken down **per horizon gameweek**:
the count of fixtures resolving to each of `market-odds`, `team-strength`,
`stale-elo` and `fdr`.

One line per gameweek, so a reader sees at a glance that GW+1 is fully priced
and GW+5 is not. A single pooled total across five gameweeks hides exactly
the thing this ticket exists to surface.

**2. Fail preflight when the near horizon is unpriced.**

Add a check: **market-odds coverage of the NEXT gameweek's fixtures.**

- PASS at 100%.
- WARN below 100%.
- FAIL below `MIN_NEXT_GAMEWEEK_ODDS_COVERAGE = 0.5`.

The next gameweek is the one the user acts on. Half of it unpriced means the
transfer and captaincy advice for that week is running on four matches of
goal difference. 0.5 is a judgement call, stated as such in the code comment,
same convention as check 8's `staleHoursThreshold`. Tier 3.

Report the covered count, the total, and the per-source breakdown in the
check's `Values:` line — the verdict alone is not evidence.

Do NOT fail on coverage of the far horizon. Bookmakers not pricing gameweek
5 of 5 is normal and expected, and a check that fires every week is a check
nobody reads — see ticket #124, written for exactly that failure.

## Falsification gate

Runnable offline against synthetic per-fixture source counts. No credentials.

**Stop and report unless all three hold:**

1. A synthetic horizon where every next-gameweek fixture resolves to
   `market-odds` PASSES at 100%.
2. A synthetic horizon where 40% of next-gameweek fixtures resolve to
   `market-odds` FAILS, naming the coverage figure.
3. A synthetic horizon with full next-gameweek coverage but ZERO coverage in
   gameweeks 2–5 still PASSES. This asserts the check does not fire on the
   normal far-horizon case, which is the specific mistake #124 had to undo.

## Definition of done — offline only

- `npm run build`, `npm run lint`, `npm test` clean.
- The three gate conditions as named tests, plus one asserting the
  per-gameweek breakdown is per-gameweek and not pooled.
- No change to the precedence itself, asserted by leaving
  `expectedPoints.ts`'s tests untouched.

## Post-merge owner check (does not block this PR)

Keshav runs `project-points` and `preflight-check` and pastes both summaries.
**Not a gate.**

## Out of scope

- `src/lib/projection/expectedPoints.ts` and the four-tier precedence.
- `scripts/ingest-match-odds.ts` — it is working; this ticket measures what
  reaches the projection, not what the ingest fetched.
- Widening the odds horizon, buying a paid tier, or any second odds source.
- `scripts/team-strength-diagnostic.ts` — ticket #124 owns it.
- `scripts/recommendation-scorecard.ts`, `scripts/season-replay.ts`,
  `src/lib/projection/bonus.ts`.

## Files

- `scripts/project-points.ts`
- `scripts/project-points.test.ts`
- `scripts/preflight-check.ts`
- `scripts/preflight-check.test.ts`
