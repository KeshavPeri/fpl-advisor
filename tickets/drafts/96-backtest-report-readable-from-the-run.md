## Context

Ticket #193's falsification numbers were produced correctly by the Backtest workflow and then
became unreachable. They existed only inside `backtest-report.md`, uploaded as a workflow
artifact, and GitHub redirects artifact downloads to Azure blob storage
(`productionresultssa0.blob.core.windows.net`), which no agent session's egress allowlist reaches.
The ticket blocked overnight on reading one number out of a run that had already succeeded.

Every agent in this pipeline can read `api.github.com`. None can read an artifact. The evidence
has to live where the reader is.

There is a second, related problem. The Backtest job exits non-zero on any failed bound, so a
single known failure — currently the one-gameweek oracle-ceiling check — makes every run red
regardless of what the branch under test changed. A passing ticket and a failing ticket produce
the same signal.

## Scope

**In scope:**

- A new script that reads the generated `backtest-report.md` and emits its headline figures as
  plain key/value lines: the one- and five-gameweek model Spearman, the one- and five-gameweek
  oracle Spearman, the measured populations, the season MAE and mean signed error, and each of
  the five-gameweek leg counters (legs from the schedule, blank-gameweek legs, legs where the
  club played and the player did not).
- A workflow step writing those lines to `$GITHUB_STEP_SUMMARY`, so they are readable from the
  run page and from `api.github.com` with no download.
- The same lines posted as a pull-request comment when the workflow runs on a PR.
- **The per-check verdict published alongside them**: which named sanity bounds, ranking bounds
  and oracle-ceiling checks passed and which failed, by name. A reader must be able to tell "only
  the known one-gameweek check failed" from the run page alone.
- The report artifact upload stays exactly as it is. This adds a second, reachable channel; it
  does not replace the first.

**Explicitly out of scope:**

- **No ticket-specific thresholds in the workflow.** A threshold that belongs to one ticket's
  falsification check is wrong the moment that ticket merges. The workflow publishes figures and
  the standing bounds' own verdicts; a ticket's own thresholds stay in the ticket and are read by
  a human. See Notes.
- **No `continue-on-error`, and no change to any bound.** The job still exits non-zero when a
  bound fails, and `checkOracleCeiling` is not relaxed, split out, exempted or made non-blocking.
  Publishing the per-check verdict is what solves the signal problem; suppressing a red run is
  not.
- No change to any figure `scripts/run-backtest.ts` computes, to any exclusion, to the report's
  own markdown, or to anything under `src/`.
- No migration, no schema change, no new Supabase read.
- No change to any other workflow file.

## Definition of done

- [ ] The new script is pure text-in / text-out over a report file, with named tests over a
      committed fixture report covering: every figure present; a figure missing from the report
      (must fail loudly, never emit a silent zero or blank); and a report from a run that failed
      a bound.
- [ ] Running the script against a committed copy of backtest report 10 emits the three #193
      figures exactly: legs where the club played and the player did not = **6836**, five-gameweek
      model Spearman = **0.397**, five-gameweek oracle Spearman = **0.506**. Any other values mean
      the parser is wrong.
- [ ] The workflow writes those lines to `$GITHUB_STEP_SUMMARY` on every run, and the step runs
      `if: always()` so a failed bound still publishes its numbers.
- [ ] On a pull request, the same content is posted as a PR comment.
- [ ] The published block names every check and whether it passed, not just the overall result.
- [ ] `npm run build`, `npm run lint` and `npm run typecheck` exit 0.
- [ ] Scope constraint: `.github/workflows/backtest.yml`, one new script under `scripts/`, its
      test file, its fixture report, and this ticket's own `decisions/ticket-<issue>.md`. Nothing
      else — in particular `scripts/run-backtest.ts` does not change.

## The human check after merge, and why it cannot be in the definition of done

A workflow cannot be dispatched from inside an overnight run, and a changed workflow file only
takes effect once it is reachable on the ref being dispatched. So the Builder can prove the parser
against the committed fixture and nothing more.

The post-merge check is Keshav's:

```
cd ~/Projects/fpl-advisor && gh workflow run "Backtest" && sleep 20 && gh run list --workflow="Backtest" --limit 1
```

Then open the run page and confirm the three figures and the per-check verdicts are all readable
there, with nothing downloaded.

## Notes for the Analyst / Builder

- The parser must fail loudly on a figure it cannot find. A parser that silently emits a blank is
  worse than no parser at all: it produces a confident, readable, wrong summary, which is exactly
  the failure class `LEARNINGS-second-build-wave.md` §3 is about.
- Suitable for a single interactive Sonnet session rather than an overnight slot if the queue is
  full: it is bounded, mechanical, and touches no model logic.
- Read the five-gameweek section's own headings before writing the parser. Match on the report's
  literal heading text rather than on line offsets, so a new section added later does not silently
  shift what gets picked up.
