# CLAUDE.md

Personal FPL (Fantasy Premier League) advisory PWA, built by a semi-autonomous overnight
pipeline. **Every session here is fresh and stateless — no run can resume a previous one, no
run can ask a human mid-session, and the open GitHub issues with their `status:` labels are
the single source of truth.** This file is your context; read it before acting.

Full design reasoning: `app-factory-system-design-v2.md` in the `KeshavPeri/app-factory` repo
(§ references throughout this repo point there).

## How work flows

Tickets (GitHub issues) are linted in the evening, labelled `status:ready`, and picked up by a
scheduled overnight routine. The routine's top-level session is the orchestrator: it
dispatches the subagents in `.claude/agents/`, moves issues between `status:` labels, appends
to `decisions.md` at decision time, and opens **draft** PRs. A human reviews from the phone in
the morning and merges manually. Batch limit: 2 tickets per run. Revision cap: 2 per ticket.

## Branch convention

All work happens on branches named `claude/ticket-<number>-<slug>`, e.g.
`claude/ticket-14-gameweek-deadline-countdown`. This matches Claude Code Routines' default
push restriction — `claude/`-prefixed branches are always accepted. Never commit to `main`.

## The board is issue labels

**There is no project board in this pipeline.** A Claude Code Routine runs behind a GitHub
proxy that blocks GraphQL and restricts REST to repository-scoped paths; GitHub Projects v2 is
reachable by neither. Verified by direct experiment, 9 Aug 2026 — see `deltas.md` D1 in the
app-factory repo before proposing a board again.

State lives on **exactly one `status:` label per open issue**. The four working states of §4.3,
plus Blocked, map one-to-one:

| State | Label |
|---|---|
| Ready | `status:ready` — linted and queued for the next run |
| In progress | `status:in-progress` — being worked this run |
| For review | `status:for-review` — draft PR open with the five-part packet |
| Blocked | `status:blocked` — awaiting a human decision |
| Done | **the issue is closed.** No label |

Rules that make this work:

- **Closed beats labelled.** Every query filters to open issues, so a closed issue is Done
  regardless of what label it still carries. Nobody has to tidy up after a merge.
- **Order is ascending issue number** among `status:ready`. Lowest open number goes first.
  There is no other priority mechanism — if something must jump the queue, close and re-file it.
- **Exactly one `status:` label at a time.** To change state, read the issue's current labels,
  drop any label starting `status:`, add the new one, and write the **whole array back**.
  Writing a bare array replaces every label on the issue, so a careless write silently destroys
  non-status labels like `polish`.
- **A `status:blocked` issue always gets a comment** carrying the one-line question. The label
  is machine state; the comment is what reaches Keshav's phone as a notification. A blocked
  ticket with no comment is a failure of the mechanism, not a tidy edge case.
- **An issue labelled `status:in-progress` at run start** belongs to a run that died — apply
  stale-ticket recovery (§4.4 2a): branch has commits → `status:blocked` with a comment;
  no commits → delete the branch, back to `status:ready`.

Do not add states (no Building/QA/Review — deliberate, §4.3).

## Reaching GitHub from a routine

Use the **built-in GitHub tools** — `list_issues`, `issue_read`, `issue_write`, `get_label`,
`add_issue_comment`, and the PR tools. They are the only interface that works from a cloud run.

**`gh` and `curl` both fail against this repo's API paths** with 403s, and nothing you can
install or configure changes that; the proxy authenticates the built-in tools, not arbitrary
HTTP clients. Do not spend a run rediscovering this. Applying a label that doesn't exist yet
creates it, so a typo silently invents a state nobody queries — copy label names, don't type them.

Interactive local sessions are unaffected; `gh` works normally from Keshav's machine.

## Escalation

The three tiers plus Rules A and B live in **`escalation.md` (repo root)** — the single
canonical copy; read it, never restate it. The two rules every session must know cold:
tiers classify *decisions, not just questions* (Rule A), and a Tier 1 stop *blocks the
ticket, never the run* (Rule B).

## Decisions log

**One file per ticket: `decisions/ticket-<number>.md`.** Two headings inside it, HIGH-IMPACT and
ROUTINE. Written by the orchestrator on that ticket's own branch **at the moment each decision is
made**, never compiled afterwards. Every HIGH-IMPACT entry states the *because* ("Chose X because
the brief says Y").

**`decisions.md` in the repo root is a read-only archive** of everything logged before
11 Aug 2026. Nothing writes to it any more. It was split because two tickets in one batch both
append at the same point in one file, which conflicts on every 2-ticket run — git conflicts on
position, not content, so numbering the entries per ticket would not have helped. Separate files
cannot collide. If HIGH-IMPACT regularly runs past ~5 items a night, that's a
calibration problem to note, not a logging quota to fill.

## Design-pass rule

**`design-reference.md` (repo root) is read on every ticket.** That is the cheap, always-on
layer.

**`frontend-design` runs only on tickets that establish new visual direction** — app shell,
design tokens, a genuinely new surface. Narrowed from "every build ticket" on 10 Aug 2026:
the skill instructs the model to take an aesthetic risk and produce a signature element, which
is right for setting direction and wrong for extending an established UI. Tickets that extend
existing UI match existing components instead.

**Impeccable and emil-design-eng (installed under `.claude/skills/`) are invoked exclusively
inside tickets explicitly typed "polish"** — never on normal tickets (§5.4).

`PRODUCT.md` and `DESIGN.md` are Impeccable-generated and still provisional; `product-brief.md`
and `design-reference.md` supersede them on any question of mechanism, scope or visual
direction.

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

## Sharing code between `scripts/` and `src/`

**A `scripts/*.ts` job may import from `src/lib/`, and should, rather than copying logic.**
Established 15 Aug 2026 by ticket #33.

`scripts/` and `src/` are separate compilation environments (`tsconfig.scripts.json` vs
`tsconfig.app.json`) and the earlier jobs — `heartbeat.ts`, `ingest-fpl.ts`,
`ingest-core-insights.ts`, `sync-squad.ts` — all duplicate small helpers rather than import them.
That was a reasonable call for a four-line `readSupabaseEnv`. It is the wrong call for a scoring or
projection rule, where a second copy is a second thing to get wrong and nothing would ever flag the
drift.

The mechanism: `src/lib/` uses `.ts`-extension imports, which need
`allowImportingTsExtensions: true`. `tsconfig.scripts.json` now sets it. Without that flag
`tsc -b` fails the moment a job imports from `src/lib/`.

Two rules that follow:

- **`src/lib/scoring/` and `src/lib/projection/` are pure — no I/O — and must stay that way.**
  That purity is what makes them provable without a database and importable from either side. A job
  may read Supabase and map rows onto their input types; those modules may never read anything.
- **A ticket whose scope constraint lists exact files must list the build config too** if it is the
  first to cross this boundary, or it hands the Builder a contradiction. See `deltas.md` D10.

## Hard rules

- Merging is always manual. Agents open **draft** PRs only; nothing here ever merges.
- No agent creates accounts, API keys, or signs up for services — owner-only (Tier 1).
- No destructive operations on live Supabase data (Tier 1).
- Commit early and often on the ticket branch and push it — crash-tolerance depends on
  committed work being visible to the next run.
- Ticket linting happens in evening interactive sessions, never inside the routine (§4.7).
