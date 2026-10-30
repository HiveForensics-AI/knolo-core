//! Plan, graph, and anchor validation for the frozen `kar-1-research-1` evaluator.
//! Indexes are execution-only. They are not hashed.

use crate::kar::json::{digest_json, utf16_cmp, Json};

pub const KAR_VERSION: &str = "kar-1-research-1";
pub const KAR_API: &str = "experimental";
pub const FRONTIERS: [&str; 5] = ["F_S", "F_O", "F_Q", "F_T", "F_A"];
const PROFILES: [&str; 3] = [
    "minimum-cover",
    "minimum-cover-redundancy-v1",
    "exp1-lexicographic",
];
const ROOT: &str = "sha256-";

#[derive(Debug, Clone)]
pub struct Bounds {
    pub max_anchor_nodes: i64,
    pub max_closure_nodes: i64,
    pub max_closure_edges: i64,
    pub max_frontier_evidence: i64,
    pub max_requirements_per_frontier: i64,
    pub max_evidence_bindings: i64,
    pub max_cover_visits: i64,
}

#[derive(Debug, Clone)]
pub struct WitnessRecord {
    pub node_id: String,
    pub query_term: Option<String>,
}

#[derive(Debug, Clone)]
pub enum AnchorSpec {
    Recompute { procedure: String },
    Supplied { witness: Vec<WitnessRecord> },
}

#[derive(Debug, Clone)]
pub struct Lexical {
    pub frontier: String,
    pub evidence_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct Plan {
    pub anchor: AnchorSpec,
    pub frontier_map: Vec<(String, String)>,
    pub depth: i64,
    pub cardinality_bound: i64,
    pub coverage_mode: String,
    pub requirements: Vec<(String, Vec<String>)>,
    pub floors: Vec<(String, String)>,
    pub profile: String,
    pub as_of: String,
    pub min_authority: Option<i64>,
    pub bounds: Bounds,
    pub lexical: Option<Lexical>,
}

#[derive(Debug, Clone)]
pub struct Relation {
    pub id: String,
    pub from: String,
    pub relation: String,
    pub to: String,
}

#[derive(Debug, Clone)]
pub struct Binding {
    pub id: String,
    pub node_id: String,
    pub evidence_id: String,
    pub requirements: Vec<String>,
    pub authority: Option<i64>,
    pub unauthorized: bool,
    pub valid_from: Option<String>,
    pub valid_until: Option<String>,
    pub provenance: Option<String>,
}

#[derive(Debug, Clone)]
pub struct Graph {
    pub knowledge_root: String,
    pub producer: String,
    pub note: Option<String>,
    pub nodes: Vec<String>,
    pub relations: Vec<Relation>,
    pub bindings: Vec<Binding>,
}

#[derive(Debug, Clone)]
pub struct PreparedImage {
    pub knowledge_root: String,
    pub texts: Vec<(String, String)>,
}

#[derive(Debug, Clone)]
pub struct Indexes {
    pub relations_by_from: Vec<(String, Vec<Relation>)>,
    pub bindings_by_node: Vec<(String, Vec<Binding>)>,
    pub bindings_by_evidence: Vec<(String, Vec<Binding>)>,
    pub node_ids: Vec<String>,
}

#[derive(Debug, Clone)]
pub struct AnchorCommitment {
    pub mode: Option<String>,
    pub procedure: Option<String>,
    pub witness: Option<Vec<WitnessRecord>>,
    pub nodes: Vec<String>,
}

impl AnchorCommitment {
    pub fn empty() -> Self {
        Self {
            mode: None,
            procedure: None,
            witness: None,
            nodes: Vec::new(),
        }
    }

