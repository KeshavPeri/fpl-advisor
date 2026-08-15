v1.0 — written 11 Aug 2026, at the close of the Part 2 spec-and-filing session. Give this file to
a fresh Cowork chat along with `new-app-kickoff.md` and the four Phase 1 documents.

# Handover — FPL Advisor, build waves 1–3 → ongoing orchestration

## What this chat is for

The previous session started as **Part 2** of the kickoff pack (write tickets, file issues) and
became something broader: a standing orchestrator that Keshav works with between overnight runs.
That is the role to continue. Concretely, it does all of the following, on request:

- **Writes and revises tickets**, straight into `tickets/drafts/`, and gives him the `gh issue
  create` / `gh issue edit` command to file them.
- **Lints tickets itself** — reading the real codebase and checking every factual claim — rather
  than always deferring to the Analyst subagent. The Analyst is still worth running on large or
  unfamiliar tickets; this chat has caught things it missed, and vice versa.
- **Reads QA review packets** after each run and says plainly what matters, what is noise, and what
  has downstream consequences.
- **Diagnoses failures** — GitHub Actions logs, Supabase errors, git problems — and gives exact
  commands.
- **Writes directly to both repos** via the device bridge, then hands over a `git`/`gh` command.
- **Explains, in plain words, what just happened**, when asked. Keshav is a capable product thinker
  and a beginner-to-intermediate coder with limited CLI comfort. Spell commands out in full. Say
  what success looks like.
- **Records pipeline-level learnings** into `app-factory/deltas.md`.

He values directness. When he is wrong, say so. When a previous answer of yours was wrong, say that
too — that happened repeatedly in the last session and it saved real time.

---

## Read these first

| File | Repo | Why |
|---|---|---|
| `new-app-kickoff.md` | app-factory `assets/` | The pipeline's own rules. Part 0 and Part 3 especially. |
| `product-brief.md` | fpl-advisor root | Scope, data sources, escalation pre-answers. Check it before reasoning about anything. |
| `design-reference.md` | fpl-advisor root | Visual direction. Read on every UI ticket. |
| `feature-list.md` | fpl-advisor root | 33 items in build order. **Now partly stale — see "Where the plan diverged".** |
| `escalation.md` | fpl-advisor root | The three tiers. Canonical copy. |
| `CLAUDE.md` | fpl-advisor root | How work flows, labels, agent roles. |
| `deltas.md` | app-factory root | Platform facts proven by experiment. **D1, D6, D7, D8 all matter.** |
| `LEARNINGS-first-build-wave.md` | app-factory root | Everything learned in waves 1–3, written for the docs rewrite. |
| `supabase/README.md` | fpl-advisor | Which migrations have actually been applied to the live database. |
| `docs/solver-notes.md` | fpl-advisor | The solver's required input columns. The next ticket builds on this. |

---

## Where things stand — 11 Aug 2026

**Deadline:** GW1 is **01:30 Singapore time, Saturday 22 August 2026**. Ten days out.

### Shipped and merged

| Issue | What | Feature-list item |
|---|---|---|
| #8 | App shell, dark design tokens, Geist self-hosted | 1 |
| #9 | Supabase reference schema — `teams`, `players`, `fixtures`, `gameweeks` | 2 |
| #10 | Scheduled GitHub Action + heartbeat + `job_runs` + `tsx` | 3 |
| #11 | FPL API ingest job | 4 |
| #12 | FPL-Core-Insights ingest job + `player_match_stats` | 5 |
| #13 | Squad state schema, react-router, manual squad entry at `/squad` | 6 |
| #14 | Squad sync from the public FPL API | 7 |
| #15 | 2026/27 scoring rules module + Vitest | 8 |
| #22 | `player_code` stable join key on `player_match_stats` | — (follow-up) |
| #26 | Fixed backdrop behind scrolling content | — (UI fix) |
| #28 | Defensive-contribution hit-rate estimator | 9 |
| #29 | Solver GitHub Action smoke test | part of 12 |

**Feature-list items 1–9 are done.** The value loop closes at item 15.

### Live state you can rely on

- Supabase has data: ~570 players, 20 teams, 38 gameweeks, fixtures, and 2025/26 per-match stats.
- The scheduled workflow runs daily at `45 17 * * *` UTC (01:45 SGT next day) and writes `job_runs`.
- `solver-smoke.yml` is manual-dispatch only and **has run green on real GitHub infrastructure** —
  the solver toolchain installs. Confirmed 11 Aug.
