v3.0 — rewritten 29 Aug 2026 against the actual codebase and the `decisions/` log, not from the
previous version. Supersedes v2.0 (21 Aug), whose status column was wrong on eight items.

# Feature list — build order and status

**Issue number is build order.** There is no priority field. Nothing here may depend on something
below it.

**This is not a ticket list.** Tickets are written from it against the actual codebase, never from
the brief alone.

**Keep this file current in the merging PR.** v2.0 was eight days old at handover and wrong about
eight items, which is what produced the twice-asked question *"are these tickets even on the feature
list?"* — a fair challenge nobody could answer confidently, because the list had stopped tracking
reality. See `LEARNINGS-second-build-wave.md` §16e.

---

## Status at a glance, 29 Aug 2026

**The value loop closed on 21 Aug and has run on live data since.** Everything merged in the eight
days since has been model quality, chips, and measurement.

**26 of 33 items complete, 2 partly done, 5 open.** Roughly 60 pull requests merged, 20 migrations
all applied, 68 per-ticket decision logs.

**The app surface is finished** — items 16 to 21 and 24 all shipped. There is no unbuilt screen on
this list.

**One item is blocked on an owner decision, not on work:** item 22's in-app "Run now" button needs a
credential in the browser, which is Tier 1.

---

## Wave 1 — foundations ✅ complete

1. ✅ **App shell and design tokens** — dark theme, Geist, base layout. *#8*
2. ✅ **Supabase reference schema** — teams, players, fixtures, gameweeks. *#9*
3. ✅ **Scheduled GitHub Action scaffold** — cron, service-role write path, heartbeat. *#10*
4. ✅ **FPL API ingest job** — `bootstrap-static/` and `fixtures/`. *#11*
5. ✅ **FPL-Core-Insights ingest job** — per-match CSVs including CBIT and recoveries. *#12*
6. ✅ **Squad state schema and manual squad entry** — `/squad`. *#13*
7. ✅ **Squad sync from the public FPL API** — reconciles, never silently overwrites. *#14*, carry-forward *#101*

## Wave 2 — projections ✅ complete

8. ✅ **2026/27 scoring rules module** — pure, unit-tested. *#15*
9. ✅ **Defensive-contribution hit-rate component** — shrunk empirical rate, k=5. *#28*
10. ✅ **Baseline projection model** — five inputs, `player_projections`. *#33*
11. ✅ **Projections CSV adapter** — the seam. *#34*

## Wave 3 — recommendation and delivery ✅ complete

12. ✅ **Solver integration** — `sertalpbilal/FPL-Optimization-Tools` at a pinned commit,
    stores `solver_runs` / `solver_picks`. *#41*, fails loudly on no squad *#83*
13. ✅ **Recommendation generation** — Plan A/B/C, confidence bands, explicit hit cost,
    stored reasoning, data-coverage flags. *#47*, refined *#60*
14. ✅ **Telegram sender** — headline first, no emoji, no decimals. *#55*
15. ✅ **Notification schedule** — 24h and 10h before each deadline, double-send prevented by a
    database constraint. *#59*, duplicate check scoped to its trigger *#90*

## Wave 4 — the app surface ✅ complete

16. ✅ **Pitch view** — formation, bench separated, availability rings. *#38*, polished *#44*
17. ✅ **Verdict card** — the recommendation on the home screen. *#61*, corrected *#68*, *#72*
18. ✅ **Deadline countdown** — understated, escalating inside 24 hours. *#42*
19. ✅ **Commit action** — one tap per recommendation. *#84*
20. ✅ **Override registration** — deliberate friction, writes the decision ledger. *#91*,
    records the recommendation inside the snapshot *#107*
21. ✅ **Reasoning screen** — stored reasons and the underlying numbers. *#79*, Plan B and Plan C
    added *#102*

## Wave 5 — daily cadence 🔶 blocked on an owner decision

