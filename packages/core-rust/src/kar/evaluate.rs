//! Frozen evaluation order. Roots are hashed from the canonical objects, not from indexes.

use crate::kar::closure::{
    close_frontiers, frontier_root, frontier_witness_root, witness_json, Witness,
};
use crate::kar::cover::{
    choices_json, decision_json, decision_root, evidence_set_root, select_cover, Choice,
    CoveragePair, Decision,
};
use crate::kar::json::{digest_json, Json};
use crate::kar::model::{
    anchor_root, empty_frontiers, frontiers_json, lookup_requirement, resolve_anchor,
    unresolved_evidence, AnchorCommitment, Graph, Indexes, Plan, PreparedImage, FRONTIERS,
    KAR_VERSION,
};

#[derive(Debug, Clone)]
pub struct KarResult {
    pub status: String,
    pub evidence_ids: Vec<String>,
    pub choices: Vec<Choice>,
    pub frontiers: Vec<(String, Vec<String>)>,
    pub witnesses: Vec<Witness>,
    pub decision: Decision,
    pub roots: Roots,
}

#[derive(Debug, Clone)]
pub struct Roots {
    pub knowledge_root: String,
    pub semantic_root: String,
    pub query_root: String,
    pub plan_root: String,
    pub anchor_root: String,
    pub frontier_root: String,
    pub frontier_witness_root: String,
    pub evidence_set_root: String,
    pub decision_root: String,
    pub kar_root: String,
}

pub struct BoundInputs<'a> {
    pub prepared: Option<&'a PreparedImage>,
    pub graph: Option<&'a Graph>,
    pub indexes: Option<&'a Indexes>,
    pub image_input: &'a Json,
    pub graph_input: &'a Json,
    pub query: &'a str,
    pub plan_input: &'a Json,
    pub knowledge_root: Option<&'a str>,
    pub semantic_root: Option<&'a str>,
}

pub fn evaluate_bound(input: &BoundInputs<'_>) -> KarResult {
    let query_root = digest_json(&Json::String(input.query.to_string()));
    let plan_root = digest_json(input.plan_input);
    let knowledge_root = input
        .knowledge_root
        .map(|value| value.to_string())
        .unwrap_or_else(|| {
            if let Some(prepared) = input.prepared {
                prepared.knowledge_root.clone()
            } else {
                digest_json(&Json::object(vec![
                    ("image", input.image_input.clone()),
                    ("invalidImage", Json::Bool(true)),
                ]))
            }
        });
    let semantic_root = input
        .semantic_root
        .map(|value| value.to_string())
        .unwrap_or_else(|| {
            if let Some(graph) = input.graph {
                crate::kar::model::semantic_root_of(graph)
            } else {
                digest_json(&Json::object(vec![
                    ("graph", input.graph_input.clone()),
                    ("invalid", Json::Bool(true)),
                ]))
            }
        });
    let plan = crate::kar::model::validate_plan(input.plan_input);
    let fallback_profile = plan
        .as_ref()
        .map(|item| item.profile.clone())
        .unwrap_or_default();
    let fallback_coverage = plan
        .as_ref()
        .map(required_coverage)
        .unwrap_or_else(zero_coverage);

    let emit = |status: &str,
                evidence_ids: Vec<String>,
                frontiers: Vec<(String, Vec<String>)>,
                witnesses: Vec<Witness>,
                choices: Vec<Choice>,
                decision: Option<Decision>,
                commitment: AnchorCommitment|
     -> KarResult {
        let mut decided = decision.unwrap_or_else(|| Decision {
            status: status.to_string(),
            profile: fallback_profile.clone(),
            cardinality: 0,
            coverage: fallback_coverage.clone(),
            redundancy: None,
        });
        decided.status = status.to_string();
        let anchor = anchor_root(&commitment);
        let frontier = frontier_root(&frontiers);
        let witness = frontier_witness_root(&witnesses);
        let evidence = evidence_set_root(&choices);
        let decision_hash = decision_root(&decided);
        let kar_root = digest_json(&Json::object(vec![
            ("anchorRoot", Json::String(anchor.clone())),
            ("decisionRoot", Json::String(decision_hash.clone())),
            ("evidenceSetRoot", Json::String(evidence.clone())),
            ("frontierRoot", Json::String(frontier.clone())),
            ("knowledgeRoot", Json::String(knowledge_root.clone())),
            ("planRoot", Json::String(plan_root.clone())),
            ("queryRoot", Json::String(query_root.clone())),
            ("semanticRoot", Json::String(semantic_root.clone())),
        ]));
        KarResult {
            status: status.to_string(),
            evidence_ids,
            choices,
            frontiers,
            witnesses,
            decision: decided,
            roots: Roots {
                knowledge_root,
                semantic_root,
                query_root,
                plan_root,
                anchor_root: anchor,
                frontier_root: frontier,
                frontier_witness_root: witness,
                evidence_set_root: evidence,
                decision_root: decision_hash,
                kar_root,
            },
        }
    };

    let Some(plan) = plan else {
        return emit(
            "PLAN_INVALID",
            Vec::new(),
            empty_frontiers(),
            Vec::new(),
            Vec::new(),
            None,
            AnchorCommitment::empty(),
        );
    };
    let (Some(prepared), Some(graph)) = (input.prepared, input.graph) else {
        return emit(
            "GRAPH_INVALID",
            Vec::new(),
            empty_frontiers(),
            Vec::new(),
            Vec::new(),
            None,
            AnchorCommitment::empty(),
        );
    };
    if graph.knowledge_root != prepared.knowledge_root
        || unresolved_evidence(graph, &prepared.texts)
    {
        return emit(
            "GRAPH_NOT_BOUND",
            Vec::new(),
            empty_frontiers(),
            Vec::new(),
            Vec::new(),
            None,
            AnchorCommitment::empty(),
        );
    }
    if let Some(lexical) = &plan.lexical {
        for evidence_id in &lexical.evidence_ids {
            if prepared.texts.iter().all(|(id, _)| id != evidence_id) {
                return emit(
                    "GRAPH_NOT_BOUND",
                    Vec::new(),
                    empty_frontiers(),
                    Vec::new(),
                    Vec::new(),
                    None,
                    AnchorCommitment::empty(),
                );
            }
        }
    }
    let node_ids = input
        .indexes
        .map(|indexes| indexes.node_ids.clone())
        .unwrap_or_else(|| graph.nodes.clone());
    let (commitment, rejected) = resolve_anchor(input.query, &node_ids, &plan.anchor);
    if let crate::kar::model::AnchorSpec::Recompute { procedure } = &plan.anchor {
        if procedure != "member-id-v1" {
            return emit(
                "PLAN_INVALID",
                Vec::new(),
                empty_frontiers(),
                Vec::new(),
                Vec::new(),
                None,
                commitment,
            );
        }
    }
    if rejected {
        return emit(
            "ANCHOR_REJECTED",
            Vec::new(),
            empty_frontiers(),
            Vec::new(),
            Vec::new(),
            None,
            commitment,
        );
    }
    let closed = match close_frontiers(graph, &plan, &commitment.nodes, input.indexes) {
        Ok(closed) => closed,
        Err(()) => {
            return emit(
                "CLOSURE_BOUND_EXCEEDED",
                Vec::new(),
                empty_frontiers(),
                Vec::new(),
                Vec::new(),
                None,
                commitment,
            )
        }
    };
    let cover = select_cover(&plan, &closed.admissions, &prepared.texts);
    emit(
        &cover.status,
        cover.evidence_ids,
        closed.frontiers,
        closed.witnesses,
        cover.choices,
        Some(cover.decision),
        commitment,
    )
}

