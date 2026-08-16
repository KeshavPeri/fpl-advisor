## Context

Not on `feature-list.md` — a measurement ticket, filed because the first real solver output raised a
specific, checkable doubt about the baseline projection model and **nothing in the system can
currently answer it.**

Depends on item 10 (`player_projections`, merged and populated), #12/#22 (`player_match_stats` with
`player_code`) and #15 (`src/lib/scoring/`) — all merged.

### The observation that prompted this

The first stored solve, 16 Aug 2026, projected these for gameweek 5:

| Player | Position | Projected |
|---|---|---|
| O'Reilly | DEF | **7.31** |
| Guéhi | DEF | **6.82** |
| Thiago | FWD | 4.92 |
| Watkins | FWD | 4.59 |
| Saka | MID | 4.21 |

The solver captained a **defender** in four of the five gameweeks, because defenders were the
highest-projected players available. That may be right — 2026/27's defensive-contribution rules
genuinely raised defender scoring, which is the whole reason `product-brief.md` §6d treats defcon as
a first-class input. Or the model may be over-rewarding defenders and under-rewarding attackers,
which would be a systematic error affecting **every recommendation the app ever makes**.

**Both readings are plausible from the numbers alone, and arguing about it is worthless.** The two
known gaps in `docs/projection-model-backlog.md` both point the same way — G3, bonus points are not
modelled at all, and bonus disproportionately favours attackers and high-BPS defenders; and the
minutes model scaled a premium attacker to 60.8 expected minutes, cutting his attacking output by a
third.

This ticket does not change the model. **It measures it**, so the next decision is made from a
number instead of an argument.

## Scope

**In scope:**

- **`scripts/calibration-report.ts`** — a read-only job that:
  1. Reconstructs **actual** FPL points for every player-match in `player_match_stats` (2025/26),
     using `src/lib/scoring/` and nothing else.
  2. Computes actual mean points per appearance, and per 90 minutes, **by position**.
  3. Computes the model's mean projected points per 90, by position, from `player_projections`.
  4. Reports both, side by side, with a ratio and the player counts behind each figure.
- A breakdown by **point component** — appearance, goals, assists, clean sheets, goals conceded,
  saves, defensive contribution — actual versus projected, so a discrepancy is attributable rather
  than just visible.
- A markdown report written to a file and uploaded as a workflow artifact.
- The headline figures written into `job_runs.details`.
- A `workflow_dispatch` step so it can be re-run on demand after any model change.
- Vitest tests for the pure reconstruction and aggregation helpers.

**Explicitly out of scope:**

- **No change to the projection model.** Nothing under `src/lib/projection/` is edited. This ticket
  measures; a later ticket fixes, if the numbers say a fix is needed.
- **No change to `scripts/project-points.ts`, `scripts/emit-projections-csv.ts`,
  `scripts/build-solver-input.ts` or `scripts/store-solver-output.ts`.**
- **No point-in-time backtest.** This is a calibration check — does the model's output sit in the
  right range compared with what actually happened last season — **not** a lookahead-free
  replay of past gameweeks. That is feature item 29 and it is described there as the single largest
  item on the list. Do not start it here.
- **No new database table, no migration, nothing under `supabase/`.** The report is an artifact and
  a `job_runs` row.
- **No writes to Supabase other than the single `job_runs` row.**
- **No UI, no route, no component.** Nothing under `src/` changes at all.
- **No recommendation, no solver, no Telegram.**
- No new npm dependency.

## Definition of done

**Build**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean.
- [ ] No new entry in `package.json`.
- [ ] Nothing under `src/` is added, changed or deleted.

**Reconstructing actual points**

- [ ] Actual per-match points are computed by calling `totalMatchPoints` from `src/lib/scoring/`,
      with the defensive-contribution and goalkeeper-save components supplied by that module's own
      functions. **No scoring rule is reimplemented in this script.** Verifiable by search.
- [ ] Appearance points use the real rule: 1 for 1–59 minutes, 2 for 60 or more, 0 for zero minutes.
      A player-match with zero minutes is **excluded from per-appearance means** and there is a
      named test for it.
- [ ] A clean sheet is `goals_conceded = 0` **and** `minutes_played >= 60`, and applies only to
      goalkeepers and defenders at 4 points and midfielders at 1. There is a named test per position.
- [ ] Position comes from `players.element_type`, joined **on `player_match_stats.player_code =
      players.code`**, never on `player_id = id`. Verifiable by search.
- [ ] **Bonus points and cards are reported as zero and the report says so explicitly**, because
      `player_match_stats` carries neither. The report states, in words, that the actual figures are
      therefore an **under**-count and by roughly how much bonus is worth per match on average. A
      comparison that silently omits a term present in one side and not the other is worse than no
      comparison.
- [ ] The projected side is compared on the **same basis** — the model does not project bonus or
      cards either, so the two are like for like. The report states this rather than leaving it to be
      inferred.

