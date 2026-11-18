"""V5 KAR session, verification, and dossier rendering.

SATISFIED means the evidence requirements were met. It does not mean a claim is proven.
"""

from __future__ import annotations

from dataclasses import dataclass

from .errors import InvalidKnowledgeImageError, KarRunError
from .jsoncanon import Json, JsonError, canonicalize, digest_json, parse_json, stringify
from .kar_closure import close_frontiers, witness_json
from .kar_cover import covers_plan
from .kar_eval import BoundInputs, KarResult, certificate_json, evaluate_bound, status_code
from .kar_model import (
    FRONTIERS,
    KAR_API,
    KAR_VERSION,
    Graph,
    Indexes,
    Plan,
    PreparedImage,
    build_indexes,
    graph_json,
    is_root,
    only_keys,
    plan_json,
    prepare_graph,
    prepare_image,
    resolve_anchor,
    semantic_root_of,
    validate_plan,
)
from .kar_model import AnchorRecompute, AnchorSupplied
from .v5 import mount_knowledge_image_v5

_DOSSIER_FORMAT = "kar-evidence-dossier-1"
_STATUSES = {
    "SATISFIED",
    "UNSATISFIED_EVIDENCE_REQUIREMENTS",
    "SEARCH_BOUND_EXCEEDED",
    "CLOSURE_BOUND_EXCEEDED",
    "ANCHOR_REJECTED",
    "GRAPH_NOT_BOUND",
    "GRAPH_INVALID",
    "PLAN_INVALID",
}
_ROOT_FIELDS = (
    "knowledgeRoot",
    "semanticRoot",
    "queryRoot",
    "planRoot",
    "anchorRoot",
    "frontierRoot",
    "frontierWitnessRoot",
    "evidenceSetRoot",
    "decisionRoot",
    "karRoot",
)
_I64_MIN = -9223372036854775808
_I64_MAX = 9223372036854775807


@dataclass
class KarEvaluation:
    status: str
    code: str | None
    proposition: str
    anchor_mode: str | None
    frontiers: list[tuple[str, list[str]]]
    selected_len: int
    knowledge_root: str
    semantic_root: str
    kar_root: str
    json: str


@dataclass
class KarVerification:
    ok: bool
    code: str
    reason: str
    status: str | None


@dataclass
class KarDossier:
    status_statement: str
    markdown: str
    manifest_json: str
    certificate_json: str
    evaluation_json: str


@dataclass
class _ObjectRow:
    id: str
    text: str
    source: str | None
    metadata: Json


@dataclass
class _Session:
    image: Json
    graph: Graph
    prepared: PreparedImage
    indexes: Indexes
    objects: list[_ObjectRow]
    semantic_root: str
    plan_input: Json


@dataclass
class _Sidecar:
    state_root: str
    object_root: str
    commit_digest: str
    knowledge_root: str
    graph: Graph


def evaluate_kar_v5(
    image: bytes, sidecar_json: str, proposition: str, plan_json_text: str
) -> KarEvaluation:
    session = _open_session(image, sidecar_json, plan_json_text)
    return _evaluation_from(session, proposition)


def verify_kar_v5(
    image: bytes,
    sidecar_json: str,
    proposition: str,
    plan_json_text: str,
    claimed_json: str,
) -> KarVerification:
    try:
        session = _open_session(image, sidecar_json, plan_json_text)
    except KarRunError as error:
        return KarVerification(False, error.code, str(error), None)
    actual = _evaluation_from(session, proposition)
    return _compare_claim(actual, claimed_json, proposition)


def create_kar_dossier_v5(
    image: bytes, sidecar_json: str, proposition: str, plan_json_text: str
) -> KarDossier:
    session = _open_session(image, sidecar_json, plan_json_text)
    return _dossier_from(session, proposition)


def render_kar_dossier(dossier: KarDossier) -> str:
    return dossier.markdown


