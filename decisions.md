# Decisions log

Appended by the orchestrator at the moment each decision is made — never compiled after the
fact. See `app-factory-system-design-v2.md` §4.6 for the full rule.

Every HIGH-IMPACT entry must state *why*, not just *what*. "Chose X" is useless at 8am.
"Chose X **because** the brief says Y" lets Keshav spot a misread brief in three seconds.

**Health signal:** if HIGH-IMPACT regularly runs past ~5 items a night, the Analyst has gotten
loose about what counts as high-impact — tighten the rules, don't just keep logging.

```
HIGH-IMPACT
#— (Phase 5, factory-level) Pipeline state moved off the GitHub project board and onto
     issue labels — status:ready / status:in-progress / status:for-review /
     status:blocked, with Done meaning the issue is closed — **because** a Claude Code
     Routine provably cannot reach GitHub Projects v2 by any available path, and because
     labels live outside the run's success path, which is what §2's crash-tolerance
     constraint actually requires.
     Evidence (two probe runs, 9 Aug 2026): GraphQL 403s with an explicit deny, tested via
     both curl and gh; user/org-scoped projectsV2 REST 403s with "sessions are bound to
     their configured repositories"; the repo-scoped endpoint the proxy suggests instead
     does not exist in GitHub's API; the built-in GitHub tools expose no projects tools;
     and no GitHub MCP connector exists that would bypass the session proxy.
     Rejected alternative — a GitHub Actions workflow doing the GraphQL outside the proxy:
     needs a classic PAT with project scope as a repo secret, and adds a second unproven
     moving part during the phase whose job is to prove the first one works. Same shape as
     the Telegram dispatch §7 already rejected. Revisit after Phase 6 if the columns are
     genuinely missed.
     Rejected alternative — a backlog.md file as source of truth: the routine cannot push
     to main, and a file cannot send a phone notification, which Rule B depends on.
     Ordering is now ascending issue number; that is the entire priority mechanism.
     Agent definitions, orchestrator prompt and escalation.md mirrors bumped to v0.3.
     §4.3's five states are unchanged — only their storage moved.

#0 — Repo scaffolding stored as one repo per app rather than a monorepo,
     because each app has an independent Vercel/Supabase project and independent
     release cadence, and cross-app coupling would make crash-tolerant, stateless
     runs harder to reason about.

#9 — Used FPL integer ids as primary keys (teams.id, players.id, gameweeks.id, fixtures.id)
     in the reference-schema migration because every downstream source (the FPL API,
     FPL-Core-Insights CSVs, the solver's own CSV) keys on FPL element/team/event ids, and
     introducing surrogate keys would force a join on every ingest write. This was pre-decided
     in the ticket text itself as Tier 2 ("how data is structured"); logged here per Rule A
     since it was carried out without a fresh question being asked.

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
#3 — Phase 4 dry-runs passed for all three subagent definitions (task 4.7, 9 Aug 2026).
     Analyst: Tier 3 for in-game currency display (cited escalation.md's rule, noted the
     absent brief without inventing content) and Tier 1 for login-cookie storage, returning a
     one-line phone-answerable question without answering it. Builder: delivered
     claude/ticket-0-home-footer-version with commits, clean build/lint, and the structured
     handback. QA: per-item verdicts, five-part packet, correctly refused to fabricate a
     preview URL for an unpushed branch, and flagged device-level rendering as not verifiable.
     Throwaway branch deleted after the run. Also added .claude/settings.json allowlisting the
     pipeline's command families (npm/npx/node/git/gh + read-only utilities, acceptEdits mode)
     because interactive dry-runs prompted for permissions repeatedly — overnight Routines
     never prompt mid-run (§4.1), so this is for interactive sessions like linting and
     dry-runs; rm and other destructive utilities deliberately left off the allowlist.
#4 — Ticket #6 (iOS home-screen title): used "FPL Advisor" for the new
     `apple-mobile-web-app-title` meta tag because it's the name already established
     unanimously elsewhere in the codebase — `index.html`'s `<title>` and both `name` and
     `short_name` in `vite.config.ts`'s VitePWA manifest config. No conflicting candidate
     existed, so this was a Tier 3 consistency decision, not a new naming choice.
     `product-brief.md` does not exist yet, so it wasn't consulted.
#5 — Ticket #8 (app shell + design tokens): chose accent hexes `#5ec8de` (cyan, positive/
     recommended) and `#e8825f` (coral, risk/warning) — lower-chroma, non-neon tones, chosen
     specifically because design-reference.md warns "dark base plus one bright accent" is
     itself an AI-default look, and a loud neon pair would fall straight into it.
