v1.0 — written 10 Aug 2026 from the Phase 1 design workshop. Supersedes the provisional
`PRODUCT.md` seed for all questions of mechanism, data source and scope.

# Product brief — FPL Advisor

This is the document the Analyst holds for every ticket on this app. Order of operations for
any question the Analyst hits: **check whether this brief already answers it before reasoning
or researching.** A silent brief is what pushes decisions onto the Builder at 3am.

---

## 1. One-liner

A single-user Fantasy Premier League advisor that arrives with the decision already made —
telling Keshav which transfer to make, who to captain, and when to play a chip, before every
deadline, from a data model rather than from instinct.

**The problem it solves is not ignorance, it is decision fatigue and bias.** Keshav already
receives FPL's own deadline reminders, acknowledges them, and still misses deadlines. When he
does act, he makes wishful Arsenal-biased picks and mistimes chips. In 2025/26 he was top-half
while regular and fell away badly once his transfers became irregular.

**Therefore the product's job is to remove the decision, not to remind him of it.** A
notification that says "the deadline is coming" is worthless here — that already exists and
already fails. The notification must carry the recommendation, so that acknowledging it and
deciding are the same act.

### The one screen that matters most

**The home screen**, opened Thursday evening on an iPhone. It shows, in this order: a thin
deadline countdown, the recommended actions for this gameweek, and the current squad as a
pitch. If only one screen in this app is good, it is this one.

### The objective function — Tier 2, decided here

**Maximise Keshav's own expected FPL points.** Not relative performance against his ~20-person
mini-league.

**Because** the league-relative strategy has a degenerate optimum — if he leads at the halfway
point, the correct play is to copy the second-place manager's squad and neutralise them — and
he has explicitly rejected winning that way. Maximising his own points is the honest objective,
it is what he wants to test this season, and it diverges from league-relative optimisation only
narrowly (chip timing and the closing gameweeks).

**Consequence for the Analyst:** mini-league standings may be *displayed*. They must never
enter the optimiser's objective. Ownership and template-following are display data, not
objectives. Do not add "differential" or "effective ownership" logic to recommendations.

---

## 2. Core features (v1 scope)

Targeted at the GW1 deadline, **01:30 Singapore time, Saturday 22 August 2026** (90 minutes
before Arsenal v Coventry, 20:00 BST Friday 21 August).

- **Squad state owned by the app.** Reads Keshav's true squad from the public FPL API after
  each deadline; accepts manual entry before GW1 exists; accepts registered overrides for
  changes made between deadlines.
