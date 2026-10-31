//! Breadth-first closure over (node, frontier) states.
//! The arriving relation replaces the frontier. The first reach is the canonical witness.

use crate::kar::json::{digest_json, utf16_cmp, Json};
use crate::kar::model::{
    build_indexes, empty_frontiers, frontier_list_mut, frontiers_json, group, Binding, Graph,
    Indexes, Plan,
};

#[derive(Debug, Clone)]
pub struct PathStep {
    pub node: String,
    pub relation: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Witness {
    pub evidence_id: String,
    pub frontier: String,
    pub anchor_id: Option<String>,
    pub path: Vec<PathStep>,
}

#[derive(Debug, Clone)]
pub struct Admission {
    pub evidence_id: String,
    pub frontier: String,
    pub applicable: bool,
    pub requirements: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct ClosureSuccess {
    pub frontiers: Vec<(String, Vec<String>)>,
    pub witnesses: Vec<Witness>,
    pub admissions: Vec<Admission>,
}

struct State {
    node_id: String,
    frontier: String,
    depth: i64,
    anchor_id: String,
    parent: Option<usize>,
    arriving_relation_id: Option<String>,
}

pub fn close_frontiers(
    graph: &Graph,
    plan: &Plan,
    anchors: &[String],
    indexes: Option<&Indexes>,
) -> Result<ClosureSuccess, ()> {
    let bounds = &plan.bounds;
    if graph.bindings.len() as i64 > bounds.max_evidence_bindings
        || anchors.len() as i64 > bounds.max_anchor_nodes
        || anchors.len() as i64 > bounds.max_closure_nodes
    {
        return Err(());
    }
    let owned;
    let resolved = if let Some(indexes) = indexes {
        indexes
    } else {
        owned = build_indexes(graph);
        &owned
    };
    let mut frontiers = empty_frontiers();
    let mut members: Vec<(String, Vec<String>)> = empty_frontiers();
    let mut witnesses = Vec::new();
    let mut witness_keys = Vec::new();
    let mut admissions = Vec::new();
    let mut states = Vec::new();
    let mut seen_states = Vec::new();
    let mut seen_nodes = Vec::new();
    let mut edges: i64 = 0;
    let mut current = Vec::new();
    for node_id in anchors {
        let index = states.len();
        seen_states.push(format!("{node_id}\0"));
        if !seen_nodes.iter().any(|id| id == node_id) {
            seen_nodes.push(node_id.clone());
        }
        states.push(State {
            node_id: node_id.clone(),
            frontier: String::new(),
            depth: 0,
            anchor_id: node_id.clone(),
            parent: None,
            arriving_relation_id: None,
        });
        current.push(index);
    }

    loop {
        if current.is_empty() {
            break;
        }
        let mut next = Vec::new();
        for state_index in &current {
            let state_depth = states[*state_index].depth;
            let state_node = states[*state_index].node_id.clone();
            let state_anchor = states[*state_index].anchor_id.clone();
            if state_depth >= plan.depth {
                continue;
            }
            for relation in group(&resolved.relations_by_from, &state_node) {
                let Some(label) = plan
                    .frontier_map
                    .iter()
                    .find(|(symbol, _)| symbol == &relation.relation)
                    .map(|(_, label)| label.clone())
                else {
                    continue;
                };
                if edges + 1 > bounds.max_closure_edges {
                    return Err(());
                }
                edges += 1;
                let key = format!("{}\0{label}", relation.to);
                if seen_states.iter().any(|seen| seen == &key) {
                    continue;
                }
                if !seen_nodes.iter().any(|id| id == &relation.to) {
                    if seen_nodes.len() as i64 + 1 > bounds.max_closure_nodes {
                        return Err(());
                    }
                    seen_nodes.push(relation.to.clone());
                }
                seen_states.push(key);
                let index = states.len();
                states.push(State {
                    node_id: relation.to.clone(),
                    frontier: label,
                    depth: state_depth + 1,
                    anchor_id: state_anchor.clone(),
                    parent: Some(*state_index),
                    arriving_relation_id: Some(relation.id.clone()),
                });
                next.push(index);
            }
        }
        next.sort_by(|left, right| {
            let frontier_order = utf16_cmp(&states[*left].frontier, &states[*right].frontier);
            if frontier_order != std::cmp::Ordering::Equal {
                return frontier_order;
            }
            utf16_cmp(&states[*left].node_id, &states[*right].node_id)
        });
        for state_index in &next {
            if admit(
                *state_index,
                &states,
                resolved,
                plan,
                &mut frontiers,
                &mut members,
                &mut witnesses,
                &mut witness_keys,
                &mut admissions,
            )
            .is_err()
            {
                return Err(());
            }
        }
        current = next;
    }

    if let Some(lexical) = &plan.lexical {
        let mut ids = Vec::new();
        for evidence_id in &lexical.evidence_ids {
            if !ids.iter().any(|id| id == evidence_id) {
                ids.push(evidence_id.clone());
            }
        }
        ids.sort_by(|left, right| utf16_cmp(left, right));
        for evidence_id in ids {
            let bucket = members
                .iter()
                .find(|(frontier, _)| frontier == &lexical.frontier)
                .map(|(_, ids)| ids.clone())
                .unwrap_or_default();
            if bucket.iter().any(|id| id == &evidence_id) {
                continue;
            }
            if bucket.len() as i64 + 1 > bounds.max_frontier_evidence {
                return Err(());
            }
            if let Some(list) = members
                .iter_mut()
                .find(|(frontier, _)| frontier == &lexical.frontier)
            {
                list.1.push(evidence_id.clone());
            }
            if let Some(list) = frontier_list_mut(&mut frontiers, &lexical.frontier) {
                list.push(evidence_id.clone());
            }
            witnesses.push(Witness {
                evidence_id: evidence_id.clone(),
                frontier: lexical.frontier.clone(),
                anchor_id: None,
                path: Vec::new(),
            });
            let related = group(&resolved.bindings_by_evidence, &evidence_id);
            if related.is_empty() {
                admissions.push(Admission {
                    evidence_id,
                    frontier: lexical.frontier.clone(),
                    applicable: true,
                    requirements: Vec::new(),
                });
            } else {
                for binding in related {
                    let ok = applicable(binding, plan);
                    admissions.push(Admission {
                        evidence_id: evidence_id.clone(),
                        frontier: lexical.frontier.clone(),
                        applicable: ok,
                        requirements: if ok {
                            binding.requirements.clone()
                        } else {
                            Vec::new()
                        },
                    });
                }
            }
        }
    }

    for (_, ids) in &mut frontiers {
        ids.sort_by(|left, right| utf16_cmp(left, right));
    }
    witnesses.sort_by(witness_order);
    Ok(ClosureSuccess {
        frontiers,
        witnesses,
        admissions,
    })
}

fn admit(
    state_index: usize,
    states: &[State],
    indexes: &Indexes,
    plan: &Plan,
    frontiers: &mut Vec<(String, Vec<String>)>,
    members: &mut Vec<(String, Vec<String>)>,
    witnesses: &mut Vec<Witness>,
    witness_keys: &mut Vec<String>,
    admissions: &mut Vec<Admission>,
) -> Result<(), ()> {
    let frontier = states[state_index].frontier.clone();
    if frontier.is_empty() {
        return Ok(());
    }
    let node_id = states[state_index].node_id.clone();
    for binding in group(&indexes.bindings_by_node, &node_id) {
        let bucket_len = members
            .iter()
            .find(|(name, _)| name == &frontier)
            .map(|(_, ids)| ids.len())
            .unwrap_or(0);
        let already = members.iter().any(|(name, ids)| {
            name == &frontier && ids.iter().any(|id| id == &binding.evidence_id)
        });
        if !already {
            if bucket_len as i64 + 1 > plan.bounds.max_frontier_evidence {
                return Err(());
            }
            if let Some(list) = members.iter_mut().find(|(name, _)| name == &frontier) {
                list.1.push(binding.evidence_id.clone());
            }
            if let Some(list) = frontier_list_mut(frontiers, &frontier) {
                list.push(binding.evidence_id.clone());
            }
        }
        let key = format!("{frontier}\0{}", binding.evidence_id);
        if !witness_keys.iter().any(|existing| existing == &key) {
            witness_keys.push(key);
            witnesses.push(Witness {
                evidence_id: binding.evidence_id.clone(),
                frontier: frontier.clone(),
                anchor_id: Some(states[state_index].anchor_id.clone()),
                path: materialize_path(states, state_index),
            });
        }
        let ok = applicable(binding, plan);
        admissions.push(Admission {
            evidence_id: binding.evidence_id.clone(),
            frontier: frontier.clone(),
            applicable: ok,
            requirements: if ok {
                binding.requirements.clone()
            } else {
                Vec::new()
            },
        });
    }
    Ok(())
}

fn materialize_path(states: &[State], state_index: usize) -> Vec<PathStep> {
    let mut chain = Vec::new();
    let mut cursor = Some(state_index);
    while let Some(index) = cursor {
        chain.push(index);
        cursor = states[index].parent;
    }
    chain.reverse();
    let mut path = vec![PathStep {
        node: states[chain[0]].node_id.clone(),
        relation: None,
    }];
    for index in chain.into_iter().skip(1) {
        path.push(PathStep {
            node: states[index].node_id.clone(),
            relation: states[index].arriving_relation_id.clone(),
        });
    }
    path
}

fn applicable(binding: &Binding, plan: &Plan) -> bool {
    if binding.unauthorized {
        return false;
    }
    if let Some(min_authority) = plan.min_authority {
        match binding.authority {
            Some(authority) if authority >= min_authority => {}
            _ => return false,
        }
    }
    if let Some(valid_from) = &binding.valid_from {
        if utf16_cmp(&plan.as_of, valid_from) == std::cmp::Ordering::Less {
            return false;
        }
    }
    if let Some(valid_until) = &binding.valid_until {
        if utf16_cmp(&plan.as_of, valid_until) != std::cmp::Ordering::Less {
            return false;
        }
    }
    true
}

fn witness_order(left: &Witness, right: &Witness) -> std::cmp::Ordering {
    let frontier = utf16_cmp(&left.frontier, &right.frontier);
    if frontier != std::cmp::Ordering::Equal {
        return frontier;
    }
    let evidence = utf16_cmp(&left.evidence_id, &right.evidence_id);
    if evidence != std::cmp::Ordering::Equal {
        return evidence;
    }
    utf16_cmp(
        left.anchor_id.as_deref().unwrap_or(""),
        right.anchor_id.as_deref().unwrap_or(""),
    )
}

pub fn frontier_root(frontiers: &[(String, Vec<String>)]) -> String {
    digest_json(&frontiers_json(frontiers))
}

pub fn frontier_witness_root(witnesses: &[Witness]) -> String {
    digest_json(&Json::Array(witnesses.iter().map(witness_json).collect()))
}

pub fn witness_json(witness: &Witness) -> Json {
    Json::object(vec![
        (
            "anchorId",
            witness
                .anchor_id
                .clone()
                .map(Json::String)
                .unwrap_or(Json::Null),
        ),
        ("evidenceId", Json::String(witness.evidence_id.clone())),
        ("frontier", Json::String(witness.frontier.clone())),
        (
            "path",
            Json::Array(witness.path.iter().map(path_json).collect()),
        ),
    ])
}

fn path_json(step: &PathStep) -> Json {
    let mut pairs = vec![("node".to_string(), Json::String(step.node.clone()))];
    if let Some(relation) = &step.relation {
        pairs.push(("relation".to_string(), Json::String(relation.clone())));
    }
    Json::Object(pairs)
}
