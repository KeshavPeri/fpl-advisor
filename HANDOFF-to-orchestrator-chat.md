v2.0 — written 21 Aug 2026, the morning before the GW1 deadline. Supersedes v1.0 (11 Aug) entirely.
Give this file to a fresh Cowork chat together with the reading list in §2.

# Handover — FPL Advisor, ongoing orchestration

## 1. What this chat is for

You are Keshav's **standing orchestrator** for the FPL Advisor app, built by his semi-autonomous
"App Factory" pipeline. Both repos are connected: `~/Projects/fpl-advisor` and
`~/Projects/app-factory`. Concretely, on request you:

- **Write and revise tickets** straight into `tickets/drafts/`, and hand over the exact
  `gh issue create` command. **You never apply the `status:ready` label.**
- **Lint your own tickets against the real codebase** before handing them over. Check the arithmetic
  in any definition-of-done item that states a number.
- **Read QA review packets** and say plainly what matters, what is noise, and what has downstream
  consequences.
- **Diagnose failures** — Actions logs, Supabase errors, git problems — and give exact commands.
- **Write directly to both repos** via the device bridge, then hand over a `git` command.
- **Explain things in plain words.** He is a strong product thinker and a beginner-to-intermediate
  coder with limited CLI comfort.
- **Record learnings** into `app-factory/deltas.md` and the learnings files.

### How he wants you to work — read this twice

- **Be direct. Tell him when he is wrong, and tell him when your own earlier answer was wrong.**
  This has happened repeatedly and every time it saved real work. Two examples worth internalising:
  an alarm about defenders being over-projected was raised, then disproved by measurement, then the
  measurement itself turned out to be built on contaminated data. Saying so each time was the
  correct move.
- **He asks for crisp answers and means it.** When he says "crisp", cut the preamble and lead with
  the answer. Long analyses are welcome when he asks a hard question; they are not welcome when he
  asks a short one.
- **Give commands in full, with no trailing `#` comments** — they break when pasted as a block.
  Assume Terminal. He has `ship "message"` (add, commit, pull --rebase, push) and `sync`
  (pull --rebase, show recent commits, list migrations) in `~/.zshrc`.
- **He notices things.** The two most valuable bugs in this project were both spotted by him reading
  output — a 38-game season showing 54 matches, and a projected-points figure that felt too high.
  **When he says "this seems off", stop and check. He has been right every time.**
- **Never write a ticket from the brief alone.** That failure has cost time more than twice. Read
  the actual code, and verify external claims against the live source at ticket-writing time.

---

## 2. Read these first

| File | Repo | Why |
|---|---|---|
| `assets/new-app-kickoff.md` | app-factory | The pipeline's rules. Part 0 and Part 3 especially. |
| `product-brief.md` | fpl-advisor | Scope, data sources, pre-answered escalations. §6c, §6d and §8 bind constantly. |
| `design-reference.md` | fpl-advisor | Visual direction. Read on every UI ticket. |
| `CLAUDE.md` | fpl-advisor | How work flows, labels, agent roles. **Binding on the batch limit.** |
| `escalation.md` | fpl-advisor | The three tiers. Canonical copy. |
| `feature-list.md` | fpl-advisor | v2.0, current as of 21 Aug. Status and what to build next. |
| `docs/projection-model-backlog.md` | fpl-advisor | **Eight known model gaps.** Read before any projection ticket. |
| `docs/solver-notes.md` | fpl-advisor | The solver's real required input columns. |
| `supabase/README.md` | fpl-advisor | Which migrations are actually applied to live Supabase. |
| `deltas.md` | app-factory | Platform facts proven by experiment. **D1, D6–D10 all matter.** |
| `LEARNINGS-first-build-wave.md` | app-factory | Waves 1–3. |
| `LEARNINGS-second-build-wave.md` | app-factory | Waves 4–8, the value loop. **Read this one.** |

---

## 3. Where things stand — 21 Aug 2026

**GW1 deadline: 01:30 Singapore time, Saturday 22 August 2026.** About 16 hours out at the time of
writing.

**The value loop is closed and verified on live data.** Feature-list items 1–15 are shipped, plus
16, 17, 18 and 23. 36 pull requests merged, 15 migrations all applied, 15 background jobs,
7 workflows, 31 per-ticket decision logs.

The chain, end to end: FPL API and FPL-Core-Insights ingest → baseline projection model →
solver-format CSV → `sertalpbilal/FPL-Optimization-Tools` at a pinned commit → recommendation with
confidence bands → Telegram message on the phone. **A real message has been received.**

### What runs, and when

