## Why

After run 2, `gbm-v1` will write its own rows into `player_projections` next to `baseline-v1`
(same table, `model_version` in the primary key). Today five scripts each hardcode
`MODEL_VERSION = 'baseline-v1'`, so switching models would mean five code edits. This ticket adds one
config file that decides which model the solver, Telegram and predictions use, with a per-player
fallback. **It changes nothing today:** the config starts on `baseline-v1`.

Unblocks: the owner switch after run 2 (`docs/model-diagnosis-2026-09-24.md` §9.3), which is a
one-line edit to the config file.

## Build

- `config/projection-model.json` (new): `{"active": "baseline-v1", "fallback": "baseline-v1"}`.
- `scripts/lib/activeModelVersion.ts` (new): reads that file via
  `new URL('../../config/projection-model.json', import.meta.url)`, checks both fields are non-empty
  strings, throws a clear error if not. Export a pure `parseProjectionModelConfig(text)` for tests.
- Replace the hardcoded `MODEL_VERSION = 'baseline-v1'` in these five scripts with the reader:
  - `emit-projections-csv.ts` — read rows for `active` and `fallback`. For every
    (player, horizon GW) with no `active` row, use the `fallback` row. Put the merge in a pure
    exported function. Record `activeModel`, `fallbackModel` and `fallbackPairsUsed` in
    `job_runs.details` and print the count. When active = fallback, read once.
  - `snapshot-predictions.ts` — snapshot both `active` and `baseline-v1` (once if equal). The
    `prediction_log` PK already includes `model_version`.
  - `settle-predictions.ts` — settle every `model_version` that has unsettled rows.
  - `send-telegram.ts` — use `active` (it only labels `plan_snapshot`).
  - `preflight-check.ts` — the projections check fails only if neither `active` nor `fallback` has
    rows for the target GW. If `active` is missing but `fallback` has rows, say so in the check's
    message and don't fail (there is no warn status; do not add one).
- `src/lib/reasoning/api.ts` (around line 295) — filter the `player_projections` read to
  `.eq('model_version', 'baseline-v1')`. Today it keeps whichever row came last. That breaks
  as soon as a second version exists, and this screen's component table is `baseline-v1`'s shape.
  Update the comment above it in two lines.
- Leave `project-points.ts` (it *is* baseline-v1), `bonus-validation-report.ts`,
  `penalty-duty-diagnostic.ts` and `calibration-report.ts` on their own hardcoded `baseline-v1`.

Keep new comments short. No essays in source files.

## Definition of done — offline only

- `npm run build`, `npm run lint`, `npm test` clean.
- Tests:
  1. Config parser: valid file passes; missing field or empty string throws.
  2. With the config unchanged, the emitted CSV is byte-identical to today's for a fixture set
     (same players, same horizon, `baseline-v1` rows only).
  3. With active = `gbm-v1` and a gap for one player in one GW, that pair comes from
     `baseline-v1`, every other pair from `gbm-v1`, and `fallbackPairsUsed` = 1.
  4. Snapshot with active = fallback writes one version, not two.
  5. Preflight: active missing and fallback present → not failed, and the message names both.

## Post-merge owner check (does not block this PR)

None needed. The next nightly run behaves exactly as today.

## Files

New: `config/projection-model.json`, `scripts/lib/activeModelVersion.ts`,
`scripts/lib/activeModelVersion.test.ts`. Edit: `scripts/emit-projections-csv.ts` + `.test.ts`,
`scripts/snapshot-predictions.ts` + `.test.ts`, `scripts/settle-predictions.ts` + `.test.ts`,
`scripts/send-telegram.ts` + `.test.ts`, `scripts/preflight-check.ts` + `.test.ts`,
`src/lib/reasoning/api.ts`. Nothing under `model/`, and not `feature-list.md` (ticket 128 owns it
this run).
