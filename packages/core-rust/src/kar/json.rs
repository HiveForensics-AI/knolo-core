//! Research JSON canonical form.
//! Object keys sort by UTF-16 code units. Arrays keep their order.
//! Solidus, U+2028, and U+2029 stay literal, matching `JSON.stringify`.

use std::cmp::Ordering;

#[derive(Debug, Clone, PartialEq)]
pub enum Json {
    Null,
    Bool(bool),
    Int(i64),
    String(String),
    Array(Vec<Json>),
    Object(Vec<(String, Json)>),
}

impl Json {
    pub fn object(pairs: Vec<(&str, Json)>) -> Json {
        Json::Object(
            pairs
                .into_iter()
                .map(|(key, value)| (key.to_string(), value))
                .collect(),
        )
    }

    pub fn get(&self, key: &str) -> Option<&Json> {
        match self {
            Json::Object(pairs) => pairs
                .iter()
                .find(|(name, _)| name == key)
                .map(|(_, value)| value),
            _ => None,
        }
    }

    pub fn as_object(&self) -> Option<&[(String, Json)]> {
        match self {
            Json::Object(pairs) => Some(pairs),
            _ => None,
        }
    }

    pub fn as_str(&self) -> Option<&str> {
        match self {
            Json::String(value) => Some(value),
            _ => None,
        }
    }

    pub fn as_int(&self) -> Option<i64> {
        match self {
            Json::Int(value) => Some(*value),
            _ => None,
        }
    }
}

pub fn parse_json(input: &str) -> Result<Json, String> {
    let mut parser = Parser { input, index: 0 };
    parser.skip();
    let value = parser.value()?;
    parser.skip();
    if parser.index != parser.input.len() {
        return Err("trailing JSON".into());
    }
    Ok(value)
}

pub fn canonicalize(value: &Json) -> String {
    let mut out = String::new();
    write_canonical(value, &mut out);
    out
}

pub fn stringify(value: &Json) -> String {
    let mut out = String::new();
    write_stringify(value, &mut out);
    out
}

pub fn digest_json(value: &Json) -> String {
    let raw = crate::sha256(canonicalize(value).as_bytes());
    let mut hex = String::with_capacity(64);
    for byte in raw {
        hex.push_str(&format!("{byte:02x}"));
    }
    format!("sha256-{hex}")
}

pub fn utf16_cmp(left: &str, right: &str) -> Ordering {
    left.encode_utf16().cmp(right.encode_utf16())
}

struct Parser<'a> {
    input: &'a str,
    index: usize,
}

impl<'a> Parser<'a> {
    fn skip(&mut self) {
        while let Some(byte) = self.input.as_bytes().get(self.index).copied() {
            if byte == b' ' || byte == b'\n' || byte == b'\r' || byte == b'\t' {
                self.index += 1;
            } else {
                break;
            }
        }
    }

    fn value(&mut self) -> Result<Json, String> {
        self.skip();
        let byte = *self
            .input
            .as_bytes()
            .get(self.index)
            .ok_or_else(|| "truncated JSON".to_string())?;
        match byte {
            b'n' => self.literal("null", Json::Null),
            b't' => self.literal("true", Json::Bool(true)),
            b'f' => self.literal("false", Json::Bool(false)),
            b'"' => Ok(Json::String(self.string()?)),
            b'[' => self.array(),
            b'{' => self.object(),
            b'-' | b'0'..=b'9' => self.number(),
            _ => Err("invalid JSON value".into()),
        }
    }

    fn literal(&mut self, text: &str, value: Json) -> Result<Json, String> {
        if self.input[self.index..].starts_with(text) {
            self.index += text.len();
            Ok(value)
        } else {
            Err(format!("invalid JSON literal {text}"))
        }
    }

