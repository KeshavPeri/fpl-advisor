v2.0 — rewritten 21 Aug 2026, the morning before the GW1 deadline. Supersedes the v1.0 written in
the Phase 1 design workshop, which had drifted badly out of date.

# Feature list — build order and status

**Issue number is build order.** There is no priority field. Nothing here may depend on something
below it.

**This is not a ticket list.** Tickets are written from it against the actual codebase, never from
the brief alone.

---

## Status at a glance, 21 Aug 2026

**The value loop is closed.** Items 1–15 are all shipped and merged. Real squad in → projections →
solver-format CSV → solve → recommendation → a Telegram message that arrives on the phone. Verified
end to end on live data.

**36 pull requests merged.** 15 migrations, all applied. 15 background jobs. 7 workflows.
31 per-ticket decision logs.

Items 16 and 18 from wave 4 were pulled forward and are also done. **17 of 33 items complete.**

Seven tickets shipped that were never on this list at all — see "Off-list work" at the end. Five of
the seven were defects found by reading output, not by planning.

---

## Wave 1 — foundations ✅ complete

1. ✅ **App shell and design tokens** — dark theme, Geist, base layout. *#8*
2. ✅ **Supabase reference schema** — teams, players, fixtures, gameweeks. *#9*
3. ✅ **Scheduled GitHub Action scaffold** — cron, service-role write path, heartbeat. *#10*
4. ✅ **FPL API ingest job** — `bootstrap-static/` and `fixtures/`. *#11*
5. ✅ **FPL-Core-Insights ingest job** — per-match CSVs including CBIT and recoveries. *#12*
6. ✅ **Squad state schema and manual squad entry** — `/squad`. *#13*
7. ✅ **Squad sync from the public FPL API** — reconciles, never silently overwrites. *#14*

## Wave 2 — projections ✅ complete

8. ✅ **2026/27 scoring rules module** — pure, unit-tested. *#15*
9. ✅ **Defensive-contribution hit-rate component** — shrunk empirical rate, k=5. *#28*
10. ✅ **Baseline projection model** — five inputs, `player_projections`. *#33*
11. ✅ **Projections CSV adapter** — the seam. *#34*

## Wave 3 — recommendation and delivery ✅ complete

12. ✅ **Solver integration** — runs `sertalpbilal/FPL-Optimization-Tools` at a pinned commit,
    stores `solver_runs` / `solver_picks`. *#41*
13. ✅ **Recommendation generation** — Plan A/B/C, confidence bands, explicit hit cost,
    stored reasoning, data-coverage flags. *#47*, refined by *#60*
14. ✅ **Telegram sender** — headline first, no emoji, no decimals. *#55*
15. ✅ **Notification schedule** — 24h and 10h before each deadline, double-send prevented by a
    database constraint. *#59*

## Wave 4 — the app surface 🔶 partly done

16. ✅ **Pitch view** — formation, bench separated, availability rings. *#38*, polished *#44*
17. ✅ **Verdict card** — the recommendation on the home screen. *#61*, corrected by *#68* and *#72*
18. ✅ **Deadline countdown** — understated, escalating inside 24 hours. *#42*
19. ⬜ **Commit action** — one tap per recommendation. *Depends on 17.*
20. ⬜ **Override registration** — deliberate friction, writes the decision ledger. *Depends on 7, 19.*
21. ⬜ **Reasoning screen** — stored reasons and the underlying numbers. *Depends on 13, 17.*
    **Next UI ticket.** Right now the only way to see why a recommendation was made is a SQL query
    against `player_projections.components`.

## Wave 5 — daily cadence

22. ⬜ **Daily projection run and "Run now" button** — plus the early-transfer advisory.
    *Depends on 13, 14.* The daily run half already exists via `scheduled-jobs.yml` and
    `solver-run.yml`; the in-app trigger does not, and needs a credential in the browser, which
    is a Tier 1 problem to solve deliberately.

