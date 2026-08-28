## Context

**Two display defects in the chip advisory, seen on the phone on 29 August 2026, the first time it
rendered with real data.** The mechanism behind it (#126, #135) is correct; the presentation is not.

```
Chip advisory
Bench Boost      Gameweek 2 · +18 pts
Triple Captain   Gameweek 3 · +18 pts
Bench Boost      Gameweek 2 · +18 pts
Triple Captain   Gameweek 3 · +18 pts
Bench Boost      Gameweek 2 · +18 pts
Triple Captain   Gameweek 3 · +18 pts
```

### 1. Six rows where there should be two

`chip_advisories` holds one row per (gameweek, `solution_index`), and the solver returns three
solutions. In this run all three chose the same chips, so the screen renders the same pair three
times. **The reader is being shown the solver's iteration count, which is an implementation detail,
not a decision.**

### 2. The delta belongs to the pair, and is printed against each chip

**+18 is the difference between the chip-enabled solve and the chip-free one — the value of playing
*both* chips together.** Rendered against each row it reads as "Bench Boost is worth 18 and Triple
Captain is worth 18", so a reader adds them to 36, or to 108 across six rows.

**This is the same failure as the doubled verdict-card figure in #72**: a stored number rendered
against the wrong unit, arithmetically explicable and completely wrong. `product-brief.md` §8 exists
for exactly this — *"rendering '4.2 versus 4.0' manufactures false confidence"*, and manufacturing
+36 from a real +18 is worse.

**Neither defect affects any decision today** — nothing acts on these numbers and the recommendation
is untouched. But the second would mislead the first time a chip is actually considered.

Depends on #126 and #135 (merged). Nothing unmerged.

## Scope

**In scope:**

- **Collapse identical chip decisions across solutions.** Where every stored solution names the same
  chip in the same gameweek, render it **once**. Where solutions genuinely differ, render the
  distinct decisions and say how many of the three solutions chose each.
- **Attribute the delta to the set of chips it was measured on, not to each chip.** The advisory
  reads as one statement — *playing Bench Boost in gameweek 2 and Triple Captain in gameweek 3 is
  worth +18 points across the horizon* — rather than as a per-chip figure.
- **A single delta figure per advisory**, as a whole number, stated once.
- **The existing five-gameweek caution is kept verbatim.** It is doing its job.
- **The squad-rebuild advisory is left alone.** One row, one delta, correctly attributed already.

**Explicitly out of scope:**

- **No change to `chip_advisories`, its schema, or what is stored.** One row per solution is correct
  storage — the solver really did return three solutions and a later ticket may want them. **This is
  a display decision, not a data one.**
- **No change to `scripts/store-chip-advisory.ts`, `scripts/store-squad-advisory.ts` or
  `scripts/lib/solver-output.ts`.**
- **No migration, nothing under `supabase/` or `scripts/`.**
- **No "play this chip" instruction.** The advisory reports a gap; the decision is Keshav's.
- **No change to the chip state or expiry sections** of the screen (#85, #116).

## Definition of done

- [ ] Three stored solutions naming the same chips in the same gameweeks render as **one** advisory
      listing those chips once. Named test on the derived view.
- [ ] Solutions naming different chips or different gameweeks render as distinct advisories, each
      stating how many of the three solutions chose it. Named test.
- [ ] **The delta is stated once per advisory and is never repeated against an individual chip.**
      Named test asserting a two-chip advisory produces exactly one points figure.
- [ ] The delta renders as a whole number, per `product-brief.md` §8. Named test.
- [ ] A single-chip advisory renders correctly — one chip, one gameweek, one delta. Named test.
- [ ] An advisory with no chips renders nothing rather than an empty card. Named test.
- [ ] The five-gameweek caution text is unchanged. Grep-checkable.
- [ ] The squad-rebuild advisory's rendering is unchanged. Its existing tests pass **unmodified**.
- [ ] `src/lib/chips/derive.ts` stays pure: `supabase`, `fetch` and `useEffect` appear nowhere in it,
      and the current instant remains a parameter.
- [ ] `design-reference.md` compliance: Geist and Geist Mono with tabular figures, the existing
      `Surface` component, no green, no yellow, no purple, no emoji, sentence case. **The advisory is
      not coloured as a warning.**
- [ ] Nothing under `scripts/`, `supabase/`, `docs/` or `.github/` is added, changed or deleted.
      Grep-checkable.
- [ ] `npm run build`, `npm run lint` and `npm test` all pass clean.
- [ ] **What a substitute cannot catch:** every test runs on constructed rows, and the only real
      advisory observed so far has all three solutions agreeing. **A run where they disagree has
      never been seen**, so the multi-advisory path is tested but unproven. The human check after
      merge is opening `/chips` and confirming two rows where there were six, with **one** `+18`.

## Notes for the Analyst / Builder

**The rule, as its *because*.** A points figure is only meaningful with its unit attached.
**Because** the delta was measured by comparing a solve that played both chips against one that
played neither, it is a property of the pair — there is no measurement of either chip alone, and
printing one against each invents two numbers from one. If a Builder wants a per-chip figure, the
honest answer is that it does not exist and would need two more solves.

**Collapse for display, keep the storage.** Three solutions choosing the same chips is real
information about how confident the solve is, and it is worth keeping in the table. It is not worth
three identical rows on a phone screen. **Do not "fix" this by storing only solution 0.**

**When solutions disagree, say so rather than picking one.** *"Two of three solutions play Bench
Boost in gameweek 2"* is more honest than silently rendering the first, and it is the same register
the verdict card's confidence bands already use.

**This ticket extends an existing surface**, so the `frontend-design` skill is **not** invoked and
Impeccable is **not** invoked (`CLAUDE.md`'s design-pass rule). Match the chips screen's existing
components and tokens.

**This is Tier 3** — a display correction. It stores nothing, changes no schema and alters no
behaviour outside the screen.

**Two other tickets may be running in this batch.** One owns `scripts/run-backtest.ts` and
`docs/projection-model-backlog.md`; the other owns `scripts/build-solver-input.ts` and
`docs/solver-notes.md`. This ticket touches nothing under `scripts/` or `docs/` at all.

## Scope constraint

Nothing outside the following files changes:

- `src/lib/chips/api.ts`, `src/lib/chips/derive.ts`, `src/lib/chips/types.ts`,
  `src/lib/chips/derive.test.ts`
- `src/screens/ChipsScreen.tsx`, `src/screens/ChipsScreen.css`
- `decisions/ticket-<this issue number>.md`

No migration file is added and nothing under `supabase/`, `scripts/`, `docs/` or `.github/` changes.
`src/components/VerdictCard.tsx`, `src/App.tsx` and `src/screens/HomeScreen.tsx` are not modified.
