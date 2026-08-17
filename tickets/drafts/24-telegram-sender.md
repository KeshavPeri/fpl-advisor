## Context

Feature-list item 14. Depends on item 13 (`recommendations` and `recommendation_reasons`, merged,
migration applied) — this ticket reads what that one stores and sends nothing it did not.

`product-brief.md` §1 is the reason this ticket exists and it is worth restating, because everything
in it follows: **the problem is not ignorance, it is decision fatigue.** Keshav already gets FPL's own
deadline reminders, acknowledges them, and still misses deadlines. So *"the deadline is coming"* is
worthless — it already exists and already fails. **The notification must carry the recommendation, so
that acknowledging it and deciding are the same act.**

§2: "structured block, headline first, reason included, no emoji." Item 15 decides *when* it fires
(24 hours and 10 hours before each deadline); this ticket builds *what* is sent and the ability to
send it once, on demand.

### The credential is Tier 1 and this ticket does not need it to be built

A Telegram bot token and chat ID come from BotFather and are **owner-only** — `escalation.md` Tier 1,
`new-app-kickoff.md` Part 0 rule 2. No agent creates them and no agent asks for them to be pasted
anywhere.

**This ticket must therefore build and pass its definition of done with the secrets unset.** The
pattern is already proven in this repo: `scripts/sync-squad.ts` treats an unset `FPL_ENTRY_ID` as a
normal pre-setup state — it logs a message naming the variable, makes no request, and exits zero.
Follow that exactly. A ticket that blocks on a missing credential wastes a night; this one does not.

## Scope

**In scope:**

- **`src/lib/notification/`** — pure functions, no I/O: compose the message text from a stored
  recommendation, and decide whether a given recommendation is sendable at all.
- **`scripts/send-telegram.ts`** — reads the current gameweek's recommendation from Supabase, composes
  the message, sends it via the Telegram Bot API, and records what was sent.
- **`supabase/migrations/20260818090000_notifications.sql`** — creates `notifications` (an append-only
  log of what was sent, when, for which gameweek, and against which recommendation), with RLS **and**
  GRANTs in the same file.
- A `workflow_dispatch` step so it can be fired on demand, plus a step in
  `.github/workflows/solver-run.yml` after the recommendation step, gated so it does nothing when the
  secrets are absent.
- **Failure notices**: when there is no usable recommendation, send the failure message
  `product-brief.md` §6c and §6d require rather than silence.
- Vitest tests for every pure function, including the full composed message for a worked example.
- One `job_runs` row per execution.

**Explicitly out of scope:**

- **No creation of a bot, no account, no credential.** Owner-only, Tier 1. The ticket names the two
  secrets it reads and stops there.
- **No hardcoded token, chat id, or bot username anywhere**, not even a placeholder that looks real.
- **No scheduling logic, no 24-hour or 10-hour trigger, no deadline arithmetic.** Item 15. This
  ticket sends when it is run.
- **No inbound Telegram handling** — no webhook, no commands, no bot replies, no polling for
  messages. The bot is a one-way sender, permanently.
- **No change to the recommendation itself.** This ticket formats and sends; it does not decide,
  re-rank, or recompute. Nothing under `src/lib/recommendation/` or
  `scripts/generate-recommendations.ts` changes.
- **No UI, no route, no component.** Nothing under `src/screens/` or `src/components/` changes.
- **No change to `scripts/project-points.ts`, `scripts/emit-projections-csv.ts`,
  `scripts/build-solver-input.ts`, `scripts/store-solver-output.ts` or
  `scripts/calibration-report.ts`.**
- No new npm dependency — `fetch` is built in.

## Definition of done

**Build and the Tier 1 boundary**

- [ ] `npm run build`, `npm run lint` and `npm run test` all pass clean **with `TELEGRAM_BOT_TOKEN`
      and `TELEGRAM_CHAT_ID` unset.**
- [ ] **With either secret unset, the script logs a message naming the missing variable, makes no
      network request, and exits zero.** There is a named test for each of: both unset, token only,
      chat id only. *(Same contract as `scripts/sync-squad.ts`'s unset-`FPL_ENTRY_ID` path — read it
      first.)*
