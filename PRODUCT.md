# Product

<!-- impeccable:product-schema 1 -->

## Platform

web

## Users

Keshav, single user, playing Fantasy Premier League and checking in each gameweek to decide
transfers, captaincy, and starting XI before deadlines.

## Product Purpose

Give weekly transfer and lineup advice: recommend transfers, captain picks, and starting XI
each gameweek. Advice-led, not a passive tracker — the app's value is in the recommendation,
not just displaying data.

## Positioning

Personalized to Keshav's actual squad, bank balance, available chips, and rank — not generic
tips. Backed by automated data crunching (fixture difficulty, form, ownership, price-change
signals) so he doesn't have to manually research each week. Full mechanism/data sources are
still to be detailed in the Phase 7 product brief (`app-factory-system-design-v2.md`).

## Operating Context

Built and maintained by the App Factory pipeline: autonomous agents (Analyst, Builder, QA)
dispatched by a Claude Code Routine, reviewed by Keshav each run morning. Work happens on
`claude/ticket-<number>-<slug>` branches; decisions are logged in `decisions.md`; the board is
GitHub Projects (Ready → In progress → For review → Done, plus Blocked).

## Capabilities and Constraints

- Single-user only — no multi-tenant auth or account system needed.
- Must stay within free-tier Supabase and Vercel infrastructure.
- Must remain installable as a PWA to the iPhone home screen and usable in a laptop browser.
- Currently infrastructure-only scaffold (Vite + React + TypeScript PWA, Supabase client
  wired with a connectivity check). No advisory features exist yet.
- Full product brief with detailed mechanism and data sources is deferred to Phase 7, once the
  App Factory pipeline itself is built and verified.

## Product Principles

- Advice over data dump: recommendations lead, raw stats support.
- Personalize to Keshav's actual squad and situation rather than generic FPL content.
- Stay within free-tier infra; no cost creep.
- Single-user simplicity — don't build for accounts, sharing, or multi-tenancy.
