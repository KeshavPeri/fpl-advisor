"""Parity with src/lib/projection/minutes.test.ts's `availabilityFactor` cases
(docs/model-diagnosis-2026-09-24.md §6b, §8)."""
import numpy as np
import pandas as pd
import pytest

from fpl_model.availability import NEUTRAL_AVAILABILITY, apply_availability, availability_factor


def test_status_a_with_null_chance_is_1():
    assert availability_factor('a', None) == 1.0


def test_nonnull_chance_always_wins_regardless_of_status():
    assert availability_factor('a', 75) == pytest.approx(0.75, abs=1e-10)
    assert availability_factor('d', 50) == pytest.approx(0.5, abs=1e-10)
    assert availability_factor('i', 25) == pytest.approx(0.25, abs=1e-10)


def test_status_i_with_null_chance_is_0():
    assert availability_factor('i', None) == 0.0


def test_status_s_with_null_chance_is_0():
    assert availability_factor('s', None) == 0.0


def test_status_u_with_null_chance_is_0():
    assert availability_factor('u', None) == 0.0


def test_unrecognised_status_with_null_chance_is_neutral():
    assert availability_factor('d', None) == NEUTRAL_AVAILABILITY
    assert availability_factor('n', None) == NEUTRAL_AVAILABILITY


def test_chance_of_zero_is_respected_as_zero():
    assert availability_factor('d', 0) == 0.0


def test_apply_availability_multiplies_by_row_factor():
    values = np.array([10.0, 10.0, 10.0])
    snapshot = pd.DataFrame({
        'status': ['a', 'i', 'd'],
        'chance_of_playing_next_round': [None, None, 50],
    })
    out = apply_availability(values, snapshot)
    np.testing.assert_allclose(out, [10.0, 0.0, 5.0])
