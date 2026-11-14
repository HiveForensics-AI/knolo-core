//! KITE certificate replay.
//! The world snapshot is the derivation input. This module does not search an image.
//! A passing replay means the certificate matches the declared rules and changes.

use crate::kar::json::{parse_json, Json};
use crate::{digest_domain, encode_cbor, CborValue};

#[derive(Debug, Clone, PartialEq)]
pub struct KiteDerivation {
    pub verdict: String,
    pub base_world: Option<String>,
    pub question: String,
    pub as_of: Option<String>,
    pub state_root: String,
    pub semantic_root: Option<String>,
    pub agrees: bool,
    pub witness: Option<Vec<String>>,
    pub worlds_checked: u64,
    pub variants_checked: u64,
    pub counterfactual_changes: u64,
    pub invariance_root: Option<String>,
    pub negative_collections: Vec<String>,
    pub obligation_ids: Vec<String>,
    pub source_partitions: Vec<String>,
    pub met: Vec<String>,
    pub unmet: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KiteVerification {
    pub ok: bool,
    pub code: String,
    pub message: String,
}

#[derive(Clone)]
struct Obligation {
    id: String,
    kind: String,
    met: bool,
    hit_ids: Vec<String>,
    sources: Vec<String>,
}

struct Change {
    id: String,
    kind: String,
    obligation_id: String,
}

struct Conflict {
    left: String,
    right: String,
}

struct CompletenessRule {
    id: String,
    collection: String,
    obligation_id: String,
}

struct Declaration {
    id: String,
    collection: String,
    signed: bool,
}

struct Rules {
    format: String,
    proposition: String,
    support: Vec<String>,
    oppose: Vec<String>,
    require: Vec<String>,
    conflicts: Vec<Conflict>,
    completeness: Vec<CompletenessRule>,
}

struct Bounds {
    max_graph_nodes: u64,
    max_variants: u64,
    max_counterfactual_changes: u64,
    max_retrievals: u64,
}

struct World {
    format: String,
    question: String,
    as_of: Option<String>,
    state_root: String,
    semantic_root: Option<String>,
    obligations: Vec<Obligation>,
    rules: Rules,
    declarations: Vec<Declaration>,
    changes: Vec<Change>,
    bounds: Bounds,
}

pub fn derive_kite_world(world_json: &str) -> Result<KiteDerivation, String> {
    let world = parse_world(&parse_json(world_json)?)?;
    Ok(derive_world(&world))
}

pub fn verify_kite_certificate(world_json: &str, certificate_json: &str) -> KiteVerification {
    let derived = match derive_kite_world(world_json) {
        Ok(value) => value,
        Err(message) => {
            return KiteVerification {
                ok: false,
                code: "KITE_CERTIFICATE_MISMATCH".into(),
                message,
            }
        }
    };
    let claimed = match parse_json(certificate_json).and_then(|value| parse_certificate(&value)) {
        Ok(value) => value,
        Err(message) => {
            return KiteVerification {
                ok: false,
                code: "KITE_CERTIFICATE_MISMATCH".into(),
                message,
            }
        }
    };
    if derived.verdict == "BOUND_EXCEEDED" || derived.invariance_root.is_none() {
        return KiteVerification {
            ok: false,
            code: "KITE_CERTIFICATE_MISMATCH".into(),
            message: "An unfinished search is not a certificate.".into(),
        };
    }
    if claimed != derived {
        return KiteVerification {
            ok: false,
            code: "KITE_CERTIFICATE_MISMATCH".into(),
            message: "Certificate does not match a fresh derivation.".into(),
        };
    }
    KiteVerification {
        ok: true,
        code: String::new(),
        message: String::new(),
    }
}

fn derive_world(world: &World) -> KiteDerivation {
    let mut obligation_ids: Vec<String> = world.obligations.iter().map(|item| item.id.clone()).collect();
    obligation_ids.sort();
    let mut source_partitions: Vec<String> = world
        .obligations
        .iter()
        .filter(|item| item.met)
        .flat_map(|item| item.sources.clone())
        .collect();
    source_partitions.sort();
    source_partitions.dedup();
    let mut negative_collections: Vec<String> = world
        .rules
        .completeness
        .iter()
        .map(|rule| rule.collection.clone())
        .collect();
    negative_collections.sort();
    negative_collections.dedup();
    let met = world
        .obligations
        .iter()
        .filter(|item| item.met)
        .map(|item| item.id.clone())
        .collect::<Vec<_>>();
    let unmet = world
        .obligations
        .iter()
        .filter(|item| !item.met)
        .map(|item| item.id.clone())
        .collect::<Vec<_>>();
    let count = match subset_count(world.changes.len() as u64, world.bounds.max_counterfactual_changes) {
        Ok(value) => value,
        Err(_) => {
            return empty_bound(
                obligation_ids,
                source_partitions,
                negative_collections,
                met,
                unmet,
            )
        }
    };
    if count > world.bounds.max_variants {
        return empty_bound(
            obligation_ids,
            source_partitions,
            negative_collections,
            met,
            unmet,
        );
    }
    let limit = world.bounds.max_counterfactual_changes.min(world.changes.len() as u64);
    let mut worlds = Vec::new();
    for size in 0..=limit {
        for subset in combinations(&world.changes, size as usize) {
            let met_now = apply(&world.obligations, &subset);
            worlds.push((
                subset.iter().map(|change| change.id.clone()).collect::<Vec<_>>(),
                label(world, &met_now),
            ));
        }
    }
    let base = worlds.first().map(|item| item.1.clone()).unwrap_or_else(|| "UNDERDETERMINED".into());
    let agrees = worlds.iter().all(|item| item.1 == base);
    let witness = worlds.iter().find(|item| item.1 != base).map(|item| item.0.clone());
    let verdict = scope_verdict(&base, agrees);
    KiteDerivation {
        verdict,
        base_world: Some(base),
        question: world.question.clone(),
        as_of: world.as_of.clone(),
        state_root: world.state_root.clone(),
        semantic_root: world.semantic_root.clone(),
        agrees,
        counterfactual_changes: witness.as_ref().map(|ids| ids.len() as u64).unwrap_or(0),
        witness,
        worlds_checked: worlds.len() as u64,
        variants_checked: worlds.len() as u64,
        invariance_root: Some(invariance_root(world)),
        negative_collections,
        obligation_ids,
        source_partitions,
        met,
        unmet,
    }
}

fn empty_bound(
    obligation_ids: Vec<String>,
    source_partitions: Vec<String>,
    negative_collections: Vec<String>,
    met: Vec<String>,
    unmet: Vec<String>,
) -> KiteDerivation {
    KiteDerivation {
        verdict: "BOUND_EXCEEDED".into(),
        base_world: None,
        question: String::new(),
        as_of: None,
        state_root: String::new(),
        semantic_root: None,
        agrees: false,
        witness: None,
        worlds_checked: 0,
        variants_checked: 0,
        counterfactual_changes: 0,
        invariance_root: None,
        negative_collections,
        obligation_ids,
        source_partitions,
        met,
        unmet,
    }
}

fn label(world: &World, met: &std::collections::HashSet<String>) -> String {
    let support = world.rules.support.iter().any(|id| met.contains(id));
    let oppose = world.rules.oppose.iter().any(|id| met.contains(id));
    let signed: std::collections::HashSet<&str> = world.declarations.iter().map(|item| item.id.as_str()).collect();
    let mut covered = std::collections::HashSet::new();
    for rule in &world.rules.completeness {
        if !met.contains(&rule.obligation_id) && signed.contains(rule.id.as_str()) {
            covered.insert(rule.obligation_id.clone());
        }
    }
    let open_require = world
        .rules
        .require
        .iter()
        .any(|id| !met.contains(id) && !covered.contains(id));
    if oppose && !support {
        return "REFUTED".into();
    }
    if open_require {
        return "UNDERDETERMINED".into();
    }
    let paired = world
        .rules
        .conflicts
        .iter()
        .any(|pair| met.contains(&pair.left) && met.contains(&pair.right));
    if (support && oppose) || paired {
        return "CONFLICTED".into();
    }
    let known_absent = world
        .rules
        .require
        .iter()
        .any(|id| !met.contains(id) && covered.contains(id));
    if known_absent {
        return "REFUTED".into();
    }
    let gap = world.rules.completeness.iter().any(|rule| !signed.contains(rule.id.as_str()));
    if support && gap {
        return "SUPPORTED_OPEN_WORLD".into();
    }
    if support {
        return "SUPPORTED_CLOSED".into();
    }
    "UNDERDETERMINED".into()
}

fn scope_verdict(base: &str, agrees: bool) -> String {
    if agrees && base == "SUPPORTED_CLOSED" {
        return "WARRANTED_IN_SCOPE".into();
    }
    if agrees && base == "REFUTED" {
        return "REFUTED_IN_SCOPE".into();
    }
    if !agrees && base == "SUPPORTED_CLOSED" {
        return "SUPPORTED_OPEN_WORLD".into();
    }
    if !agrees && base == "REFUTED" {
        return "UNDERDETERMINED".into();
    }
    match base {
        "SUPPORTED_CLOSED" => "WARRANTED_IN_SCOPE".into(),
        "REFUTED" => "REFUTED_IN_SCOPE".into(),
        other => other.to_string(),
    }
}

fn apply(obligations: &[Obligation], changes: &[&Change]) -> std::collections::HashSet<String> {
    let mut met: std::collections::HashSet<String> = obligations
        .iter()
        .filter(|item| item.met)
        .map(|item| item.id.clone())
        .collect();
    for change in changes {
        if change.kind == "retract" {
            met.remove(&change.obligation_id);
        } else {
            met.insert(change.obligation_id.clone());
        }
    }
    met
}

fn combinations(changes: &[Change], size: usize) -> Vec<Vec<&Change>> {
    let mut found = Vec::new();
    let mut current = Vec::new();
    fn walk<'a>(
        changes: &'a [Change],
        size: usize,
        start: usize,
        current: &mut Vec<&'a Change>,
        found: &mut Vec<Vec<&'a Change>>,
    ) {
        if current.len() == size {
            found.push(current.clone());
            return;
        }
        for index in start..changes.len() {
            current.push(&changes[index]);
            walk(changes, size, index + 1, current, found);
            current.pop();
        }
    }
    if size == 0 {
        return vec![Vec::new()];
    }
    walk(changes, size, 0, &mut current, &mut found);
    found
}

