"""Exact minimum cover. Combinations are visited smallest size first.

A visit above maxCoverVisits is SEARCH_BOUND_EXCEEDED.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from functools import cmp_to_key

from .jsoncanon import Json, digest_json, utf16_units
from .kar_closure import Admission
from .kar_model import FRONTIERS, Plan, floor_micros, lookup_floor, lookup_requirement


@dataclass
class Choice:
    evidence_id: str
    frontiers: list[str]


@dataclass
class CoveragePair:
    covered: int
    required: int


@dataclass
class Rational:
    numerator: int
    denominator: int


@dataclass
class Decision:
    status: str
    profile: str
    cardinality: int
    coverage: list[tuple[str, CoveragePair]]
    redundancy: Rational | None = None


@dataclass
class CoverOutcome:
    status: str
    evidence_ids: list[str]
    choices: list[Choice]
    decision: Decision


@dataclass
class _Candidate:
    id: str
    mask: str = ""
    requirements: list[tuple[str, set[str]]] = field(default_factory=list)
    nonempty: set[str] = field(default_factory=set)
    tokens: list[str] = field(default_factory=list)
    bits: list[tuple[str, set[int]]] = field(default_factory=list)


@dataclass
class _Rat:
    n: int
    d: int


@dataclass
class _ScoredCombo:
    combo: list[_Candidate]
    pairs: list[tuple[str, CoveragePair]]
    counts: list[tuple[str, int]]


def select_cover(
    plan: Plan, admissions: list[Admission], texts: list[tuple[str, str]]
) -> CoverOutcome:
    micros = _frontier_micros(plan)
    base = _build_candidates(plan, admissions, texts)
    pool = _minimum_cover_pool(plan, base)
    limit = plan.bounds.max_cover_visits
    visits = 0
    max_size = max(0, min(plan.cardinality_bound, len(pool)))
    if plan.profile == "minimum-cover":
        for size in range(max_size + 1):
            matched: tuple[list[_Candidate], list[tuple[str, CoveragePair]]] | None = None

            def on_combo(combo: list[_Candidate], matched_box=None) -> bool:
                nonlocal matched
                scored = _coverage_of(plan, combo, micros)
                if scored[0]:
                    matched = (list(combo), scored[1])
                    return True
                return False

            exceeded = _visit_combinations(pool, size, visits, limit, on_combo)
            visits = exceeded[1]
            if exceeded[0]:
                return _finish(plan, "SEARCH_BOUND_EXCEEDED", [], None)
            if matched is not None:
                return _finish(plan, "SATISFIED", matched[0], None)
        return _finish(plan, "UNSATISFIED_EVIDENCE_REQUIREMENTS", [], None)

    best: _ScoredCombo | None = None
    for size in range(max_size + 1):
        feasible: list[_ScoredCombo] = []

        def on_combo(combo: list[_Candidate]) -> bool:
            scored_ok, pairs, counts = _coverage_of(plan, combo, micros)
            if scored_ok:
                feasible.append(_ScoredCombo(list(combo), pairs, counts))
            return False

        exceeded = _visit_combinations(pool, size, visits, limit, on_combo)
        visits = exceeded[1]
        if exceeded[0]:
            return _finish(plan, "SEARCH_BOUND_EXCEEDED", [], None)
        if plan.profile == "minimum-cover-redundancy-v1" and feasible:
            feasible.sort(key=cmp_to_key(_cmp_feasible))
            winner = feasible[0]
            return _finish(plan, "SATISFIED", winner.combo, _redundancy(winner.combo))
        if plan.profile == "exp1-lexicographic":
            for item in feasible:
                if best is None or _better_exp1(item, best):
                    best = item
    if best is not None:
        return _finish(plan, "SATISFIED", best.combo, None)
    return _finish(plan, "UNSATISFIED_EVIDENCE_REQUIREMENTS", [], None)


def covers_plan(
    plan: Plan,
    admissions: list[Admission],
    texts: list[tuple[str, str]],
    evidence_ids: list[str],
) -> bool:
    micros = _frontier_micros(plan)
    base = _build_candidates(plan, admissions, texts)
    chosen = [candidate for candidate in base if candidate.id in evidence_ids]
    return _coverage_of(plan, chosen, micros)[0]


def _frontier_micros(plan: Plan) -> list[tuple[str, int]]:
    return [
        (frontier, floor_micros(lookup_floor(plan, frontier)) or 0) for frontier in FRONTIERS
    ]


def _visit_combinations(
    pool: list[_Candidate],
    size: int,
    visits: int,
    limit: int,
    on_combo,
) -> tuple[bool, int]:
    if size == 0:
        visits += 1
        if visits > limit:
            return True, visits
        on_combo([])
        return False, visits
    if size > len(pool):
        return False, visits
    index = list(range(size))
    while True:
        visits += 1
        if visits > limit:
            return True, visits
        combo = [pool[offset] for offset in index]
        if on_combo(combo):
            return False, visits
        if not _next_combination(index, len(pool)):
            return False, visits


def _next_combination(index: list[int], count: int) -> bool:
    size = len(index)
    cursor = size - 1
    while cursor >= 0 and index[cursor] == count - size + cursor:
        cursor -= 1
    if cursor < 0:
        return False
    index[cursor] += 1
    nxt = cursor + 1
    while nxt < size:
        index[nxt] = index[nxt - 1] + 1
        nxt += 1
    return True


def _build_candidates(
    plan: Plan, admissions: list[Admission], texts: list[tuple[str, str]]
) -> list[_Candidate]:
    grouped: list[_Candidate] = []
    text_by_id = {row_id: text for row_id, text in texts}
    for admission in admissions:
        if not admission.applicable:
            continue
        candidate = next((item for item in grouped if item.id == admission.evidence_id), None)
        if candidate is None:
            candidate = _Candidate(
                id=admission.evidence_id,
                tokens=_ascii_tokens(text_by_id.get(admission.evidence_id, "")),
            )
            grouped.append(candidate)
        candidate.nonempty.add(admission.frontier)
        bucket = next(
            (items for frontier, items in candidate.requirements if frontier == admission.frontier),
            None,
        )
        if bucket is None:
            candidate.requirements.append((admission.frontier, set(admission.requirements)))
        else:
            bucket.update(admission.requirements)
    candidates = [
        candidate
        for candidate in grouped
        if (
            candidate.nonempty
            if plan.coverage_mode == "nonempty"
            else _mask_key(candidate.requirements, candidate.nonempty, plan)
        )
    ]
    for candidate in candidates:
        candidate.mask = _mask_key(candidate.requirements, candidate.nonempty, plan)
        candidate.bits = _requirement_bits(plan, candidate.requirements)
    candidates.sort(key=lambda item: utf16_units(item.id))
    return candidates


def _minimum_cover_pool(plan: Plan, base: list[_Candidate]) -> list[_Candidate]:
    if plan.profile != "minimum-cover":
        return list(base)
    best: list[_Candidate] = []
    for candidate in base:
        current = next((item for item in best if item.mask == candidate.mask), None)
        if current is None:
            best.append(candidate)
        elif utf16_units(candidate.id) < utf16_units(current.id):
            best[best.index(current)] = candidate
    best.sort(key=lambda item: utf16_units(item.id))
    return best


def _mask_key(
    requirements: list[tuple[str, set[str]]], nonempty: set[str], plan: Plan
) -> str:
    if plan.coverage_mode == "nonempty":
        ids = sorted(nonempty, key=utf16_units)
        return ",".join(ids)
    parts: list[str] = []
    for frontier in FRONTIERS:
        have = next((items for name, items in requirements if name == frontier), set())
        required = lookup_requirement(plan, frontier)
        ids = sorted((item for item in have if item in required), key=utf16_units)
        if ids:
            parts.append(f"{frontier}={'+'.join(ids)}")
    return "|".join(parts)


def _requirement_bits(
    plan: Plan, requirements: list[tuple[str, set[str]]]
) -> list[tuple[str, set[int]]]:
    bits: list[tuple[str, set[int]]] = []
    for frontier in FRONTIERS:
        mask: set[int] = set()
        if plan.coverage_mode == "requirements":
            have = next((items for name, items in requirements if name == frontier), None)
            if have is not None:
                for index, requirement in enumerate(lookup_requirement(plan, frontier)):
                    if requirement in have:
                        mask.add(index)
        bits.append((frontier, mask))
    return bits


def _coverage_of(
    plan: Plan, chosen: list[_Candidate], micros: list[tuple[str, int]]
) -> tuple[bool, list[tuple[str, CoveragePair]], list[tuple[str, int]]]:
    pairs: list[tuple[str, CoveragePair]] = []
    counts: list[tuple[str, int]] = []
    ok = True
    for frontier in FRONTIERS:
        required_list = lookup_requirement(plan, frontier)
        if plan.coverage_mode == "requirements":
            required = len(required_list)
            if required == 0:
                covered = 0
            else:
                mask: set[int] = set()
                for candidate in chosen:
                    bits = next((items for name, items in candidate.bits if name == frontier), set())
                    mask.update(bits)
                covered = len(mask)
        else:
            covered = 1 if any(frontier in candidate.nonempty for candidate in chosen) else 0
            required = 1
        micro = next((value for name, value in micros if name == frontier), 0)
        if not _passes(covered, required, micro):
            ok = False
        pairs.append((frontier, CoveragePair(covered, required)))
        counts.append((frontier, covered))
    return ok, pairs, counts


def _passes(covered: int, required: int, micros: int) -> bool:
    if required == 0:
        return True
    return covered * 1_000_000 >= micros * required


def _zero_pairs(plan: Plan) -> list[tuple[str, CoveragePair]]:
    pairs = []
    for frontier in FRONTIERS:
        required = (
            len(lookup_requirement(plan, frontier))
            if plan.coverage_mode == "requirements"
            else 1
        )
        pairs.append((frontier, CoveragePair(0, required)))
    return pairs


def _finish(
    plan: Plan,
    status: str,
    combo: list[_Candidate],
    redundant: _Rat | None,
) -> CoverOutcome:
    evidence_ids = sorted((candidate.id for candidate in combo), key=utf16_units)
    choices: list[Choice] = []
    for evidence_id in evidence_ids:
        candidate = next(item for item in combo if item.id == evidence_id)
        frontiers = sorted(candidate.nonempty, key=utf16_units)
        choices.append(Choice(evidence_id, frontiers))
    recorded = (
        _coverage_of(plan, combo, _frontier_micros(plan))[1]
        if status == "SATISFIED"
        else _zero_pairs(plan)
    )
    redundancy = None
    if status == "SATISFIED" and plan.profile == "minimum-cover-redundancy-v1" and redundant is not None:
        redundancy = Rational(redundant.n, redundant.d)
    decision = Decision(
        status,
        plan.profile,
        len(evidence_ids) if status == "SATISFIED" else 0,
        recorded,
        redundancy,
    )
    return CoverOutcome(status, evidence_ids, choices, decision)


def decision_json(decision: Decision) -> Json:
    pairs: list[tuple[str, Json]] = [
        ("cardinality", Json.int(decision.cardinality)),
        (
            "coverage",
            Json.object(
                [
                    (
                        frontier,
                        Json.object(
                            [
                                ("covered", Json.int(pair.covered)),
                                ("required", Json.int(pair.required)),
                            ]
                        ),
                    )
                    for frontier, pair in decision.coverage
                ]
            ),
        ),
        ("profile", Json.string(decision.profile)),
        ("status", Json.string(decision.status)),
    ]
    if decision.redundancy is not None:
        pairs.append(
            (
                "redundancy",
                Json.object(
                    [
                        ("denominator", Json.int(decision.redundancy.denominator)),
                        ("numerator", Json.int(decision.redundancy.numerator)),
                    ]
                ),
            )
        )
    return Json.object(pairs)


def choices_json(choices: list[Choice]) -> Json:
    return Json.array(
        [
            Json.object(
                [
                    ("evidenceId", Json.string(choice.evidence_id)),
                    (
                        "frontiers",
                        Json.array([Json.string(frontier) for frontier in choice.frontiers]),
                    ),
                ]
            )
            for choice in choices
        ]
    )


def evidence_set_root(choices: list[Choice]) -> str:
    return digest_json(choices_json(choices))


def decision_root(decision: Decision) -> str:
    return digest_json(decision_json(decision))


def _ascii_tokens(text: str) -> list[str]:
    folded = "".join(char.lower() if char.isascii() and char.isupper() else char for char in text)
    tokens: list[str] = []
    current: list[str] = []
    for char in folded:
        if char.isascii() and (char.isdigit() or "a" <= char <= "z"):
            current.append(char)
        elif current:
            tokens.append("".join(current))
            current = []
    if current:
        tokens.append("".join(current))
    return tokens


def _redundancy(items: list[_Candidate]) -> _Rat:
    if len(items) < 2:
        return _Rat(0, 1)
    sum_n = 0
    sum_d = 1
    pairs = 0
    for left in range(len(items)):
        for right in range(left + 1, len(items)):
            part = _jaccard(items[left].tokens, items[right].tokens)
            sum_n = sum_n * part.d + part.n * sum_d
            sum_d *= part.d
            divisor = _gcd(sum_n, sum_d)
            sum_n //= divisor
            sum_d //= divisor
            pairs += 1
    return _reduce(sum_n, pairs * sum_d)


def _jaccard(left_tokens: list[str], right_tokens: list[str]) -> _Rat:
    left = set(left_tokens)
    right = set(right_tokens)
    if not left and not right:
        return _Rat(1, 1)
    inter = len(left & right)
    union = len(left) + len(right) - inter
    if union == 0:
        return _Rat(0, 1)
    return _Rat(inter, union)


def _gcd(left: int, right: int) -> int:
    x = abs(left)
    y = abs(right)
    while y:
        x, y = y, x % y
    return x or 1


def _reduce(numerator: int, denominator: int) -> _Rat:
    if denominator < 0:
        numerator = -numerator
        denominator = -denominator
    divisor = _gcd(numerator, denominator)
    return _Rat(numerator // divisor, denominator // divisor)


def _compare_rat(left: _Rat, right: _Rat) -> int:
    cross_left = left.n * right.d
    cross_right = right.n * left.d
    return (cross_left > cross_right) - (cross_left < cross_right)


def _cmp_feasible(left: _ScoredCombo, right: _ScoredCombo) -> int:
    order = _compare_rat(_redundancy(left.combo), _redundancy(right.combo))
    if order:
        return order
    left_ids = utf16_units(_join_ids(left.combo))
    right_ids = utf16_units(_join_ids(right.combo))
    return (left_ids > right_ids) - (left_ids < right_ids)


def _join_ids(combo: list[_Candidate]) -> str:
    return "\0".join(item.id for item in combo)


def _better_exp1(left: _ScoredCombo, right: _ScoredCombo) -> bool:
    for frontier in ("F_O", "F_S", "F_Q", "F_T", "F_A"):
        left_count = next((value for name, value in left.counts if name == frontier), 0)
        right_count = next((value for name, value in right.counts if name == frontier), 0)
        if left_count != right_count:
            return left_count > right_count
    if len(left.combo) != len(right.combo):
        return len(left.combo) < len(right.combo)
    return utf16_units(_join_ids(left.combo)) < utf16_units(_join_ids(right.combo))