## Wave 6 — self-measurement 🔶 partly done

23. ✅ **Prediction log and post-lockdown settlement** — snapshot frozen at the deadline, settled
    after 09:00 UK the morning after the final match, signed error stored. *#73*
24. ⬜ **Rolling accuracy display** — visible, not buried. *Depends on 23.* Nothing reads the
    prediction log yet.

## Wave 7 — chips

25. ⬜ **Chip state tracking** — which used, which set, expiry against the GW19 deadline.
    *Depends on 7.* `squads.chips_used` already stores the raw state.
26. ⬜ **Chip expiry warnings** — escalating as 2 January 2027 approaches. *Depends on 15, 25.*
27. ⬜ **Chip recommendation** — enable the solver's chip flags. *Depends on 12, 25.*
    `chip_limits` are currently all zero, deliberately.

## Wave 8 — full-squad solving

28. ⬜ **Wildcard and free-hit full-squad solve** — the solver's squad-build path.
    *Depends on 12, 27.* The solver's `preseason` mode does this and is deliberately never enabled.

## Wave 9 — the model upgrade

29. ⬜ **Point-in-time historical feature pipeline** — lookahead-free reconstruction. *Depends on 5.*
    **The single largest item on this list**, shared with the backtest. Repeatedly declared
    out of scope in tickets, on purpose.
30. ⬜ **OpenFPL retrain on post-defcon data.** *Depends on 29.*
31. ⬜ **Swap the projection source behind the CSV seam.** *Depends on 11, 30.* Should touch nothing
    but the projection job. `player_projections.model_version` exists so a successor can be written
    alongside `baseline-v1` rather than over it.

## Wave 10 — backtest

32. ⬜ **Season simulation harness.** *Depends on 12, 29.*
33. ⬜ **Mini-league comparison** against the ~20 real managers. *Depends on 32.*

---

## Off-list work that shipped

None of these were planned. Five of the seven were defects found by reading output.

| Ticket | What | How it was found |
|---|---|---|
| #22 | `player_code` stable cross-season join key | QA on #12 noticed element ids move between seasons |
| #26 | Fixed backdrop behind scrolling content | Visual review on the phone |
| #29 | Solver GitHub Action smoke test | Pulled forward as the largest unproven risk |
| #32 | ClubElo matched by team **code**, not id | Reading the ingest code while writing item 10's ticket |
| #43 | Paginate every Supabase read | 1,000 exactly — a round number in a job's own counters |
| #48 | Baseline calibration report | Written to settle a modelling doubt with a number |
| #54 | Premier-League-only match filter, `team_goals_conceded` | Keshav noticed a 38-game season showing 54 matches |
| #63 | Null ClubElo for unmatched clubs | Preflight's own counters reconciling to the wrong number |
| #69 | Preflight check | Written because nothing answered "is the whole chain healthy" |
| #72 | Verdict card filtered to one solver run | A displayed figure that was roughly double |

---

## What to build next, in order

Not tickets — the shape of the queue. Whoever writes them must read the codebase first.

1. **Bonus-point projection.** The largest single gap in the model and the known cause of an open
   question about captaincy. See `docs/projection-model-backlog.md` G3.
2. **Item 21, the reasoning screen.** The app cannot currently explain itself.
3. **Item 24, rolling accuracy.** The prediction log has nowhere to surface.
4. **Widen the solver's player pool.** `keep_top_ev_percent` (5) and `ev_per_price_cutoff` (30)
   prune hard; the solver has only ever surfaced a handful of transfer targets.
5. **Items 19 and 20 together**, the commit action and override registration.
6. **Narrow the preflight projections check** to available players only — it currently fails on a
   non-reason. Draft already written: `tickets/drafts/32-preflight-available-players-only.md`.

`docs/projection-model-backlog.md` holds eight known model gaps, each with its direction of error
and the shape of a fix. Read it before writing anything that touches projections.
