"""Frozen evaluation order. Roots are hashed from the canonical objects, not from indexes."""

from __future__ import annotations

from dataclasses import dataclass

from .jsoncanon import Json, digest_json
from .kar_closure import (
    Witness,
    close_frontiers,
    frontier_root,
    frontier_witness_root,
    witness_json,
)
from .kar_cover import (
    Choice,
    CoveragePair,
    Decision,
    choices_json,
    decision_json,
    decision_root,
    evidence_set_root,
    select_cover,
)
from .kar_model import (
    FRONTIERS,
    KAR_VERSION,
    AnchorCommitment,
    Graph,
    Indexes,
    Plan,
    PreparedImage,
    anchor_root,
    empty_frontiers,
    frontiers_json,
    lookup_requirement,
    resolve_anchor,
    semantic_root_of,
    unresolved_evidence,
    validate_plan,
)
from .kar_model import AnchorRecompute


@dataclass
class Roots:
    knowledge_root: str
    semantic_root: str
    query_root: str
    plan_root: str
    anchor_root: str
    frontier_root: str
    frontier_witness_root: str
    evidence_set_root: str
    decision_root: str
    kar_root: str


@dataclass
class KarResult:
    status: str
    evidence_ids: list[str]
    choices: list[Choice]
    frontiers: list[tuple[str, list[str]]]
    witnesses: list[Witness]
    decision: Decision
    roots: Roots


@dataclass
class BoundInputs:
    image_input: Json
    graph_input: Json
    query: str
    plan_input: Json
    prepared: PreparedImage | None = None
    graph: Graph | None = None
    indexes: Indexes | None = None
    knowledge_root: str | None = None
    semantic_root: str | None = None


def evaluate_bound(inputs: BoundInputs) -> KarResult:
    query_root = digest_json(Json.string(inputs.query))
    plan_root = digest_json(inputs.plan_input)
    if inputs.knowledge_root is not None:
        knowledge_root = inputs.knowledge_root
    elif inputs.prepared is not None:
        knowledge_root = inputs.prepared.knowledge_root
    else:
        knowledge_root = digest_json(
            Json.object(
                [("image", inputs.image_input), ("invalidImage", Json.bool(True))]
            )
        )
    if inputs.semantic_root is not None:
        semantic_root = inputs.semantic_root
    elif inputs.graph is not None:
        semantic_root = semantic_root_of(inputs.graph)
    else:
        semantic_root = digest_json(
            Json.object([("graph", inputs.graph_input), ("invalid", Json.bool(True))])
        )
    plan = validate_plan(inputs.plan_input)
    fallback_profile = plan.profile if plan is not None else ""
    fallback_coverage = _required_coverage(plan) if plan is not None else _zero_coverage()

    def emit(
        status: str,
        evidence_ids: list[str],
        frontiers: list[tuple[str, list[str]]],
        witnesses: list[Witness],
        choices: list[Choice],
        decision: Decision | None,
        commitment: AnchorCommitment,
    ) -> KarResult:
        decided = decision or Decision(
            status, fallback_profile, 0, [pair for pair in fallback_coverage], None
        )
        decided.status = status
        anchor = anchor_root(commitment)
        frontier = frontier_root(frontiers)
        witness = frontier_witness_root(witnesses)
        evidence = evidence_set_root(choices)
        decision_hash = decision_root(decided)
        kar_root = digest_json(
            Json.object(
                [
                    ("anchorRoot", Json.string(anchor)),
                    ("decisionRoot", Json.string(decision_hash)),
                    ("evidenceSetRoot", Json.string(evidence)),
                    ("frontierRoot", Json.string(frontier)),
                    ("knowledgeRoot", Json.string(knowledge_root)),
                    ("planRoot", Json.string(plan_root)),
                    ("queryRoot", Json.string(query_root)),
                    ("semanticRoot", Json.string(semantic_root)),
                ]
            )
        )
        return KarResult(
            status,
            evidence_ids,
            choices,
            frontiers,
            witnesses,
            decided,
            Roots(
                knowledge_root,
                semantic_root,
                query_root,
                plan_root,
                anchor,
                frontier,
                witness,
                evidence,
                decision_hash,
                kar_root,
            ),
        )

    if plan is None:
        return emit("PLAN_INVALID", [], empty_frontiers(), [], [], None, AnchorCommitment.empty())
    if inputs.prepared is None or inputs.graph is None:
        return emit("GRAPH_INVALID", [], empty_frontiers(), [], [], None, AnchorCommitment.empty())
    if inputs.graph.knowledge_root != inputs.prepared.knowledge_root or unresolved_evidence(
        inputs.graph, inputs.prepared.texts
    ):
        return emit(
            "GRAPH_NOT_BOUND", [], empty_frontiers(), [], [], None, AnchorCommitment.empty()
        )
    if plan.lexical is not None:
        known = {row_id for row_id, _ in inputs.prepared.texts}
        for evidence_id in plan.lexical.evidence_ids:
            if evidence_id not in known:
                return emit(
                    "GRAPH_NOT_BOUND",
                    [],
                    empty_frontiers(),
                    [],
                    [],
                    None,
                    AnchorCommitment.empty(),
                )
    node_ids = (
        list(inputs.indexes.node_ids) if inputs.indexes is not None else list(inputs.graph.nodes)
    )
    commitment, rejected = resolve_anchor(inputs.query, node_ids, plan.anchor)
    if isinstance(plan.anchor, AnchorRecompute) and plan.anchor.procedure != "member-id-v1":
        return emit("PLAN_INVALID", [], empty_frontiers(), [], [], None, commitment)
    if rejected:
        return emit("ANCHOR_REJECTED", [], empty_frontiers(), [], [], None, commitment)
    closed = close_frontiers(inputs.graph, plan, commitment.nodes, inputs.indexes)
    if closed is None:
        return emit(
            "CLOSURE_BOUND_EXCEEDED", [], empty_frontiers(), [], [], None, commitment
        )
    cover = select_cover(plan, closed.admissions, inputs.prepared.texts)
    return emit(
        cover.status,
        cover.evidence_ids,
        closed.frontiers,
        closed.witnesses,
        cover.choices,
        cover.decision,
        commitment,
    )


