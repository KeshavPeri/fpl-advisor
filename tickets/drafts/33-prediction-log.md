## Context

Feature-list item 23 — **the only thing that will ever tell us whether the model is any good.**

Depends on item 10 (`player_projections`, merged and populated) and #11 (`scripts/ingest-fpl.ts`).

`product-brief.md` §2 lists prediction accuracy as a core v1 feature: "every projection stored,
scored against actuals after gameweek lockdown, and shown as a rolling figure in-app." §6d's
scoring notes add the constraint that makes it non-trivial: **"Gameweek lockdown is 09:00 UK time
the morning after the final match, not one hour after the final whistle. The accuracy tracker must
wait for lockdown before scoring itself, or it will compare against provisional bonus and defcon
numbers."**

Right now there is no measurement of any kind. Every question about whether the model is
well-calibrated — including the open one in `docs/projection-model-backlog.md` G7 about defenders
being captained — is answered by re-running a one-off report against last season's data. This
replaces that with a permanent, per-gameweek record.

**On urgency, stated honestly.** I previously told Keshav GW1's projections would be lost forever
without this. That was wrong. `player_projections` is keyed on `(gameweek_id, player_id,
model_version)` and the projection horizon moves forward with `gameweeks.is_next`, so once GW1 falls
out of the horizon its rows stop being rewritten and simply persist — holding the last projection
made before the deadline, which is what a snapshot would have captured anyway. **This ticket is
important but not a race.** Its real value is the settlement half and the discipline of a stable
record.

## Scope

**In scope:**

- **`supabase/migrations/20260821090000_prediction_log.sql`** — creates `prediction_log`: one row per
  gameweek × player × model version, carrying the projected figures captured before the deadline and
  the actual points filled in after lockdown, with RLS **and** GRANTs in the same file.
- **`scripts/snapshot-predictions.ts`** — copies the current gameweek's `player_projections` into
  `prediction_log` and stamps when it was taken.
- **`scripts/settle-predictions.ts`** — after lockdown, writes actual points onto the matching rows
  and computes the error.
- Whatever the ingest must additionally capture for actuals to exist (see the definition of done).
- A new workflow running both on a schedule, plus `workflow_dispatch`.
- Vitest tests for the lockdown rule, the error arithmetic and the settlement guard.
- One `job_runs` row per execution, per job.

**Explicitly out of scope:**

- **No UI, no rolling accuracy display.** That is item 24 and reads what this stores. Nothing under
  `src/` changes.
- **No change to the projection model.** Nothing under `src/lib/projection/` or
  `scripts/project-points.ts`.
- **No change to `scripts/build-solver-input.ts`, `scripts/generate-recommendations.ts`,
  `src/lib/recommendation/`, `scripts/preflight-check.ts` or anything under `src/lib/verdict/`.**
  Other tickets in this batch own those.
- **No re-scoring of past gameweeks and no backfill** beyond whatever a first run naturally captures.
- **No point-in-time historical feature pipeline.** Item 29, and explicitly the largest item on the
  list.
- **No model comparison, no A/B of model versions.** The `model_version` column exists so item 31 can
  do that later; this ticket only records.
- No new npm dependency.

## Definition of done

**Build**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] Nothing under `src/` is added, changed or deleted.
- [ ] No new entry in `package.json`.

**The table**

- [ ] `prediction_log` is keyed on `(gameweek_id, player_id, model_version)` and carries at least:
      `player_code`, `projected_points`, `projected_minutes`, `components jsonb`, `captured_at`,
      `actual_points`, `actual_minutes`, `settled_at`, and a signed `error` (`actual − projected`).
- [ ] Actual and settlement columns are **nullable** — an unsettled row is a real, expected state and
      must be distinguishable from a settled row whose actual happened to be zero.
- [ ] **The same migration issues `GRANT SELECT` to `anon` and `GRANT SELECT, INSERT, UPDATE` to
      `service_role`. No `DELETE`.** *(`deltas.md` D8 — RLS and GRANTs are two independent gates.)*
- [ ] RLS enabled with a `SELECT` policy for `anon`.
- [ ] Idempotent, with the same `anon` / `service_role` role guard every prior migration uses.

**Snapshot**

- [ ] The snapshot copies every `player_projections` row for the current gameweek at the current
      model version, including `components`, and stamps `captured_at`.
- [ ] **Re-running before the deadline overwrites the snapshot** — the intent is "the projection as it
      stood closest to the deadline", so a later run within the same gameweek replaces an earlier one.
- [ ] **Re-running after the deadline does not overwrite it.** Once the deadline has passed the
      snapshot is frozen; a run after that logs why it did nothing and exits zero. Named test either
      side of the boundary. *(Without this, the first post-deadline run silently replaces the
      prediction with one made with hindsight, and the whole record becomes worthless.)*
- [ ] A gameweek with no projections exits zero with a named message and writes nothing.

**Settlement — the lockdown rule**

