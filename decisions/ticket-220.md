# Ticket #220 — Close out the model programme

## HIGH-IMPACT

- **Left the four-split learned-v1 margin table incomplete for Defender and Forward, rather than
  inventing figures to fill it in.** Chose transparency over completeness because the ticket's own
  source text only actually states Goalkeeper's worst losing margin (0.193) and Midfielder's four
  individual win margins (+0.001, +0.005, +0.005, +0.024 — which average to the "mean edge near
  0.009" the same paragraph cites, confirming that reading) — Defender and Forward are given only
  as win/loss counts (2/4 and 0/4), never as per-split margins, anywhere in this repo (checked
  against ticket #216's own merge commit and the backlog's G17 entry, which itself records the
  gate as "NOT YET READ" at merge time — the fuller live figures were never committed anywhere
  accessible). Inventing DEF/FWD margins to satisfy the DoD's "verbatim" wording would repeat the
  exact failure this ticket exists to prevent — asserting a number nobody measured.

- **Recorded the window/season-mean shrinkage diagnostic as an open question, and added a second,
  formula-derived candidate explanation without adjudicating between them.** Because this Builder
  session has no live Supabase project (the same limitation recorded for G9/G11/G16/G17), the
  actual distribution could not be read. Rather than stop at "cannot measure," the Builder derived
  from the existing code that `estimateMinutes`'s shrinkage weight on the season figure is capped
  at `SHRINKAGE_K/(windowLength+SHRINKAGE_K) = 3/8 = 0.375` for a full 5-match window — meaning even
  a real window/season gap can only ever be 37.5%-closed, versus the naive baseline's 100%. This is
  logged as HIGH-IMPACT because it reframes the open question (is the gap small, or is the
  correction structurally too weak?) for whoever reads the backlog next, without picking an answer
  the data doesn't yet support.

- **Drafted a process-fix proposal for the unheld #217 falsification gate but did not adopt it.**
  The proposal (block a ticket, not the run, on an "UNCONFIRMED" gate note, or give the orchestrator
  a way to dispatch the one human-triggered Backtest workflow itself and wait on its result) is
  correctly out of this ticket's scope — no workflow change, no pipeline change — and is left as a
  note in the drafted `app-factory` learnings entry (see PR body) for a future pipeline revision to
  weigh, not something this ticket enacts.

## ROUTINE

- Bucket boundaries for the new window/season-minutes-gap histogram (`<5 / 5–10 / 10–20 / 20–40 /
  40+` minutes), matching the existing bucketed-diagnostic style already used elsewhere in
  `scripts/run-backtest.ts`.
- Reused the file's existing `MIN_BUCKET_SAMPLE_SIZE` constant and "too small to read" convention
  for thin buckets, rather than introducing a second threshold.
- Added the new diagnostic as a pushed array entry (mirroring the existing `preTicket191Minutes`
  pattern) rather than extending the `MeasuredRow` interface, to avoid forcing an edit to every
  `MeasuredRow` literal across the test file for a diagnostic that is conceptually separate from
  the file's ranking/error metrics.
