"""Pure FPL rule arithmetic for the season replay (ticket #281). No I/O, no solver, no network --
every function here takes plain Python/numeric arguments and returns a plain value, so it is
provable with `pytest` alone (`model/tests/test_replay.py`).

Prices and money are always in TENTHS of a million (`945` = GBP 9.45m), the same convention
`players.now_cost` and vaastav's `value` column already use elsewhere in this repo
(`model/fpl_model/sources.py`, `scripts/build-solver-input.ts`). `£100.0m` is therefore `1000`.

Rules implemented, each named after the ticket line that specifies it:
  - `selling_price` -- the FPL sell-price rule (ticket #281 item 2).
  - `next_free_transfers` -- FT banking, capped at 5 (item 3).
  - `hit_count` / `hit_points_cost` -- -4 (or whatever `hit_cost` is under test) per transfer
    beyond the free allowance (item 3/5).
  - `validate_squad_composition`, `check_budget`, `check_club_limit` -- the 15-man / £100.0m /
    max-3-per-club constraints (item 3).
  - `score_lineup` -- starting XI, captain doubled, no auto-subs (item 3).
  - `pick_best_lineup` -- the pure best-XI-and-captain selector used for the never-transfer
    baseline (see replay.py's module docstring for why that baseline does not call the solver).
"""
from __future__ import annotations

from dataclasses import dataclass
from itertools import product

# ---------------------------------------------------------------------------
# Squad shape constants -- standard FPL rules, unchanged for years (verified
# against the live bootstrap-static `element_types` payload).
# ---------------------------------------------------------------------------

SQUAD_SIZE = 15
LINEUP_SIZE = 11
MAX_PER_CLUB = 3
STARTING_BUDGET_TENTHS = 1000  # £100.0m
MAX_BANKED_FT = 5

# element_type id -> squad_select (how many of this position in a 15-man squad).
SQUAD_SELECT = {'GK': 2, 'DEF': 5, 'MID': 5, 'FWD': 3}
# element_type id -> (squad_min_play, squad_max_play) in the starting XI.
LINEUP_MIN_MAX = {'GK': (1, 1), 'DEF': (3, 5), 'MID': (2, 5), 'FWD': (1, 3)}

POSITIONS = ('GK', 'DEF', 'MID', 'FWD')


# ---------------------------------------------------------------------------
# Prices
# ---------------------------------------------------------------------------

def selling_price(purchase_price: int, current_price: int) -> int:
    """The FPL sell-price rule (ticket #281 item 2, product-brief.md's in-game-money Tier 3
    note): `purchase + floor((current - purchase) / 2)` when the player has risen in price,
    else `current` (a player who has fallen, or stayed flat, sells for exactly his current
    price -- FPL never charges a fall against the seller). All three values are tenths of a
    million; the floor is integer division on tenths, matching FPL's own rounding (a rise of
    3 tenths sells for +1, not +1.5)."""
    if current_price > purchase_price:
        return purchase_price + (current_price - purchase_price) // 2
    return current_price


# ---------------------------------------------------------------------------
# Free-transfer banking
# ---------------------------------------------------------------------------

def next_free_transfers(available_ft: int, transfers_made: int, cap: int = MAX_BANKED_FT) -> int:
    """FTs available NEXT gameweek: whatever is left after this week's transfers, plus the one
    earned every week, capped at `cap` (5 -- ticket #281 item 3 / product-brief.md §6d "up to
    five free transfers may be rolled"). Mirrors the pinned solver's own `raw_gw_ft` clamp
    (`dev/solver.py`: `fts[w] - transfer_count[w] + 1`, clamped to `[1, 5]`) -- except this
    function has no floor of 1 imposed externally; `available_ft - transfers_made` cannot go
    negative here because `transfers_made` beyond `available_ft` is priced as a hit (see
    `hit_count`) rather than borrowed against next week's allowance, so the remainder is always
    >= 0 before the +1."""
    remaining = max(0, available_ft - transfers_made)
    return min(cap, remaining + 1)


def hit_count(transfers_made: int, available_ft: int) -> int:
    """How many of this week's transfers were paid transfers (beyond the free allowance)."""
    return max(0, transfers_made - available_ft)


def hit_points_cost(transfers_made: int, available_ft: int, hit_cost: int) -> int:
    """Points lost to hits this gameweek: `hit_count(...) * hit_cost`. `hit_cost=None` means the
    "no hits" setting under test (ticket #281 item 5, FT-only) -- any paid transfer is simply
    forbidden upstream (the solver's own pool never proposes one when `hit_cost` is large enough
    to never be worth taking; see solver_io.NO_HITS_SENTINEL), so this still returns 0 for 0
    hits and is never asked to price a hit that should have been impossible."""
    return hit_count(transfers_made, available_ft) * hit_cost


# ---------------------------------------------------------------------------
# Budget / composition checks
# ---------------------------------------------------------------------------

def check_budget(total_squad_value_tenths: int, bank_tenths: int, budget_tenths: int = STARTING_BUDGET_TENTHS) -> bool:
    """True iff the squad's value plus what's left in the bank does not exceed the season's
    starting budget (£100.0m) -- money is never created or destroyed by a transfer, so this
    must hold at every gameweek, not just gameweek 1."""
    return total_squad_value_tenths + bank_tenths <= budget_tenths


