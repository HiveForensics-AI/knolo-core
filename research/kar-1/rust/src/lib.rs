mod canon;

use canon::{digest, obj, string_array};
use serde_json::{Map, Value};
use std::collections::{BTreeMap, BTreeSet, HashSet};

const FRONTIERS: [&str; 5] = ["F_S", "F_O", "F_Q", "F_T", "F_A"];
const PROFILES: [&str; 3] = ["minimum-cover", "minimum-cover-redundancy-v1", "exp1-lexicographic"];
const BOUNDS: [&str; 7] = [
    "maxAnchorNodes",
    "maxClosureNodes",
    "maxClosureEdges",
    "maxFrontierEvidence",
    "maxRequirementsPerFrontier",
    "maxEvidenceBindings",
    "maxCoverVisits",
];

pub fn evaluate(image_in: &Value, graph_in: &Value, query_in: &Value, plan_in: &Value) -> Value {
    let query_value = match query_in.as_str() {
        Some(text) => Value::String(text.to_string()),
        None => Value::Null,
    };
    let query_root = digest(&query_value);
    let plan_root = digest(plan_in);
    let image = prepare_image(image_in);
    let knowledge_root = match &image {
        Some(prepared) => prepared.root.clone(),
        None => digest(&obj(vec![("image", image_in.clone()), ("invalidImage", Value::Bool(true))])),
    };
    let graph = prepare_graph(graph_in);
    let semantic_root = match &graph {
        Some(prepared) => digest(&obj(vec![
            ("graph", prepared.normalized.clone()),
            ("knowledgeRoot", Value::String(prepared.knowledge_root.clone())),
        ])),
        None => digest(&obj(vec![("graph", graph_in.clone()), ("invalid", Value::Bool(true))])),
    };
    let parsed_plan = validate_plan(plan_in);
    let ctx = Ctx { knowledge_root, semantic_root, query_root, plan_root };

    let Some(plan) = parsed_plan else {
        return emit(&ctx, "PLAN_INVALID", &[], &empty_frontiers(), &[], &[], None, &empty_anchor(), None);
    };
    let (Some(image), Some(graph)) = (image, graph) else {
        return emit(&ctx, "GRAPH_INVALID", &[], &empty_frontiers(), &[], &[], None, &empty_anchor(), Some(&plan));
    };
    let unbound = graph.knowledge_root != image.root
        || graph.bindings.iter().any(|binding| !image.texts.contains_key(&binding.evidence_id));
    let lexical_unbound = plan.lexical.as_ref().is_some_and(|(_, ids)| ids.iter().any(|id| !image.texts.contains_key(id)));
    if unbound || lexical_unbound {
        return emit(&ctx, "GRAPH_NOT_BOUND", &[], &empty_frontiers(), &[], &[], None, &empty_anchor(), Some(&plan));
    }

    let commitment = resolve_anchor(query_in.as_str().unwrap_or(""), &graph.nodes, &plan);
    if commitment.nodes.iter().any(|id| !graph.nodes.contains(id)) {
        return emit(&ctx, "ANCHOR_REJECTED", &[], &empty_frontiers(), &[], &[], None, &commitment.value, Some(&plan));
    }
    let Some(closed) = close(&graph, &plan, &commitment.nodes) else {
        return emit(&ctx, "CLOSURE_BOUND_EXCEEDED", &[], &empty_frontiers(), &[], &[], None, &commitment.value, Some(&plan));
    };
    let cover = select_cover(&plan, &closed.admissions, &image.texts);
    emit(
        &ctx,
        &cover.status,
        &cover.evidence_ids,
        &closed.frontiers,
        &closed.witnesses,
        &cover.choices,
        Some(&cover.decision),
        &commitment.value,
        Some(&plan),
    )
}

struct Ctx {
    knowledge_root: String,
    semantic_root: String,
    query_root: String,
    plan_root: String,
}

struct PreparedImage {
    root: String,
    texts: BTreeMap<String, String>,
}

struct Binding {
    id: String,
    node_id: String,
    evidence_id: String,
    requirements: Vec<String>,
    authority: Option<i64>,
    unauthorized: bool,
    valid_from: Option<String>,
    valid_until: Option<String>,
    provenance: Option<String>,
}

struct Relation {
    id: String,
    from: String,
    relation: String,
    to: String,
}

struct PreparedGraph {
    knowledge_root: String,
    normalized: Value,
    nodes: BTreeSet<String>,
    relations: Vec<Relation>,
    bindings: Vec<Binding>,
}

struct Plan {
    anchor_mode: String,
    procedure: Option<String>,
    witness: Vec<(String, Option<String>)>,
    frontier_map: BTreeMap<String, String>,
    depth: i64,
    cardinality_bound: i64,
    coverage_mode: String,
    requirements: BTreeMap<String, Vec<String>>,
    floors: BTreeMap<String, String>,
    profile: String,
    as_of: String,
    min_authority: Option<i64>,
    bounds: BTreeMap<String, i64>,
    lexical: Option<(String, Vec<String>)>,
}

struct AnchorCommit {
    value: Value,
    nodes: Vec<String>,
}

struct Admission {
    evidence_id: String,
    frontier: String,
    applicable: bool,
    requirements: Vec<String>,
}

struct Closed {
    frontiers: Value,
    witnesses: Vec<Value>,
    admissions: Vec<Admission>,
}

#[derive(Clone)]
struct Candidate {
    id: String,
    mask: String,
    requirements: BTreeMap<String, BTreeSet<String>>,
    nonempty: BTreeSet<String>,
    tokens: Vec<String>,
}

struct Cover {
    status: String,
    evidence_ids: Vec<String>,
    choices: Vec<Value>,
    decision: Value,
}