#6 — Ticket #8: elevation values fixed at `--panel-fill: rgba(23,31,51,.55)`,
     `--panel-fill-raised: rgba(29,39,63,.62)`, `--panel-border: rgba(148,163,194,.14)`,
     blur `22px` + `saturate(150%)` — the saturate boost is the standard iOS-vibrancy trick
     that keeps blurred colour lively instead of washed out. Later tickets should match these
     rather than inventing new elevation numbers.
#7 — Ticket #8: added an ambient two-gradient background wash behind the shell, using the
     same `-dim` accent tokens, because a flat single-colour page gives `backdrop-filter: blur`
     nothing real to prove against — the wash makes the translucent-material claim visible in a
     screenshot, not just present in the CSS.
#8 — Ticket #8: named type scale by role, not size — `--text-label` 13px, `--text-body` 15px,
     `--text-title` 17px/550, `--text-display` 36px/600 — and a 4px-base spacing scale
     (4/8/12/16/24/32/48px), invented outright since no CSS framework is installed. Later
     screens should reach for these roles rather than picking new pixel values.
#9 — Ticket #8: panel/control radii set to 28px/14px, deliberately non-zero, to stay clear of
     the hairline-bordered "broadsheet" look design-reference.md also warns against.
#10 — Ticket #8: started a `src/components/` directory with `AppShell` and `Surface` as the
     first two primitives, because later tickets (verdict card, pitch view, reasoning screen)
     will compose against these same components rather than each inventing their own shell.
#11 — Ticket #8: gave `Surface` a single quiet 0.5s fade + 6px rise on mount, guarded by
     `prefers-reduced-motion: reduce` — the one motion design-reference.md's scope (orientation/
     state-change only) actually allows for a surface arriving on screen.
#12 — Ticket #9 (Supabase reference schema): the Builder shipped a broader column set on
     `teams`/`players`/`gameweeks`/`fixtures` than the DoD's stated minimum — form, ownership%,
     per-90 counting stats, ICT components, team strength ratings, and fixture-difficulty
     ratings — so ticket #11's ingest job doesn't need a follow-up migration for data it will
     obviously need. Still footballer/fixture reference data, within the ticket's own scope.
#13 — Ticket #9: added `updated_at timestamptz default now()` to all four reference tables, to
     support the "last successful sync" display the product brief (§6a) calls for later.
#14 — Ticket #9: added two indexes beyond the three the ticket named by example
     (`idx_fixtures_team_h`, `idx_fixtures_team_a`), since fixture-difficulty-by-team is an
     obvious, immediate query pattern for the projection model.
#15 — Ticket #9: added nullable FK constraints (`players.team_id`, `fixtures.team_h/team_a`,
     `fixtures.event_id`) to catch ingest bugs early; left nullable because blank-gameweek/TBC
     fixtures genuinely have no value yet. Wrapped the whole migration in `BEGIN`/`COMMIT` so a
     partial failure rolls back instead of leaving some tables created and others not.
#16 — Ticket #9, QA revision round 1: the migration originally failed against a vanilla
     PostgreSQL database (`role "anon" does not exist`, exit 3) because `anon` is a role
     Supabase's hosted Postgres provisions automatically but a plain install doesn't have.
     Fixed with a guarded `IF NOT EXISTS (...) THEN CREATE ROLE anon NOLOGIN` block — a no-op
     on real Supabase (role already present) that adds no grants beyond the original policies.
     Re-verified idempotent and exit-0 on both first and second apply against a fresh database.
```
