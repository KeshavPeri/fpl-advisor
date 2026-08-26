# Ticket #109 — Scale goalkeeper saves with fixture difficulty

## HIGH-IMPACT

- **Applied `defensiveMultiplier(expectedScore) = 2 × (1 − expectedScore)`, clamped to `[0, 2]`, to expected saves in `expectedPoints.ts`, expressed as the exact mirror of the existing `attackingMultiplier` and the ratio form of the existing `expectedGoalsConceded`, because saves and goals-conceded are two consequences of the same cause (facing more shots), and leaving saves fixture-blind meant the model could not distinguish a keeper who saves a lot at a bad club from one who simply concedes.** This changes the projection model that every downstream recommendation rests on, and is expensive to reverse once the solver and reasoning screen are built on the adjusted figures. The formula itself was pre-specified in the ticket's Notes as the mirror of `attackingMultiplier` — no independent derivation was needed, but the decision to ship it despite the known shot-volume-vs-shot-quality double-counting caveat (rather than wait for the backtest, five items away) is the HIGH-IMPACT call, and it was made by the ticket's own author, carried forward here.

## ROUTINE

- Surfaced the multiplier used as `modelInputs.savesMultiplier`, following the existing pattern of exposing model inputs generically for the reasoning screen — no screen code needed changing.
- Trimmed the now-obsolete "Shape of the fix" / future-tense planning prose in `docs/projection-model-backlog.md` G1 now that the fix has shipped, replacing it with a pointer to the new ADDRESSED note, rather than leaving stale future-tense text describing work already done.
