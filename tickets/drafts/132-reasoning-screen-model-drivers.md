## Why

Once `gbm-v1` makes the recommendations (after tonight's nightly-job ticket and one owner switch),
the reasoning screen would still only show `baseline-v1`'s component table, which would no longer be
what decided the pick. This ticket shows, for each named player, **which model decided and the top
three reasons in plain words**, and keeps the `baseline-v1` breakdown underneath as the explainer.

## Build

- `src/lib/reasoning/api.ts` — the `player_projections` read (around line 290) currently filters to
  `baseline-v1` (ticket #260). Read both `baseline-v1` and `gbm-v1` for the named players (still
  bounded by `playerIds`, at most 4 players × 2 rows) and keep them apart by `model_version`.
- `src/lib/reasoning/types.ts` — add an optional learned-model block to `PlayerProjectionData`:
  `learned?: { modelVersion: string; expectedPoints: number; drivers: { feature: string;
  value: number | null; contribution: number }[] }`. Keep the existing `points` breakdown field as
  the `baseline-v1` one.
- `src/lib/reasoning/derive.ts` — a pure `describeDriver(feature)` that turns a feature name into
  plain words. The names are generated, so map the pattern, not a list:
  - `r{k}_{stat}` → "{stat} over the last {k} games" (k = 1 → "last game").
  - `p90_{k}_{stat}` → "{stat} per 90 minutes, last {k} games".
  - `own_pct_rank` → "popular with managers"; `transfers_rank` → "being transferred in";
    `value` → "price"; `was_home` → "playing at home"; `nfix` → "number of fixtures";
    `sd_minutes` / `sd_apps` → "minutes / appearances this season"; `rows_hist` → "games of history";
    `t_gf_{k}`, `t_ga_{k}`, `ot_gf_{k}`, `ot_ga_{k}` → "team / opponent goals scored / conceded,
    last {k}"; `lambda_for` → "expected team goals this fixture"; `lambda_against` → "expected goals
    against"; `p_win` → "chance of winning"; `p_cs` → "clean-sheet chance".
  - Stat words: minutes, points (`total_points`), goals, assists, expected goals, expected assists,
    bonus points system (`bps`), bonus, ICT index, threat, creativity, saves, clean sheets, goals
    conceded, starts, defensive contributions, expected goals conceded, 60+ minute games (`m60`),
    appearances (`app`).
  - An unknown name returns `null` and is not shown — never a raw feature name.
  - Direction word from the sign of `contribution`: "pushes up" / "pulls down".
- `src/screens/ReasoningScreen.tsx` + `.css` — per named player, when a `gbm-v1` row exists: a line
  "Decided by gbm-v1 · {expected points, 1 dp}" and the top three described drivers. Below it, the
  existing component table, now headed "Breakdown (explainable model)". When there is no `gbm-v1`
  row, the screen looks exactly as today. Match existing components and tokens; no new visual
  direction (CLAUDE.md design-pass rule). Numbers are fine on this screen only (brief §8).
- `feature-list.md` — item 31: note the reasoning screen now names the deciding model.

No change to the home screen.

## Definition of done — offline only

- `npm run build`, `npm run lint`, `npm test` clean.
- `derive.test.ts` covers: every name in `model/fpl_model/features.py`'s `FEATURES` gets a
  non-null description (copy the list into the test as a fixture); the four odds names too;
  an unknown name is `null`; a player with both rows; a player with only `baseline-v1` renders the
  same data as today.

## Post-merge owner check (does not block this PR)

After the model switch, open the reasoning screen on the phone and check the lines read sensibly.
**Not a gate.**

## Files

Edit: `src/lib/reasoning/api.ts`, `src/lib/reasoning/types.ts`, `src/lib/reasoning/derive.ts`,
`src/lib/reasoning/derive.test.ts`, `src/screens/ReasoningScreen.tsx`,
`src/screens/ReasoningScreen.css`, `feature-list.md`. Nothing under `model/`, `scripts/` or
`.github/`.