- [ ] Settlement runs only for a gameweek that is **finished** and where the current time is at or
      past **09:00 UK time on the day after that gameweek's final match**. Earlier than that, the job
      exits zero with a named message and writes nothing.
- [ ] The lockdown comparison is a pure function taking the fixture times and "now" as arguments —
      no `Date.now()`, no argument-less `new Date()`. Named tests at one minute before and one minute
      after the boundary.
- [ ] **UK time means Europe/London, which observes daylight saving** — unlike Singapore. A fixed UTC
      offset is wrong for half the season. The string `'Europe/London'` appears in the code, and there
      is a named test using a date inside British Summer Time and one outside it.
- [ ] An already-settled row is not re-settled. Named test.
- [ ] `error` is stored as `actual_points − projected_points`, so a positive value means the model
      under-projected. Named test for each sign.
- [ ] `job_runs.details` records rows settled, rows skipped as already settled, mean absolute error,
      and mean signed error — the second is what reveals a systematic bias, the first only reveals
      noise.

**Actuals**

- [ ] The source of a player's actual gameweek points is **verified against a live FPL API response
      before being relied on**, not assumed from field-name memory. The Action has unrestricted
      network access, so this can and must be checked rather than guessed.
- [ ] If capturing actuals requires a new column on `players`, that column is added in the same
      migration and populated by `scripts/ingest-fpl.ts`, and the change to that script is limited to
      adding the field.
- [ ] **A player with no actual available is left unsettled rather than settled as zero.** Named test.
      A missing measurement and a measured zero are different facts and conflating them silently
      poisons every average built on top.
- [ ] The actuals path makes no per-player API call. A design needing ~600 requests per gameweek is
      the wrong design; state the chosen approach in the decisions log.

**Robustness**

- [ ] Both jobs read exactly `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. No `VITE_`-prefixed variable.
- [ ] Every Supabase read uses the shared pagination helper and asserts its row count against an
      independent count. `prediction_log` will exceed 1,000 rows after two gameweeks.
- [ ] Neither job issues a Supabase row-removal call. No migration here grants `DELETE`.
- [ ] The workflow declares a `timeout-minutes`, and its cron is stated in UTC with a comment
      deriving it. *(`deltas.md` D2.)*
- [ ] Scope constraint: only `scripts/snapshot-predictions.ts`, `scripts/settle-predictions.ts`, a
      shared lockdown helper under `scripts/` if needed, their test files, `scripts/ingest-fpl.ts`
      (field addition only), `supabase/migrations/20260821090000_prediction_log.sql`, a new
      `.github/workflows/prediction-log.yml`, and this ticket's own `decisions/ticket-<number>.md`
      are added or changed. Nothing under `src/` or any other file in `scripts/` or
      `.github/workflows/` changes; `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **The freeze-after-deadline rule is the most important line in this ticket.** A prediction log that
  can be rewritten after the outcome is known is not a prediction log. Get the boundary right and
  test both sides of it; everything else here is bookkeeping by comparison.
- **09:00 UK the morning after the final match, not the final whistle.** `product-brief.md` §6d is
  explicit and gives the reason: bonus points and defensive contributions are provisional until then,
  so settling early scores the model against numbers that later change. Take the final match's
  kickoff from `fixtures`, roll to the next day, and use 09:00 Europe/London.
- **Europe/London observes daylight saving; Asia/Singapore does not.** Every other piece of time
  handling in this repo can treat a zone as a fixed offset. This one cannot. `Intl.DateTimeFormat`
  with an explicit `timeZone` handles it; a hardcoded `+00:00` or `+01:00` does not.
- **Store the signed error, not just the magnitude.** Mean absolute error tells you how noisy the
  model is. **Mean signed error tells you whether it is biased** — which is the actual open question
  in `docs/projection-model-backlog.md` G7, and it cannot be answered from absolute values.
- **Snapshot the `components` blob too.** Without it, a future finding of "defenders are
  over-projected" cannot be traced to clean sheets versus defcon versus appearance. It is one jsonb
  column and it is the difference between a number and a diagnosis.
- **Do not settle a missing actual as zero.** A player who did not feature has a real zero; a player
  whose data has not arrived has no measurement. Averaging the second as the first drags every
  accuracy figure down for a reason nobody will ever find.
- **Two other tickets are running in this batch.** One owns `scripts/build-solver-input.ts`,
  `scripts/generate-recommendations.ts` and `src/lib/recommendation/`; another may own the verdict
  card and `src/lib/verdict/`. This ticket touches neither. Pin the migration filename exactly as
  given — two migrations in one batch have collided on a timestamp before.
- **What a substitute cannot catch.** Tests prove the lockdown boundary, the freeze rule and the
  error arithmetic without a database or a clock. They cannot prove the actuals field exists or means
  what it appears to, and they cannot prove the GRANTs — a local Postgres runs as superuser
  (`deltas.md` D8). **The first real settlement happens after GW1 finishes; that run is what closes
  this ticket, and it is Keshav's check.**