- [ ] No token, chat id, bot name or `api.telegram.org` URL containing a credential appears anywhere
      in the repository. Verifiable by search.
- [ ] Nothing under `src/lib/notification/` imports `@supabase/supabase-js`, `node:fs`, React or any
      `.css` file, and nothing there calls `fetch`. Verifiable by search.
- [ ] No new entry in `package.json`.

**The message — `product-brief.md` §2, §8 and `design-reference.md`**

- [ ] **Headline first.** The first line states the decision — the transfer, or that the transfer is
      being rolled — with no preamble, no greeting, and no restatement of the deadline before it.
- [ ] **No emoji anywhere.** `design-reference.md` bans them explicitly, "including in Telegram
      notifications". No emoji character appears in `src/lib/notification/` or in any test fixture.
      Verifiable by search.
- [ ] **No decimal projected-points value appears in the message.** `product-brief.md` §8: the gap
      between the top options is routinely under a point and rendering decimals manufactures false
      confidence. Whole numbers only, from the display value item 13 already stores. Verifiable by
      search over the composed output in tests.
- [ ] **The confidence band appears in words** — clear, marginal, or coin-flip — and when the top
      options are indistinguishable, the message **says so plainly** rather than implying a
      preference.
- [ ] **When a hit is recommended, the message states the cost and the net explicitly**, both as
      whole numbers. §6d requires it.
- [ ] At least one reason line from `recommendation_reasons` is included. The message is not a bare
      instruction.
- [ ] Plan B is named in one line. Plan C is not sent — it lives in the app. *(Decided here; see
      Notes.)*
- [ ] **A recommendation resting on a player with no match history carries that fact in words**, per
      `product-brief.md` §8's data-coverage rule.
- [ ] British English, sentence case, plain verbs, FPL's own vocabulary — gameweek, fixture, clean
      sheet. No filler, no "AI" framing, no sparkle language.
- [ ] Money is `£8.5m`, one decimal, `£` symbol. Dates are `Sat 22 Aug`; times are 24-hour and
      Singapore. §8.
- [ ] The composed message for a fully worked example — a recommended transfer with a hit, a captain,
      a marginal band and one reason — is asserted **verbatim** in a named test. This is the single
      most useful test in the ticket.
- [ ] The message is under Telegram's 4,096-character limit, and a composition that would exceed it
      is truncated at a stated boundary with the headline and the decision always preserved. There is
      a named test with an oversized input.

**Staleness and failure — `product-brief.md` §6a, §6c, §6d**

- [ ] **No usable recommendation for the current gameweek sends a failure notice, not silence.** The
      notice says what failed and that no recommendation is available.
- [ ] **A recommendation derived from a solve that was not a proven optimum is labelled as such** in
      the message, and its band is not presented as better than it is. §6c: "a timed-out solution is
      usable but must be labelled."
- [ ] **A recommendation older than the current gameweek is never sent as current.** If the newest
      recommendation is for a past gameweek, the message states its age explicitly or the run sends
      the failure notice. §6a: "It must never present stale recommendations as current."
- [ ] An infeasible solve produces the specific message §6c requires — that the registered squad does
      not reconcile and should be re-checked — not a generic error.
- [ ] A non-2xx response from Telegram, or an unreachable host, fails the run loudly with a failed
      `job_runs` row carrying the status code and Telegram's own error text. No retry storm: at most
      three attempts with backoff.

**The notification log**

- [ ] The migration creates `notifications` — append-only, one row per send attempt, carrying the
      gameweek, the recommendation and plan it was built from, the message text actually sent, the
      send outcome, and `sent_at`.
- [ ] **The same migration issues `GRANT SELECT` to `anon` and `GRANT SELECT, INSERT` to
      `service_role`**, and enables RLS with a `SELECT` policy for `anon`. **No `UPDATE` and no
      `DELETE`** — this is a log, and withholding the privilege makes append-only a database
      guarantee rather than a promise. *(`deltas.md` D8.)*
- [ ] The migration is idempotent, with the same role guard every prior migration uses.
- [ ] **A row is written for a failed send as well as a successful one**, so silence is
      distinguishable from failure after the fact.
