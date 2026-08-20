# Ticket #69 — Preflight check

## HIGH-IMPACT

- **`job_name = 'solver-run'` is shared by three scripts** (`build-solver-input.ts`,
  `store-solver-output.ts`, `generate-recommendations.ts` — verified directly against all three
  files), so there is no distinct `job_runs.job_name = 'generate-recommendations'` row anywhere in
  the live database. Check 8 (job freshness) asks for both `solver-run` and
  `generate-recommendations` as separate, named freshness signals. Rather than let the
  `generate-recommendations` entry FAIL permanently and uninformatively (there being no row under
  that exact `job_name`, ever, regardless of the chain's real health — which would train Keshav to
  ignore a chronically-red line and defeats the whole point of this ticket), this job
  disambiguates using the message-prefix convention every one of those three scripts already
  writes on every row it inserts (`` `${JOB_NAME}/build-solver-input: ...` ``,
  `` `${JOB_NAME}/store-solver-output: ...` ``, `` `${JOB_NAME}/generate-recommendations: ...` `` —
  verified by reading all three files' own message strings). `solver-run`'s freshness entry means
  "the most recent `job_runs` row under `job_name='solver-run'`, from any of the three scripts";
  `generate-recommendations`'s entry means "the most recent row under that same `job_name` whose
  `message` starts with `solver-run/generate-recommendations:`". This is entirely read-only and
  additive — it touches none of the three existing scripts, which are outside this ticket's scope
  either way — but it is a real inferred coupling to a string convention those files did not
  design for this purpose. If a future ticket changes that message-prefix convention,
  `generate-recommendations`'s freshness check starts reporting FAIL (no matching row found)
  rather than silently reporting nothing, which is the correct failure mode for a job whose whole
  purpose is to never return a false pass — but it is worth knowing that's why, if it happens.
- **A missing table or a failed Supabase query never aborts the whole run — it fails only the
  check(s) that depend on it.** Every other `scripts/*.ts` job throws on a missing table/query
  error and lets that abort the entire script, which is correct for a job that does one thing.
  This job does ten independent things, and the ticket's own Notes are explicit that a false pass
  on an unrelated missing table is "worse than no check." `safeFetchAllPages` / `safeMaybeSingle` /
  `safeCount` (this file's own wrappers around `scripts/lib/paginate.ts`) never throw — they return
  an `error: string | null`, and the caller turns a non-null error into a FAIL `CheckResult` for
  exactly the dependent check(s), while every independent check still evaluates and appears in the
  report. This is a deliberate, ticket-specific departure from every prior job's own
  throw-and-abort convention, made because a preflight tool's entire value is in reporting
  everything it can, not stopping at the first thing it can't.

## ROUTINE

- **Checks 2 (squad), 3 (projections), 4 (recommendation), 5 (solver) and 9 (notifications) all
  target the SAME gameweek — the one `gameweeks` row check 1 resolves via `is_next`**, resolved
  once in `main()` and passed to every dependent check rather than re-derived per check (which
  would risk two checks disagreeing about which gameweek is "next"). If zero or more than one row
  is marked `is_next`, none of those five checks can resolve a target and all report FAIL with a
  reason pointing back at check 1 (`UNRESOLVED_GAMEWEEK_REASON`). If exactly one row is marked
  `is_next` but its own deadline has already passed (check 1 itself FAILs on that), the gameweek id
  is still well-defined and every dependent check still evaluates against it — a passed deadline is
  a real, useful thing to know about a squad/projection/solve/recommendation/notification, not a
  reason to stop looking.
- **Check 3's "none of them all-zero" is a hard FAIL, independent of the coverage-count tolerance,
  which is a WARN.** The ticket's own Notes name "a projection count slightly under the player
  count" as the WARN example for this check; an all-zero row (`expected_points = 0 AND
  expected_minutes = 0`) is a broken projection for that specific player, not a coverage shortfall,
  and is treated as the "no projections" FAIL criterion the ticket states explicitly. `>=1` all-zero
  row is enough to fail the whole check, deliberately over-sensitive rather than under — per the
  ticket's own calibration warning ("an over-sensitive check gets investigated; an under-sensitive
  one gets trusted and is wrong").
- **`PROJECTION_COVERAGE_WARN_THRESHOLD = 0.95` and `PROJECTION_COVERAGE_FAIL_THRESHOLD = 0.5`** are
  round, conservative numbers, not fitted to any calibration data (none exists yet for where
  "slightly under" should sit). Below 50% coverage is treated as functionally equivalent to "no
  projections" (FAIL); between 50% and 95% is WARN; at or above 95% is pass.
- **Check 9 (notifications) FAILs only once the deadline has actually passed without
  `deadline_10h` ever having been sent** — not merely because `deadline_24h`'s window has closed
  unsent (that is the schedule module's own documented, intentional behaviour: "at or inside 10h
  remaining... REGARDLESS of whether deadline_24h already fired or was missed entirely"), and not
  merely because a window is "due but not yet fired" while time still remains (the hourly cron will
  get another chance). This mirrors the ticket's own FAIL criterion literally: "no
  next-gameweek/.../notification wrong or absent." A `sent` `deadline_10h` row before the deadline
  is a pass regardless of `deadline_24h`'s fate, matching the schedule module's own "tightest
  unsent window wins" rule.
- **Check 10 (configuration) treats `TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` as FAIL if unset, not
  WARN.** `scripts/send-telegram.ts` and `scripts/notification-schedule.ts` both exit zero and send
  nothing at all when either is unset — by design, so those workflows are safe to run before the
  bot exists. But that same design means an unset Telegram credential TODAY *guarantees* an absent
  notification, which is this ticket's own FAIL criterion verbatim ("no next
  gameweek/.../notification wrong or absent"). `FPL_ENTRY_ID` is WARN: `scripts/sync-squad.ts`
  degrades gracefully when it is unset (the squad can still be entered manually via the existing
  entry screen), so a missing entry id is a quality degradation, not a broken chain. This is the
  ticket's second genuinely ambiguous call (alongside the all-zero-projections one above) — chose
  FAIL for the two Telegram variables per the ticket's own instruction ("if a specific check is
  genuinely ambiguous, choose fail and say why").
- **Single-row-bounded Supabase reads (`squads` by `gameweek_id`, `recommendations` by
  `(gameweek_id, plan_index)`, the single most-recent `solver_runs`/`job_runs` row via
  `.order(...).limit(1)`) are plain queries, not run through the pagination helper** — same
  exemption established in `decisions/ticket-43.md` and reaffirmed in `decisions/ticket-47.md`
  ("single-row primary-key lookups... are plain queries, not paginated"), extended here to any
  query structurally bounded to at most one row by `.limit(1)`, since `scripts/lib/paginate.ts`'s
  `db-max-rows` truncation bug cannot occur on a query that can never return a second row to begin
  with. Every read that can genuinely return more than one row (`gameweeks`, `teams`, `fixtures`,
  `squad_picks`, `player_projections`, `player_match_stats`, `notifications`) goes through
  `safeFetchAllPages`, matching every job since ticket #43.
- **`RECOMMENDATION_STALE_TOLERANCE_MS = 5 minutes`** — a small positive clock-skew buffer for
  check 4, so ordinary jitter between `store-solver-output.ts` writing `solver_runs.created_at` and
  `generate-recommendations.ts` writing `recommendations.updated_at` moments later in the same
  workflow run can never register as a false "stale" reading.
- **`STALE_JOB_HOURS = 36`** — pre-answered directly in the ticket's own Notes (nightly cron runs
  daily, so healthy is always under ~25h; 36 leaves room for one delayed run).
- **This ticket's own manual run against the live database was not performed** — no Supabase
  credentials are available in this sandbox. Every DoD item verifiable without a database (the
  pure assertion logic, all ten checks' pass/warn/fail paths, the configuration-safety test) is
  covered by `scripts/preflight-check.test.ts`'s 55 named tests; `npm run build`, `npm run lint`
  and `npm run test` all pass clean. Per the ticket's own Notes ("this is optional and only if
  credentials are available; do not treat inability to hit the live DB as a blocker"), Keshav
  should run `npx tsx scripts/preflight-check.ts` (or dispatch the new workflow) against the real
  database once this merges — that is the one thing this ticket cannot self-verify.
