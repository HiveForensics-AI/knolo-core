//! V5 KAR session, verification, and dossier rendering.
//! SATISFIED means the evidence requirements were met. It does not mean a claim is proven.

use crate::kar::closure::{close_frontiers, witness_json};
use crate::kar::cover::covers_plan;
use crate::kar::evaluate::{certificate_json, evaluate_bound, status_code, BoundInputs, KarResult};
use crate::kar::json::{canonicalize, digest_json, parse_json, stringify, Json};
use crate::kar::model::{
    build_indexes, graph_json, is_root, only_keys, plan_json, prepare_graph, prepare_image,
    semantic_root_of, validate_plan, Graph, Indexes, Plan, PreparedImage, FRONTIERS, KAR_API,
    KAR_VERSION,
};
use crate::{mount_knowledge_image, CborValue};

const DOSSIER_FORMAT: &str = "kar-evidence-dossier-1";
const STATUSES: [&str; 8] = [
    "SATISFIED",
    "UNSATISFIED_EVIDENCE_REQUIREMENTS",
    "SEARCH_BOUND_EXCEEDED",
    "CLOSURE_BOUND_EXCEEDED",
    "ANCHOR_REJECTED",
    "GRAPH_NOT_BOUND",
    "GRAPH_INVALID",
    "PLAN_INVALID",
];
const ROOT_FIELDS: [&str; 10] = [
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
];

#[derive(Debug, Clone)]
pub struct KarRunError {
    pub code: String,
    pub message: String,
}

#[derive(Debug, Clone)]
pub struct KarEvaluation {
    pub status: String,
    pub code: Option<String>,
    pub proposition: String,
    pub anchor_mode: Option<String>,
    pub frontiers: Vec<(String, Vec<String>)>,
    pub selected_len: usize,
    pub knowledge_root: String,
    pub semantic_root: String,
    pub kar_root: String,
    pub json: String,
}

#[derive(Debug, Clone)]
pub struct KarVerification {
    pub ok: bool,
    pub code: String,
    pub reason: String,
    pub status: Option<String>,
}

#[derive(Debug, Clone)]
pub struct KarDossier {
    pub status_statement: String,
    pub markdown: String,
    pub manifest_json: String,
    pub certificate_json: String,
    pub evaluation_json: String,
}

struct ObjectRow {
    id: String,
    text: String,
    source: Option<String>,
    metadata: Json,
}

struct Session {
    image: Json,
    graph: Graph,
    prepared: PreparedImage,
    indexes: Indexes,
    objects: Vec<ObjectRow>,
    semantic_root: String,
    plan_input: Json,
}

pub fn evaluate_kar_v5(
    image: &[u8],
    sidecar_json: &str,
    proposition: &str,
    plan_json_text: &str,
) -> Result<KarEvaluation, KarRunError> {
    let session = open_session(image, sidecar_json, plan_json_text)?;
    Ok(evaluation_from(&session, proposition))
}

pub fn verify_kar_v5(
    image: &[u8],
    sidecar_json: &str,
    proposition: &str,
    plan_json_text: &str,
    claimed_json: &str,
) -> KarVerification {
    let session = match open_session(image, sidecar_json, plan_json_text) {
        Ok(session) => session,
        Err(error) => {
            return KarVerification {
                ok: false,
                code: error.code,
                reason: error.message,
                status: None,
            }
        }
    };
    let actual = evaluation_from(&session, proposition);
    compare_claim(&actual, claimed_json, proposition)
}

pub fn create_kar_dossier_v5(
    image: &[u8],
    sidecar_json: &str,
    proposition: &str,
    plan_json_text: &str,
) -> Result<KarDossier, KarRunError> {
    let session = open_session(image, sidecar_json, plan_json_text)?;
    Ok(dossier_from(&session, proposition))
}

pub fn render_kar_dossier(dossier: &KarDossier) -> String {
    dossier.markdown.clone()
}

