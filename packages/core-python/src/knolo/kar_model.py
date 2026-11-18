"""Plan, graph, and anchor validation for the frozen kar-1-research-1 evaluator.

Indexes are execution-only. They are not hashed.
"""

from __future__ import annotations

from dataclasses import dataclass, field

from .jsoncanon import Json, digest_json, utf16_cmp

KAR_VERSION = "kar-1-research-1"
KAR_API = "experimental"
FRONTIERS = ("F_S", "F_O", "F_Q", "F_T", "F_A")
_PROFILES = (
    "minimum-cover",
    "minimum-cover-redundancy-v1",
    "exp1-lexicographic",
)
_MAX_SAFE = 9007199254740991


@dataclass
class Bounds:
    max_anchor_nodes: int
    max_closure_nodes: int
    max_closure_edges: int
    max_frontier_evidence: int
    max_requirements_per_frontier: int
    max_evidence_bindings: int
    max_cover_visits: int


@dataclass
class WitnessRecord:
    node_id: str
    query_term: str | None = None

    def to_json(self) -> Json:
        pairs = [("nodeId", Json.string(self.node_id))]
        if self.query_term is not None:
            pairs.append(("queryTerm", Json.string(self.query_term)))
        return Json.object(pairs)


@dataclass
class AnchorRecompute:
    procedure: str


@dataclass
class AnchorSupplied:
    witness: list[WitnessRecord]


AnchorSpec = AnchorRecompute | AnchorSupplied


@dataclass
class Lexical:
    frontier: str
    evidence_ids: list[str]


@dataclass
class Plan:
    anchor: AnchorSpec
    frontier_map: list[tuple[str, str]]
    depth: int
    cardinality_bound: int
    coverage_mode: str
    requirements: list[tuple[str, list[str]]]
    floors: list[tuple[str, str]]
    profile: str
    as_of: str
    min_authority: int | None
    bounds: Bounds
    lexical: Lexical | None


@dataclass
class Relation:
    id: str
    from_id: str
    relation: str
    to: str


@dataclass
class Binding:
    id: str
    node_id: str
    evidence_id: str
    requirements: list[str]
    authority: int | None = None
    unauthorized: bool = False
    valid_from: str | None = None
    valid_until: str | None = None
    provenance: str | None = None


@dataclass
class Graph:
    knowledge_root: str
    producer: str
    nodes: list[str]
    relations: list[Relation]
    bindings: list[Binding]
    note: str | None = None


@dataclass
class PreparedImage:
    knowledge_root: str
    texts: list[tuple[str, str]]


@dataclass
class Indexes:
    relations_by_from: list[tuple[str, list[Relation]]]
    bindings_by_node: list[tuple[str, list[Binding]]]
    bindings_by_evidence: list[tuple[str, list[Binding]]]
    node_ids: list[str]


@dataclass
class AnchorCommitment:
    nodes: list[str] = field(default_factory=list)
    mode: str | None = None
    procedure: str | None = None
    witness: list[WitnessRecord] | None = None

    @staticmethod
    def empty() -> "AnchorCommitment":
        return AnchorCommitment()

    def to_json(self) -> Json:
        if self.witness is None:
            witness = Json.null()
        else:
            witness = Json.array([row.to_json() for row in self.witness])
        return Json.object(
            [
                ("mode", _opt_string(self.mode)),
                ("nodes", Json.array([Json.string(node) for node in self.nodes])),
                ("procedure", _opt_string(self.procedure)),
                ("witness", witness),
            ]
        )


def _opt_string(value: str | None) -> Json:
    if value is None:
        return Json.null()
    return Json.string(value)


def is_root(value: str) -> bool:
    return (
        value.startswith("sha256-")
        and len(value) == len("sha256-") + 64
        and all(char in "0123456789abcdef" for char in value[len("sha256-") :])
    )


def is_frontier(value: str) -> bool:
    return value in FRONTIERS