22. ⬜ **Daily projection run and "Run now" button.** **The daily run half is done** —
    `scheduled-jobs.yml` and `solver-run.yml` run it. **The in-app trigger is not built and is not
    a normal ticket:** firing a workflow from the browser needs a GitHub credential in the client
    bundle, which is Tier 1 and owner-only. Decide the mechanism before writing a ticket for it.

## Wave 6 — self-measurement ✅ complete

23. ✅ **Prediction log and post-lockdown settlement** — snapshot frozen at the deadline, settled
    after 09:00 UK the morning after the final match, signed error stored. *#73*
24. ✅ **Rolling accuracy display** — on the home screen, with a minimum sample size below which it
    reports "too small to read" rather than a number. *#96*

## Wave 7 — chips ✅ complete

25. ✅ **Chip state tracking** — which used, which set, expiry against the GW19 deadline. *#85*
26. ✅ **Chip expiry warnings** — escalating urgency band as 2 January 2027 approaches. *#97*
27. ✅ **Chip recommendation — shipped as an ADVISORY, deliberately never an instruction.**
    Dispatch-only probe first *#114*, then the stored advisory *#126*, display corrected *#141*.
    `chip_advisories` is architecturally unreadable by `recommendations`, `solver_picks` or the
    Telegram message, so a chip delta can never become "play this chip". Per `product-brief.md` §6a.

## Wave 8 — full-squad solving 🔶 built, never run

28. ✅ **Wildcard and free-hit full-squad solve.** *#134* built `squad-rebuild-probe.yml` and
    **First dispatched 25 Sept 2026 on gbm-v1 projections: every step green, rebuilt squad stored.**
    `store-squad-advisory.ts`, with five stated guard rails keeping `preseason: true` away from
    every stored table. **The workflow has never been dispatched** — a `workflow_dispatch` file is
    only invocable once it is on the default branch, so nothing has yet proved the solver behaves
    sanely building a squad from nothing. **This is an outstanding human check, not a ticket.**

## Wave 9 — the model upgrade

29. ✅ **Point-in-time historical feature pipeline** — `feature_history`, strictly-before cumulative
    totals per (season, gameweek, player_code). *#121*, completed *#125*, position and per-match
    defensive-contribution counters added *#146*. **The substrate is finished; `run-backtest.ts`
    still reads neither `element_type` nor the two defcon counters**, which is why the 23% backtest
    exclusion and the defcon error are both unchanged. That consumer read is the open work.
30. 🔶 **OpenFPL retrain on post-defcon data.** *Depends on 29.* In progress — *#258* builds
    `gbm-v1` (LightGBM, four seasons, offline gate) under `model/`. Nothing live changes yet; the
    nightly job and `player_projections` wiring is run 2's ticket
    (docs/model-diagnosis-2026-09-24.md §8, R2-T2).