    pub fn to_json(&self) -> Json {
        let witness = match &self.witness {
            None => Json::Null,
            Some(rows) => Json::Array(rows.iter().map(WitnessRecord::to_json).collect()),
        };
        Json::object(vec![
            ("mode", opt_string(&self.mode)),
            (
                "nodes",
                Json::Array(self.nodes.iter().cloned().map(Json::String).collect()),
            ),
            ("procedure", opt_string(&self.procedure)),
            ("witness", witness),
        ])
    }
}

impl WitnessRecord {
    fn to_json(&self) -> Json {
        let mut pairs = vec![("nodeId", Json::String(self.node_id.clone()))];
        if let Some(term) = &self.query_term {
            pairs.push(("queryTerm", Json::String(term.clone())));
        }
        Json::Object(
            pairs
                .into_iter()
                .map(|(key, value)| (key.to_string(), value))
                .collect(),
        )
    }
}

fn opt_string(value: &Option<String>) -> Json {
    match value {
        Some(text) => Json::String(text.clone()),
        None => Json::Null,
    }
}

pub fn is_root(value: &str) -> bool {
    value.starts_with(ROOT)
        && value.len() == ROOT.len() + 64
        && value.as_bytes()[ROOT.len()..]
            .iter()
            .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
}

pub fn is_frontier(value: &str) -> bool {
    FRONTIERS.contains(&value)
}

pub fn prepare_image(evidence: Vec<(String, String)>) -> PreparedImage {
    let mut rows = evidence;
    rows.sort_by(|left, right| utf16_cmp(&left.0, &right.0));
    let image = Json::object(vec![
        (
            "evidence",
            Json::Array(
                rows.iter()
                    .map(|(id, text)| {
                        Json::object(vec![
                            ("id", Json::String(id.clone())),
                            ("text", Json::String(text.clone())),
                        ])
                    })
                    .collect(),
            ),
        ),
        ("version", Json::Int(1)),
    ]);
    PreparedImage {
        knowledge_root: digest_json(&image),
        texts: rows,
    }
}

pub fn prepare_graph(input: &Json) -> Option<Graph> {
    let raw = input.as_object()?;
    if !only_keys(
        raw,
        &[
            "version",
            "knowledgeRoot",
            "provenance",
            "nodes",
            "relations",
            "bindings",
        ],
    ) {
        return None;
    }
    if input.get("version")?.as_int() != Some(1) {
        return None;
    }
    let knowledge_root = input.get("knowledgeRoot")?.as_str()?;
    if !is_root(knowledge_root) {
        return None;
    }
    let provenance_raw = input.get("provenance")?.as_object()?;
    if !only_keys(provenance_raw, &["producer", "note"]) {
        return None;
    }
    let producer = input.get("provenance")?.get("producer")?.as_str()?;
    if producer.is_empty() {
        return None;
    }
    let note = match input.get("provenance")?.get("note") {
        None => None,
        Some(Json::String(value)) => Some(value.clone()),
        Some(_) => return None,
    };
    let nodes_json = match input.get("nodes")? {
        Json::Array(items) => items,
        _ => return None,
    };
    let mut nodes = Vec::new();
    for item in nodes_json {
        let row = item.as_object()?;
        if !only_keys(row, &["id"]) {
            return None;
        }
        let id = item.get("id")?.as_str()?;
        if id.is_empty() || nodes.iter().any(|existing| existing == id) {
            return None;
        }
        nodes.push(id.to_string());
    }
    let node_set = nodes.clone();
    let relations_json = match input.get("relations")? {
        Json::Array(items) => items,
        _ => return None,
    };
    let mut relations = Vec::new();
    for item in relations_json {
        let row = item.as_object()?;
        if !only_keys(row, &["id", "from", "relation", "to"]) {
            return None;
        }
        let id = item.get("id")?.as_str()?;
        let from = item.get("from")?.as_str()?;
        let relation = item.get("relation")?.as_str()?;
        let to = item.get("to")?.as_str()?;
        if id.is_empty()
            || relation.is_empty()
            || relations
                .iter()
                .any(|existing: &Relation| existing.id == id)
        {
            return None;
        }
        if !node_set.iter().any(|node| node == from) || !node_set.iter().any(|node| node == to) {
            return None;
        }
        relations.push(Relation {
            id: id.to_string(),
            from: from.to_string(),
            relation: relation.to_string(),
            to: to.to_string(),
        });
    }
    let bindings_json = match input.get("bindings")? {
        Json::Array(items) => items,
        _ => return None,
    };
    let mut bindings = Vec::new();
    for item in bindings_json {
        bindings.push(normalize_binding(item, &node_set, &bindings)?);
    }
    nodes.sort_by(|left, right| utf16_cmp(left, right));
    relations.sort_by(|left, right| utf16_cmp(&left.id, &right.id));
    bindings.sort_by(|left, right| utf16_cmp(&left.id, &right.id));
    Some(Graph {
        knowledge_root: knowledge_root.to_string(),
        producer: producer.to_string(),
        note,
        nodes,
        relations,
        bindings,
    })
}

fn normalize_binding(item: &Json, nodes: &[String], bindings: &[Binding]) -> Option<Binding> {
    let row = item.as_object()?;
    if !only_keys(
        row,
        &[
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
    ) {
        return None;
    }
    let id = item.get("id")?.as_str()?;
    let node_id = item.get("nodeId")?.as_str()?;
    let evidence_id = item.get("evidenceId")?.as_str()?;
    if id.is_empty()
        || evidence_id.is_empty()
        || bindings.iter().any(|existing| existing.id == id)
        || !nodes.iter().any(|node| node == node_id)
    {
        return None;
    }
    let requirements_json = match item.get("requirements")? {
        Json::Array(items) => items,
        _ => return None,
    };
    let mut requirements = Vec::new();
    for requirement in requirements_json {
        let text = requirement.as_str()?;
        if text.is_empty() || requirements.iter().any(|existing| existing == text) {
            return None;
        }
        requirements.push(text.to_string());
    }
    requirements.sort_by(|left, right| utf16_cmp(left, right));
    let authority = match item.get("authority") {
        None => None,
        Some(Json::Int(value)) => Some(*value),
        Some(_) => return None,
    };
    let unauthorized = match item.get("unauthorized") {
        None => false,
        Some(Json::Bool(true)) => true,
        Some(Json::Bool(false)) => false,
        Some(_) => return None,
    };
    let valid_from = optional_date(item.get("validFrom"))?;
    let valid_until = optional_date(item.get("validUntil"))?;
    let provenance = match item.get("provenance") {
        None => None,
        Some(Json::String(value)) if !value.is_empty() => Some(value.clone()),
        Some(_) => return None,
    };
    Some(Binding {
        id: id.to_string(),
        node_id: node_id.to_string(),
        evidence_id: evidence_id.to_string(),
        requirements,
        authority,
        unauthorized,
        valid_from,
        valid_until,
        provenance,
    })
}

fn optional_date(value: Option<&Json>) -> Option<Option<String>> {
    match value {
        None => Some(None),
        Some(Json::String(text)) if is_date(text) => Some(Some(text.clone())),
        Some(_) => None,
    }
}

fn is_date(value: &str) -> bool {
    let bytes = value.as_bytes();
    bytes.len() == 10
        && bytes[4] == b'-'
        && bytes[7] == b'-'
        && bytes
            .iter()
            .enumerate()
            .all(|(index, byte)| index == 4 || index == 7 || byte.is_ascii_digit())
}

pub fn graph_json(graph: &Graph) -> Json {
    let mut provenance = vec![("producer".to_string(), Json::String(graph.producer.clone()))];
    if let Some(note) = &graph.note {
        provenance.push(("note".to_string(), Json::String(note.clone())));
    }
    Json::object(vec![
        (
            "bindings",
            Json::Array(graph.bindings.iter().map(binding_json).collect()),
        ),
        ("knowledgeRoot", Json::String(graph.knowledge_root.clone())),
        (
            "nodes",
            Json::Array(
                graph
                    .nodes
                    .iter()
                    .cloned()
                    .map(|id| Json::object(vec![("id", Json::String(id))]))
                    .collect(),
            ),
        ),
        ("provenance", Json::Object(provenance)),
        (
            "relations",
            Json::Array(graph.relations.iter().map(relation_json).collect()),
        ),
        ("version", Json::Int(1)),
    ])
}

fn relation_json(relation: &Relation) -> Json {
    Json::object(vec![
        ("from", Json::String(relation.from.clone())),
        ("id", Json::String(relation.id.clone())),
        ("relation", Json::String(relation.relation.clone())),
        ("to", Json::String(relation.to.clone())),
    ])
}

fn binding_json(binding: &Binding) -> Json {
    let mut pairs = vec![
        (
            "evidenceId".to_string(),
            Json::String(binding.evidence_id.clone()),
        ),
        ("id".to_string(), Json::String(binding.id.clone())),
        ("nodeId".to_string(), Json::String(binding.node_id.clone())),
        (
            "requirements".to_string(),
            Json::Array(
                binding
                    .requirements
                    .iter()
                    .cloned()
                    .map(Json::String)
                    .collect(),
            ),
        ),
    ];
    if let Some(authority) = binding.authority {
        pairs.push(("authority".to_string(), Json::Int(authority)));
    }
    if binding.unauthorized {
        pairs.push(("unauthorized".to_string(), Json::Bool(true)));
    }
    if let Some(valid_from) = &binding.valid_from {
        pairs.push(("validFrom".to_string(), Json::String(valid_from.clone())));
    }
    if let Some(valid_until) = &binding.valid_until {
        pairs.push(("validUntil".to_string(), Json::String(valid_until.clone())));
    }
    if let Some(provenance) = &binding.provenance {
        pairs.push(("provenance".to_string(), Json::String(provenance.clone())));
    }
    Json::Object(pairs)
}

pub fn semantic_root_of(graph: &Graph) -> String {
    digest_json(&Json::object(vec![
        ("graph", graph_json(graph)),
        ("knowledgeRoot", Json::String(graph.knowledge_root.clone())),
    ]))
}

pub fn unresolved_evidence(graph: &Graph, texts: &[(String, String)]) -> bool {
    graph
        .bindings
        .iter()
        .any(|binding| texts.iter().all(|(id, _)| id != &binding.evidence_id))
}

pub fn build_indexes(graph: &Graph) -> Indexes {
    let mut relations_by_from: Vec<(String, Vec<Relation>)> = Vec::new();
    for relation in &graph.relations {
        push_group(&mut relations_by_from, &relation.from, relation.clone());
    }
    for (_, list) in &mut relations_by_from {
        list.sort_by(|left, right| utf16_cmp(&left.id, &right.id));
    }
    let mut bindings_by_node: Vec<(String, Vec<Binding>)> = Vec::new();
    let mut bindings_by_evidence: Vec<(String, Vec<Binding>)> = Vec::new();
    for binding in &graph.bindings {
        push_group(&mut bindings_by_node, &binding.node_id, binding.clone());
        push_group(
            &mut bindings_by_evidence,
            &binding.evidence_id,
            binding.clone(),
        );
    }
    Indexes {
        relations_by_from,
        bindings_by_node,
        bindings_by_evidence,
        node_ids: graph.nodes.clone(),
    }
}

fn push_group<T>(groups: &mut Vec<(String, Vec<T>)>, key: &str, value: T) {
    if let Some((_, list)) = groups.iter_mut().find(|(name, _)| name == key) {
        list.push(value);
    } else {
        groups.push((key.to_string(), vec![value]));
    }
}

pub fn group<'a, T>(groups: &'a [(String, Vec<T>)], key: &str) -> &'a [T] {
    groups
        .iter()
        .find(|(name, _)| name == key)
        .map(|(_, list)| list.as_slice())
        .unwrap_or(&[])
}