def prepare_image(evidence: list[tuple[str, str]]) -> PreparedImage:
    rows = sorted(evidence, key=lambda item: _utf16_key(item[0]))
    image = Json.object(
        [
            (
                "evidence",
                Json.array(
                    [
                        Json.object(
                            [("id", Json.string(row_id)), ("text", Json.string(text))]
                        )
                        for row_id, text in rows
                    ]
                ),
            ),
            ("version", Json.int(1)),
        ]
    )
    return PreparedImage(knowledge_root=digest_json(image), texts=rows)


def prepare_graph(value: Json) -> Graph | None:
    raw = value.as_object()
    if raw is None or not only_keys(
        raw,
        [
            "version",
            "knowledgeRoot",
            "provenance",
            "nodes",
            "relations",
            "bindings",
        ],
    ):
        return None
    if value.get("version") is None or value.get("version").as_int() != 1:  # type: ignore[union-attr]
        return None
    knowledge = value.get("knowledgeRoot")
    if knowledge is None or knowledge.as_str() is None or not is_root(knowledge.as_str()):  # type: ignore[arg-type]
        return None
    provenance = value.get("provenance")
    if provenance is None or provenance.as_object() is None:
        return None
    if not only_keys(provenance.as_object(), ["producer", "note"]):  # type: ignore[arg-type]
        return None
    producer_json = provenance.get("producer")
    if producer_json is None or not producer_json.as_str():
        return None
    note_json = provenance.get("note")
    if note_json is None:
        note = None
    elif note_json.kind == "string":
        note = note_json.as_str()
    else:
        return None
    nodes_json = value.get("nodes")
    if nodes_json is None or nodes_json.as_array() is None:
        return None
    nodes: list[str] = []
    for item in nodes_json.as_array():  # type: ignore[union-attr]
        row = item.as_object()
        if row is None or not only_keys(row, ["id"]):
            return None
        node_id = item.get("id")
        if node_id is None or not node_id.as_str() or node_id.as_str() in nodes:
            return None
        nodes.append(node_id.as_str())  # type: ignore[arg-type]
    relations_json = value.get("relations")
    if relations_json is None or relations_json.as_array() is None:
        return None
    relations: list[Relation] = []
    for item in relations_json.as_array():  # type: ignore[union-attr]
        row = item.as_object()
        if row is None or not only_keys(row, ["id", "from", "relation", "to"]):
            return None
        rel_id = _required_str(item, "id")
        from_id = _required_str(item, "from")
        relation = _required_str(item, "relation")
        to_id = _required_str(item, "to")
        if (
            not rel_id
            or not relation
            or any(existing.id == rel_id for existing in relations)
            or from_id not in nodes
            or to_id not in nodes
        ):
            return None
        relations.append(Relation(rel_id, from_id, relation, to_id))  # type: ignore[arg-type]
    bindings_json = value.get("bindings")
    if bindings_json is None or bindings_json.as_array() is None:
        return None
    bindings: list[Binding] = []
    for item in bindings_json.as_array():  # type: ignore[union-attr]
        binding = _normalize_binding(item, nodes, bindings)
        if binding is None:
            return None
        bindings.append(binding)
    nodes.sort(key=_utf16_key)
    relations.sort(key=lambda item: _utf16_key(item.id))
    bindings.sort(key=lambda item: _utf16_key(item.id))
    return Graph(
        knowledge_root=knowledge.as_str(),  # type: ignore[arg-type]
        producer=producer_json.as_str(),  # type: ignore[arg-type]
        nodes=nodes,
        relations=relations,
        bindings=bindings,
        note=note,
    )


def _required_str(item: Json, key: str) -> str | None:
    value = item.get(key)
    if value is None:
        return None
    return value.as_str()