fn emit(
    ctx: &Ctx,
    status: &str,
    evidence_ids: &[String],
    frontiers: &Value,
    witnesses: &[Value],
    choices: &[Value],
    decision: Option<&Value>,
    anchor: &Value,
    plan: Option<&Plan>,
) -> Value {
    let decision = decision.cloned().unwrap_or_else(|| base_decision(status, plan));
    let anchor_root = digest(anchor);
    let frontier_root = digest(frontiers);
    let witness_root = digest(&Value::Array(witnesses.to_vec()));
    let evidence_root = digest(&Value::Array(choices.to_vec()));
    let decision_root = digest(&decision);
    let kar = digest(&obj(vec![
        ("anchorRoot", Value::String(anchor_root.clone())),
        ("decisionRoot", Value::String(decision_root.clone())),
        ("evidenceSetRoot", Value::String(evidence_root.clone())),
        ("frontierRoot", Value::String(frontier_root.clone())),
        ("knowledgeRoot", Value::String(ctx.knowledge_root.clone())),
        ("planRoot", Value::String(ctx.plan_root.clone())),
        ("queryRoot", Value::String(ctx.query_root.clone())),
        ("semanticRoot", Value::String(ctx.semantic_root.clone())),
    ]));
    obj(vec![
        ("choices", Value::Array(choices.to_vec())),
        ("decision", decision),
        ("evidenceIds", string_array(evidence_ids)),
        ("frontiers", frontiers.clone()),
        ("roots", obj(vec![
            ("anchorRoot", Value::String(anchor_root)),
            ("decisionRoot", Value::String(decision_root)),
            ("evidenceSetRoot", Value::String(evidence_root)),
            ("frontierRoot", Value::String(frontier_root)),
            ("frontierWitnessRoot", Value::String(witness_root)),
            ("karRoot", Value::String(kar)),
            ("knowledgeRoot", Value::String(ctx.knowledge_root.clone())),
            ("planRoot", Value::String(ctx.plan_root.clone())),
            ("queryRoot", Value::String(ctx.query_root.clone())),
            ("semanticRoot", Value::String(ctx.semantic_root.clone())),
        ])),
        ("status", Value::String(status.to_string())),
        ("witnesses", Value::Array(witnesses.to_vec())),
    ])
}

fn base_decision(status: &str, plan: Option<&Plan>) -> Value {
    let mut coverage = Map::new();
    for frontier in FRONTIERS {
        let required = plan.map(|item| required_count(item, frontier)).unwrap_or(0);
        coverage.insert(frontier.to_string(), pair(0, required));
    }
    obj(vec![
        ("cardinality", Value::from(0)),
        ("coverage", Value::Object(coverage)),
        ("profile", Value::String(plan.map(|item| item.profile.clone()).unwrap_or_default())),
        ("status", Value::String(status.to_string())),
    ])
}

fn pair(covered: i64, required: i64) -> Value {
    obj(vec![("covered", Value::from(covered)), ("required", Value::from(required))])
}

fn required_count(plan: &Plan, frontier: &str) -> i64 {
    if plan.coverage_mode == "requirements" {
        plan.requirements.get(frontier).map(|items| items.len() as i64).unwrap_or(0)
    } else {
        1
    }
}

fn empty_frontiers() -> Value {
    let mut map = Map::new();
    for frontier in FRONTIERS {
        map.insert(frontier.to_string(), Value::Array(vec![]));
    }
    Value::Object(map)
}

fn empty_anchor() -> Value {
    obj(vec![
        ("mode", Value::Null),
        ("nodes", Value::Array(vec![])),
        ("procedure", Value::Null),
        ("witness", Value::Null),
    ])
}

fn only_keys(value: &Value, allowed: &[&str]) -> bool {
    value.as_object().is_some_and(|map| map.keys().all(|key| allowed.contains(&key.as_str())))
}

fn nonempty(value: &Value) -> Option<String> {
    match value.as_str() {
        Some(text) if !text.is_empty() => Some(text.to_string()),
        _ => None,
    }
}

