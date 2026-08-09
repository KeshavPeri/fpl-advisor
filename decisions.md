# Decisions log

Appended by the orchestrator at the moment each decision is made — never compiled after the
fact. See `app-factory-system-design-v2.md` §4.6 for the full rule.

Every HIGH-IMPACT entry must state *why*, not just *what*. "Chose X" is useless at 8am.
"Chose X **because** the brief says Y" lets Keshav spot a misread brief in three seconds.

**Health signal:** if HIGH-IMPACT regularly runs past ~5 items a night, the Analyst has gotten
loose about what counts as high-impact — tighten the rules, don't just keep logging.

```
HIGH-IMPACT
#0 — Repo scaffolding stored as one repo per app rather than a monorepo,
     because each app has an independent Vercel/Supabase project and independent
     release cadence, and cross-app coupling would make crash-tolerant, stateless
     runs harder to reason about.

ROUTINE
#0 — Repo initialised with README, CLAUDE.md stub and this decisions.md during
     infrastructure setup (Phase 3), ahead of any tickets.
#1 — Read Impeccable's SKILL.md and README (github.com/pbakaus/impeccable) before installing
     (task 3.13). One thing worth flagging, not blocking: it's at v4.0.4, well ahead of the
     v1.5.1 the system design doc cited (17 Mar 2026) — the skill has clearly moved fast, but
     nothing in the current version contradicts how the design doc expected to use it
     (`init`/`document` still write PRODUCT.md/DESIGN.md as assumed; 59 detector rules, 23
     commands, both match the doc's figures exactly). It also ships an optional `hooks` feature
     that auto-runs the anti-pattern detector after every UI file edit — leaving this OFF for
     now per §5.4 (heavy design skills confined to polish tickets only); turning hooks on would
     silently apply Impeccable-level scrutiny to every ticket, which is exactly the per-ticket
     quota tax the design deliberately avoids.
#2 — Read emil-design-eng's SKILL.md (github.com/emilkowalski/skills, official repo) before
     installing (task 3.15). No surprises — detailed, well-reasoned animation/motion guidance
     (easing curves, duration tables, spring vs. CSS-transition tradeoffs, accessibility via
     prefers-reduced-motion, performance rules). Matches what the design doc expected: a motion
     decision framework, not a second competing aesthetic rulebook. Installed via the official
     `npx skills@latest add emilkowalski/skills` command, which pulls the whole collection
     (animate, review-animations, improve-animations, etc.), not just the core skill alone.
```