def verify_kar_dossier_v5(
    image: bytes,
    sidecar_json: str,
    proposition: str,
    plan_json_text: str,
    manifest_json: str,
    certificate_json_text: str,
    evaluation_json: str,
    evidence_markdown: str | None = None,
) -> KarVerification:
    verdict = verify_kar_v5(
        image, sidecar_json, proposition, plan_json_text, certificate_json_text
    )
    if not verdict.ok:
        return verdict
    try:
        actual = create_kar_dossier_v5(image, sidecar_json, proposition, plan_json_text)
    except KarRunError as error:
        return KarVerification(False, error.code, str(error), None)
    status = _status_of(actual)
    claimed_manifest = _parse_or_mismatch(manifest_json, actual)
    if isinstance(claimed_manifest, KarVerification):
        return claimed_manifest
    if canonicalize(claimed_manifest) != canonicalize(parse_json(actual.manifest_json)):
        return KarVerification(False, "KAR_RESULT_MISMATCH", "dossier manifest mismatch", status)
    claimed_certificate = _parse_or_mismatch(certificate_json_text, actual)
    if isinstance(claimed_certificate, KarVerification):
        return claimed_certificate
    if canonicalize(claimed_certificate) != canonicalize(parse_json(actual.certificate_json)):
        return KarVerification(False, "KAR_RESULT_MISMATCH", "dossier certificate mismatch", status)
    claimed_evaluation = _parse_or_mismatch(evaluation_json, actual)
    if isinstance(claimed_evaluation, KarVerification):
        return claimed_evaluation
    if canonicalize(claimed_evaluation) != canonicalize(parse_json(actual.evaluation_json)):
        return KarVerification(False, "KAR_RESULT_MISMATCH", "dossier result mismatch", status)
    if evidence_markdown is not None and evidence_markdown != actual.markdown:
        return KarVerification(False, "KAR_RESULT_MISMATCH", "dossier rendering mismatch", status)
    return KarVerification(True, "VERIFIED", "", status)


def _parse_or_mismatch(text: str, dossier: KarDossier) -> Json | KarVerification:
    try:
        return parse_json(text)
    except JsonError as error:
        return KarVerification(False, "KAR_RESULT_MISMATCH", str(error), _status_of(dossier))


def _status_of(dossier: KarDossier) -> str:
    try:
        value = parse_json(dossier.evaluation_json)
    except JsonError:
        return ""
    status = value.get("status")
    return status.as_str() or "" if status is not None else ""


def _open_session(image: bytes, sidecar_json: str, plan_json_text: str) -> _Session:
    try:
        mounted = mount_knowledge_image_v5(image)
    except InvalidKnowledgeImageError as error:
        raise KarRunError("KAR_IMAGE_REJECTED", str(error)) from error
    try:
        sidecar = parse_json(sidecar_json)
    except JsonError as error:
        raise KarRunError("KAR_SIDECAR_INVALID", str(error)) from error
    try:
        plan_input = parse_json(plan_json_text)
    except JsonError as error:
        raise KarRunError("KAR_PLAN_INVALID", str(error)) from error
    sidecar_value = _validate_sidecar(sidecar)
    rows: list[_ObjectRow] = []
    for obj in mounted.objects:
        try:
            meta = _value_to_json(obj.meta)
        except KarRunError:
            raise
        except (TypeError, ValueError) as error:
            raise KarRunError("KAR_IMAGE_REJECTED", str(error)) from error
        rows.append(
            _ObjectRow(
                obj.id,
                obj.bytes.decode("utf-8", errors="replace"),
                _object_source(obj.kind, meta),
                Json.object([("kind", Json.string(obj.kind)), ("meta", meta)]),
            )
        )
    rows.sort(key=lambda row: _units(row.id))
    prepared = prepare_image([(row.id, row.text) for row in rows])
    binding = _binding_error(
        sidecar_value,
        prepared,
        mounted.state_root,
        mounted.commit["objectRoot"],
        mounted.commit_digest,
    )
    if binding is not None:
        raise binding
    return _Session(
        Json.object(
            [
                ("commitDigest", Json.string(mounted.commit_digest)),
                ("knowledgeRoot", Json.string(prepared.knowledge_root)),
                ("objectRoot", Json.string(mounted.commit["objectRoot"])),
                ("stateRoot", Json.string(mounted.state_root)),
            ]
        ),
        sidecar_value.graph,
        prepared,
        build_indexes(sidecar_value.graph),
        rows,
        semantic_root_of(sidecar_value.graph),
        plan_input,
    )


