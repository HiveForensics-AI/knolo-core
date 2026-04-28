use std::collections::{HashMap, HashSet};
use std::error::Error;
use std::fmt::{Display, Formatter};

#[derive(Debug, Clone)]
pub enum KnoloError {
    InvalidPack(String),
}

impl Display for KnoloError {
    fn fmt(&self, f: &mut Formatter<'_>) -> std::fmt::Result {
        match self {
            KnoloError::InvalidPack(msg) => write!(f, "invalid pack: {msg}"),
        }
    }
}

impl Error for KnoloError {}

#[derive(Debug, Clone)]
pub struct PackMeta {
    pub version: u32,
    pub stats: PackStats,
}

#[derive(Debug, Clone)]
pub struct PackStats {
    pub docs: usize,
    pub blocks: usize,
    pub terms: usize,
    pub avg_block_len: Option<f64>,
}

#[derive(Debug, Clone)]
pub struct Pack {
    pub meta: PackMeta,
    pub lexicon: HashMap<String, u32>,
    pub postings: Vec<u32>,
    pub blocks: Vec<String>,
    pub headings: Vec<Option<String>>,
    pub doc_ids: Vec<Option<String>>,
    pub namespaces: Vec<Option<String>>,
    pub block_token_lens: Vec<usize>,
}

#[derive(Debug, Clone)]
pub struct QueryOptions {
    pub top_k: usize,
    pub min_score: f64,
    pub namespace: Option<Vec<String>>,
    pub source: Option<Vec<String>>,
}

impl Default for QueryOptions {
    fn default() -> Self {
        Self {
            top_k: 10,
            min_score: 0.0,
            namespace: None,
            source: None,
        }
    }
}

#[derive(Debug, Clone, PartialEq)]
pub struct Hit {
    pub block_id: usize,
    pub score: f64,
    pub text: String,
    pub source: Option<String>,
    pub namespace: Option<String>,
}

pub fn mount_pack_from_bytes(bytes: &[u8]) -> Result<Pack, KnoloError> {
    let mut cursor = 0usize;

    let meta_len = read_u32(bytes, &mut cursor)? as usize;
    let meta_json = read_slice(bytes, &mut cursor, meta_len)?;
    let meta = parse_meta(std::str::from_utf8(meta_json).map_err(|_| KnoloError::InvalidPack("meta utf8".into()))?)?;

    let lex_len = read_u32(bytes, &mut cursor)? as usize;
    let lex_json = read_slice(bytes, &mut cursor, lex_len)?;
    let lexicon = parse_lexicon(std::str::from_utf8(lex_json).map_err(|_| KnoloError::InvalidPack("lexicon utf8".into()))?)?;

    let post_count = read_u32(bytes, &mut cursor)? as usize;
    let postings = read_u32_array(bytes, &mut cursor, post_count)?;

    let blocks_len = read_u32(bytes, &mut cursor)? as usize;
    let blocks_json = read_slice(bytes, &mut cursor, blocks_len)?;
    let blocks_str = std::str::from_utf8(blocks_json).map_err(|_| KnoloError::InvalidPack("blocks utf8".into()))?;
    let parsed_blocks = parse_blocks(blocks_str)?;

    Ok(Pack {
        meta,
        lexicon,
        postings,
        blocks: parsed_blocks.texts,
        headings: parsed_blocks.headings,
        doc_ids: parsed_blocks.doc_ids,
        namespaces: parsed_blocks.namespaces,
        block_token_lens: parsed_blocks.lens,
    })
}

