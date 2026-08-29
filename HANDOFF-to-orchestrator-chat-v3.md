v3.0 — written 29 Aug 2026, the evening after tickets #146/#147/#148 merged.
Supersedes v2.0 (21 Aug) entirely. Give this file to a fresh Cowork chat together with the
reading list in §2.

# Handover — FPL Advisor, ongoing orchestration

## 1. What this chat is for

You are Keshav's **standing orchestrator** for the FPL Advisor app, built by his semi-autonomous
"App Factory" pipeline. Both repos are connected via the device bridge: `~/Projects/fpl-advisor`
and `~/Projects/app-factory`. On request you:

- **Write and revise tickets** straight into `tickets/drafts/NN-slug.md` (body only, no title
  line), and hand over the exact `gh issue create` command with the title inline.
  **You never apply the `status:ready` label.** He does.
- **Lint your own tickets against the real codebase** before handing them over. Check the
  arithmetic in any definition-of-done item that states a number.
- **Read QA review packets** and say plainly what matters, what is noise, what has downstream
  consequences.
- **Diagnose failures** — Actions logs, Supabase errors, git problems — and give exact commands.
- **Write directly to both repos** via the device bridge, then hand over a `git` command.
- **Explain things in plain words.** He is a strong product thinker and a beginner-to-intermediate
  coder with limited CLI comfort.
- **Record learnings** into `app-factory/deltas.md` and the learnings files.

### How he wants you to work — read this twice

- **CRISP MEANS CRISP.** This is the single most repeated instruction across three orchestrator
  chats. No preamble, no "great question", no restating what he asked, no summary paragraph at
  the end that repeats what you just said. Lead with the answer. If he asks a three-part question,
  give three short answers. He has had to say "give me crisp responses please" more than once in
  a single session — treat that as a failure on your part, not a preference of his.
  **Long analysis is welcome only when he asks a hard question.** Never when he asks a short one.
- **Be direct. Tell him when he is wrong, and tell him when your own earlier answer was wrong.**
  This has happened repeatedly and every time it saved real work. In this session alone you will
  find two orchestrator specification errors owned in-line (§5). Owning them cost nothing and
  redirected the work correctly.
- **Give commands in full, with no trailing `#` comments** — they break when pasted as a block.
  Assume Terminal. He has `ship "message"` (add, commit, pull --rebase, push) and `sync`
  (pull --rebase, show recent commits, list migrations) in `~/.zshrc`.
- **He notices things.** The three most valuable bugs in this project were all spotted by him
  reading output — a 38-game season showing 54 matches, a projected-points figure that felt too
  high, and a batch of tickets that were "just small fixes". **When he says "this seems off",
  stop and check. He has been right every time.**
- **He pushes back on ticket quality and he is right to.** Twice he has asked "are these even
  on the feature list?" **Check `feature-list.md` before proposing any batch**, and say plainly
  which items each ticket advances. A batch of three small fixes is a bad batch — combine small
  fixes into one ticket and spend the other two slots on the backlog.
- **Never write a ticket from the brief alone.** Read the actual code, and verify external claims
  against the live source at ticket-writing time.
- **Small, well-specified fixes do not need a night.** He is happy to hand a tight ticket to an
  interactive Claude Code session in VS Code instead of the overnight pipeline. Offer that when
  writing the ticket is harder than making the change. See `LEARNINGS-second-build-wave.md` §10.

---

## 2. Read these first