def _validate_sidecar(value: Json) -> _Sidecar:
    raw = value.as_object()
    if raw is None:
        raise KarRunError("KAR_SIDECAR_INVALID", "A KAR sidecar must be an object.")
    version = value.get("version")
    if not only_keys(
        raw,
        ["version", "stateRoot", "objectRoot", "commitDigest", "knowledgeRoot", "graph"],
    ) or version is None or version.as_int() != 1:
        raise KarRunError("KAR_SIDECAR_INVALID", "Sidecar version must be 1.")
    fields: dict[str, str] = {}
    for field in ("stateRoot", "objectRoot", "commitDigest", "knowledgeRoot"):
        item = value.get(field)
        text = item.as_str() if item is not None else None
        if text is None or not is_root(text):
            raise KarRunError("KAR_SIDECAR_INVALID", f"{field} must be a sha256 digest.")
        fields[field] = text
    graph_value = value.get("graph")
    if graph_value is None:
        raise KarRunError("KAR_GRAPH_INVALID", "The committed evidence graph is not valid.")
    graph = prepare_graph(graph_value)
    if graph is None:
        raise KarRunError("KAR_GRAPH_INVALID", "The committed evidence graph is not valid.")
    if graph.knowledge_root != fields["knowledgeRoot"]:
        raise KarRunError(
            "KAR_GRAPH_NOT_BOUND",
            "Sidecar knowledgeRoot does not equal the committed evidence graph knowledgeRoot.",
        )
    return _Sidecar(
        fields["stateRoot"],
        fields["objectRoot"],
        fields["commitDigest"],
        fields["knowledgeRoot"],
        graph,
    )


def _binding_error(
    sidecar: _Sidecar,
    prepared: PreparedImage,
    state_root: str,
    object_root: str,
    commit_digest: str,
) -> KarRunError | None:
    if sidecar.state_root != state_root:
        return KarRunError(
            "KAR_GRAPH_NOT_BOUND", "Sidecar stateRoot does not match the mounted V5 image."
        )
    if sidecar.object_root != object_root:
        return KarRunError(
            "KAR_GRAPH_NOT_BOUND", "Sidecar objectRoot does not match the mounted V5 image."
        )
    if sidecar.commit_digest != commit_digest:
        return KarRunError(
            "KAR_GRAPH_NOT_BOUND", "Sidecar commitDigest does not match the mounted V5 image."
        )
    if sidecar.knowledge_root != prepared.knowledge_root:
        return KarRunError(
            "KAR_GRAPH_NOT_BOUND",
            "Sidecar knowledgeRoot does not match the frozen KAR projection of this image. "
            f"image {prepared.knowledge_root} sidecar {sidecar.knowledge_root}",
        )
    return None


def _evaluation_from(session: _Session, proposition: str) -> KarEvaluation:
    certificate = evaluate_bound(
        BoundInputs(
            image_input=Json.null(),
            graph_input=graph_json(session.graph),
            query=proposition,
            plan_input=session.plan_input,
            prepared=session.prepared,
            graph=session.graph,
            indexes=session.indexes,
            knowledge_root=session.prepared.knowledge_root,
            semantic_root=session.semantic_root,
        )
    )
    plan = validate_plan(session.plan_input)
    payload = _evaluation_json(session, proposition, plan, certificate)
    return KarEvaluation(
        certificate.status,
        status_code(certificate.status),
        proposition,
        _anchor_mode(plan) if plan is not None else None,
        certificate.frontiers,
        len(certificate.evidence_ids),
        certificate.roots.knowledge_root,
        certificate.roots.semantic_root,
        certificate.roots.kar_root,
        stringify(payload),
    )


def _anchor_mode(plan: Plan) -> str:
    if isinstance(plan.anchor, AnchorRecompute):
        return "recompute"
    if isinstance(plan.anchor, AnchorSupplied):
        return "supplied"
    return ""