    fn array(&mut self) -> Result<Json, String> {
        self.index += 1;
        let mut items = Vec::new();
        self.skip();
        if self.eat(b']') {
            return Ok(Json::Array(items));
        }
        loop {
            items.push(self.value()?);
            self.skip();
            if self.eat(b']') {
                return Ok(Json::Array(items));
            }
            if !self.eat(b',') {
                return Err("invalid JSON array".into());
            }
        }
    }

    fn object(&mut self) -> Result<Json, String> {
        self.index += 1;
        let mut pairs = Vec::new();
        self.skip();
        if self.eat(b'}') {
            return Ok(Json::Object(pairs));
        }
        loop {
            self.skip();
            if !self.eat(b'"') {
                return Err("JSON object key must be a string".into());
            }
            let key = self.string_body()?;
            self.skip();
            if !self.eat(b':') {
                return Err("JSON object missing colon".into());
            }
            let value = self.value()?;
            if pairs.iter().any(|(name, _): &(String, Json)| name == &key) {
                return Err("duplicate JSON key".into());
            }
            pairs.push((key, value));
            self.skip();
            if self.eat(b'}') {
                return Ok(Json::Object(pairs));
            }
            if !self.eat(b',') {
                return Err("invalid JSON object".into());
            }
        }
    }

    fn number(&mut self) -> Result<Json, String> {
        let start = self.index;
        if self.eat(b'-') {}
        if self.eat(b'0') {
            if self
                .input
                .as_bytes()
                .get(self.index)
                .is_some_and(|byte| byte.is_ascii_digit())
            {
                return Err("invalid JSON number".into());
            }
        } else if self
            .input
            .as_bytes()
            .get(self.index)
            .is_some_and(|byte| byte.is_ascii_digit())
        {
            while self
                .input
                .as_bytes()
                .get(self.index)
                .is_some_and(|byte| byte.is_ascii_digit())
            {
                self.index += 1;
            }
        } else {
            return Err("invalid JSON number".into());
        }
        let mut fractional = false;
        if self.eat(b'.') {
            fractional = true;
            if !self
                .input
                .as_bytes()
                .get(self.index)
                .is_some_and(|byte| byte.is_ascii_digit())
            {
                return Err("invalid JSON number".into());
            }
            while self
                .input
                .as_bytes()
                .get(self.index)
                .is_some_and(|byte| byte.is_ascii_digit())
            {
                self.index += 1;
            }
        }
        if self
            .input
            .as_bytes()
            .get(self.index)
            .is_some_and(|byte| *byte == b'e' || *byte == b'E')
        {
            fractional = true;
            self.index += 1;
            if self
                .input
                .as_bytes()
                .get(self.index)
                .is_some_and(|byte| *byte == b'+' || *byte == b'-')
            {
                self.index += 1;
            }
            if !self
                .input
                .as_bytes()
                .get(self.index)
                .is_some_and(|byte| byte.is_ascii_digit())
            {
                return Err("invalid JSON number".into());
            }
            while self
                .input
                .as_bytes()
                .get(self.index)
                .is_some_and(|byte| byte.is_ascii_digit())
            {
                self.index += 1;
            }
        }
        let token = &self.input[start..self.index];
        if !fractional {
            let parsed = token
                .parse::<i64>()
                .map_err(|_| format!("JSON integer out of range: {token}"))?;
            return Ok(Json::Int(parsed));
        }
        let number: f64 = token
            .parse()
            .map_err(|_| format!("invalid JSON number: {token}"))?;
        if number.fract() == 0.0 && number >= i64::MIN as f64 && number <= i64::MAX as f64 {
            let whole = number as i64;
            if whole as f64 == number && (whole as f64).abs() <= 9007199254740991.0 {
                return Ok(Json::Int(whole));
            }
        }
        Err("KAR JSON numbers must be safe integers".into())
    }

    fn string(&mut self) -> Result<String, String> {
        if !self.eat(b'"') {
            return Err("JSON string expected".into());
        }
        self.string_body()
    }

