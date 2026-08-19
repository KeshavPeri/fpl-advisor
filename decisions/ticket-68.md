# Ticket #68 — Show this gameweek's projected points on the verdict card

## HIGH-IMPACT

- **The card's primary figure changes from `recommendations.net_points_rounded` (a five-gameweek
  solve-horizon total) to a newly-derived sum of `solver_picks.expected_points` over the
  recommendation's own starting XI, captain doubled.** Because the ticket's own diagnosis is
  correct and confirmed against the schema: `expected_points` is the solver's raw per-player xP,
  never multiplier-applied (`scripts/store-solver-output.ts` writes `Number(row.xP)` verbatim, and
  the `solver_picks` migration's own comment says so), so captain doubling has to happen in this
  app's derivation layer, not be trusted from storage. This is a correctness fix, not a relabel —
  the ticket explicitly ruled out the relabel-only fallback unless deriving the real figure proved
  impossible, and it didn't.
- **`recommendations.solution_index` is now selected and joined against `solver_picks` on
  `(gameweek_id, solution_index)`, not `plan_index`.** Because the recommendations migration's own
  comment is explicit that `solution_index` is "the solver's OWN iteration index... kept alongside
  plan_index so the ranked position and the solver's raw index can never be confused for each
  other" — `plan_index` ranks Plan A/B/C by score, `solution_index` is the solver's own key into
  `solver_picks`. Joining on the wrong column would silently pull an unrelated solution's picks.
- **The horizon total (`gross_points_rounded`/`net_points_rounded`) is no longer shown anywhere on
  the card except inside the hit block, and only when a hit is recommended.** Because
  `design-reference.md` allows one dominant number, not two, and the DoD says explicitly: "if both
  can't be shown without competing, show only the gameweek figure and leave the horizon to the
  reasoning screen." With no hit, the horizon total isn't load-bearing for anything currently on
  this card, so it's dropped rather than kept as visual noise; `VerdictView.netPoints` (which
  nothing but this card ever read) is removed accordingly.

## ROUTINE

- Added `hitBasisLabel: string | null` as its own field on `VerdictView`, parallel to `hit`, rather
  than folding a label into `VerdictHit` itself — this keeps the pre-existing
  `{cost, gross, net}` shape (and its pre-existing test) untouched, satisfying the DoD's "no test
  that passed before now fails or was deleted" without weakening coverage of the new copy
  requirement, which gets its own dedicated tests instead.
- `GameweekPick.isLineup` is carried through and re-filtered defensively inside
  `sumGameweekPoints` (`derive.ts`), even though `api.ts`'s query already filters
  `is_lineup = true` at the database layer. Belt-and-suspenders: the arithmetic that matters lives
  in one pure, tested place, so it can't silently trust an unfiltered input if the query's own
  filter is ever loosened or bypassed by a future caller.
- The solver_picks read in `api.ts` is wrapped in its own `try/catch` and never routed through the
  existing `raise()` helper — a missing or failed solver_picks read must fall back to an
  "unavailable" figure per the DoD, not blank the whole card the way `raise()` (via
  `VerdictCard`'s `error` state) would for every other field.
- Primary-figure label reads `"${gameweekName} projected points"` (period first, e.g. "Gameweek 5
  projected points") rather than appending the gameweek name after — this reads unambiguously even
  skimmed quickly, which is the whole point of the fix.
- Hit-block basis copy is the fixed string `"Across the full transfer plan"` — plain FPL-flavoured
  wording rather than the internal term "horizon" (design-reference.md: name things by what Keshav
  controls, never by how the system is built), and doesn't state an exact gameweek count since that
  number isn't part of this card's already-fetched data and pulling it in would mean a second new
  query beyond the one this ticket's DoD calls for.
- Captain-line full-stop fix (`withFullStop`) lives in `derive.ts`, not `VerdictCard.tsx` — same
  pure/impure split as everything else in this module, and it only ever inspects the END of the
  string (`endsWith('.')`), so an internal full stop in a name is never touched.

## ROUTINE (revision round — QA failure: no test asserts on rendered output)

- Extracted the points-figure JSX (the `<div className="verdict-card__points">` block) out of
  `VerdictCard` into its own named export, `VerdictPointsFigure({ label, points })`, still inside
  `VerdictCard.tsx`. Tier 3 (naming/layout convention, not a data-structure or dependency choice).
  Named for exactly what it renders — the card's one primary figure — following this file's own
  "name things by what Keshav controls" convention, and takes only the two fields it actually
  uses rather than the whole `VerdictView`, so its test doesn't have to construct an unrelated
  headline/captain-line/hit fixture just to render a number. This is the only way to get a
  synchronous, renderable "ready" output at all: `VerdictCard` fetches internally via `useEffect`
  and can't be driven into its ready state without a fetch mock, which QA's failure note ruled
  out in favour of testing a presentational subcomponent directly.
- New test file `src/components/VerdictCard.test.ts` renders `VerdictPointsFigure` with
  `react-dom/server`'s `renderToStaticMarkup` (via `React.createElement`, from a plain `.ts` file)
  and asserts the resulting markup contains no `.` for both the numeric and the "Unavailable"
  case — closing the gap QA's failure note identified: `derive.test.ts`'s existing "never renders
  a decimal point" test only ever asserted on `deriveVerdictView`'s return value, never on
  anything React actually renders.
- That test file has to `vi.mock('../lib/supabase.ts', ...)` before importing `VerdictCard.tsx`.
  Because `VerdictCard.tsx` also imports `fetchVerdict` from `../lib/verdict/api.ts`, which
  imports the real Supabase client, and `src/lib/supabase.ts` calls
  `createClient(supabaseUrl ?? '', supabasePublishableKey ?? '')` — the empty-string fallback
  throws at module-evaluation time under `vitest run`, where neither env var is set. No test file
  existed before this one that imported anything on that chain, so nothing had hit this
  pre-existing landmine yet; `VerdictPointsFigure` never calls `fetchVerdict`, so stubbing the
  client out (rather than touching `supabase.ts`, which is out of this ticket's scope) is correct
  and doesn't weaken what the test verifies.
