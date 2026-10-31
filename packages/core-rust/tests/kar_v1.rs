//! Public KAR v1 vectors on the native V5 evaluator.
//! Fixtures come from tests/emit-kar-fixtures.mjs. This file does not shell the TypeScript runner.

use std::fs;
use std::path::PathBuf;

use knolo_core_rust::{
    create_kar_dossier_v5, evaluate_kar_v5, verify_kar_dossier_v5, verify_kar_v5,
};

#[test]
fn public_kar_v1_vectors_match() {
    let root = PathBuf::from(env!("CARGO_MANIFEST_DIR"));
    let fixture_dir = root.join("tests/fixtures/kar-v1");
    let manifest_text =
        fs::read_to_string(fixture_dir.join("cases.json")).expect("KAR v1 fixtures");
    let expected_text = fs::read_to_string(root.join("../../conformance/kar/v1/expected.json"))
        .expect("expected.json");
    let manifest = parse_json(&manifest_text);
    let expected = parse_json(&expected_text);
    assert!(manifest.as_object().is_some());
    assert!(expected.as_object().is_some());
    assert_eq!(
        expected.get("format").and_then(Json::as_str),
        Some("kar-conformance-v1")
    );
    let cases = json_array(manifest.get("cases").expect("cases"));
    let vectors = json_array(expected.get("vectors").expect("vectors"));
    assert_eq!(
        cases.len() + 2,
        vectors.len(),
        "Rust fixtures cover the ten evaluations; tamper vectors are derived"
    );

    let mut actual = Vec::new();
    let mut support = None;
    for case in cases {
        let id = case.get("id").and_then(Json::as_str).unwrap();
        let image = decode_hex(case.get("imageHex").and_then(Json::as_str).unwrap_or_else(|| panic!("{id} image")));
        let sidecar = stringify(case.get("sidecar").unwrap());
        let plan = stringify(case.get("plan").unwrap());
        let proposition = case.get("proposition").and_then(Json::as_str).unwrap();
        let evaluation = evaluate_kar_v5(&image, &sidecar, proposition, &plan)
            .unwrap_or_else(|error| panic!("{id} {}", error.message));
        let again = evaluate_kar_v5(&image, &sidecar, proposition, &plan).unwrap();
        assert_eq!(
            evaluation.json, again.json,
            "{id} certificate was not reproducible"
        );
        let verdict = verify_kar_v5(&image, &sidecar, proposition, &plan, &evaluation.json);
        assert!(
            verdict.ok,
            "{id} verify {} {}",
            verdict.code, verdict.reason
        );
        let frontier = case.get("frontier").and_then(Json::as_str);
        let frontier_count = frontier
            .and_then(|name| {
                evaluation
                    .frontiers
                    .iter()
                    .find(|(label, _)| label == name)
                    .map(|(_, ids)| ids.len())
            })
            .unwrap_or(0);
        let mut record = vec![
            ("id", Json::String(id.to_string())),
            ("status", Json::String(evaluation.status.clone())),
            (
                "code",
                evaluation
                    .code
                    .clone()
                    .map(Json::String)
                    .unwrap_or(Json::Null),
            ),
            ("verified", Json::Bool(true)),
        ];
        if let Some(frontier) = frontier {
            record.push(("frontier", Json::String(frontier.to_string())));
        }
        record.extend([
            ("frontierCount", Json::Int(frontier_count as i64)),
            ("selected", Json::Int(evaluation.selected_len as i64)),
            ("karRoot", Json::String(evaluation.kar_root.clone())),
            (
                "knowledgeRoot",
                Json::String(evaluation.knowledge_root.clone()),
            ),
            (
                "semanticRoot",
                Json::String(evaluation.semantic_root.clone()),
            ),
            (
                "anchorMode",
                Json::String(evaluation.anchor_mode.clone().unwrap_or_default()),
            ),
        ]);
        actual.push(Json::Object(
            record
                .into_iter()
                .map(|(key, value)| (key.to_string(), value))
                .collect(),
        ));
        if id == "support" {
            support = Some((image, sidecar, plan, proposition.to_string(), evaluation));
        }
    }

    let (image, sidecar, plan, proposition, evaluation) = support.expect("support fixture");
    let tampered = tamper_kar_root(&evaluation.json);
    let tamper = verify_kar_v5(&image, &sidecar, &proposition, &plan, &tampered);
    actual.push(object(vec![
        ("id", Json::String("tamper-rejection".into())),
        ("status", Json::String(evaluation.status.clone())),
        ("verifyOk", Json::Bool(tamper.ok)),
        (
            "verifyCode",
            if tamper.ok {
                Json::Null
            } else {
                Json::String(tamper.code.clone())
            },
        ),
        ("karRoot", Json::String(evaluation.kar_root.clone())),
    ]));

    let dossier = create_kar_dossier_v5(&image, &sidecar, &proposition, &plan).unwrap();
    let dossier_again = create_kar_dossier_v5(&image, &sidecar, &proposition, &plan).unwrap();
    assert_eq!(
        dossier.manifest_json, dossier_again.manifest_json,
        "dossier manifest was not reproducible"
    );
    assert_eq!(
        dossier.markdown, dossier_again.markdown,
        "dossier rendering was not reproducible"
    );
    let honest = verify_kar_dossier_v5(
        &image,
        &sidecar,
        &proposition,
        &plan,
        &dossier.manifest_json,
        &dossier.certificate_json,
        &dossier.evaluation_json,
        Some(&dossier.markdown),
    );
    assert!(honest.ok, "dossier {} {}", honest.code, honest.reason);
    let tampered_markdown = dossier
        .markdown
        .replace("Evidence requirements satisfied", "Claim proven");
    let markdown = verify_kar_dossier_v5(
        &image,
        &sidecar,
        &proposition,
        &plan,
        &dossier.manifest_json,
        &dossier.certificate_json,
        &dossier.evaluation_json,
        Some(&tampered_markdown),
    );
    actual.push(object(vec![
        ("id", Json::String("dossier-language-tamper".into())),
        (
            "statusStatement",
            Json::String(dossier.status_statement.clone()),
        ),
        ("verifyOk", Json::Bool(markdown.ok)),
        (
            "verifyCode",
            if markdown.ok {
                Json::Null
            } else {
                Json::String(markdown.code)
            },
        ),
    ]));

    assert_eq!(actual.len(), vectors.len());
    for (index, (left, right)) in vectors.iter().zip(actual.iter()).enumerate() {
        assert_eq!(
            canonicalize(left),
            canonicalize(right),
            "vector {index} {}",
            left.get("id").and_then(Json::as_str).unwrap_or("")
        );
    }
}

