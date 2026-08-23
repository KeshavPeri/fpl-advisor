# Ticket #91 — Register overrides against the recommendation

## HIGH-IMPACT

None. No decision met the "expensive to reverse after ten more tickets" test — every judgment
call below follows an established convention elsewhere in the codebase rather than inventing a
new one.

## ROUTINE

- No new Supabase read in `src/lib/override/` needed a pagination loop: the `squad_picks` and
  `recommendation_decisions` reads are bounded by a `.eq(gameweek_id, …)` filter (at most 15 and
  2 rows respectively, by the tables' own unique indexes), matching the existing convention that
  a read is either explicitly filtered or paginated, never an unfiltered scan. The wide player
  pool is read via the existing, unmodified `fetchPlayers` in `src/lib/squad/api.ts`, which
  already paginates, rather than adding a second unbounded read.
- `derive.ts` resolves player-name labels itself, taking a `ReadonlyMap<number,string>` as a
  plain data argument, rather than leaving name formatting to the screen — so "the screen does
  no derivation" holds for the confirm panel's display text as well as its comparison logic.
- `types.ts` defines small local copies of the recommendation/decision shapes it needs rather
  than importing from `src/lib/verdict/`, `reasoning/`, or `commit/`, matching the precedent
  those modules already set for each other.
- The unique-violation (Postgres 23505) race on the override insert is handled the same way
  `commitRecommendation` handles it: re-read and return the existing row rather than surfacing
  an error.
- The step-one-to-step-two transition button reads "Continue to confirm" — the ticket's naming
  rule binds the register/write action's name ("Register override"), not this intermediate
  navigation control.
