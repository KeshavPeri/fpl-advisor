## Context

**The solver chain has been dead since the gameweek rolled over, and the cause is a timing gap in
`scripts/sync-squad.ts` that recurs every single gameweek.**

Observed on the `Solver run` of 23 August 2026:

```
build-solver-input: failed: squad_picks has 0 row(s) for gameweek 2, expected exactly 15.
The registered squad is incomplete — re-check it before solving.
```

### The mechanism

`scripts/sync-squad.ts` targets the **next** gameweek — the one whose deadline has not yet passed
(`const targetGameweek = nextGameweek ?? gwRows[gwRows.length - 1]`) — and fetches
`entry/{id}/event/{target}/picks/`. **FPL publishes a gameweek's picks only after that gameweek's
deadline has passed**, so for the next gameweek that endpoint returns 404. The job handles it
correctly and gracefully: it logs `picks_not_published`, syncs the entry-level state, and leaves
`squad_picks` untouched.

**The result is that the job never targets a gameweek at a moment when its picks are fetchable.**
Before gameweek N's deadline, N's picks do not exist. After it, the job has already moved on to
N+1. Gameweek 1 only had picks because they were entered by hand (#13).

**This is not a one-off.** It repeats at every gameweek boundary, permanently, and it takes the
whole chain down with it: no `squad_picks` → `build-solver-input` fails → no solve, no
recommendation, no notification.

### Why the fix is a carry-forward, and why it is not a Tier 1 problem

**Your squad going into gameweek N is your gameweek N−1 squad, until you transfer.**
`entry/{id}/event/{N-1}/picks/` returns exactly that, and it is one of the three public,
unauthenticated endpoints this job already calls. **No new endpoint, no credential, no
authenticated `my-team/` call** — the Tier 1 boundary described at the top of `sync-squad.ts` does
not move by one inch.

Transfers made between deadlines are not visible to any unauthenticated endpoint. That is a known
and accepted limitation, covered by override registration (item 20, merged) — **the carried-forward
squad is the last known true squad, which is the honest best answer, not a guess.**

Depends on item 7 (merged, #14). Nothing unmerged.

## Scope

**In scope:**

- **In `scripts/sync-squad.ts`, when the target gameweek's `picks/` returns 404, fall back** to the
  most recent gameweek before it whose `picks/` returns 200, and write those 15 picks as the target
  gameweek's `squad_picks`.
- **The fallback search is bounded** to at most the 3 gameweeks immediately preceding the target,
  walking backwards from nearest to furthest and stopping at the first 200. Anything older than that
  is not a squad worth carrying forward.
- **If no gameweek in that window returns 200**, behaviour is unchanged from today: log the reason,
  sync entry-level state, leave `squad_picks` untouched, exit zero. **That is the genuine pre-season
  state** and manual entry (#13) is the correct answer to it — do not turn it into a failure.
- **The existing reconcile-do-not-overwrite rule governs the write**, exactly as it does for a
  same-gameweek sync: if `squad_picks` already exist for the target gameweek — from manual entry or
  an earlier run — **they are not overwritten**; a difference is recorded and surfaced. Read that
  code path and reuse it rather than adding a second one.
- **`job_runs.details` records the provenance**: `picksSourceGameweekId` (which gameweek the picks
  actually came from), `picksCarriedForward` (boolean), and the number of gameweeks looked back.
  A carried-forward squad must be distinguishable from a directly-synced one by reading the job row
  alone.
- **The job's `job_runs.message` says in words** that the squad was carried forward from gameweek N,
  rather than reporting a normal sync.

**Explicitly out of scope:**

- **No authenticated FPL endpoint, no credential, no `my-team/`, not behind a flag.** The file
  header states this is a Tier 1 boundary; this ticket does not go near it.
- **No change to `scripts/build-solver-input.ts`.** Its error was correct and useful — it named the
  exact problem. The squad is what was missing, not the check.
- **No migration, nothing under `supabase/`.** `squad_picks` already has the right shape and grants.
- **No inference of transfers made since the source gameweek.** Not knowable without
  authentication. The carried-forward squad is the last confirmed one and the job must not pretend
  otherwise.
- **No change to which gameweek the job targets.** Targeting the next gameweek is correct; only the
  picks source changes.
- **No UI, nothing under `src/`.**

## Definition of done

- [ ] With the target gameweek's `picks/` returning 404 and gameweek N−1's returning 200, the job
      writes 15 `squad_picks` rows for the **target** gameweek, sourced from N−1. Named unit test.
- [ ] With the target's `picks/` returning 200, behaviour is byte-for-byte what it is today — the
      fallback never runs. Named unit test.
- [ ] With every gameweek in the look-back window returning 404, no `squad_picks` are written, the
      job exits zero, and the message says picks are not published. Named unit test.
- [ ] The look-back stops at the first 200 and never searches more than 3 gameweeks back. Named
      test asserting the number of `picks/` calls made.
- [ ] Picks already stored for the target gameweek are **not** overwritten by a carry-forward; the
      difference is recorded and surfaced, using the existing reconcile path. Named test.
- [ ] `job_runs.details` carries `picksSourceGameweekId`, `picksCarriedForward` and the look-back
      count, and `job_runs.message` names the source gameweek when a carry-forward happened.
- [ ] **Tier 1 guard, grep-checkable:** the strings `my-team`, `login`, `cookie` and `Authorization`
      appear nowhere in this ticket's diff, and the job still calls exactly the three public
      endpoints named in the file header.
- [ ] Any non-404, non-200 HTTP status from a look-back `picks/` call is treated as an error, not as
      "not published" — a 500 must not be silently read as an empty gameweek. Named test.
- [ ] Nothing under `src/`, `supabase/` or `.github/` is added, changed or deleted. Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** every test mocks the FPL API, so nothing here proves the
      live endpoint returns what this code expects for a completed gameweek. The human check after
      merge is: dispatch `Scheduled jobs`, confirm `sync-squad` reports a carry-forward from
      gameweek 1 with 15 picks written for gameweek 2; then dispatch `Solver run` and confirm it
      produces a `solver_runs` row for gameweek 2; then re-run `Preflight check`.

## Notes for the Analyst / Builder

**The one-sentence rule this ticket encodes, as its *because*.** A manager's squad does not change
between deadlines except by a transfer he makes himself — **so the last published squad is the
current squad**, and carrying it forward is a statement of fact rather than an estimate. If a
Builder hits a case this rule does not obviously cover, reason from that sentence.

**Why bounded at 3 gameweeks and not unbounded.** Each look-back is an HTTP call, and a squad more
than three gameweeks stale is not a squad anyone should be solving against — at that point the
honest answer is that we do not know the squad. The bound is a guard against a long silent scan,
not a tuning parameter.

**Do not confuse "not published" with "no squad".** A 404 from `picks/` for a future gameweek is the
normal, expected state and always will be. The failure this ticket fixes is the absence of a
fallback, not the 404 itself.

**Read the reconcile path before writing anything.** `sync-squad.ts` already implements
"reconcile, do not overwrite" for the same-gameweek case, with its own *because* in the file header.
A carried-forward squad must go through that same path — a second, subtly different write path is
how two notions of the truth get into one table.

**This is Tier 3.** It changes which public endpoint the job reads picks from when the primary one
is unavailable. It stores no new kind of data, changes no schema, and touches no credential.

**Two other tickets may be running in this batch.** Both are UI-only, under `src/`. This ticket
touches nothing under `src/` at all.

## Scope constraint

Nothing outside the following files changes:

- `scripts/sync-squad.ts`, `scripts/sync-squad.test.ts`
- `decisions/ticket-<this issue number>.md`

No migration file is added. No workflow file is touched. Nothing under `src/` or `supabase/`
changes. `scripts/build-solver-input.ts` is not modified.
