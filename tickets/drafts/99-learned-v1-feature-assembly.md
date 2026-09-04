## Context

The first honest five-gameweek reading exists (backtest report 10, 4 September) and it is not
flattering: the model scores **0.397** against a naive "rank by prior minutes per match" baseline's
**0.407**. Per position the model loses at midfield (0.412 against 0.464) and at forward (0.452
against 0.476), and wins only at goalkeeper and defender. On the horizon the solver actually plans
over, the five-input hand-built model is at best level with a one-line ranker.

`docs/model-review-2026-09-02.md` §3 and §4 named this outcome in advance and named the response:
the remaining headroom is **player-quality resolution**, which shrunk in-season xG/xA cannot supply,
and the answer is a small learned model on the columns this repo already ingests, written behind
the projections-CSV seam as a second `model_version`. That is R6, and feature-list items 30 and 31.
The review said not to start it before R1 and R2 had landed and been read. They have.

**This ticket is R6's first slice and it changes nothing user-visible.** It builds the training
substrate only. No model is trained here, no projection moves, no recommendation changes, and
`baseline-v1` is untouched. This mirrors the #146 → #154 pattern exactly: store the substrate in one
ticket, consume it in the next.

## The gate, stated now so the later slices are judged against it

The review's original gate was "beat the repaired baseline's per-position Spearman on the
five-gameweek target". **That gate is now too weak and must not be used** — report 10 shows the
naive minutes baseline already beating the repaired baseline. The gate for learned-v1 is the
**naive baseline**, per position, on the five-gameweek target, on the same measured population with
the same exclusions:

| Position | Must beat |
|---|---|
| Goalkeeper | 0.240 (the model's own figure — it beats the baseline here) |
| Defender | 0.374 (the model's own figure, for the same reason) |
| Midfielder | **0.464** (the naive minutes baseline) |
| Forward | **0.476** (the naive minutes baseline) |

The hindsight ceiling for reference is 0.201 / 0.479 / 0.521 / 0.562. The winnable band at midfield
and forward is roughly 0.06 to 0.09 of Spearman, and that is the whole prize.

## Scope

**In scope:**

- A migration adding one table holding point-in-time training rows, one per
  (season, gameweek, player_code), built on the same strictly-before guarantee `feature_history`
  already provides. RLS read-only for `anon`, `SELECT/INSERT/UPDATE` for `service_role`, no
  `DELETE`, and an explicit `GRANT` in the same file.
- A hand-run script assembling those rows from `player_match_stats` and `feature_history`, carrying
  the strongest columns the ingest already holds: shots, shots on target, chances created, big
  chances missed, touches in the opposition box, the existing xG and xA rates, the minutes
  structure (`prior_recent_minutes` and the season share), the two defensive-contribution counters,
  position, team code, opponent team code, and the point-in-time team-strength figures the backtest
  already computes.
- Counters in `job_runs.details` for rows read, rows written, rows excluded and why, reconciling
  arithmetically.
- A written note in `docs/projection-model-backlog.md` recording the column list, why each column
  was included, and the gate above.

**Explicitly out of scope:**

- **No model is trained and no model is evaluated here.** That is the next slice.
- No change to `baseline-v1`, to anything under `src/lib/projection/`, to `scripts/project-points.ts`
  or to the projections CSV.
- No change to `scripts/run-backtest.ts`.
- No new external data source. Every column must already exist in this repo's own tables — if a
  column named above turns out not to be ingested, drop it and say so rather than adding an ingest.
- No workflow change. The script is hand-run, exactly as `build-feature-history.ts` is.
- Nothing user-visible. No app surface, no recommendation, no notification.

## Definition of done

- [ ] The migration is idempotent, creates the table with RLS and an explicit `GRANT` in the same
      file, and is listed in `supabase/README.md` as not yet applied.
- [ ] The assembly script is pure over its inputs where the logic lives, with named tests proving:
      the strictly-before guarantee holds (a gameweek-N row contains no gameweek-N or later data);
      a player with no prior matches produces no row rather than a row of zeros; and the counters
      reconcile.
- [ ] Every column carries a comment saying where it comes from and why it is expected to carry
      signal.
- [ ] The backlog entry records the column list and the gate table above verbatim.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` exit 0.
- [ ] Scope constraint: one new migration, one new script and its test under `scripts/`,
      `supabase/README.md`, `docs/projection-model-backlog.md`, and this ticket's own
      `decisions/ticket-<issue>.md`. Nothing else — in particular nothing under `src/`.

## What will NOT change, and must be said in the PR

Per `LEARNINGS-second-build-wave.md` §15. No projection, recommendation, report figure or app
surface moves when this merges. The backtest's numbers are identical before and after. The next
backtest run will look exactly like report 10. That is correct — this ticket builds a substrate, and
the follow-up consumes it.

## The human check after merge

Apply the migration by hand, then run the assembly script and confirm the counters reconcile and the
row count is in the same order as `feature_history`'s own 18,588.

## Notes for the Analyst / Builder

- The lookahead guard is the whole ticket. `feature_history`'s strictly-before rule is the pattern
  to copy, and the three leaks G13 records were all failures of exactly this discipline in a
  neighbouring file. Write the guard test first.
- Do not reconstruct OpenFPL's 196 features. `product-brief.md` §6d calls that the ticket shape this
  pipeline handles worst, and the review agreed. Fifteen columns the repo already has, with a
  pre-registered gate, is the shape that works here.
- Ids are not stable across seasons. Key on `player_code` and `team_code`, never on an element id
  or a team id (`deltas.md` D9).
- Filter to `competition = 'prem'` on every read of `player_match_stats`, and pass an explicit
  ordering to every paginated read.