pub fn verify_kar_dossier_v5(
    image: &[u8],
    sidecar_json: &str,
    proposition: &str,
    plan_json_text: &str,
    manifest_json: &str,
    certificate_json_text: &str,
    evaluation_json: &str,
    evidence_markdown: Option<&str>,
) -> KarVerification {
    let verdict = verify_kar_v5(
        image,
        sidecar_json,
        proposition,
        plan_json_text,
        certificate_json_text,
    );
    if !verdict.ok {
        return verdict;
    }
    let actual = match create_kar_dossier_v5(image, sidecar_json, proposition, plan_json_text) {
        Ok(dossier) => dossier,
        Err(error) => {
            return KarVerification {
                ok: false,
                code: error.code,
                reason: error.message,
                status: None,
            }
        }
    };
    let claimed_manifest = match parse_json(manifest_json) {
        Ok(value) => value,
        Err(error) => {
            return KarVerification {
                ok: false,
                code: "KAR_RESULT_MISMATCH".into(),
                reason: error,
                status: Some(actual.status_statement.clone()),
            }
        }
    };
    let actual_manifest = parse_json(&actual.manifest_json).expect("dossier manifest is JSON");
    if canonicalize(&claimed_manifest) != canonicalize(&actual_manifest) {
        return KarVerification {
            ok: false,
            code: "KAR_RESULT_MISMATCH".into(),
            reason: "dossier manifest mismatch".into(),
            status: Some(status_of(&actual)),
        };
    }
    let claimed_certificate = match parse_json(certificate_json_text) {
        Ok(value) => value,
        Err(error) => {
            return KarVerification {
                ok: false,
                code: "KAR_RESULT_MISMATCH".into(),
                reason: error,
                status: Some(status_of(&actual)),
            }
        }
    };
    let actual_certificate =
        parse_json(&actual.certificate_json).expect("dossier certificate is JSON");
    if canonicalize(&claimed_certificate) != canonicalize(&actual_certificate) {
        return KarVerification {
            ok: false,
            code: "KAR_RESULT_MISMATCH".into(),
            reason: "dossier certificate mismatch".into(),
            status: Some(status_of(&actual)),
        };
    }
    let claimed_evaluation = match parse_json(evaluation_json) {
        Ok(value) => value,
        Err(error) => {
            return KarVerification {
                ok: false,
                code: "KAR_RESULT_MISMATCH".into(),
                reason: error,
                status: Some(status_of(&actual)),
            }
        }
    };
    let actual_evaluation =
        parse_json(&actual.evaluation_json).expect("dossier evaluation is JSON");
    if canonicalize(&claimed_evaluation) != canonicalize(&actual_evaluation) {
        return KarVerification {
            ok: false,
            code: "KAR_RESULT_MISMATCH".into(),
            reason: "dossier result mismatch".into(),
            status: Some(status_of(&actual)),
        };
    }
    if let Some(markdown) = evidence_markdown {
        if markdown != actual.markdown {
            return KarVerification {
                ok: false,
                code: "KAR_RESULT_MISMATCH".into(),
                reason: "dossier rendering mismatch".into(),
                status: Some(status_of(&actual)),
            };
        }
    }
    KarVerification {
        ok: true,
        code: "VERIFIED".into(),
        reason: String::new(),
        status: Some(status_of(&actual)),
    }
}

fn status_of(dossier: &KarDossier) -> String {
    parse_json(&dossier.evaluation_json)
        .ok()
        .and_then(|value| {
            value
                .get("status")
                .and_then(Json::as_str)
                .map(str::to_string)
        })
        .unwrap_or_default()
}

fn open_session(
    image: &[u8],
    sidecar_json: &str,
    plan_json_text: &str,
) -> Result<Session, KarRunError> {
    let mounted = mount_knowledge_image(image).map_err(|error| KarRunError {
        code: "KAR_IMAGE_REJECTED".into(),
        message: error.to_string(),
    })?;
    let sidecar = parse_json(sidecar_json).map_err(|error| KarRunError {
        code: "KAR_SIDECAR_INVALID".into(),
        message: error,
    })?;
    let plan_input = parse_json(plan_json_text).map_err(|error| KarRunError {
        code: "KAR_PLAN_INVALID".into(),
        message: error,
    })?;
    let sidecar_value = validate_sidecar(&sidecar)?;
    let mut rows = Vec::new();
    for object in &mounted.objects {
        let text = decode_object_text(&object.bytes);
        let meta = cbor_to_json(&object.meta).map_err(|error| KarRunError {
            code: "KAR_IMAGE_REJECTED".into(),
            message: error,
        })?;
        let source = object_source(&object.kind, &meta);
        rows.push(ObjectRow {
            id: object.id.clone(),
            text,
            source,
            metadata: Json::object(vec![
                ("kind", Json::String(object.kind.clone())),
                ("meta", meta),
            ]),
        });
    }
    rows.sort_by(|left, right| crate::kar::json::utf16_cmp(&left.id, &right.id));
    let prepared = prepare_image(
        rows.iter()
            .map(|row| (row.id.clone(), row.text.clone()))
            .collect(),
    );
    let binding = binding_error(
        &sidecar_value,
        &prepared,
        &mounted.state_root,
        &mounted.commit.object_root,
        &mounted.commit_digest,
    );
    if let Some(error) = binding {
        return Err(error);
    }
    let indexes = build_indexes(&sidecar_value.graph);
    let semantic_root = semantic_root_of(&sidecar_value.graph);
    let image_identity = Json::object(vec![
        ("commitDigest", Json::String(mounted.commit_digest.clone())),
        (
            "knowledgeRoot",
            Json::String(prepared.knowledge_root.clone()),
        ),
        (
            "objectRoot",
            Json::String(mounted.commit.object_root.clone()),
        ),
        ("stateRoot", Json::String(mounted.state_root.clone())),
    ]);
    Ok(Session {
        image: image_identity,
        graph: sidecar_value.graph,
        prepared,
        indexes,
        objects: rows,
        semantic_root,
        plan_input,
    })
}