**The report**

- [ ] The report gives, for each of the four positions: actual mean points per appearance, actual
      mean per 90, projected mean per 90, the ratio of projected to actual, and the number of
      player-matches and players behind each figure.
- [ ] The report gives the same comparison **per point component**, so a gap can be attributed to
      clean sheets, or to defensive contribution, or to goals, rather than just observed in total.
- [ ] The report explicitly answers the question that prompted it: **are defenders projected above
      forwards and midfielders, and were they above them in actuality?** One sentence, stating the
      two numbers.
- [ ] Every figure in the report carries its sample size. A mean over eleven player-matches is not
      presented the same way as one over eleven thousand.
- [ ] The report names, at the top, the three reasons the comparison is imperfect: it compares last
      season's actuals against this season's projections; 2025/26 was played under the previous BPS
      rules; and neither side includes bonus. **It is directional evidence, not a verdict.**
- [ ] The report is written to a path from an environment variable with a stated default, uploaded
      as a named workflow artifact, and the headline per-position ratios are in `job_runs.details`.
- [ ] `job_name` is `'calibration-report'`, one row per execution, never upserted.

**Robustness**

- [ ] The job reads exactly `SUPABASE_URL` and `SUPABASE_SECRET_KEY`. No `VITE_`-prefixed variable.
- [ ] **Every Supabase read uses the shared pagination helper** and asserts its row count against an
      independent count query. `player_match_stats` holds over 15,000 rows; an unpaginated read
      would silently return 1,000 and produce a confident, wrong report. *(This is the exact bug the
      row-cap fix ticket was filed for — do not reintroduce it in a new file.)*
- [ ] The job issues no Supabase row-removal call and writes to no table but `job_runs`.
- [ ] An empty `player_match_stats` or `player_projections` exits **zero** with a named message and
      writes no report, rather than producing a report full of zeroes.
- [ ] Scope constraint: only `scripts/calibration-report.ts`, its test file, a new
      `.github/workflows/calibration-report.yml`, and this ticket's own
      `decisions/ticket-<number>.md` are added or changed. **Plus any build-configuration file an
      instructed import genuinely requires, logged as a decision** — this job imports from
      `src/lib/scoring/`. Nothing under `src/`, `supabase/` changes; no existing workflow file
      changes; `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **A new workflow file, not a step in an existing one.** Two other tickets in this batch own
  `.github/workflows/solver-run.yml` and `src/`. A separate file cannot collide — the same reasoning
  as `decisions/ticket-29.md`, and the collision `deltas.md` D7 describes.
- **This is a measurement ticket and its output is allowed to say "the model is fine."** Do not
  tune anything to make a number look better. If defenders come out ahead in both the actual and
  the projected columns, that is the finding, and it is a good one — it would mean the 2026/27
  defensive-contribution rules really have changed the game and the model is tracking it.
- **Do not attempt a point-in-time backtest.** The temptation will be strong, because "compare the
  projection to what actually happened *for that player, that week*" is obviously better. It is also
  invalid without lookahead-free feature reconstruction — the model's inputs for a GW12 projection
  must be built only from data available before GW12, and nothing in this repo does that yet. A
  naive per-match comparison would use a full season of hindsight to project a match inside that
  season, which produces a flattering, meaningless number. Feature item 29 exists for this.
- **Compare distributions, not just means.** A mean can match while the spread is wrong, and it is
  the top of the distribution that drives every recommendation — the captain is by definition the
  highest-projected player. If it is cheap, report the top-20 projected players by position
  alongside the top-20 actual scorers by position. That single table is likely to be the most useful
  thing in the report.
- **`player_match_stats` covers 2025/26 and the projections are for 2026/27.** They are different
  seasons and mostly different players. That is fine for a *distributional* comparison — the
  question is whether a defender scores about five points a game and a forward about four, not
  whether a specific player matches. Say so in the report.
- **The known gaps are already written down.** Read `docs/projection-model-backlog.md` first. G1
  (goalkeeper saves do not scale with fixture difficulty), G2 (45% of players have no history), G3
  (bonus is not modelled) and G6 (last season's behaviour under this season's rules) all bear on
  this. **If the report confirms or refutes any of them, that belongs in the report** — but update
  the backlog file only if the ticket's scope constraint lists it. It does not. Put the finding in
  the report and in `decisions/ticket-<number>.md`, and Keshav will fold it into the backlog. *(See
  `deltas.md` D10 — a Notes instruction that names a file the scope list omits is a contradiction,
  and this ticket is deliberately not repeating it.)*
- **What a substitute cannot catch.** Pure tests prove the reconstruction arithmetic against fixed
  fixtures. They cannot prove the report's conclusion is right, because that depends on real data —
  and they cannot prove the paginated reads returned everything, which is why the count assertion is
  a definition-of-done item rather than a nicety. The report itself is the deliverable and reading
  it is Keshav's job.