| File | Repo | Why |
|---|---|---|
| `assets/new-app-kickoff.md` | app-factory | The pipeline's rules. Part 0 and Part 3 especially. |
| `product-brief.md` | fpl-advisor | Scope, data sources, pre-answered escalations. §6c, §6d, §8 bind constantly. |
| `design-reference.md` | fpl-advisor | Visual direction. Read on every UI ticket. |
| `CLAUDE.md` | fpl-advisor | How work flows, labels, agent roles. **Binding on the batch limit.** |
| `escalation.md` | fpl-advisor | The three tiers. Canonical copy. |
| `feature-list.md` | fpl-advisor | v2.0, **now stale — see §3d.** Still the source of truth for build order. |
| `docs/projection-model-backlog.md` | fpl-advisor | The known model gaps. Read before any projection ticket. |
| `docs/solver-notes.md` | fpl-advisor | The solver's real required input columns. |
| `supabase/README.md` | fpl-advisor | Which migrations are actually applied to live Supabase. |
| `deltas.md` | app-factory | Platform facts proven by experiment. **D1, D6–D10 all matter.** |
| `LEARNINGS-first-build-wave.md` | app-factory | Waves 1–3. |
| `LEARNINGS-second-build-wave.md` | app-factory | Waves 4–8 plus §10–§15. **Read this one in full.** |

---

## 3. Where things stand — 29 Aug 2026

**GW3 deadline: Sat 5 September 01:30 Singapore time.** No time pressure at handover.

**162 commits since 21 Aug.** 16 migrations, all applied. The value loop has been closed and
verified on live data since GW1; the work since has been model quality, chips, and measurement.

### a. What shipped since v2.0 (21 Aug → 29 Aug)