def _evaluation_json(
    session: _Session, proposition: str, plan: Plan | None, certificate: KarResult
) -> Json:
    choices = [(choice.evidence_id, list(choice.frontiers)) for choice in certificate.choices]
    selected = []
    for evidence_id in certificate.evidence_ids:
        obj = next((row for row in session.objects if row.id == evidence_id), None)
        frontiers = next((items for row_id, items in choices if row_id == evidence_id), [])
        pairs: list[tuple[str, Json]] = [
            ("frontiers", Json.array([Json.string(item) for item in frontiers])),
            ("id", Json.string(evidence_id)),
        ]
        if obj is not None:
            pairs.append(("metadata", obj.metadata))
            if obj.source is not None:
                pairs.append(("source", Json.string(obj.source)))
            pairs.append(("text", Json.string(obj.text)))
        selected.append(Json.object(pairs))
    code = status_code(certificate.status)
    return Json.object(
        [
            ("api", Json.string(KAR_API)),
            ("certificate", certificate_json(certificate)),
            ("code", Json.string(code) if code is not None else Json.null()),
            ("experimental", Json.bool(True)),
            ("frontiers", frontiers_from(certificate)),
            ("image", session.image),
            ("plan", plan_json(plan) if plan is not None else Json.null()),
            ("proposition", Json.string(proposition)),
            ("selectedEvidence", Json.array(selected)),
            ("status", Json.string(certificate.status)),
            ("version", Json.string(KAR_VERSION)),
            ("witnesses", Json.array([witness_json(item) for item in certificate.witnesses])),
        ]
    )


def frontiers_from(certificate: KarResult) -> Json:
    from .kar_model import frontiers_json

    return frontiers_json(certificate.frontiers)


def _compare_claim(actual: KarEvaluation, claimed_json: str, proposition: str) -> KarVerification:
    try:
        claimed_value = parse_json(claimed_json)
    except JsonError:
        return KarVerification(
            False,
            "KAR_RESULT_INVALID",
            "The claimed result is not a KAR certificate.",
            actual.status,
        )
    claimed = _certificate_of(claimed_value)
    if claimed is None:
        return KarVerification(
            False,
            "KAR_RESULT_INVALID",
            "The claimed result is not a KAR certificate.",
            actual.status,
        )
    actual_value = parse_json(actual.json)
    actual_certificate = actual_value.get("certificate") or Json.null()
    if canonicalize(actual_certificate) != canonicalize(claimed):
        return KarVerification(
            False,
            "KAR_RESULT_MISMATCH",
            _mismatch_reason(actual_certificate, claimed),
            actual.status,
        )
    if claimed_value.as_object() is None or claimed_value.get("certificate") is None:
        return KarVerification(True, "VERIFIED", "", actual.status)
    flag = claimed_value.get("experimental")
    if flag is not None and flag != Json.bool(True):
        return _mismatch(actual, "experimental flag mismatch")
    proposition_json = claimed_value.get("proposition")
    if proposition_json is not None and proposition_json.as_str() not in (None, proposition):
        if proposition_json.kind == "string" and proposition_json.as_str() != proposition:
            return _mismatch(actual, "proposition mismatch")
    for field, reason in (
        ("plan", "plan mismatch"),
        ("image", "image identity mismatch"),
        ("selectedEvidence", "selected evidence mismatch"),
        ("frontiers", "frontier mismatch"),
        ("witnesses", "witness mismatch"),
    ):
        value = claimed_value.get(field)
        if value is not None and canonicalize(value) != canonicalize(
            actual_value.get(field) or Json.null()
        ):
            return _mismatch(actual, reason)
    code = claimed_value.get("code")
    if code is not None and code != (actual_value.get("code") or Json.null()):
        return _mismatch(actual, "status code mismatch")
    status = claimed_value.get("status")
    if status is not None and status != (actual_value.get("status") or Json.null()):
        return _mismatch(actual, "status mismatch")
    return KarVerification(True, "VERIFIED", "", actual.status)


def _mismatch(actual: KarEvaluation, reason: str) -> KarVerification:
    return KarVerification(False, "KAR_RESULT_MISMATCH", reason, actual.status)