def _normalize_binding(
    item: Json, nodes: list[str], bindings: list[Binding]
) -> Binding | None:
    row = item.as_object()
    if row is None or not only_keys(
        row,
        [
            "id",
            "nodeId",
            "evidenceId",
            "requirements",
            "authority",
            "unauthorized",
            "validFrom",
            "validUntil",
            "provenance",
        ],
    ):
        return None
    binding_id = _required_str(item, "id")
    node_id = _required_str(item, "nodeId")
    evidence_id = _required_str(item, "evidenceId")
    if (
        not binding_id
        or not evidence_id
        or node_id not in nodes
        or any(existing.id == binding_id for existing in bindings)
    ):
        return None
    requirements_json = item.get("requirements")
    if requirements_json is None or requirements_json.as_array() is None:
        return None
    requirements: list[str] = []
    for requirement in requirements_json.as_array():  # type: ignore[union-attr]
        text = requirement.as_str()
        if not text or text in requirements:
            return None
        requirements.append(text)
    requirements.sort(key=_utf16_key)
    authority_json = item.get("authority")
    if authority_json is None:
        authority = None
    elif authority_json.kind == "int":
        authority = authority_json.as_int()
    else:
        return None
    unauthorized_json = item.get("unauthorized")
    if unauthorized_json is None:
        unauthorized = False
    elif unauthorized_json.kind == "bool":
        unauthorized = bool(unauthorized_json.value)
    else:
        return None
    valid_from = _optional_date(item.get("validFrom"))
    if valid_from is _MISSING:
        return None
    valid_until = _optional_date(item.get("validUntil"))
    if valid_until is _MISSING:
        return None
    provenance_json = item.get("provenance")
    if provenance_json is None:
        provenance = None
    elif provenance_json.kind == "string" and provenance_json.as_str():
        provenance = provenance_json.as_str()
    else:
        return None
    return Binding(
        id=binding_id,  # type: ignore[arg-type]
        node_id=node_id,  # type: ignore[arg-type]
        evidence_id=evidence_id,  # type: ignore[arg-type]
        requirements=requirements,
        authority=authority,
        unauthorized=unauthorized,
        valid_from=valid_from,  # type: ignore[arg-type]
        valid_until=valid_until,  # type: ignore[arg-type]
        provenance=provenance,
    )


_MISSING = object()


def _optional_date(value: Json | None) -> str | None | object:
    if value is None:
        return None
    if value.kind == "string" and _is_date(value.as_str() or ""):
        return value.as_str()
    return _MISSING


def _is_date(value: str) -> bool:
    if len(value) != 10 or value[4] != "-" or value[7] != "-":
        return False
    return all(index in (4, 7) or char.isdigit() for index, char in enumerate(value))


def graph_json(graph: Graph) -> Json:
    provenance = [("producer", Json.string(graph.producer))]
    if graph.note is not None:
        provenance.append(("note", Json.string(graph.note)))
    return Json.object(
        [
            ("bindings", Json.array([_binding_json(item) for item in graph.bindings])),
            ("knowledgeRoot", Json.string(graph.knowledge_root)),
            (
                "nodes",
                Json.array(
                    [Json.object([("id", Json.string(node))]) for node in graph.nodes]
                ),
            ),
            ("provenance", Json.object(provenance)),
            ("relations", Json.array([_relation_json(item) for item in graph.relations])),
            ("version", Json.int(1)),
        ]
    )


def _relation_json(relation: Relation) -> Json:
    return Json.object(
        [
            ("from", Json.string(relation.from_id)),
            ("id", Json.string(relation.id)),
            ("relation", Json.string(relation.relation)),
            ("to", Json.string(relation.to)),
        ]
    )