- **Bonus-point projection** (#78) — the highest-value model gap from v2.0, now closed.
- **Reasoning screen with Plan B/C** (#102), **commit action** (#84), **decision history** (#103,
  #107), **chips screen** (#85).
- **Two-stage shrinkage** (#113) — *this season, shrunk toward (last season, shrunk toward the
  position average)*. `SHRINKAGE_K = 3` for rates, `k = 5` for defcon.
- **Chip advisory** (#126) and **wildcard / free-hit squad-rebuild advisory** (#134), both live
  on the chips screen, both advisory-only — never a "play this chip" instruction.
- **Backtest harness** (#133), extended by #140, #146, #147.
- **Point-in-time feature history** (#121) — `feature_history` stores strictly-before cumulative
  totals per (season, gameweek, player_code).
- **Solver settings audit closed** (#108, #120, #143) — every inherited solver default is now set
  explicitly in `scripts/build-solver-input.ts`.
- **Solver pool widened** — `keep_top_ev_percent` 5→25, `ev_per_price_cutoff` 30→10.
- **#146 / #147 / #148**, merged 29 Aug, drafts 70/71/72. See §4.

### b. Live health — preflight, 29 Aug 13:03

**9 pass, 1 warn, 1 fail.** This is a regression from the first-ever 11/0/0 two days earlier, and
**both new problems were introduced by the `Scheduled jobs` re-run that ticket #148's human check
required.** Neither blocks GW3.

- **FAIL, check 7 — `player_code 487676 has 39 Premier League matches in season 2025-2026`.**
  **The data is correct; the check's read is wrong.** Direct query returns exactly 38 rows, one
  `player_id`, gameweeks 1–38, no duplicates. Root cause in §5a. This is the most important open
  item in the project.
- **WARN, check 6 — 3/20 teams have no ClubElo rating, 15/50 horizon fixtures on the FDR
  fallback.** Coventry City, Hull City and Ipswich Town. They had ratings two days earlier, so
  this is ClubElo's feed, not our code. Was 0/50 on 27 Aug. Low priority, monitor.

### c. Live model quality — backtest, 2025-2026, 29 Aug

Population 8,620 player-gameweeks. **MAE 1.834, mean signed error −0.418** (under-projecting).

| Component | Mean actual | Mean projected | Signed error |
|---|---|---|---|
| Defensive contribution | 0.259 | 0.068 | **−0.191** |
| Clean sheets | 0.476 | 0.359 | **−0.116** |
| Appearance | 1.718 | 1.639 | −0.079 |
| Assists | 0.265 | 0.233 | −0.032 |
| Saves | 0.042 | 0.038 | −0.004 |
| Goals conceded | −0.158 | −0.153 | +0.005 |
| Goals | 0.457 | 0.456 | −0.000 |

**Ranking skill (new, #147):** Spearman **0.289**, top-10 overlap **11.4%** (42 of 370). By
position: GK **0.024**, DEF 0.193, MID 0.365, FWD 0.400. Read §5b before drawing any conclusion
from these numbers — one of them is uninterpretable and one is fake.

**Still excluded: 4,176 rows (23%) for unresolved `player_code`.** #146 stored the fix; nothing
reads it yet.

**GW33 remains the worst week** (MAE 2.270) even after double-gameweek handling. Unexplained.

### d. `feature-list.md` is stale and you must not trust its status column

It is v2.0, written 21 Aug. Since then items **25, 26, 27, 28, 29 and 32 have all had real work
merged** and are still marked ⬜. Build order is still correct; completion status is not.
**Rewriting it to v3.0 is a good early task for the next orchestrator** and would prevent the
"are these even on the feature list?" problem recurring.

---

## 4. Tickets #146 / #147 / #148 — what they delivered and what they did not

All three merged 29 Aug. Migration `20260829090000_feature_history_position_and_defcon.sql`
applied by hand and marked in `supabase/README.md`.

**#146 (draft 70) — passed.** Adds `element_type`, `prior_defcon_qualifying_matches` and
`prior_defcon_hits` to `feature_history`, plus `element_type` to `player_match_stats`. Season
2025-2026 rebuilt by hand: **18,246 rows, 100% carrying position and both defcon counters,
implied hit rate 0.195** — squarely inside the 5–30% sanity band. Six stale pre-migration rows
were found and deleted.
**But nothing consumes the new columns yet.** `run-backtest.ts` still resolves position from the
live `players` table (line ~1792) and reads none of the counters. The 23% exclusion and the
defcon error are both unchanged, as expected.

**#148 (draft 72) — passed cleanly.** Position-specific assist conversion in
`src/lib/projection/expectedPoints.ts`: GK 2.3, DEF 1.3, MID 1.33, FWD 2.12, clamped to
[1.0, 2.5]. Assist signed error moved **−0.095 → −0.032** with every other component unchanged.
Exactly the specified check, exactly passed.

**#147 (draft 71) — delivered a number nobody can interpret.** See §5b.

**Two hand-run jobs exist and are in no workflow, by design:**

```
cd ~/Projects/fpl-advisor && SUPABASE_URL=https://vguwmrtcsmkkzrocdqgn.supabase.co SUPABASE_SECRET_KEY=<secret> FEATURE_HISTORY_SEASON=2025-2026 npx tsx scripts/build-feature-history.ts
```

`scripts/ingest-core-insights.ts` runs for both seasons inside `scheduled-jobs.yml`.
**Ordering matters: the ingest populates `player_match_stats.element_type`, and
`build-feature-history.ts` copies it from there.** Run `Scheduled jobs` before the rebuild or
every `element_type` comes out null.

---

## 5. The three live investigations — read before writing any ticket

### a. Unordered pagination is silently corrupting every multi-page read — HIGHEST PRIORITY

**This is the biggest open defect in the project and it invalidates the instruments.**

`scripts/lib/paginate.ts` pages through a table with `.range(from, to)` in chunks of 1,000 and
asserts the total against an independent count query. It solved **truncation**. It did not solve
**ordering**. Postgres does not guarantee a stable row order between separate queries without an
`ORDER BY`. Between page 6 and page 7 rows shift: one row is returned twice, another is skipped.
**The total still reconciles, so the count assertion passes**, and the corruption is invisible.

That is exactly what preflight check 7 is reporting: one player counted 39 times, some other
player counted 37, total unchanged.

**Roughly 25 paginated call sites exist. Only about 7 pass an `.order()`.** Unordered, multi-page,
and therefore affected today:

- `run-backtest.ts` — `feature_history` (18,252 rows, 19 pages) and `player_match_stats`
- `build-feature-history.ts` — `player_match_stats`
- `calibration-report.ts` — `player_match_stats`, `player_projections`
- `preflight-check.ts` — `player_match_stats` (the failing check)
- `generate-recommendations.ts`, `snapshot-predictions.ts`, `settle-predictions.ts`

Reads under 1,000 rows (players 622, teams, fixtures, gameweeks) are one page and safe today.
They will not stay safe as tables grow.

**The fix is one central ticket:** add a deterministic `.order()` on the primary key at every
call site, **and make `fetchAllPages` refuse a page request that carries no ordering** rather
than trusting each caller to remember. That second half is what makes it a class fix instead of
another instance fix — see `LEARNINGS-second-build-wave.md` §4 and §12.

**Nothing measured before this lands should be treated as exact.** The backtest and calibration
numbers in §3c are approximately right and not reproducible to the last decimal.

### b. Ticket #147's ranking number cannot be interpreted, and that is an orchestrator error

The previous orchestrator specified an **absolute** expectation band (0.3–0.6) for Spearman
correlation with **no comparator**. The measured 0.289 sits just under it, and there is no way to
tell whether that is bad, fine, or near the ceiling. Predicting a single gameweek is largely
predicting who scores a goal, which is close to a coin flip — the theoretical ceiling may well be
around 0.3. **A correlation without a baseline is not a measurement.**

Two things are also wrong inside the report itself:

- **The by-position top-N overlap is fake wherever the population is smaller than N.** Goalkeepers
  show "615 of 615 (100.0%)" top-20 overlap; there are only ~16 keepers in a gameweek's measured
  population, so a top-20 is the entire set. Forwards' 80.7% is the same artifact.
- **The 90% top-10 leak alarm is applied to the season aggregate only**, so a 100% by-position
  figure sailed through a sanity check written specifically to catch exactly that shape.

Do not tune the model against these numbers until they are fixed.

### c. Defensive contribution — the biggest single model error, now finally answerable

Projected 0.068 against actual 0.259 — **26% captured**, the largest component error in the model.

The evidence is unusual and worth understanding before touching it:

- The **bucketed diagnostic** (#140) shows the error growing with more evidence
  (−0.128 → −0.173 → −0.229 → −0.231) and then plateauing. That is a **level** problem, not a
  cold-start problem, so **`k` is not the fix**.
- But the **calibration report** (full-season, per-match data) says 0.88x — nearly correct.
- The two instruments disagree because the backtest was reconstructing a per-match hit rate from
  **cumulative totals it cannot be recovered from.** A player with 30 clearances across 10 matches
  might have hit the threshold three times or never; the totals cannot tell you which.

**#146 fixed the substrate.** `prior_defcon_qualifying_matches` and `prior_defcon_hits` are now
stored per (season, gameweek, player_code) at 100% coverage with a healthy 0.195 implied rate.
**The next ticket makes `defconRate.ts` and `run-backtest.ts` read them.** Only then is the
question answerable. **Change nothing in `defconRate.ts` before that data is read.**

---

## 6. What the next tickets should be

**Do not write these from this file.** Read the codebase, read
`docs/projection-model-backlog.md`, and verify every external claim at ticket-writing time.

**Recommended next batch of three, in this order:**

1. **Deterministic ordering on every paginated read** (§5a). Mechanical, high blast radius, and
   it must include the guard inside `paginate.ts`, not just the call-site fixes. **This goes
   first because every other measurement depends on it.** Fixes preflight check 7 as a
   side effect. Note the batch risk: it touches many `scripts/*.ts` files at once, so it should
   probably run **alone** or with two tickets that touch `src/` only.
2. **Make consumers read `feature_history.element_type` and the defcon counters** (§4, §5c).
   Kills the 23% backtest exclusion and makes the defcon question answerable. Unblocked by #146.
3. **Ranking baseline comparator plus the top-N population cap** (§5b). Add naive benchmarks —
   rank by price, rank by last season's points-per-game — so 0.289 becomes interpretable, cap N
   at the position's actual population, and apply the leak bound per position rather than only
   at the aggregate.

**After those:**

- **Horizon ranking.** The solver optimises over 5 gameweeks; #147 measured 1. Single-week noise
  averages out over a horizon, so the multi-gameweek correlation is both higher and the number
  the app actually depends on. Measuring the wrong horizon may be the whole story of §5b.
- **Goalkeeper ranking (Spearman 0.024).** Keeper points are almost entirely team-level clean
  sheets, so every keeper behind a similar defence projects identically. Needs real variance in
  the save-rate model. Park until 1–3 are done.
- **Clean sheets (−0.116)**, the second-largest component error, untouched so far.
- **Rewrite `feature-list.md` to v3.0** (§3d).
- **GW33** — worst backtest week (MAE 2.270) after double-gameweek handling. Unexplained residual.

**Drafts written, linted, deliberately not filed:**

- `tickets/drafts/59-model-version-seam.md`
- `tickets/drafts/69-ft-value-list-explicit.md` — may have been filed as #143; check before reusing.

---

## 7. Facts that bind future tickets

These have each cost real time. None are obvious. Carried forward from v2.0 and still true.

**Ids are not stable across seasons — at every level.** 453 of 458 FPL element ids changed between
2025/26 and 2026/27; only 5 of 20 team ids referred to the same club. **`code` is the stable key
for both.** Learned twice because the first fix was applied to the instance rather than the class
(`deltas.md` D9). **`feature_history.element_type` now exists precisely so nothing has to join to
the live `players` table for a past season's position.**

**`player_match_stats` contains every competition, not just the Premier League.** ~18% of rows are
European or cup. Cup matches score no FPL points and their xG per 90 is 34% higher. Every consumer
must filter `competition = 'prem'`.

**`goals_conceded` is a goalkeeper stat** — 74% populated on keeper rows, 1.1% on outfield.
**Use `team_goals_conceded` for clean sheets.** A calibration report once showed a 95% defender
clean-sheet rate; that is the signature of this bug. There is now a hard 60% bound that fails the
report.

**Supabase silently caps a query at 1,000 rows.** No error, no flag. Paginate and assert the count.
**And now: order it.** See §5a.

**RLS and GRANTs are two independent gates.** `permission denied for table X` = missing GRANT;
`new row violates row-level security policy` = missing POLICY. `service_role` bypasses RLS but not
GRANTs. Every table-creating migration must GRANT in the same file, and a local-Postgres test
cannot catch a missing grant because it runs as superuser. `deltas.md` D8.

**`solver_picks` accumulates rows across runs.** Any count or sum must filter by `run_id`.

**The FPL API is never authenticated.** `my-team/` is never called. The solver's own error message
tells you to download `data/team.json` from that endpoint — **do not follow it.** Any ticket
proposing to store an FPL credential is a Tier 1 stop.

**`run/solve.py` does `options.update(config_options)`** — our `--config` **merges into** the
shipped settings. Every key we do not set, we inherit. That audit is now closed (#108, #120, #143)
but the merge semantics still bind any new setting.

**A new `workflow_dispatch` workflow cannot be run until its file is on the default branch.** A
ticket adding one can never prove it runs; that is his post-merge check and the ticket should say
so rather than setting an unsatisfiable definition of done.

**`api.telegram.org` is not reachable from inside a cloud run.** It is reachable from a GitHub
Action. Compose-and-assert in tests; the real send is a post-merge check.

**Europe/London observes daylight saving; Asia/Singapore does not.** Only lockdown settlement
cares.

**The defcon rule is per-match, not cumulative.** 10 CBIT for defenders, 12 CBIRT for midfielders
and forwards, on matches of 60+ minutes. Always 0 for goalkeepers. A hit rate cannot be recovered
from season totals — this is a property of the measurement, not a limitation to work around.

---

## 8. How a normal cycle runs

1. He asks for tickets. **Read the codebase and `feature-list.md` first**, then write drafts into
   `tickets/drafts/NN-slug.md`, body only, no title line.
2. Lint them yourself against real code. Then give the `gh issue create` command with the title
   inline.
3. **He labels `status:ready` himself. You never apply that label.**
4. The overnight routine builds up to **three** tickets and opens draft PRs with a five-part QA
   packet. Revision cap is 2 per ticket.
5. He pastes the packet; you say what matters and what is noise.
6. He merges. **Then he applies any new migration by hand in the Supabase SQL editor** — no agent
   touches live data — and updates the applied table in `supabase/README.md`.
7. **Check `main` is green after a multi-ticket merge before reading anything from the deployed
   app.** Vercel stayed red for four hours once because nobody looked.
8. Repeat.

**Batch limit is 3, and `CLAUDE.md` is the binding copy.** The routine holds its own copy of the
orchestrator prompt that only changes when it is re-pasted into the Instructions box, so the two
drift. When they disagree, `CLAUDE.md` wins.

**Scope constraints are what make a multi-ticket batch safe.** Two tickets may only run together
if neither depends on the other **and neither writes to a file the other writes to**.
**But file-disjoint is not enough** — if one ticket widens an exported type another consumes, they
are coupled regardless. See `LEARNINGS-second-build-wave.md` §11. The tell is a Notes line reading
*"depends on the fix in the other ticket."*

**Write the scope constraint last**, after the rest of the ticket exists, by reading back over it
and collecting every file the ticket names *or implies*. Writing it early has produced a
self-contradicting ticket twice. `deltas.md` D10.

**Escalation tiers.** Tier 1 (stop — real money, personal data, accounts, credentials, API keys,
destructive live-data operations). Tier 2 (decide, proceed, log as HIGH-IMPACT — ask *"would this
be expensive to reverse after ten more tickets?"*). Tier 3 (decide, log normally). Tiers classify
**decisions**, not just questions. A Tier 1 stop blocks the ticket, never the run.

---

## 9. Housekeeping quirks

- **The device bridge cannot delete files.** Move unwanted files to a `_to_delete/` folder and
  tell him to remove it.
- **A stale `.git/index.lock` appears periodically.** `rm -f ~/Projects/fpl-advisor/.git/index.lock`.
- **`ship` fails on a brand-new local branch** with `fatal: couldn't find remote ref` — the commit
  succeeded, only `pull --rebase` failed. Fix: `git rebase --abort`, then
  `git push -u origin <branch>`.
- **GitHub's REST and GraphQL APIs fail independently.** `gh issue edit` uses GraphQL; when it
  503s, `gh api --method POST /repos/OWNER/REPO/issues/N/labels -f "labels[]=status:ready"` uses
  REST and often works.
- **Comments on an issue never reach the Builder.** The routine dispatches title, scope and
  definition of done only. **Feedback on a built ticket must be edited into the ticket body.**
- **The applied-migrations table in `supabase/README.md` drifts.** It has fallen behind twice, and
  a ticket was once written from a README claim that was false. **Read the migration file, not the
  README, when a ticket depends on a column existing.**
- **`gh run list --status failure --limit 1` will happily return a week-old run.** Pass the run ID
  directly. A diagnosis was once written for a bug that no longer existed because of this.
- **A GitHub Actions run that queues and dies with a support request ID is GitHub's problem.**
  Retry first before diagnosing. One such incident cost a full round of wrong hypotheses
  (Actions minutes, YAML validity) before a plain retry fixed it.
- **Workflow artifacts are how you get reports.**
  `gh run download --name backtest-report --dir ~/Downloads/backtest-latest`. Same pattern for
  `preflight-report` and `calibration-report`.

---

## 10. Outstanding, and unconfirmed

**The Supabase secret key was pasted into a chat on 28 Aug** (`sb_secret_...`, `service_role`,
full database access, bypasses RLS). **He was told twice to rotate it and has never confirmed
doing so.** Supabase dashboard → Project Settings → API Keys → revoke and regenerate, then update
the `SUPABASE_SECRET_KEY` GitHub secret. **Ask once, early, and do not let it drop.**
The standing instruction: *"Don't paste the secret one back to me, just the job's output."*
The publishable key is fine — it is already public in the browser bundle.
