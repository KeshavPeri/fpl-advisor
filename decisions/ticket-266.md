# Ticket #266 — Reasoning screen: say which model decided, and why, in plain words

## HIGH-IMPACT

None.

## ROUTINE

- `pos_i` (from `features.py`'s `_CONTEXT`) is in `FEATURES` but wasn't named in the ticket's own
  driver-wording list. Mapped it to "playing position", consistent with the model's
  `_POSITION_CODE` (GK/DEF/MID/FWD → 0–3), because the definition of done requires every `FEATURES`
  name to get a non-null description.
- "Top three drivers" is computed as the top three by `|contribution|` among the up to five stored
  drivers, after dropping any with an unrecognised feature name — rather than always showing exactly
  three raw slots — because the brief's "never a raw feature name" rule needs to hold even if a
  future feature name goes unmapped.
- Expected points in the "Decided by gbm-v1 · 5.8" headline is formatted to 1 dp via `toFixed(1)`,
  matching the ticket's literal example.