- Keshav's FPL entry exists; `FPL_ENTRY_ID` and `VITE_FPL_ENTRY_ID` may or may not be set — check.
- Secrets in GitHub Actions: `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, and possibly `FPL_ENTRY_ID`.

### ⚠️ Open items to resolve early

1. **`20260811190000_squad_api_sync_fields.sql` may not be applied to live Supabase.** It is #14's
   migration and nobody was ever told to run it. Have him check the Supabase Table Editor for those
   columns before trusting any squad-sync run. `supabase/README.md` marks it VERIFY.
2. **Two migrations share the timestamp `20260811180000`.** Harmless this time; do not let it happen
   again when two tickets in a batch each add a migration.
3. **#26 (fixed backdrop) — verify it actually worked on the phone.** Last report was that it looked
   unchanged, and it was never confirmed whether that was the wrong preview URL, a cached service
   worker, or a genuine defect. The PWA service worker caches CSS on iOS; test in a private tab.

---

## The single most important downstream fact

**`docs/solver-notes.md` exists and contains the solver's real required input columns**, read
directly from its source code. That file is the input to the next ticket.

But QA on #29 found something that changes the design:

> **The solver's own `prep_data` function calls the live FPL `bootstrap-static` endpoint directly
> when it runs.**

`product-brief.md` §6c rests on the solver reading projections from a CSV and *not caring where they
came from* — that is what makes the projection model replaceable without touching the solver, the
app, the data layer or the notifications. If the solver also fetches FPL itself, that boundary is
less clean than the brief assumes.

**This must be resolved when the projections-CSV adapter ticket (feature item 11) is written.**
Options to weigh at that point: bypass `prep_data` and call the solver's model-building code
directly; pre-populate whatever `prep_data` would fetch; or accept the fetch and give it graceful
failure handling per §6c's stated solver failure modes. Do not let a Builder decide this at 3am —
it is a Tier 2 architectural call about the most important boundary in the system.

---

## Other facts that bind future tickets

**FPL element ids are not stable across seasons.** Verified on real data during #12: of 458 players
matched between the 2025/26 and 2026/27 snapshots, only **5 kept the same id and 453 changed**.
`code` is the stable cross-season identifier. Anywhere a player reference must outlive a season,
store `code`. `players.code` and `player_match_stats.player_code` both exist; `squad_picks` carries
`player_code NOT NULL`.

**RLS and GRANTs are two independent gates.** A policy without a grant yields `permission denied for
table X`; a grant without a policy yields `new row violates row-level security policy`. The secret
key's `service_role` bypasses RLS but **not** GRANTs. **Every ticket that creates a table must GRANT
in the same migration** — and note that a local-Postgres test cannot catch a missing grant, because
it runs as superuser. See `deltas.md` D8.

**The squad tables grant `anon` but the reference tables do not.** `squads` and `squad_picks` allow
`anon` SELECT/INSERT/UPDATE/DELETE because the browser is the only writer and the app has no auth.
Reference tables are read-only to `anon`; their writer is the Action's secret key. Keep that split.

**`src/lib/scoring/` and `src/lib/projection/` are pure — no I/O.** That is deliberate and is what
makes them provable without a database. Protect it.

**The FPL API is never authenticated.** `my-team/` is never called. Any ticket proposing to store an
FPL credential, cookie or session is a Tier 1 stop. This is the reason the whole app needs no
credentials, and it must not be undone.

**FPL-Core-Insights paths:** season root has `players.csv`, `teams.csv`, `playerstats.csv`,
`gameweek_summaries.csv`. Per-match rows are under `data/{season}/By Gameweek/GW{x}/
playermatchstats.csv` — note the space, percent-encode it. Refresh is **07:30 and 17:30 UTC**
(the brief's original 05:00/17:00 was wrong and has been corrected).

---

## Where the plan diverged from `feature-list.md`

`feature-list.md` has not been rewritten and is now partly stale. Reconcile before trusting it.

- **Item 12 was split.** Its infrastructure half — proving the solver installs in an Action — was
  pulled forward and shipped as #29, because it was the largest unproven risk and had no
  dependencies. The remaining half (run the solver on our data, store output) still sits at item 12.
- **Three tickets exist that are not on the list at all:** #22 (`player_code`), #26 (fixed
  backdrop), #29 (solver smoke test).
- **Items 10–15 have no tickets yet.** That is the whole remaining value loop.

---

## Next steps, in order

**Immediate — the value loop, items 10 to 15.** None of these are written.

| Item | What | Notes for whoever writes it |
|---|---|---|
| 10 | Baseline projection model | Five inputs, each explainable in one sentence: minutes probability, xG/xA rates, ClubElo fixture difficulty, clean-sheet probability, defcon hit rate. #28 supplies the last one. This is the first ticket that reads from Supabase *and* uses the pure modules — the mapping layer belongs here, not in `src/lib/projection/`. |
| 11 | **Projections CSV adapter — the seam** | Guard this above everything. Build against `docs/solver-notes.md`. Resolve the `prep_data` question first. |
| 12 | Solver integration | The remaining half. #29 proved install; this runs it on our data and stores output. |
| 13 | Recommendation generation | Plan A/B/C via the solver's `iteration` / `iteration_criteria`. Confidence bands, stored reasoning, explicit hit cost. No decimals in the primary view. |
| 14 | Telegram sender | Needs a bot token + chat ID from BotFather — **Tier 1, owner-only**. Check whether Keshav has done this; it was on the original setup list and may still be outstanding. |
| 15 | Notification schedule | 24h and 10h before each deadline, Singapore time. |

**Sequencing rule that has held all week:** a ticket may only be queued alongside another if neither
depends on the other **and neither depends on the other's merge**. Merging is manual, so two tickets
queued together both build against the `main` that existed when the run started. Items 10–15 are a
strict chain, so expect mostly one-per-night unless a UI ticket is paired in as a night-mate.

**Realistic assessment for 22 August.** Six chained items in ten days, with manual triggering, is
tight but not impossible. If it slips, cut from feature-list item 16 downward — never from the
middle. A working Telegram notification with no app UI still solves the problem; a beautiful pitch
view with no recommendation does not.

---

## How to run a normal cycle

1. Keshav asks for the next tickets. Read the actual codebase first — not the brief — then write
   drafts into `tickets/drafts/NN-slug.md`, body only, no title line.
2. Lint them yourself against real code. Check every factual claim. Then give the `gh issue create`
   command with the title inline.
3. He labels `status:ready` himself. **You never apply that label.**
4. Overnight run produces draft PRs with a five-part QA packet.
5. He pastes the packet; you say what matters and what is noise.
6. He merges. **Then he applies any new migration by hand in the Supabase SQL editor** — no agent
   touches live data — and updates the applied table in `supabase/README.md`.
7. Repeat.

His shell has two helpers, defined in `~/.zshrc`: **`ship "message"`** (add, commit, pull --rebase,
push) and **`sync`** (pull --rebase, show recent commits, list migrations).
