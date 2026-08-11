# Ticket #11 — FPL API ingest job

## HIGH-IMPACT

None — all decisions on this ticket were routine implementation choices, not
structural ones (see ROUTINE below).

## ROUTINE

- **No CSV/schema-validation library added.** Used Node 22's built-in `fetch`,
  matching the ticket's steer against adding an HTTP client. Hand-rolled shape
  checks (non-empty `teams`/`events`/`elements` arrays, fixtures as a non-empty
  array) were sufficient for this ticket's validation needs, so no dependency
  was pulled in.
- **`FPL_API_BASE_URL` env override, defaulting to the real host.** Added
  because the DoD's "point the base URL at an unreachable host" failure test
  is only exercisable if the base URL can be overridden somehow; an env var
  with a hardcoded default keeps shipped behaviour unchanged while making the
  failure path testable.
- **Row counts are read back with a post-upsert `count(*)` per table**, rather
  than trusting the length of the input array. Because it proves "the table
  now has N rows" rather than "I sent N rows," which also makes the
  idempotency check something the script's own output demonstrates.
- **Numeric-string fields normalized before upsert** (`form`,
  `selected_by_percent`, `influence`, `creativity`, `threat`, `ict_index`,
  `expected_*`). The live API returns these as strings (e.g. `"31.0"`) but the
  `players` schema types them `numeric`, and Postgres needs an actual JSON
  number for a numeric column. Verified live against the real endpoint before
  writing the upsert, per the ticket's own pre-answered note.
