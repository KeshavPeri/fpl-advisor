-- feature_history: prior_recent_minutes — the true last-five-match minutes
-- window, stored as substrate for a follow-up ticket.
--
-- Ticket #181. STORES SUBSTRATE ONLY -- making the backtest consume this
-- column is a follow-up ticket's entire job. Nothing about the backtest's
-- numbers changes when this migration is applied; scripts/run-backtest.ts is
-- untouched.
--
-- WHY THIS EXISTS. The backtest has been grading the model on a blurred
-- version of its own inputs. scripts/run-backtest.ts's buildRecentMinutes
-- returns an array of exactly one synthetic match -- the player's average
-- minutes across all prior matches -- while the live model calls
-- estimateMinutes() (src/lib/projection/minutes.ts) with the player's last
-- five ACTUAL matches (RECENT_MATCH_COUNT = 5, exported from that same
-- module). Feeding the backtest one averaged match instead of a true
-- last-five window destroys the distinction between a nailed starter and a
-- rotation player -- exactly the signal minutes carry. This column stores
-- the true window so a follow-up ticket can make the backtest read it
-- instead of reconstructing an average.
--
-- WHAT IT HOLDS. The minutes played in this player's most recent Premier
-- League matches with a resolvable player_code -- the SAME contributing-row
-- set feature_history's existing prior_* cumulative totals are built from
-- (public.player_match_stats.competition = 'prem', player_code NOT NULL) --
-- STRICTLY BEFORE gameweek_id, most recent first, capped at
-- RECENT_MATCH_COUNT (5). NOT filtered by any minutes-played threshold:
-- cameo appearances count, matching estimateMinutes()'s own window exactly
-- -- that function deliberately does NOT apply the 60-minute qualifying
-- filter src/lib/projection/defconRate.ts's isQualifyingMatch() uses for its
-- own, unrelated metric (prior_defcon_qualifying_matches on this same
-- table). "Qualifying" in this column's sense means only "counts toward
-- feature_history's totals at all" -- never a minutes threshold.
--
-- AN integer[] COLUMN, NOT FIVE SEPARATE ONES -- the *because*.
-- src/lib/projection/minutes.ts's estimateMinutes(recentMinutes: readonly
-- number[], availability) already takes an array, and RECENT_MATCH_COUNT is
-- an exported constant in that module. Storing an array means the window
-- length is defined by code, in one place; changing it later needs no
-- migration. Five fixed columns would put that same constant in the schema
-- as well, in a second place that can drift from the first.
--
-- NULLABLE, NO DEFAULT -- same reasoning as every previous "raw fact the
-- source may not always resolve" column in this repo (element_type,
-- team_code, the two defcon counters). A row written before this migration
-- genuinely has no value -- that is a different fact from a real empty
-- array (a player with zero prior matches, e.g. his first ingested
-- gameweek) and must not be defaulted into looking like one. A rebuild via
-- scripts/build-feature-history.ts (hand-run, upsert-only, same pattern
-- every earlier back-stamped column used) fills every row going forward;
-- there is no separate backfill script.
--
-- NO NEW GRANT NEEDED. The statement below is ADD COLUMN on a table that
-- already exists with its GRANTs already in place
-- (20260827090000_feature_history.sql) -- a table-level grant, not a
-- column-level one, so it covers this new column automatically. Same
-- precedent as the #146/#167/#176 migrations on this and other tables.
--
-- Idempotent by construction: ADD COLUMN IF NOT EXISTS. Running this file
-- twice against the same database is safe and creates nothing new the
-- second time.

BEGIN;

ALTER TABLE public.feature_history ADD COLUMN IF NOT EXISTS prior_recent_minutes integer[];

COMMENT ON COLUMN public.feature_history.prior_recent_minutes IS
  'This player''s minutes played in his most recent Premier League matches '
  'with a resolvable player_code (the same contributing-row set prior_matches '
  'and every other prior_* total are built from), STRICTLY BEFORE '
  'gameweek_id, MOST RECENT FIRST, capped at RECENT_MATCH_COUNT (5, exported '
  'from src/lib/projection/minutes.ts). NOT filtered by any minutes-played '
  'threshold -- cameo appearances count, matching estimateMinutes()''s own '
  'window (never the unrelated 60-minute isQualifyingMatch() rule '
  'prior_defcon_qualifying_matches on this same table uses). Array length is '
  'min(prior_matches, 5) by construction: shorter than 5 early in a player''s '
  'history, empty ([]) on a row with prior_matches = 0, and 0/NULL-as-zero is '
  'never used for either. NULL means this row predates this column or was '
  'never rebuilt after it was added -- a genuine "not yet computed" gap, '
  'distinct from a real empty array. See ticket #181. STORES SUBSTRATE ONLY: '
  'making scripts/run-backtest.ts read this column instead of its own '
  'single-averaged-match reconstruction is a follow-up ticket''s job, not '
  'this column''s.';

COMMIT;