def _certificate_of(value: Json) -> Json | None:
    certificate = value.get("certificate")
    if certificate is not None and certificate.as_object() is not None:
        return _certificate_of(certificate)
    version = value.get("version")
    status = value.get("status")
    if version is None or version.as_str() != KAR_VERSION or status is None or status.as_str() not in _STATUSES:
        return None
    if _string_array(value.get("evidenceIds")) is None:
        return None
    choices = value.get("choices")
    witnesses = value.get("witnesses")
    frontiers = value.get("frontiers")
    decision = value.get("decision")
    roots = value.get("roots")
    if (
        choices is None
        or choices.kind != "array"
        or witnesses is None
        or witnesses.kind != "array"
        or frontiers is None
        or decision is None
        or roots is None
    ):
        return None
    for frontier in FRONTIERS:
        if _string_array(frontiers.get(frontier)) is None:
            return None
    decision_status = decision.get("status")
    if decision_status is None or decision_status.as_str() != status.as_str():
        return None
    for name in _ROOT_FIELDS:
        root = roots.get(name)
        if root is None or root.as_str() is None or not is_root(root.as_str() or ""):
            return None
    return value


def _string_array(value: Json | None) -> bool | None:
    if value is None or value.as_array() is None:
        return None
    if all(item.kind == "string" for item in value.as_array()):  # type: ignore[union-attr]
        return True
    return None


def _mismatch_reason(actual: Json, claimed: Json) -> str:
    for field in (
        "version",
        "status",
        "evidenceIds",
        "choices",
        "frontiers",
        "witnesses",
        "decision",
        "roots",
    ):
        if canonicalize(actual.get(field) or Json.null()) == canonicalize(
            claimed.get(field) or Json.null()
        ):
            continue
        if field == "roots":
            for root in _ROOT_FIELDS:
                left = _root_text(actual, root)
                right = _root_text(claimed, root)
                if left != right:
                    return f"root mismatch {root}"
        if field == "status":
            left = (actual.get("status").as_str() if actual.get("status") else "") or ""
            right = (claimed.get("status").as_str() if claimed.get("status") else "") or ""
            return f"status {left} did not match {right}"
        return f"field mismatch {field}"
    return "certificate mismatch"


def _root_text(value: Json, name: str) -> str:
    roots = value.get("roots")
    if roots is None:
        return ""
    item = roots.get(name)
    return item.as_str() or "" if item is not None else ""


def _dossier_from(session: _Session, proposition: str) -> KarDossier:
    evaluation = _evaluation_from(session, proposition)
    evaluation_value = parse_json(evaluation.json)
    certificate = evaluation_value.get("certificate") or Json.null()
    plan_root = Json.null()
    roots = certificate.get("roots") if certificate.kind == "object" else None
    if roots is not None and roots.get("planRoot") is not None:
        plan_root = roots.get("planRoot")  # type: ignore[assignment]
    manifest = Json.object(
        [
            ("format", Json.string(_DOSSIER_FORMAT)),
            ("image", session.image),
            ("karRoot", Json.string(evaluation.kar_root)),
            ("planRoot", plan_root),
            ("queryDigest", Json.string(digest_json(Json.string(proposition)))),
            ("resultDigest", Json.string(digest_json(certificate))),
            ("semanticRoot", Json.string(evaluation.semantic_root)),
        ]
    )
    return KarDossier(
        _status_statement(evaluation.status),
        _render_markdown(session, proposition, evaluation, evaluation_value),
        stringify(manifest),
        stringify(certificate),
        evaluation.json,
    )


def _status_statement(status: str) -> str:
    if status == "SATISFIED":
        return "Evidence requirements satisfied"
    if status == "UNSATISFIED_EVIDENCE_REQUIREMENTS":
        return "Evidence requirements not satisfied"
    return f"Evaluation did not decide evidence requirements: {status}"