def _binding_json(binding: Binding) -> Json:
    pairs: list[tuple[str, Json]] = [
        ("evidenceId", Json.string(binding.evidence_id)),
        ("id", Json.string(binding.id)),
        ("nodeId", Json.string(binding.node_id)),
        (
            "requirements",
            Json.array([Json.string(item) for item in binding.requirements]),
        ),
    ]
    if binding.authority is not None:
        pairs.append(("authority", Json.int(binding.authority)))
    if binding.unauthorized:
        pairs.append(("unauthorized", Json.bool(True)))
    if binding.valid_from is not None:
        pairs.append(("validFrom", Json.string(binding.valid_from)))
    if binding.valid_until is not None:
        pairs.append(("validUntil", Json.string(binding.valid_until)))
    if binding.provenance is not None:
        pairs.append(("provenance", Json.string(binding.provenance)))
    return Json.object(pairs)


def semantic_root_of(graph: Graph) -> str:
    return digest_json(
        Json.object(
            [
                ("graph", graph_json(graph)),
                ("knowledgeRoot", Json.string(graph.knowledge_root)),
            ]
        )
    )


def unresolved_evidence(graph: Graph, texts: list[tuple[str, str]]) -> bool:
    known = {row_id for row_id, _ in texts}
    return any(binding.evidence_id not in known for binding in graph.bindings)


def build_indexes(graph: Graph) -> Indexes:
    relations_by_from: list[tuple[str, list[Relation]]] = []
    for relation in graph.relations:
        _push_group(relations_by_from, relation.from_id, relation)
    for _, group in relations_by_from:
        group.sort(key=lambda item: _utf16_key(item.id))
    bindings_by_node: list[tuple[str, list[Binding]]] = []
    bindings_by_evidence: list[tuple[str, list[Binding]]] = []
    for binding in graph.bindings:
        _push_group(bindings_by_node, binding.node_id, binding)
        _push_group(bindings_by_evidence, binding.evidence_id, binding)
    return Indexes(
        relations_by_from, bindings_by_node, bindings_by_evidence, list(graph.nodes)
    )


def _push_group(groups: list[tuple[str, list]], key: str, value: object) -> None:
    for name, items in groups:
        if name == key:
            items.append(value)
            return
    groups.append((key, [value]))


def group(groups: list[tuple[str, list]], key: str) -> list:
    for name, items in groups:
        if name == key:
            return items
    return []


def validate_plan(value: Json) -> Plan | None:
    raw = value.as_object()
    if raw is None or not only_keys(
        raw,
        [
            "version",
            "anchor",
            "frontierMap",
            "depth",
            "cardinalityBound",
            "coverageMode",
            "requirements",
            "floors",
            "profile",
            "asOf",
            "minAuthority",
            "bounds",
            "lexical",
        ],
    ):
        return None
    version = value.get("version")
    if version is None or version.as_int() != 1:
        return None
    depth = _non_negative(value.get("depth"))
    cardinality = _non_negative(value.get("cardinalityBound"))
    coverage = value.get("coverageMode")
    profile = value.get("profile")
    as_of = value.get("asOf")
    if (
        depth is None
        or cardinality is None
        or coverage is None
        or coverage.as_str() not in ("requirements", "nonempty")
        or profile is None
        or profile.as_str() not in _PROFILES
        or as_of is None
        or not _is_date(as_of.as_str() or "")
    ):
        return None
    authority_json = value.get("minAuthority")
    if authority_json is None:
        return None
    if authority_json.kind == "null":
        min_authority = None
    elif authority_json.kind == "int" and -_MAX_SAFE <= authority_json.as_int() <= _MAX_SAFE:  # type: ignore[operator]
        min_authority = authority_json.as_int()
    else:
        return None
    anchor_json = value.get("anchor")
    frontier_json = value.get("frontierMap")
    requirements_json = value.get("requirements")
    floors_json = value.get("floors")
    bounds_json = value.get("bounds")
    lexical_json = value.get("lexical")
    if None in (anchor_json, frontier_json, requirements_json, floors_json, bounds_json, lexical_json):
        return None
    anchor = _validate_anchor(anchor_json)  # type: ignore[arg-type]
    frontier_map = _validate_frontier_map(frontier_json)  # type: ignore[arg-type]
    requirements = _validate_frontier_lists(requirements_json)  # type: ignore[arg-type]
    floors = _validate_floors(floors_json)  # type: ignore[arg-type]
    bounds = _validate_bounds(bounds_json)  # type: ignore[arg-type]
    lexical = _validate_lexical(lexical_json)  # type: ignore[arg-type]
    if None in (anchor, frontier_map, requirements, floors, bounds) or lexical is _MISSING:
        return None
    if any(len(items) > bounds.max_requirements_per_frontier for _, items in requirements):  # type: ignore[union-attr]
        return None
    return Plan(
        anchor=anchor,  # type: ignore[arg-type]
        frontier_map=frontier_map,  # type: ignore[arg-type]
        depth=depth,
        cardinality_bound=cardinality,
        coverage_mode=coverage.as_str(),  # type: ignore[arg-type]
        requirements=requirements,  # type: ignore[arg-type]
        floors=floors,  # type: ignore[arg-type]
        profile=profile.as_str(),  # type: ignore[arg-type]
        as_of=as_of.as_str(),  # type: ignore[arg-type]
        min_authority=min_authority,
        bounds=bounds,  # type: ignore[arg-type]
        lexical=None if lexical is None else lexical,  # type: ignore[arg-type]
    )


