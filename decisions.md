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
```