struct Sidecar {
    state_root: String,
    object_root: String,
    commit_digest: String,
    knowledge_root: String,
    graph: Graph,
}

fn validate_sidecar(input: &Json) -> Result<Sidecar, KarRunError> {
    let Some(raw) = input.as_object() else {
        return Err(KarRunError {
            code: "KAR_SIDECAR_INVALID".into(),
            message: "A KAR sidecar must be an object.".into(),
        });
    };
    if !only_keys(
        raw,
        &[
            "version",
            "stateRoot",
            "objectRoot",
            "commitDigest",
            "knowledgeRoot",
            "graph",
        ],
    ) || input.get("version").and_then(Json::as_int) != Some(1)
    {
        return Err(KarRunError {
            code: "KAR_SIDECAR_INVALID".into(),
            message: "Sidecar version must be 1.".into(),
        });
    }
    for field in ["stateRoot", "objectRoot", "commitDigest", "knowledgeRoot"] {
        let Some(value) = input.get(field).and_then(Json::as_str) else {
            return Err(KarRunError {
                code: "KAR_SIDECAR_INVALID".into(),
                message: format!("{field} must be a sha256 digest."),
            });
        };
        if !is_root(value) {
            return Err(KarRunError {
                code: "KAR_SIDECAR_INVALID".into(),
                message: format!("{field} must be a sha256 digest."),
            });
        }
    }
    let Some(graph_value) = input.get("graph") else {
        return Err(KarRunError {
            code: "KAR_GRAPH_INVALID".into(),
            message: "The committed evidence graph is not valid.".into(),
        });
    };
    let Some(graph) = prepare_graph(graph_value) else {
        return Err(KarRunError {
            code: "KAR_GRAPH_INVALID".into(),
            message: "The committed evidence graph is not valid.".into(),
        });
    };
    let knowledge_root = input
        .get("knowledgeRoot")
        .and_then(Json::as_str)
        .unwrap_or("")
        .to_string();
    if graph.knowledge_root != knowledge_root {
        return Err(KarRunError {
            code: "KAR_GRAPH_NOT_BOUND".into(),
            message:
                "Sidecar knowledgeRoot does not equal the committed evidence graph knowledgeRoot."
                    .into(),
        });
    }
    Ok(Sidecar {
        state_root: input
            .get("stateRoot")
            .and_then(Json::as_str)
            .unwrap_or("")
            .to_string(),
        object_root: input
            .get("objectRoot")
            .and_then(Json::as_str)
            .unwrap_or("")
            .to_string(),
        commit_digest: input
            .get("commitDigest")
            .and_then(Json::as_str)
            .unwrap_or("")
            .to_string(),
        knowledge_root,
        graph,
    })
}

fn binding_error(
    sidecar: &Sidecar,
    prepared: &PreparedImage,
    state_root: &str,
    object_root: &str,
    commit_digest: &str,
) -> Option<KarRunError> {
    if sidecar.state_root != state_root {
        return Some(KarRunError {
            code: "KAR_GRAPH_NOT_BOUND".into(),
            message: "Sidecar stateRoot does not match the mounted V5 image.".into(),
        });
    }
    if sidecar.object_root != object_root {
        return Some(KarRunError {
            code: "KAR_GRAPH_NOT_BOUND".into(),
            message: "Sidecar objectRoot does not match the mounted V5 image.".into(),
        });
    }
    if sidecar.commit_digest != commit_digest {
        return Some(KarRunError {
            code: "KAR_GRAPH_NOT_BOUND".into(),
            message: "Sidecar commitDigest does not match the mounted V5 image.".into(),
        });
    }
    if sidecar.knowledge_root != prepared.knowledge_root {
        return Some(KarRunError { code: "KAR_GRAPH_NOT_BOUND".into(), message: format!("Sidecar knowledgeRoot does not match the frozen KAR projection of this image. image {} sidecar {}", prepared.knowledge_root, sidecar.knowledge_root) });
    }
    None
}