def plan_json(plan: Plan) -> Json:
    if isinstance(plan.anchor, AnchorRecompute):
        anchor = Json.object(
            [
                ("mode", Json.string("recompute")),
                ("procedure", Json.string(plan.anchor.procedure)),
            ]
        )
    else:
        anchor = Json.object(
            [
                ("mode", Json.string("supplied")),
                (
                    "witness",
                    Json.array([row.to_json() for row in plan.anchor.witness]),
                ),
            ]
        )
    if plan.lexical is None:
        lexical = Json.null()
    else:
        lexical = Json.object(
            [
                (
                    "evidenceIds",
                    Json.array([Json.string(item) for item in plan.lexical.evidence_ids]),
                ),
                ("frontier", Json.string(plan.lexical.frontier)),
            ]
        )
    return Json.object(
        [
            ("anchor", anchor),
            ("asOf", Json.string(plan.as_of)),
            (
                "bounds",
                Json.object(
                    [
                        ("maxAnchorNodes", Json.int(plan.bounds.max_anchor_nodes)),
                        ("maxClosureEdges", Json.int(plan.bounds.max_closure_edges)),
                        ("maxClosureNodes", Json.int(plan.bounds.max_closure_nodes)),
                        ("maxCoverVisits", Json.int(plan.bounds.max_cover_visits)),
                        ("maxEvidenceBindings", Json.int(plan.bounds.max_evidence_bindings)),
                        ("maxFrontierEvidence", Json.int(plan.bounds.max_frontier_evidence)),
                        (
                            "maxRequirementsPerFrontier",
                            Json.int(plan.bounds.max_requirements_per_frontier),
                        ),
                    ]
                ),
            ),
            ("cardinalityBound", Json.int(plan.cardinality_bound)),
            ("coverageMode", Json.string(plan.coverage_mode)),
            ("depth", Json.int(plan.depth)),
            (
                "floors",
                Json.object(
                    [(frontier, Json.string(floor)) for frontier, floor in plan.floors]
                ),
            ),
            (
                "frontierMap",
                Json.object(
                    [
                        (symbol, Json.string(frontier))
                        for symbol, frontier in plan.frontier_map
                    ]
                ),
            ),
            ("lexical", lexical),
            (
                "minAuthority",
                Json.int(plan.min_authority)
                if plan.min_authority is not None
                else Json.null(),
            ),
            ("profile", Json.string(plan.profile)),
            (
                "requirements",
                Json.object(
                    [
                        (frontier, Json.array([Json.string(item) for item in items]))
                        for frontier, items in plan.requirements
                    ]
                ),
            ),
            ("version", Json.int(1)),
        ]
    )