fn decode_hex(text: &str) -> Vec<u8> {
    assert!(text.len() % 2 == 0, "image hex length");
    (0..text.len()).step_by(2).map(|index| u8::from_str_radix(&text[index..index + 2], 16).expect("image hex")).collect()
}

fn tamper_kar_root(evaluation_json: &str) -> String {
    let mut value = parse_json(evaluation_json);
    let root = value
        .get_mut("certificate")
        .unwrap()
        .get_mut("roots")
        .unwrap()
        .get_mut("karRoot")
        .unwrap();
    let Json::String(text) = root else {
        panic!("karRoot")
    };
    let mut chars: Vec<char> = text.chars().collect();
    let last = chars.len() - 1;
    chars[last] = if chars[last] == '0' { '1' } else { '0' };
    *text = chars.into_iter().collect();
    stringify(&value)
}

fn object(pairs: Vec<(&str, Json)>) -> Json {
    Json::Object(
        pairs
            .into_iter()
            .map(|(key, value)| (key.to_string(), value))
            .collect(),
    )
}

fn json_array(value: &Json) -> &[Json] {
    match value {
        Json::Array(items) => items,
        _ => panic!("expected array"),
    }
}

#[derive(Clone)]
enum Json {
    Null,
    Bool(bool),
    Int(i64),
    String(String),
    Array(Vec<Json>),
    Object(Vec<(String, Json)>),
}

impl Json {
    fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(pairs) => pairs
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value),
            _ => None,
        }
    }

    fn get_mut(&mut self, key: &str) -> Option<&mut Json> {
        match self {
            Json::Object(pairs) => pairs
                .iter_mut()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value),
            _ => None,
        }
    }

    fn as_object(&self) -> Option<&[(String, Json)]> {
        match self {
            Json::Object(pairs) => Some(pairs),
            _ => None,
        }
    }

    fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(value) => Some(value),
            _ => None,
        }
    }
}

fn parse_json(input: &str) -> Json {
    let mut parser = Parser { input, index: 0 };
    parser.skip();
    let value = parser.value();
    parser.skip();
    assert_eq!(parser.index, parser.input.len(), "trailing JSON");
    value
}

fn canonicalize(value: &Json) -> String {
    let mut out = String::new();
    write_canonical(value, &mut out);
    out
}

fn stringify(value: &Json) -> String {
    let mut out = String::new();
    write_insert(value, &mut out);
    out
}

struct Parser<'a> {
    input: &'a str,
    index: usize,
}

impl<'a> Parser<'a> {
    fn skip(&mut self) {
        while matches!(
            self.input.as_bytes().get(self.index),
            Some(b' ' | b'\n' | b'\r' | b'\t')
        ) {
            self.index += 1;
        }
    }

    fn value(&mut self) -> Json {
        self.skip();
        match self.input.as_bytes()[self.index] {
            b'n' => self.literal("null", Json::Null),
            b't' => self.literal("true", Json::Bool(true)),
            b'f' => self.literal("false", Json::Bool(false)),
            b'"' => Json::String(self.string()),
            b'[' => self.array(),
            b'{' => self.object(),
            b'-' | b'0'..=b'9' => self.number(),
            _ => panic!("invalid JSON"),
        }
    }