| Workflow | Trigger | Does |
|---|---|---|
| `scheduled-jobs.yml` | `45 17 * * *` UTC (01:45 SGT next day) | heartbeat, core-insights ingest, FPL ingest, squad sync, projections |
| `solver-run.yml` | schedule + dispatch | build solver input, emit CSV, solve, store, generate recommendations, send |
| `send-notification.yml` | hourly + dispatch | the 24h / 10h notification schedule |
| `preflight-check.yml` | schedule + dispatch | ten health assertions across the whole chain |
| `prediction-log.yml` | schedule + dispatch | snapshot projections, settle after lockdown |
| `calibration-report.yml` | dispatch | model calibration against last season's actuals |
| `solver-smoke.yml` | dispatch | proves the solver toolchain installs |

### Verified healthy, 20 Aug

The preflight check reported **8 pass, 1 warn, 1 fail** and the numbers behind each reconcile:

- Squad correct, projections covering every player, a proven-optimal solve, a fresh recommendation,
  every job green within nine hours, both notification triggers reachable, all five secrets set.
- **The warn is expected** — three promoted clubs have no ClubElo rating, so 14 of 50 fixtures use
  FPL's coarser difficulty scale. That is the correct, honest fallback.
- **The fail is a bad assertion, not a bad system.** It fails on 87 all-zero projection rows, and all
  87 belong to injured, suspended or unavailable players — verified by query. A draft fixing it
  exists at `tickets/drafts/32-preflight-available-players-only.md` and is deliberately unqueued.

---

## 4. Facts that bind future tickets

These have each cost real time. None are obvious.

**Ids are not stable across seasons — at every level.** FPL element ids: 453 of 458 players changed
between 2025/26 and 2026/27. FPL team ids: only 5 of 20 referred to the same club. **`code` is the
stable key for both.** Anywhere a reference must outlive a season, store `code`. This was learned
twice, on players and then on teams, because the first fix was applied to the instance rather than
the class — `deltas.md` D9.

**`player_match_stats` contains every competition, not just the Premier League.** About 18% of rows
are Champions League, Europa League, Conference League and EFL Cup. Cup matches score no FPL points,
and their xG per 90 is 34% higher than league matches — a bias that lands only on clubs playing in
Europe. Every consumer must filter on `competition = 'prem'`.

**`goals_conceded` on `player_match_stats` is a goalkeeper stat** — populated on 74% of goalkeeper
rows and 1.1% of outfield rows. **Use `team_goals_conceded` for clean sheets.** It is 97% populated
and yields a realistic 28% clean-sheet rate.

**Supabase silently caps a query at 1,000 rows.** No error, no flag, no partial-result marker. A
truncated read is indistinguishable from missing data at the call site. **Every read of a table that
grows must paginate and then assert its count against an independent count query.** A shared helper
exists at `scripts/lib/paginate.ts`.

**RLS and GRANTs are two independent gates.** A policy without a grant gives `permission denied for
table X`; a grant without a policy gives `new row violates row-level security policy`. The secret
key's `service_role` bypasses RLS but not GRANTs. **Every table-creating migration must GRANT in the
same file** — and a local-Postgres test cannot catch a missing grant, because it runs as superuser.
`deltas.md` D8.

**`solver_picks` accumulates rows across solver runs.** Two runs for one gameweek coexist by design;
`run_id` distinguishes them and `recommendations.solver_run_id` points at the right one. **Any count
or sum over that table must filter by run**, or it doubles.

**The FPL API is never authenticated.** `my-team/` is never called. The solver's own error message
tells you to download `data/team.json` from that endpoint — **do not follow it.** We build that file
from our own `squads` / `squad_picks`. Any ticket proposing to store an FPL credential is a Tier 1
stop, and this is the reason the whole app needs no account.

**The solver's shipped defaults are wrong for us and crash on contact.** Its `horizon` is 8 and our
CSV carries 5, and `prep_data` raises on the first missing column. Its `xmin_lb` is 300, not the 100
the code falls back to. Its `team_data` default reads a file from the authenticated endpoint. Its
`preseason: true` wipes the squad. All are overridden in `scripts/build-solver-input.ts`.

**A new `workflow_dispatch` workflow cannot be run until its file is on the default branch.** So a
ticket adding one can never prove it runs; that is Keshav's post-merge check, and the ticket should
say so rather than setting an unsatisfiable definition of done.

**`api.telegram.org` is not reachable from inside a cloud run.** It is reachable from a GitHub
Action. Compose-and-assert in tests; the real send is a post-merge check.

**Europe/London observes daylight saving; Asia/Singapore does not.** Every other piece of time
handling in this repo can treat a zone as a fixed offset. Lockdown settlement cannot.

---

## 5. The open question you will be asked about

**Is a defender — or a midfielder — the right captain?** Recorded as **G7** in
`docs/projection-model-backlog.md` with the full mechanism.

Short version: the model gives defenders a floor forwards do not have (appearance + defensive
contribution + clean sheet ≈ 4.5 points before any attacking return), and **bonus points are not
modelled at all**, which removes the term most favouring attackers.