def _validate_anchor(value: Json) -> AnchorSpec | None:
    raw = value.as_object()
    mode = value.get("mode")
    if raw is None or mode is None or mode.as_str() is None:
        return None
    if mode.as_str() == "recompute":
        procedure = value.get("procedure")
        if (
            not only_keys(raw, ["mode", "procedure"])
            or procedure is None
            or procedure.as_str() != "member-id-v1"
        ):
            return None
        return AnchorRecompute("member-id-v1")
    if mode.as_str() == "supplied":
        if not only_keys(raw, ["mode", "witness"]):
            return None
        rows = value.get("witness")
        if rows is None or rows.as_array() is None:
            return None
        witness: list[WitnessRecord] = []
        for item in rows.as_array():  # type: ignore[union-attr]
            record = item.as_object()
            node = item.get("nodeId")
            if record is None or not only_keys(record, ["nodeId", "queryTerm"]) or node is None:
                return None
            node_id = node.as_str()
            if not node_id:
                return None
            term_json = item.get("queryTerm")
            if term_json is None:
                term = None
            elif term_json.kind == "string":
                term = term_json.as_str()
            else:
                return None
            witness.append(WitnessRecord(node_id, term))
        return AnchorSupplied(witness)
    return None


def _validate_frontier_map(value: Json) -> list[tuple[str, str]] | None:
    raw = value.as_object()
    if raw is None:
        return None
    mapped: list[tuple[str, str]] = []
    for symbol, label in raw:
        frontier = label.as_str()
        if not symbol or frontier is None or not is_frontier(frontier):
            return None
        mapped.append((symbol, frontier))
    return mapped


def _validate_frontier_lists(value: Json) -> list[tuple[str, list[str]]] | None:
    raw = value.as_object()
    if raw is None or not only_keys(raw, list(FRONTIERS)):
        return None
    out: list[tuple[str, list[str]]] = []
    for frontier in FRONTIERS:
        child = value.get(frontier)
        if child is None:
            return None
        items = _string_list(child)
        if items is None:
            return None
        out.append((frontier, items))
    return out


def _validate_floors(value: Json) -> list[tuple[str, str]] | None:
    raw = value.as_object()
    if raw is None or not only_keys(raw, list(FRONTIERS)):
        return None
    out: list[tuple[str, str]] = []
    for frontier in FRONTIERS:
        floor = value.get(frontier)
        if floor is None or floor.as_str() is None or floor_micros(floor.as_str() or "") is None:
            return None
        out.append((frontier, floor.as_str()))  # type: ignore[arg-type]
    return out


def floor_micros(floor: str) -> int | None:
    pieces = floor.split(".")
    if len(pieces) > 2:
        return None
    whole = pieces[0]
    fraction = pieces[1] if len(pieces) == 2 else ""
    if not whole or not whole.isdigit():
        return None
    if fraction and (len(fraction) > 6 or not fraction.isdigit()):
        return None
    whole_number = int(whole)
    if whole_number > _MAX_SAFE:
        return None
    # Rust format!("{fraction:0<6}") pads with zeros on the right.
    padded = fraction + ("0" * (6 - len(fraction)))
    try:
        return whole_number * 1_000_000 + int(padded)
    except ValueError:
        return None


def _validate_bounds(value: Json) -> Bounds | None:
    raw = value.as_object()
    names = [
        "maxAnchorNodes",
        "maxClosureNodes",
        "maxClosureEdges",
        "maxFrontierEvidence",
        "maxRequirementsPerFrontier",
        "maxEvidenceBindings",
        "maxCoverVisits",
    ]
    if raw is None or not only_keys(raw, names):
        return None
    values = [_non_negative(value.get(name)) for name in names]
    if any(item is None for item in values):
        return None
    return Bounds(*values)  # type: ignore[arg-type]


