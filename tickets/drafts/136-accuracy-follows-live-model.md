## Why

Since 25 Sept, `config/projection-model.json` has `"active": "gbm-v1"`. `snapshot-predictions.ts`
(#260) now logs both `gbm-v1` and `baseline-v1` into `prediction_log`. But the Accuracy card picks
whichever version has the **most settled rows** (`src/lib/accuracy/derive.ts`,
`selectCurrentModelVersion`, line ~159). `baseline-v1` has weeks of history, so the card will keep
showing the old model's accuracy long after it stopped making the picks. That misleads Keshav
about the model he's actually using.

## Build

- `tsconfig.app.json`: add `"resolveJsonModule": true`.
- `src/lib/accuracy/derive.ts`: `deriveAccuracyView(rows, activeModelVersion)`. Rule:
  - If the active version has **≥ 3 settled gameweeks**, build the view from it.
  - Otherwise build from the version with the most settled rows (today's rule), and set a new
    `pendingActive: { modelVersion, settledGameweeks }` field on the view.
  - Keep every existing field and behaviour otherwise.
- `src/lib/accuracy/types.ts`: add `pendingActive: { modelVersion: string; settledGameweeks:
  number } | null`.
- `src/lib/accuracy/api.ts` (or its caller): read `active` from `config/projection-model.json`
  via a JSON import (Vite bundles it at build time; a switch commit redeploys) and pass it in.
- `src/components/AccuracyCard.tsx` + `.css`: when `pendingActive` is set, one muted line under
  the model name: "Recommendations now use gbm-v1 — its accuracy shows here after 3 settled
  gameweeks ({n} so far)." No other visual change.

## Definition of done — offline only

- `npm run build`, `npm run lint`, `npm test` clean.
- `derive.test.ts`: active has 0, 2 and 3 settled GWs (the first two fall back and set
  `pendingActive`, the third uses active with `pendingActive` null); active version absent from
  the rows entirely; the existing tests are unchanged and still pass.

## Post-merge owner check (does not block this PR)

None. The line appears on the home screen straight away (gbm-v1 has 0 settled GWs).

## Files

Edit: `tsconfig.app.json`, `src/lib/accuracy/derive.ts`, `src/lib/accuracy/types.ts`,
`src/lib/accuracy/api.ts`, `src/lib/accuracy/derive.test.ts`, `src/components/AccuracyCard.tsx`,
`src/components/AccuracyCard.css`. Nothing else, and not `src/screens/HomeScreen.tsx` (another ticket
edits it tonight).
