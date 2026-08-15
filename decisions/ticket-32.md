# Decisions — ticket #32

## HIGH-IMPACT

- None. The ticket's own "Notes (pre-answered)" section already settles the one decision that
  would otherwise be Tier 2 (team identity belongs to `scripts/ingest-fpl.ts`; this job writes
  `elo` and nothing else, matched on `code`) — nothing new to escalate or log here.

## ROUTINE

- **Narrowed `TEAMS_REQUIRED_COLUMNS` to `['code', 'elo']`**, down from
  `['code', 'id', 'name', 'short_name', 'elo']`. The job no longer reads `id`/`name`/`short_name`
  off the CSV at all (team identity is `ingest-fpl.ts`'s job now), so requiring their presence
  would be a stale guard against columns nothing downstream depends on. `code` and `elo` — the
  only two columns this job touches — remain required, and the job still fails loudly, naming the
  file, if either is missing (DoD item preserved).
- **`duplicateCodeConflicts` counts the number of *codes* that resolve to more than one
  `public.teams` row, not the number of rows involved.** E.g. two rows sharing one code count as
  1 conflict, not 2. Matches how `codesNotInTeams` and `teamsCodesNotInCsv` are already framed as
  "how many distinct problems", and is simpler to reason about from the `job_runs` message than a
  row count would be. Neither row is updated either way — this is a count-shape choice, not a
  behavior one.
- **A CSV row whose `code` cell itself fails to parse (empty/non-numeric) is silently dropped**,
  uncounted in any `job_runs.details` field — there's nothing to join it onto, and the ticket's
  named-field list doesn't call for a bucket for this case (distinct from a malformed *elo* cell,
  which is counted). In practice this hasn't been observed against real data; `code` is a plain
  small integer in every row of the two season files fetched during the ticket's own verification.
- **Added a `process.argv[1] === import.meta.url` guard around the top-level `main()` call**,
  copied verbatim in spirit from `scripts/sync-squad.ts`'s existing pattern (that file's own
  comment explains the "why": the pure join functions need to be importable by the Vitest file
  without triggering a real Supabase-hitting run as a side effect of `import`). This file had no
  guard before because it had no tests before; this ticket is the first to add any, so the guard
  is new here but not a new *pattern* in the codebase.
- **Test file grep-checks the DoD's literal wording** ("no `.from('teams').upsert(` call", "no
  `onConflict: 'id'` string", "forbidden identity-column strings appear nowhere outside comments")
  directly against the shipped source text, rather than re-deriving equivalent assertions purely
  from the exported functions' behavior — this is the only way to make a *structural* DoD bullet
  ("the string X does not appear") into something that fails in CI if it regresses, rather than
  relying on a human re-reading the diff.
- **The comment-stripping regex in that structural test treats a line as "comment" only when
  trimmed content starts with `//`, and strips trailing `\s//...`** (whitespace before the
  slashes) rather than any `//` — this avoids false-stripping the `https://` URLs that appear
  inside both real code (`SOURCE_BASE_URL`) and comments in this file, since a URL's `//` is
  always preceded by `:`, never whitespace, in this file's actual content.