def certificate_json(result: KarResult) -> Json:
    return Json.object(
        [
            ("choices", choices_json(result.choices)),
            ("decision", decision_json(result.decision)),
            ("evidenceIds", Json.array([Json.string(item) for item in result.evidence_ids])),
            ("frontiers", frontiers_json(result.frontiers)),
            ("roots", _roots_json(result.roots)),
            ("status", Json.string(result.status)),
            ("version", Json.string(KAR_VERSION)),
            ("witnesses", Json.array([witness_json(item) for item in result.witnesses])),
        ]
    )


def _roots_json(roots: Roots) -> Json:
    return Json.object(
        [
            ("anchorRoot", Json.string(roots.anchor_root)),
            ("decisionRoot", Json.string(roots.decision_root)),
            ("evidenceSetRoot", Json.string(roots.evidence_set_root)),
            ("frontierRoot", Json.string(roots.frontier_root)),
            ("frontierWitnessRoot", Json.string(roots.frontier_witness_root)),
            ("karRoot", Json.string(roots.kar_root)),
            ("knowledgeRoot", Json.string(roots.knowledge_root)),
            ("planRoot", Json.string(roots.plan_root)),
            ("queryRoot", Json.string(roots.query_root)),
            ("semanticRoot", Json.string(roots.semantic_root)),
        ]
    )


def _required_coverage(plan: Plan) -> list[tuple[str, CoveragePair]]:
    pairs = []
    for frontier in FRONTIERS:
        required = (
            len(lookup_requirement(plan, frontier)) if plan.coverage_mode == "requirements" else 1
        )
        pairs.append((frontier, CoveragePair(0, required)))
    return pairs


def _zero_coverage() -> list[tuple[str, CoveragePair]]:
    return [(frontier, CoveragePair(0, 0)) for frontier in FRONTIERS]


def status_code(status: str) -> str | None:
    return {
        "GRAPH_INVALID": "KAR_GRAPH_INVALID",
        "GRAPH_NOT_BOUND": "KAR_GRAPH_NOT_BOUND",
        "PLAN_INVALID": "KAR_PLAN_INVALID",
        "ANCHOR_REJECTED": "KAR_ANCHOR_REJECTED",
        "CLOSURE_BOUND_EXCEEDED": "KAR_CLOSURE_BOUND_EXCEEDED",
        "SEARCH_BOUND_EXCEEDED": "KAR_SEARCH_BOUND_EXCEEDED",
    }.get(status)