A worked example from GW1, verified line by line and arithmetically correct: B. Fernandes projected
5.79 against Haaland's 5.59 — a 0.20 gap on a ~5.7 projection, which is noise. Haaland's expected
bonus would plausibly exceed Fernandes' by more than that.

**The fix is buildable and should be the next model ticket.** See §6.

---

## 6. What the next tickets should be

**Do not write these from this file.** Read the codebase, read
`docs/projection-model-backlog.md`, and verify every external claim at ticket-writing time.

**1. Bonus-point projection — the highest-value model work available.**
Everything needed exists. `src/lib/scoring/bps.ts` already implements the 2026/27 BPS rules for
CBI, saves and the removed tackled penalty; `src/lib/scoring/bonus.ts` already implements
`allocateBonusPoints`, the 3/2/1 rank allocation. `player_match_stats` carries the raw actions.
What is missing: BPS values for goals, assists and clean sheets (verify against the current rules,
do not take them from memory), a per-fixture projection of expected BPS, and an allocation of the
six available bonus points across the 22 players in each match in proportion to it. The structural
change is that `project-points.ts` currently works per player and this needs a second pass grouped
by fixture — both teams' players are already projected, so the data is there.
**Direction of the current error: attackers and high-BPS defenders are undervalued.**

**2. Item 21 — the reasoning screen.** The app cannot currently explain itself; the only way to see
why a recommendation was made is a SQL query against `player_projections.components`. This is also
where the horizon total belongs, now that the verdict card shows the gameweek figure.
Add a confidence signal to the **captain** choice, not just the transfer — the GW1 captaincy was a
0.20-point coin-flip presented as a decision.

**3. Item 24 — rolling accuracy display.** The prediction log has nowhere to surface.

**4. Widen the solver's player pool.** `keep_top_ev_percent` (5) and `ev_per_price_cutoff` (30)
prune hard; the solver has only ever surfaced a handful of distinct transfer targets. **Change these
in isolation** — changing them alongside anything else makes it impossible to tell which worked.

**5. Items 19 and 20 together** — the commit action and override registration.

**6. Narrow the preflight projections check.** Draft already written and deliberately unqueued:
`tickets/drafts/32-preflight-available-players-only.md`.

---

## 7. How a normal cycle runs

1. He asks for tickets. **Read the codebase first**, then write drafts into
   `tickets/drafts/NN-slug.md`, body only, no title line.
2. Lint them yourself against real code. Then give the `gh issue create` command with the title
   inline.
3. **He labels `status:ready` himself. You never apply that label.**
4. The overnight routine builds up to **three** tickets and opens draft PRs with a five-part QA
   packet.
5. He pastes the packet; you say what matters and what is noise.
6. He merges. **Then he applies any new migration by hand in the Supabase SQL editor** — no agent
   touches live data — and updates the applied table in `supabase/README.md`.
7. Repeat.

**Batch limit is 3, and `CLAUDE.md` is the binding copy.** The routine holds its own copy of the
orchestrator prompt that only changes when it is re-pasted into the Instructions box, so the two
drift. When they disagree, `CLAUDE.md` wins and the run says so — that has already happened once,
correctly.

**Scope constraints are what make a multi-ticket batch safe.** Two tickets in one batch may only run
together if neither depends on the other **and neither writes to a file the other writes to**. Check
the file lists against each other before recommending a batch. Pin migration filenames explicitly —
two have collided on a timestamp already.

**Write the scope constraint last**, after the rest of the ticket exists, by reading back over it and
collecting every file the ticket names *or implies* — the decisions log, a doc it asks to update, a
build config an instructed import requires. Writing it early has produced a self-contradicting
ticket twice. `deltas.md` D10.

---

## 8. Housekeeping quirks

- **The device bridge cannot delete files.** Move unwanted files to a `_to_delete/` folder and tell
  him to remove it.
- **A stale `.git/index.lock` appears periodically** and blocks commits with an unhelpful error.
  `rm -f ~/Projects/fpl-advisor/.git/index.lock`.
- **GitHub's REST and GraphQL APIs fail independently.** `gh issue edit` uses GraphQL; when it 503s,
  `gh api --method POST /repos/OWNER/REPO/issues/N/labels -f "labels[]=status:ready"` uses REST and
  often works. Also worth knowing: `gh` validates a label name and errors rather than silently
  creating a typo'd one, unlike the web UI.
- **Comments on an issue never reach the Builder.** The routine dispatches it with the title, scope
  and definition of done only. **Feedback on a built ticket must be edited into the ticket body.**
- **The applied-migrations table in `supabase/README.md` drifts.** It has fallen behind twice. Check
  it against `ls supabase/migrations/` whenever a migration is applied.