- [ ] The message text is stored as sent, so item 15 can tell whether the content has changed since
      the last send rather than re-deriving it.
- [ ] The job reads exactly `SUPABASE_URL`, `SUPABASE_SECRET_KEY`, `TELEGRAM_BOT_TOKEN` and
      `TELEGRAM_CHAT_ID`. No `VITE_`-prefixed variable.
- [ ] Every Supabase read uses the shared pagination helper.
- [ ] Scope constraint: only files under `src/lib/notification/`, `scripts/send-telegram.ts` and its
      test file, `supabase/migrations/20260818090000_notifications.sql`, a new
      `.github/workflows/send-notification.yml`, `.github/workflows/solver-run.yml`, and this
      ticket's own `decisions/ticket-<number>.md` are added or changed. **Plus any
      build-configuration file an instructed import genuinely requires, logged as a decision.**
      Nothing under `src/screens/`, `src/components/`, `src/index.css`, `index.html`,
      `src/lib/projection/`, `src/lib/scoring/`, `src/lib/squad/` or `src/lib/recommendation/`
      changes; no other file in `scripts/` changes; `package.json` is untouched.

## Notes for the Analyst / Builder

**Pre-answered so nobody guesses at 3am.**

- **Send Plan A in full, Plan B in one line, and leave Plan C to the app.** Tier 3, decided here.
  The whole point of the notification is that acknowledging it and deciding are the same act; three
  full plans in a phone notification reintroduces the decision fatigue this app exists to remove. If
  Plan A and Plan B are a coin-flip, that is what the band is for — say so and let him open the app.
- **The API call is one `POST` to `https://api.telegram.org/bot<token>/sendMessage`** with `chat_id`
  and `text`. Build the URL at runtime from the environment variable; never write a token-shaped
  string into the repo. Prefer plain text over Telegram's markdown modes — a player name containing
  an underscore or an asterisk will break a markdown parse and the failure will look like an API
  error rather than a formatting one.
- **`api.telegram.org` is reachable from a GitHub Action, which has unrestricted network access. It
  is very likely NOT reachable from inside a cloud run**, whose network policy covers GitHub, npm,
  Vercel, Supabase and the FPL API and nothing else (`deltas.md` D4). **So a live send cannot be
  tested from inside the pipeline.** Do not spend the run trying, and do not add the host to any
  allowlist. Compose-and-assert in tests; the real send is Keshav's post-merge check via
  `workflow_dispatch`.
- **The two secrets do not exist yet, and that is fine.** They are Tier 1 and Keshav creates them in
  Telegram himself. The unset path is a first-class behaviour, not an edge case — the workflow step
  runs, says the variables are unset, and exits zero.
- **This is a one-way sender, forever.** No webhook, no `getUpdates`, no command handling. An inbound
  channel means a URL that accepts input from the internet and a whole class of question this app has
  no reason to open. If a future ticket proposes it, that is a design conversation, not a build.
- **Do not send on a schedule in this ticket.** The step added to the existing workflow fires after a
  recommendation is generated, which is useful for testing and is not the product behaviour. Item 15
  owns the 24-hour and 10-hour timings and the deadline arithmetic, in Singapore time, and will move
  or gate this step.
- **Idempotency matters more than it looks.** Item 15 will call this twice per gameweek by design.
  The `notifications` log is what stops a re-run of the same workflow double-sending the identical
  message, and what lets item 15 ask "has this content already gone out?" Write the log **before**
  concluding success, and make the stored text exact.
- **Two other tickets are running in this batch.** One owns the home screen and its own new component;
  the other owns `scripts/calibration-report.ts` only. Neither touches `src/lib/notification/`,
  `scripts/send-telegram.ts` or `supabase/`. Stay inside the scope list and none of the three can
  collide.
- **What a substitute cannot catch.** Pure tests prove the composed message exactly — that is most
  of this ticket, and the verbatim assertion is why. They cannot prove Telegram accepts it, cannot
  prove the GRANTs (local Postgres runs as superuser — `deltas.md` D8), and cannot prove the message
  reads well on a phone at 11pm, which is the only test that actually matters. All three are
  Keshav's, after merge, once the bot exists.