fn evaluation_from(session: &Session, proposition: &str) -> KarEvaluation {
    let certificate = evaluate_bound(&BoundInputs {
        prepared: Some(&session.prepared),
        graph: Some(&session.graph),
        indexes: Some(&session.indexes),
        image_input: &Json::Null,
        graph_input: &graph_json(&session.graph),
        query: proposition,
        plan_input: &session.plan_input,
        knowledge_root: Some(&session.prepared.knowledge_root),
        semantic_root: Some(&session.semantic_root),
    });
    let plan = validate_plan(&session.plan_input);
    let json = evaluation_json(session, proposition, plan.as_ref(), &certificate);
    KarEvaluation {
        status: certificate.status.clone(),
        code: status_code(&certificate.status),
        proposition: proposition.to_string(),
        anchor_mode: plan.as_ref().map(anchor_mode),
        frontiers: certificate.frontiers.clone(),
        selected_len: certificate.evidence_ids.len(),
        knowledge_root: certificate.roots.knowledge_root.clone(),
        semantic_root: certificate.roots.semantic_root.clone(),
        kar_root: certificate.roots.kar_root.clone(),
        json: stringify(&json),
    }
}

fn anchor_mode(plan: &Plan) -> String {
    match plan.anchor {
        crate::kar::model::AnchorSpec::Recompute { .. } => "recompute".into(),
        crate::kar::model::AnchorSpec::Supplied { .. } => "supplied".into(),
    }
}

fn evaluation_json(
    session: &Session,
    proposition: &str,
    plan: Option<&Plan>,
    certificate: &KarResult,
) -> Json {
    let choices = certificate
        .choices
        .iter()
        .map(|choice| (choice.evidence_id.clone(), choice.frontiers.clone()))
        .collect::<Vec<_>>();
    let selected = certificate
        .evidence_ids
        .iter()
        .map(|id| {
            let object = session.objects.iter().find(|row| &row.id == id);
            let frontiers = choices
                .iter()
                .find(|(evidence_id, _)| evidence_id == id)
                .map(|(_, frontiers)| frontiers.clone())
                .unwrap_or_default();
            let mut pairs = vec![
                (
                    "frontiers".to_string(),
                    Json::Array(frontiers.into_iter().map(Json::String).collect()),
                ),
                ("id".to_string(), Json::String(id.clone())),
            ];
            if let Some(object) = object {
                pairs.push(("metadata".to_string(), object.metadata.clone()));
                if let Some(source) = &object.source {
                    pairs.push(("source".to_string(), Json::String(source.clone())));
                }
                pairs.push(("text".to_string(), Json::String(object.text.clone())));
            }
            Json::Object(pairs)
        })
        .collect();
    Json::object(vec![
        ("api", Json::String(KAR_API.into())),
        ("certificate", certificate_json(certificate)),
        ("code", certificate_code(certificate)),
        ("experimental", Json::Bool(true)),
        (
            "frontiers",
            crate::kar::model::frontiers_json(&certificate.frontiers),
        ),
        ("image", session.image.clone()),
        ("plan", plan.map(plan_json).unwrap_or(Json::Null)),
        ("proposition", Json::String(proposition.to_string())),
        ("selectedEvidence", Json::Array(selected)),
        ("status", Json::String(certificate.status.clone())),
        ("version", Json::String(KAR_VERSION.into())),
        (
            "witnesses",
            Json::Array(certificate.witnesses.iter().map(witness_json).collect()),
        ),
    ])
}

fn certificate_code(certificate: &KarResult) -> Json {
    match status_code(&certificate.status) {
        Some(code) => Json::String(code),
        None => Json::Null,
    }
}

