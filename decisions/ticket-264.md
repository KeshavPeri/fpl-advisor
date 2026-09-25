# Ticket #264 — Market-odds features in gbm-v1 — kept because they pick better captains

## HIGH-IMPACT

None. `USE_ODDS` stayed `True` — the offline gate passed on all five checks with numbers matching
the ticket's own pre-measurement exactly (liveness 99.9% coverage; primary 0.5859 vs 0.5889;
captain 6.65 vs 5.65, +1.00; top-11 4.77 vs 4.86), so no fallback-to-False decision was needed.

## ROUTINE

- `evaluate.py`'s with/without-odds ablation duplicates `train.py`'s fit control-flow
  (`_fit_with_features`) rather than adding an optional `feats` kwarg to `train.fit`, because
  `train.py`'s signatures are frozen per the model-diagnosis doc and outside this ticket's Files
  list; `train.predict` is reused unmodified since it already takes `model.feats`.
- Folded gates 3/4/5 into `evaluate.py`'s `overall_pass`/exit code, not just printed — so a future
  regression on these gates fails the build automatically instead of relying on someone reading the
  report by eye.
- `model/README.md`'s odds section is longer than the DoD's literal "two lines" — matched the
  existing README's own documentation style (its other "Frozen contracts" / "Offline gate result"
  sections are similarly detailed) rather than the literal line count.
- Added one test beyond the DoD's required four (source-priority dedup: `football-data` wins over
  `the-odds-api` on a duplicate pairing) since that logic was implemented and otherwise unexercised.
- `model/fpl_model/sources.py` was in the ticket's Files list but left untouched — the odds join
  needed no helper there, which the ticket itself allowed ("only if the join needs a helper there").