def _render_markdown(
    session: _Session, proposition: str, evaluation: KarEvaluation, value: Json
) -> str:
    selected_json = value.get("selectedEvidence")
    selected = selected_json.as_array() if selected_json is not None and selected_json.as_array() is not None else []
    lines = [
        "PROPOSITION",
        proposition,
        "",
        "STATUS",
        evaluation.status,
        _status_statement(evaluation.status),
        "",
        "SELECTED EVIDENCE",
    ]
    _push_evidence(lines, selected or [])
    lines.append("")
    for title, frontier in (
        ("SUPPORT", "F_S"),
        ("OPPOSITION", "F_O"),
        ("QUALIFICATIONS", "F_Q"),
        ("TEMPORAL/APPLICABILITY", "F_T"),
        ("AUTHORITY", "F_A"),
    ):
        lines.append(title)
        ids = next((items for name, items in evaluation.frontiers if name == frontier), [])
        rows = []
        for evidence_id in ids:
            row = next(
                (
                    item
                    for item in selected or []
                    if item.get("id") is not None and item.get("id").as_str() == evidence_id  # type: ignore[union-attr]
                ),
                None,
            )
            rows.append(row if row is not None else _evidence_row(session, evidence_id, frontier))
        _push_evidence(lines, rows)
        lines.append("")
    lines.append("WHY THESE ITEMS WERE SELECTED")
    reasons = _why_selected(session, proposition, value)
    if not reasons:
        lines.append("(none)")
    lines.extend(reasons)
    lines.append("")
    lines.append("CERTIFICATE ROOTS")
    certificate = value.get("certificate")
    roots = certificate.get("roots") if certificate is not None else None
    for label, field in (
        ("KnowledgeRoot", "knowledgeRoot"),
        ("SemanticRoot", "semanticRoot"),
        ("PlanRoot", "planRoot"),
        ("AnchorRoot", "anchorRoot"),
        ("FrontierRoot", "frontierRoot"),
        ("EvidenceSetRoot", "evidenceSetRoot"),
        ("DecisionRoot", "decisionRoot"),
        ("KARRoot", "karRoot"),
        ("QueryRoot", "queryRoot"),
        ("FrontierWitnessRoot", "frontierWitnessRoot"),
    ):
        root = ""
        if roots is not None and roots.get(field) is not None and roots.get(field).as_str():  # type: ignore[union-attr]
            root = roots.get(field).as_str() or ""  # type: ignore[union-attr]
        lines.append(f"{label} {root}")
    state = session.image.get("stateRoot")
    if state is not None and state.as_str():
        lines.append(f"V5StateRoot {state.as_str()}")
    lines.append("")
    lines.append("HOW TO VERIFY")
    lines.append(
        "Recompute the frozen KAR certificate from the Knowledge Image, the Committed Evidence Graph, the plan, and the proposition."
    )
    lines.append("knolo kar dossier verify <dossier-directory>")
    lines.append(
        "A change to the certificate, manifest, selected evidence, or this rendering fails closed."
    )
    lines.append("")
    return "\n".join(lines)


def _push_evidence(lines: list[str], rows: list[Json]) -> None:
    if not rows:
        lines.append("(none)")
        return
    for row in rows:
        evidence_id = row.get("id").as_str() if row.get("id") is not None else ""  # type: ignore[union-attr]
        source_json = row.get("source")
        source = ""
        if source_json is not None and source_json.as_str():
            source = f"  source {source_json.as_str()}"
        frontier_json = row.get("frontiers")
        frontiers = ""
        if frontier_json is not None and frontier_json.as_array() is not None:
            frontiers = ",".join(
                item.as_str() or "" for item in frontier_json.as_array() if item.kind == "string"  # type: ignore[union-attr]
            )
        frontier_text = f"  frontiers {frontiers}" if frontiers else ""
        lines.append(f"{evidence_id}{source}{frontier_text}")
        text = row.get("text")
        if text is not None and text.as_str() is not None:
            lines.append(text.as_str())  # type: ignore[arg-type]