    fn literal(&mut self, text: &str, value: Json) -> Json {
        assert!(self.input[self.index..].starts_with(text));
        self.index += text.len();
        value
    }

    fn array(&mut self) -> Json {
        self.index += 1;
        let mut items = Vec::new();
        self.skip();
        if self.eat(b']') {
            return Json::Array(items);
        }
        loop {
            items.push(self.value());
            self.skip();
            if self.eat(b']') {
                return Json::Array(items);
            }
            assert!(self.eat(b','));
        }
    }

    fn object(&mut self) -> Json {
        self.index += 1;
        let mut pairs = Vec::new();
        self.skip();
        if self.eat(b'}') {
            return Json::Object(pairs);
        }
        loop {
            self.skip();
            assert!(self.eat(b'"'));
            let key = self.string_body();
            self.skip();
            assert!(self.eat(b':'));
            pairs.push((key, self.value()));
            self.skip();
            if self.eat(b'}') {
                return Json::Object(pairs);
            }
            assert!(self.eat(b','));
        }
    }

    fn number(&mut self) -> Json {
        let start = self.index;
        if self.eat(b'-') {}
        if self.eat(b'0') {
        } else {
            while self
                .input
                .as_bytes()
                .get(self.index)
                .is_some_and(|byte| byte.is_ascii_digit())
            {
                self.index += 1;
            }
        }
        while matches!(
            self.input.as_bytes().get(self.index),
            Some(b'.' | b'e' | b'E' | b'+' | b'-') | Some(b'0'..=b'9')
        ) {
            if self.input.as_bytes()[self.index].is_ascii_digit()
                || matches!(
                    self.input.as_bytes()[self.index],
                    b'.' | b'e' | b'E' | b'+' | b'-'
                )
            {
                self.index += 1;
                continue;
            }
            break;
        }
        Json::Int(self.input[start..self.index].parse().unwrap())
    }

    fn string(&mut self) -> String {
        assert!(self.eat(b'"'));
        self.string_body()
    }

    fn string_body(&mut self) -> String {
        let mut out = String::new();
        loop {
            let byte = self.input.as_bytes()[self.index];
            if byte == b'"' {
                self.index += 1;
                return out;
            }
            if byte == b'\\' {
                self.index += 1;
                let escape = self.input.as_bytes()[self.index];
                self.index += 1;
                match escape {
                    b'"' => out.push('"'),
                    b'\\' => out.push('\\'),
                    b'/' => out.push('/'),
                    b'n' => out.push('\n'),
                    b'r' => out.push('\r'),
                    b't' => out.push('\t'),
                    b'u' => {
                        let hex = &self.input[self.index..self.index + 4];
                        self.index += 4;
                        out.push(char::from_u32(u32::from_str_radix(hex, 16).unwrap()).unwrap());
                    }
                    other => panic!("escape {other}"),
                }
                continue;
            }
            let ch = self.input[self.index..].chars().next().unwrap();
            self.index += ch.len_utf8();
            out.push(ch);
        }
    }

    fn eat(&mut self, byte: u8) -> bool {
        if self.input.as_bytes().get(self.index) == Some(&byte) {
            self.index += 1;
            true
        } else {
            false
        }
    }
}

fn write_canonical(value: &Json, out: &mut String) {
    match value {
        Json::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_canonical(item, out);
            }
            out.push(']');
        }
        Json::Object(pairs) => {
            let mut keys: Vec<&(String, Json)> = pairs.iter().collect();
            keys.sort_by(|left, right| left.0.encode_utf16().cmp(right.0.encode_utf16()));
            out.push('{');
            for (index, (key, child)) in keys.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_string(key, out);
                out.push(':');
                write_canonical(child, out);
            }
            out.push('}');
        }
        other => write_scalar(other, out),
    }
}

fn write_insert(value: &Json, out: &mut String) {
    match value {
        Json::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_insert(item, out);
            }
            out.push(']');
        }
        Json::Object(pairs) => {
            out.push('{');
            for (index, (key, child)) in pairs.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_string(key, out);
                out.push(':');
                write_insert(child, out);
            }
            out.push('}');
        }
        other => write_scalar(other, out),
    }
}

fn write_scalar(value: &Json, out: &mut String) {
    match value {
        Json::Null => out.push_str("null"),
        Json::Bool(true) => out.push_str("true"),
        Json::Bool(false) => out.push_str("false"),
        Json::Int(value) => out.push_str(&value.to_string()),
        Json::String(value) => write_string(value, out),
        Json::Array(_) | Json::Object(_) => {}
    }
}

fn write_string(value: &str, out: &mut String) {
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            other if (other as u32) < 0x20 => out.push_str(&format!("\\u{:04x}", other as u32)),
            other => out.push(other),
        }
    }
    out.push('"');
}
