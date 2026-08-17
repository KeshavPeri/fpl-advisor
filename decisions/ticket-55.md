# Decisions — ticket #55

## HIGH-IMPACT

- **The Telegram message reuses `recommendation_reasons` text verbatim rather than rebuilding
  wording (captain choice, hit cost/net, confidence band) from raw `recommendations` columns**,
  **because** that composition logic already exists from ticket #47 (whose own file header
  names Telegram as an intended future reader of it), and re-deriving it here would both
  violate this ticket's "no change to the recommendation itself" scope constraint and risk the
  Telegram message and the in-app reasoning screen silently drifting apart over time — saying
  different things about the same plan. (Tier 2)
- **Infeasible-solve detection reads the most recent `solver_runs` row for the current
  gameweek and checks `solver_status` against `/infeasible/i`, rather than looking for an
  absent `recommendations` row alone**, **because** an infeasible solve never produces a
  `recommendations` row at all — `store-solver-output.ts` throws before
  `generate-recommendations.ts` runs — so "no recommendation" and "infeasible" are otherwise
  indistinguishable, and `product-brief.md` §6c requires the infeasible case to get its own
  specific message rather than the generic no-recommendation notice. (Tier 2)
- **Added an explicit `REVOKE UPDATE, DELETE ON public.notifications FROM service_role`** to
  the `notifications` migration, **because** live-testing against a real Postgres instance
  showed that an earlier migration (`20260811160000_table_grants.sql`)'s schema-wide
  `ALTER DEFAULT PRIVILEGES ... GRANT ... UPDATE ... TO service_role` (no `FOR ROLE` clause)
  silently applies to every table created afterward by the same role — including this one —
  regardless of what this migration's own explicit `GRANT` list says. Without the REVOKE,
  `service_role` would have had UPDATE on an append-only log table, undermining the entire
  reason the table exists in that form. QA independently reproduced this against a fresh
  Postgres instance and confirmed the REVOKE closes the gap. (Tier 2)

## ROUTINE

- **"Current gameweek" is computed the same way `sync-squad.ts` already does** (the next
  unpassed deadline, falling back to the last gameweek if none is upcoming), duplicated locally
  as `determineCurrentGameweekId` rather than imported, and named distinctly from
  `generate-recommendations.ts`'s similarly-named but differently-defined
  `deriveCurrentGameweekId`. Matches the existing convention of small per-job duplication
  documented in this repo's `CLAUDE.md`. (Tier 3)
- **A recommendation for a gameweek later than "current" is treated as current**, not as stale
  or an error — covers the case where the solver has run ahead of the gameweeks-table lookup.
  (Tier 3)
- **Single primary-key-bounded reads** (the recommendation row, the solver-run row, the
  notifications dedup check) are plain queries, not paginated through the shared helper —
  matches the precedent already set and QA-verified in `decisions/ticket-47.md` for
  single-row-bounded reads. (Tier 3)
- **Idempotency dedup key is `(gameweek_id, message_text, outcome='sent')`** — an identical
  already-sent message for the same gameweek is skipped (`job_runs` status `'skipped'`), with
  no duplicate Telegram call or log row. This is what lets item 15's future 24-hour/10-hour
  triggers call this job twice per gameweek safely. (Tier 3)
- **Plan C is never queried at all** — only `plan_index IN (0, 1)` ever appears in the
  Supabase reads — enforcing "Plan C is not sent" structurally rather than by filtering it out
  of an already-fetched result. (Tier 3)
- **The `solver-run.yml` step runs on `always() && squad_found == 'true'`**, not gated on the
  store/generate steps' own success, so that a crash, a timeout, or an infeasible solve still
  reaches this job and produces the failure notice §6c/§6d require, instead of silence. (Tier 3)
- **No money or calendar-date formatting helpers were added**, since nothing this ticket's
  messages currently emit needs them (whole-number points and gameweek numbers only) —
  `product-brief.md` §8's money/date formatting rules are satisfied vacuously rather than by
  unused speculative code. (Tier 3)
