## Context

**Do not start this ticket until #114 has merged.** It changes the same
precedence function and the same job, and it is worthless until the
team-strength path is proven to run.

Ticket #114 rebuilt the fixture term from this season's own results, because
ClubElo is abandoned (site data dated 22 Oct 2024, API 502, the best daily
mirror dead since 2026-01-14) and FPL's own team-strength fields are null or
zero. That gets the model a current signal. It does not get it a
*forward-looking* one.

A results-derived rating lags by construction. It cannot know that a club's
main striker is suspended this weekend, that the manager will rotate after a
Thursday European tie, or that a side has three first-choice defenders out.
Those are exactly the things that made Chelsea a good captaincy pick and Man
Utd a bad one in gameweek 4, and no amount of past goal difference contains
them.

Bookmakers price all of it, continuously, with real money behind the
estimate. Market odds are not a worse substitute for Elo — they are a
strictly better fixture-difficulty signal, and they are the only forward
source available.

## Why this needs no new scale

The model's fixture term consumes an `expectedScore` in `[0, 1]` where 0.5 is
an even fixture. A three-way market converts to exactly that, with no fitted
parameter and no borrowed rating scale:

```
raw_i      = 1 / decimal_odds_i           for home, draw, away
overround  = raw_home + raw_draw + raw_away
p_i        = raw_i / overround
expectedScore(home) = p_home + 0.5 * p_draw
expectedScore(away) = p_away + 0.5 * p_draw
```

This is the definition of an elo expected score, so `deltas.md` D11's rule
against substituting another provider's elo does not apply — we are not
importing a rating, we are computing our own number from prices.

Proportional normalisation is the simplest overround removal. Shin's method
and the power method are better at the extremes. Use proportional, state it
as a **Tier 3** decision in the code comment, and note the alternatives so a
later ticket can measure whether they matter.

## The source

The Odds API. Free tier, 500 requests a month.

```
GET https://api.the-odds-api.com/v4/sports/soccer_epl/odds?regions=uk&markets=h2h&oddsFormat=decimal&apiKey=$ODDS_API_KEY
```

**Measured against the live key on 15 Sept 2026** — these are observed
facts, not estimates:

- One call returned **20 fixtures**, spanning `2026-09-18T19:00:00Z` to
  `2026-10-12T19:00:00Z` — roughly four gameweeks of forward coverage.
- Every fixture carried **21 bookmakers**.
- The call cost **1 credit**; 499 of 500 remained. A daily run costs about 30
  a month.

Use the **median** across the returned bookmakers for each of the three
prices, not the mean and not one chosen book. The median is robust to a
single stale or mispriced feed, which is the realistic failure here. With 21
books the median is well-supported.

### The horizon is whatever the API serves

An earlier draft of this ticket guessed an 8-day window. The measurement
above shows the API prices about 24 days ahead, so a fixed day-window would
throw away three gameweeks of usable signal.

The rule is therefore: **a fixture gets the market term when the API returned
it with at least 3 books and the odds row is under 48 hours old. Everything
else keeps #114's team-strength term.** No day-count window — the API's own
coverage is the window.

Keep one sanity cap: ignore any returned fixture whose kickoff is more than
**35 days** out. That is not a horizon rule, it is a guard against a
malformed or long-dated market, and it should never fire in normal operation.

A projection horizon where the near gameweeks use one instrument and the far
ones use another is a deliberate design choice, not an inconsistency to paper
over. Say so in the code comment.

## The failure mode this ticket must not repeat

