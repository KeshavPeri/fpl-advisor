# FPL Advisor

A personal Fantasy Premier League advisory and management app — built and maintained by the
App Factory pipeline (see `github.com/KeshavPeri/app-factory`).

**Status:** building the first wave of features. Landed so far — dark app shell and design
tokens (#8), Supabase reference schema (#9), scheduled GitHub Action with a heartbeat job (#10),
and the 2026/27 scoring rules module (#15). Next: FPL API ingest (#11) and FPL-Core-Insights
ingest (#12). Full backlog and build order: `feature-list.md`.

## What this is

Personal-use PWA, installable on iPhone home screen and usable in the laptop browser. Built by
autonomous agents (Analyst, Builder, QA) dispatched by a Claude Code Routine, reviewed by
Keshav each run morning. Full system design: see the App Factory repo's
`app-factory-system-design-v2.md`.

## Repo conventions

- Branch convention: `claude/ticket-<number>-<slug>` — see `CLAUDE.md`.
- Decisions log: **one file per ticket in `decisions/`.** Root `decisions.md` is a read-only
  archive of everything logged before 11 Aug 2026 — see `decisions/README.md` for why it split.
- **There is no project board.** State lives on issue labels — `status:ready`,
  `status:in-progress`, `status:for-review`, `status:blocked`, and Done means the issue is
  closed. A cloud run provably cannot reach GitHub Projects v2 (`deltas.md` D1 in the app-factory
  repo); read that before proposing a board again. Build order is ascending issue number, and
  that is the entire priority mechanism.
- Database migrations live in `supabase/migrations/` and are applied **by hand** by Keshav — no
  agent touches live data. `supabase/README.md` tracks which have actually been applied.
- Tests: `npm run test` (Vitest). Build: `npm run build`. Lint: `npm run lint` (oxlint).

## Where the thinking lives

- `product-brief.md` — scope, data sources, escalation pre-answers. The Analyst checks this
  before reasoning about anything.
- `design-reference.md` — visual direction. Read on every ticket.
- `feature-list.md` — 33 items in build order with dependencies.
- `escalation.md` — the three tiers, the single canonical copy.
- `CLAUDE.md` — how work flows, and the rules a fresh session needs before acting.

`PRODUCT.md` and `DESIGN.md` are Impeccable-generated seeds that predate any built feature;
`product-brief.md` and `design-reference.md` supersede them on any question of mechanism, scope
or visual direction.
