# Ticket #183 — Measure ranking over five gameweeks with baselines and a quality oracle

## HIGH-IMPACT

- **Introduced the five-gameweek ranking metric, additive alongside the untouched
  single-gameweek section.** Because: `docs/model-review-2026-09-02.md` established the
  five-gameweek horizon as the one the solver actually optimises (`decay_base`, `ft_value_list`
  in `scripts/build-solver-input.ts`), while the existing single-gameweek Spearman (0.323) sits
  within ~0.01 of its own oracle ceiling (0.332) — there is almost no headroom left to measure
  there. The five-gameweek gap against its oracle (0.425 vs 0.485, gap 0.060) is where the
  project's remaining work actually has room to show improvement. This ticket is Tier 2 per its
  own text ("it introduces the metric this project's remaining work will be judged on"). The
  single-gameweek metric is now known to be near its ceiling and should no longer be read as
  the primary accuracy number — the five-gameweek section is.
- **Truncated end-of-season windows are excluded, not shortened**, per
  `docs/model-review-2026-09-02.md`'s R2 recommendation ("gameweek ≤ 34" for a full season).
  Because: mixing five-gameweek and shorter-window sums into one reported figure would not be
  measuring the same thing for every row, which would corrupt the season-aggregate Spearman
  silently. `lastGameweekInData` is computed from the actual fetched `feature_history` rows
  (not hardcoded to 38), so the rule stays correct against a partial-season read too.

## ROUTINE

- Oracle "match" definition: a player's oracle rate is points-per-`player_match_stats`-row
  outside the target window (mirroring `prior_matches`' own definition — any resolvable PL row
  counts, not gated on minutes played), for consistency with the rest of the file's existing
  conventions.
- Per-leg `team_goals_conceded`-unknown handling: extended the existing single-gameweek hard
  exclusion (rather than defaulting to 0 conceded, which would bias toward false clean sheets)
  to apply per window leg — a five-gameweek window is excluded if any of its five legs hits
  this ~2% data gap.
- Baseline value reuse, not recomputation: per the ticket's own text ("the same prior quantity
  ranked against the five-gameweek actual total"), each row's `baselineMinutesPerMatch`/
  `baselineXgXaPerMatch` is taken from the starting gameweek only, never recomputed or averaged
  across the window.
- No new sanity-bound gating for the five-gameweek numbers, extending the ticket's explicit "no
  sanity bound derived from the oracle" instruction to the model/baseline figures too — this
  section is purely additive to the report; job success/failure logic is unchanged.
- Four existing declarations (`ReportData`, `generateReportMarkdown`, `ActualSourceRow`,
  `toActualMatchStatsInput`) made exported, visibility-only, so the new tests could exercise
  them directly and reproduce the byte-identical-report check against the pre-ticket code —
  confirmed via diff to carry no behavioral change.

## Note

Two other tickets landed in this same batch: #181 adds `feature_history.prior_recent_minutes`
(not read by this ticket — explicitly out of scope, its consumer is the next batch); #182 damps
`src/lib/projection/fixture.ts`'s attacking multiplier. Neither touches
`scripts/run-backtest.ts`. **The first backtest report run after all three land will reflect
all three tickets together — the five-gameweek numbers this ticket introduces are not
individually attributable to this ticket alone from that first run.**
