"""KITE certificate replay.

The world snapshot is the derivation input. This module does not search an image.
A passing replay means the certificate matches the declared rules and changes.
"""

from __future__ import annotations

from dataclasses import dataclass

from .jsoncanon import Json, JsonError, parse_json, stringify
from .v5 import _cbor_encode, _digest_domain


@dataclass
class KiteDerivation:
    verdict: str
    base_world: str | None
    question: str
    as_of: str | None
    state_root: str
    semantic_root: str | None
    agrees: bool
    witness: list[str] | None
    worlds_checked: int
    variants_checked: int
    counterfactual_changes: int
    invariance_root: str | None
    negative_collections: list[str]
    obligation_ids: list[str]
    source_partitions: list[str]
    met: list[str]
    unmet: list[str]


@dataclass
class KiteVerification:
    ok: bool
    code: str
    message: str


@dataclass
class _Obligation:
    id: str
    kind: str
    met: bool
    hit_ids: list[str]
    sources: list[str]


@dataclass
class _Change:
    id: str
    kind: str
    obligation_id: str


@dataclass
class _Conflict:
    left: str
    right: str


@dataclass
class _CompletenessRule:
    id: str
    collection: str
    obligation_id: str


@dataclass
class _Declaration:
    id: str
    collection: str
    signed: bool


@dataclass
class _Rules:
    format: str
    proposition: str
    support: list[str]
    oppose: list[str]
    require: list[str]
    conflicts: list[_Conflict]
    completeness: list[_CompletenessRule]


@dataclass
class _Bounds:
    max_graph_nodes: int
    max_variants: int
    max_counterfactual_changes: int
    max_retrievals: int


@dataclass
class _World:
    format: str
    question: str
    as_of: str | None
    state_root: str
    semantic_root: str | None
    obligations: list[_Obligation]
    rules: _Rules
    declarations: list[_Declaration]
    changes: list[_Change]
    bounds: _Bounds


def derive_kite_world(world_json: str) -> KiteDerivation:
    world = _parse_world(parse_json(world_json))
    return _derive_world(world)


def replay_kite_certificate(world_json: str, certificate_json: str) -> KiteVerification:
    try:
        derived = derive_kite_world(world_json)
    except (JsonError, ValueError) as error:
        return KiteVerification(False, "KITE_CERTIFICATE_MISMATCH", str(error))
    try:
        claimed = _parse_certificate(parse_json(certificate_json))
    except (JsonError, ValueError) as error:
        return KiteVerification(False, "KITE_CERTIFICATE_MISMATCH", str(error))
    if derived.verdict == "BOUND_EXCEEDED" or derived.invariance_root is None:
        return KiteVerification(
            False, "KITE_CERTIFICATE_MISMATCH", "An unfinished search is not a certificate."
        )
    if claimed != derived:
        return KiteVerification(
            False, "KITE_CERTIFICATE_MISMATCH", "Certificate does not match a fresh derivation."
        )
    return KiteVerification(True, "", "")


def _derive_world(world: _World) -> KiteDerivation:
    obligation_ids = sorted(item.id for item in world.obligations)
    source_partitions = sorted(
        {source for item in world.obligations if item.met for source in item.sources}
    )
    negative_collections = sorted({rule.collection for rule in world.rules.completeness})
    met = [item.id for item in world.obligations if item.met]
    unmet = [item.id for item in world.obligations if not item.met]
    try:
        count = _subset_count(len(world.changes), world.bounds.max_counterfactual_changes)
    except ValueError:
        return _empty_bound(obligation_ids, source_partitions, negative_collections, met, unmet)
    if count > world.bounds.max_variants:
        return _empty_bound(obligation_ids, source_partitions, negative_collections, met, unmet)
    limit = min(world.bounds.max_counterfactual_changes, len(world.changes))
    worlds: list[tuple[list[str], str]] = []
    for size in range(limit + 1):
        for subset in _combinations(world.changes, size):
            met_now = _apply(world.obligations, subset)
            worlds.append(([change.id for change in subset], _label(world, met_now)))
    base = worlds[0][1] if worlds else "UNDERDETERMINED"
    agrees = all(item[1] == base for item in worlds)
    witness = next((item[0] for item in worlds if item[1] != base), None)
    return KiteDerivation(
        _scope_verdict(base, agrees),
        base,
        world.question,
        world.as_of,
        world.state_root,
        world.semantic_root,
        agrees,
        witness,
        len(worlds),
        len(worlds),
        len(witness) if witness is not None else 0,
        _invariance_root(world),
        negative_collections,
        obligation_ids,
        source_partitions,
        met,
        unmet,
    )


