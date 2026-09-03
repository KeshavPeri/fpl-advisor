v4.0 — written 3 September 2026, while a Claude Code fix to the backtest harness is in flight.
Supersedes v3.0 (29 Aug) entirely. Give this file to a fresh Cowork chat together with the
reading list in §2.

# Handover — FPL Advisor, ongoing orchestration

## 1. What this chat is for

You are Keshav's **standing orchestrator** for the FPL Advisor app — a single-user Fantasy Premier
League advisory PWA built by his semi-autonomous "App Factory" pipeline. Both repos are on his
machine via the device bridge: `~/Projects/fpl-advisor` and `~/Projects/app-factory`.

On request you:

- **Write and revise tickets** straight into `tickets/drafts/NN-slug.md` (body only, no title
  line), and hand over the exact `gh issue create` command with the title inline.
  **You never apply the `status:ready` label.** He does.
- **Lint your own tickets against the real codebase** before handing them over. Check the
  arithmetic in any definition-of-done item that states a number.
- **Read QA review packets and reports** and say plainly what matters, what is noise, what has
  downstream consequences.
- **Diagnose failures** — Actions logs, Supabase errors, git problems — and give exact commands.
- **Write directly to both repos** via the device bridge, then hand over a `git` command.
- **Record learnings** into `app-factory/deltas.md` and the learnings files.

### How he wants you to work — read this twice

- **CRISP MEANS CRISP.** The single most repeated instruction across four orchestrator chats. No
  preamble, no "great question", no restating what he asked, no summary paragraph at the end
  repeating what you just said. Lead with the answer. Three-part question, three short answers.
  He has had to say it more than once inside a single session — treat that as your failure, not
  his preference. **Long analysis only when the question is genuinely hard.**
- **He is not a technical person and says so.** *"Anytime you need a query result, give me the
  exact query I need to run. Give me exact commands and queries whenever anything is needed."*
  Never say "check the database" or "run the backtest" — give the literal SQL or the literal
  shell command, ready to paste.
- **Give commands in full, with no trailing `#` comments** — they break when pasted as a block.
  Assume macOS Terminal. He has `ship "message"` (add, commit, pull --rebase, push) and `sync`
  (pull --rebase, show recent commits, list migrations) in `~/.zshrc`.
- **Be direct. Tell him when he is wrong, and tell him when your own earlier answer was wrong.**
  This session alone contains four owned orchestrator errors (§11). Every one redirected the work
  correctly and cost nothing. Hiding one would have cost a night.
- **He notices things.** The most valuable findings in this project were all him reading output
  and saying "this seems off" — a 38-game season showing 54 matches, a projected-points figure
  that felt too high, and (this session) *"I have Haaland and he has Coventry at home, which is
  a blind captain in my opinion"*, which turned out to be a real missing-data defect worth ~1.9
  points on that comparison. **When he says something seems off, stop and check. He has been
  right every time.**
- **He pushes back on ticket quality and he is right to.** Check `feature-list.md` before
  proposing any batch and say which items each ticket advances. A batch of three small fixes is a
  bad batch.
- **Never write a ticket from the brief alone.** Read the actual code, and verify external claims
  against the live source at ticket-writing time.
- **Small, well-specified fixes do not need a night.** He is happy to hand a tight ticket to an
  interactive Claude Code session in VS Code. Offer it when writing the ticket is harder than
  making the change. When you do, **the prompt must end with an instruction to commit, push and
  leave `git status` clean** — he has been burned by stray branches. See §9.
- **When you cannot give him three good tickets** from the backlog plus fixes, say so and propose
  a UI polish run against `docs/my-ui-problems.md` instead. His standing instruction.
- **He sometimes asks for an answer in exactly 3 or 5 sentences.** Honour it literally.

---

## 2. Read these first