fn subset_count(change_count: u64, max_changes: u64) -> Result<u64, String> {
    let limit = max_changes.min(change_count);
    let mut total: u64 = 0;
    for size in 0..=limit {
        total = total
            .checked_add(binomial(change_count, size)?)
            .ok_or_else(|| "variant count overflow".to_string())?;
    }
    Ok(total)
}

fn binomial(n: u64, k: u64) -> Result<u64, String> {
    if k > n {
        return Ok(0);
    }
    let mut result: u128 = 1;
    for index in 1..=k {
        let next = result
            .checked_mul((n - k + index) as u128)
            .ok_or_else(|| "variant count overflow".to_string())?;
        if next % index as u128 != 0 {
            return Err("variant count is not an integer".into());
        }
        result = next / index as u128;
    }
    u64::try_from(result).map_err(|_| "variant count overflow".to_string())
}

fn invariance_root(world: &World) -> String {
    digest_domain("kite-invariance", &encode_cbor(&invariance_value(world)))
}

fn invariance_value(world: &World) -> CborValue {
    let mut obligations = world.obligations.clone();
    obligations.sort_by(|left, right| left.id.cmp(&right.id));
    CborValue::Map(vec![
        ("asOf".into(), optional_text(&world.as_of)),
        (
            "bounds".into(),
            CborValue::Map(vec![
                ("maxCounterfactualChanges".into(), CborValue::UInt(world.bounds.max_counterfactual_changes)),
                ("maxGraphNodes".into(), CborValue::UInt(world.bounds.max_graph_nodes)),
                ("maxRetrievals".into(), CborValue::UInt(world.bounds.max_retrievals)),
                ("maxVariants".into(), CborValue::UInt(world.bounds.max_variants)),
            ]),
        ),
        (
            "changes".into(),
            CborValue::Array(
                world
                    .changes
                    .iter()
                    .map(|change| {
                        CborValue::Map(vec![
                            ("id".into(), CborValue::Text(change.id.clone())),
                            ("kind".into(), CborValue::Text(change.kind.clone())),
                            ("obligationId".into(), CborValue::Text(change.obligation_id.clone())),
                        ])
                    })
                    .collect(),
            ),
        ),
        (
            "completeness".into(),
            CborValue::Array(
                world
                    .declarations
                    .iter()
                    .map(|item| {
                        CborValue::Map(vec![
                            ("collection".into(), CborValue::Text(item.collection.clone())),
                            ("id".into(), CborValue::Text(item.id.clone())),
                            ("signed".into(), CborValue::Bool(item.signed)),
                        ])
                    })
                    .collect(),
            ),
        ),
        ("format".into(), CborValue::Text(world.format.clone())),
        (
            "obligations".into(),
            CborValue::Array(
                obligations
                    .iter()
                    .map(|item| {
                        let mut sources = item.sources.clone();
                        sources.sort();
                        CborValue::Map(vec![
                            ("hitIds".into(), text_array(&item.hit_ids)),
                            ("id".into(), CborValue::Text(item.id.clone())),
                            ("kind".into(), CborValue::Text(item.kind.clone())),
                            ("met".into(), CborValue::Bool(item.met)),
                            ("sources".into(), text_array(&sources)),
                        ])
                    })
                    .collect(),
            ),
        ),
        ("question".into(), CborValue::Text(world.question.clone())),
        (
            "rules".into(),
            CborValue::Map(vec![
                (
                    "completeness".into(),
                    CborValue::Array(
                        world
                            .rules
                            .completeness
                            .iter()
                            .map(|rule| {
                                CborValue::Map(vec![
                                    ("collection".into(), CborValue::Text(rule.collection.clone())),
                                    ("id".into(), CborValue::Text(rule.id.clone())),
                                    ("obligationId".into(), CborValue::Text(rule.obligation_id.clone())),
                                ])
                            })
                            .collect(),
                    ),
                ),
                (
                    "conflicts".into(),
                    CborValue::Array(
                        world
                            .rules
                            .conflicts
                            .iter()
                            .map(|pair| {
                                CborValue::Map(vec![
                                    ("left".into(), CborValue::Text(pair.left.clone())),
                                    ("right".into(), CborValue::Text(pair.right.clone())),
                                ])
                            })
                            .collect(),
                    ),
                ),
                ("format".into(), CborValue::Text(world.rules.format.clone())),
                ("oppose".into(), text_array(&world.rules.oppose)),
                ("proposition".into(), CborValue::Text(world.rules.proposition.clone())),
                ("require".into(), text_array(&world.rules.require)),
                ("support".into(), text_array(&world.rules.support)),
            ]),
        ),
        ("semanticRoot".into(), optional_text(&world.semantic_root)),
        ("stateRoot".into(), CborValue::Text(world.state_root.clone())),
    ])
}