fn compare_claim(actual: &KarEvaluation, claimed_json: &str, proposition: &str) -> KarVerification {
    let claimed_value = match parse_json(claimed_json) {
        Ok(value) => value,
        Err(_) => {
            return KarVerification {
                ok: false,
                code: "KAR_RESULT_INVALID".into(),
                reason: "The claimed result is not a KAR certificate.".into(),
                status: Some(actual.status.clone()),
            }
        }
    };
    let Some(claimed) = certificate_of(&claimed_value) else {
        return KarVerification {
            ok: false,
            code: "KAR_RESULT_INVALID".into(),
            reason: "The claimed result is not a KAR certificate.".into(),
            status: Some(actual.status.clone()),
        };
    };
    let actual_certificate = parse_json(&actual.json)
        .ok()
        .and_then(|value| value.get("certificate").cloned())
        .unwrap_or(Json::Null);
    if canonicalize(&actual_certificate) != canonicalize(claimed) {
        return KarVerification {
            ok: false,
            code: "KAR_RESULT_MISMATCH".into(),
            reason: mismatch_reason(&actual_certificate, claimed),
            status: Some(actual.status.clone()),
        };
    }
    let Some(envelope) = claimed_json_object(&claimed_value) else {
        return KarVerification {
            ok: true,
            code: "VERIFIED".into(),
            reason: String::new(),
            status: Some(actual.status.clone()),
        };
    };
    if envelope.get("certificate").is_none() {
        return KarVerification {
            ok: true,
            code: "VERIFIED".into(),
            reason: String::new(),
            status: Some(actual.status.clone()),
        };
    }
    let actual_value = parse_json(&actual.json).expect("evaluation JSON");
    if let Some(flag) = envelope.get("experimental") {
        if flag != &Json::Bool(true) {
            return mismatch(actual, "experimental flag mismatch");
        }
    }
    if let Some(Json::String(value)) = envelope.get("proposition") {
        if value != proposition {
            return mismatch(actual, "proposition mismatch");
        }
    }
    for (field, reason) in [
        ("plan", "plan mismatch"),
        ("image", "image identity mismatch"),
        ("selectedEvidence", "selected evidence mismatch"),
        ("frontiers", "frontier mismatch"),
        ("witnesses", "witness mismatch"),
    ] {
        if let Some(value) = envelope.get(field) {
            if canonicalize(value) != canonicalize(actual_value.get(field).unwrap_or(&Json::Null)) {
                return mismatch(actual, reason);
            }
        }
    }
    if let Some(code) = envelope.get("code") {
        if code != actual_value.get("code").unwrap_or(&Json::Null) {
            return mismatch(actual, "status code mismatch");
        }
    }
    if let Some(status) = envelope.get("status") {
        if status != actual_value.get("status").unwrap_or(&Json::Null) {
            return mismatch(actual, "status mismatch");
        }
    }
    KarVerification {
        ok: true,
        code: "VERIFIED".into(),
        reason: String::new(),
        status: Some(actual.status.clone()),
    }
}

fn mismatch(actual: &KarEvaluation, reason: &str) -> KarVerification {
    KarVerification {
        ok: false,
        code: "KAR_RESULT_MISMATCH".into(),
        reason: reason.into(),
        status: Some(actual.status.clone()),
    }
}

fn claimed_json_object(value: &Json) -> Option<&Json> {
    value.as_object().map(|_| value)
}

fn certificate_of(input: &Json) -> Option<&Json> {
    if input.get("certificate").and_then(Json::as_object).is_some() {
        return certificate_of(input.get("certificate")?);
    }
    if input.get("version").and_then(Json::as_str) != Some(KAR_VERSION) {
        return None;
    }
    let status = input.get("status").and_then(Json::as_str)?;
    if !STATUSES.contains(&status) {
        return None;
    }
    string_array(input.get("evidenceIds")?)?;
    if !matches!(input.get("choices")?, Json::Array(_))
        || !matches!(input.get("witnesses")?, Json::Array(_))
    {
        return None;
    }
    let frontiers = input.get("frontiers")?;
    let decision = input.get("decision")?;
    let roots = input.get("roots")?;
    for frontier in FRONTIERS {
        string_array(frontiers.get(frontier)?)?;
    }
    if decision.get("status").and_then(Json::as_str) != Some(status) {
        return None;
    }
    for name in ROOT_FIELDS {
        let root = roots.get(name).and_then(Json::as_str)?;
        if !is_root(root) {
            return None;
        }
    }
    Some(input)
}

fn string_array(value: &Json) -> Option<()> {
    let Json::Array(items) = value else {
        return None;
    };
    if items.iter().all(|item| matches!(item, Json::String(_))) {
        Some(())
    } else {
        None
    }
}