pub fn validate_plan(input: &Json) -> Option<Plan> {
    let raw = input.as_object()?;
    if !only_keys(
        raw,
        &[
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
    ) {
        return None;
    }
    if input.get("version")?.as_int() != Some(1) {
        return None;
    }
    let depth = non_negative(input.get("depth")?)?;
    let cardinality_bound = non_negative(input.get("cardinalityBound")?)?;
    let coverage_mode = input.get("coverageMode")?.as_str()?;
    if coverage_mode != "requirements" && coverage_mode != "nonempty" {
        return None;
    }
    let profile = input.get("profile")?.as_str()?;
    if !PROFILES.contains(&profile) {
        return None;
    }
    let as_of = input.get("asOf")?.as_str()?;
    if !is_date(as_of) {
        return None;
    }
    let min_authority = match input.get("minAuthority")? {
        Json::Null => None,
        Json::Int(value) => Some(*value),
        _ => return None,
    };
    let anchor = validate_anchor(input.get("anchor")?)?;
    let frontier_map = validate_frontier_map(input.get("frontierMap")?)?;
    let requirements = validate_frontier_lists(input.get("requirements")?)?;
    let floors = validate_floors(input.get("floors")?)?;
    let bounds = validate_bounds(input.get("bounds")?)?;
    let lexical = validate_lexical(input.get("lexical")?)?;
    if requirements
        .iter()
        .any(|(_, list)| list.len() > bounds.max_requirements_per_frontier as usize)
    {
        return None;
    }
    Some(Plan {
        anchor,
        frontier_map,
        depth,
        cardinality_bound,
        coverage_mode: coverage_mode.to_string(),
        requirements,
        floors,
        profile: profile.to_string(),
        as_of: as_of.to_string(),
        min_authority,
        bounds,
        lexical,
    })
}

pub fn plan_json(plan: &Plan) -> Json {
    let anchor = match &plan.anchor {
        AnchorSpec::Recompute { procedure } => Json::object(vec![
            ("mode", Json::String("recompute".into())),
            ("procedure", Json::String(procedure.clone())),
        ]),
        AnchorSpec::Supplied { witness } => Json::object(vec![
            ("mode", Json::String("supplied".into())),
            (
                "witness",
                Json::Array(witness.iter().map(WitnessRecord::to_json).collect()),
            ),
        ]),
    };
    let lexical = match &plan.lexical {
        None => Json::Null,
        Some(lexical) => Json::object(vec![
            (
                "evidenceIds",
                Json::Array(
                    lexical
                        .evidence_ids
                        .iter()
                        .cloned()
                        .map(Json::String)
                        .collect(),
                ),
            ),
            ("frontier", Json::String(lexical.frontier.clone())),
        ]),
    };
    Json::object(vec![
        ("anchor", anchor),
        ("asOf", Json::String(plan.as_of.clone())),
        (
            "bounds",
            Json::object(vec![
                ("maxAnchorNodes", Json::Int(plan.bounds.max_anchor_nodes)),
                ("maxClosureEdges", Json::Int(plan.bounds.max_closure_edges)),
                ("maxClosureNodes", Json::Int(plan.bounds.max_closure_nodes)),
                ("maxCoverVisits", Json::Int(plan.bounds.max_cover_visits)),
                (
                    "maxEvidenceBindings",
                    Json::Int(plan.bounds.max_evidence_bindings),
                ),
                (
                    "maxFrontierEvidence",
                    Json::Int(plan.bounds.max_frontier_evidence),
                ),
                (
                    "maxRequirementsPerFrontier",
                    Json::Int(plan.bounds.max_requirements_per_frontier),
                ),
            ]),
        ),
        ("cardinalityBound", Json::Int(plan.cardinality_bound)),
        ("coverageMode", Json::String(plan.coverage_mode.clone())),
        ("depth", Json::Int(plan.depth)),
        (
            "floors",
            Json::Object(
                plan.floors
                    .iter()
                    .map(|(frontier, floor)| (frontier.clone(), Json::String(floor.clone())))
                    .collect(),
            ),
        ),
        (
            "frontierMap",
            Json::Object(
                plan.frontier_map
                    .iter()
                    .map(|(symbol, frontier)| (symbol.clone(), Json::String(frontier.clone())))
                    .collect(),
            ),
        ),
        ("lexical", lexical),
        (
            "minAuthority",
            plan.min_authority.map(Json::Int).unwrap_or(Json::Null),
        ),
        ("profile", Json::String(plan.profile.clone())),
        (
            "requirements",
            Json::Object(
                plan.requirements
                    .iter()
                    .map(|(frontier, ids)| {
                        (
                            frontier.clone(),
                            Json::Array(ids.iter().cloned().map(Json::String).collect()),
                        )
                    })
                    .collect(),
            ),
        ),
        ("version", Json::Int(1)),
    ])
}

fn validate_anchor(input: &Json) -> Option<AnchorSpec> {
    let raw = input.as_object()?;
    match input.get("mode")?.as_str()? {
        "recompute" => {
            if !only_keys(raw, &["mode", "procedure"])
                || input.get("procedure")?.as_str()? != "member-id-v1"
            {
                return None;
            }
            Some(AnchorSpec::Recompute {
                procedure: "member-id-v1".into(),
            })
        }
        "supplied" => {
            if !only_keys(raw, &["mode", "witness"]) {
                return None;
            }
            let rows = match input.get("witness")? {
                Json::Array(items) => items,
                _ => return None,
            };
            let mut witness = Vec::new();
            for item in rows {
                let record = item.as_object()?;
                if !only_keys(record, &["nodeId", "queryTerm"]) {
                    return None;
                }
                let node_id = item.get("nodeId")?.as_str()?;
                if node_id.is_empty() {
                    return None;
                }
                let query_term = match item.get("queryTerm") {
                    None => None,
                    Some(Json::String(value)) => Some(value.clone()),
                    Some(_) => return None,
                };
                witness.push(WitnessRecord {
                    node_id: node_id.to_string(),
                    query_term,
                });
            }
            Some(AnchorSpec::Supplied { witness })
        }
        _ => None,
    }
}

fn validate_frontier_map(input: &Json) -> Option<Vec<(String, String)>> {
    let mut map = Vec::new();
    for (symbol, label) in input.as_object()? {
        let frontier = label.as_str()?;
        if symbol.is_empty() || !is_frontier(frontier) {
            return None;
        }
        map.push((symbol.clone(), frontier.to_string()));
    }
    Some(map)
}

fn validate_frontier_lists(input: &Json) -> Option<Vec<(String, Vec<String>)>> {
    let raw = input.as_object()?;
    if !only_keys(raw, &FRONTIERS) {
        return None;
    }
    let mut out = Vec::new();
    for frontier in FRONTIERS {
        out.push((frontier.to_string(), string_list(input.get(frontier)?)?));
    }
    Some(out)
}

fn validate_floors(input: &Json) -> Option<Vec<(String, String)>> {
    let raw = input.as_object()?;
    if !only_keys(raw, &FRONTIERS) {
        return None;
    }
    let mut out = Vec::new();
    for frontier in FRONTIERS {
        let floor = input.get(frontier)?.as_str()?;
        if floor_micros(floor).is_none() {
            return None;
        }
        out.push((frontier.to_string(), floor.to_string()));
    }
    Some(out)
}

pub fn floor_micros(floor: &str) -> Option<i64> {
    let mut parts = floor.split('.');
    let whole = parts.next()?;
    let frac = parts.next();
    if parts.next().is_some()
        || whole.is_empty()
        || !whole.bytes().all(|byte| byte.is_ascii_digit())
    {
        return None;
    }
    let fraction = match frac {
        None => String::new(),
        Some(text)
            if (1..=6).contains(&text.len()) && text.bytes().all(|byte| byte.is_ascii_digit()) =>
        {
            text.to_string()
        }
        Some(_) => return None,
    };
    let whole_number = whole.parse::<i64>().ok()?;
    if whole_number > 9_007_199_254_740_991 {
        return None;
    }
    let padded = format!("{fraction:0<6}");
    let micros = padded.parse::<i64>().ok()?;
    whole_number.checked_mul(1_000_000)?.checked_add(micros)
}

fn validate_bounds(input: &Json) -> Option<Bounds> {
    let raw = input.as_object()?;
    let names = [
        "maxAnchorNodes",
        "maxClosureNodes",
        "maxClosureEdges",
        "maxFrontierEvidence",
        "maxRequirementsPerFrontier",
        "maxEvidenceBindings",
        "maxCoverVisits",
    ];
    if !only_keys(raw, &names) {
        return None;
    }
    Some(Bounds {
        max_anchor_nodes: non_negative(input.get("maxAnchorNodes")?)?,
        max_closure_nodes: non_negative(input.get("maxClosureNodes")?)?,
        max_closure_edges: non_negative(input.get("maxClosureEdges")?)?,
        max_frontier_evidence: non_negative(input.get("maxFrontierEvidence")?)?,
        max_requirements_per_frontier: non_negative(input.get("maxRequirementsPerFrontier")?)?,
        max_evidence_bindings: non_negative(input.get("maxEvidenceBindings")?)?,
        max_cover_visits: non_negative(input.get("maxCoverVisits")?)?,
    })
}

fn validate_lexical(input: &Json) -> Option<Option<Lexical>> {
    if matches!(input, Json::Null) {
        return Some(None);
    }
    let raw = input.as_object()?;
    if !only_keys(raw, &["frontier", "evidenceIds"]) {
        return None;
    }
    let frontier = input.get("frontier")?.as_str()?;
    if !is_frontier(frontier) {
        return None;
    }
    let ids = match input.get("evidenceIds")? {
        Json::Array(items) => items,
        _ => return None,
    };
    let mut evidence_ids = Vec::new();
    for id in ids {
        let text = id.as_str()?;
        if text.is_empty() {
            return None;
        }
        evidence_ids.push(text.to_string());
    }
    Some(Some(Lexical {
        frontier: frontier.to_string(),
        evidence_ids,
    }))
}

fn string_list(input: &Json) -> Option<Vec<String>> {
    let items = match input {
        Json::Array(items) => items,
        _ => return None,
    };
    let mut out = Vec::new();
    for item in items {
        let text = item.as_str()?;
        if text.is_empty() || out.iter().any(|existing| existing == text) {
            return None;
        }
        out.push(text.to_string());
    }
    Some(out)
}

fn non_negative(input: &Json) -> Option<i64> {
    match input.as_int() {
        Some(value) if value >= 0 => Some(value),
        _ => None,
    }
}

pub fn only_keys(pairs: &[(String, Json)], allowed: &[&str]) -> bool {
    pairs
        .iter()
        .all(|(key, _)| allowed.iter().any(|name| name == key))
}

pub fn resolve_anchor(
    query: &str,
    node_ids: &[String],
    anchor: &AnchorSpec,
) -> (AnchorCommitment, bool) {
    match anchor {
        AnchorSpec::Recompute { procedure } => {
            let nodes = if procedure == "member-id-v1" {
                member_id_anchors(query, node_ids)
            } else {
                Vec::new()
            };
            (
                AnchorCommitment {
                    mode: Some("recompute".into()),
                    procedure: Some(procedure.clone()),
                    witness: None,
                    nodes,
                },
                false,
            )
        }
        AnchorSpec::Supplied { witness } => {
            let mut rows = witness.clone();
            rows.sort_by(|left, right| {
                let node_order = utf16_cmp(&left.node_id, &right.node_id);
                if node_order != std::cmp::Ordering::Equal {
                    return node_order;
                }
                utf16_cmp(
                    left.query_term.as_deref().unwrap_or(""),
                    right.query_term.as_deref().unwrap_or(""),
                )
            });
            let mut nodes = Vec::new();
            for row in &rows {
                if !nodes.iter().any(|id| id == &row.node_id) {
                    nodes.push(row.node_id.clone());
                }
            }
            nodes.sort_by(|left, right| utf16_cmp(left, right));
            let rejected = nodes
                .iter()
                .any(|id| !node_ids.iter().any(|node| node == id));
            (
                AnchorCommitment {
                    mode: Some("supplied".into()),
                    procedure: None,
                    witness: Some(rows),
                    nodes,
                },
                rejected,
            )
        }
    }
}

fn member_id_anchors(query: &str, node_ids: &[String]) -> Vec<String> {
    let mut found = Vec::new();
    for token in
        query.split(|ch: char| !(ch.is_ascii_alphanumeric() || ch == '_' || ch == ':' || ch == '-'))
    {
        if !token.is_empty()
            && node_ids.iter().any(|id| id == token)
            && !found.iter().any(|id| id == token)
        {
            found.push(token.to_string());
        }
    }
    found.sort_by(|left, right| utf16_cmp(left, right));
    found
}

pub fn anchor_root(commitment: &AnchorCommitment) -> String {
    digest_json(&commitment.to_json())
}

pub fn empty_frontiers() -> Vec<(String, Vec<String>)> {
    FRONTIERS
        .iter()
        .map(|frontier| ((*frontier).to_string(), Vec::new()))
        .collect()
}

pub fn frontier_list_mut<'a>(
    frontiers: &'a mut [(String, Vec<String>)],
    name: &str,
) -> Option<&'a mut Vec<String>> {
    frontiers
        .iter_mut()
        .find(|(frontier, _)| frontier == name)
        .map(|(_, ids)| ids)
}

pub fn frontiers_json(frontiers: &[(String, Vec<String>)]) -> Json {
    Json::Object(
        frontiers
            .iter()
            .map(|(frontier, ids)| {
                (
                    frontier.clone(),
                    Json::Array(ids.iter().cloned().map(Json::String).collect()),
                )
            })
            .collect(),
    )
}

pub fn lookup_requirement<'a>(plan: &'a Plan, frontier: &str) -> &'a [String] {
    plan.requirements
        .iter()
        .find(|(name, _)| name == frontier)
        .map(|(_, ids)| ids.as_slice())
        .unwrap_or(&[])
}

pub fn lookup_floor<'a>(plan: &'a Plan, frontier: &str) -> &'a str {
    plan.floors
        .iter()
        .find(|(name, _)| name == frontier)
        .map(|(_, floor)| floor.as_str())
        .unwrap_or("0")
}
