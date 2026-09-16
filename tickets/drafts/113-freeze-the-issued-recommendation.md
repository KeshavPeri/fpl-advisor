## Problem

There is no permanent record of the structured recommendation that was
actually sent, so the recommendation scorecard cannot honestly score what the
user acted on.

`scripts/generate-recommendations.ts` upserts `recommendations` keyed on
`(gameweek_id, plan_index)`:

```
.upsert(recommendationRows, { onConflict: 'gameweek_id,plan_index' })
```

Every later solve for the same gameweek overwrites the row in place.
`scripts/send-telegram.ts` reads `recommendations` at plan_index 0 and sends
it, and `scripts/recommendation-scorecard.ts` reads `recommendations` too —
but it reads it later, by which time the row can be a different plan from the
one the user received.

The one thing that IS permanent is `notifications`. It is insert-only, and it
already stores `message_text`, `plan_index` and `recommendation_gameweek_id`.
But `message_text` is prose composed for Telegram, not structured data, so it
cannot be scored automatically.

Why this matters now and is not a testing detour: ticket #111 changes the
fixture term for every projection. The only way to tell whether the
recommendations got better is to compare what was issued before against what
is issued after. That comparison is impossible while the record of what was
issued is overwritten.

## The fix

Snapshot the structured plan at send time, into the table that is already
append-only.

- New migration adding `plan_snapshot jsonb` (nullable) to
  `public.notifications`. Nullable because every existing row predates it and
  must not be back-filled with a guess.
- `scripts/send-telegram.ts` writes `plan_snapshot` in the SAME insert that
  already records the send, built from the exact `recommendations` and
  `recommendation_reasons` rows it read to compose `message_text`. No second
  read, and no re-read after sending — the snapshot must be the rows the
  message was built from, or it is not a snapshot.
- The snapshot carries, at minimum: `gameweek_id`, `plan_index`, the
  transfers in and out with player codes and names, the captain and
  vice-captain player codes, the starting eleven and bench player codes, the
  expected points figure and the confidence band, plus a
  `model_version` string so a later comparison knows which model produced it.
  Use player `code`, never `player_id` — `deltas.md` D9, `code` is the stable
  key.
- Write it on a failed send too. A recommendation that failed to reach
  Telegram is still a recommendation the model produced, and the failure rows
  are the ones worth reading later.
- `scripts/recommendation-scorecard.ts` reads `plan_snapshot` from
  `notifications` where it is present, and falls back to `recommendations`
  where it is null (every row before this ticket). The report must state, per
  scored gameweek, which source was used — a scorecard that silently mixes
  frozen and mutable sources is worse than one that says which it had.

## Falsification gate

None required. This ticket makes no causal claim about a measured model
number.

## Definition of done

- Apply the migration, then run `scripts/send-telegram.ts` for the current
  gameweek. Confirm by a direct query that the new `notifications` row has a
  non-null `plan_snapshot` and that its captain and transfers match the text
  of the message sent. Paste both into the PR body.
- Run `scripts/recommendation-scorecard.ts` and confirm the report names its
  source per gameweek. Paste the report into the PR body.
- Named tests: snapshot written on a successful send; written on a failed
  send; scorecard prefers the snapshot; scorecard falls back cleanly on a
  null snapshot and says so.
- `npm run build`, `npm run lint`, `npm test` clean.
- Record the new migration in `supabase/README.md` as not yet applied, in the
  existing format.

## Out of scope

- Changing how `recommendations` is written. The upsert stays; this ticket
  adds a record beside it, it does not restructure the write path.
- Back-filling any historical row.
- Any scoring rule, weighting or metric inside the scorecard. This ticket
  only changes where the scorecard gets its input.

## Files

- `supabase/migrations/20260913090000_notifications_plan_snapshot.sql` (new)
- `supabase/README.md`
- `scripts/send-telegram.ts`
- `scripts/send-telegram.test.ts`
- `scripts/recommendation-scorecard.ts`
- `scripts/recommendation-scorecard.test.ts`