def _validate_lexical(value: Json) -> Lexical | None | object:
    if value.kind == "null":
        return None
    raw = value.as_object()
    if raw is None or not only_keys(raw, ["frontier", "evidenceIds"]):
        return _MISSING
    frontier = value.get("frontier")
    ids = value.get("evidenceIds")
    if frontier is None or not is_frontier(frontier.as_str() or "") or ids is None or ids.as_array() is None:
        return _MISSING
    evidence_ids: list[str] = []
    for item in ids.as_array():  # type: ignore[union-attr]
        text = item.as_str()
        if not text:
            return _MISSING
        evidence_ids.append(text)
    return Lexical(frontier.as_str(), evidence_ids)  # type: ignore[arg-type]


def _string_list(value: Json) -> list[str] | None:
    items = value.as_array()
    if items is None:
        return None
    out: list[str] = []
    for item in items:
        text = item.as_str()
        if not text or text in out:
            return None
        out.append(text)
    return out


def _non_negative(value: Json | None) -> int | None:
    if value is None:
        return None
    number = value.as_int()
    if number is None or number < 0 or number > _MAX_SAFE:
        return None
    return number


def only_keys(pairs: list[tuple[str, Json]], allowed: list[str]) -> bool:
    return all(key in allowed for key, _ in pairs)


def resolve_anchor(
    query: str, node_ids: list[str], anchor: AnchorSpec
) -> tuple[AnchorCommitment, bool]:
    if isinstance(anchor, AnchorRecompute):
        nodes = member_id_anchors(query, node_ids) if anchor.procedure == "member-id-v1" else []
        return (
            AnchorCommitment(
                nodes=nodes, mode="recompute", procedure=anchor.procedure, witness=None
            ),
            False,
        )
    rows = list(anchor.witness)
    rows.sort(
        key=lambda row: (
            _utf16_key(row.node_id),
            _utf16_key(row.query_term or ""),
        )
    )
    nodes: list[str] = []
    for row in rows:
        if row.node_id not in nodes:
            nodes.append(row.node_id)
    nodes.sort(key=_utf16_key)
    rejected = any(node not in node_ids for node in nodes)
    return (
        AnchorCommitment(nodes=nodes, mode="supplied", procedure=None, witness=rows),
        rejected,
    )


def member_id_anchors(query: str, node_ids: list[str]) -> list[str]:
    found: list[str] = []
    token = []
    def flush() -> None:
        text = "".join(token)
        token.clear()
        if text and text in node_ids and text not in found:
            found.append(text)
    for char in query:
        if char.isascii() and (char.isalnum() or char in "_:-"):
            token.append(char)
        else:
            flush()
    flush()
    found.sort(key=_utf16_key)
    return found


def anchor_root(commitment: AnchorCommitment) -> str:
    return digest_json(commitment.to_json())


def empty_frontiers() -> list[tuple[str, list[str]]]:
    return [(frontier, []) for frontier in FRONTIERS]


def frontier_list_mut(
    frontiers: list[tuple[str, list[str]]], name: str
) -> list[str] | None:
    for frontier, ids in frontiers:
        if frontier == name:
            return ids
    return None


def frontiers_json(frontiers: list[tuple[str, list[str]]]) -> Json:
    return Json.object(
        [
            (frontier, Json.array([Json.string(item) for item in ids]))
            for frontier, ids in frontiers
        ]
    )


def lookup_requirement(plan: Plan, frontier: str) -> list[str]:
    for name, ids in plan.requirements:
        if name == frontier:
            return ids
    return []


def lookup_floor(plan: Plan, frontier: str) -> str:
    for name, floor in plan.floors:
        if name == frontier:
            return floor
    return "0"


def _utf16_key(text: str) -> tuple[int, ...]:
    from .jsoncanon import utf16_units

    return utf16_units(text)
