# Escalation tiers — the single canonical copy

<!-- Version: v0.2 — committed in Phase 4 (workplan task 4.6), revised at Phase 8.
     This is the ONE copy of the escalation tiers. The agent definitions in
     .claude/agents/ and the orchestrator routine prompt reference this file;
     none of them restate the tiers, so nothing can drift.
     Everything below this comment is verbatim from §4.5 of
     app-factory-system-design-v2.md (repo: KeshavPeri/app-factory).
     § references point into that document. -->

Three tiers. This is the safety mechanism of the whole system. Two structural rules first, both new in v2:

**Rule A — the tiers classify *decisions*, not just *questions*.** A Builder that never asks can still make a Tier 1 decision (adding health-data fields "as a sensible default," signing the app up for a service). Therefore: (i) the Analyst's evening lint pass checks each ticket's *scope* for Tier-1-adjacent territory before the run, and (ii) the decisions log classifies what was actually done, whether or not anyone asked.

**Rule B — a Tier 1 stop blocks the ticket, never the run.** The blocked card carries a one-line question the owner can answer from the phone. The orchestrator continues with the next Ready ticket.

**TIER 1 — STOP and wait for the human.** Ticket moves to Blocked.
- **Real money**: money moving to or from any account, payment credentials, paid tiers of any service. *In-game and in-app representations of money (FPL budgets, prices, "bank") are Tier 3 — see §3 note 3.*
- **Personal data**: storing, transmitting, or newly collecting the owner's personal information — including health, body and location data. Displaying a timezone the brief already specifies is Tier 3.
- **Accounts and credentials**: anything requiring a new account, sign-up, API key, secret, or credential — regardless of whether it is free. Creating accounts is an owner-only action.
- **Destructive operations on live data**: any migration or operation that deletes or irreversibly transforms data in the live Supabase instance. (Deleting code, test fixtures, or seed data is Tier 2.)
- Anything otherwise sensitive.

**TIER 2 — Decide, proceed, but flag as HIGH-IMPACT in the decisions log.**
The test question is primary: *"Would this be expensive to reverse after ten more tickets are built on top of it?"* The list below gives examples of it, not a substitute for it:
- How data is structured
- Deleting code, test data, or seed data
- Committing to an outside service that creates a dependency (where no new credential is needed — otherwise Tier 1)
- **Framework and major-library choices** (charting library, CSS framework, state management) — these read like "conventions" but fail the test question. *(New in v2 — the v1 examples and test question disagreed here.)*

**TIER 3 — Decide, proceed, log normally.**
Everything else: conventions, layout, formatting, sensible defaults, in-game currency display, locale formatting already specified in the brief.

**Order of operations for any question:** the Analyst must first check whether the product brief already answers it. Only if the brief is silent does it reason or research.

**Calibration warning (from the review's scenario tests):** the failure mode of a too-literal Tier 1 is not just annoyance — it is that repeated false alarms pressure the owner into loosening the wording, and the looseness then leaks into real cases. Definitions above are drawn tightly on purpose. If Tier 1 fires wrongly twice on the same pattern, fix the *brief* (state the answer there) before touching the tier definitions.
