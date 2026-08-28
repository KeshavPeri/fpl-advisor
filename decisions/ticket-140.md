# Ticket #140 — Count fixtures per gameweek in the backtest, and diagnose the defensive-contribution gap

## HIGH-IMPACT

- **This ticket changes what the measurement other model work will be judged by actually
  measures.** Before #140, `run-backtest.ts` always projected exactly one fixture per
  `feature_history` row regardless of how many matches a player's team actually played that
  gameweek, while the actual side (correctly) summed every matching `player_match_stats` row —
  so a double gameweek was silently under-projected by construction, not by model error. Because
  every future ticket that reads this harness's headline (the OpenFPL retrain, chip strategy,
  the defcon shrinkage constant) inherits whatever the measurement says, a systematic error in
  the *measurement itself* would have been mistaken for a systematic error in the *model* —
  exactly the failure this backtest exists to prevent (see the file's own "measures the
  projection" framing). Fixing it here, before any of that downstream work reads the harness, is
  the point of doing it now rather than after a model decision has already been made on the
  uncorrected figure.

- **The projected-side fixture count is derived from the actual side's own row count
  (`aggregateActualForGameweek`'s `matchesFound`), not from an independent team-schedule
  source.** Because no such source exists for a *past* season in this schema: the live
  `fixtures` table (`supabase/migrations/20260811100000_reference_schema.sql`) carries no
  `season` column — it is the current season's schedule only — and this ticket's scope
  explicitly forbids any migration or schema change. Deriving the count from the same
  `player_match_stats` rows the actual side already reads keeps the two sides constructed from
  identical evidence by definition, at the cost of a documented approximation: a player rotated
  out of one of his team's two fixtures is still projected for 1, not the team's true 2, because
  this job has no signal of team-level fixture count independent of this player's own
  appearances. Documented in the file header and in `docs/projection-model-backlog.md` G10
  rather than hidden.

- **Blank-gameweek detection (`hadFixture`) infers each player's season-long team from
  `player_match_stats.match_id` text (the modal team-slug across that player's own matches),
  because the alternative — the live `players.team_id` — reflects the *current* (2026/27) squad,
  not the 2025/26 team a backtest row concerns, and would misclassify every player who has since
  transferred, been promoted/relegated with their club, or joined from outside the league.
  Text-parsing `match_id` (already read for the fixture-count decision above) avoids that
  mismatch entirely and needs no new query or schema. Where the inference is unreliable (fewer
  than two parseable matches, a tie) it fails open to today's `didNotFeature` behaviour rather
  than guessing `blankGameweek` — a wrong guess here would misclassify an exclusion reason, not
  corrupt a measured figure, but "unknown" should never present as a confident answer.

## ROUTINE

- `MIN_BUCKET_SAMPLE_SIZE = 50` and the "too small to read" label are a local constant/string in
  `run-backtest.ts` rather than an import of `src/lib/accuracy/derive.ts`'s `MIN_SAMPLE_SIZE` —
  matching this file's own established convention of small, self-contained constants with a
  comment naming the ticket (`MAE_LOWER_BOUND` etc.), not a cross-import into the display layer
  for one shared number. Same threshold and same wording, ticket #123, verified by reading that
  file rather than assumed.
- `projectRow`'s new `fixtureCount` parameter and `classifyRow`'s new `hadFixture` parameter are
  both optional, defaulting to `1` and `true` respectively — every pre-#140 call site (including
  every existing test) is an exact no-op. `buildMeasuredRow`'s new `priorMatches` parameter
  defaults to `0` for the same reason; `fixtureCount` on `MeasuredRow` needed no new parameter at
  all, since it is exactly `actual.matchesFound`, already computed.
- The by-gameweek table's new "Multi-fixture rows" column counts *measured* player-gameweeks
  with `fixtureCount > 1` in that gameweek, not a raw fixture-schedule count — consistent with
  fixture count itself being derived from measured rows (see HIGH-IMPACT above), and cheap for a
  reader to sanity-check against the season's known rearranged fixtures.
- The multi-fixture "moves the headline" check compares mean absolute error specifically (the
  report's own headline figure), not mean signed error — the ticket text's own example
  ("moves the season headline by more than 0.05") reads as the headline MAE.
- `scripts/run-backtest.test.ts`'s shared `measuredRow()` test-data factory gained two new
  defaulted fields (`fixtureCount: 1`, `priorMatches: 0`) so it keeps satisfying the widened
  `MeasuredRow` type. Every existing test's own assertions and inputs are unchanged; only the
  factory's default object grew, which is why the ticket's "every #133 test not concerning
  fixture counts or bucketing passes UNMODIFIED" requirement is met by the test *bodies*, not by
  the file being untouched line-for-line.
- `scripts/run-backtest.test.ts`'s select-string source-invariant test was updated to expect
  `match_id` in the `player_match_stats` select list (needed for fixture-count/blank-gameweek
  work) — the one pre-existing test this ticket's own scope required changing, not left
  unmodified, because the column it asserts on had to grow.