fn mismatch_reason(actual: &Json, claimed: &Json) -> String {
    for field in [
        "version",
        "status",
        "evidenceIds",
        "choices",
        "frontiers",
        "witnesses",
        "decision",
        "roots",
    ] {
        if canonicalize(actual.get(field).unwrap_or(&Json::Null))
            == canonicalize(claimed.get(field).unwrap_or(&Json::Null))
        {
            continue;
        }
        if field == "roots" {
            for root in ROOT_FIELDS {
                let left = actual
                    .get("roots")
                    .and_then(|roots| roots.get(root))
                    .and_then(Json::as_str)
                    .unwrap_or("");
                let right = claimed
                    .get("roots")
                    .and_then(|roots| roots.get(root))
                    .and_then(Json::as_str)
                    .unwrap_or("");
                if left != right {
                    return format!("root mismatch {root}");
                }
            }
        }
        if field == "status" {
            let left = actual.get("status").and_then(Json::as_str).unwrap_or("");
            let right = claimed.get("status").and_then(Json::as_str).unwrap_or("");
            return format!("status {left} did not match {right}");
        }
        return format!("field mismatch {field}");
    }
    "certificate mismatch".into()
}

fn dossier_from(session: &Session, proposition: &str) -> KarDossier {
    let evaluation = evaluation_from(session, proposition);
    let evaluation_value = parse_json(&evaluation.json).expect("evaluation JSON");
    let certificate = evaluation_value
        .get("certificate")
        .cloned()
        .unwrap_or(Json::Null);
    let manifest = Json::object(vec![
        ("format", Json::String(DOSSIER_FORMAT.into())),
        ("image", session.image.clone()),
        ("karRoot", Json::String(evaluation.kar_root.clone())),
        (
            "planRoot",
            certificate
                .get("roots")
                .and_then(|roots| roots.get("planRoot"))
                .cloned()
                .unwrap_or(Json::Null),
        ),
        (
            "queryDigest",
            digest_json(&Json::String(proposition.to_string())).into_json_string(),
        ),
        ("resultDigest", digest_json(&certificate).into_json_string()),
        (
            "semanticRoot",
            Json::String(evaluation.semantic_root.clone()),
        ),
    ]);
    let markdown = render_markdown(session, proposition, &evaluation, &evaluation_value);
    KarDossier {
        status_statement: status_statement(&evaluation.status),
        markdown,
        manifest_json: stringify(&manifest),
        certificate_json: stringify(&certificate),
        evaluation_json: evaluation.json,
    }
}

fn status_statement(status: &str) -> String {
    if status == "SATISFIED" {
        "Evidence requirements satisfied".into()
    } else if status == "UNSATISFIED_EVIDENCE_REQUIREMENTS" {
        "Evidence requirements not satisfied".into()
    } else {
        format!("Evaluation did not decide evidence requirements: {status}")
    }
}

trait JsonString {
    fn into_json_string(self) -> Json;
}

impl JsonString for String {
    fn into_json_string(self) -> Json {
        Json::String(self)
    }
}

fn render_markdown(
    session: &Session,
    proposition: &str,
    evaluation: &KarEvaluation,
    value: &Json,
) -> String {
    let selected = value
        .get("selectedEvidence")
        .and_then(|item| match item {
            Json::Array(rows) => Some(rows),
            _ => None,
        })
        .cloned()
        .unwrap_or_default();
    let mut lines = Vec::new();
    lines.push("PROPOSITION".into());
    lines.push(proposition.to_string());
    lines.push(String::new());
    lines.push("STATUS".into());
    lines.push(evaluation.status.clone());
    lines.push(status_statement(&evaluation.status));
    lines.push(String::new());
    lines.push("SELECTED EVIDENCE".into());
    push_evidence(&mut lines, &selected);
    lines.push(String::new());
    for (title, frontier) in [
        ("SUPPORT", "F_S"),
        ("OPPOSITION", "F_O"),
        ("QUALIFICATIONS", "F_Q"),
        ("TEMPORAL/APPLICABILITY", "F_T"),
        ("AUTHORITY", "F_A"),
    ] {
        lines.push(title.into());
        let ids = evaluation
            .frontiers
            .iter()
            .find(|(name, _)| name == frontier)
            .map(|(_, ids)| ids.clone())
            .unwrap_or_default();
        let rows = ids
            .iter()
            .map(|id| {
                selected
                    .iter()
                    .find(|row| row.get("id").and_then(Json::as_str) == Some(id.as_str()))
                    .cloned()
                    .unwrap_or_else(|| evidence_row(session, id, frontier))
            })
            .collect::<Vec<_>>();
        push_evidence(&mut lines, &rows);
        lines.push(String::new());
    }
    lines.push("WHY THESE ITEMS WERE SELECTED".into());
    let reasons = why_selected(session, proposition, value);
    if reasons.is_empty() {
        lines.push("(none)".into());
    }
    for reason in reasons {
        lines.push(reason);
    }
    lines.push(String::new());
    lines.push("CERTIFICATE ROOTS".into());
    let roots = value
        .get("certificate")
        .and_then(|certificate| certificate.get("roots"));
    for (label, field) in [
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
    ] {
        let root = roots
            .and_then(|item| item.get(field))
            .and_then(Json::as_str)
            .unwrap_or("");
        lines.push(format!("{label} {root}"));
    }
    if let Some(state_root) = session.image.get("stateRoot").and_then(Json::as_str) {
        lines.push(format!("V5StateRoot {state_root}"));
    }
    lines.push(String::new());
    lines.push("HOW TO VERIFY".into());
    lines.push("Recompute the frozen KAR certificate from the Knowledge Image, the Committed Evidence Graph, the plan, and the proposition.".into());
    lines.push("knolo kar dossier verify <dossier-directory>".into());
    lines.push(
        "A change to the certificate, manifest, selected evidence, or this rendering fails closed."
            .into(),
    );
    lines.push(String::new());
    lines.join("\n")
}

