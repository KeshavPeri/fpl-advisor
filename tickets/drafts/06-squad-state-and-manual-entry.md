## Context

Feature-list item 6. Depends on the app shell and design tokens (#8), the Supabase reference
schema (#9) and the FPL ingest job (#11) for the player list.

`product-brief.md` §2 makes squad state owned by the app, and notes it must accept manual entry
"before GW1 exists". That is not a hypothetical: the season starts 21 August 2026, so until then the
FPL API publishes no picks for Keshav at all and there is no other way to get his opening 15 into
the system. Without this ticket nothing downstream — solver, recommendation, notification — has a
squad to reason about.

## Scope

**In scope:**

- A migration under `supabase/migrations/` for squad state: a squad row per gameweek (bank, squad
  value, free transfers) and 15 pick rows (player, squad position 1–15, starting XI or bench, bench
  order, captain, vice-captain), plus a `source` column distinguishing manual entry from a later
  API sync or a registered override.
- Client-side routing so the app has more than one screen: `/` (the shell from #8) and
  `/squad`.
- A manual squad-entry screen: pick 15 players from the `players` table, set positions, starting XI
  and bench order, captain and vice-captain, bank and squad value. Save persists to Supabase.
- Validation with messages that say what is wrong and what to do about it.
- Row Level Security policies allowing the browser's publishable key to read and write **these
  tables only** (see notes — this is a decided Tier 2, not an escalation).

**Explicitly out of scope:**

- No FPL API sync and no reconciliation — that is the next ticket (#14).
- **No pitch view.** The squad-as-formation layout is item 16 in `feature-list.md`, in wave 4. This
  screen is a functional entry form, and it should look like it belongs to #8's design system,
  not like a first attempt at the pitch.
- No recommendation, no solver, no projected points, no captaincy advice.
- **No auth, no accounts, no login, no multi-user.** Permanently out of scope per
  `product-brief.md` §3.
- No new category of personal data beyond what `product-brief.md` §5 pre-approves. Squad picks,
  bank and squad value are on that list.
- No override-registration flow with its friction step — that is item 20, wave 4.
- No changes to the ingest scripts or the workflow.

## Definition of done

- [ ] `npm run build` passes clean.
- [ ] `npm run lint` passes clean.
- [ ] The migration applies twice against an empty local Postgres, both runs exit 0, the second
      creating nothing new.
- [ ] The migration **GRANTs** `SELECT, INSERT, UPDATE, DELETE` to `anon` on the squad tables it
      creates, in the same file that creates them, alongside the RLS policies. RLS and GRANTs are
      two independent gates: a policy without a grant yields `permission denied for table`, which
      broke the first heartbeat run on 11 Aug 2026 (`deltas.md` D8). `DELETE` is included here
      deliberately — replacing a 15-player squad needs it, unlike the read-only reference tables.
      Copy the pattern from `supabase/migrations/20260811160000_table_grants.sql`.
- [ ] A local-Postgres test **cannot** catch a missing grant, because it runs as a superuser. State
      in the handback that the grants were verified by reading the SQL, not by the migration
      applying cleanly.
- [ ] **Database-enforced, each demonstrated with a failing `insert`:** no two picks share a
      squad position in one gameweek; the same player cannot appear twice in one gameweek; at most
      one captain per gameweek; at most one vice-captain per gameweek. These are expressible as
      unique and partial-unique indexes.
- [ ] **UI-enforced, each demonstrated by attempting the save:** exactly 15 picks; exactly 11
      starters; captain and vice-captain are different players; the starting XI is a legal FPL
      formation. Each rejection names what is wrong and what to do about it. These are multi-row
      rules that a plain constraint cannot express — see the notes for why they are deliberately
      not enforced in the database.
- [ ] **Legal formation** means exactly 1 goalkeeper, at least 3 defenders, at least 2 midfielders
      and at least 1 forward in the starting XI, totalling 11. A 2-5-3 is rejected; a 3-4-3 and a
      3-5-2 are both accepted. Verified against the Premier League's published rules, 11 Aug 2026.
- [ ] The screen states which gameweek it is editing, by name (`Gameweek 1`), before anything is
      entered.
- [ ] Navigating to `/squad` renders the entry screen; navigating to `/` still renders the shell
      from #8 unchanged.
- [ ] Entering a valid 15, saving, and reloading the page shows the same squad — it persisted.
- [ ] Attempting to save with fewer than 15 players, or with no captain, shows a message that names
      what is missing and what to do. The strings "Something went wrong", "An error occurred" and
      "Oops" appear nowhere in `src/`.
- [ ] If the `players` table is empty, the screen says so and names the ingest job, rather than
      rendering an empty selector.
- [ ] The screen introduces no raw colour value: every colour used resolves to a token defined in
      #8. No new hex literal appears in the new component's styles.
- [ ] Prices and squad value render in Geist Mono with tabular figures, formatted `£8.5m` — one
      decimal place, `£` symbol (`product-brief.md` §8).
- [ ] The strings `Inter`, `#4ade80`, `#f87171`, `#aa3bff`, `#c084fc` appear nowhere in `src/`.
- [ ] No emoji is used as an icon anywhere in the new UI.
- [ ] Scope constraint: changes are limited to `supabase/migrations/`, `src/`, `package.json` and
      `package-lock.json`. Nothing under `.github/`, `scripts/` or `public/` changes.
- [ ] Usable on the installed iPhone PWA — the 15-player entry flow is completable one-handed.
      *(Device-level — expect CANNOT VERIFY.)*

## Notes for the Analyst / Builder

**Three ambiguities, answered here so nobody guesses at 3am.**

- **Which gameweek does manual entry target?** The next gameweek whose deadline has not passed —
  the lowest `gameweeks.id` where `deadline_time > now()`. Today that is Gameweek 1, whose deadline
  is `2026-08-21T17:30:00Z`. If every deadline has passed, target the highest `gameweeks.id`. The
  screen names the gameweek it is editing; it never silently picks one.
- **Captain and vice-captain must be different players.** Reject the collision. The vice-captain
  exists solely as the fallback when the captain does not play, so setting both to the same player
  removes the mechanism entirely while looking like a valid save.
- **Formation legality is enforced, in the UI.** 1 GK, 3–5 DEF, 2–5 MID, 1–3 FWD, 11 starters —
  the maxima follow from the 15-man squad being 2/5/5/3.

**Why counts and formation are not database constraints.** A rule spanning fifteen rows needs a
deferred constraint trigger, which is a substantial amount of PL/pgSQL to write, test and maintain
for a single-user app whose only realistic writer is this screen. The database enforces everything
a plain index can express — duplicate positions, duplicate players, more than one captain, more
than one vice — and the UI enforces the rest. **This is a Tier 2 decision, made here.** Log it with
that reasoning; do not escalate it, and do not build the trigger.

- **Router: react-router v7. Decided here, Tier 2, do not escalate.** Because `feature-list.md` has
  at least four more screens coming in wave 4 — pitch view, verdict card, reasoning screen, accuracy
  display — so a router is not premature, and retrofitting one after four screens exist is exactly
  the kind of reversal Tier 2 exists to prevent. Log it with the because.

- **Row Level Security on the squad tables: grant select, insert and update to the anon role.
  Decided here, Tier 2, do not escalate.** Because this app has no authentication and no server —
  `product-brief.md` §3 puts accounts and auth permanently out of scope — so the browser's
  publishable key is the only writer available, and a table with RLS on and no write policy simply
  cannot be written to from the app. The data at stake is Keshav's own FPL squad, which is already
  public through the unauthenticated `entry/{id}/` endpoint. **Apply this to the squad tables only.**
  The reference tables from #9 stay read-only; their writer is the Action's secret key.

  Flag this in your handback as a HIGH-IMPACT entry with the reasoning above, so it reaches the
  morning review as a decision rather than a default.

- **This is the largest ticket in the first wave** — a migration, routing and a screen. It was kept
  as one ticket to match `feature-list.md` item 6 one-to-one. If the Analyst judges at lint time
  that it is too big for a single Builder pass, the clean seam is schema-and-routing in one ticket
  and the entry screen in the next; splitting it there costs nothing downstream.

- **Store `players.code`, not just `players.id`, anywhere you persist a player reference.** FPL
  element ids are **not stable across seasons** — verified on real data during #12: of 458 players
  matched between the 2025/26 and 2026/27 snapshots, only 5 kept the same id and 453 changed.
  `code` is the stable cross-season identifier and is already a column on `players`. A squad stored
  by `id` alone becomes wrong the moment the players table is refreshed for a new season.
- The player list comes from the `players` table filled by #11. Do not fetch the FPL API
  directly from the browser for this — the ingest job is the single path by which player data
  enters the system, and a second path is a second thing to keep correct.

- FPL squad shape for 2026/27: 15 players — 2 GK, 5 DEF, 5 MID, 3 FWD — with 11 starting and 4 on
  the bench, one of whom is the reserve goalkeeper. Take the position codes from `element_types` in
  the reference schema rather than hardcoding them.

- Use FPL's own vocabulary in the interface — gameweek, bench, captain, vice-captain, bank, squad
  value. Never name anything after how the system is built (`design-reference.md`, interface
  writing).

- Money on this screen is in-game only and therefore **Tier 3** (`product-brief.md` §4). Formatting
  it is a routine decision; do not escalate it.
