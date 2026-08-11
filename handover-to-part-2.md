v1.0 — written 10 Aug 2026 at the close of the Phase 1 design workshop.

# Handover — Part 1 to Part 2

**Give this file, plus `new-app-kickoff.md`, to a fresh Cowork chat.** That chat runs Part 2:
it reads the actual codebase and writes GitHub issues. It does not redesign anything.

---

## What to attach to the Part 2 chat

| File | Where | Why |
|---|---|---|
| `new-app-kickoff.md` | The pack Keshav uploaded to start this session | Part 2's own instructions live in it |
| `product-brief.md` | Repo root | Scope, data sources, escalation pre-answers |
| `design-reference.md` | Repo root | Visual direction, read on every ticket |
| `feature-list.md` | Repo root | 33 items in build order with dependencies |
| This file | Repo root | The handover block itself |

---

## Handover block

```
APP: FPL Advisor
     repo: fpl-advisor — existing scaffold, Vite 8 + React 19 + TypeScript + Supabase + PWA.
     Infrastructure only. One ticket landed (#6, iOS home-screen title meta tag).
     No advisory features, no Supabase tables, no data layer.

PROBLEM: Keshav loses FPL points to decision fatigue and systematic bias (Arsenal, captaincy,
     chip timing), plus second-half drift — not to missing reminders. He already gets FPL's
     deadline notifications, acknowledges them, and still misses. So the app must arrive with
     the decision already made, so that acknowledging it and deciding are the same act.

OBJECTIVE: Maximise Keshav's own expected points. League standings displayed, never optimised
     for. No differential or effective-ownership logic.

BRIEF: product-brief.md
DESIGN REFERENCE: design-reference.md
FEATURE LIST: feature-list.md (33 items, build order, dependencies stated per item)

FEATURE LIST, BUILD ORDER — FIRST WAVE ONLY (file 6-10 tickets, no more):
  1. App shell and design tokens
  2. Supabase reference schema
  3. Scheduled GitHub Action scaffold (heartbeat only)
  4. FPL API ingest job
  5. FPL-Core-Insights ingest job
  6. Squad state schema and manual squad entry
  7. Squad sync from public FPL API
  8. 2026/27 scoring rules module
  --- items 9-33 in feature-list.md; re-lint against real code before filing them ---

OWNER SET-UP NEEDED BEFORE ANY TICKET RUNS (Tier 1):
  - Telegram bot token + chat ID via BotFather (free, no card, no payment)
  - Supabase service role key stored as a GitHub Actions secret
  - Vercel deployment protection OFF for previews (else QA cannot test the build)
  - FPL entry ID for the 2026/27 season
  - Verify the frontend-design plugin is installed (see below)

OPEN QUESTIONS NOT RESOLVED:
  - Geist font licensing and self-hosting — confirm before it enters a ticket. Fallback must
    not be Inter.
  - Exact net-gain threshold at which a -4 hit becomes recommendable — should come from the
    backtest, not from taste.
  - Whether the daily run should notify on a changed recommendation mid-week, or stay silent
    until the 24-hour mark. Notification fatigue is the failure mode this app exists to fix.
  - How much weight to give a 2025/26 backtest, given the 2026/27 BPS rebalance.
```

---

## Things Part 2 must not get wrong

**The CSV between projections and the solver is the most important boundary in the system.**
It is why the v1 baseline projection model can be replaced by a retrained OpenFPL in September
without touching the app, the data layer, the solver or the notifications. If a ticket blurs
that boundary, the upgrade path closes. Guard item 11.

**The app never logs in to FPL.** Every endpoint it uses is public and unauthenticated —
verified live on 10 Aug 2026. The only login-gated data is the mid-week in-progress squad, and
manual override registration covers it. Any ticket proposing to store an FPL credential,
cookie or session is a Tier 1 stop.

**The value loop closes at feature 15, not at 33.** Items 1–15 deliver data in, projection,
solver, recommendation, and a Telegram message carrying the decision. Everything from 16 onward
is app surface. If time runs short, cut from 16 downward, never from the middle.

**Schedule reality:** items 1–15 at two tickets a night is fifteen nights, and the GW1 deadline
is 01:30 Singapore time on Saturday 22 August 2026 — ten days out. Either some runs are
triggered manually, or GW2 becomes the first fully-advised gameweek. Both are fine. Discovering
it on the 20th is not.

**Design skill scope changed on 10 Aug 2026.** `frontend-design` now runs **only** on tickets
establishing new visual direction — ticket 1, essentially. Tickets extending existing UI read
`design-reference.md` and match existing components. `builder.md` and `CLAUDE.md` are updated;
`app-factory/assets/agents/builder.md` and system design §5.4 / §194 still carry the old
wording and are Keshav's to reconcile.

---

## Keshav's actions before Part 2

1. **Install the frontend-design plugin** and confirm it's there:

   ```
   /plugin marketplace add anthropics/claude-code
   /plugin install frontend-design@claude-code-plugins
   /plugin list
   ```

   Success looks like `frontend-design` appearing in the `/plugin list` output. If the second
   command errors, try `/plugin install frontend-design@claude-plugins-official` — the official
   marketplace may already be registered, in which case the first command is unnecessary.

2. **Commit and push these files to `main`.** Overnight runs clone the default branch — work on
   a feature branch, or committed but unpushed, is invisible to every run. Verify with:

   ```
   cd ~/Projects/fpl-advisor && git log origin/main --oneline -3
   ```

3. **Complete the four Tier 1 setup items above**, in your own browser. No credential is ever
   pasted into a chat.

4. **Start the Part 2 chat** with `new-app-kickoff.md` and the four repo files attached.

---

## After Part 2 files the issues

```
NEXT (Keshav):
  1. Read the drafts in tickets/drafts/ in your editor, not in the browser.
  2. Lint the first wave:  cd ~/Projects/fpl-advisor && claude
     "Fetch issues #N-#N+4 with gh issue view, dispatch the analyst
      subagent on each in turn, and report verdicts."
  3. Fix anything flagged.
  4. Add status:ready to the first four or five issues ONLY — from the dropdown, never typed.
  5. Leave the rest unlabelled until that wave has built.
```