fn push_evidence(lines: &mut Vec<String>, rows: &[Json]) {
    if rows.is_empty() {
        lines.push("(none)".into());
        return;
    }
    for row in rows {
        let id = row.get("id").and_then(Json::as_str).unwrap_or("");
        let source = row
            .get("source")
            .and_then(Json::as_str)
            .filter(|source| !source.is_empty())
            .map(|source| format!("  source {source}"))
            .unwrap_or_default();
        let frontiers = match row.get("frontiers") {
            Some(Json::Array(items)) => items
                .iter()
                .filter_map(Json::as_str)
                .collect::<Vec<_>>()
                .join(","),
            _ => String::new(),
        };
        let frontier_text = if frontiers.is_empty() {
            String::new()
        } else {
            format!("  frontiers {frontiers}")
        };
        lines.push(format!("{id}{source}{frontier_text}"));
        if let Some(text) = row.get("text").and_then(Json::as_str) {
            lines.push(text.to_string());
        }
    }
}

fn evidence_row(session: &Session, id: &str, frontier: &str) -> Json {
    let object = session.objects.iter().find(|row| row.id == id);
    let mut pairs = vec![
        (
            "frontiers".to_string(),
            Json::Array(vec![Json::String(frontier.to_string())]),
        ),
        ("id".to_string(), Json::String(id.to_string())),
    ];
    if let Some(object) = object {
        pairs.push(("metadata".to_string(), object.metadata.clone()));
        if let Some(source) = &object.source {
            pairs.push(("source".to_string(), Json::String(source.clone())));
        }
        pairs.push(("text".to_string(), Json::String(object.text.clone())));
    }
    Json::Object(pairs)
}

fn why_selected(session: &Session, proposition: &str, evaluation: &Json) -> Vec<String> {
    let Some(plan) = evaluation
        .get("plan")
        .and_then(|value| validate_plan(value))
    else {
        return Vec::new();
    };
    let Some(certificate) = evaluation.get("certificate") else {
        return Vec::new();
    };
    let status = certificate
        .get("status")
        .and_then(Json::as_str)
        .unwrap_or("");
    let evidence_ids = match certificate.get("evidenceIds") {
        Some(Json::Array(items)) => items
            .iter()
            .filter_map(Json::as_str)
            .map(str::to_string)
            .collect::<Vec<_>>(),
        _ => Vec::new(),
    };
    let node_ids = session.indexes.node_ids.clone();
    let (commitment, rejected) =
        crate::kar::model::resolve_anchor(proposition, &node_ids, &plan.anchor);
    if rejected {
        return Vec::new();
    }
    let Ok(closed) = close_frontiers(
        &session.graph,
        &plan,
        &commitment.nodes,
        Some(&session.indexes),
    ) else {
        return Vec::new();
    };
    let witnesses_match = canonicalize(&Json::Array(
        closed.witnesses.iter().map(witness_json).collect(),
    )) == canonicalize(certificate.get("witnesses").unwrap_or(&Json::Null));
    let mut lines = Vec::new();
    let mut seen = Vec::new();
    for witness in &closed.witnesses {
        let key = format!("{}\0{}", witness.frontier, witness.evidence_id);
        if seen.iter().any(|existing| existing == &key) {
            continue;
        }
        seen.push(key);
        if !evidence_ids.iter().any(|id| id == &witness.evidence_id) {
            continue;
        }
        let requirements = if witnesses_match {
            let mut found = Vec::new();
            for admission in &closed.admissions {
                if admission.evidence_id == witness.evidence_id
                    && admission.frontier == witness.frontier
                    && admission.applicable
                {
                    for requirement in &admission.requirements {
                        if !found.iter().any(|item| item == requirement) {
                            found.push(requirement.clone());
                        }
                    }
                }
            }
            found.sort_by(|left, right| crate::kar::json::utf16_cmp(left, right));
            found
        } else {
            Vec::new()
        };
        let necessary = if witnesses_match && status == "SATISFIED" {
            let remaining = evidence_ids
                .iter()
                .filter(|id| *id != &witness.evidence_id)
                .cloned()
                .collect::<Vec<_>>();
            Some(!covers_plan(
                &plan,
                &closed.admissions,
                &session.prepared.texts,
                &remaining,
            ))
        } else {
            None
        };
        let reason = evidence_reason(status, necessary, &requirements);
        lines.push(format!(
            "{} {} {reason}",
            witness.evidence_id, witness.frontier
        ));
    }
    lines
}