- **Weekly recommendation**: one clear primary transfer decision (including "roll your
  transfer"), captain, and starting XI/bench order — with Plan B and Plan C.
- **Stored reasoning** for every recommendation, shown on its own screen.
- **Override registration** with slight friction, which doubles as the override ledger.
- **Telegram notification** carrying the decision, at 24 hours and 10 hours before each
  deadline.
- **Daily recommendation refresh** plus a manual "Run now" button, so an early transfer can be
  made ahead of a price rise.
- **Prediction accuracy tracking** — every projection stored, scored against actuals after
  gameweek lockdown, and shown as a rolling figure in-app.

### Explicitly in scope, deliberately later

Built after GW1, in this order. Designed now so nothing in v1 blocks them.

- **Chip strategy** for all eight chips.
- **Full-squad solver** for wildcard and free hit.
- **OpenFPL retrain** on post-defcon data, replacing the v1 baseline projection.
- **Backtest harness** simulating 2025/26 against the actual mini-league result.

---

## 3. Out of scope (for now)

- **GW1 squad selection.** Keshav builds his opening 15 manually. FPL now ships its own
  squad-building assistant; the app's solver arrives with the wildcard work, not before GW1.
- **Squad evaluator / grading an entered squad.** Considered and cut in the workshop.
- **Price-change prediction.** FPL ships an official predictor updating daily at 00:00 UK time.
  Consume it; do not build one.
- **Live in-play scores, live rank, live mini-league updates.** All native in FPL for 2026/27.
  Keshav is content to switch apps for this.
- **Any league-relative or differential optimisation.** See §1.
- **Multi-user, accounts, auth, sharing.** Single user, permanently.
- **Automatically applying transfers to the FPL site.** Every action is confirmed by Keshav in
  FPL itself. The app advises and records; it never acts on his FPL account.

---

## 4. In-game currency declaration — Tier 3

Per the escalation tiers (§4.5 of the system design), **real money** is Tier 1 but **in-game or
in-app representations of money are Tier 3** — they are display and formatting concerns.

**For this app:** the FPL budget, player prices, the bank balance, squad value, price rises and
falls, and the 4-point transfer hit cost are **all in-game numbers with no connection to any
real payment method. They are Tier 3.** Formatting them — the £ symbol, one decimal place,
colour for rising and falling prices, how a −4 hit is displayed — is a routine design decision
and must not be escalated.

This app touches no real money at any point. It has no paid tier, no payment integration, and
no purchasable anything.

---

## 5. What personal data this app may store

Not "none". The following is **pre-approved by this brief** and must not trigger Tier 1:

- **Keshav's FPL entry ID** — a public identifier.
- **His squad picks, bank, squad value, transfer history, chips used, overall points and
  rank** — all retrieved from public, unauthenticated FPL API endpoints.
- **His registered overrides and the resulting decision ledger** — generated by the app.
- **His Telegram chat ID**, for notification delivery.
- **Mini-league standings, which include the display names and team names of the other ~20
  managers in his league.** This is third-party personal data. It is public via the FPL API,
  it is stored only to display standings, and it is never used in any recommendation.

**Not stored, ever:** FPL login credentials, session cookies, passwords, email address, or
anything from the authenticated `my-team/` endpoint. The app never logs in to FPL. Any ticket
that proposes storing an FPL credential is a Tier 1 stop.

**Any personal data field not listed above still hits Tier 1.**

---

## 6. Chosen external data sources — Tier 2, high-impact

Two sources. **Neither requires an account, an API key, or any credential.** This was a
deliberate design goal and it was achieved.

### 6a. The official FPL API — public endpoints only

**Source:** `https://fantasy.premierleague.com/api/` — unofficial in the sense that it is
undocumented and unsupported, but it is the same API the official site and app consume.

**Because** it is the authoritative source for prices, availability tags, fixtures, ownership,
defensive-contribution totals and Keshav's own squad, it requires no key, and — verified live
during the workshop on 10 Aug 2026 — the endpoints the app needs return data unauthenticated.
`entry/{id}/` was confirmed by direct request to expose squad value, bank, transfer count,
rank and league membership with no login.

**Endpoints used:** `bootstrap-static/`, `fixtures/`, `element-summary/{id}/`, `entry/{id}/`,
`entry/{id}/history/`, `entry/{id}/event/{gw}/picks/`, `leagues-classic/{id}/standings/`.

**Explicitly NOT used:** `my-team/{id}/`, which requires login. The one thing it provides —
the in-progress squad between deadlines — is covered by manual override registration instead.
**This is the reason the app needs no credentials at all, and it must not be undone.**

**Rejected alternative:** scraping the login flow for `my-team/`. Rejected because it needs
stored credentials (Tier 1), sits behind Cloudflare, and decays silently — the failure would
land on a Friday night mid-season with no way to diagnose it from a phone.

**Graceful failure:** if the FPL API is unreachable or returns unexpected shapes, the app shows
the last successful sync timestamp prominently and marks recommendations as stale. **It must
never present stale recommendations as current.** No recommendation is better than a wrong one.

### 6b. FPL-Core-Insights — match-level statistics

**Source:** `https://github.com/olbauday/FPL-Core-Insights` — CSVs over plain HTTPS, refreshed
twice daily at 07:30 and 17:30 UTC, covering the 2026/27 season. (Refresh times corrected
11 Aug 2026 against the source repository's own README; the 05:00/17:00 figures written in the
Phase 1 workshop were wrong. Any schedule anchored to the ingest must use the later times.)

**Because** it supplies per-player, per-match clearances, blocks, interceptions, tackles and
recoveries — the raw inputs to defensive-contribution modelling — plus xG, xA, ClubElo team
ratings, and point-in-time per-gameweek snapshots that make lookahead-free backtesting
possible later. It needs no credential and is aligned to official FPL player IDs.

**Rejected alternative:** Understat, which OpenFPL's own documentation points to. Rejected
because it is a scraped site with no API and no stability guarantee; FPL-Core-Insights covers
the same xG/xA need from a source designed to be consumed programmatically.

**Graceful failure:** if the CSVs are unavailable or stale beyond 48 hours, fall back to the
FPL API's own `defensive_contribution` and `expected_goals` fields, and flag reduced
confidence in the app. Degrade, do not stop.

### 6c. The optimiser — adopted, not built

**Source:** `https://github.com/sertalpbilal/FPL-Optimization-Tools`, Apache-2.0.

**Because** it is mature, community-standard operations-research code that already implements
multi-period horizon planning, chip optimisation for all four chip types, free-transfer
valuation, bench weighting, hit limits, points decay across the horizon, and — critically for
this app — **alternative-solution generation via `iteration` / `iteration_criteria`, which is
exactly the Plan A / Plan B / Plan C requirement.** Building an equivalent integer program
in-house would be slower and worse.

**Its key architectural property:** it reads projections from a CSV and does not care where
they come from. **This CSV is the seam of the entire system** — the projection model can be
replaced without touching the solver, the app, the data layer or the notifications.

**Graceful failure:** the solver has three distinct failure modes and they are not
interchangeable.

- **Binary missing or install failure** in the Action — the run fails loudly. Telegram sends a
  failure notice. The app shows the previous run's recommendation clearly marked with its age.
- **Timeout** — the solver is time-limited and may return its best incumbent rather than a
  proven optimum. **A timed-out solution is usable but must be labelled**, and its confidence
  band drops one level. Never present it as a proven optimum.
- **Infeasible** — almost always means squad state is wrong, not that the solver broke. This is
  the one case with a specific, actionable message: the app must say the registered squad
  doesn't reconcile and prompt Keshav to re-check it, rather than showing a generic error.

In no case does the app show a recommendation it cannot stand behind. **No recommendation
beats a wrong one** — the same rule as §6a.

**Rejected alternative:** AIrsenal (Alan Turing Institute). Better maintained than most, and
its architecture composes points from components. Rejected as the primary because it publishes
no accuracy figures at all, and its own advertised showcase team has one completed season on
record — 2023/24, 808 points, overall rank 10,527,231 — and no completed 2025/26 despite its
README advertising one. Keep it as reference prior art for the solver work only.

### 6d. The projection model — the one part built in-house

**v1 (for GW1): a transparent baseline model.** Five inputs — minutes probability, xG and xA
rates, fixture difficulty via ClubElo, clean-sheet probability, and defensive-contribution hit
rate. Each explainable in one sentence.

**Because** the alternative, OpenFPL, cannot responsibly ship by 21 August. Its published
accuracy is real and is the best available anywhere in the open, but its trained weights
predict FPL points *as scored before defensive contributions existed*, and its README requires
reconstructing 196–206 undocumented features "for inspiration" from a sample CSV — work with
no objective definition of done, which is precisely the ticket shape this pipeline handles
worst.

**Post-GW1: OpenFPL, retrained on post-defcon data.** This is the intended destination, not an
abandoned option. The retrain shares most of its work with the backtest harness, since both
require lookahead-free point-in-time feature reconstruction.

**Graceful failure:** if the projection job fails, the app shows the previous run's
recommendation clearly marked with its age, and Telegram sends a failure notice rather than
silence.

### Scoring rules the model must implement — verified 10 Aug 2026 against the Premier League

These changed for 2026/27 and are load-bearing. Do not take them from training data.

- **Defensive contributions are capped at +2 per match.** A defender reaching 10 CBIT scores 2;
  a defender reaching 20 CBIT still scores 2, not 4. Defenders: 10 CBIT. Midfielders and
  forwards: 12 CBIRT, recoveries included. Unchanged from 2025/26.
- **Goalkeeper save points are NOT capped** and accumulate in complete groups of three — 3
  saves = 1 point, 6 = 2, 9 = 3. This is a different function from defcon and must be
  implemented separately.
- **BPS changed for 2026/27:** CBI now earns 1 BPS per *three* actions (was two); the −1 BPS
  penalty for being tackled is removed; goalkeepers earn 2 BPS for *any* save, +1 for a save
  inside the box, +1 for saving a big chance, and a penalty save is now 7 BPS (was 8).
- **Gameweek lockdown is 09:00 UK time the morning after the final match**, not one hour after
  the final whistle. **The accuracy tracker must wait for lockdown before scoring itself**, or
  it will compare against provisional bonus and defcon numbers.
- **Chips: eight total, two sets of four.** The first set expires at the GW19 deadline, 13:30
  GMT Saturday 2 January 2027 (21:30 Singapore time). Unused chips do not carry over.
- **Up to five free transfers may be rolled.**

### Transfer hits — decided here

**Hits are permitted, but only above a margin.** The solver may recommend a −4 only when the
projected net gain across the horizon clearly exceeds the cost — a break-even hit is noise, not
an edge. When a hit is recommended, the app must state the cost and the net explicitly.

---

## 7. Design references

See `design-reference.md`, rewritten for this app in the same workshop. Summary of what binds:

dark only, no light mode, no toggle; `#0b0f19` remains the anchor; layered translucent surfaces
rather than borders and boxes; cool blue/cyan for recommended actions, coral for risk; **no
green and no yellow**; Geist and Geist Mono, explicitly not Inter; pitch layout for the squad;
reasoning on its own screen.

Impeccable remains confined to designated polish tickets per §5.4 of the system design. It is
not to be run on every ticket.

---

## 8. Locale and formatting

- **Timezone: Asia/Singapore (UTC+8) for everything Keshav sees.** FPL publishes deadlines in
  UK time; the app converts. Deadlines will often fall after midnight Singapore time — the
  countdown must make the *date* unambiguous, not just the time.
- **Dates:** `Sat 22 Aug`, weekday first. Never US month/day ordering.
- **Times:** 24-hour, `01:30`.
- **Money:** in-game only. `£8.5m`, one decimal place, `£` symbol.
- **Points:** whole numbers for actuals. Projections carry **no decimal places in the primary
  view** — see the confidence rule below.
- **Language:** British English, matching FPL's own terminology — "gameweek", "fixture",
  "clean sheet", "bench boost".

### Confidence display — Tier 3, decided here

**Projected-points values must never be shown as decimals in the recommendation UI.** The gap
between the top three transfer options is routinely under one point, well inside the model's
own error; rendering "4.2 versus 4.0" manufactures false confidence.

Show a coarse band — **clear / marginal / coin-flip** — plus the reason. **When the top options
are statistically indistinguishable, the app must say so plainly** rather than inventing a
preference. Raw numbers may appear on the reasoning screen, where the context makes them
honest.

---

## 9. Open questions

1. ~~**Geist licensing and delivery.**~~ **RESOLVED 11 Aug 2026 — no fallback needed.** Geist is
   released under the **SIL Open Font License 1.1**, verified against
   `github.com/vercel/geist-font/blob/main/LICENSE.txt`. Self-hosting, bundling and
   redistribution are permitted; the only restriction is that the font may not be sold by
   itself, which does not apply here. Delivery is `@fontsource-variable/geist` and
   `@fontsource-variable/geist-mono` (both published `OFL-1.1`), importing the roman-only
   `wght.css` from each. The CSS family names are exactly `'Geist Variable'` and
   `'Geist Mono Variable'`. Inter remains excluded.
2. **The exact threshold at which a −4 hit becomes recommendable** — needs a number, and the
   number should come from the backtest rather than from taste. Until then the solver's
   `hit_cost` default stands and hits are effectively rare.
3. **Whether the daily run should notify on a *changed* recommendation** mid-week, or stay
   silent until the 24-hour mark. Risks notification fatigue, which is the failure mode this
   app exists to fix.
4. **Backtest fidelity** — 2025/26 had defensive contributions but not the 2026/27 BPS
   rebalance, so any backtest result is directional, not predictive. How much weight to give it
   is a judgement to make when the number exists.
