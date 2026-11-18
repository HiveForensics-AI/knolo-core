"""Breadth-first closure over (node, frontier) states.

The arriving relation replaces the frontier. The first reach is the canonical witness.
"""

from __future__ import annotations

from dataclasses import dataclass

from .jsoncanon import Json, digest_json, utf16_units
from .kar_model import (
    Binding,
    Graph,
    Indexes,
    Plan,
    build_indexes,
    empty_frontiers,
    frontier_list_mut,
    frontiers_json,
    group,
)


@dataclass
class PathStep:
    node: str
    relation: str | None = None


@dataclass
class Witness:
    evidence_id: str
    frontier: str
    anchor_id: str | None
    path: list[PathStep]


@dataclass
class Admission:
    evidence_id: str
    frontier: str
    applicable: bool
    requirements: list[str]


@dataclass
class ClosureSuccess:
    frontiers: list[tuple[str, list[str]]]
    witnesses: list[Witness]
    admissions: list[Admission]


@dataclass
class _State:
    node_id: str
    frontier: str
    depth: int
    anchor_id: str
    parent: int | None
    arriving_relation_id: str | None


def close_frontiers(
    graph: Graph,
    plan: Plan,
    anchors: list[str],
    indexes: Indexes | None = None,
) -> ClosureSuccess | None:
    bounds = plan.bounds
    if (
        len(graph.bindings) > bounds.max_evidence_bindings
        or len(anchors) > bounds.max_anchor_nodes
        or len(anchors) > bounds.max_closure_nodes
    ):
        return None
    resolved = indexes if indexes is not None else build_indexes(graph)
    frontiers = empty_frontiers()
    members = empty_frontiers()
    witnesses: list[Witness] = []
    witness_keys: list[str] = []
    admissions: list[Admission] = []
    states: list[_State] = []
    seen_states: list[str] = []
    seen_nodes: list[str] = []
    edges = 0
    current: list[int] = []
    for node_id in anchors:
        index = len(states)
        seen_states.append(f"{node_id}\0")
        if node_id not in seen_nodes:
            seen_nodes.append(node_id)
        states.append(_State(node_id, "", 0, node_id, None, None))
        current.append(index)
    while current:
        nxt: list[int] = []
        for state_index in current:
            state = states[state_index]
            if state.depth >= plan.depth:
                continue
            for relation in group(resolved.relations_by_from, state.node_id):
                label = None
                for symbol, mapped in plan.frontier_map:
                    if symbol == relation.relation:
                        label = mapped
                        break
                if label is None:
                    continue
                if edges + 1 > bounds.max_closure_edges:
                    return None
                edges += 1
                key = f"{relation.to}\0{label}"
                if key in seen_states:
                    continue
                if relation.to not in seen_nodes:
                    if len(seen_nodes) + 1 > bounds.max_closure_nodes:
                        return None
                    seen_nodes.append(relation.to)
                seen_states.append(key)
                index = len(states)
                states.append(
                    _State(
                        relation.to,
                        label,
                        state.depth + 1,
                        state.anchor_id,
                        state_index,
                        relation.id,
                    )
                )
                nxt.append(index)
        nxt.sort(
            key=lambda index: (
                utf16_units(states[index].frontier),
                utf16_units(states[index].node_id),
            )
        )
        for state_index in nxt:
            if not _admit(
                state_index,
                states,
                resolved,
                plan,
                frontiers,
                members,
                witnesses,
                witness_keys,
                admissions,
            ):
                return None
        current = nxt
    if plan.lexical is not None:
        ids: list[str] = []
        for evidence_id in plan.lexical.evidence_ids:
            if evidence_id not in ids:
                ids.append(evidence_id)
        ids.sort(key=lambda item: utf16_units(item))
        for evidence_id in ids:
            bucket = next(
                (items for frontier, items in members if frontier == plan.lexical.frontier),
                [],
            )
            if evidence_id in bucket:
                continue
            if len(bucket) + 1 > bounds.max_frontier_evidence:
                return None
            for frontier, items in members:
                if frontier == plan.lexical.frontier:
                    items.append(evidence_id)
                    break
            listed = frontier_list_mut(frontiers, plan.lexical.frontier)
            if listed is not None:
                listed.append(evidence_id)
            witnesses.append(
                Witness(evidence_id, plan.lexical.frontier, None, [])
            )
            related = group(resolved.bindings_by_evidence, evidence_id)
            if not related:
                admissions.append(
                    Admission(evidence_id, plan.lexical.frontier, True, [])
                )
            else:
                for binding in related:
                    ok = _applicable(binding, plan)
                    admissions.append(
                        Admission(
                            evidence_id,
                            plan.lexical.frontier,
                            ok,
                            list(binding.requirements) if ok else [],
                        )
                    )
    for _, ids in frontiers:
        ids.sort(key=lambda item: utf16_units(item))
    witnesses.sort(key=_witness_key)
    return ClosureSuccess(frontiers, witnesses, admissions)