31. 🔶 **Swap the projection source behind the CSV seam.** *Depends on 11, 30.* In progress —
    `config/projection-model.json` and the shared reader are R1-T3
    (docs/model-diagnosis-2026-09-24.md §8), not part of *#258*. `player_projections.model_version`
    exists so `gbm-v1` can be written alongside `baseline-v1` rather than over it. The reasoning
    screen now names the deciding model and its top three reasons in plain words per named player,
    with the `baseline-v1` breakdown kept underneath as the explainer — *#266*. Live yet: only once
    the nightly `gbm-v1` job (*#131*) has run and the owner has switched the active model.

## Wave 10 — backtest 🔶 partly done

32. 🔶 **Season simulation harness.** The **projection-level** slices are built: the harness itself
    *#133*, multi-fixture gameweeks and the defcon diagnostic *#140*, ranking skill *#147*.
    **The recommendation-level replay — transfers, captaincy, a season's league position — is not
    built**, and cannot be a genuine replay of Keshav's own decisions: the app did not exist in
    2025/26 and there is no stored squad for that season.
33. ✅ **Mini-league standings — display only.** *#271.* Classic league 848654
    (`config/mini-league.json`) is ingested nightly (`scripts/ingest-mini-league.ts`, paginated
    via `standings.has_next`) into `public.mini_league_standings`, keyed to the latest FINISHED
    gameweek — standings only ever reflect a completed gameweek, per product-brief.md §3. Shown
    on the home screen (`MiniLeagueCard`, below the accuracy card): rank of N, movement since the
    previous gameweek, gap to the leader and to the place above, and a compact table (leader,
    above, Keshav highlighted, below). **Display only, forever** — product-brief.md §1: "must
    never enter the optimiser's objective," and nothing in `src/lib/scoring/`,
    `src/lib/projection/` or the solver input reads this table. This is the FPL-API-standings
    half of the original item; the season-simulation-based **comparison** this item's own
    "Depends on 32" originally pointed at is not built and still depends on 32.

---

## Off-list work that shipped

None of these were planned. The majority were defects found by reading output, not by testing —
which `LEARNINGS-second-build-wave.md` §2 and §9 name as the most valuable input the human provides.

**Waves 1–3 (to 21 Aug):** *#22* stable `player_code` join key · *#26* fixed backdrop ·
*#29* solver smoke test · *#32* ClubElo matched by team code · *#43* paginate every Supabase read ·
*#48* baseline calibration report · *#54* Premier-League-only filter and `team_goals_conceded` ·
*#63* null ClubElo for unmatched clubs · *#69* preflight check · *#72* verdict card scoped to one
solver run.

**Since 21 Aug:**

| Ticket | What |
|---|---|
| #66 | Chip cross-check — solution indexing and body layout |
| #77 | Treat an FPL overall rank of zero as unranked |
| #78 | **Project bonus points** and share them across each fixture — the largest model gap on the v2.0 list |
| #89 | Narrow the preflight projections check to available players |
| #95 | Widen the solver's player pool (`keep_top_ev_percent` 5→25, `ev_per_price_cutoff` 30→10) |
| #103, #107 | Decision history screen, and the recommendation inside the override snapshot |
| #108, #120, #142 | Solver settings audit closed — `no_transfer_last_gws`, `decay_base`, `ft_value_list` all now set explicitly |
| #109 | Scale goalkeeper saves with fixture difficulty |
| #113 | **Two-stage shrinkage** — this season, shrunk toward (last season, shrunk toward the position average) |
| #115 | Preflight alarm for the league-baseline-goals fallback |
| #119 | Price as a weak prior for players with no Premier League history |
| #127, #132 | Instrument repairs — calibration report restored to like-for-like, solver Results parser and clean-sheet source fixed |
| #148 | Position-specific assist conversion — assist signed error −0.095 → −0.032 |

---

## What to build next, in order

Not tickets — the shape of the queue. Whoever writes them must read the codebase first.

1. **Deterministic ordering on every paginated read.** Draft written:
   `tickets/drafts/73-deterministic-pagination.md`. Roughly 31 paginated call sites pass no
   `ORDER BY`, and one more orders by a non-unique column. Currently visible as preflight check 7
   failing. **This goes first because every measurement depends on it**, and it should run alone or
   with one companion that touches `src/lib/projection/` only.
2. **Make the consumers read `feature_history.element_type` and the two defcon counters** (item 29's
   open half). Kills the 23% backtest exclusion and makes the defensive-contribution question
   answerable. Unblocked by #146; touches `scripts/run-backtest.ts`, so it cannot batch with 1.
3. **A ranking baseline comparator, plus the top-N population cap.** #147's Spearman 0.289 has no
   comparator and is uninterpretable; its by-position top-N overlap is arithmetically fake wherever
   the position's population is smaller than N. Both defects are in
   `scripts/run-backtest.ts` — cannot batch with 1 or 2.

**After those:** horizon ranking (the solver optimises over 5 gameweeks; #147 measured 1) ·
goalkeeper ranking, Spearman 0.024 · the residual GW33 error · item 29's consumer work feeding
item 30.

**Drafts written, deliberately not filed:** `tickets/drafts/59-model-version-seam.md`,
`tickets/drafts/69-ft-value-list-explicit.md` (may have been filed as #142 — check before reusing).