fn is_root(value: &str) -> bool {
    let Some(hex) = value.strip_prefix("sha256-") else { return false };
    hex.len() == 64 && hex.bytes().all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

fn is_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes.iter().enumerate().all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

fn prepare_image(input: &Value) -> Option<PreparedImage> {
    if !only_keys(input, &["version", "evidence"]) || input.get("version")? != &Value::from(1) {
        return None;
    }
    let mut evidence = Vec::new();
    let mut seen = BTreeSet::new();
    for row in input.get("evidence")?.as_array()? {
        if !only_keys(row, &["id", "text"]) {
            return None;
        }
        let id = nonempty(row.get("id")?)?;
        let text = row.get("text")?.as_str()?.to_string();
        if !seen.insert(id.clone()) {
            return None;
        }
        evidence.push((id, text));
    }
    evidence.sort_by(|left, right| left.0.cmp(&right.0));
    let rows = evidence
        .iter()
        .map(|(id, text)| obj(vec![("id", Value::String(id.clone())), ("text", Value::String(text.clone()))]))
        .collect();
    Some(PreparedImage {
        root: digest(&obj(vec![("evidence", Value::Array(rows)), ("version", Value::from(1))])),
        texts: evidence.into_iter().collect(),
    })
}

fn prepare_graph(input: &Value) -> Option<PreparedGraph> {
    if !only_keys(input, &["bindings", "knowledgeRoot", "nodes", "provenance", "relations", "version"]) || input.get("version")? != &Value::from(1) {
        return None;
    }
    let knowledge_root = input.get("knowledgeRoot")?.as_str()?.to_string();
    if !is_root(&knowledge_root) {
        return None;
    }
    let provenance = input.get("provenance")?;
    if !only_keys(provenance, &["note", "producer"]) {
        return None;
    }
    let producer = nonempty(provenance.get("producer")?)?;
    let note = match provenance.get("note") {
        None => None,
        Some(value) => Some(value.as_str()?.to_string()),
    };
    let mut node_ids = Vec::new();
    let mut nodes = BTreeSet::new();
    for node in input.get("nodes")?.as_array()? {
        if !only_keys(node, &["id"]) {
            return None;
        }
        let id = nonempty(node.get("id")?)?;
        if !nodes.insert(id.clone()) {
            return None;
        }
        node_ids.push(id);
    }
    node_ids.sort();
    let mut relations = Vec::new();
    let mut relation_ids = BTreeSet::new();
    for relation in input.get("relations")?.as_array()? {
        if !only_keys(relation, &["from", "id", "relation", "to"]) {
            return None;
        }
        let id = nonempty(relation.get("id")?)?;
        let from = nonempty(relation.get("from")?)?;
        let symbol = nonempty(relation.get("relation")?)?;
        let to = nonempty(relation.get("to")?)?;
        if !relation_ids.insert(id.clone()) || !nodes.contains(&from) || !nodes.contains(&to) {
            return None;
        }
        relations.push(Relation { id, from, relation: symbol, to });
    }
    relations.sort_by(|left, right| left.id.cmp(&right.id));
    let mut bindings = Vec::new();
    let mut binding_ids = BTreeSet::new();
    for binding in input.get("bindings")?.as_array()? {
        if !only_keys(binding, &["authority", "evidenceId", "id", "nodeId", "provenance", "requirements", "unauthorized", "validFrom", "validUntil"]) {
            return None;
        }
        let id = nonempty(binding.get("id")?)?;
        let node_id = nonempty(binding.get("nodeId")?)?;
        let evidence_id = nonempty(binding.get("evidenceId")?)?;
        if !binding_ids.insert(id.clone()) || !nodes.contains(&node_id) {
            return None;
        }
        let mut requirements = Vec::new();
        let mut seen = BTreeSet::new();
        for requirement in binding.get("requirements")?.as_array()? {
            let text = nonempty(requirement)?;
            if !seen.insert(text.clone()) {
                return None;
            }
            requirements.push(text);
        }
        requirements.sort();
        let authority = match binding.get("authority") {
            None => None,
            Some(value) => Some(value.as_i64()?),
        };
        let unauthorized = match binding.get("unauthorized") {
            None => false,
            Some(Value::Bool(true)) => true,
            Some(Value::Bool(false)) => false,
            _ => return None,
        };
        let valid_from = optional_date(binding, "validFrom")?;
        let valid_until = optional_date(binding, "validUntil")?;
        let binding_provenance = match binding.get("provenance") {
            None => None,
            Some(value) => Some(nonempty(value)?),
        };
        bindings.push(Binding {
            id,
            node_id,
            evidence_id,
            requirements,
            authority,
            unauthorized,
            valid_from,
            valid_until,
            provenance: binding_provenance,
        });
    }
    bindings.sort_by(|left, right| left.id.cmp(&right.id));
    Some(PreparedGraph {
        normalized: normalized_graph(&knowledge_root, &producer, note.as_deref(), &node_ids, &relations, &bindings),
        knowledge_root,
        nodes,
        relations,
        bindings,
    })
}

fn optional_date(binding: &Value, key: &str) -> Option<Option<String>> {
    match binding.get(key) {
        None => Some(None),
        Some(value) => {
            let text = value.as_str()?;
            if is_date(text) { Some(Some(text.to_string())) } else { None }
        }
    }
}

fn normalized_graph(root: &str, producer: &str, note: Option<&str>, nodes: &[String], relations: &[Relation], bindings: &[Binding]) -> Value {
    let mut provenance = vec![("producer", Value::String(producer.to_string()))];
    if let Some(note) = note {
        provenance.push(("note", Value::String(note.to_string())));
    }
    let node_json = nodes.iter().map(|id| obj(vec![("id", Value::String(id.clone()))])).collect();
    let relation_json = relations
        .iter()
        .map(|relation| {
            obj(vec![
                ("from", Value::String(relation.from.clone())),
                ("id", Value::String(relation.id.clone())),
                ("relation", Value::String(relation.relation.clone())),
                ("to", Value::String(relation.to.clone())),
            ])
        })
        .collect();
    let binding_json = bindings.iter().map(binding_json).collect();
    obj(vec![
        ("bindings", Value::Array(binding_json)),
        ("knowledgeRoot", Value::String(root.to_string())),
        ("nodes", Value::Array(node_json)),
        ("provenance", obj(provenance)),
        ("relations", Value::Array(relation_json)),
        ("version", Value::from(1)),
    ])
}

fn binding_json(binding: &Binding) -> Value {
    let mut entries = vec![
        ("evidenceId", Value::String(binding.evidence_id.clone())),
        ("id", Value::String(binding.id.clone())),
        ("nodeId", Value::String(binding.node_id.clone())),
        ("requirements", string_array(&binding.requirements)),
    ];
    if let Some(authority) = binding.authority {
        entries.push(("authority", Value::from(authority)));
    }
    if binding.unauthorized {
        entries.push(("unauthorized", Value::Bool(true)));
    }
    if let Some(from) = &binding.valid_from {
        entries.push(("validFrom", Value::String(from.clone())));
    }
    if let Some(until) = &binding.valid_until {
        entries.push(("validUntil", Value::String(until.clone())));
    }
    if let Some(provenance) = &binding.provenance {
        entries.push(("provenance", Value::String(provenance.clone())));
    }
    obj(entries)
}

fn validate_plan(input: &Value) -> Option<Plan> {
    if !only_keys(input, &["anchor", "asOf", "bounds", "cardinalityBound", "coverageMode", "depth", "floors", "frontierMap", "lexical", "minAuthority", "profile", "requirements", "version"]) {
        return None;
    }
    if input.get("version")? != &Value::from(1) {
        return None;
    }
    let depth = input.get("depth")?.as_i64()?;
    let cardinality_bound = input.get("cardinalityBound")?.as_i64()?;
    if depth < 0 || cardinality_bound < 0 {
        return None;
    }
    let coverage_mode = nonempty(input.get("coverageMode")?)?;
    if coverage_mode != "requirements" && coverage_mode != "nonempty" {
        return None;
    }
    let profile = nonempty(input.get("profile")?)?;
    if !PROFILES.contains(&profile.as_str()) {
        return None;
    }
    let as_of = nonempty(input.get("asOf")?)?;
    if !is_date(&as_of) {
        return None;
    }
    let min_authority = match input.get("minAuthority")? {
        Value::Null => None,
        value => Some(value.as_i64()?),
    };
    let (anchor_mode, procedure, witness) = validate_anchor(input.get("anchor")?)?;
    let frontier_map = validate_frontier_map(input.get("frontierMap")?)?;
    let requirements = validate_requirements(input.get("requirements")?)?;
    let floors = validate_floors(input.get("floors")?)?;
    let bounds = validate_bounds(input.get("bounds")?)?;
    if requirements.values().any(|items| items.len() as i64 > bounds["maxRequirementsPerFrontier"]) {
        return None;
    }
    let lexical = validate_lexical(input.get("lexical")?)?;
    Some(Plan {
        anchor_mode,
        procedure,
        witness,
        frontier_map,
        depth,
        cardinality_bound,
        coverage_mode,
        requirements,
        floors,
        profile,
        as_of,
        min_authority,
        bounds,
        lexical,
    })
}

fn validate_anchor(input: &Value) -> Option<(String, Option<String>, Vec<(String, Option<String>)>)> {
    let mode = nonempty(input.get("mode")?)?;
    if mode == "recompute" {
        if !only_keys(input, &["mode", "procedure"]) || input.get("procedure")?.as_str() != Some("member-id-v1") {
            return None;
        }
        return Some(("recompute".to_string(), Some("member-id-v1".to_string()), Vec::new()));
    }
    if mode != "supplied" || !only_keys(input, &["mode", "witness"]) {
        return None;
    }
    let mut witness = Vec::new();
    for record in input.get("witness")?.as_array()? {
        if !only_keys(record, &["nodeId", "queryTerm"]) {
            return None;
        }
        let node_id = nonempty(record.get("nodeId")?)?;
        let query_term = match record.get("queryTerm") {
            None => None,
            Some(value) => Some(value.as_str()?.to_string()),
        };
        witness.push((node_id, query_term));
    }
    Some(("supplied".to_string(), None, witness))
}

fn validate_frontier_map(input: &Value) -> Option<BTreeMap<String, String>> {
    let mut map = BTreeMap::new();
    for (symbol, label) in input.as_object()? {
        if symbol.is_empty() || !FRONTIERS.contains(&label.as_str()?) {
            return None;
        }
        map.insert(symbol.clone(), label.as_str()?.to_string());
    }
    Some(map)
}

fn validate_requirements(input: &Value) -> Option<BTreeMap<String, Vec<String>>> {
    if !only_keys(input, &FRONTIERS) {
        return None;
    }
    let mut out = BTreeMap::new();
    for frontier in FRONTIERS {
        let mut items = Vec::new();
        let mut seen = BTreeSet::new();
        for item in input.get(frontier)?.as_array()? {
            let text = nonempty(item)?;
            if !seen.insert(text.clone()) {
                return None;
            }
            items.push(text);
        }
        out.insert(frontier.to_string(), items);
    }
    Some(out)
}

fn validate_floors(input: &Value) -> Option<BTreeMap<String, String>> {
    if !only_keys(input, &FRONTIERS) {
        return None;
    }
    let mut out = BTreeMap::new();
    for frontier in FRONTIERS {
        let floor = input.get(frontier)?.as_str()?.to_string();
        floor_micros(&floor)?;
        out.insert(frontier.to_string(), floor);
    }
    Some(out)
}

fn validate_bounds(input: &Value) -> Option<BTreeMap<String, i64>> {
    if !only_keys(input, &BOUNDS) {
        return None;
    }
    let mut out = BTreeMap::new();
    for name in BOUNDS {
        let value = input.get(name)?.as_i64()?;
        if value < 0 {
            return None;
        }
        out.insert(name.to_string(), value);
    }
    Some(out)
}

fn validate_lexical(input: &Value) -> Option<Option<(String, Vec<String>)>> {
    if input.is_null() {
        return Some(None);
    }
    if !only_keys(input, &["evidenceIds", "frontier"]) {
        return None;
    }
    let frontier = nonempty(input.get("frontier")?)?;
    if !FRONTIERS.contains(&frontier.as_str()) {
        return None;
    }
    let mut ids = Vec::new();
    for id in input.get("evidenceIds")?.as_array()? {
        ids.push(nonempty(id)?);
    }
    Some(Some((frontier, ids)))
}

fn floor_micros(floor: &str) -> Option<i64> {
    let (whole, frac) = match floor.split_once('.') {
        Some((whole, frac)) => (whole, frac),
        None => (floor, ""),
    };
    if whole.is_empty() || frac.len() > 6 || !whole.bytes().all(|byte| byte.is_ascii_digit()) || !frac.bytes().all(|byte| byte.is_ascii_digit()) {
        return None;
    }
    if floor.matches('.').count() > 1 {
        return None;
    }
    let whole_n: i64 = whole.parse().ok()?;
    let mut padded = frac.to_string();
    while padded.len() < 6 {
        padded.push('0');
    }
    let frac_n: i64 = if padded.is_empty() { 0 } else { padded.parse().ok()? };
    whole_n.checked_mul(1_000_000)?.checked_add(frac_n)
}

fn resolve_anchor(query: &str, nodes: &BTreeSet<String>, plan: &Plan) -> AnchorCommit {
    if plan.anchor_mode == "recompute" {
        let resolved = member_ids(query, nodes);
        return AnchorCommit {
            value: obj(vec![
                ("mode", Value::String("recompute".to_string())),
                ("nodes", string_array(&resolved)),
                ("procedure", Value::String(plan.procedure.clone().unwrap_or_default())),
                ("witness", Value::Null),
            ]),
            nodes: resolved,
        };
    }
    let mut witness = plan.witness.clone();
    witness.sort_by(|left, right| left.0.cmp(&right.0).then(left.1.as_deref().unwrap_or("").cmp(right.1.as_deref().unwrap_or(""))));
    let mut node_ids: Vec<String> = witness.iter().map(|(id, _)| id.clone()).collect();
    node_ids.sort();
    node_ids.dedup();
    let records = witness
        .iter()
        .map(|(id, term)| {
            let mut entries = vec![("nodeId", Value::String(id.clone()))];
            if let Some(term) = term {
                entries.push(("queryTerm", Value::String(term.clone())));
            }
            obj(entries)
        })
        .collect();
    AnchorCommit {
        value: obj(vec![
            ("mode", Value::String("supplied".to_string())),
            ("nodes", string_array(&node_ids)),
            ("procedure", Value::Null),
            ("witness", Value::Array(records)),
        ]),
        nodes: node_ids,
    }
}

fn member_ids(query: &str, nodes: &BTreeSet<String>) -> Vec<String> {
    let mut found = BTreeSet::new();
    let mut current = String::new();
    for ch in query.chars() {
        if ch.is_ascii_alphanumeric() || matches!(ch, '_' | ':' | '-') {
            current.push(ch);
        } else if !current.is_empty() {
            if nodes.contains(&current) {
                found.insert(current.clone());
            }
            current.clear();
        }
    }
    if nodes.contains(&current) {
        found.insert(current);
    }
    found.into_iter().collect()
}

fn close(graph: &PreparedGraph, plan: &Plan, anchors: &[String]) -> Option<Closed> {
    if graph.bindings.len() as i64 > plan.bounds["maxEvidenceBindings"]
        || anchors.len() as i64 > plan.bounds["maxAnchorNodes"]
        || anchors.len() as i64 > plan.bounds["maxClosureNodes"]
    {
        return None;
    }
    let mut outgoing: BTreeMap<&str, Vec<&Relation>> = BTreeMap::new();
    for relation in &graph.relations {
        outgoing.entry(relation.from.as_str()).or_default().push(relation);
    }
    for list in outgoing.values_mut() {
        list.sort_by(|left, right| left.id.cmp(&right.id));
    }
    let mut by_node: BTreeMap<&str, Vec<&Binding>> = BTreeMap::new();
    for binding in &graph.bindings {
        by_node.entry(binding.node_id.as_str()).or_default().push(binding);
    }
    let mut members: BTreeMap<&str, BTreeSet<String>> = FRONTIERS.into_iter().map(|frontier| (frontier, BTreeSet::new())).collect();
    let mut lists: BTreeMap<&str, Vec<String>> = FRONTIERS.into_iter().map(|frontier| (frontier, Vec::new())).collect();
    let mut witnesses = Vec::new();
    let mut witness_keys = BTreeSet::new();
    let mut admissions = Vec::new();
    let mut seen_states = BTreeSet::new();
    let mut seen_nodes = BTreeSet::new();
    let mut edges = 0i64;
    let mut current = Vec::new();
    for anchor in anchors {
        seen_states.insert(format!("{anchor}\0"));
        seen_nodes.insert(anchor.clone());
        current.push(State {
            node_id: anchor.clone(),
            frontier: String::new(),
            depth: 0,
            anchor_id: anchor.clone(),
            path: vec![obj(vec![("node", Value::String(anchor.clone()))])],
        });
    }
    while !current.is_empty() {
        let mut next = Vec::new();
        for state in &current {
            if state.depth >= plan.depth {
                continue;
            }
            for relation in outgoing.get(state.node_id.as_str()).into_iter().flatten() {
                let Some(label) = plan.frontier_map.get(&relation.relation) else { continue };
                if edges + 1 > plan.bounds["maxClosureEdges"] {
                    return None;
                }
                edges += 1;
                let key = format!("{}\0{label}", relation.to);
                if seen_states.contains(&key) {
                    continue;
                }
                if !seen_nodes.contains(&relation.to) {
                    if seen_nodes.len() as i64 + 1 > plan.bounds["maxClosureNodes"] {
                        return None;
                    }
                    seen_nodes.insert(relation.to.clone());
                }
                seen_states.insert(key);
                let mut path = state.path.clone();
                path.push(obj(vec![
                    ("node", Value::String(relation.to.clone())),
                    ("relation", Value::String(relation.id.clone())),
                ]));
                next.push(State {
                    node_id: relation.to.clone(),
                    frontier: label.clone(),
                    depth: state.depth + 1,
                    anchor_id: state.anchor_id.clone(),
                    path,
                });
            }
        }
        next.sort_by(|left, right| left.frontier.cmp(&right.frontier).then(left.node_id.cmp(&right.node_id)));
        for state in &next {
            if !admit(graph, plan, state, &by_node, &mut members, &mut lists, &mut witnesses, &mut witness_keys, &mut admissions) {
                return None;
            }
        }
        current = next;
    }
    if let Some((frontier, ids)) = &plan.lexical {
        let mut lexical_ids = ids.clone();
        lexical_ids.sort();
        lexical_ids.dedup();
        for evidence_id in lexical_ids {
            if members.get(frontier.as_str()).is_some_and(|bucket| bucket.contains(&evidence_id)) {
                continue;
            }
            if members.get(frontier.as_str()).map(|bucket| bucket.len() as i64).unwrap_or(0) + 1 > plan.bounds["maxFrontierEvidence"] {
                return None;
            }
            members.get_mut(frontier.as_str()).unwrap().insert(evidence_id.clone());
            lists.get_mut(frontier.as_str()).unwrap().push(evidence_id.clone());
            witnesses.push(witness_json(&evidence_id, frontier, None, &[]));
            let related: Vec<&Binding> = graph.bindings.iter().filter(|binding| binding.evidence_id == evidence_id).collect();
            if related.is_empty() {
                admissions.push(Admission {
                    evidence_id,
                    frontier: frontier.clone(),
                    applicable: true,
                    requirements: Vec::new(),
                });
            } else {
                for binding in related {
                    let ok = applicable(binding, plan);
                    admissions.push(Admission {
                        evidence_id: evidence_id.clone(),
                        frontier: frontier.clone(),
                        applicable: ok,
                        requirements: if ok { binding.requirements.clone() } else { Vec::new() },
                    });
                }
            }
        }
    }
    for list in lists.values_mut() {
        list.sort();
    }
    witnesses.sort_by(witness_order);
    let mut frontiers = Map::new();
    for frontier in FRONTIERS {
        frontiers.insert(frontier.to_string(), string_array(lists.get(frontier).unwrap()));
    }
    Some(Closed { frontiers: Value::Object(frontiers), witnesses, admissions })
}

struct State {
    node_id: String,
    frontier: String,
    depth: i64,
    anchor_id: String,
    path: Vec<Value>,
}

fn admit(
    _graph: &PreparedGraph,
    plan: &Plan,
    state: &State,
    by_node: &BTreeMap<&str, Vec<&Binding>>,
    members: &mut BTreeMap<&str, BTreeSet<String>>,
    lists: &mut BTreeMap<&str, Vec<String>>,
    witnesses: &mut Vec<Value>,
    witness_keys: &mut BTreeSet<String>,
    admissions: &mut Vec<Admission>,
) -> bool {
    if state.frontier.is_empty() {
        return true;
    }
    let frontier = state.frontier.as_str();
    for binding in by_node.get(state.node_id.as_str()).into_iter().flatten() {
        let bucket = members.get_mut(frontier).unwrap();
        if !bucket.contains(&binding.evidence_id) {
            if bucket.len() as i64 + 1 > plan.bounds["maxFrontierEvidence"] {
                return false;
            }
            bucket.insert(binding.evidence_id.clone());
            lists.get_mut(frontier).unwrap().push(binding.evidence_id.clone());
        }
        let key = format!("{frontier}\0{}", binding.evidence_id);
        if witness_keys.insert(key) {
            witnesses.push(witness_json(&binding.evidence_id, frontier, Some(state.anchor_id.as_str()), &state.path));
        }
        let ok = applicable(binding, plan);
        admissions.push(Admission {
            evidence_id: binding.evidence_id.clone(),
            frontier: frontier.to_string(),
            applicable: ok,
            requirements: if ok { binding.requirements.clone() } else { Vec::new() },
        });
    }
    true
}

fn applicable(binding: &Binding, plan: &Plan) -> bool {
    if binding.unauthorized {
        return false;
    }
    if let Some(minimum) = plan.min_authority {
        if binding.authority.is_none_or(|authority| authority < minimum) {
            return false;
        }
    }
    if binding.valid_from.as_ref().is_some_and(|from| plan.as_of < *from) {
        return false;
    }
    if binding.valid_until.as_ref().is_some_and(|until| plan.as_of >= *until) {
        return false;
    }
    true
}

fn witness_json(evidence_id: &str, frontier: &str, anchor: Option<&str>, path: &[Value]) -> Value {
    obj(vec![
        ("anchorId", anchor.map(|id| Value::String(id.to_string())).unwrap_or(Value::Null)),
        ("evidenceId", Value::String(evidence_id.to_string())),
        ("frontier", Value::String(frontier.to_string())),
        ("path", Value::Array(path.to_vec())),
    ])
}

fn witness_order(left: &Value, right: &Value) -> std::cmp::Ordering {
    let field = |value: &Value, key: &str| value.get(key).and_then(Value::as_str).unwrap_or("").to_string();
    let anchor = |value: &Value| value.get("anchorId").and_then(Value::as_str).unwrap_or("").to_string();
    field(left, "frontier")
        .cmp(&field(right, "frontier"))
        .then(field(left, "evidenceId").cmp(&field(right, "evidenceId")))
        .then(anchor(left).cmp(&anchor(right)))
}

fn select_cover(plan: &Plan, admissions: &[Admission], texts: &BTreeMap<String, String>) -> Cover {
    let micros: BTreeMap<&str, i64> = FRONTIERS.into_iter().map(|frontier| (frontier, floor_micros(&plan.floors[frontier]).unwrap_or(0))).collect();
    let mut base = build_candidates(plan, admissions, texts);
    if plan.profile == "minimum-cover" {
        let mut best: BTreeMap<String, Candidate> = BTreeMap::new();
        for candidate in base {
            match best.get(&candidate.mask) {
                Some(current) if current.id <= candidate.id => {}
                _ => {
                    best.insert(candidate.mask.clone(), candidate);
                }
            }
        }
        base = best.into_values().collect();
    }
    base.sort_by(|left, right| left.id.cmp(&right.id));
    let limit = plan.bounds["maxCoverVisits"];
    let max_size = plan.cardinality_bound.max(0) as usize;
    let max_size = max_size.min(base.len());
    let mut visits = 0i64;

    if plan.profile == "minimum-cover" {
        for size in 0..=max_size {
            for indexes in combinations(base.len(), size) {
                visits += 1;
                if visits > limit {
                    return failed_cover(plan, "SEARCH_BOUND_EXCEEDED");
                }
                let combo: Vec<&Candidate> = indexes.iter().map(|index| &base[*index]).collect();
                let scored = coverage_of(plan, &combo, &micros);
                if scored.ok {
                    return satisfied(plan, &combo, scored.pairs, None);
                }
            }
        }
        return failed_cover(plan, "UNSATISFIED_EVIDENCE_REQUIREMENTS");
    }

    let mut best: Option<Exp1> = None;
    for size in 0..=max_size {
        let mut feasible = Vec::new();
        for indexes in combinations(base.len(), size) {
            visits += 1;
            if visits > limit {
                return failed_cover(plan, "SEARCH_BOUND_EXCEEDED");
            }
            let combo: Vec<Candidate> = indexes.iter().map(|index| base[*index].clone()).collect();
            let viewed: Vec<&Candidate> = combo.iter().collect();
            let scored = coverage_of(plan, &viewed, &micros);
            if scored.ok {
                feasible.push((combo, scored));
            }
        }
        if plan.profile == "minimum-cover-redundancy-v1" && !feasible.is_empty() {
            feasible.sort_by(|left, right| {
                let order = compare_rat(redundancy(&left.0), redundancy(&right.0));
                if order != std::cmp::Ordering::Equal {
                    return order;
                }
                id_key(&left.0).cmp(&id_key(&right.0))
            });
            let winner = &feasible[0];
            let viewed: Vec<&Candidate> = winner.0.iter().collect();
            let redundant = redundancy(&winner.0);
            return satisfied(plan, &viewed, winner.1.pairs.clone(), Some(redundant));
        }
        if plan.profile == "exp1-lexicographic" {
            for (combo, scored) in feasible {
                let current = Exp1 { counts: scored.counts.clone(), ids: combo.iter().map(|item| item.id.clone()).collect() };
                if best.as_ref().is_none_or(|previous| better_exp1(&current, previous)) {
                    best = Some(Exp1 { counts: current.counts, ids: current.ids.clone() });
                    let viewed: Vec<&Candidate> = combo.iter().collect();
                    // Keep the winning combination by satisfying from ids after the loop.
                    let _ = viewed;
                }
            }
        }
    }
    if plan.profile == "exp1-lexicographic" {
        if let Some(winner) = best {
            let combo: Vec<&Candidate> = winner.ids.iter().filter_map(|id| base.iter().find(|item| &item.id == id)).collect();
            let scored = coverage_of(plan, &combo, &micros);
            return satisfied(plan, &combo, scored.pairs, None);
        }
    }
    failed_cover(plan, "UNSATISFIED_EVIDENCE_REQUIREMENTS")
}

struct Exp1 {
    counts: BTreeMap<String, i64>,
    ids: Vec<String>,
}

struct Scored {
    ok: bool,
    pairs: BTreeMap<String, (i64, i64)>,
    counts: BTreeMap<String, i64>,
}

fn coverage_of(plan: &Plan, chosen: &[&Candidate], micros: &BTreeMap<&str, i64>) -> Scored {
    let mut pairs = BTreeMap::new();
    let mut counts = BTreeMap::new();
    let mut ok = true;
    for frontier in FRONTIERS {
        let (covered, required) = if plan.coverage_mode == "requirements" {
            let required_ids = &plan.requirements[frontier];
            let required = required_ids.len() as i64;
            let mut hit = BTreeSet::new();
            if required > 0 {
                for candidate in chosen {
                    if let Some(items) = candidate.requirements.get(frontier) {
                        for requirement in items {
                            if required_ids.iter().any(|item| item == requirement) {
                                hit.insert(requirement.clone());
                            }
                        }
                    }
                }
            }
            (hit.len() as i64, required)
        } else {
            let covered = if chosen.iter().any(|candidate| candidate.nonempty.contains(frontier)) { 1 } else { 0 };
            (covered, 1)
        };
        if !passes(covered, required, micros[frontier]) {
            ok = false;
        }
        pairs.insert(frontier.to_string(), (covered, required));
        counts.insert(frontier.to_string(), covered);
    }
    Scored { ok, pairs, counts }
}

fn passes(covered: i64, required: i64, micros: i64) -> bool {
    if required == 0 {
        return true;
    }
    i128::from(covered) * 1_000_000 >= i128::from(micros) * i128::from(required)
}

fn build_candidates(plan: &Plan, admissions: &[Admission], texts: &BTreeMap<String, String>) -> Vec<Candidate> {
    let mut grouped: BTreeMap<String, Candidate> = BTreeMap::new();
    for admission in admissions {
        if !admission.applicable {
            continue;
        }
        let candidate = grouped.entry(admission.evidence_id.clone()).or_insert_with(|| Candidate {
            id: admission.evidence_id.clone(),
            mask: String::new(),
            requirements: BTreeMap::new(),
            nonempty: BTreeSet::new(),
            tokens: ascii_tokens(texts.get(&admission.evidence_id).map(String::as_str).unwrap_or("")),
        });
        candidate.nonempty.insert(admission.frontier.clone());
        let bucket = candidate.requirements.entry(admission.frontier.clone()).or_default();
        for requirement in &admission.requirements {
            bucket.insert(requirement.clone());
        }
    }
    let mut candidates: Vec<Candidate> = grouped.into_values().filter(|candidate| !mask_key(plan, candidate).is_empty()).collect();
    for candidate in &mut candidates {
        candidate.mask = mask_key(plan, candidate);
    }
    candidates.sort_by(|left, right| left.id.cmp(&right.id));
    candidates
}

fn mask_key(plan: &Plan, candidate: &Candidate) -> String {
    if plan.coverage_mode == "nonempty" {
        return candidate.nonempty.iter().cloned().collect::<Vec<_>>().join(",");
    }
    let mut parts = Vec::new();
    for frontier in FRONTIERS {
        let Some(items) = candidate.requirements.get(frontier) else { continue };
        let mut ids: Vec<&str> = items
            .iter()
            .filter(|id| plan.requirements[frontier].iter().any(|required| required == *id))
            .map(String::as_str)
            .collect();
        ids.sort();
        if !ids.is_empty() {
            parts.push(format!("{frontier}={}", ids.join("+")));
        }
    }
    parts.join("|")
}

fn combinations(length: usize, size: usize) -> Vec<Vec<usize>> {
    if size == 0 {
        return vec![Vec::new()];
    }
    if size > length {
        return Vec::new();
    }
    let mut index: Vec<usize> = (0..size).collect();
    let mut out = Vec::new();
    loop {
        out.push(index.clone());
        let mut cursor = size - 1;
        while index[cursor] == length - size + cursor {
            if cursor == 0 {
                return out;
            }
            cursor -= 1;
        }
        index[cursor] += 1;
        for next in cursor + 1..size {
            index[next] = index[next - 1] + 1;
        }
    }
}

fn satisfied(plan: &Plan, combo: &[&Candidate], pairs: BTreeMap<String, (i64, i64)>, redundant: Option<Rat>) -> Cover {
    let mut evidence_ids: Vec<String> = combo.iter().map(|candidate| candidate.id.clone()).collect();
    evidence_ids.sort();
    let choices = evidence_ids
        .iter()
        .map(|id| {
            let candidate = combo.iter().find(|item| &item.id == id).unwrap();
            let frontiers: Vec<String> = candidate.nonempty.iter().cloned().collect();
            obj(vec![
                ("evidenceId", Value::String(id.clone())),
                ("frontiers", string_array(&frontiers)),
            ])
        })
        .collect();
    let mut coverage = Map::new();
    for frontier in FRONTIERS {
        let (covered, required) = pairs[frontier];
        coverage.insert(frontier.to_string(), pair(covered, required));
    }
    let mut decision = vec![
        ("cardinality", Value::from(evidence_ids.len() as i64)),
        ("coverage", Value::Object(coverage)),
        ("profile", Value::String(plan.profile.clone())),
        ("status", Value::String("SATISFIED".to_string())),
    ];
    if plan.profile == "minimum-cover-redundancy-v1" {
        if let Some(value) = redundant {
            decision.push((
                "redundancy",
                obj(vec![
                    ("denominator", Value::from(value.d as i64)),
                    ("numerator", Value::from(value.n as i64)),
                ]),
            ));
        }
    }
    Cover { status: "SATISFIED".to_string(), evidence_ids, choices, decision: obj(decision) }
}

fn failed_cover(plan: &Plan, status: &str) -> Cover {
    Cover {
        status: status.to_string(),
        evidence_ids: Vec::new(),
        choices: Vec::new(),
        decision: base_decision(status, Some(plan)),
    }
}

fn better_exp1(left: &Exp1, right: &Exp1) -> bool {
    for frontier in ["F_O", "F_S", "F_Q", "F_T", "F_A"] {
        let l = left.counts[frontier];
        let r = right.counts[frontier];
        if l != r {
            return l > r;
        }
    }
    if left.ids.len() != right.ids.len() {
        return left.ids.len() < right.ids.len();
    }
    id_list(&left.ids) < id_list(&right.ids)
}

fn id_key(combo: &[Candidate]) -> String {
    let mut ids: Vec<&str> = combo.iter().map(|item| item.id.as_str()).collect();
    ids.sort();
    ids.join("\0")
}

fn id_list(ids: &[String]) -> String {
    let mut copy = ids.to_vec();
    copy.sort();
    copy.join("\0")
}

#[derive(Clone, Copy)]
struct Rat {
    n: i128,
    d: i128,
}

fn redundancy(combo: &[Candidate]) -> Rat {
    if combo.len() < 2 {
        return Rat { n: 0, d: 1 };
    }
    let mut sum_n = 0i128;
    let mut sum_d = 1i128;
    let mut pairs = 0i128;
    for left in 0..combo.len() {
        for right in left + 1..combo.len() {
            let part = jaccard(&combo[left].tokens, &combo[right].tokens);
            sum_n = sum_n * part.d + part.n * sum_d;
            sum_d *= part.d;
            let divisor = gcd(sum_n, sum_d);
            sum_n /= divisor;
            sum_d /= divisor;
            pairs += 1;
        }
    }
    reduce(sum_n, pairs * sum_d)
}

fn jaccard(left: &[String], right: &[String]) -> Rat {
    let a: HashSet<&String> = left.iter().collect();
    let b: HashSet<&String> = right.iter().collect();
    if a.is_empty() && b.is_empty() {
        return Rat { n: 1, d: 1 };
    }
    let inter = a.intersection(&b).count() as i128;
    let union = a.len() as i128 + b.len() as i128 - inter;
    if union == 0 { Rat { n: 0, d: 1 } } else { Rat { n: inter, d: union } }
}

fn reduce(mut n: i128, mut d: i128) -> Rat {
    if d < 0 {
        n = -n;
        d = -d;
    }
    let divisor = gcd(n, d);
    Rat { n: n / divisor, d: d / divisor }
}

fn gcd(mut a: i128, mut b: i128) -> i128 {
    a = a.abs();
    b = b.abs();
    while b != 0 {
        let next = a % b;
        a = b;
        b = next;
    }
    if a == 0 { 1 } else { a }
}

fn compare_rat(left: Rat, right: Rat) -> std::cmp::Ordering {
    (left.n * right.d).cmp(&(right.n * left.d))
}

fn ascii_tokens(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut current = String::new();
    for byte in text.bytes() {
        let folded = if (b'A'..=b'Z').contains(&byte) { byte + 32 } else { byte };
        if folded.is_ascii_alphanumeric() {
            current.push(folded as char);
        } else if !current.is_empty() {
            out.push(std::mem::take(&mut current));
        }
    }
    if !current.is_empty() {
        out.push(current);
    }
    out
}
