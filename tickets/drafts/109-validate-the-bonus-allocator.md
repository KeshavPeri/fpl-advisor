## Context

`docs/model-review-2026-09-02.md` §1h named the bonus allocator as **the one component in this
model with no validating instrument anywhere**:

> It adds ~0.08–0.3 points concentrated at the top of rankings, i.e. it moves captaincy decisions
> while being unfalsifiable in-repo. Do not remove it (that reopens G3's known bias), but flag it:
> validation would need actual per-player bonus from the FPL API for settled 2026/27 gameweeks — a
> live DB/API read and possibly a new ingest surface — and until then no ticket should tune it.

That is exactly right and it has been true for ten days. `player_match_stats` carries no `bonus` and
no `bps` column — verified against the source CSV header by ticket #127 and permanent, not a gap a
re-ingest closes. So the backtest excludes bonus from both sides, and the calibration report
subtracts the projected bonus back out to stay like-for-like. The allocator runs on every
projection, moves the top of every ranking, and nothing can check it.

**The ingest surface exists and its format is verified.** `https://fantasy.premierleague.com/api/event/{gw}/live/`
was fetched by hand on 11 September 2026 and returns:

```
{ "elements": [ { "id", "stats": { ... }, "explain", "modified" } ] }
```

with 654 elements, and `stats` carrying, verbatim:

```
minutes, goals_scored, assists, clean_sheets, goals_conceded, own_goals, penalties_saved,
penalties_missed, yellow_cards, red_cards, saves, bonus, bps, influence, creativity, threat,
ict_index, clearances_blocks_interceptions, recoveries, tackles, defensive_contribution, starts,
expected_goals, expected_assists, expected_goal_involvements, expected_goals_conceded,
total_points, in_dreamteam, played
```

It is public and unauthenticated, like every other endpoint this app uses. `product-brief.md` §6a's
rule holds — no credential, no `my-team/`.

## Scope

**In scope:**

- A migration creating a per-gameweek actuals table, one row per `(gameweek_id, player_code)`,
  storing at minimum `bonus`, `bps`, `minutes` and `total_points`. RLS read-only for `anon`,
  `SELECT/INSERT/UPDATE` for `service_role`, no `DELETE`, `GRANT` in the same file.
- A new ingest script reading `event/{gw}/live/` for each finished gameweek and writing those rows.
  **A separate script from `scripts/ingest-fpl.ts`, not an addition to it** — another ticket in this
  batch touches that file.
- Shape validation before any table is touched, matching `ingest-fpl.ts`'s own pattern: an
  unexpected payload fails loudly rather than writing partial rows.
- **The validation itself**: compare `player_projections.components.points.bonusPoints` against the
  real bonus, per player per settled gameweek. Report the mean projected bonus, the mean actual, the
  signed error, and the same split for the top 20 projected players in each gameweek — because that
  is the population the allocator actually moves.
- A written finding in `docs/projection-model-backlog.md` updating G3, which currently records that
  no validation is possible.

**Explicitly out of scope:**

- **No change to the allocator.** `src/lib/projection/bonus.ts` is not touched. The review's
  standing instruction is that no ticket tunes bonus until an instrument exists; this ticket builds
  the instrument and reads it. Acting on the reading is the next ticket.
- **No change to `scripts/ingest-fpl.ts`.** See the batch coupling note.
- No change to the backtest, the calibration report's existing figures, the solver, or the app.
- Do not ingest the other fields yet. `starts`, `defensive_contribution` and the expected-goals
  family are all in that payload and several are genuinely interesting — `starts` in particular
  would settle the question ticket #191 failed to answer. **Note them in the backlog as available
  and leave them.** This ticket is about bonus.
- No authenticated endpoint, no `my-team/`, no stored credential. Tier 1 if proposed.

## The limitation, stated up front so nobody reads too much into the first run

`event/{gw}/live/` serves **the current season only.** There is no way to fetch 2025/26 from it. So
bonus can be validated on 2026/27 gameweeks played so far — **three of them** — and no further back,
ever.

Three gameweeks is not enough to conclude anything about a component worth 0.08 to 0.3 points. The
report must print its sample size beside every figure and say plainly how many gameweeks would be
needed. The value is that it accumulates: run it weekly and by midseason it is a real measurement.

## Definition of done

- [ ] The migration is idempotent, has RLS and a `GRANT` in the same file, and is listed in
      `supabase/README.md` as not yet applied.
- [ ] The ingest validates the payload shape before writing, and fails loudly on an unexpected one.
      Named tests cover a well-formed payload, a missing `stats` key, and an empty `elements` array.
- [ ] Element ids are mapped to `player_code` via `players` — never stored as a bare element id
      (`deltas.md` D9). Unmappable ids are counted and excluded, never guessed.
- [ ] `job_runs.details` carries gameweeks read, rows written, rows skipped and why, reconciling.
- [ ] The comparison reports mean projected bonus, mean actual bonus, signed error, and the same
      four figures restricted to each gameweek's top 20 projected players.
- [ ] Every figure carries its sample size and the report states the three-gameweek limitation.
- [ ] G3 in `docs/projection-model-backlog.md` is updated — it currently says validation is
      impossible, which is no longer true.
- [ ] The other available `stats` fields are listed in the backlog as a noted future surface.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` exit 0.
- [ ] Scope constraint: one new migration, one new ingest script and its test under `scripts/`,
      one comparison script or a new section in an existing report, `supabase/README.md`,
      `docs/projection-model-backlog.md`, and this ticket's own `decisions/ticket-<issue>.md`.
      **`scripts/ingest-fpl.ts` and everything under `src/` are unchanged.**

## Batch coupling

The `penalties_order` ticket in this batch changes `scripts/ingest-fpl.ts` and
`src/lib/projection/`. This ticket must touch neither. Two tickets editing one ingest file conflict
on the second merge regardless of whether they depend on each other — `deltas.md` D6b and D7.

## The human check after merge

Apply the migration by hand, run the new ingest, then:

```sql
select gameweek_id,
       count(*) as rows_stored,
       sum(bonus) as total_bonus_awarded,
       count(*) filter (where bonus > 0) as players_with_bonus
from public.gameweek_live_stats
group by gameweek_id
order by gameweek_id;
```

Each finished gameweek should award close to 6 bonus points per fixture — about 60 across a
ten-fixture gameweek — spread over roughly 30 players. A total far from that means the ingest is
reading the wrong field or double-counting.

## Notes for the Analyst / Builder

- `bonus` is the awarded 3/2/1; `bps` is the raw score it is derived from. Store both — the
  allocator models a share of BPS above a baseline, so the interesting comparison may turn out to be
  against `bps` rather than against `bonus`.
- The allocator distributes six points continuously in proportion to modelled BPS share, clamped at
  3.0 per player. It was never meant to predict who finishes 1st, 2nd and 3rd. Judge it on the
  distribution, not on exact placings, and say which you measured.
- Only ingest **finished** gameweeks. A live gameweek's bonus is provisional until lockdown at 09:00
  UK the morning after the final match — the same rule `scripts/settle-predictions.ts` already
  honours. Reuse that rule, do not invent a second one.