pub fn query(pack: &Pack, q: &str, opts: QueryOptions) -> Vec<Hit> {
    if q.trim().is_empty() {
        return vec![];
    }
    let tokens = tokenize(q);
    if tokens.is_empty() {
        return vec![];
    }

    let term_ids = tokens
        .iter()
        .filter_map(|t| pack.lexicon.get(t).copied())
        .collect::<HashSet<_>>();
    if term_ids.is_empty() {
        return vec![];
    }

    let namespace_filter = normalize_filter(opts.namespace.as_ref());
    let source_filter = normalize_filter(opts.source.as_ref());

    let mut candidates: HashMap<usize, HashMap<u32, f64>> = HashMap::new();
    let mut dfs: HashMap<u32, usize> = HashMap::new();
    let uses_offset_block_ids = pack.meta.version >= 3;

    let mut i = 0usize;
    while i < pack.postings.len() {
        let tid = pack.postings[i];
        i += 1;
        if tid == 0 {
            continue;
        }
        let relevant = term_ids.contains(&tid);
        let mut term_df = 0usize;

        if i >= pack.postings.len() { break; }
        let mut encoded_bid = pack.postings[i];
        i += 1;

        while encoded_bid != 0 && i < pack.postings.len() {
            let bid = if uses_offset_block_ids {
                encoded_bid.saturating_sub(1) as usize
            } else {
                encoded_bid as usize
            };

            let mut tf = 0usize;
            while i < pack.postings.len() {
                let pos = pack.postings[i];
                i += 1;
                if pos == 0 {
                    break;
                }
                tf += 1;
            }

            term_df += 1;
            if relevant && bid < pack.blocks.len() {
                let entry = candidates.entry(bid).or_default();
                *entry.entry(tid).or_insert(0.0) += tf as f64;
            }

            if i >= pack.postings.len() { break; }
            encoded_bid = pack.postings[i];
            i += 1;
        }

        if relevant {
            dfs.insert(tid, term_df);
        }
    }

    if !namespace_filter.is_empty() {
        candidates.retain(|bid, _| {
            pack.namespaces
                .get(*bid)
                .and_then(|n| n.clone())
                .map(|n| namespace_filter.contains(&normalize(&n)))
                .unwrap_or(false)
        });
    }

    if !source_filter.is_empty() {
        candidates.retain(|bid, _| {
            pack.doc_ids
                .get(*bid)
                .and_then(|n| n.clone())
                .map(|n| source_filter.contains(&normalize(&n)))
                .unwrap_or(false)
        });
    }

    let doc_count = pack.meta.stats.blocks.max(1) as f64;
    let avg_len = pack
        .meta
        .stats
        .avg_block_len
        .unwrap_or_else(|| {
            if pack.block_token_lens.is_empty() {
                1.0
            } else {
                pack.block_token_lens.iter().sum::<usize>() as f64 / pack.block_token_lens.len() as f64
            }
        })
        .max(1.0);

    let mut scored = candidates
        .into_iter()
        .map(|(bid, tf_map)| {
            let mut score = 0.0;
            let len = *pack.block_token_lens.get(bid).unwrap_or(&1) as f64;
            for (tid, tf) in tf_map {
                let df = *dfs.get(&tid).unwrap_or(&0) as f64;
                let idf = (1.0 + (doc_count - df + 0.5) / (df + 0.5)).ln();
                let k1 = 1.5;
                let b = 0.75;
                let numer = tf * (k1 + 1.0);
                let denom = tf + k1 * (1.0 - b + b * (len / avg_len));
                score += idf * (numer / denom);
            }
            (bid, score)
        })
        .filter(|(_, score)| *score >= opts.min_score)
        .collect::<Vec<_>>();

    scored.sort_by(|a, b| b.1.partial_cmp(&a.1).unwrap_or(std::cmp::Ordering::Equal));

    scored
        .into_iter()
        .take(opts.top_k.max(1))
        .map(|(bid, score)| Hit {
            block_id: bid,
            score,
            text: pack.blocks.get(bid).cloned().unwrap_or_default(),
            source: pack.doc_ids.get(bid).and_then(|s| s.clone()),
            namespace: pack.namespaces.get(bid).and_then(|s| s.clone()),
        })
        .collect()
}

