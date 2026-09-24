"""Python copy of `availabilityFactor` in `src/lib/projection/minutes.ts` (lines 122-129), kept
in parity with `src/lib/projection/minutes.test.ts` by `model/tests/test_availability.py`
(docs/model-diagnosis-2026-09-24.md §6b, §8).

`live.py` (run 2) must call `apply_availability`, never `availability_factor` directly, so run 3's
learned-availability ticket can change the rule inside it without touching `live.py`.

Signatures below are FROZEN (docs/model-diagnosis-2026-09-24.md §8) — later tickets only import.
"""
from __future__ import annotations

import numpy as np
import pandas as pd

NEUTRAL_AVAILABILITY = 0.5
UNAVAILABLE_STATUSES = {'i', 's', 'u'}


def _clamp01(value: float) -> float:
    if value < 0:
        return 0.0
    if value > 1:
        return 1.0
    return value


def availability_factor(status: str, chance_next: float | None) -> float:
    """Mirrors `availabilityFactor` exactly:
      - a non-null `chance_next` always wins, regardless of status -> chance / 100 (clamped).
      - status 'a' with a null chance -> 1.0.
      - status 'i' | 's' | 'u' with a null chance -> 0.0.
      - anything else with a null chance -> NEUTRAL_AVAILABILITY (0.5), not an assertion either way.
    """
    if chance_next is not None and not (isinstance(chance_next, float) and np.isnan(chance_next)):
        return _clamp01(chance_next / 100)
    if status == 'a':
        return 1.0
    if status in UNAVAILABLE_STATUSES:
        return 0.0
    return NEUTRAL_AVAILABILITY


def apply_availability(values: np.ndarray, snapshot_rows: pd.DataFrame) -> np.ndarray:
    """Multiply `values` (one per row of `snapshot_rows`, same order) by each row's availability
    factor, read from `snapshot_rows['status']` and `snapshot_rows['chance_of_playing_next_round']`.
    """
    factors = np.array([
        availability_factor(row.status, row.chance_of_playing_next_round)
        for row in snapshot_rows.itertuples(index=False)
    ])
    return np.asarray(values) * factors