def _evidence_row(session: _Session, evidence_id: str, frontier: str) -> Json:
    obj = next((row for row in session.objects if row.id == evidence_id), None)
    pairs: list[tuple[str, Json]] = [
        ("frontiers", Json.array([Json.string(frontier)])),
        ("id", Json.string(evidence_id)),
    ]
    if obj is not None:
        pairs.append(("metadata", obj.metadata))
        if obj.source is not None:
            pairs.append(("source", Json.string(obj.source)))
        pairs.append(("text", Json.string(obj.text)))
    return Json.object(pairs)


def _why_selected(session: _Session, proposition: str, evaluation: Json) -> list[str]:
    plan_json_value = evaluation.get("plan")
    if plan_json_value is None:
        return []
    plan = validate_plan(plan_json_value)
    certificate = evaluation.get("certificate")
    if plan is None or certificate is None:
        return []
    status = certificate.get("status").as_str() if certificate.get("status") is not None else ""  # type: ignore[union-attr]
    evidence_json = certificate.get("evidenceIds")
    evidence_ids = []
    if evidence_json is not None and evidence_json.as_array() is not None:
        evidence_ids = [
            item.as_str()
            for item in evidence_json.as_array()  # type: ignore[union-attr]
            if item.kind == "string" and item.as_str()
        ]
    commitment, rejected = resolve_anchor(proposition, list(session.indexes.node_ids), plan.anchor)
    if rejected:
        return []
    closed = close_frontiers(session.graph, plan, commitment.nodes, session.indexes)
    if closed is None:
        return []
    witnesses_match = canonicalize(
        Json.array([witness_json(item) for item in closed.witnesses])
    ) == canonicalize(certificate.get("witnesses") or Json.null())
    lines: list[str] = []
    seen: list[str] = []
    for witness in closed.witnesses:
        key = f"{witness.frontier}\0{witness.evidence_id}"
        if key in seen:
            continue
        seen.append(key)
        if witness.evidence_id not in evidence_ids:
            continue
        requirements: list[str] = []
        if witnesses_match:
            for admission in closed.admissions:
                if (
                    admission.evidence_id == witness.evidence_id
                    and admission.frontier == witness.frontier
                    and admission.applicable
                ):
                    for requirement in admission.requirements:
                        if requirement not in requirements:
                            requirements.append(requirement)
            requirements.sort(key=_units)
        necessary = None
        if witnesses_match and status == "SATISFIED":
            remaining = [item for item in evidence_ids if item != witness.evidence_id]
            necessary = not covers_plan(
                plan, closed.admissions, session.prepared.texts, remaining
            )
        reason = _evidence_reason(status or "", necessary, requirements)
        lines.append(f"{witness.evidence_id} {witness.frontier} {reason}")
    return lines


def _evidence_reason(status: str, necessary: bool | None, requirements: list[str]) -> str:
    if status != "SATISFIED":
        return "listed on a frontier while the decision did not select a set"
    if necessary is None:
        return "selected; necessity was not recomputed"
    if necessary and requirements:
        return f"required for this set; contributes {','.join(requirements)}"
    if necessary:
        return "required for this set"
    return "kept by the profile order; the floors still pass without it"


def _object_source(kind: str, meta: Json) -> str | None:
    source = meta.get("source")
    if source is not None and source.as_str():
        return source.as_str()
    if not kind:
        return None
    return kind


def _value_to_json(value: object) -> Json:
    if value is None:
        return Json.null()
    if isinstance(value, bool):
        return Json.bool(value)
    if isinstance(value, int):
        if value < _I64_MIN or value > _I64_MAX:
            raise KarRunError("KAR_IMAGE_REJECTED", "KAR metadata integer is out of range")
        return Json.int(value)
    if isinstance(value, str):
        return Json.string(value)
    if isinstance(value, bytes):
        return Json.object([(str(index), Json.int(byte)) for index, byte in enumerate(value)])
    if isinstance(value, list):
        return Json.array([_value_to_json(item) for item in value])
    if isinstance(value, dict):
        return Json.object([(str(key), _value_to_json(item)) for key, item in value.items()])
    raise KarRunError("KAR_IMAGE_REJECTED", "unsupported KAR metadata value")


def _units(text: str) -> tuple[int, ...]:
    from .jsoncanon import utf16_units

    return utf16_units(text)
