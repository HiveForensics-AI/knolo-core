use kar1_research::evaluate;
use serde_json::Value;
use std::fs;

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
fn integration_fixtures_match_typescript() {
    let dir = concat!(env!("CARGO_MANIFEST_DIR"), "/../integration/fixtures/normalized");
    let mut paths: Vec<_> = fs::read_dir(dir)
        .unwrap_or_else(|error| panic!("normalized fixtures missing at {dir}: {error}"))
        .map(|entry| entry.unwrap().path())
        .filter(|path| path.extension().and_then(|ext| ext.to_str()) == Some("json"))
        .collect();
    paths.sort();
    assert!(paths.len() >= 12, "expected the five V5 scenarios to produce at least 12 normalized cases");
    for path in paths {
        let case: Value = serde_json::from_str(&fs::read_to_string(&path).unwrap()).unwrap();
        let actual = evaluate(&case["image"], &case["graph"], &case["query"], &case["plan"]);
        let name = case["name"].as_str().unwrap();
        for key in ["status", "evidenceIds", "choices", "frontiers", "witnesses", "decision", "roots"] {
            let left = canonical(&actual[key]);
            let right = canonical(&case[key]);
            assert_eq!(left, right, "{name} field {key}\nactual {left}\nexpect {right}");
        }
    }
}
