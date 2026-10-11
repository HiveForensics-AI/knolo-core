use kar1_research::evaluate;
use serde_json::Value;

fn canon(value: &Value) -> String {
    // Compare through serde after sorting by re-parsing the verifier's own digest preimage
    // is unnecessary: both sides are canonicalized by the library function via Debug equality
    // of semantically sorted JSON. Use the public digest only as a sanity check and compare
    // the JSON values with a local canonicalizer duplicated from the crate contract.
    canonical(value)
}

fn canonical(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(true) => "true".to_string(),
        Value::Bool(false) => "false".to_string(),
        Value::Number(number) => {
            if let Some(integer) = number.as_i64() {
                integer.to_string()
            } else if let Some(integer) = number.as_u64() {
                integer.to_string()
            } else {
                number.to_string()
            }
        }
        Value::String(text) => serde_json::to_string(text).unwrap(),
        Value::Array(items) => {
            let body = items.iter().map(canonical).collect::<Vec<_>>().join(",");
            format!("[{body}]")
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort();
            let body = keys
                .into_iter()
                .map(|key| format!("{}:{}", serde_json::to_string(key).unwrap(), canonical(&map[key])))
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{body}}}")
        }
    }
}

#[test]
fn verifier_matches_typescript_vectors() {
    let path = concat!(env!("CARGO_MANIFEST_DIR"), "/../fixtures/expected.json");
    let cases: Vec<Value> = serde_json::from_str(&std::fs::read_to_string(path).unwrap()).unwrap();
    assert!(cases.len() >= 12);
    for case in cases {
        let actual = evaluate(&case["image"], &case["graph"], &case["query"], &case["plan"]);
        let name = case["name"].as_str().unwrap();
        for key in ["status", "evidenceIds", "choices", "frontiers", "witnesses", "decision", "roots"] {
            let left = canon(&actual[key]);
            let right = canon(&case[key]);
            assert_eq!(left, right, "{name} field {key}\nactual {left}\nexpect {right}");
        }
    }
}
