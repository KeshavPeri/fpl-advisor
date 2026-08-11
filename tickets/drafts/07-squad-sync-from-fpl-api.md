## Context

Feature-list item 7. Depends on the FPL API ingest job (#11) and the squad state schema and
manual entry screen (#13).

Once a gameweek deadline passes, Keshav's true squad is readable from the public FPL API, and the
app should stop relying on what he typed in by hand. `product-brief.md` §2 makes squad state owned
by the app and read "from the public FPL API after each deadline". This ticket closes that loop —
and it is the ticket where the temptation to log in to FPL is strongest, so its boundaries matter
more than most.

## Scope

**In scope:**

- `scripts/sync-squad.ts`: read `entry/{id}/` for bank, squad value, transfer count, chips used,
  overall points and rank; read `entry/{id}/event/{gw}/picks/` for the squad itself.
- Reconcile against stored squad state and **report** differences rather than silently overwriting
  manual entry.
- Configuration for the FPL entry id — `FPL_ENTRY_ID` for the job, `VITE_FPL_ENTRY_ID` for the
  browser — never a hardcoded value.
- Correct behaviour when picks are not yet published (see the DoD — this is the normal state until
  22 August 2026).
- A visible last-successful-sync timestamp, and squad state marked stale when the sync fails.
- A `job_runs` row per execution.
- A step added to `.github/workflows/scheduled-jobs.yml`.

**Explicitly out of scope:**

- **`my-team/{id}/` is never called. No login, no cookie, no session, no stored FPL credential —
  not now and not behind a flag.** This is a Tier 1 stop and it is the single reason the whole app
  needs no credentials (`product-brief.md` §6a). The one thing that endpoint provides — the
  in-progress squad between deadlines — is covered by override registration, which is item 20 and
  not this ticket.
- No writing anything back to FPL. The app advises and records; it never acts on his FPL account
  (`product-brief.md` §3).
- No override-registration UI and no friction/confirm step — item 20.
- No recommendation, no solver, no projected points.
- No mini-league standings ingest.
- No new personal-data category. Entry id, picks, bank, squad value, transfers, chips and rank are
  all pre-approved by `product-brief.md` §5.
- No pitch view.

## Definition of done

- [ ] `npm run build` passes clean.
- [ ] `npm run lint` passes clean.
- [ ] With `FPL_ENTRY_ID` set to a real entry, `npx tsx scripts/sync-squad.ts` fetches `entry/{id}/`
      and stores bank, squad value, total transfers, chips used, overall points and overall rank.
- [ ] **When `entry/{id}/event/{gw}/picks/` returns 404, the script exits ZERO, changes no stored
      pick, and records "picks not yet published" in its `job_runs` row.** This is the normal state
      today: the GW1 deadline is `2026-08-21T17:30:00Z` and no picks exist for any manager until it
      passes, so between now and 22 August this job will hit that 404 on every single run. It must
      not fail, and it must not wipe the manually-entered squad.
- [ ] When picks **are** available and match stored state, the sync marks the squad as confirmed
      against the API and updates the last-sync timestamp.
- [ ] When picks are available and **differ** from stored state, the difference is recorded and
      surfaced, and the stored squad is not silently overwritten.
- [ ] With `FPL_ENTRY_ID` unset, the script exits zero with a message naming the variable, and makes
      no request. It never guesses an entry id.
- [ ] No entry id literal appears anywhere in `scripts/` or `src/`.
- [ ] The strings `my-team`, `Cookie`, `pl_profile`, `Authorization`, `password` and `login` appear
      nowhere in `scripts/` or `src/`.
- [ ] On a failed sync, the app shows the last successful sync timestamp and marks the squad stale.
      It never presents stale state as current (`product-brief.md` §6a).
- [ ] The only remote host referenced is `fantasy.premierleague.com`.
- [ ] The workflow still parses as valid YAML.
- [ ] Scope constraint: changes limited to `scripts/`, `src/`, `supabase/migrations/` (only if a
      sync-metadata column is genuinely needed) and `.github/workflows/scheduled-jobs.yml`.

## Notes for the Analyst / Builder

- **The 404 item is the one most likely to be marked verified from reading code.** It is directly
  testable today: point the script at any real entry id and gameweek 1 and observe the 404 path end
  to end. Report what you actually ran.
- **The entry id is a public identifier and storing it is explicitly not Tier 1** —
  `product-brief.md` §5 pre-approves it by name. Do not block on it.
- Keshav's 2026/27 entry id is listed in the Part 1 handover as owner setup. If it has not been
  provided by the time this ticket runs, the correct behaviour is the "unset" path in the DoD: exit
  zero with a named message. Do not block the ticket on a missing id, and do not substitute a
  placeholder id from anywhere.
- `entry/{id}/` was confirmed unauthenticated during the Part 1 workshop on 10 Aug 2026 — it exposes
  squad value, bank, transfer count, rank and league membership with no login.
  `bootstrap-static/` was re-confirmed live on 11 Aug 2026.
- **Reconcile, do not overwrite.** Manual entry and an API sync are two sources of truth for the
  same thing, and the whole reason `product-brief.md` records overrides with deliberate friction is
  that the difference between what the model expected and what actually happened is the data the
  accuracy tracker later depends on. A sync that silently clobbers manual state destroys that.
- Chips used come back from `entry/{id}/history/`. Storing which chips are gone is in scope here as
  raw state; chip *strategy* is wave 7 and is not.
- Everything monetary here is in-game and therefore **Tier 3** (`product-brief.md` §4).
- `fantasy.premierleague.com` is on the run environment's allowlist, so the live paths above are
  testable from your session.