fn evidence_reason(status: &str, necessary: Option<bool>, requirements: &[String]) -> String {
    if status != "SATISFIED" {
        return "listed on a frontier while the decision did not select a set".into();
    }
    match necessary {
        None => "selected; necessity was not recomputed".into(),
        Some(true) if !requirements.is_empty() => format!(
            "required for this set; contributes {}",
            requirements.join(",")
        ),
        Some(true) => "required for this set".into(),
        Some(false) => "kept by the profile order; the floors still pass without it".into(),
    }
}

fn decode_object_text(bytes: &[u8]) -> String {
    // `TextDecoder` is non-fatal. Invalid UTF-8 becomes U+FFFD.
    String::from_utf8_lossy(bytes).into_owned()
}

fn object_source(kind: &str, meta: &Json) -> Option<String> {
    if let Some(source) = meta.get("source").and_then(Json::as_str) {
        if !source.is_empty() {
            return Some(source.to_string());
        }
    }
    if kind.is_empty() {
        None
    } else {
        Some(kind.to_string())
    }
}

fn cbor_to_json(value: &CborValue) -> Result<Json, String> {
    match value {
        CborValue::Null => Ok(Json::Null),
        CborValue::Bool(item) => Ok(Json::Bool(*item)),
        CborValue::UInt(item) => i64::try_from(*item)
            .map(Json::Int)
            .map_err(|_| "KAR metadata integer is out of range".to_string()),
        CborValue::NInt(item) => Ok(Json::Int(*item)),
        CborValue::Text(item) => Ok(Json::String(item.clone())),
        // A byte string is a Uint8Array in the TypeScript projection.
        // JSON.stringify and canonicalize both turn that into decimal index keys.
        CborValue::Bytes(bytes) => Ok(Json::Object(
            bytes
                .iter()
                .enumerate()
                .map(|(index, byte)| (index.to_string(), Json::Int(i64::from(*byte))))
                .collect(),
        )),
        CborValue::Array(items) => items
            .iter()
            .map(cbor_to_json)
            .collect::<Result<Vec<_>, _>>()
            .map(Json::Array),
        CborValue::Map(entries) => {
            let mut pairs = Vec::new();
            for (key, child) in entries {
                pairs.push((key.clone(), cbor_to_json(child)?));
            }
            Ok(Json::Object(pairs))
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn object_text_replaces_invalid_utf8() {
        assert_eq!(decode_object_text(&[0xe2, 0x82, 0xac]), "€");
        assert_eq!(decode_object_text(&[0xc2, 0x20]), "\u{FFFD} ");
        assert_eq!(
            decode_object_text(&[0xed, 0xa0, 0x80]),
            "\u{FFFD}\u{FFFD}\u{FFFD}"
        );
    }

    #[test]
    fn metadata_bytes_project_like_uint8array() {
        let mut bytes = vec![0; 11];
        bytes[10] = 7;
        let value = cbor_to_json(&CborValue::Bytes(bytes)).expect("bytes");
        assert_eq!(
            canonicalize(&value),
            r#"{"0":0,"1":0,"10":7,"2":0,"3":0,"4":0,"5":0,"6":0,"7":0,"8":0,"9":0}"#
        );
        assert_eq!(
            stringify(&value),
            r#"{"0":0,"1":0,"2":0,"3":0,"4":0,"5":0,"6":0,"7":0,"8":0,"9":0,"10":7}"#
        );
        assert_eq!(
            stringify(&cbor_to_json(&CborValue::Bytes(Vec::new())).expect("empty")),
            "{}"
        );
    }
}
