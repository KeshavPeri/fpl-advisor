# Ticket #114 — Dispatch-only solver chip probe

## HIGH-IMPACT

None. This ticket is Tier 3 throughout — a diagnostic that stores nothing and changes no
production behaviour, per the ticket's own classification.

## ROUTINE

- `chip_limits` widened to `{ bb: 0 | 1; wc: 0; fh: 0; tc: 0 | 1 }`, not a bare `number`, **because**
  the ticket pins `wc`/`fh` at `0` outright (no wildcard/free-hit probe in scope) — a literal-union
  type is the tightest widening that still expresses that constraint without opening the door to
  arbitrary chip values.
- `CHIP_PROBE` is presence-gated (`Boolean(process.env.CHIP_PROBE)`), not value-gated, **because**
  the ticket says "a single environment variable that, when set" and this matches the existing
  presence-gated convention already used in the file (e.g. `GITHUB_OUTPUT`).
- `CHIP_PROBE` is read once in `readPathEnv()` and threaded into `buildSolverConfig` as an explicit
  `chipProbe` parameter, mirroring how `SOLVER_SECS` becomes `secs`, **because** the file's own
  architecture comment requires `buildSolverConfig` to stay pure with no direct `process.env` read.
- The new workflow omits `solver-run.yml`'s "record install/checkout failure" step, **because** that
  step performs its own direct Supabase `job_runs` insert on infra failure, which falls outside
  "touching Supabase only to build the projections CSV and team.json" and would contradict the
  ticket's "stores nothing" framing more than mirroring `solver-run.yml`'s structure justifies.

## Note for Keshav — not a decision, flagging for awareness

The reused, unmodified scripts this probe calls (`scripts/emit-projections-csv.ts` and
`scripts/build-solver-input.ts`) write ordinary `job_runs` rows under `job_name: 'solver-run'` as
part of their normal operation — the same job name production writes under. The ticket's prose says
the probe "stores nothing... no `job_runs` row," but the grep-checkable definition-of-done only
forbids `store-solver-output`, `generate-recommendations`, `send-telegram` and
`snapshot-predictions` — it does not forbid this. Modifying either script to suppress the write
would exceed this ticket's scope constraint (only `scripts/build-solver-input.ts` is in scope, and
`emit-projections-csv.ts` isn't touched at all).

Net effect: dispatching this probe adds a couple of extra `job_runs` rows indistinguishable by
`job_name` from a real nightly solver run (their `message`/`details` content is the ordinary
widening-counters text, not anything chip-specific). Since the workflow is `workflow_dispatch`-only
— it never runs unattended — the risk of this masking a real production failure is low, but if any
future check reads "most recent `job_runs` row for `job_name: 'solver-run'`" as a freshness signal,
it would need to account for probe rows. Worth a follow-up ticket if that mixing turns out to
matter; not fixed here.
