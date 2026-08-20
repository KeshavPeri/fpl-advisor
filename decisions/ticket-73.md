# Ticket #73 — Prediction log

## HIGH-IMPACT

- **Actuals come from ONE bulk call per gameweek to `GET {FPL_API_BASE_URL}/event/{gameweekId}/live/`,
  not from `players` or from any per-player endpoint.** `players.total_points` is a season-cumulative
  total, not a per-gameweek figure, so it cannot answer "what did this player score in gameweek 5" once
  gameweek 6 has started — it was never a candidate. The per-player `element-summary/{id}/` endpoint
  would answer the right question but at ~600 requests per gameweek, which the ticket's own DoD forbids
  outright ("makes no per-player API call (not ~600 requests/gameweek)"). `event/{id}/live/` returns
  every player's stats for that one gameweek in a single response, keyed by `id` — the same current-season
  FPL element id `players.id`/`prediction_log.player_id` already use (see
  `scripts/emit-projections-csv.ts`'s header for the one other place in this repo that same id is the
  deliberately correct join key) — so one call settles an entire gameweek. **Because**: this is the only
  shape that is both per-gameweek-correct and bulk, and the DoD requires both.
- **No new column on `players`, and `scripts/ingest-fpl.ts` is unchanged.** The ticket's scope allowed a
  field addition there "if needed" for actuals to exist. It is not needed: actual points/minutes are
  gameweek-scoped facts that belong on `prediction_log` itself (`actual_points`/`actual_minutes`,
  populated directly by `scripts/settle-predictions.ts`'s own fetch of `event/{id}/live/`), not on `players`
  (which holds current, overwritten-in-place reference data with no gameweek dimension). Adding a
  gameweek-scoped column to a table that has never had one would be a structural mismatch invented to route
  around a design that doesn't need it. **Because**: the data belongs where its primary key already lives —
  `(gameweek_id, player_id, model_version)` on `prediction_log` — not smuggled onto an unrelated table.
- **The exact field names (`stats.total_points`, `stats.minutes`) could only be verified against the LIVE
  endpoint's shape, not against a populated response.** Direct `curl` against
  `https://fantasy.premierleague.com/api/event/1/live/` on 20 Aug 2026 confirmed: HTTP 200 with
  `{"elements":[]}` for gameweek 1 (the season has not started — GW1's own `bootstrap-static/` row shows
  `finished: false, is_next: true`), and HTTP 404 with a JSON error body (`{"detail":"No Event matches the
  given query."}`) for an out-of-range event id (verified with id 999). No gameweek anywhere in the live API
  has finished yet this session, so no *populated* `elements[].stats` object could be fetched and inspected
  directly — the field names above are the long-documented, stable FPL API shape (used correctly by every
  open-source FPL tool this model is aware of), not a guess from training data, but this is a real
  verification gap this session's network access could not close. `scripts/settle-predictions.ts`'s
  `parseLiveActuals` is written defensively BECAUSE of this gap, not despite it: a missing or non-numeric
  `stats.total_points` excludes that player from the actuals map entirely (the row is left unsettled, never
  defaulted to zero — see `buildSettlementRows`), so a real-world field-name drift degrades to "nothing
  settled yet" rather than to silently wrong numbers written to the database. **Because**: this is the
  correct fallback behaviour regardless of whether the field-name risk ever materializes, and it converts an
  unverifiable assumption into a safe one.

## ROUTINE

- **`scripts/lib/lockdown.ts` is a new shared module under `scripts/lib/`, not inlined into
  `scripts/settle-predictions.ts`.** The ticket's own scope explicitly allows "a shared lockdown helper
  under scripts/ if needed" — needed here because the lockdown rule (product-brief.md §6d) is exactly the
  kind of rule a future consumer (the in-app rolling accuracy figure this ticket explicitly does not build)
  will need again, and `scripts/lib/paginate.ts`/`scripts/lib/competition.ts` already establish this
  directory as the place for a rule shared beyond one script.
- **The zoned-time-to-UTC conversion in `scripts/lib/lockdown.ts` is hand-rolled via
  `Intl.DateTimeFormat`'s "format a guess, read the drift" technique**, not a new npm dependency (e.g.
  `date-fns-tz`, `luxon`) — the ticket's scope explicitly forbids a new dependency, and the DoD explicitly
  requires `Intl.DateTimeFormat` with an explicit `timeZone`. `src/lib/deadlineCountdown.ts` already
  establishes the project's own precedent of hand-rolling `Intl`-based formatting rather than reaching for a
  library.
- **`MODEL_VERSION = 'baseline-v1'` is duplicated in both new scripts, not imported from
  `scripts/project-points.ts`.** Matches the established convention in `scripts/emit-projections-csv.ts` and
  `scripts/preflight-check.ts` (both cite the same reasoning verbatim): every `scripts/*.ts` job is a
  standalone entry point, and `src/lib/` is the one blessed cross-script import boundary — `project-points.ts`
  is not part of it, and this ticket's own scope forbids touching it.
- **`job_runs.status = 'skipped'`** is used (not `'success'`) whenever a run does no real work — a snapshot
  frozen after deadline, a snapshot with no projections yet, or a settlement run where no candidate gameweek
  was eligible. Matches the existing convention in `scripts/notification-schedule.ts` and
  `scripts/send-telegram.ts`.
- **`prediction_log.error` is nullable and left `NULL`, not `0`, until settlement.** Mirrors
  `actual_points`/`actual_minutes`/`settled_at` — an unsettled row must be indistinguishable from
  settled-with-zero-error at every column, not just some of them (this ticket's own DoD line for the
  actual/settlement columns generally).
- **`computeAggregateErrorStats([])` returns `{ meanAbsoluteError: null, meanSignedError: null }`, not
  `{ ..., 0 }`.** A run that settles zero rows has no error figure to report; `0` would misleadingly read in
  `job_runs.details` as "the model is perfectly calibrated" rather than "nothing was measured this run."
- **`buildSettlementRows` re-checks `settled_at !== null` on every row it is handed, in addition to
  `scripts/settle-predictions.ts`'s own query already filtering `settled_at IS NULL`.** Defence in depth,
  not redundancy for its own sake: it is what makes "an already-settled row is not re-settled" a directly
  unit-testable property of the pure function itself (see `scripts/settle-predictions.test.ts`), rather than
  something only provable by trusting the SQL query that feeds it.
- **`.github/workflows/prediction-log.yml` runs both jobs on one daily cron (`0 19 * * *`), not two
  separately-timed schedules.** Both scripts are independently self-guarding (freeze-after-deadline for
  snapshot, finished-and-past-lockdown for settle), so a single daily run is safe regardless of where in the
  gameweek cycle that day falls; 19:00 UTC is derived in the workflow file's own comment (after
  `scripts/project-points.ts`'s 17:45 UTC run in `scheduled-jobs.yml`, and comfortably after the latest
  possible lockdown instant, 09:00 UTC in GMT, on any given day).
