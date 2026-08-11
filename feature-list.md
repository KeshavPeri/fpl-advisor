v1.0 — written 10 Aug 2026 in the Phase 1 design workshop. Input to the Part 2 spec-and-filing
session. Read alongside `product-brief.md` and `design-reference.md`.

# Feature list — build order

**Issue number is build order.** There is no priority field. Nothing here may depend on
something below it.

**This is not a ticket list.** Part 2 writes tickets from it, against the actual codebase.
Per the kickoff pack: write six to ten tickets in the first wave, label four or five, let them
build, then re-lint the next wave against the code that then exists.

---

## The critical insight for sequencing

**The value loop closes at item 15, not at the end of the list.**

Items 1–15 deliver the entire point of this app: data in, projection, solver, recommendation,
and a Telegram message on Thursday carrying the decision. Everything from 16 onward is the
app *surface* — genuinely wanted, but not what makes the app work.

So if 21 August gets tight, **cut from 16 downward, not from the middle.** A working
notification with no UI still solves the problem. A beautiful pitch view with no
recommendation does not.

---

## Wave 1 — foundations

Nothing here produces user-visible advice. All of it is load-bearing.

1. **App shell and design tokens** — dark theme, Geist, base layout; replaces the Supabase
   connectivity-check page. *No dependencies.*
2. **Supabase reference schema** — teams, players, fixtures, gameweeks. *No dependencies.*
3. **Scheduled GitHub Action scaffold** — cron workflow, Supabase service-role write path,
   heartbeat row only, no business logic. *Depends on 2.* Proves the pipeline before anything
   rides on it.
4. **FPL API ingest job** — `bootstrap-static/` and `fixtures/` into Supabase. *Depends on
   2, 3.*
5. **FPL-Core-Insights ingest job** — per-match CSVs, including CBIT and recoveries, into
   Supabase. *Depends on 2, 3.*
6. **Squad state schema and manual squad entry** — enter the opening 15 by hand. *Depends on
   1, 2.* Required because no picks exist before GW1.
7. **Squad sync from the public FPL API** — read `entry/{id}/` and `picks/`, reconcile against
   stored state. *Depends on 4, 6.*

## Wave 2 — projections

8. **2026/27 scoring rules module** — defcon capped at +2, GK saves in groups of three, the
   revised BPS. Pure functions, unit-testable. *Depends on nothing.*
9. **Defensive-contribution hit-rate component** — per-player threshold probability. *Depends
   on 5, 8.*
10. **Baseline projection model** — minutes probability, xG and xA rates, ClubElo fixture
    difficulty, clean-sheet probability, plus defcon. *Depends on 4, 5, 8, 9.*
11. **Projections CSV adapter** — emit solver-format CSV. *Depends on 10.* **This is the seam;
    keep it clean.**

## Wave 3 — recommendation and delivery

**The loop closes here.**

12. **Solver integration** — solver plus CBC/HiGHS binary in the Action, run and store output.
    *Depends on 7, 11.*
13. **Recommendation generation** — primary pick plus Plan B and C, confidence bands, stored
    reasoning, explicit hit cost when a −4 is recommended. *Depends on 12.*
14. **Telegram sender** — structured block, headline first, reason included, no emoji.
    *Depends on 13.*
15. **Notification schedule** — 24 hours and 10 hours before each deadline, Singapore time.
    *Depends on 14.*

## Wave 4 — the app surface

16. **Pitch view** — squad as a formation, bench separated, injury and suspension rings.
    *Depends on 1, 6.*
17. **Verdict card** — the recommendation on the home screen. *Depends on 13, 16.*
18. **Deadline countdown** — understated, escalating inside 24 hours. *Depends on 1.*
19. **Commit action** — one tap per recommendation. *Depends on 17.*
20. **Override registration** — deliberate friction, writes the decision ledger. *Depends on
    7, 19.*
21. **Reasoning screen** — stored reasons and the underlying numbers. *Depends on 13, 17.*

## Wave 5 — daily cadence

22. **Daily projection run and "Run now" button** — plus the early-transfer advisory, using
    FPL's official price predictor, only when a recommendation is stable across days.
    *Depends on 13, 14.*

## Wave 6 — self-measurement

23. **Prediction log and post-lockdown settlement** — score projections against actuals only
    after 09:00 UK the morning after the final match. *Depends on 10.*
24. **Rolling accuracy display** — visible, not buried. *Depends on 23.*

## Wave 7 — chips

25. **Chip state tracking** — which used, which set, expiry against the GW19 deadline.
    *Depends on 7.*
26. **Chip expiry warnings** — escalating as 2 January 2027 approaches. *Depends on 15, 25.*
27. **Chip recommendation** — enable the solver's chip flags and surface timing advice.
    *Depends on 12, 25.*

## Wave 8 — full-squad solving

28. **Wildcard and free-hit full-squad solve** — the solver's squad-build path. *Depends on
    12, 27.* Needed well before the first realistic wildcard, not before GW1.

## Wave 9 — the model upgrade

29. **Point-in-time historical feature pipeline** — lookahead-free reconstruction of features
    as known at each past deadline. *Depends on 5.* **The single largest item on this list**,
    and shared with the backtest.
30. **OpenFPL retrain on post-defcon data.** *Depends on 29.*
31. **Swap the projection source behind the CSV seam.** *Depends on 11, 30.* Should touch
    nothing but the projection job if item 11 was built properly.

## Wave 10 — backtest

32. **Season simulation harness** — squad state, transfers and chips across 38 gameweeks.
    *Depends on 12, 29.*
33. **Mini-league comparison** — simulated 2025/26 result against the actual finishing
    positions of the ~20 real managers, which are public via the API. *Depends on 32.*

---

## Honest scope note for 21 August

Items 1–15 are the GW1 target. At two tickets per night from 11 August that is fifteen nights
of work in eleven days — so **the overnight cadence alone does not make the deadline.** Either
some runs get triggered manually, or the target moves to "the loop closes shortly after GW1
and the first fully-advised gameweek is GW2".

Both are acceptable outcomes. Neither is the same as discovering it on the 20th.