| File | Repo | Why |
|---|---|---|
| `assets/new-app-kickoff.md` | app-factory | The pipeline's rules. Part 0 and Part 3 especially. |
| `product-brief.md` | fpl-advisor | Scope, data sources, pre-answered escalations. §6c, §6d, §8 bind constantly. |
| `design-reference.md` | fpl-advisor | Visual direction. Read on every UI ticket. |
| `CLAUDE.md` | fpl-advisor | How work flows, labels, agent roles. **Binding on the batch limit.** |
| `escalation.md` | fpl-advisor | The three tiers. Canonical copy. |
| `feature-list.md` | fpl-advisor | v2.0, status column unreliable. Still the source of truth for build order. |
| `docs/projection-model-backlog.md` | fpl-advisor | The known model gaps, G1–G13. Read before any projection ticket. |
| `docs/model-review-2026-09-02.md` | fpl-advisor | **The deep model review. The most important document in the repo right now.** R1–R6 are the roadmap. |
| `docs/ui-audit-2026-08-31.md` | fpl-advisor | 51 UI findings, F1–F51. |
| `docs/my-ui-problems.md` | fpl-advisor | His own UI brief in his words, P1–P11. |
| `docs/solver-notes.md` | fpl-advisor | The solver's real required input columns. |
| `supabase/README.md` | fpl-advisor | Which migrations are applied. **Drifts — read the migration file, not this.** |
| `deltas.md` | app-factory | Platform facts proven by experiment. D1, D4, D6–D10 all matter. |
| `LEARNINGS-first-build-wave.md` | app-factory | Waves 1–3. §5 (never assert an unverified external format) binds constantly. |
| `LEARNINGS-second-build-wave.md` | app-factory | Waves 4–8 plus §10–§19. **Read in full.** |

---

## 3. Where things stand — 3 September 2026

**GW3 deadline: Sat 5 September 01:30 Singapore time.** Roughly 34 hours at the time of writing.
The recommendation for GW3 exists, is fresh, and is committable.

### a. Live health — preflight report 10, 3 Sep 07:21

**PASS on all 11 checks.** Notably:

- Check 6: `nullEloTeamsCount=0`, `fixturesFallbackCount=0` of 50 horizon fixtures. **Every club
  now has a rating and no fixture falls back to FPL's FDR.** This was 3/20 unrated and 15/50 on
  the fallback the day before — see §6.
- Check 11: `leagueBaselineGoals` flipped from the hardcoded 1.45 placeholder to **"computed"
  at 1.550**, off 20 finished fixtures. G5 is now resolved in practice.
- Check 3: 651 projection rows, 100% coverage, 146 all-zero rows all correctly attributed to
  unavailability (0 "no fixture", 0 "available but zero").

### b. What shipped since v3.0

Six merges: `#184` (damped attacking multiplier), `#185` (store last-five-match minutes in
`feature_history`), `#186` (5-gameweek ranking target with baselines and a quality oracle),
`#190` (docs — close settled backlog questions, add G12/G13), `#191` (minutes model v2),
`#192` (backtest minutes window + oracle rewrite).

**Note the numbering trap.** Draft files `89`, `91`, `92` became GitHub issues `#192`, `#191`,
`#190` — reversed. And the Builder wrote `#187` into the code comments for the oracle work. Draft
number, issue number and the number in the code comment are three different things. **Always cite
the draft filename when talking to him, and grep for the issue number when reading code.**

### c. Live model quality — calibration report 8, 3 Sep 07:23

Position totals (projected/actual): GK 1.04x, DEF 0.95x, MID 0.97x, FWD 0.91x.
Appearance component, which is what ticket 91 was judged on:

| | GK | DEF | MID | FWD |
|---|---|---|---|---|
| report 7 (before #191) | 1.06 | 1.00 | 0.96 | 0.92 |
| report 8 (after #191) | 1.05 | 0.98 | 0.93 | 0.89 |

Forward assists remain 0.72x — **expected and closed**, see G13/§5c.

### d. The backtest is FAILING and that is the top open item

`npx tsx scripts/run-backtest.ts` exits 1 on its own sanity bound:

```
one-gameweek quality oracle (Spearman 0.336) does not sit above the model (0.345)
five-gameweek quality oracle (Spearman 0.506) does not sit above the model (0.728)
```

A hindsight oracle scoring *below* the model is impossible unless the model is seeing something
the oracle cannot. **It is. See §4.**

---

## 4. THE IMMEDIATE TASK — a Claude Code fix is in flight

At handover Keshav has an interactive Claude Code session running against this prompt. **He will
paste its completion message into the new chat. Your first job is to verify the fix, not to
re-diagnose it.**

### The defect

In `scripts/run-backtest.ts`, `classifyFiveGameweekRow` builds a 5-gameweek window starting at
gameweek G and calls `projectAndReconstructWindowGameweek(playerCode, G+i, ...)` for each leg.
Inside that function, **three lookups are keyed on the leg's gameweek `G+i` when they must be keyed
on the window's start gameweek `G`**, because the app plans the whole horizon at G with only
information available then:

1. `featureHistoryByPlayerGameweek.get(windowKey(playerCode, gameweekId))`
2. `computeTeamStrengthAsOf(teamMatchRecords, ..., gameweekId)` — both call sites
3. `positionPriors.get(positionPriorKey(gameweekId, position))`

Two things correctly **keep** the leg gameweek, because a published fixture schedule is legitimately
known at G: the `actualRows` (the target being ranked) and `opponentTeamCodes` / `resolveFixtureTeams`.

So the "5-gameweek projection" was really five separate one-week-ahead projections, each built with
information that only exists after the window has started. The leg at G+4 knew the player's form
through G+3.

### Why every impossible number follows from it

- The oracle reaches 0.506 while the model reaches 0.728, because the model sees inside the window
  and the oracle deliberately does not.
- The model review's independent Python reconstruction — which projected all five legs from G —
  got **0.425**, which is what the honest number should look like.
- Ticket 89 (`#192`) made it *worse* (0.672 → 0.728) precisely because it fed the harness a richer
  minutes signal, and minutes carry ~85% of the model's ranking signal. A better input to a leaking
  construction leaks harder.

### What to check when he pastes the result

- The 5-GW model Spearman should **fall a long way**, plausibly toward 0.425. **That drop is the
  fix working, not a regression.** Say so before he reads it as one.
- The oracle should now sit above the model at both horizons and the job should exit 0.
- `computeOracleFeaturedRate`, `computeOracleAppearanceRate`,
  `computeOracleFiveGameweekEstimate` and `checkOracleCeiling` must be **unchanged**. If Claude
  Code touched the oracle or softened the sanity bound, that is a failed fix — those are the
  guardrails and the bound is what caught this.
- `docs/projection-model-backlog.md` G13 should be rewritten. It currently records the cause as an
  oracle units mis-specification, **which was an orchestrator error** (§11).
- `git status` clean, one commit, pushed, no stray branch.

### If the fix landed clean, the next steps in order

```
cd ~/Projects/fpl-advisor && git pull && npx tsx scripts/run-backtest.ts
```
then dispatch the workflow so the artifact is produced:
```
cd ~/Projects/fpl-advisor && gh workflow run "Backtest" && sleep 20 && gh run list --workflow="Backtest" --limit 1
```

**Only then can ticket 91 be judged.** See §5a.

---

## 5. Open questions — read before writing any ticket

### a. Ticket 91 (minutes model v2) is unresolved and you must not let it drift

`#191` separated P(start) from minutes-given-start in `src/lib/projection/minutes.ts`. The idea is
right: averaging `90, 90, 90, 90, 0` to 72 minutes describes a player nobody is, blending "will he
play" with "how long will he last".

**But it regressed on its own pre-registered criterion.** All four positions' appearance ratios
moved *down* by 0.02–0.03 (§3c). That is a uniform pessimism shift, not the differential
rotation-risk correction the ticket was for. The ticket's own definition of done said *"if any
position moves away from 1.00, revert rather than tune."*

The previous orchestrator recommended **not** reverting yet, and told him explicitly that this
departs from a rule he himself pre-registered. The reason: the backtest is the better instrument
for this question and it is currently broken, so a revert would rest on one weak signal.
**He accepted this. Do not quietly let it stand.** Once the backtest is honest:

- If the 5-GW and 1-GW numbers show `#191` helping ranking, keep it and write a follow-up for the
  uniform level shift.
- If they show it neutral or harmful, **revert it** rather than tuning constants. Say so plainly.

### b. G12 — the defensive multiplier is measured-but-deliberately-undamped

`defensiveMultiplier = 2 × (1 − es)` overshoots the same way the attacking side did before `#184`.
It was left alone on purpose: a neutral-fixture variant collapses **GK Spearman from 0.168 to
−0.017**, and the empirical clean-sheet curve is steeper than Poisson-with-damped-λ, so damping λ
would change the curve's *shape*, not just narrow its ends.

The recorded next step is an **in-harness variant sweep in `scripts/run-backtest.ts`**, judged on
GK and DEF Spearman *and* clean-sheet calibration, not MAE. **This conflicts with any ticket
editing `run-backtest.ts` and must never be batched with one.** That mistake was nearly made this
session — the previous orchestrator called it "file-disjoint" and had to retract.

### c. Closed, do not reopen

- **Forward assists at 0.72x on the calibration report.** Three hypotheses refuted. It is an
  artefact of that report's cross-population design: departed forwards xA/90 0.073 vs retained
  0.055, precisely assist-shaped. The backtest puts the whole assist component at −0.020 points
  per row. Recorded in the backlog.
- **G10 defcon.** Cold start, confirmed by report 7's by-`prior_matches` buckets
  (−0.057 / −0.059 / −0.045 / **+0.006**). **Do not tune `k = 5` or `SHRINKAGE_K`.**
- **G8 fixture sensitivity.** Answered *in reverse* — too wide, not too narrow. Attacking half
  addressed by `#184`.

### d. ClubElo direct ingest — written up but blocked

Ticket 90 was never written because the source could not be verified. **`api.clubelo.com` returned
HTTP 502 from Keshav's own machine on every endpoint** (`/2026-09-02`, `/2026-09-01`, `/Arsenal`)
on 2–3 Sep; `clubelo.com` itself 301s normally and its HTML `/ENG` page serves a **stale snapshot**
(it still lists Burnley and Leeds in the second tier — roughly spring 2025). The host is also on
neither the cloud container's nor the device VM's egress allowlist, and WebFetch is refused by
robots.txt, so **you cannot verify the format from inside a chat either.**

Per `LEARNINGS-first-build-wave.md` §5, do not write an ingest ticket asserting a response format
nobody has seen. Ask him to re-probe:

```
curl -sS -o /dev/null -w "%{http_code}\n" "http://api.clubelo.com/Arsenal"
```

If that returns 200, ask for `curl -sS "http://api.clubelo.com/2026-09-02" | head -3` and the
English clubs, then write the ticket. **The name-matching layer is the real risk in that ticket,
not the fetch.** Also note `api.clubelo.com` would need adding to the App Factory environment's
custom network allowlist (`deltas.md` D4), though the ingest itself would run in GitHub Actions,
which has open network access.

**Do not substitute another provider's ratings.** FootballDatabase and SinceAWin publish club Elo
but each uses its own K-factor, home advantage and initialisation. Mixing scales inside one column
produces fixture difficulties that are silently wrong and look perfectly reasonable.

### e. The captaincy label is miscalibrated — a real UI finding

After the Elo seed, GW3 reads: Bruno Fernandes **7.56** vs Haaland **7.07** — a gap of **0.49**,
down from 2.4 before. The app labels this **"Captain confidence: clear"** while calling the same
plan "Confidence: marginal" one card above. `product-brief.md` §8 says gaps under a point are
routinely marginal. **The confidence thresholds for the captain card are wrong and should go into
the next UI batch.** It matters because that label is what would talk him out of a captain he has
good reason to back.

---

## 6. The manual Elo seed — what was done and how to undo it

On 3 Sep the three promoted clubs (Ipswich, Hull, Coventry) had `teams.elo = null` and had never
had a rating, putting **15 of 50 horizon fixtures on the coarse FPL FDR fallback**, including
fixtures inside the live GW3 recommendation. With ClubElo down (§5d), all three were seeded
manually to **1650**:

```
update public.teams set elo = 1650, updated_at = now() where short_name in ('IPS','HUL','COV');
```

**Reasoning, so a future reader does not mistake these for source data.** The rated floor is
Sunderland at 1736 — promoted one season ago and survived; Leeds, promoted the same year, sits at
1797; Arsenal tops at 2064. A newly promoted club is by construction weaker than the weakest
survivor, so ~85 points below the floor. The stale ClubElo snapshot independently shows Burnley and
Leeds at 1638/1633 at their own promotion, corroborating the 1630–1680 band.

**All three got the same number deliberately.** There is no data for these clubs, and inventing a
30-point gap between Hull and Coventry would be fake precision a future reader mistakes for a
measurement.

`elo_stale_since` was deliberately **left stamped**, so preflight keeps reporting these as stale —
truthful, since they are placeholders. It survives ingest because post-`#84`/`#176` a club whose
CSV elo cell is blank now **keeps** its existing value rather than being nulled.

Rollback: `update public.teams set elo = null, updated_at = now() where short_name in ('IPS','HUL','COV');`

Tier 2 decision, logged.

---

## 7. Facts that bind future tickets

Each of these has cost real time. None are obvious.

**Ids are not stable across seasons.** 453 of 458 element ids and 15 of 20 team ids changed between
2025/26 and 2026/27. **`code` is the stable key.** `deltas.md` D9. `feature_history.element_type`
exists so nothing joins to live `players` for a past season's position.

**`player_match_stats` contains every competition.** ~18% European or cup; cup xG/90 is 34% higher
and scores no FPL points. Every consumer must filter `competition = 'prem'`.

**`goals_conceded` is a goalkeeper stat** — 74% populated on keepers, 1.1% on outfield. **Use
`team_goals_conceded` for clean sheets.** A 95% defender clean-sheet rate is this bug's signature;
there is now a hard 60% bound.

**Supabase silently caps a query at 1,000 rows, and an unordered `.range()` gives *unspecified*
order.** Both must be handled. `scripts/lib/paginate.ts` now inspects the returned PostgREST
builder's `url.searchParams` for a bare `order` key **before awaiting** and fails closed. Note
`url` is `protected` in the shipped `.d.ts`. A count assertion is structurally blind to a
duplicate-plus-drop, so the count passing proves nothing about ordering.

**RLS and GRANTs are two independent gates.** `permission denied for table X` = missing GRANT;
`new row violates row-level security policy` = missing POLICY. `service_role` bypasses RLS but not
GRANTs. A local-Postgres test runs as superuser and cannot catch a missing grant. `deltas.md` D8.

**`solver_picks` accumulates rows across runs.** Any count or sum must filter by `run_id`.

**The FPL API is never authenticated.** `my-team/` is never called. The solver's own error message
tells you to download `data/team.json` from that endpoint — **do not follow it.** Any ticket
proposing to store an FPL credential is a Tier 1 stop.

**`run/solve.py` does `options.update(config_options)`** — our `--config` merges into the shipped
settings, so every key we do not set is inherited silently.

**A new `workflow_dispatch` workflow cannot be run until its file is on the default branch.**
A ticket adding one can never prove it runs; that is his post-merge check.

**`api.telegram.org` is unreachable from a cloud run** but reachable from a GitHub Action.

**No ticket may require a live database read inside the run.** Adopted this session after
ticket `#175` blocked the pipeline on exactly that. If a DoD needs live data, give Keshav the query
and have him paste the result into the routine chat, or defer the check to post-merge.

**The defcon rule is per-match, not cumulative.** 10 CBIT for defenders, 12 CBIRT for midfielders
and forwards, on 60+ minute matches, always 0 for goalkeepers. A hit rate cannot be recovered from
season totals.

**Solver pin:** `sertalpbilal/FPL-Optimization-Tools` at commit
`45131c5a41d7caadb5cb626c012bfa9111dca7a2`. The projections CSV is the replaceable seam — that is
where a learned model would plug in (review R6).

**Design constraints:** dark only, `#0b0f19` base, no green/yellow/purple, Geist + Geist Mono
(never Inter), tabular mono numbers, no emoji as icons, no decimal projected points in the
recommendation UI, pitch layout, honour `prefers-reduced-motion`.

---

## 8. How a normal cycle runs

1. He asks for tickets. **Read the codebase and `feature-list.md` first**, then write drafts into
   `tickets/drafts/NN-slug.md`, body only, no title line.
2. Lint them yourself against real code. Then give the `gh issue create` command with the title
   inline, plus the `ship` command for the drafts.
3. **He labels `status:ready` himself. You never apply that label.**
4. The overnight routine builds up to **three** tickets and opens draft PRs with a five-part QA
   packet. Revision cap is 2 per ticket. Merging is always manual.
5. He pastes the packet; you say what matters and what is noise.
6. He merges, applies any new migration by hand in the Supabase SQL editor, and updates
   `supabase/README.md`.
7. **You then give him the post-merge check sequence.** The standard one:

```
cd ~/Projects/fpl-advisor && gh workflow run "Scheduled jobs" && sleep 20 && gh run list --workflow="Scheduled jobs" --limit 1
```
```
cd ~/Projects/fpl-advisor && gh workflow run "Preflight check" && sleep 20 && gh run list --workflow="Preflight check" --limit 1
```
```
cd ~/Projects/fpl-advisor && gh workflow run "Calibration report" && sleep 20 && gh run list --workflow="Calibration report" --limit 1
```
```
cd ~/Projects/fpl-advisor && gh workflow run "Backtest" && sleep 20 && gh run list --workflow="Backtest" --limit 1
```
```
cd ~/Projects/fpl-advisor && git pull && ls -t docs/reports | head -6
```

   Workflow names are exactly: `Scheduled jobs`, `Preflight check`, `Calibration report`,
   `Backtest`, `Prediction log`, `Solver run`, `Solver chip probe`, `Squad rebuild probe`,
   `Send notification`.
8. **Tell him what you expect each report to show before he reads it**, so he can spot a problem
   without you. He values this.
9. **Check `main` is green after a multi-ticket merge** before reading anything from the deployed
   app. Vercel stayed red for four hours once because nobody looked.

**Batch limit is 3, and `CLAUDE.md` is the binding copy.** The routine holds its own copy of the
orchestrator prompt that only changes when re-pasted into the Instructions box, so the two drift.
When they disagree, `CLAUDE.md` wins.

**Scope constraints make a multi-ticket batch safe.** Two tickets may run together only if neither
depends on the other **and neither writes a file the other writes**. **File-disjoint is not
enough** — a shared exported type couples them (`LEARNINGS-second-build-wave.md` §11).

**Write the scope constraint last**, by reading back over the finished ticket and collecting every
file it names *or implies*. Writing it early has produced a self-contradicting ticket twice.
`deltas.md` D10.

**Escalation tiers.** Tier 1 (stop — real money, personal data, accounts, credentials, API keys,
destructive live-data operations). Tier 2 (decide, proceed, log as HIGH-IMPACT — *"would this be
expensive to reverse after ten more tickets?"*). Tier 3 (decide, log normally). Tiers classify
**decisions**, not just questions. A Tier 1 stop blocks the ticket, never the run.

---

## 9. Housekeeping quirks

- **The device bridge cannot delete files.** Move unwanted files to `_to_delete/` and tell him.
- **A stale `.git/index.lock` appears periodically.** Prefix git commands with
  `rm -f ~/Projects/fpl-advisor/.git/index.lock`.
- **`ship` on a brand-new local branch** fails with `fatal: couldn't find remote ref` — the commit
  succeeded, only `pull --rebase` failed. Fix: `git rebase --abort`, then `git push -u origin <branch>`.
- **`sync` once printed "REBASE STOPPED" with no rebase in progress.** Alias bug. And `ship` once
  committed unrelated ticket drafts onto a feature branch. Recovery that worked:
  `git reset --soft HEAD~1`, `git restore --staged .`, `git push --force origin HEAD`, then move
  the drafts to main. **Any Claude Code prompt you write must end with an explicit
  commit-push-clean-status instruction.**
- **GitHub's REST and GraphQL APIs fail independently.** `gh issue edit` uses GraphQL; when it
  503s, `gh api --method POST /repos/OWNER/REPO/issues/N/labels -f "labels[]=status:ready"` works.
- **Comments on an issue never reach the Builder.** The routine dispatches title, scope and
  definition of done only. Feedback must be **edited into the ticket body**.
- **`supabase/README.md`'s applied-migrations table drifts.** Read the migration file.
- **`gh run list --status failure --limit 1` will return a week-old run.** Pass the run ID.
- **A GitHub Actions run that dies with a support request ID is GitHub's problem.** Retry first.
- **Reports arrive as workflow artifacts.**
  `gh run download --name backtest-report --dir ~/Downloads/backtest-latest`. Same for
  `preflight-report` and `calibration-report`. He usually just attaches them to the chat.

---

## 10. What the next tickets should be

The model review's R-list is the roadmap. Ordered by what is unblocked:

1. **Nothing on the model until the backtest is honest.** Everything downstream is gated on the
   5-GW metric being real. This is R1/R2 in the review's language and is what §4 is fixing.
2. **Judge and resolve `#191`** (§5a). Possibly a revert, possibly a follow-up.
3. **G12 defensive multiplier sweep** (§5b). Blocks on nothing except not colliding with another
   `run-backtest.ts` ticket.
4. **UI polish round two.** He has feedback beyond `docs/my-ui-problems.md` that was never
   captured, plus the captain-confidence miscalibration (§5e). **Ask him to list it.** He has
   already said he wants a full design polish in one ticket, not split across several.
5. **ClubElo ingest** (§5d), when the API returns.
6. **R6 — learned-v1 behind the CSV seam** (feature-list items 30/31). **Do not start before the
   backtest fix and the 5-GW metric have landed and been read.** The plan he agreed: keep the
   hand-built model for GK and DEF where it already beats the baselines, and use a learned model to
   close the gap for MID and FWD. Two-to-three nights.

Backlog items not yet ticketed: feature-list 22 (Tier 1 blocked), 28 (probe dispatched once),
32's remaining half, 33 (mini-league).

Documentation debt still open: `LEARNINGS-second-build-wave.md` needs §17–§19 (see §11 below) —
the previous orchestrator ran out of session before writing them.

---

## 11. Learnings from this session — read before refining the system

Four orchestrator errors and four system findings. The pattern across all of them is the same one
the review named: **the instrument being wrong is the most expensive kind of wrong, and this
project keeps finding it late.**

### Orchestrator errors owned this session

1. **The 5-GW oracle diagnosis was wrong, and the wrong fix shipped.** Ticket 89 asserted the
   oracle was mis-specified in *units* — a rate scored against a totals target. The Builder
   implemented that faithfully and correctly, and the number moved 0.507 → 0.506. **A full night's
   ticket slot bought nothing, because the diagnosis was wrong and nothing in the pipeline could
   catch a wrong diagnosis.** The real defect was three lookahead lookups on the model side.
   Cost: one ticket slot, plus a wrong entry (G13) written into the backlog by ticket 92 in the
   same batch.
2. **A conflicting ticket was proposed as file-disjoint.** The defensive-multiplier measurement was
   offered as a safe third ticket alongside ticket 89, when the review's own instruction —
   "measure the defensive side in-harness" — means editing the exact file ticket 89 rewrites.
   Caught before it shipped, but only on re-reading.
3. **The Haaland captaincy call was over-corrected, twice.** First over-called (asserting the model
   was wrong), then over-corrected (asserting the gap was 2.4 and would not close). The truth was
   in between: the missing Elo was worth ~1.9 points of the 2.4 gap. **The right move was to get
   the data before ruling either way, which is what eventually happened.**
4. **A pre-registered revert criterion was set aside within a day of setting it.** Ticket 91's DoD
   said "revert rather than tune if any position moves away from 1.00". Three did. The
   recommendation was to defer rather than revert, with the departure stated openly. **This may be
   the right call, but it is exactly the move pre-registration exists to prevent — the next
   orchestrator must actually close it out (§5a), not let it quietly become permanent.**

### App Factory system findings — the ones worth acting on

**A. The pipeline cannot catch a wrong diagnosis, only a wrong implementation.** The Analyst /
Builder / QA chain verifies that the ticket was implemented as written. Nothing checks whether the
ticket's premise was true. Ticket 89 passed every gate and delivered a correct implementation of a
wrong idea. **Suggested change: a ticket whose premise is a causal claim about a measured number
should carry a "falsification check" in its DoD — a figure that must move if the diagnosis is
right.** Ticket 89 had one in spirit ("the oracle must sit above the model") but shipped as a
runtime assertion rather than a stop-and-report, so the wrong fix merged and the job simply
started failing.

**B. Draft numbers, issue numbers and in-code ticket references have diverged three ways.**
Drafts 89/91/92 became issues #192/#191/#190, and the Builder wrote #187 into code comments.
**Suggested change: have the ticket body state its own draft number, and require the Builder to
cite the GitHub issue number it was dispatched with.** Right now tracing a code comment back to
the ticket that caused it requires guessing.

**C. Nothing in the pipeline can reach an external host to verify a format, and neither can the
orchestrator chat.** ClubElo blocked this session across three separate paths (cloud container
egress, device VM egress, WebFetch robots). The existing rule — never assert an unverified external
format — is right, but it means **any ticket touching a new external source is permanently blocked
on a human running curl.** Worth deciding whether that is acceptable or whether the allowlist
(`deltas.md` D4) should be maintained proactively for known-future sources.

**D. Instrument defects have now outnumbered model defects for two consecutive waves.** Count from
this session alone: the 5-GW lookahead (three lookups), the oracle mis-diagnosis, the defcon
harness artefact (`#154`), the calibration population mismatch (`#155`), the forward-assist
cross-population artefact. **Suggested change: when a measured number moves in a surprising
direction, the default hypothesis should be "the instrument changed", and the ticket should be
written to test that first.** The review said this in its summary; the pipeline has not absorbed it.

### Standing rules adopted this session

- **No ticket may require a live database read inside the run.** (From `#175` blocking the pipeline.)
- **When you cannot find three good tickets, say so and propose a UI polish run** rather than
  padding the batch.
- **Any Claude Code prompt must end with commit, push and clean-status instructions**, and must
  name explicitly what the session must NOT touch (guardrails, sanity bounds, unrelated modules).

---

## 12. Outstanding and unconfirmed

- **The backtest fix (§4) is in flight and unverified.** Everything else waits on it.
- **`#191` is unjudged** (§5a).
- **Ticket 90 (ClubElo) does not exist** and is blocked on the upstream API (§5d).
- **G13 in the backlog currently records a wrong cause** and should be corrected by the in-flight
  fix. Verify it was.
- **`LEARNINGS-second-build-wave.md` §17–§19 were never written.** §11 above is the source material.
- **The three seeded Elo values are placeholders, not data** (§6). They should be replaced by real
  ClubElo ratings the moment the source returns.