The Odds API names clubs its own way ("Manchester United", "Nottingham
Forest"). Mapping those to `teams.code` is exactly the kind of name-matching
that just cost four gameweeks when `fotmob_name` went blank and every
`opponent_team_code` silently became null.

So:

- The name map is an **explicit, committed table** in the repo, not a fuzzy
  match. It is reproduced in full below, verified on 15 Sept 2026 against
  both the live API response and `data/2026-2027/teams.csv`. Copy it
  verbatim into `scripts/lib/oddsClubNames.ts` — all twenty names came back
  from a real call and all twenty resolved. Do not re-derive it, do not
  normalise it, do not add a fallback matcher.

```ts
// The Odds API club name -> public.teams.code (deltas.md D9: code is the
// stable cross-season key, never short_name and never the FPL team id).
// Verified 15 Sept 2026 against a live soccer_epl h2h response (20 of 20
// names resolved) and data/2026-2027/teams.csv.
export const ODDS_CLUB_NAME_TO_TEAM_CODE: ReadonlyMap<string, number> = new Map([
  ['Arsenal', 3],
  ['Aston Villa', 7],
  ['Bournemouth', 91],
  ['Brentford', 94],
  ['Brighton and Hove Albion', 36],
  ['Chelsea', 8],
  ['Coventry City', 9],
  ['Crystal Palace', 31],
  ['Everton', 11],
  ['Fulham', 54],
  ['Hull City', 88],
  ['Ipswich Town', 40],
  ['Leeds United', 2],
  ['Liverpool', 14],
  ['Manchester City', 43],
  ['Manchester United', 1],
  ['Newcastle United', 4],
  ['Nottingham Forest', 17],
  ['Sunderland', 56],
  ['Tottenham Hotspur', 6],
])
```

  **This table needs a new row every time a club is promoted.** That is the
  one predictable way it breaks, it happens once a year, and the 80%
  resolution floor below is what will catch it. Say so in the file header.
- An unmapped name is **never guessed**. The row is skipped and counted, by
  name, in `job_runs.details`.
- The ingest **fails loudly** — non-zero exit — when fewer than 80% of the
  fixtures it fetched resolve to a known club. Silence on a broken mapping is
  the specific defect this repo has now hit twice.
- The odds are stored with the fetch timestamp. An odds row older than **48
  hours** is not used; the fixture falls through to team strength instead.
  Stale prices are worse than no prices.

## Storage

New table `public.fixture_odds`: `fixture_id` (FK to `public.fixtures`),
`fetched_at`, `book_count`, `median_home`, `median_draw`, `median_away`,
`p_home`, `p_draw`, `p_away`, `overround`. Append-only, same convention as
`notifications` — one row per fetch, never an upsert, so the price history is
kept and a later ticket can measure how much the market moved before a
deadline. RLS read-only for `anon`; `SELECT, INSERT` for `service_role`, no
`UPDATE`, no `DELETE`.

## Precedence

Market odds become the top tier:

1. Fresh market odds (within 48h, fixture resolves, `book_count >= 3`)
2. Point-in-time team strength (#114)
3. Stale elo
4. FDR

Fresh ClubElo drops out of the precedence entirely — it has not existed since
January and keeping a dead tier above a live one is how #229 shipped dead
code. `fixtureSource` gains the value `'market-odds'`.

## Falsification gate

Run the diagnostic against live data. **Stop and report — do not merge —
unless all three hold:**

1. At least one fixture in the next gameweek resolves to source
   `'market-odds'`. (The liveness condition, per `LEARNINGS-second-build-wave.md`
   §21 — assert the new path ran before comparing anything.)
2. At least one fixture's odds-derived `expectedScore` differs from its
   team-strength `expectedScore` by more than **0.02**. Identical columns mean
   the new path did nothing.
3. Every fetched fixture's `overround` is between **1.00 and 1.15**. Outside
   that range the prices were misparsed — an overround below 1 is impossible
   and above 1.15 is not a real UK three-way market.

`scripts/team-strength-diagnostic.ts` gains a third `expectedScore` column so
the report shows frozen-elo, team-strength and market-odds side by side for
every fixture. Paste it into the PR body.

## Credentials — already done

`ODDS_API_KEY` is live in `.env` and in the repository secrets as of 15 Sept
2026, confirmed by `gh secret list` and by a successful call. Reference it in
the workflow as `${{ secrets.ODDS_API_KEY }}`, matching the five existing
secrets.

Add `ODDS_API_KEY` to preflight check 10's tracked environment variables (it
tracks five today; this makes six).

## Definition of done

- `npm run build`, `npm run lint`, `npm test` clean.
- Named tests: overround removal on a known three-price example; the median
  across an even and an odd number of books; an unmapped club name is skipped
  and counted, never guessed; the 80% resolution floor fails the job; odds
  older than 48h are not used; fewer than 3 books falls through; a fixture
  more than 35 days out is ignored; every one of the twenty names in
  `ODDS_CLUB_NAME_TO_TEAM_CODE` resolves to a distinct code.
- The ingest is added to `.github/workflows/scheduled-jobs.yml`, running daily
  before `project-points`, and to preflight check 8's tracked-job list.
- Record the new migration in `supabase/README.md` in the existing format.

## Out of scope

- Any market other than `h2h`. Totals and Asian handicap would give a direct
  read on expected goals, which is a better instrument for the clean-sheet
  and defensive terms — a separate ticket once this one is proven.
- Validating the derived probabilities against `football-data.co.uk`'s
  published closing odds (`AvgCH`/`AvgCD`/`AvgCA` in
  `https://football-data.co.uk/mmz4281/2627/E0.csv`, actively maintained, free).
  That is the right way to check this is calibrated, and it is its own ticket.
- Using odds anywhere except the fixture term. No direct odds-to-points path,
  no captaincy override.
- Shin or power-method overround removal.
- `src/lib/projection/bonus.ts`.

## Files

- `supabase/migrations/<date>_fixture_odds.sql` (new)
- `supabase/README.md`
- `scripts/ingest-match-odds.ts` (new)
- `scripts/ingest-match-odds.test.ts` (new)
- `scripts/lib/oddsClubNames.ts` (new — the explicit twenty-row name map)
- `src/lib/projection/marketOdds.ts` (new — overround removal and
  expectedScore, pure)
- `src/lib/projection/marketOdds.test.ts` (new)
- `src/lib/projection/expectedPoints.ts`
- `src/lib/projection/expectedPoints.test.ts`
- `src/lib/projection/index.ts`
- `scripts/project-points.ts`
- `scripts/project-points.test.ts`
- `scripts/team-strength-diagnostic.ts`
- `scripts/team-strength-diagnostic.test.ts`
- `scripts/preflight-check.ts`
- `.github/workflows/scheduled-jobs.yml`