struct ParsedBlocks {
    texts: Vec<String>,
    headings: Vec<Option<String>>,
    doc_ids: Vec<Option<String>>,
    namespaces: Vec<Option<String>>,
    lens: Vec<usize>,
}

fn parse_meta(json: &str) -> Result<PackMeta, KnoloError> {
    Ok(PackMeta {
        version: parse_u32_field(json, "version")?,
        stats: PackStats {
            docs: parse_u32_field(json, "docs")? as usize,
            blocks: parse_u32_field(json, "blocks")? as usize,
            terms: parse_u32_field(json, "terms")? as usize,
            avg_block_len: parse_f64_field(json, "avgBlockLen"),
        },
    })
}

fn parse_lexicon(json: &str) -> Result<HashMap<String, u32>, KnoloError> {
    let mut map = HashMap::new();
    let s = compact(json);
    let mut i = 0usize;
    while let Some(start) = s[i..].find("[\"") {
        let abs = i + start + 2;
        let rest = &s[abs..];
        let end = rest.find('"').ok_or_else(|| KnoloError::InvalidPack("lexicon key".into()))?;
        let key = rest[..end].to_string();
        let rest2 = &rest[end + 1..];
        let comma = rest2.find(',').ok_or_else(|| KnoloError::InvalidPack("lexicon comma".into()))?;
        let rest3 = &rest2[comma + 1..];
        let mut n = String::new();
        for ch in rest3.chars() {
            if ch.is_ascii_digit() {
                n.push(ch);
            } else {
                break;
            }
        }
        if !n.is_empty() {
            map.insert(key, n.parse::<u32>().map_err(|_| KnoloError::InvalidPack("lexicon tid".into()))?);
        }
        i = abs + end + 1;
    }
    Ok(map)
}

fn parse_blocks(json: &str) -> Result<ParsedBlocks, KnoloError> {
    let s = compact(json);
    if s.starts_with("[\"") {
        let mut texts = Vec::new();
        let mut i = 2usize;
        while i < s.len() {
            if let Some(end) = s[i..].find('"') {
                let piece = &s[i..i + end];
                texts.push(unescape(piece));
                i += end + 1;
                if let Some(next) = s[i..].find('"') {
                    i += next + 1;
                } else {
                    break;
                }
            } else {
                break;
            }
        }
        let lens = texts.iter().map(|t| tokenize(t).len()).collect::<Vec<_>>();
        return Ok(ParsedBlocks {
            headings: vec![None; texts.len()],
            doc_ids: vec![None; texts.len()],
            namespaces: vec![None; texts.len()],
            lens,
            texts,
        });
    }

    let objects = split_top_level_objects(&s)?;
    let mut texts = Vec::new();
    let mut headings = Vec::new();
    let mut doc_ids = Vec::new();
    let mut namespaces = Vec::new();
    let mut lens = Vec::new();

    for obj in objects {
        let text = parse_string_or_null(&obj, "text").unwrap_or_default();
        let len = parse_u32_field_optional(&obj, "len").map(|v| v as usize).unwrap_or_else(|| tokenize(&text).len());
        texts.push(text);
        headings.push(parse_string_or_null(&obj, "heading"));
        doc_ids.push(parse_string_or_null(&obj, "docId"));
        namespaces.push(parse_string_or_null(&obj, "namespace"));
        lens.push(len);
    }

    Ok(ParsedBlocks { texts, headings, doc_ids, namespaces, lens })
}

fn split_top_level_objects(s: &str) -> Result<Vec<String>, KnoloError> {
    let mut out = Vec::new();
    let mut depth = 0i32;
    let mut start = None;
    let chars: Vec<char> = s.chars().collect();
    for (i, ch) in chars.iter().enumerate() {
        if *ch == '{' {
            if depth == 0 {
                start = Some(i);
            }
            depth += 1;
        } else if *ch == '}' {
            depth -= 1;
            if depth == 0 {
                if let Some(st) = start {
                    out.push(chars[st..=i].iter().collect());
                }
                start = None;
            }
        }
    }
    if out.is_empty() {
        return Err(KnoloError::InvalidPack("blocks objects".into()));
    }
    Ok(out)
}