def _empty_bound(
    obligation_ids: list[str],
    source_partitions: list[str],
    negative_collections: list[str],
    met: list[str],
    unmet: list[str],
) -> KiteDerivation:
    return KiteDerivation(
        "BOUND_EXCEEDED",
        None,
        "",
        None,
        "",
        None,
        False,
        None,
        0,
        0,
        0,
        None,
        negative_collections,
        obligation_ids,
        source_partitions,
        met,
        unmet,
    )


def _label(world: _World, met: set[str]) -> str:
    support = any(item in met for item in world.rules.support)
    oppose = any(item in met for item in world.rules.oppose)
    signed = {item.id for item in world.declarations}
    covered = {
        rule.obligation_id
        for rule in world.rules.completeness
        if rule.obligation_id not in met and rule.id in signed
    }
    open_require = any(item not in met and item not in covered for item in world.rules.require)
    if oppose and not support:
        return "REFUTED"
    if open_require:
        return "UNDERDETERMINED"
    paired = any(pair.left in met and pair.right in met for pair in world.rules.conflicts)
    if (support and oppose) or paired:
        return "CONFLICTED"
    if any(item not in met and item in covered for item in world.rules.require):
        return "REFUTED"
    gap = any(rule.id not in signed for rule in world.rules.completeness)
    if support and gap:
        return "SUPPORTED_OPEN_WORLD"
    if support:
        return "SUPPORTED_CLOSED"
    return "UNDERDETERMINED"


def _scope_verdict(base: str, agrees: bool) -> str:
    if agrees and base == "SUPPORTED_CLOSED":
        return "WARRANTED_IN_SCOPE"
    if agrees and base == "REFUTED":
        return "REFUTED_IN_SCOPE"
    if not agrees and base == "SUPPORTED_CLOSED":
        return "SUPPORTED_OPEN_WORLD"
    if not agrees and base == "REFUTED":
        return "UNDERDETERMINED"
    if base == "SUPPORTED_CLOSED":
        return "WARRANTED_IN_SCOPE"
    if base == "REFUTED":
        return "REFUTED_IN_SCOPE"
    return base


def _apply(obligations: list[_Obligation], changes: list[_Change]) -> set[str]:
    met = {item.id for item in obligations if item.met}
    for change in changes:
        if change.kind == "retract":
            met.discard(change.obligation_id)
        else:
            met.add(change.obligation_id)
    return met


def _combinations(changes: list[_Change], size: int) -> list[list[_Change]]:
    found: list[list[_Change]] = []
    current: list[_Change] = []

    def walk(start: int) -> None:
        if len(current) == size:
            found.append(list(current))
            return
        for index in range(start, len(changes)):
            current.append(changes[index])
            walk(index + 1)
            current.pop()

    if size == 0:
        return [[]]
    walk(0)
    return found


def _subset_count(change_count: int, max_changes: int) -> int:
    limit = min(max_changes, change_count)
    total = 0
    for size in range(limit + 1):
        total += _binomial(change_count, size)
    return total


def _binomial(count: int, choose: int) -> int:
    if choose > count:
        return 0
    result = 1
    for index in range(1, choose + 1):
        result *= count - choose + index
        if result % index:
            raise ValueError("variant count is not an integer")
        result //= index
    if result > 2**64 - 1:
        raise ValueError("variant count overflow")
    return result


def _invariance_root(world: _World) -> str:
    return _digest_domain("kite-invariance", _cbor_encode(_invariance_value(world)))