fn text_array(values: &[String]) -> CborValue {
    CborValue::Array(values.iter().cloned().map(CborValue::Text).collect())
}

fn optional_text(value: &Option<String>) -> CborValue {
    match value {
        Some(text) => CborValue::Text(text.clone()),
        None => CborValue::Null,
    }
}

fn parse_world(value: &Json) -> Result<World, String> {
    expect_keys(
        value,
        &[
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
    )?;
    if text(value, "format")? != "knolo-kite-world-1" {
        return Err("world format is not knolo-kite-world-1".into());
    }
    let bounds_json = get(value, "bounds")?;
    expect_keys(
        bounds_json,
        &[
            "maxCounterfactualChanges",
            "maxGraphNodes",
            "maxRetrievals",
            "maxVariants",
        ],
    )?;
    let rules_json = get(value, "rules")?;
    expect_keys(
        rules_json,
        &[
            "completeness",
            "conflicts",
            "format",
            "oppose",
            "proposition",
            "require",
            "support",
        ],
    )?;
    let completeness_json = get(value, "completeness")?;
    expect_keys(completeness_json, &["declarations", "format"])?;
    Ok(World {
        format: text(value, "format")?,
        question: text(value, "question")?,
        as_of: optional_text_json(get(value, "asOf")?)?,
        state_root: text(value, "stateRoot")?,
        semantic_root: optional_text_json(get(value, "semanticRoot")?)?,
        obligations: array(get(value, "obligations")?)?
            .iter()
            .map(parse_obligation)
            .collect::<Result<Vec<_>, _>>()?,
        rules: Rules {
            format: text(rules_json, "format")?,
            proposition: text(rules_json, "proposition")?,
            support: string_array(get(rules_json, "support")?)?,
            oppose: string_array(get(rules_json, "oppose")?)?,
            require: string_array(get(rules_json, "require")?)?,
            conflicts: array(get(rules_json, "conflicts")?)?
                .iter()
                .map(|pair| {
                    expect_keys(pair, &["left", "right"])?;
                    Ok(Conflict {
                        left: text(pair, "left")?,
                        right: text(pair, "right")?,
                    })
                })
                .collect::<Result<Vec<_>, String>>()?,
            completeness: array(get(rules_json, "completeness")?)?
                .iter()
                .map(|rule| {
                    expect_keys(rule, &["collection", "id", "obligationId"])?;
                    Ok(CompletenessRule {
                        id: text(rule, "id")?,
                        collection: text(rule, "collection")?,
                        obligation_id: text(rule, "obligationId")?,
                    })
                })
                .collect::<Result<Vec<_>, String>>()?,
        },
        declarations: array(get(completeness_json, "declarations")?)?
            .iter()
            .map(|item| {
                expect_keys(item, &["collection", "id", "signed"])?;
                Ok(Declaration {
                    id: text(item, "id")?,
                    collection: text(item, "collection")?,
                    signed: boolean(item, "signed")?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?,
        changes: array(get(value, "changes")?)?
            .iter()
            .map(|change| {
                expect_keys(change, &["id", "kind", "obligationId"])?;
                Ok(Change {
                    id: text(change, "id")?,
                    kind: text(change, "kind")?,
                    obligation_id: text(change, "obligationId")?,
                })
            })
            .collect::<Result<Vec<_>, String>>()?,
        bounds: Bounds {
            max_graph_nodes: integer(bounds_json, "maxGraphNodes")?,
            max_variants: integer(bounds_json, "maxVariants")?,
            max_counterfactual_changes: integer(bounds_json, "maxCounterfactualChanges")?,
            max_retrievals: integer(bounds_json, "maxRetrievals")?,
        },
    })
}

fn parse_obligation(value: &Json) -> Result<Obligation, String> {
    expect_keys(value, &["hitIds", "id", "kind", "met", "sources"])?;
    Ok(Obligation {
        id: text(value, "id")?,
        kind: text(value, "kind")?,
        met: boolean(value, "met")?,
        hit_ids: string_array(get(value, "hitIds")?)?,
        sources: string_array(get(value, "sources")?)?,
    })
}

fn parse_certificate(value: &Json) -> Result<KiteDerivation, String> {
    expect_keys(
        value,
        &[
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
    )?;
    if text(value, "format")? != "knolo-kite-certificate-1" {
        return Err("certificate format is not knolo-kite-certificate-1".into());
    }
    let verdict = text(value, "verdict")?;
    if verdict == "BOUND_EXCEEDED" {
        return Err("An unfinished search is not a certificate.".into());
    }
    Ok(KiteDerivation {
        verdict,
        base_world: Some(text(value, "baseWorld")?),
        question: text(value, "question")?,
        as_of: optional_text_json(get(value, "asOf")?)?,
        state_root: text(value, "stateRoot")?,
        semantic_root: optional_text_json(get(value, "semanticRoot")?)?,
        agrees: boolean(value, "agrees")?,
        witness: optional_string_array(get(value, "witness")?)?,
        worlds_checked: integer(value, "worldsChecked")?,
        variants_checked: integer(value, "variantsChecked")?,
        counterfactual_changes: integer(value, "counterfactualChanges")?,
        invariance_root: Some(text(value, "invarianceRoot")?),
        negative_collections: string_array(get(value, "negativeCollections")?)?,
        obligation_ids: string_array(get(value, "obligationIds")?)?,
        source_partitions: string_array(get(value, "sourcePartitions")?)?,
        met: string_array(get(value, "met")?)?,
        unmet: string_array(get(value, "unmet")?)?,
    })
}

fn expect_keys(value: &Json, expected: &[&str]) -> Result<(), String> {
    let mut keys = value
        .as_object()
        .ok_or_else(|| "expected an object".to_string())?
        .iter()
        .map(|(key, _)| key.as_str())
        .collect::<Vec<_>>();
    keys.sort();
    let actual = keys.join(",");
    let wanted = expected.join(",");
    if actual != wanted {
        return Err(format!("fields must be {wanted}"));
    }
    Ok(())
}

fn get<'a>(value: &'a Json, key: &str) -> Result<&'a Json, String> {
    value.get(key).ok_or_else(|| format!("missing {key}"))
}

fn text(value: &Json, key: &str) -> Result<String, String> {
    get(value, key)?
        .as_str()
        .map(ToString::to_string)
        .ok_or_else(|| format!("{key} must be a string"))
}

fn boolean(value: &Json, key: &str) -> Result<bool, String> {
    match get(value, key)? {
        Json::Bool(item) => Ok(*item),
        _ => Err(format!("{key} must be a boolean")),
    }
}

fn integer(value: &Json, key: &str) -> Result<u64, String> {
    let number = get(value, key)?.as_int().ok_or_else(|| format!("{key} must be an integer"))?;
    u64::try_from(number).map_err(|_| format!("{key} must be unsigned"))
}

fn optional_text_json(value: &Json) -> Result<Option<String>, String> {
    match value {
        Json::Null => Ok(None),
        Json::String(text) => Ok(Some(text.clone())),
        _ => Err("expected a string or null".into()),
    }
}

fn array(value: &Json) -> Result<&[Json], String> {
    match value {
        Json::Array(items) => Ok(items),
        _ => Err("expected an array".into()),
    }
}

fn string_array(value: &Json) -> Result<Vec<String>, String> {
    array(value)?
        .iter()
        .map(|item| item.as_str().map(ToString::to_string).ok_or_else(|| "expected a string".to_string()))
        .collect()
}

fn optional_string_array(value: &Json) -> Result<Option<Vec<String>>, String> {
    if matches!(value, Json::Null) {
        return Ok(None);
    }
    Ok(Some(string_array(value)?))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn typescript_fixtures_replay() {
        let text = include_str!("../../tests/fixtures/kite-v1/cases.json");
        let parsed = parse_json(text).expect("fixtures");
        assert_eq!(parsed.get("format").and_then(Json::as_str), Some("kite-replay-v1"));
        let cases = match parsed.get("cases") {
            Some(Json::Array(items)) => items,
            _ => panic!("cases"),
        };
        assert!(cases.len() >= 8);
        for case in cases {
            let id = case.get("id").and_then(Json::as_str).unwrap();
            let world = case.get("world").unwrap();
            let world_text = crate::kar::json::stringify(world);
            let derived = derive_kite_world(&world_text).unwrap_or_else(|error| panic!("{id} {error}"));
            let expected = case.get("expected").unwrap();
            assert_eq!(derived.verdict, text_of(expected, "verdict"), "{id} verdict");
            assert_eq!(derived.base_world.as_deref(), expected.get("baseWorld").and_then(Json::as_str), "{id} base");
            assert_eq!(derived.agrees, bool_of(expected, "agrees"), "{id} agrees");
            assert_eq!(derived.worlds_checked, int_of(expected, "worldsChecked"), "{id} worlds");
            assert_eq!(derived.invariance_root.as_deref(), expected.get("invarianceRoot").and_then(Json::as_str), "{id} root");
            assert_eq!(derived.obligation_ids, strings_of(expected, "obligationIds"), "{id} obligations");
            assert_eq!(derived.met, strings_of(expected, "met"), "{id} met");
            assert_eq!(derived.unmet, strings_of(expected, "unmet"), "{id} unmet");
            assert_eq!(derived.source_partitions, strings_of(expected, "sourcePartitions"), "{id} sources");
            if derived.verdict == "BOUND_EXCEEDED" {
                let rejected = verify_kite_certificate(&world_text, "{\"format\":\"knolo-kite-certificate-1\"}");
                assert!(!rejected.ok, "{id} certified an unfinished search");
                continue;
            }
            let certificate = certificate_json(world, &derived);
            let verified = verify_kite_certificate(&world_text, &certificate);
            assert!(verified.ok, "{id} {}", verified.message);
            let tampered = certificate.replacen(
                &format!("\"verdict\":\"{}\"", derived.verdict),
                "\"verdict\":\"WARRANTED_IN_SCOPE\"",
                1,
            );
            if derived.verdict != "WARRANTED_IN_SCOPE" {
                let rejected = verify_kite_certificate(&world_text, &tampered);
                assert!(!rejected.ok, "{id} accepted a tampered verdict");
            }
        }
    }

    fn certificate_json(world: &Json, derived: &KiteDerivation) -> String {
        format!(
            "{{\"agrees\":{},\"asOf\":{},\"baseWorld\":{},\"counterfactualChanges\":{},\"format\":\"knolo-kite-certificate-1\",\"invarianceRoot\":{},\"met\":{},\"negativeCollections\":{},\"obligationIds\":{},\"question\":{},\"semanticRoot\":{},\"sourcePartitions\":{},\"stateRoot\":{},\"unmet\":{},\"variantsChecked\":{},\"verdict\":{},\"witness\":{},\"worldsChecked\":{}}}",
            derived.agrees,
            json_optional(derived.as_of.as_deref()),
            json_string(derived.base_world.as_deref().unwrap()),
            derived.counterfactual_changes,
            json_string(derived.invariance_root.as_deref().unwrap()),
            json_strings(&derived.met),
            json_strings(&derived.negative_collections),
            json_strings(&derived.obligation_ids),
            json_string(&derived.question),
            json_optional(world.get("semanticRoot").and_then(Json::as_str)),
            json_strings(&derived.source_partitions),
            json_string(&derived.state_root),
            json_strings(&derived.unmet),
            derived.variants_checked,
            json_string(&derived.verdict),
            match &derived.witness {
                Some(ids) => json_strings(ids),
                None => "null".to_string(),
            },
            derived.worlds_checked,
        )
    }

    fn json_string(value: &str) -> String {
        format!("\"{value}\"")
    }

    fn json_optional(value: Option<&str>) -> String {
        match value {
            Some(text) => json_string(text),
            None => "null".into(),
        }
    }

    fn json_strings(values: &[String]) -> String {
        format!(
            "[{}]",
            values.iter().map(|value| json_string(value)).collect::<Vec<_>>().join(",")
        )
    }

    fn text_of(value: &Json, key: &str) -> String {
        value.get(key).and_then(Json::as_str).unwrap().to_string()
    }

    fn bool_of(value: &Json, key: &str) -> bool {
        match value.get(key) {
            Some(Json::Bool(item)) => *item,
            _ => panic!("{key}"),
        }
    }

    fn int_of(value: &Json, key: &str) -> u64 {
        u64::try_from(value.get(key).and_then(Json::as_int).unwrap()).unwrap()
    }

    fn strings_of(value: &Json, key: &str) -> Vec<String> {
        match value.get(key) {
            Some(Json::Array(items)) => items.iter().map(|item| item.as_str().unwrap().to_string()).collect(),
            _ => panic!("{key}"),
        }
    }
}