def _admit(
    state_index: int,
    states: list[_State],
    indexes: Indexes,
    plan: Plan,
    frontiers: list[tuple[str, list[str]]],
    members: list[tuple[str, list[str]]],
    witnesses: list[Witness],
    witness_keys: list[str],
    admissions: list[Admission],
) -> bool:
    frontier = states[state_index].frontier
    if not frontier:
        return True
    node_id = states[state_index].node_id
    for binding in group(indexes.bindings_by_node, node_id):
        bucket = next((items for name, items in members if name == frontier), [])
        already = any(
            name == frontier and binding.evidence_id in items for name, items in members
        )
        if not already:
            if len(bucket) + 1 > plan.bounds.max_frontier_evidence:
                return False
            for name, items in members:
                if name == frontier:
                    items.append(binding.evidence_id)
                    break
            listed = frontier_list_mut(frontiers, frontier)
            if listed is not None:
                listed.append(binding.evidence_id)
        key = f"{frontier}\0{binding.evidence_id}"
        if key not in witness_keys:
            witness_keys.append(key)
            witnesses.append(
                Witness(
                    binding.evidence_id,
                    frontier,
                    states[state_index].anchor_id,
                    _materialize_path(states, state_index),
                )
            )
        ok = _applicable(binding, plan)
        admissions.append(
            Admission(
                binding.evidence_id,
                frontier,
                ok,
                list(binding.requirements) if ok else [],
            )
        )
    return True


def _materialize_path(states: list[_State], state_index: int) -> list[PathStep]:
    chain: list[int] = []
    cursor: int | None = state_index
    while cursor is not None:
        chain.append(cursor)
        cursor = states[cursor].parent
    chain.reverse()
    path = [PathStep(states[chain[0]].node_id, None)]
    for index in chain[1:]:
        path.append(PathStep(states[index].node_id, states[index].arriving_relation_id))
    return path


def _applicable(binding: Binding, plan: Plan) -> bool:
    if binding.unauthorized:
        return False
    if plan.min_authority is not None:
        if binding.authority is None or binding.authority < plan.min_authority:
            return False
    if binding.valid_from is not None and utf16_units(plan.as_of) < utf16_units(binding.valid_from):
        return False
    if binding.valid_until is not None and utf16_units(plan.as_of) >= utf16_units(binding.valid_until):
        return False
    return True


def _witness_key(witness: Witness) -> tuple:
    return (
        utf16_units(witness.frontier),
        utf16_units(witness.evidence_id),
        utf16_units(witness.anchor_id or ""),
    )


def frontier_root(frontiers: list[tuple[str, list[str]]]) -> str:
    return digest_json(frontiers_json(frontiers))


def frontier_witness_root(witnesses: list[Witness]) -> str:
    return digest_json(Json.array([witness_json(item) for item in witnesses]))


def witness_json(witness: Witness) -> Json:
    return Json.object(
        [
            (
                "anchorId",
                Json.string(witness.anchor_id) if witness.anchor_id is not None else Json.null(),
            ),
            ("evidenceId", Json.string(witness.evidence_id)),
            ("frontier", Json.string(witness.frontier)),
            ("path", Json.array([_path_json(step) for step in witness.path])),
        ]
    )


def _path_json(step: PathStep) -> Json:
    pairs = [("node", Json.string(step.node))]
    if step.relation is not None:
        pairs.append(("relation", Json.string(step.relation)))
    return Json.object(pairs)
