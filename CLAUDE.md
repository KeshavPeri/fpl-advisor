# CLAUDE.md

Personal FPL (Fantasy Premier League) advisory PWA, built by a semi-autonomous overnight
pipeline. **Every session here is fresh and stateless — no run can resume a previous one, no
run can ask a human mid-session, and the GitHub project board is the single source of truth.**
This file is your context; read it before acting.

Full design reasoning: `app-factory-system-design-v2.md` in the `KeshavPeri/app-factory` repo
(§ references throughout this repo point there).

## How work flows

Tickets (GitHub issues) are linted in the evening, queued in **Ready**, and picked up by a
scheduled overnight routine. The routine's top-level session is the orchestrator: it
dispatches the subagents in `.claude/agents/`, moves cards, appends to `decisions.md` at
decision time, and opens **draft** PRs. A human reviews from the phone in the morning and
merges manually. Batch limit: 2 tickets per run. Revision cap: 2 per ticket.

## Branch convention

All work happens on branches named `claude/ticket-<number>-<slug>`, e.g.
`claude/ticket-14-gameweek-deadline-countdown`. This matches Claude Code Routines' default
push restriction — `claude/`-prefixed branches are always accepted. Never commit to `main`.

## The board

GitHub project board **"FPL Advisor Pipeline"**, linked to this repo. Exactly five columns:

- **Ready** — linted tickets queued for the next run, in priority order (top first).
- **In progress** — being worked this run. A card here at run *start* means a previous run
  died; apply stale-card recovery (§4.4 2a): branch has commits → Blocked with a note;
  no commits → delete branch, card back to Ready.
- **For review** — draft PR open with the five-part review packet; awaiting human review.
- **Done** — merged by a human. Nothing else puts a card here.
- **Blocked** — awaiting a human decision (Tier 1 question, revision cap hit, or stale
  partial work). Each Blocked card carries a one-line, phone-answerable question.

Do not add columns (no Building/QA/Review — deliberate, §4.3).

## Escalation

The three tiers plus Rules A and B live in **`escalation.md` (repo root)** — the single
canonical copy; read it, never restate it. The two rules every session must know cold:
tiers classify *decisions, not just questions* (Rule A), and a Tier 1 stop *blocks the
ticket, never the run* (Rule B).

## Decisions log

**`decisions.md`, repo root.** Two sections: HIGH-IMPACT and ROUTINE. Appended by the
orchestrator **at the moment each decision is made**, never compiled afterwards. Every
HIGH-IMPACT entry states the *because* ("Chose X because the brief says Y") and is prefixed
with its ticket number. If HIGH-IMPACT regularly runs past ~5 items a night, that's a
calibration problem to note, not a logging quota to fill.

## Design-pass rule

Normal build tickets use the baseline `frontend-design` skill plus **`design-reference.md`
(repo root)** only — Builder reads the reference file on every ticket. **Impeccable and
emil-design-eng (installed under `.claude/skills/`) are invoked exclusively inside tickets
explicitly typed "polish"** — never on normal tickets (§5.4). `PRODUCT.md` and `DESIGN.md`
are Impeccable-generated and still provisional.

## The agents

`.claude/agents/analyst.md` (classifies decisions against the tiers, answers from the brief,
evening lint), `builder.md` (implements one ticket per invocation), `qa.md` (verifies the
definition-of-done, writes the five-part PR review packet, §4.8). They are subagents: they
cannot talk to each other — the orchestrator mediates every exchange.

## Stack and commands

- Vite + React 19 + TypeScript + `vite-plugin-pwa`; lint is oxlint.
- `npm run dev` / `npm run build` (includes `tsc -b`) / `npm run lint` / `npm run preview`.
- Supabase client: `src/lib/supabase.ts`. Env vars `VITE_SUPABASE_URL` and
  **`VITE_SUPABASE_PUBLISHABLE_KEY`** (current publishable-key format, *not* the legacy
  `ANON_KEY` name), set in Vercel — never hardcoded, never committed.
- Vercel auto-deploys `main` to production — `https://fpl-advisor-wine.vercel.app` — and
  gives every PR a preview URL (that URL is line 1 of every review packet).
- Product brief: `product-brief.md`, repo root — written at task 7.1; until it exists,
  brief-dependent questions are unanswerable, not guessable.
- FPL data comes from an unofficial API that changes without notice — every external fetch
  needs a graceful failure path.

## Hard rules

- Merging is always manual. Agents open **draft** PRs only; nothing here ever merges.
- No agent creates accounts, API keys, or signs up for services — owner-only (Tier 1).
- No destructive operations on live Supabase data (Tier 1).
- Commit early and often on the ticket branch and push it — crash-tolerance depends on
  committed work being visible to the next run.
- Ticket linting happens in evening interactive sessions, never inside the routine (§4.7).
