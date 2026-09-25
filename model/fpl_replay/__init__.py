"""`model/fpl_replay/` -- season-replay harness (ticket #281, feature-list item 32's
recommendation-level slice). Replays 2025-26 with `gbm-v1` and the real solver
(`sertalpbilal/FPL-Optimization-Tools`, pinned commit) to measure net points at several
transfer-hit costs. See `replay.py`'s module docstring for the full method; `rules.py` is pure
(no I/O, no solver, no network) and `solver_io.py` is the only module that touches the solver
checkout or the filesystem beyond reading cached CSVs.

Public entry points: `replay.run_replay`, `replay.run_never_transfer_baseline`.
"""