def check_club_limit(team_codes: list[int], max_per_club: int = MAX_PER_CLUB) -> bool:
    """True iff no club appears more than `max_per_club` times in the squad."""
    counts: dict[int, int] = {}
    for code in team_codes:
        counts[code] = counts.get(code, 0) + 1
    return all(n <= max_per_club for n in counts.values())


def validate_squad_composition(positions: list[str], team_codes: list[int],
                                total_squad_value_tenths: int, bank_tenths: int,
                                budget_tenths: int = STARTING_BUDGET_TENTHS) -> list[str]:
    """Every squad-level invariant the ticket's DoD names (15-man squad, budget, max-3-per-club),
    checked together and returned as a list of human-readable violation strings -- empty means
    valid. `positions` and `team_codes` are parallel lists, one entry per squad player."""
    problems: list[str] = []
    if len(positions) != SQUAD_SIZE:
        problems.append(f'squad has {len(positions)} players, expected {SQUAD_SIZE}')
    counts: dict[str, int] = {pos: 0 for pos in POSITIONS}
    for pos in positions:
        counts[pos] = counts.get(pos, 0) + 1
    for pos, expected in SQUAD_SELECT.items():
        if counts.get(pos, 0) != expected:
            problems.append(f'squad has {counts.get(pos, 0)} {pos}, expected {expected}')
    if not check_club_limit(team_codes):
        problems.append(f'a club has more than {MAX_PER_CLUB} players in the squad')
    if not check_budget(total_squad_value_tenths, bank_tenths, budget_tenths):
        problems.append(
            f'squad value {total_squad_value_tenths} + bank {bank_tenths} exceeds budget {budget_tenths}'
        )
    return problems


# ---------------------------------------------------------------------------
# Scoring -- starting XI, captain doubled, no auto-subs (ticket #281 item 3).
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class LineupPlayer:
    code: int
    position: str
    points: float


def score_lineup(lineup: list[LineupPlayer], captain_code: int) -> float:
    """Sum of the starting XI's actual points, captain doubled. No auto-subs: a lineup player who
    scored 0 (blank gameweek, benched by his club, injury on the day) simply contributes 0 -- the
    ticket's own item 3 ("No auto-subs; score the solver's starting XI with captain x2")."""
    total = 0.0
    captain_found = False
    for p in lineup:
        total += p.points
        if p.code == captain_code:
            total += p.points  # captain scores double: add his points a second time
            captain_found = True
    if not captain_found:
        raise ValueError(f'captain_code {captain_code} is not in the lineup')
    return total


# ---------------------------------------------------------------------------
# Never-transfer baseline: pick the best XI + captain from a FIXED squad by pure enumeration
# (see replay.py's module docstring for why this baseline does not call the solver).
# ---------------------------------------------------------------------------

def pick_best_lineup(squad: list[LineupPlayer]) -> tuple[list[LineupPlayer], int]:
    """The best-scoring valid starting XI (1 GK, 3-5 DEF, 2-5 MID, 1-3 FWD, summing to 11) from a
    fixed 15-man squad, by projected/actual `points` (whichever the caller passed in), plus its
    captain (the highest-scoring lineup player). Squad-shape constraints (`LINEUP_MIN_MAX`)
    leave only 8 valid (DEF, MID, FWD) formations once GK=1 and the total is fixed at 11 --
    exhaustively enumerated (never a heuristic), each one filled by taking the top-N players at
    that position by `points`. Ties broken by input order (stable sort), which is deterministic
    but otherwise arbitrary -- not specified by the ticket."""
    if len(squad) != SQUAD_SIZE:
        raise ValueError(f'expected a {SQUAD_SIZE}-man squad, got {len(squad)}')
    by_pos: dict[str, list[LineupPlayer]] = {pos: [] for pos in POSITIONS}
    for p in squad:
        if p.position not in by_pos:
            raise ValueError(f'unknown position {p.position!r} for player {p.code}')
        by_pos[p.position].append(p)
    for pos in POSITIONS:
        by_pos[pos].sort(key=lambda p: p.points, reverse=True)

    best_total = float('-inf')
    best_lineup: list[LineupPlayer] | None = None

    gk_lo, gk_hi = LINEUP_MIN_MAX['GK']
    def_lo, def_hi = LINEUP_MIN_MAX['DEF']
    mid_lo, mid_hi = LINEUP_MIN_MAX['MID']
    fwd_lo, fwd_hi = LINEUP_MIN_MAX['FWD']

    for n_gk, n_def, n_mid, n_fwd in product(
        range(gk_lo, gk_hi + 1), range(def_lo, def_hi + 1),
        range(mid_lo, mid_hi + 1), range(fwd_lo, fwd_hi + 1),
    ):
        if n_gk + n_def + n_mid + n_fwd != LINEUP_SIZE:
            continue
        if any(len(by_pos[pos]) < n for pos, n in
               zip(POSITIONS, (n_gk, n_def, n_mid, n_fwd))):
            continue
        candidate = by_pos['GK'][:n_gk] + by_pos['DEF'][:n_def] + by_pos['MID'][:n_mid] + by_pos['FWD'][:n_fwd]
        total = sum(p.points for p in candidate)
        if total > best_total:
            best_total = total
            best_lineup = candidate

    if best_lineup is None:
        raise ValueError('no valid formation fits this squad (check position counts)')

    captain = max(best_lineup, key=lambda p: p.points)
    return best_lineup, captain.code
