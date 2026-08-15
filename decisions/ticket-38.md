# Decisions — ticket #38

## HIGH-IMPACT

(none this ticket)

## ROUTINE

- **Availability ring implemented and unit-tested against every DoD case, but wired live via a
  hardcoded placeholder (`deriveAvailability('a', null)`)** — because neither `fetchExistingSquad`
  nor the existing `fetchPlayers()` in `src/lib/squad/api.ts` exposes `players.status` or
  `players.chance_of_playing_next_round` on the returned type, and this ticket's own scope
  constraint forbids touching `src/lib/squad/api.ts`. The ticket's Notes pre-answered exactly this
  case ("if joining them needs a small addition to `api.ts`... prefer composing the two existing
  reads... if that genuinely cannot work, that is a real finding: report it rather than widening
  the scope silently"). Confirmed by the Builder reading `api.ts` in full, and confirmed correct
  by the Analyst (Tier 3 — the swap to real data is a one-line change at the single call site once
  a follow-up lands the missing fields, so nothing is expensive to reverse). No player shows a ring
  in the running app today; this is expected and documented inline, not a defect. **Follow-up
  needed:** add nullable `status: string` and `chanceOfPlayingNextRound: number | null` fields to
  `SelectablePlayer`/`fetchPlayers()` in `src/lib/squad/api.ts`. (Tier 3, Analyst-confirmed)
- **Read via `fetchExistingSquad` + the existing `fetchPlayers()`** (an existing, unmodified read
  already composed the same way by `SquadEntryScreen.tsx`) rather than only the two functions
  literally named in the ticket text — the ticket forbids *writing new query functions*, not
  calling other existing ones; `fetchPlayers()` was needed for name/position/price since
  `fetchExistingSquad`'s picks carry only a bare `playerId`. (Tier 3)
- **Ring styling**: "solid" maps to `var(--accent-coral)` at full opacity as the border colour,
  "hollow" maps to the existing dimmed `var(--accent-coral-line)` token — both applied as
  `border-width` (a permitted `px` exception for border widths). Captaincy uses the equivalent
  solid/outline pairing on `--accent-cyan`. (Tier 3)
- **Shirt rendered as a `clip-path` polygon jersey silhouette** in `--surface-2`, inside a
  `--panel-fill-raised` badge, sized via `--space-12` — an abstract domain shape per
  design-reference.md's anti-reference guidance (no club crests, no kit graphics). (Tier 3)
- **Loading skeleton reuses `Pitch.css`'s row/bench classes with a representative 4-4-2 shape**
  to guarantee no layout shift when real data arrives, rather than a generic shimmer block. (Tier 3)
- **"No gameweek loaded" and "no squad saved" implemented as two distinct empty states** rather
  than one generic empty state, since the fix a user needs differs (waiting on the ingest job vs.
  going to `/squad` to build a squad). (Tier 3)
- **`frontend-design` skill was not available in this environment's skill listing** — applied
  `design-reference.md` directly and rigorously by hand instead, including its "three AI-default
  looks" section, rather than guessing at an unavailable skill invocation. (Tier 3, process note)