def _invariance_value(world: _World) -> dict:
    obligations = sorted(world.obligations, key=lambda item: item.id)
    return {
        "asOf": world.as_of,
        "bounds": {
            "maxCounterfactualChanges": world.bounds.max_counterfactual_changes,
            "maxGraphNodes": world.bounds.max_graph_nodes,
            "maxRetrievals": world.bounds.max_retrievals,
            "maxVariants": world.bounds.max_variants,
        },
        "changes": [
            {"id": change.id, "kind": change.kind, "obligationId": change.obligation_id}
            for change in world.changes
        ],
        "completeness": [
            {"collection": item.collection, "id": item.id, "signed": item.signed}
            for item in world.declarations
        ],
        "format": world.format,
        "obligations": [
            {
                "hitIds": list(item.hit_ids),
                "id": item.id,
                "kind": item.kind,
                "met": item.met,
                "sources": sorted(item.sources),
            }
            for item in obligations
        ],
        "question": world.question,
        "rules": {
            "completeness": [
                {
                    "collection": rule.collection,
                    "id": rule.id,
                    "obligationId": rule.obligation_id,
                }
                for rule in world.rules.completeness
            ],
            "conflicts": [
                {"left": pair.left, "right": pair.right} for pair in world.rules.conflicts
            ],
            "format": world.rules.format,
            "oppose": list(world.rules.oppose),
            "proposition": world.rules.proposition,
            "require": list(world.rules.require),
            "support": list(world.rules.support),
        },
        "semanticRoot": world.semantic_root,
        "stateRoot": world.state_root,
    }


def _parse_world(value: Json) -> _World:
    _expect_keys(
        value,
        [
            "asOf",
            "bounds",
            "changes",
            "completeness",
            "format",
            "obligations",
            "question",
            "rules",
            "semanticRoot",
            "stateRoot",
        ],
    )
    if _text(value, "format") != "knolo-kite-world-1":
        raise ValueError("world format is not knolo-kite-world-1")
    bounds_json = _get(value, "bounds")
    _expect_keys(
        bounds_json,
        ["maxCounterfactualChanges", "maxGraphNodes", "maxRetrievals", "maxVariants"],
    )
    rules_json = _get(value, "rules")
    _expect_keys(
        rules_json,
        ["completeness", "conflicts", "format", "oppose", "proposition", "require", "support"],
    )
    completeness_json = _get(value, "completeness")
    _expect_keys(completeness_json, ["declarations", "format"])
    return _World(
        _text(value, "format"),
        _text(value, "question"),
        _optional_text(_get(value, "asOf")),
        _text(value, "stateRoot"),
        _optional_text(_get(value, "semanticRoot")),
        [_parse_obligation(item) for item in _array(_get(value, "obligations"))],
        _Rules(
            _text(rules_json, "format"),
            _text(rules_json, "proposition"),
            _string_array(_get(rules_json, "support")),
            _string_array(_get(rules_json, "oppose")),
            _string_array(_get(rules_json, "require")),
            [
                _Conflict(_text(pair, "left"), _text(pair, "right"))
                for pair in _array(_get(rules_json, "conflicts"))
                if _expect_keys(pair, ["left", "right"]) or True
            ],
            [
                _CompletenessRule(
                    _text(rule, "id"),
                    _text(rule, "collection"),
                    _text(rule, "obligationId"),
                )
                for rule in _array(_get(rules_json, "completeness"))
                if _expect_keys(rule, ["collection", "id", "obligationId"]) or True
            ],
        ),
        [
            _Declaration(_text(item, "id"), _text(item, "collection"), _boolean(item, "signed"))
            for item in _array(_get(completeness_json, "declarations"))
            if _expect_keys(item, ["collection", "id", "signed"]) or True
        ],
        [
            _Change(_text(change, "id"), _text(change, "kind"), _text(change, "obligationId"))
            for change in _array(_get(value, "changes"))
            if _expect_keys(change, ["id", "kind", "obligationId"]) or True
        ],
        _Bounds(
            _integer(bounds_json, "maxGraphNodes"),
            _integer(bounds_json, "maxVariants"),
            _integer(bounds_json, "maxCounterfactualChanges"),
            _integer(bounds_json, "maxRetrievals"),
        ),
    )


def _parse_obligation(value: Json) -> _Obligation:
    _expect_keys(value, ["hitIds", "id", "kind", "met", "sources"])
    return _Obligation(
        _text(value, "id"),
        _text(value, "kind"),
        _boolean(value, "met"),
        _string_array(_get(value, "hitIds")),
        _string_array(_get(value, "sources")),
    )