pub fn certificate_json(result: &KarResult) -> Json {
    Json::object(vec![
        ("choices", choices_json(&result.choices)),
        ("decision", decision_json(&result.decision)),
        (
            "evidenceIds",
            Json::Array(
                result
                    .evidence_ids
                    .iter()
                    .cloned()
                    .map(Json::String)
                    .collect(),
            ),
        ),
        ("frontiers", frontiers_json(&result.frontiers)),
        ("roots", roots_json(&result.roots)),
        ("status", Json::String(result.status.clone())),
        ("version", Json::String(KAR_VERSION.into())),
        (
            "witnesses",
            Json::Array(result.witnesses.iter().map(witness_json).collect()),
        ),
    ])
}

fn roots_json(roots: &Roots) -> Json {
    Json::object(vec![
        ("anchorRoot", Json::String(roots.anchor_root.clone())),
        ("decisionRoot", Json::String(roots.decision_root.clone())),
        (
            "evidenceSetRoot",
            Json::String(roots.evidence_set_root.clone()),
        ),
        ("frontierRoot", Json::String(roots.frontier_root.clone())),
        (
            "frontierWitnessRoot",
            Json::String(roots.frontier_witness_root.clone()),
        ),
        ("karRoot", Json::String(roots.kar_root.clone())),
        ("knowledgeRoot", Json::String(roots.knowledge_root.clone())),
        ("planRoot", Json::String(roots.plan_root.clone())),
        ("queryRoot", Json::String(roots.query_root.clone())),
        ("semanticRoot", Json::String(roots.semantic_root.clone())),
    ])
}

fn required_coverage(plan: &Plan) -> Vec<(String, CoveragePair)> {
    FRONTIERS
        .iter()
        .map(|frontier| {
            let required = if plan.coverage_mode == "requirements" {
                lookup_requirement(plan, frontier).len() as i64
            } else {
                1
            };
            (
                (*frontier).to_string(),
                CoveragePair {
                    covered: 0,
                    required,
                },
            )
        })
        .collect()
}

fn zero_coverage() -> Vec<(String, CoveragePair)> {
    FRONTIERS
        .iter()
        .map(|frontier| {
            (
                (*frontier).to_string(),
                CoveragePair {
                    covered: 0,
                    required: 0,
                },
            )
        })
        .collect()
}

pub fn status_code(status: &str) -> Option<String> {
    match status {
        "GRAPH_INVALID" => Some("KAR_GRAPH_INVALID".into()),
        "GRAPH_NOT_BOUND" => Some("KAR_GRAPH_NOT_BOUND".into()),
        "PLAN_INVALID" => Some("KAR_PLAN_INVALID".into()),
        "ANCHOR_REJECTED" => Some("KAR_ANCHOR_REJECTED".into()),
        "CLOSURE_BOUND_EXCEEDED" => Some("KAR_CLOSURE_BOUND_EXCEEDED".into()),
        "SEARCH_BOUND_EXCEEDED" => Some("KAR_SEARCH_BOUND_EXCEEDED".into()),
        _ => None,
    }
}
