"""Smoke test for the evaluate.py plumbing — liveness detection, gate arithmetic and report
rendering — on synthetic data. Fast and network-independent; the real gate numbers come from
running `python -m fpl_model.evaluate` directly against the real four seasons (see
model/README.md and model/reports/eval-latest.md).
"""
import numpy as np
import pandas as pd

from fpl_model import evaluate


def test_liveness_failures_flags_zero_test_rows():
    folds = [
        {'cutoff': 1, 'through_gw': 7, 'n_train': 10, 'n_test': 0, 'pred_std': 1.0},
        {'cutoff': 8, 'through_gw': 14, 'n_train': 20, 'n_test': 5, 'pred_std': 0.5},
    ]
    problems = evaluate._liveness_failures(folds, 'test-model')
    assert len(problems) == 1
    assert 'GW1' in problems[0]


def test_liveness_failures_flags_constant_predictions():
    folds = [{'cutoff': 1, 'through_gw': 7, 'n_train': 10, 'n_test': 5, 'pred_std': 0.0}]
    problems = evaluate._liveness_failures(folds, 'test-model')
    assert len(problems) == 1
    assert 'constant' in problems[0]


def test_liveness_failures_empty_when_healthy():
    folds = [{'cutoff': 1, 'through_gw': 7, 'n_train': 10, 'n_test': 5, 'pred_std': 1.2}]
    assert evaluate._liveness_failures(folds, 'test-model') == []


def test_sp_handles_short_or_empty_frames():
    empty = pd.DataFrame({'a': [], 'b': []})
    assert np.isnan(evaluate._sp(empty, 'a', 'b'))
    one_row = pd.DataFrame({'a': [1.0], 'b': [2.0]})
    assert np.isnan(evaluate._sp(one_row, 'a', 'b'))


def test_render_report_reflects_pass_and_fail():
    k = dict(
        folds1=[{'cutoff': 1, 'through_gw': 7, 'n_train': 100, 'n_test': 50, 'pred_std': 1.0}],
        folds5=[{'cutoff': 1, 'through_gw': 7, 'n_train': 100, 'n_test': 50, 'pred_std': 1.0}],
        liveness=[],
        active_5gw_gbm=0.60, active_5gw_ppm=0.45, active_5gw_minutes=0.44,
        by_position={
            'GK': {'gbm': 0.40, 'ppm': 0.30, 'n': 10}, 'DEF': {'gbm': 0.50, 'ppm': 0.40, 'n': 10},
            'MID': {'gbm': 0.55, 'ppm': 0.48, 'n': 10}, 'FWD': {'gbm': 0.58, 'ppm': 0.50, 'n': 10},
        },
        n_active5=40, primary_pass=True,
        featured_5gw_gbm1=0.42, featured_5gw_gbm5=0.43, featured_5gw_minutes=0.37, n_featured5=30,
        secondary_pass=True,
        featured_1gw_gbm=0.35, n_featured=30,
        captain_avg=6.5, top11_avg=4.7, mean_bias=0.02,
        overall_pass=True,
    )
    report = evaluate._render_report(**k)
    assert '**Primary gate: PASS**' in report
    assert '**Secondary gate: PASS**' in report
    assert '## Overall: PASS' in report

    k['primary_pass'] = False
    k['overall_pass'] = False
    failed = evaluate._render_report(**k)
    assert '**Primary gate: FAIL**' in failed
    assert '## Overall: FAIL' in failed


def test_render_report_shows_liveness_failures():
    k = dict(
        folds1=[{'cutoff': 1, 'through_gw': 7, 'n_train': 100, 'n_test': 0, 'pred_std': 0.0}],
        folds5=[{'cutoff': 1, 'through_gw': 7, 'n_train': 100, 'n_test': 0, 'pred_std': 0.0}],
        liveness=['1-GW model: fold starting GW1 has zero test rows'],
        active_5gw_gbm=float('nan'), active_5gw_ppm=float('nan'), active_5gw_minutes=float('nan'),
        by_position={p: {'gbm': float('nan'), 'ppm': float('nan'), 'n': 0}
                     for p in ['GK', 'DEF', 'MID', 'FWD']},
        n_active5=0, primary_pass=False,
        featured_5gw_gbm1=float('nan'), featured_5gw_gbm5=float('nan'),
        featured_5gw_minutes=float('nan'), n_featured5=0, secondary_pass=False,
        featured_1gw_gbm=float('nan'), n_featured=0,
        captain_avg=float('nan'), top11_avg=float('nan'), mean_bias=float('nan'),
        overall_pass=False,
    )
    report = evaluate._render_report(**k)
    assert 'LIVENESS FAILURES' in report
    assert 'zero test rows' in report