fn parse_string_or_null(obj: &str, key: &str) -> Option<String> {
    let needle = format!("\"{}\":", key);
    let idx = obj.find(&needle)? + needle.len();
    let tail = &obj[idx..];
    if tail.starts_with("null") {
        return None;
    }
    if !tail.starts_with('"') {
        return None;
    }
    let rest = &tail[1..];
    let end = rest.find('"')?;
    Some(unescape(&rest[..end]))
}

fn parse_u32_field(json: &str, key: &str) -> Result<u32, KnoloError> {
    parse_u32_field_optional(json, key).ok_or_else(|| KnoloError::InvalidPack(format!("missing {key}")))
}

fn parse_u32_field_optional(json: &str, key: &str) -> Option<u32> {
    let needle = format!("\"{}\":", key);
    let idx = json.find(&needle)? + needle.len();
    let tail = &json[idx..];
    let mut n = String::new();
    for ch in tail.chars() {
        if ch.is_ascii_digit() {
            n.push(ch);
        } else if !n.is_empty() {
            break;
        }
    }
    n.parse().ok()
}

fn parse_f64_field(json: &str, key: &str) -> Option<f64> {
    let needle = format!("\"{}\":", key);
    let idx = json.find(&needle)? + needle.len();
    let tail = &json[idx..];
    let mut n = String::new();
    for ch in tail.chars() {
        if ch.is_ascii_digit() || ch == '.' {
            n.push(ch);
        } else if !n.is_empty() {
            break;
        }
    }
    n.parse().ok()
}

fn normalize_filter(values: Option<&Vec<String>>) -> HashSet<String> {
    values
        .map(|arr| arr.iter().map(|s| normalize(s)).collect::<HashSet<_>>())
        .unwrap_or_default()
}

fn normalize(s: &str) -> String {
    s.to_lowercase().trim().to_string()
}

fn tokenize(text: &str) -> Vec<String> {
    let mut out = Vec::new();
    let mut cur = String::new();
    for ch in text.chars() {
        if ch.is_alphanumeric() {
            cur.push(ch.to_ascii_lowercase());
        } else if !cur.is_empty() {
            out.push(std::mem::take(&mut cur));
        }
    }
    if !cur.is_empty() {
        out.push(cur);
    }
    out
}

fn compact(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut in_string = false;
    let mut escaped = false;

    for ch in s.chars() {
        if in_string {
            out.push(ch);
            if escaped {
                escaped = false;
            } else if ch == '\\' {
                escaped = true;
            } else if ch == '"' {
                in_string = false;
            }
            continue;
        }

        if ch.is_whitespace() {
            continue;
        }

        out.push(ch);
        if ch == '"' {
            in_string = true;
        }
    }

    out
}

fn unescape(s: &str) -> String {
    s.replace("\\\"", "\"")
}

fn read_u32(bytes: &[u8], cursor: &mut usize) -> Result<u32, KnoloError> {
    let chunk = read_slice(bytes, cursor, 4)?;
    Ok(u32::from_le_bytes([chunk[0], chunk[1], chunk[2], chunk[3]]))
}

fn read_u32_array(bytes: &[u8], cursor: &mut usize, len: usize) -> Result<Vec<u32>, KnoloError> {
    let mut out = Vec::with_capacity(len);
    for _ in 0..len {
        out.push(read_u32(bytes, cursor)?);
    }
    Ok(out)
}

fn read_slice<'a>(bytes: &'a [u8], cursor: &mut usize, len: usize) -> Result<&'a [u8], KnoloError> {
    let end = cursor.saturating_add(len);
    if end > bytes.len() {
        return Err(KnoloError::InvalidPack("unexpected end-of-buffer".into()));
    }
    let slice = &bytes[*cursor..end];
    *cursor = end;
    Ok(slice)
}
