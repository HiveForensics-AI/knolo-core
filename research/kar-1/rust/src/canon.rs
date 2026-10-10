use serde_json::{Map, Number, Value};
use sha2::{Digest, Sha256};

pub fn digest(value: &Value) -> String {
    let bytes = canonicalize(value).into_bytes();
    let hash = Sha256::digest(bytes);
    let mut hex = String::with_capacity(hash.len() * 2);
    for byte in hash {
        hex.push(HEX[(byte >> 4) as usize] as char);
        hex.push(HEX[(byte & 0x0f) as usize] as char);
    }
    format!("sha256-{hex}")
}

const HEX: &[u8; 16] = b"0123456789abcdef";

pub fn canonicalize(value: &Value) -> String {
    match value {
        Value::Null => "null".to_string(),
        Value::Bool(true) => "true".to_string(),
        Value::Bool(false) => "false".to_string(),
        Value::Number(number) => canon_number(number),
        Value::String(text) => canon_string(text),
        Value::Array(items) => {
            let body = items.iter().map(canonicalize).collect::<Vec<_>>().join(",");
            format!("[{body}]")
        }
        Value::Object(map) => {
            let mut keys: Vec<&String> = map.keys().collect();
            keys.sort_by(|left, right| utf16(left).cmp(&utf16(right)));
            let body = keys
                .into_iter()
                .map(|key| format!("{}:{}", canon_string(key), canonicalize(&map[key])))
                .collect::<Vec<_>>()
                .join(",");
            format!("{{{body}}}")
        }
    }
}

fn canon_number(number: &Number) -> String {
    if let Some(value) = number.as_i64() {
        return value.to_string();
    }
    if let Some(value) = number.as_u64() {
        return value.to_string();
    }
    if let Some(value) = number.as_f64() {
        if value.fract() == 0.0 && value.abs() < i64::MAX as f64 {
            return (value as i64).to_string();
        }
    }
    number.to_string()
}

fn canon_string(text: &str) -> String {
    let mut out = String::from("\"");
    for ch in text.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            '\u{2028}' => out.push_str("\\u2028"),
            '\u{2029}' => out.push_str("\\u2029"),
            c if (c as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", c as u32)),
            c => out.push(c),
        }
    }
    out.push('"');
    out
}

fn utf16(text: &str) -> Vec<u16> {
    text.encode_utf16().collect()
}

pub fn obj(entries: Vec<(&str, Value)>) -> Value {
    let mut map = Map::new();
    for (key, value) in entries {
        map.insert(key.to_string(), value);
    }
    Value::Object(map)
}

pub fn string_array(items: &[String]) -> Value {
    Value::Array(items.iter().cloned().map(Value::String).collect())
}