def _parse_certificate(value: Json) -> KiteDerivation:
    _expect_keys(
        value,
        [
            "agrees",
            "asOf",
            "baseWorld",
            "counterfactualChanges",
            "format",
            "invarianceRoot",
            "met",
            "negativeCollections",
            "obligationIds",
            "question",
            "semanticRoot",
            "sourcePartitions",
            "stateRoot",
            "unmet",
            "variantsChecked",
            "verdict",
            "witness",
            "worldsChecked",
        ],
    )
    if _text(value, "format") != "knolo-kite-certificate-1":
        raise ValueError("certificate format is not knolo-kite-certificate-1")
    verdict = _text(value, "verdict")
    if verdict == "BOUND_EXCEEDED":
        raise ValueError("An unfinished search is not a certificate.")
    return KiteDerivation(
        verdict,
        _text(value, "baseWorld"),
        _text(value, "question"),
        _optional_text(_get(value, "asOf")),
        _text(value, "stateRoot"),
        _optional_text(_get(value, "semanticRoot")),
        _boolean(value, "agrees"),
        _optional_string_array(_get(value, "witness")),
        _integer(value, "worldsChecked"),
        _integer(value, "variantsChecked"),
        _integer(value, "counterfactualChanges"),
        _text(value, "invarianceRoot"),
        _string_array(_get(value, "negativeCollections")),
        _string_array(_get(value, "obligationIds")),
        _string_array(_get(value, "sourcePartitions")),
        _string_array(_get(value, "met")),
        _string_array(_get(value, "unmet")),
    )


def certificate_json(derived: KiteDerivation) -> str:
    return stringify(
        Json.object(
            [
                ("agrees", Json.bool(derived.agrees)),
                ("asOf", Json.string(derived.as_of) if derived.as_of is not None else Json.null()),
                ("baseWorld", Json.string(derived.base_world or "")),
                ("counterfactualChanges", Json.int(derived.counterfactual_changes)),
                ("format", Json.string("knolo-kite-certificate-1")),
                ("invarianceRoot", Json.string(derived.invariance_root or "")),
                ("met", Json.array([Json.string(item) for item in derived.met])),
                (
                    "negativeCollections",
                    Json.array([Json.string(item) for item in derived.negative_collections]),
                ),
                ("obligationIds", Json.array([Json.string(item) for item in derived.obligation_ids])),
                ("question", Json.string(derived.question)),
                (
                    "semanticRoot",
                    Json.string(derived.semantic_root)
                    if derived.semantic_root is not None
                    else Json.null(),
                ),
                (
                    "sourcePartitions",
                    Json.array([Json.string(item) for item in derived.source_partitions]),
                ),
                ("stateRoot", Json.string(derived.state_root)),
                ("unmet", Json.array([Json.string(item) for item in derived.unmet])),
                ("variantsChecked", Json.int(derived.variants_checked)),
                ("verdict", Json.string(derived.verdict)),
                (
                    "witness",
                    Json.array([Json.string(item) for item in derived.witness])
                    if derived.witness is not None
                    else Json.null(),
                ),
                ("worldsChecked", Json.int(derived.worlds_checked)),
            ]
        )
    )


def _expect_keys(value: Json, expected: list[str]) -> None:
    raw = value.as_object()
    if raw is None:
        raise ValueError("expected an object")
    actual = ",".join(sorted(key for key, _ in raw))
    wanted = ",".join(expected)
    if actual != wanted:
        raise ValueError(f"fields must be {wanted}")


def _get(value: Json, key: str) -> Json:
    item = value.get(key)
    if item is None:
        raise ValueError(f"missing {key}")
    return item


def _text(value: Json, key: str) -> str:
    item = _get(value, key)
    text = item.as_str()
    if text is None:
        raise ValueError(f"{key} must be a string")
    return text


def _boolean(value: Json, key: str) -> bool:
    item = _get(value, key)
    if item.kind != "bool":
        raise ValueError(f"{key} must be a boolean")
    return bool(item.value)


def _integer(value: Json, key: str) -> int:
    item = _get(value, key)
    number = item.as_int()
    if number is None or number < 0:
        raise ValueError(f"{key} must be unsigned")
    return number


def _optional_text(value: Json) -> str | None:
    if value.kind == "null":
        return None
    if value.kind == "string":
        return value.as_str()
    raise ValueError("expected a string or null")


def _array(value: Json) -> list[Json]:
    items = value.as_array()
    if items is None:
        raise ValueError("expected an array")
    return items


def _string_array(value: Json) -> list[str]:
    out = []
    for item in _array(value):
        text = item.as_str()
        if text is None:
            raise ValueError("expected a string")
        out.append(text)
    return out


def _optional_string_array(value: Json) -> list[str] | None:
    if value.kind == "null":
        return None
    return _string_array(value)