    fn string_body(&mut self) -> Result<String, String> {
        let mut out = String::new();
        loop {
            let byte = *self
                .input
                .as_bytes()
                .get(self.index)
                .ok_or_else(|| "unterminated JSON string".to_string())?;
            if byte == b'"' {
                self.index += 1;
                return Ok(out);
            }
            if byte == b'\\' {
                self.index += 1;
                let escape = *self
                    .input
                    .as_bytes()
                    .get(self.index)
                    .ok_or_else(|| "truncated JSON escape".to_string())?;
                self.index += 1;
                match escape {
                    b'"' => out.push('"'),
                    b'\\' => out.push('\\'),
                    b'/' => out.push('/'),
                    b'b' => out.push('\u{0008}'),
                    b'f' => out.push('\u{000c}'),
                    b'n' => out.push('\n'),
                    b'r' => out.push('\r'),
                    b't' => out.push('\t'),
                    b'u' => out.push(self.unicode_escape()?),
                    _ => return Err("invalid JSON string escape".into()),
                }
                continue;
            }
            if byte < 0x20 {
                return Err("raw control character in JSON string".into());
            }
            let ch = self.input[self.index..]
                .chars()
                .next()
                .ok_or_else(|| "invalid UTF-8 in JSON".to_string())?;
            self.index += ch.len_utf8();
            out.push(ch);
        }
    }

    fn unicode_escape(&mut self) -> Result<char, String> {
        let unit = self.hex4()?;
        if (0xD800..=0xDBFF).contains(&unit) {
            if self.input[self.index..].starts_with("\\u") {
                self.index += 2;
                let second = self.hex4()?;
                if (0xDC00..=0xDFFF).contains(&second) {
                    let point =
                        0x10000 + (((unit as u32 - 0xD800) << 10) | (second as u32 - 0xDC00));
                    return char::from_u32(point)
                        .ok_or_else(|| "invalid JSON surrogate pair".to_string());
                }
            }
            return Err("lone JSON surrogate".into());
        }
        if (0xDC00..=0xDFFF).contains(&unit) {
            return Err("lone JSON surrogate".into());
        }
        char::from_u32(unit as u32).ok_or_else(|| "invalid JSON unicode escape".to_string())
    }

    fn hex4(&mut self) -> Result<u16, String> {
        let end = self.index + 4;
        let text = self
            .input
            .get(self.index..end)
            .ok_or_else(|| "truncated JSON unicode escape".to_string())?;
        let value =
            u16::from_str_radix(text, 16).map_err(|_| "invalid JSON unicode escape".to_string())?;
        self.index = end;
        Ok(value)
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
            keys.sort_by(|left, right| utf16_cmp(&left.0, &right.0));
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

fn write_stringify(value: &Json, out: &mut String) {
    match value {
        Json::Array(items) => {
            out.push('[');
            for (index, item) in items.iter().enumerate() {
                if index > 0 {
                    out.push(',');
                }
                write_stringify(item, out);
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
                write_stringify(child, out);
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
        Json::Array(_) | Json::Object(_) => write_canonical(value, out),
    }
}

fn write_string(value: &str, out: &mut String) {
    out.push('"');
    for ch in value.chars() {
        match ch {
            '"' => out.push_str("\\\""),
            '\\' => out.push_str("\\\\"),
            '\u{0008}' => out.push_str("\\b"),
            '\u{000c}' => out.push_str("\\f"),
            '\n' => out.push_str("\\n"),
            '\r' => out.push_str("\\r"),
            '\t' => out.push_str("\\t"),
            other if (other as u32) < 0x20 => {
                out.push_str(&format!("\\u{:04x}", other as u32));
            }
            other => out.push(other),
        }
    }
    out.push('"');
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn line_separators_stay_literal() {
        let value = Json::String("\u{2028}\u{2029}".into());
        assert_eq!(canonicalize(&value), "\"\u{2028}\u{2029}\"");
        assert_eq!(stringify(&value), "\"\u{2028}\u{2029}\"");
    }
}
