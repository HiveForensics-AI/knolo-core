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
    pub metadata_json: String,
    pub claims_json: Option<String>,
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
    let metadata_json = std::str::from_utf8(meta_json).map_err(|_| KnoloError::InvalidPack("meta utf8".into()))?.to_string();
    let meta = parse_meta(&metadata_json)?;

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
        metadata_json,
        claims_json: None,
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

// V5 read-only Knowledge Image support. The implementation intentionally has
// no external dependencies so the format verifier can be used in offline and
// embedded environments.

pub const KNOWLEDGE_IMAGE_V5_MAGIC: &[u8; 8] = b"KNLOV5\0\0";
const SUPERBLOCK_MAGIC: &[u8; 8] = b"KNLOSB1\0";
const SEGMENT_MAGIC: &[u8; 4] = b"KSEG";
const V5_HEADER_SIZE: usize = 16;
const V5_SUPERBLOCK_SIZE: usize = 128;
const V5_SEGMENT_HEADER_SIZE: usize = 48;
const V5_DATA_START: usize = V5_HEADER_SIZE + V5_SUPERBLOCK_SIZE * 2;
const V5_MAX_SEGMENT: u64 = 512 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeObjectV1 {
    pub id: String,
    pub kind: String,
    pub bytes: Vec<u8>,
    pub meta: CborValue,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeEventV1 {
    pub id: String,
    pub transaction_id: String,
    pub actor: String,
    pub actor_counter: u64,
    pub kind: String,
    pub target: String,
    pub payload: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeCommitV1 {
    pub state_root: String,
    pub commit_digest: String,
    pub parents: Vec<String>,
    pub object_root: String,
    pub event_root: String,
    pub policy_root: String,
    pub sequence: u64,
    pub actor: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeImageSegment {
    pub kind: u8,
    pub schema: u8,
    pub flags: u16,
    pub offset: usize,
    pub length: usize,
    pub payload_length: usize,
    pub digest: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeImage {
    pub state_root: String,
    pub commit_digest: String,
    pub commit: KnowledgeCommitV1,
    pub objects: Vec<KnowledgeObjectV1>,
    pub events: Vec<KnowledgeEventV1>,
    pub segments: Vec<KnowledgeImageSegment>,
    pub active_superblock: char,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeImageVerification {
    pub valid: bool,
    pub state_root: String,
    pub commit_digest: String,
    pub active_superblock: char,
    pub segments: Vec<KnowledgeImageSegment>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeRuntimeDiagnosticsImageV1 {
    pub state_root: String,
    pub commit_digest: String,
    pub sequence: u64,
    pub object_count: usize,
    pub event_count: usize,
    pub segment_count: usize,
    pub active_superblock: char,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeRuntimeDiagnosticsV1 {
    pub version: u64,
    pub valid: bool,
    pub image: KnowledgeRuntimeDiagnosticsImageV1,
    pub diagnostics_root: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeStudioCapabilitiesV1 {
    pub inspect_image: bool,
    pub verify_image: bool,
    pub inspect_query_index: bool,
    pub inspect_query_history: bool,
    pub inspect_run: bool,
    pub inspect_replay: bool,
    pub mutate_image: bool,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeStudioManagementV1 {
    pub version: u64,
    pub surface: String,
    pub valid: bool,
    pub read_only: bool,
    pub diagnostics: KnowledgeRuntimeDiagnosticsV1,
    pub capabilities: KnowledgeStudioCapabilitiesV1,
    pub management_root: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MigrationMapping {
    pub legacy_block_id: usize,
    pub source_object: String,
    pub chunk_object: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct MigrationResult {
    pub image: Vec<u8>,
    pub receipt: Vec<u8>,
    pub state_root: String,
    pub mappings: Vec<MigrationMapping>,
}

#[derive(Debug, Clone, PartialEq)]
pub enum CborValue {
    Null,
    Bool(bool),
    UInt(u64),
    NInt(i64),
    Bytes(Vec<u8>),
    Text(String),
    Array(Vec<CborValue>),
    Map(Vec<(String, CborValue)>),
}

pub fn mount_knowledge_image(bytes: &[u8]) -> Result<KnowledgeImage, KnoloError> {
    let parsed = parse_v5_image(bytes)?;
    Ok(parsed)
}

pub fn inspect_knowledge_image(bytes: &[u8]) -> Result<KnowledgeImageVerification, KnoloError> {
    let image = mount_knowledge_image(bytes)?;
    Ok(KnowledgeImageVerification {
        valid: true,
        state_root: image.state_root,
        commit_digest: image.commit_digest,
        active_superblock: image.active_superblock,
        segments: image.segments,
    })
}

pub fn verify_knowledge_image(bytes: &[u8]) -> Result<KnowledgeImageVerification, KnoloError> {
    inspect_knowledge_image(bytes)
}

pub fn inspect_knowledge_runtime_v5(bytes: &[u8]) -> Result<KnowledgeRuntimeDiagnosticsV1, KnoloError> {
    let image = mount_knowledge_image(bytes)?;
    let diagnostics = KnowledgeRuntimeDiagnosticsV1 {
        version: 1,
        valid: true,
        image: KnowledgeRuntimeDiagnosticsImageV1 {
            state_root: image.state_root,
            commit_digest: image.commit_digest,
            sequence: image.commit.sequence,
            object_count: image.objects.len(),
            event_count: image.events.len(),
            segment_count: image.segments.len(),
            active_superblock: image.active_superblock,
        },
        diagnostics_root: String::new(),
    };
    let diagnostics_root = runtime_diagnostics_root_v5(&diagnostics);
    Ok(KnowledgeRuntimeDiagnosticsV1 { diagnostics_root, ..diagnostics })
}

pub fn runtime_diagnostics_root_v5(diagnostics: &KnowledgeRuntimeDiagnosticsV1) -> String {
    digest_domain("runtime-diagnostics", &encode_cbor(&runtime_diagnostics_body(diagnostics)))
}

pub fn inspect_knowledge_studio_management_v5(bytes: &[u8]) -> Result<KnowledgeStudioManagementV1, KnoloError> {
    let diagnostics = inspect_knowledge_runtime_v5(bytes)?;
    let management = KnowledgeStudioManagementV1 {
        version: 1,
        surface: "studio-management".into(),
        valid: true,
        read_only: true,
        diagnostics,
        capabilities: KnowledgeStudioCapabilitiesV1 {
            inspect_image: true,
            verify_image: true,
            inspect_query_index: false,
            inspect_query_history: false,
            inspect_run: false,
            inspect_replay: false,
            mutate_image: false,
        },
        management_root: String::new(),
    };
    let management_root = studio_management_root_v5(&management);
    Ok(KnowledgeStudioManagementV1 { management_root, ..management })
}

pub fn studio_management_root_v5(management: &KnowledgeStudioManagementV1) -> String {
    digest_domain("studio-management", &encode_cbor(&CborValue::Map(vec![
        ("capabilities".into(), studio_capabilities_value(&management.capabilities)),
        ("diagnostics".into(), runtime_diagnostics_value(&management.diagnostics)),
        ("readOnly".into(), CborValue::Bool(management.read_only)),
        ("surface".into(), CborValue::Text(management.surface.clone())),
        ("valid".into(), CborValue::Bool(management.valid)),
        ("version".into(), CborValue::UInt(management.version)),
    ])))
}

fn runtime_diagnostics_body(diagnostics: &KnowledgeRuntimeDiagnosticsV1) -> CborValue {
    CborValue::Map(vec![
        ("image".into(), CborValue::Map(vec![
            ("activeSuperblock".into(), CborValue::Text(diagnostics.image.active_superblock.to_string())),
            ("commitDigest".into(), CborValue::Text(diagnostics.image.commit_digest.clone())),
            ("eventCount".into(), CborValue::UInt(diagnostics.image.event_count as u64)),
            ("objectCount".into(), CborValue::UInt(diagnostics.image.object_count as u64)),
            ("segmentCount".into(), CborValue::UInt(diagnostics.image.segment_count as u64)),
            ("sequence".into(), CborValue::UInt(diagnostics.image.sequence)),
            ("stateRoot".into(), CborValue::Text(diagnostics.image.state_root.clone())),
        ])),
        ("valid".into(), CborValue::Bool(diagnostics.valid)),
        ("version".into(), CborValue::UInt(diagnostics.version)),
    ])
}

fn runtime_diagnostics_value(diagnostics: &KnowledgeRuntimeDiagnosticsV1) -> CborValue {
    let mut entries = match runtime_diagnostics_body(diagnostics) {
        CborValue::Map(entries) => entries,
        _ => Vec::new(),
    };
    entries.push(("diagnosticsRoot".into(), CborValue::Text(diagnostics.diagnostics_root.clone())));
    CborValue::Map(entries)
}

fn studio_capabilities_value(capabilities: &KnowledgeStudioCapabilitiesV1) -> CborValue {
    CborValue::Map(vec![
        ("inspectImage".into(), CborValue::Bool(capabilities.inspect_image)),
        ("inspectQueryHistory".into(), CborValue::Bool(capabilities.inspect_query_history)),
        ("inspectQueryIndex".into(), CborValue::Bool(capabilities.inspect_query_index)),
        ("inspectReplay".into(), CborValue::Bool(capabilities.inspect_replay)),
        ("inspectRun".into(), CborValue::Bool(capabilities.inspect_run)),
        ("mutateImage".into(), CborValue::Bool(capabilities.mutate_image)),
        ("verifyImage".into(), CborValue::Bool(capabilities.verify_image)),
    ])
}

pub fn state_root(image: &KnowledgeImage) -> &str {
    &image.state_root
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeQueryFilterV1 {
    pub field: String,
    pub value: CborValue,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeQueryPlanV1 {
    pub kind: Option<String>,
    pub filters: Vec<KnowledgeQueryFilterV1>,
    pub search: Option<String>,
    pub limit: usize,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeQueryHitV1 {
    pub object_id: String,
    pub kind: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeQueryResultV1 {
    pub state_root: String,
    pub plan_root: String,
    pub hits: Vec<KnowledgeQueryHitV1>,
    pub result_root: String,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgePolicyRuleV1 {
    pub effect: String,
    pub action: String,
    pub principal: Option<String>,
    pub kind: Option<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgePolicyV1 {
    pub default: String,
    pub rules: Vec<KnowledgePolicyRuleV1>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeAuthorizationResultV1 {
    pub state_root: String,
    pub plan_root: String,
    pub policy_root: String,
    pub authorization_root: String,
    pub principal: String,
    pub action: String,
    pub decision: String,
    pub allowed_object_ids: Vec<String>,
    pub denied_object_ids: Vec<String>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeDelegationV1 {
    pub version: u64,
    pub delegator: String,
    pub delegatee: String,
    pub action: String,
    pub issued_at: u64,
    pub expires_at: u64,
    pub algorithm: String,
    pub key_id: Option<String>,
    pub signature: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeAuthorityEnvelopeV1 {
    pub version: u64,
    pub issuer: String,
    pub subject: String,
    pub authorization_root: String,
    pub keyring_root: Option<String>,
    pub issued_at: u64,
    pub expires_at: u64,
    pub algorithm: String,
    pub key_id: Option<String>,
    pub delegations: Vec<KnowledgeDelegationV1>,
    pub signature: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeAuthorityVerificationV1 {
    pub envelope_root: String,
    pub issuer: String,
    pub subject: String,
    pub authorization_root: String,
    pub keyring_root: Option<String>,
    pub delegation_depth: usize,
}

pub fn knowledge_policy_root_v5(policy: &KnowledgePolicyV1) -> Result<String, KnoloError> {
    if policy.default != "allow" && policy.default != "deny" { return Err(KnoloError::InvalidPack("invalid V5 policy default".into())); }
    let mut rules = policy.rules.clone();
    for rule in &rules {
        if !matches!(rule.effect.as_str(), "allow" | "deny") || !matches!(rule.action.as_str(), "query" | "read") { return Err(KnoloError::InvalidPack("invalid V5 policy rule".into())); }
        if rule.principal.as_deref() == Some("") || rule.kind.as_deref() == Some("") { return Err(KnoloError::InvalidPack("invalid V5 policy selector".into())); }
    }
    rules.sort_by(|left, right| policy_rule_key(left).cmp(&policy_rule_key(right)));
    let body = if rules.is_empty() {
        CborValue::Map(vec![("default".into(), CborValue::Text(policy.default.clone()))])
    } else {
        CborValue::Map(vec![
            ("default".into(), CborValue::Text(policy.default.clone())),
            ("rules".into(), CborValue::Array(rules.iter().map(policy_rule_value).collect())),
        ])
    };
    Ok(digest_domain("policy", &encode_cbor(&body)))
}

pub fn evaluate_knowledge_query_policy_v5(
    image: &KnowledgeImage,
    query_result: &KnowledgeQueryResultV1,
    policy: &KnowledgePolicyV1,
    principal: &str,
    action: &str,
) -> Result<KnowledgeAuthorizationResultV1, KnoloError> {
    if principal.is_empty() || !matches!(action, "query" | "read") { return Err(KnoloError::InvalidPack("invalid V5 authorization input".into())); }
    if query_result.state_root != image.state_root { return Err(KnoloError::InvalidPack("V5 query state root mismatch".into())); }
    let policy_root = knowledge_policy_root_v5(policy)?;
    if policy_root != image.commit.policy_root { return Err(KnoloError::InvalidPack("V5 policy root mismatch".into())); }
    let mut allowed_object_ids = Vec::new();
    let mut denied_object_ids = Vec::new();
    for hit in &query_result.hits {
        if authorize_policy_hit(hit, policy, principal, action) { allowed_object_ids.push(hit.object_id.clone()); } else { denied_object_ids.push(hit.object_id.clone()); }
    }
    let decision = if denied_object_ids.is_empty() { "allow" } else if allowed_object_ids.is_empty() { "deny" } else { "partial" };
    let authorization_value = CborValue::Map(vec![
        ("action".into(), CborValue::Text(action.into())),
        ("allowedObjectIds".into(), CborValue::Array(allowed_object_ids.iter().map(|id| CborValue::Text(id.clone())).collect())),
        ("decision".into(), CborValue::Text(decision.into())),
        ("deniedObjectIds".into(), CborValue::Array(denied_object_ids.iter().map(|id| CborValue::Text(id.clone())).collect())),
        ("planRoot".into(), CborValue::Text(query_result.plan_root.clone())),
        ("policyRoot".into(), CborValue::Text(policy_root.clone())),
        ("principal".into(), CborValue::Text(principal.into())),
        ("stateRoot".into(), CborValue::Text(image.state_root.clone())),
    ]);
    let authorization_root = digest_domain("authorization", &encode_cbor(&authorization_value));
    Ok(KnowledgeAuthorizationResultV1 { state_root: image.state_root.clone(), plan_root: query_result.plan_root.clone(), policy_root, authorization_root, principal: principal.into(), action: action.into(), decision: decision.into(), allowed_object_ids, denied_object_ids })
}

pub fn delegation_payload_v1(delegation: &KnowledgeDelegationV1) -> Vec<u8> {
    let mut entries = vec![
        ("action".into(), CborValue::Text(delegation.action.clone())),
        ("algorithm".into(), CborValue::Text(delegation.algorithm.clone())),
        ("delegatee".into(), CborValue::Text(delegation.delegatee.clone())),
        ("delegator".into(), CborValue::Text(delegation.delegator.clone())),
        ("expiresAt".into(), CborValue::UInt(delegation.expires_at)),
        ("issuedAt".into(), CborValue::UInt(delegation.issued_at)),
        ("version".into(), CborValue::UInt(delegation.version)),
    ];
    if let Some(key_id) = &delegation.key_id { entries.push(("keyId".into(), CborValue::Text(key_id.clone()))); }
    encode_cbor(&CborValue::Map(entries))
}

pub fn authority_envelope_payload_v1(envelope: &KnowledgeAuthorityEnvelopeV1) -> Vec<u8> {
    let delegation_roots = envelope.delegations.iter().map(|delegation| digest_domain("delegation-payload", &delegation_payload_v1(delegation))).map(CborValue::Text).collect();
    let mut entries = vec![
        ("algorithm".into(), CborValue::Text(envelope.algorithm.clone())),
        ("authorizationRoot".into(), CborValue::Text(envelope.authorization_root.clone())),
        ("delegations".into(), CborValue::Array(delegation_roots)),
        ("expiresAt".into(), CborValue::UInt(envelope.expires_at)),
        ("issuedAt".into(), CborValue::UInt(envelope.issued_at)),
        ("issuer".into(), CborValue::Text(envelope.issuer.clone())),
        ("subject".into(), CborValue::Text(envelope.subject.clone())),
        ("version".into(), CborValue::UInt(envelope.version)),
    ];
    if let Some(keyring_root) = &envelope.keyring_root { entries.push(("keyringRoot".into(), CborValue::Text(keyring_root.clone()))); }
    if let Some(key_id) = &envelope.key_id { entries.push(("keyId".into(), CborValue::Text(key_id.clone()))); }
    encode_cbor(&CborValue::Map(entries))
}

pub fn delegation_root_v1(delegation: &KnowledgeDelegationV1) -> String {
    digest_domain("delegation", &encode_cbor(&CborValue::Map(vec![
        ("payload".into(), CborValue::Bytes(delegation_payload_v1(delegation))),
        ("signature".into(), CborValue::Bytes(delegation.signature.clone())),
    ])))
}

pub fn authority_envelope_root_v1(envelope: &KnowledgeAuthorityEnvelopeV1) -> String {
    digest_domain("authority-envelope", &encode_cbor(&CborValue::Map(vec![
        ("payload".into(), CborValue::Bytes(authority_envelope_payload_v1(envelope))),
        ("signature".into(), CborValue::Bytes(envelope.signature.clone())),
    ])))
}

pub fn authority_session_root_v1(state_root: &str, plan_root: &str, result_root: &str, authorization_root: &str, envelope_root: &str, keyring_root: Option<&str>) -> String {
    let mut entries = vec![
        ("authorizationRoot".into(), CborValue::Text(authorization_root.into())),
        ("envelopeRoot".into(), CborValue::Text(envelope_root.into())),
        ("keyringRoot".into(), keyring_root.map_or(CborValue::Null, |value| CborValue::Text(value.into()))),
        ("planRoot".into(), CborValue::Text(plan_root.into())),
        ("resultRoot".into(), CborValue::Text(result_root.into())),
        ("stateRoot".into(), CborValue::Text(state_root.into())),
        ("version".into(), CborValue::UInt(1)),
    ];
    digest_domain("authority-session", &encode_cbor(&CborValue::Map(std::mem::take(&mut entries))))
}

pub fn sync_request_payload_v1(request_id: &str, sender: &str, summary_root: &str, want_object_ids: &[String], want_event_ids: &[String], algorithm: &str, key_id: Option<&str>, keyring_root: Option<&str>, nonce: &[u8], issued_at: u64, expires_at: u64) -> Vec<u8> {
    encode_cbor(&CborValue::Map(vec![
        ("algorithm".into(), CborValue::Text(algorithm.into())),
        ("expiresAt".into(), CborValue::UInt(expires_at)),
        ("issuedAt".into(), CborValue::UInt(issued_at)),
        ("keyId".into(), key_id.map_or(CborValue::Null, |value| CborValue::Text(value.into()))),
        ("keyringRoot".into(), keyring_root.map_or(CborValue::Null, |value| CborValue::Text(value.into()))),
        ("kind".into(), CborValue::Text("sync-request".into())),
        ("nonce".into(), CborValue::Bytes(nonce.to_vec())),
        ("requestId".into(), CborValue::Text(request_id.into())),
        ("sender".into(), CborValue::Text(sender.into())),
        ("summary".into(), CborValue::Text(summary_root.into())),
        ("version".into(), CborValue::UInt(1)),
        ("wantEventIds".into(), CborValue::Array(want_event_ids.iter().map(|value| CborValue::Text(value.clone())).collect())),
        ("wantObjectIds".into(), CborValue::Array(want_object_ids.iter().map(|value| CborValue::Text(value.clone())).collect())),
    ]))
}

pub fn sync_request_root_v1(request_id: &str, sender: &str, summary_root: &str, want_object_ids: &[String], want_event_ids: &[String], algorithm: &str, key_id: Option<&str>, keyring_root: Option<&str>, nonce: &[u8], issued_at: u64, expires_at: u64, signature: &[u8]) -> String {
    digest_domain("sync-request", &encode_cbor(&CborValue::Map(vec![
        ("payload".into(), CborValue::Bytes(sync_request_payload_v1(request_id, sender, summary_root, want_object_ids, want_event_ids, algorithm, key_id, keyring_root, nonce, issued_at, expires_at))),
        ("signature".into(), CborValue::Bytes(signature.to_vec())),
    ])))
}

pub fn sync_response_payload_v1(request_root: &str, responder: &str, summary_root: &str, relation: &str, object_ids: &[String], event_ids: &[String], algorithm: &str, key_id: Option<&str>, keyring_root: Option<&str>, issued_at: u64, expires_at: u64) -> Vec<u8> {
    encode_cbor(&CborValue::Map(vec![
        ("algorithm".into(), CborValue::Text(algorithm.into())),
        ("eventIds".into(), CborValue::Array(event_ids.iter().map(|value| CborValue::Text(value.clone())).collect())),
        ("expiresAt".into(), CborValue::UInt(expires_at)),
        ("issuedAt".into(), CborValue::UInt(issued_at)),
        ("keyId".into(), key_id.map_or(CborValue::Null, |value| CborValue::Text(value.into()))),
        ("keyringRoot".into(), keyring_root.map_or(CborValue::Null, |value| CborValue::Text(value.into()))),
        ("kind".into(), CborValue::Text("sync-response".into())),
        ("objectIds".into(), CborValue::Array(object_ids.iter().map(|value| CborValue::Text(value.clone())).collect())),
        ("relation".into(), CborValue::Text(relation.into())),
        ("requestRoot".into(), CborValue::Text(request_root.into())),
        ("responder".into(), CborValue::Text(responder.into())),
        ("summary".into(), CborValue::Text(summary_root.into())),
        ("version".into(), CborValue::UInt(1)),
    ]))
}

pub fn sync_response_root_v1(request_root: &str, responder: &str, summary_root: &str, relation: &str, object_ids: &[String], event_ids: &[String], algorithm: &str, key_id: Option<&str>, keyring_root: Option<&str>, issued_at: u64, expires_at: u64, signature: &[u8]) -> String {
    digest_domain("sync-response", &encode_cbor(&CborValue::Map(vec![
        ("payload".into(), CborValue::Bytes(sync_response_payload_v1(request_root, responder, summary_root, relation, object_ids, event_ids, algorithm, key_id, keyring_root, issued_at, expires_at))),
        ("signature".into(), CborValue::Bytes(signature.to_vec())),
    ])))
}

pub fn sync_summary_root_v1(state_root: &str, commit_digest: &str, sequence: u64, parents: &[String], object_root: &str, event_root: &str, keyring_root: Option<&str>) -> String {
    digest_domain("sync-summary", &encode_cbor(&CborValue::Map(vec![
        ("commitDigest".into(), CborValue::Text(commit_digest.into())),
        ("eventRoot".into(), CborValue::Text(event_root.into())),
        ("keyringRoot".into(), keyring_root.map_or(CborValue::Null, |value| CborValue::Text(value.into()))),
        ("objectRoot".into(), CborValue::Text(object_root.into())),
        ("parents".into(), CborValue::Array(parents.iter().map(|value| CborValue::Text(value.clone())).collect())),
        ("sequence".into(), CborValue::UInt(sequence)),
        ("stateRoot".into(), CborValue::Text(state_root.into())),
        ("version".into(), CborValue::UInt(1)),
    ])))
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeAuthorityKeyV1 {
    pub version: u64,
    pub principal: String,
    pub key_id: String,
    pub algorithm: String,
    pub public_key: Vec<u8>,
    pub not_before: Option<u64>,
    pub not_after: Option<u64>,
    pub revoked_at: Option<u64>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeKeyRotationRecordV1 {
    pub version: u64,
    pub kind: String,
    pub issuer: String,
    pub issuer_key_id: String,
    pub principal: String,
    pub previous_key_id: Option<String>,
    pub key_id: String,
    pub algorithm: String,
    pub public_key: Vec<u8>,
    pub not_before: u64,
    pub not_after: Option<u64>,
    pub revoked_at: Option<u64>,
    pub issued_at: u64,
    pub expires_at: u64,
    pub signature: Vec<u8>,
}

#[derive(Debug, Clone, PartialEq)]
pub struct KnowledgeAuthorityKeyringV1 {
    pub version: u64,
    pub sequence: u64,
    pub keys: Vec<KnowledgeAuthorityKeyV1>,
    pub rotations: Vec<KnowledgeKeyRotationRecordV1>,
}

pub fn authority_key_payload_v1(key: &KnowledgeAuthorityKeyV1) -> Vec<u8> {
    encode_cbor(&authority_key_value(key))
}

pub fn key_rotation_payload_v1(record: &KnowledgeKeyRotationRecordV1) -> Vec<u8> {
    encode_cbor(&key_rotation_value(record, false))
}

pub fn key_rotation_root_v1(record: &KnowledgeKeyRotationRecordV1) -> String {
    digest_domain("key-rotation", &encode_cbor(&CborValue::Map(vec![
        ("payload".into(), CborValue::Bytes(key_rotation_payload_v1(record))),
        ("signature".into(), CborValue::Bytes(record.signature.clone())),
    ])))
}

pub fn authority_keyring_root_v1(keyring: &KnowledgeAuthorityKeyringV1) -> String {
    let mut keys = keyring.keys.iter().collect::<Vec<_>>();
    keys.sort_by(|left, right| key_sort_key(left).cmp(&key_sort_key(right)));
    digest_domain("authority-keyring", &encode_cbor(&CborValue::Map(vec![
        ("keys".into(), CborValue::Array(keys.iter().map(|key| CborValue::Bytes(authority_key_payload_v1(key))).collect())),
        ("rotations".into(), CborValue::Array(keyring.rotations.iter().map(|record| CborValue::Text(key_rotation_root_v1(record))).collect())),
        ("sequence".into(), CborValue::UInt(keyring.sequence)),
        ("version".into(), CborValue::UInt(keyring.version)),
    ])))
}

fn authority_key_value(key: &KnowledgeAuthorityKeyV1) -> CborValue {
    let mut entries = vec![
        ("algorithm".into(), CborValue::Text(key.algorithm.clone())),
        ("keyId".into(), CborValue::Text(key.key_id.clone())),
        ("principal".into(), CborValue::Text(key.principal.clone())),
        ("publicKey".into(), CborValue::Bytes(key.public_key.clone())),
        ("version".into(), CborValue::UInt(key.version)),
    ];
    if let Some(value) = key.not_after { entries.push(("notAfter".into(), CborValue::UInt(value))); }
    if let Some(value) = key.not_before { entries.push(("notBefore".into(), CborValue::UInt(value))); }
    if let Some(value) = key.revoked_at { entries.push(("revokedAt".into(), CborValue::UInt(value))); }
    CborValue::Map(entries)
}

fn key_rotation_value(record: &KnowledgeKeyRotationRecordV1, include_signature: bool) -> CborValue {
    let mut entries = vec![
        ("algorithm".into(), CborValue::Text(record.algorithm.clone())),
        ("expiresAt".into(), CborValue::UInt(record.expires_at)),
        ("issuedAt".into(), CborValue::UInt(record.issued_at)),
        ("issuer".into(), CborValue::Text(record.issuer.clone())),
        ("issuerKeyId".into(), CborValue::Text(record.issuer_key_id.clone())),
        ("keyId".into(), CborValue::Text(record.key_id.clone())),
        ("kind".into(), CborValue::Text(record.kind.clone())),
        ("notBefore".into(), CborValue::UInt(record.not_before)),
        ("publicKey".into(), CborValue::Bytes(record.public_key.clone())),
        ("principal".into(), CborValue::Text(record.principal.clone())),
        ("version".into(), CborValue::UInt(record.version)),
    ];
    if include_signature { entries.push(("signature".into(), CborValue::Bytes(record.signature.clone()))); }
    if let Some(value) = record.not_after { entries.push(("notAfter".into(), CborValue::UInt(value))); }
    if let Some(value) = &record.previous_key_id { entries.push(("previousKeyId".into(), CborValue::Text(value.clone()))); }
    if let Some(value) = record.revoked_at { entries.push(("revokedAt".into(), CborValue::UInt(value))); }
    CborValue::Map(entries)
}

fn key_sort_key(key: &KnowledgeAuthorityKeyV1) -> Vec<u8> {
    let mut out = key.principal.as_bytes().to_vec();
    out.push(0);
    out.extend_from_slice(key.key_id.as_bytes());
    out
}

pub fn verify_knowledge_authority_envelope_v5<Resolve, Verify>(
    image: &KnowledgeImage,
    query_result: &KnowledgeQueryResultV1,
    policy: &KnowledgePolicyV1,
    authorization: &KnowledgeAuthorizationResultV1,
    envelope: &KnowledgeAuthorityEnvelopeV1,
    now: u64,
    resolve_key: Resolve,
    verify_signature: Verify,
) -> Result<KnowledgeAuthorityVerificationV1, KnoloError>
where
    Resolve: Fn(&str, &str, Option<&str>) -> Option<Vec<u8>>,
    Verify: Fn(&str, &[u8], &[u8], &[u8]) -> bool,
{
    verify_knowledge_authority_envelope_with_keyring_root_v5(image, query_result, policy, authorization, envelope, now, None, resolve_key, verify_signature)
}

pub fn verify_knowledge_authority_envelope_with_keyring_root_v5<Resolve, Verify>(
    image: &KnowledgeImage,
    query_result: &KnowledgeQueryResultV1,
    policy: &KnowledgePolicyV1,
    authorization: &KnowledgeAuthorizationResultV1,
    envelope: &KnowledgeAuthorityEnvelopeV1,
    now: u64,
    expected_keyring_root: Option<&str>,
    resolve_key: Resolve,
    verify_signature: Verify,
) -> Result<KnowledgeAuthorityVerificationV1, KnoloError>
where
    Resolve: Fn(&str, &str, Option<&str>) -> Option<Vec<u8>>,
    Verify: Fn(&str, &[u8], &[u8], &[u8]) -> bool,
{
    let expected_authorization = evaluate_knowledge_query_policy_v5(image, query_result, policy, &authorization.principal, &authorization.action)?;
    if &expected_authorization != authorization { return Err(KnoloError::InvalidPack("V5 authorization result is not reproducible".into())); }
    if envelope.version != 1 || envelope.issuer.is_empty() || envelope.subject.is_empty() || envelope.algorithm.is_empty() || envelope.key_id.as_deref() == Some("") || envelope.issued_at > now || now >= envelope.expires_at { return Err(KnoloError::InvalidPack("invalid V5 authority envelope window".into())); }
    if envelope.keyring_root.is_some() && envelope.keyring_root.as_deref() != expected_keyring_root { return Err(KnoloError::InvalidPack("V5 authority keyring root mismatch".into())); }
    if authorization.state_root != image.state_root || envelope.authorization_root != authorization.authorization_root || envelope.subject != authorization.principal { return Err(KnoloError::InvalidPack("V5 authority binding mismatch".into())); }
    if envelope.delegations.len() > 8 { return Err(KnoloError::InvalidPack("V5 authority delegation depth exceeded".into())); }
    verify_authority_signature(&envelope.issuer, &envelope.algorithm, envelope.key_id.as_deref(), &authority_envelope_payload_v1(envelope), &envelope.signature, &resolve_key, &verify_signature)?;
    let mut previous = envelope.issuer.clone();
    for delegation in &envelope.delegations {
        if delegation.version != 1 || delegation.delegator.is_empty() || delegation.delegatee.is_empty() || delegation.algorithm.is_empty() || delegation.key_id.as_deref() == Some("") || delegation.action != authorization.action || delegation.issued_at > now || now >= delegation.expires_at || delegation.delegator != previous { return Err(KnoloError::InvalidPack("invalid V5 delegation chain".into())); }
        verify_authority_signature(&delegation.delegator, &delegation.algorithm, delegation.key_id.as_deref(), &delegation_payload_v1(delegation), &delegation.signature, &resolve_key, &verify_signature)?;
        previous = delegation.delegatee.clone();
    }
    if !envelope.delegations.is_empty() && previous != envelope.subject { return Err(KnoloError::InvalidPack("V5 delegation chain does not reach subject".into())); }
    Ok(KnowledgeAuthorityVerificationV1 { envelope_root: authority_envelope_root_v1(envelope), issuer: envelope.issuer.clone(), subject: envelope.subject.clone(), authorization_root: authorization.authorization_root.clone(), keyring_root: envelope.keyring_root.clone(), delegation_depth: envelope.delegations.len() })
}

fn verify_authority_signature<Resolve, Verify>(principal: &str, algorithm: &str, key_id: Option<&str>, message: &[u8], signature: &[u8], resolve_key: &Resolve, verify_signature: &Verify) -> Result<(), KnoloError>
where
    Resolve: Fn(&str, &str, Option<&str>) -> Option<Vec<u8>>,
    Verify: Fn(&str, &[u8], &[u8], &[u8]) -> bool,
{
    let key = resolve_key(principal, algorithm, key_id).ok_or_else(|| KnoloError::InvalidPack("missing V5 authority key".into()))?;
    if !verify_signature(algorithm, &key, message, signature) { return Err(KnoloError::InvalidPack("V5 authority signature verification failed".into())); }
    Ok(())
}

fn authorize_policy_hit(hit: &KnowledgeQueryHitV1, policy: &KnowledgePolicyV1, principal: &str, action: &str) -> bool {
    let matches = policy.rules.iter().filter(|rule| rule.action == action && rule.principal.as_deref().is_none_or(|value| value == principal) && rule.kind.as_deref().is_none_or(|value| value.to_lowercase() == hit.kind)).collect::<Vec<_>>();
    if matches.iter().any(|rule| rule.effect == "deny") { return false; }
    if matches.iter().any(|rule| rule.effect == "allow") { return true; }
    policy.default == "allow"
}

fn policy_rule_value(rule: &KnowledgePolicyRuleV1) -> CborValue {
    let mut entries = vec![("action".into(), CborValue::Text(rule.action.clone())), ("effect".into(), CborValue::Text(rule.effect.clone()))];
    if let Some(kind) = &rule.kind { entries.push(("kind".into(), CborValue::Text(kind.to_lowercase()))); }
    if let Some(principal) = &rule.principal { entries.push(("principal".into(), CborValue::Text(principal.clone()))); }
    CborValue::Map(entries)
}

fn policy_rule_key(rule: &KnowledgePolicyRuleV1) -> String { format!("{}\0{}\0{}\0{}", rule.effect, rule.action, rule.principal.as_deref().unwrap_or(""), rule.kind.as_deref().unwrap_or("").to_lowercase()) }

pub fn parse_knowledge_query_v5(expression: &str) -> Result<KnowledgeQueryPlanV1, KnoloError> {
    let tokens = lex_knowledge_query(expression)?;
    let mut cursor = 0usize;
    expect_query_word(&tokens, &mut cursor, "FROM")?;
    let kind_token = query_word(&tokens, &mut cursor, "FROM requires an object kind or *")?;
    let kind = if kind_token == "*" { None } else { Some(normalize_query_text(&kind_token)) };
    if kind.as_deref() == Some("") { return Err(KnoloError::InvalidPack("empty V5 EQL object kind".into())); }

    let mut filters = Vec::new();
    if query_is_word(tokens.get(cursor), "WHERE") {
        cursor += 1;
        loop {
            let field = query_word(&tokens, &mut cursor, "WHERE requires a field")?;
            let field = normalize_query_field(&field)?;
            if !matches!(tokens.get(cursor), Some(QueryToken::Equals)) {
                return Err(KnoloError::InvalidPack("V5 EQL WHERE only supports =".into()));
            }
            cursor += 1;
            let value = parse_query_literal(tokens.get(cursor))?;
            cursor += 1;
            filters.push(KnowledgeQueryFilterV1 { field, value });
            if query_is_word(tokens.get(cursor), "AND") {
                cursor += 1;
                continue;
            }
            break;
        }
    }

    let mut search = None;
    if query_is_word(tokens.get(cursor), "SEARCH") {
        cursor += 1;
        let value = match tokens.get(cursor) {
            Some(QueryToken::String(value)) => normalize_query_text(value),
            _ => return Err(KnoloError::InvalidPack("V5 EQL SEARCH requires a quoted string".into())),
        };
        cursor += 1;
        if value.is_empty() { return Err(KnoloError::InvalidPack("empty V5 EQL SEARCH".into())); }
        search = Some(value);
    }

    let mut limit = 100usize;
    if query_is_word(tokens.get(cursor), "LIMIT") {
        cursor += 1;
        let value = query_word(&tokens, &mut cursor, "LIMIT requires a positive integer")?;
        limit = value.parse::<usize>().map_err(|_| KnoloError::InvalidPack("invalid V5 EQL LIMIT".into()))?;
        if !(1..=1000).contains(&limit) { return Err(KnoloError::InvalidPack("V5 EQL LIMIT must be between 1 and 1000".into())); }
    }
    if cursor != tokens.len() { return Err(KnoloError::InvalidPack("unexpected V5 EQL token".into())); }

    filters.sort_by(|left, right| left.field.cmp(&right.field).then_with(|| query_scalar_key(&left.value).cmp(&query_scalar_key(&right.value))));
    Ok(KnowledgeQueryPlanV1 { kind, filters, search, limit })
}

pub fn query_knowledge_image_v5(image: &KnowledgeImage, expression: &str) -> Result<KnowledgeQueryResultV1, KnoloError> {
    let plan = parse_knowledge_query_v5(expression)?;
    query_knowledge_plan_v5(image, &plan)
}

fn query_knowledge_plan_v5(image: &KnowledgeImage, plan: &KnowledgeQueryPlanV1) -> Result<KnowledgeQueryResultV1, KnoloError> {
    let plan_root = digest_domain("query-plan", &encode_cbor(&query_plan_value(plan)));
    let mut objects = image.objects.iter().filter(|object| query_matches_object(object, plan)).collect::<Vec<_>>();
    objects.sort_by(|left, right| left.id.cmp(&right.id));
    let hits = objects.into_iter().take(plan.limit).map(|object| KnowledgeQueryHitV1 { object_id: object.id.clone(), kind: object.kind.clone() }).collect::<Vec<_>>();
    let object_ids = CborValue::Array(hits.iter().map(|hit| CborValue::Text(hit.object_id.clone())).collect());
    let result_value = CborValue::Map(vec![
        ("objectIds".into(), object_ids),
        ("planRoot".into(), CborValue::Text(plan_root.clone())),
        ("stateRoot".into(), CborValue::Text(image.state_root.clone())),
    ]);
    let result_root = digest_domain("query-result", &encode_cbor(&result_value));
    Ok(KnowledgeQueryResultV1 { state_root: image.state_root.clone(), plan_root, hits, result_root })
}

fn query_plan_value(plan: &KnowledgeQueryPlanV1) -> CborValue {
    CborValue::Map(vec![
        ("filters".into(), CborValue::Array(plan.filters.iter().map(|filter| CborValue::Map(vec![
            ("field".into(), CborValue::Text(filter.field.clone())),
            ("op".into(), CborValue::Text("=".into())),
            ("value".into(), filter.value.clone()),
        ])).collect())),
        ("kind".into(), plan.kind.clone().map(CborValue::Text).unwrap_or(CborValue::Null)),
        ("limit".into(), CborValue::UInt(plan.limit as u64)),
        ("search".into(), plan.search.clone().map(CborValue::Text).unwrap_or(CborValue::Null)),
        ("source".into(), CborValue::Text("knowledge-image-v5".into())),
        ("version".into(), CborValue::UInt(1)),
    ])
}

fn query_matches_object(object: &KnowledgeObjectV1, plan: &KnowledgeQueryPlanV1) -> bool {
    if plan.kind.as_deref().is_some_and(|kind| kind != object.kind) { return false; }
    for filter in &plan.filters {
        let actual = if filter.field == "id" { Some(CborValue::Text(object.id.clone())) } else if filter.field == "kind" { Some(CborValue::Text(object.kind.clone())) } else { object.meta_map_value(&filter.field[5..]).cloned() };
        if !query_scalars_equal(actual.as_ref(), Some(&filter.value)) { return false; }
    }
    if let Some(search) = &plan.search {
        let text = normalize_query_text(&String::from_utf8_lossy(&object.bytes));
        if !search.split(' ').all(|term| text.contains(term)) { return false; }
    }
    true
}

trait KnowledgeObjectMeta {
    fn meta_map_value(&self, key: &str) -> Option<&CborValue>;
}

impl KnowledgeObjectMeta for KnowledgeObjectV1 {
    fn meta_map_value(&self, key: &str) -> Option<&CborValue> {
        match &self.meta { CborValue::Map(entries) => entries.iter().find(|(name, _)| name == key).map(|(_, value)| value), _ => None }
    }
}

#[derive(Debug, Clone, PartialEq)]
enum QueryToken { Word(String), String(String), Equals }

fn lex_knowledge_query(expression: &str) -> Result<Vec<QueryToken>, KnoloError> {
    let chars = expression.chars().collect::<Vec<_>>();
    let mut tokens = Vec::new();
    let mut cursor = 0usize;
    while cursor < chars.len() {
        while chars.get(cursor).is_some_and(|ch| ch.is_whitespace()) { cursor += 1; }
        if cursor >= chars.len() { break; }
        if chars[cursor] == '=' { tokens.push(QueryToken::Equals); cursor += 1; continue; }
        if chars[cursor] == '"' {
            cursor += 1;
            let mut value = String::new();
            let mut closed = false;
            while cursor < chars.len() {
                let ch = chars[cursor]; cursor += 1;
                if ch == '"' { closed = true; break; }
                if ch == '\\' {
                    let escaped = *chars.get(cursor).ok_or_else(|| KnoloError::InvalidPack("unterminated V5 EQL string".into()))?; cursor += 1;
                    if escaped != '"' && escaped != '\\' { return Err(KnoloError::InvalidPack("unsupported V5 EQL escape".into())); }
                    value.push(escaped);
                } else { value.push(ch); }
            }
            if !closed { return Err(KnoloError::InvalidPack("unterminated V5 EQL string".into())); }
            tokens.push(QueryToken::String(value));
            continue;
        }
        let start = cursor;
        while cursor < chars.len() && !chars[cursor].is_whitespace() && chars[cursor] != '=' { cursor += 1; }
        let value = chars[start..cursor].iter().collect::<String>();
        if value.is_empty() || !value.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '.' | '*' | '-')) { return Err(KnoloError::InvalidPack("invalid V5 EQL token".into())); }
        tokens.push(QueryToken::Word(value));
    }
    Ok(tokens)
}

fn expect_query_word(tokens: &[QueryToken], cursor: &mut usize, expected: &str) -> Result<(), KnoloError> {
    if !query_is_word(tokens.get(*cursor), expected) { return Err(KnoloError::InvalidPack(format!("V5 EQL query must start with {expected}"))); }
    *cursor += 1;
    Ok(())
}

fn query_word(tokens: &[QueryToken], cursor: &mut usize, message: &str) -> Result<String, KnoloError> {
    match tokens.get(*cursor) { Some(QueryToken::Word(value)) => { *cursor += 1; Ok(value.clone()) }, _ => Err(KnoloError::InvalidPack(message.into())) }
}

fn query_is_word(token: Option<&QueryToken>, expected: &str) -> bool { matches!(token, Some(QueryToken::Word(value)) if value.eq_ignore_ascii_case(expected)) }

fn normalize_query_field(field: &str) -> Result<String, KnoloError> {
    let lower = field.to_ascii_lowercase();
    if lower == "id" || lower == "kind" { return Ok(lower); }
    if lower.strip_prefix("meta.").is_some_and(|key| !key.is_empty() && key.chars().all(|ch| ch.is_ascii_alphanumeric() || matches!(ch, '_' | '-'))) { return Ok(lower); }
    Err(KnoloError::InvalidPack(format!("unsupported V5 EQL field: {field}")))
}

fn parse_query_literal(token: Option<&QueryToken>) -> Result<CborValue, KnoloError> {
    match token {
        Some(QueryToken::String(value)) => Ok(CborValue::Text(normalize_query_text(value))),
        Some(QueryToken::Word(value)) if value == "true" => Ok(CborValue::Bool(true)),
        Some(QueryToken::Word(value)) if value == "false" => Ok(CborValue::Bool(false)),
        Some(QueryToken::Word(value)) if value == "null" => Ok(CborValue::Null),
        Some(QueryToken::Word(value)) if value.parse::<i64>().is_ok() => {
            let number = value.parse::<i64>().unwrap();
            if number >= 0 { Ok(CborValue::UInt(number as u64)) } else { Ok(CborValue::NInt(number)) }
        }
        _ => Err(KnoloError::InvalidPack("V5 EQL WHERE requires a scalar literal".into())),
    }
}

fn normalize_query_text(value: &str) -> String { value.to_lowercase().split_whitespace().collect::<Vec<_>>().join(" ") }
fn query_scalars_equal(actual: Option<&CborValue>, expected: Option<&CborValue>) -> bool {
    match (actual, expected) {
        (Some(CborValue::Text(left)), Some(CborValue::Text(right))) => normalize_query_text(left) == *right,
        _ => actual == expected,
    }
}
fn query_scalar_key(value: &CborValue) -> String {
    match value {
        CborValue::Null => "null:".into(),
        CborValue::Bool(value) => format!("boolean:{value}"),
        CborValue::UInt(value) => format!("number:{value}"),
        CborValue::NInt(value) => format!("number:{value}"),
        CborValue::Text(value) => format!("string:{value}"),
        other => format!("{other:?}"),
    }
}

pub fn migrate_v4_to_v5(bytes: &[u8]) -> Result<MigrationResult, KnoloError> {
    let pack = if bytes.starts_with(b"KNLOV4\0\0") {
        parse_v4_pack(bytes)?
    } else {
        mount_pack_from_bytes(bytes)?
    };
    build_migration_image(&pack, &digest_from_raw(&sha256(bytes)))
}

fn parse_v4_pack(bytes: &[u8]) -> Result<Pack, KnoloError> {
    if bytes.len() < 192 || &bytes[0..8] != b"KNLOV4\0\0" { return Err(KnoloError::InvalidPack("invalid V4 pack".into())); }
    let header_length = u32::from_le_bytes(bytes[12..16].try_into().unwrap()) as usize;
    let manifest_length = u32::from_le_bytes(bytes[20..24].try_into().unwrap()) as usize;
    let directory_length = u32::from_le_bytes(bytes[24..28].try_into().unwrap()) as usize;
    if header_length > bytes.len() || 192usize.checked_add(manifest_length).and_then(|n| n.checked_add(directory_length)) != Some(header_length) { return Err(KnoloError::InvalidPack("invalid V4 directory bounds".into())); }
    let manifest = bytes.get(192..192 + manifest_length).ok_or_else(|| KnoloError::InvalidPack("V4 manifest exceeds file".into()))?;
    if read_ascii_digest(&bytes[32..112]) != digest_from_raw(&sha256(manifest)) || read_ascii_digest(&bytes[112..192]) != digest_from_raw(&sha256(&bytes[header_length..])) { return Err(KnoloError::InvalidPack("V4 pack or manifest digest mismatch".into())); }
    let directory = std::str::from_utf8(&bytes[192 + manifest_length..header_length]).map_err(|_| KnoloError::InvalidPack("V4 directory is not UTF-8".into()))?;
    let (metadata_offset, metadata_length, metadata_digest) = v4_section_bounds(directory, "metadata")?;
    let metadata_end = metadata_offset.checked_add(metadata_length).ok_or_else(|| KnoloError::InvalidPack("V4 metadata overflow".into()))?;
    if metadata_end > bytes.len() || metadata_digest != digest_from_raw(&sha256(&bytes[metadata_offset..metadata_end])) { return Err(KnoloError::InvalidPack("V4 metadata digest mismatch".into())); }
    let metadata_json = std::str::from_utf8(&bytes[metadata_offset..metadata_end]).map_err(|_| KnoloError::InvalidPack("V4 metadata is not UTF-8".into()))?.to_string();
    let meta = parse_meta(&metadata_json)?;
    let claims_json = match v4_section_bounds(directory, "claims") {
        Ok((offset, length, digest)) => {
            let end = offset.checked_add(length).ok_or_else(|| KnoloError::InvalidPack("V4 claims overflow".into()))?;
            if end > bytes.len() || digest != digest_from_raw(&sha256(&bytes[offset..end])) { return Err(KnoloError::InvalidPack("V4 claims digest mismatch".into())); }
            Some(std::str::from_utf8(&bytes[offset..end]).map_err(|_| KnoloError::InvalidPack("V4 claims are not UTF-8".into()))?.to_string())
        }
        Err(_) => None,
    };
    let (chunks_offset, chunks_length, chunks_digest) = v4_section_bounds(directory, "chunks")?;
    let chunks_end = chunks_offset.checked_add(chunks_length).ok_or_else(|| KnoloError::InvalidPack("V4 chunks overflow".into()))?;
    if chunks_end > bytes.len() { return Err(KnoloError::InvalidPack("V4 chunks exceed file".into())); }
    if chunks_digest != digest_from_raw(&sha256(&bytes[chunks_offset..chunks_end])) { return Err(KnoloError::InvalidPack("V4 chunks digest mismatch".into())); }
    let parsed = parse_blocks(std::str::from_utf8(&bytes[chunks_offset..chunks_end]).map_err(|_| KnoloError::InvalidPack("V4 chunks are not UTF-8".into()))?)?;
    let count = parsed.texts.len();
    Ok(Pack { meta: PackMeta { stats: PackStats { docs: count, blocks: count, ..meta.stats }, ..meta }, lexicon: HashMap::new(), postings: Vec::new(), blocks: parsed.texts, headings: parsed.headings, doc_ids: parsed.doc_ids, namespaces: parsed.namespaces, block_token_lens: parsed.lens, metadata_json, claims_json })
}

fn v4_section_bounds(directory: &str, name: &str) -> Result<(usize, usize, String), KnoloError> {
    let marker = format!("\"name\":\"{name}\"");
    let start = directory.find(&marker).ok_or_else(|| KnoloError::InvalidPack(format!("missing V4 section: {name}")))?;
    let entry = &directory[start..];
    let offset = json_number_after(entry, "\"offset\":")? as usize;
    let length = json_number_after(entry, "\"length\":")? as usize;
    let digest = json_string_after(entry, "\"digest\":\"")?;
    Ok((offset, length, digest))
}

fn json_number_after(input: &str, marker: &str) -> Result<u64, KnoloError> {
    let start = input.find(marker).ok_or_else(|| KnoloError::InvalidPack("missing V4 directory number".into()))? + marker.len();
    let digits = input[start..].chars().take_while(|ch| ch.is_ascii_digit()).collect::<String>();
    digits.parse::<u64>().map_err(|_| KnoloError::InvalidPack("invalid V4 directory number".into()))
}

fn json_string_after(input: &str, marker: &str) -> Result<String, KnoloError> {
    let start = input.find(marker).ok_or_else(|| KnoloError::InvalidPack("missing V4 directory digest".into()))? + marker.len();
    let end = input[start..].find('"').ok_or_else(|| KnoloError::InvalidPack("invalid V4 directory digest".into()))?;
    Ok(input[start..start + end].to_string())
}

fn json_field_raw(input: &str, key: &str) -> Option<String> {
    let marker = format!("\"{key}\":");
    let start = input.find(&marker)? + marker.len();
    let bytes = input.as_bytes();
    let first = *bytes.get(start)?;
    if first == b'{' || first == b'[' {
        let open = first;
        let close = if open == b'{' { b'}' } else { b']' };
        let mut depth = 0usize;
        let mut in_string = false;
        let mut escaped = false;
        for index in start..bytes.len() {
            let byte = bytes[index];
            if in_string {
                if escaped { escaped = false; } else if byte == b'\\' { escaped = true; } else if byte == b'"' { in_string = false; }
                continue;
            }
            if byte == b'"' { in_string = true; continue; }
            if byte == open { depth += 1; }
            if byte == close { depth -= 1; if depth == 0 { return Some(input[start..=index].to_string()); } }
        }
        None
    } else {
        let end = input[start..].find(',').map(|offset| start + offset).unwrap_or(input.len());
        Some(input[start..end].trim().to_string())
    }
}

fn read_ascii_digest(bytes: &[u8]) -> String {
    let end = bytes.iter().position(|byte| *byte == 0).unwrap_or(bytes.len());
    String::from_utf8_lossy(&bytes[..end]).to_string()
}

#[derive(Clone)]
struct MigrationObject { id: String, kind: String, bytes: Vec<u8>, meta: CborValue }

fn build_migration_image(pack: &Pack, source_digest: &str) -> Result<MigrationResult, KnoloError> {
    let actor = "knolo-v4-migrator";
    let mut objects = Vec::new();
    let mut mappings = Vec::new();
    for (index, text) in pack.blocks.iter().enumerate() {
        let source_bytes = text.as_bytes().to_vec();
        let source_meta = CborValue::Map(vec![
            ("docId".into(), pack.doc_ids.get(index).and_then(|value| value.clone()).map(CborValue::Text).unwrap_or(CborValue::Null)),
            ("legacyBlockId".into(), CborValue::UInt(index as u64)),
            ("namespace".into(), pack.namespaces.get(index).and_then(|value| value.clone()).map(CborValue::Text).unwrap_or(CborValue::Null)),
        ]);
        let source_body = CborValue::Map(vec![("bytes".into(), CborValue::Bytes(source_bytes.clone())), ("kind".into(), CborValue::Text("source".into())), ("meta".into(), source_meta.clone())]);
        let source_id = digest_domain("object", &encode_cbor(&source_body));
        let chunk_meta = CborValue::Map(vec![
            ("docId".into(), pack.doc_ids.get(index).and_then(|value| value.clone()).map(CborValue::Text).unwrap_or(CborValue::Null)),
            ("heading".into(), pack.headings.get(index).and_then(|value| value.clone()).map(CborValue::Text).unwrap_or(CborValue::Null)),
            ("legacyBlockId".into(), CborValue::UInt(index as u64)),
            ("namespace".into(), pack.namespaces.get(index).and_then(|value| value.clone()).map(CborValue::Text).unwrap_or(CborValue::Null)),
            ("sourceObject".into(), CborValue::Text(source_id.clone())),
            ("span".into(), CborValue::Map(vec![("end".into(), CborValue::UInt(text.len() as u64)), ("start".into(), CborValue::UInt(0))])),
        ]);
        let chunk_body = CborValue::Map(vec![("bytes".into(), CborValue::Bytes(source_bytes.clone())), ("kind".into(), CborValue::Text("chunk".into())), ("meta".into(), chunk_meta.clone())]);
        let chunk_id = digest_domain("object", &encode_cbor(&chunk_body));
        objects.push(MigrationObject { id: source_id.clone(), kind: "source".into(), bytes: source_bytes.clone(), meta: source_meta });
        objects.push(MigrationObject { id: chunk_id.clone(), kind: "chunk".into(), bytes: source_bytes, meta: chunk_meta });
        mappings.push(MigrationMapping { legacy_block_id: index, source_object: source_id, chunk_object: chunk_id });
    }
    if let Some(claims_json) = &pack.claims_json {
        let bytes = claims_json.as_bytes().to_vec();
        let meta = CborValue::Map(vec![("encoding".into(), CborValue::Text("json-v4".into())), ("version".into(), CborValue::UInt(1))]);
        let body = CborValue::Map(vec![("bytes".into(), CborValue::Bytes(bytes.clone())), ("kind".into(), CborValue::Text("claims".into())), ("meta".into(), meta.clone())]);
        objects.push(MigrationObject { id: digest_domain("object", &encode_cbor(&body)), kind: "claims".into(), bytes, meta });
    }
    if let Some(agents_json) = json_field_raw(&pack.metadata_json, "agents") {
        let bytes = agents_json.as_bytes().to_vec();
        let meta = CborValue::Map(vec![("encoding".into(), CborValue::Text("json-v4".into())), ("version".into(), CborValue::UInt(1))]);
        let body = CborValue::Map(vec![("bytes".into(), CborValue::Bytes(bytes.clone())), ("kind".into(), CborValue::Text("agents".into())), ("meta".into(), meta.clone())]);
        objects.push(MigrationObject { id: digest_domain("object", &encode_cbor(&body)), kind: "agents".into(), bytes, meta });
    }
    let metadata_meta = CborValue::Map(vec![("sourceDigest".into(), CborValue::Text(source_digest.into())), ("sourceVersion".into(), CborValue::UInt(pack.meta.version as u64))]); let metadata_bytes = encode_cbor(&metadata_meta); let metadata_body = CborValue::Map(vec![("bytes".into(), CborValue::Bytes(metadata_bytes.clone())), ("kind".into(), CborValue::Text("metadata".into())), ("meta".into(), metadata_meta.clone())]);
    objects.push(MigrationObject { id: digest_domain("object", &encode_cbor(&metadata_body)), kind: "metadata".into(), bytes: metadata_bytes, meta: metadata_meta });
    objects.sort_by(|left, right| left.id.cmp(&right.id));
    let object_values = objects.iter().map(|object| CborValue::Map(vec![("bytes".into(), CborValue::Bytes(object.bytes.clone())), ("id".into(), CborValue::Text(object.id.clone())), ("kind".into(), CborValue::Text(object.kind.clone())), ("meta".into(), object.meta.clone())])).collect::<Vec<_>>();
    let object_payload = encode_cbor(&CborValue::Array(object_values));
    let object_segment_digest = digest_domain("segment", &object_payload);
    let object_ids = objects.iter().map(|object| CborValue::Text(object.id.clone())).collect::<Vec<_>>();
    let parents = CborValue::Array(Vec::new());
    let transaction_id = digest_domain("transaction", &encode_cbor(&CborValue::Map(vec![("actor".into(), CborValue::Text(actor.into())), ("objects".into(), CborValue::Array(object_ids.clone())), ("parents".into(), parents.clone())])));
    let mut events = Vec::new();
    for (index, object) in objects.iter().enumerate() {
        let event_kind = if object.kind == "chunk" { "document.put".to_string() } else { format!("{}.put", object.kind) };
        let event_body = CborValue::Map(vec![("actor".into(), CborValue::Text(actor.into())), ("actorCounter".into(), CborValue::UInt(index as u64 + 1)), ("kind".into(), CborValue::Text(event_kind.into())), ("parents".into(), if index == 0 { CborValue::Array(Vec::new()) } else { CborValue::Array(vec![CborValue::Text(transaction_id.clone())]) }), ("payload".into(), CborValue::Text(object.id.clone())), ("provenance".into(), CborValue::Map(vec![("objectId".into(), CborValue::Text(object.id.clone()))])), ("target".into(), CborValue::Text(object.id.clone())), ("transactionId".into(), CborValue::Text(transaction_id.clone())), ("version".into(), CborValue::UInt(1))]);
        let event_id = digest_domain("event", &encode_cbor(&event_body));
        events.push((event_id, event_body));
    }
    events.sort_by(|left, right| left.0.cmp(&right.0));
    let event_values = events.iter().map(|(id, body)| { let mut entries = match body { CborValue::Map(entries) => entries.clone(), _ => Vec::new() }; entries.push(("id".into(), CborValue::Text(id.clone()))); CborValue::Map(entries) }).collect::<Vec<_>>();
    let event_payload = encode_cbor(&CborValue::Array(event_values));
    let event_segment_digest = digest_domain("segment", &event_payload);
    let event_ids = events.iter().map(|(id, _)| CborValue::Text(id.clone())).collect::<Vec<_>>();
    let object_root = digest_domain("object-root", &encode_cbor(&CborValue::Array(object_ids.clone())));
    let event_root = digest_domain("event-root", &encode_cbor(&CborValue::Array(event_ids.clone())));
    let lexical_view = digest_domain("view", &encode_cbor(&CborValue::Map(vec![("kind".into(), CborValue::Text("lexical".into())), ("objectIds".into(), CborValue::Array(object_ids.clone()))])));
    let commit_value = CborValue::Map(vec![("actor".into(), CborValue::Text(actor.into())), ("eventRoot".into(), CborValue::Text(event_root.clone())), ("eventSegmentDigest".into(), CborValue::Text(event_segment_digest)), ("objectRoot".into(), CborValue::Text(object_root.clone())), ("objectSegmentDigest".into(), CborValue::Text(object_segment_digest)), ("parents".into(), parents), ("policyRoot".into(), CborValue::Text(digest_domain("policy", &encode_cbor(&CborValue::Map(vec![("default".into(), CborValue::Text("deny".into()))]))))), ("runtimeContract".into(), CborValue::Text(digest_domain("runtime", &encode_cbor(&CborValue::Map(vec![("codec".into(), CborValue::Text("cbor-v1".into())), ("format".into(), CborValue::UInt(5))]))))), ("schemaRoot".into(), CborValue::Text(digest_domain("schema", &encode_cbor(&CborValue::Map(vec![("version".into(), CborValue::UInt(1))]))))), ("sequence".into(), CborValue::UInt(1)), ("transactionRoot".into(), CborValue::Text(digest_domain("transaction-root", &encode_cbor(&CborValue::Map(vec![("eventIds".into(), CborValue::Array(event_ids)), ("objectIds".into(), CborValue::Array(object_ids)), ("transactionId".into(), CborValue::Text(transaction_id))]))))), ("version".into(), CborValue::UInt(1)), ("views".into(), CborValue::Map(vec![("lexical".into(), CborValue::Text(lexical_view))]))]);
    let commit_payload = encode_cbor(&commit_value); let commit_digest = digest_domain("commit", &commit_payload); let state = digest_domain("state", &digest_raw(&commit_digest));
    let object_segment = encode_v5_segment(1, &object_payload); let event_segment = encode_v5_segment(2, &event_payload); let commit_segment = encode_v5_segment(3, &commit_payload); let commit_offset = V5_DATA_START + object_segment.len() + event_segment.len();
    let mut image = vec![0u8; V5_DATA_START + object_segment.len() + event_segment.len() + commit_segment.len()]; image[0..8].copy_from_slice(KNOWLEDGE_IMAGE_V5_MAGIC); image[8..10].copy_from_slice(&5u16.to_le_bytes()); image[12..14].copy_from_slice(&(V5_SUPERBLOCK_SIZE as u16).to_le_bytes()); image[V5_DATA_START..V5_DATA_START + object_segment.len()].copy_from_slice(&object_segment); image[V5_DATA_START + object_segment.len()..commit_offset].copy_from_slice(&event_segment); image[commit_offset..].copy_from_slice(&commit_segment); let superblock = encode_v5_superblock(1, commit_offset, commit_segment.len(), &commit_digest, &state); image[V5_HEADER_SIZE..V5_HEADER_SIZE + V5_SUPERBLOCK_SIZE].copy_from_slice(&superblock);
    let receipt_body = CborValue::Map(vec![("kind".into(), CborValue::Text("v4-to-v5-migration".into())), ("objectMappings".into(), CborValue::Array(mappings.iter().map(|mapping| CborValue::Map(vec![("chunkObject".into(), CborValue::Text(mapping.chunk_object.clone())), ("legacyBlockId".into(), CborValue::UInt(mapping.legacy_block_id as u64)), ("sourceObject".into(), CborValue::Text(mapping.source_object.clone()))])).collect())), ("sourceDigest".into(), CborValue::Text(source_digest.into())), ("sourceVersion".into(), CborValue::UInt(pack.meta.version as u64)), ("stateRoot".into(), CborValue::Text(state.clone())), ("version".into(), CborValue::UInt(1))]); let receipt_digest = digest_domain("receipt", &encode_cbor(&receipt_body)); let mut receipt_entries = match receipt_body { CborValue::Map(entries) => entries, _ => Vec::new() }; receipt_entries.push(("receiptDigest".into(), CborValue::Text(receipt_digest))); let receipt = encode_cbor(&CborValue::Map(receipt_entries));
    Ok(MigrationResult { image, receipt, state_root: state, mappings })
}

fn encode_v5_segment(kind: u8, payload: &[u8]) -> Vec<u8> { let mut out = vec![0u8; V5_SEGMENT_HEADER_SIZE + payload.len()]; out[0..4].copy_from_slice(SEGMENT_MAGIC); out[4] = kind; out[5] = 1; out[8..16].copy_from_slice(&(payload.len() as u64).to_le_bytes()); out[16..48].copy_from_slice(&digest_raw(&digest_domain("segment", payload))); out[V5_SEGMENT_HEADER_SIZE..].copy_from_slice(payload); out }
fn encode_v5_superblock(generation: u64, commit_offset: usize, commit_length: usize, commit_digest: &str, state: &str) -> Vec<u8> { let mut out = vec![0u8; V5_SUPERBLOCK_SIZE]; out[0..8].copy_from_slice(SUPERBLOCK_MAGIC); out[8..16].copy_from_slice(&generation.to_le_bytes()); out[16..24].copy_from_slice(&(commit_offset as u64).to_le_bytes()); out[24..32].copy_from_slice(&(commit_length as u64).to_le_bytes()); out[32..64].copy_from_slice(&digest_raw(commit_digest)); out[64..96].copy_from_slice(&digest_raw(state)); let digest = digest_raw(&digest_domain("superblock", &out[0..96])); out[96..128].copy_from_slice(&digest); out }

fn parse_v5_image(bytes: &[u8]) -> Result<KnowledgeImage, KnoloError> {
    if bytes.len() < V5_DATA_START { return Err(KnoloError::InvalidPack("V5 image is truncated".into())); }
    if &bytes[0..8] != KNOWLEDGE_IMAGE_V5_MAGIC { return Err(KnoloError::InvalidPack("invalid V5 image magic".into())); }
    if le_u16(bytes, 8)? != 5 || le_u16(bytes, 12)? as usize != V5_SUPERBLOCK_SIZE { return Err(KnoloError::InvalidPack("unsupported V5 image header".into())); }

    let a = read_v5_superblock(bytes, V5_HEADER_SIZE, 'A');
    let b = read_v5_superblock(bytes, V5_HEADER_SIZE + V5_SUPERBLOCK_SIZE, 'B');
    let mut candidates = [a, b].into_iter().flatten().collect::<Vec<_>>();
    if candidates.is_empty() { return Err(KnoloError::InvalidPack("no valid V5 superblock".into())); }

    let mut segments = Vec::new();
    let mut offset = V5_DATA_START;
    let mut required_seen = [false; 3];
    while offset < bytes.len() {
        let segment = read_v5_segment(bytes, offset)?;
        if !matches!(segment.kind, 1..=3) && segment.kind < 128 { return Err(KnoloError::InvalidPack("unknown non-optional V5 segment".into())); }
        if segment.kind <= 3 && segment.schema != 1 { return Err(KnoloError::InvalidPack("unsupported required V5 segment schema".into())); }
        if (1..=3).contains(&segment.kind) {
            if required_seen[segment.kind as usize - 1] { return Err(KnoloError::InvalidPack("duplicate required V5 segment".into())); }
            required_seen[segment.kind as usize - 1] = true;
        }
        offset += segment.length;
        segments.push(segment);
    }
    if offset != bytes.len() || required_seen.iter().any(|seen| !seen) { return Err(KnoloError::InvalidPack("missing or misaligned V5 segment".into())); }

    let commit_segment = segments.iter().find(|segment| segment.kind == 3).ok_or_else(|| KnoloError::InvalidPack("missing V5 commit segment".into()))?;
    let object_segment = segments.iter().find(|segment| segment.kind == 1).ok_or_else(|| KnoloError::InvalidPack("missing V5 object segment".into()))?;
    let event_segment = segments.iter().find(|segment| segment.kind == 2).ok_or_else(|| KnoloError::InvalidPack("missing V5 event segment".into()))?;
    let commit_payload = &bytes[commit_segment.offset + V5_SEGMENT_HEADER_SIZE..commit_segment.offset + commit_segment.length];
    let commit_value = decode_cbor_exact(commit_payload)?;
    if encode_cbor(&commit_value) != commit_payload { return Err(KnoloError::InvalidPack("non-canonical V5 commit CBOR".into())); }
    let mut commit = parse_commit(&commit_value)?;
    let commit_digest = digest_domain("commit", commit_payload);
    let state = digest_domain("state", &digest_raw(&commit_digest));
    candidates.sort_by(|left, right| right.generation.cmp(&left.generation));
    let active = candidates.into_iter().find(|candidate| candidate.commit_offset == commit_segment.offset && candidate.commit_length == commit_segment.length && candidate.commit_digest == commit_digest && candidate.state_root == state).ok_or_else(|| KnoloError::InvalidPack("no V5 superblock points to a valid commit".into()))?;
    commit.state_root = state.clone();
    commit.commit_digest = commit_digest.clone();
    if commit_field(&commit_value, "objectSegmentDigest")? != object_segment.digest || commit_field(&commit_value, "eventSegmentDigest")? != event_segment.digest { return Err(KnoloError::InvalidPack("V5 segment digest mismatch".into())); }

    let objects = parse_objects(&bytes[object_segment.offset + V5_SEGMENT_HEADER_SIZE..object_segment.offset + object_segment.length])?;
    let events = parse_events(&bytes[event_segment.offset + V5_SEGMENT_HEADER_SIZE..event_segment.offset + event_segment.length])?;
    let object_ids = CborValue::Array(objects.iter().map(|object| CborValue::Text(object.id.clone())).collect());
    let event_ids = CborValue::Array(events.iter().map(|event| CborValue::Text(event.id.clone())).collect());
    if digest_domain("object-root", &encode_cbor(&object_ids)) != commit.object_root || digest_domain("event-root", &encode_cbor(&event_ids)) != commit.event_root { return Err(KnoloError::InvalidPack("V5 object/event root mismatch".into())); }

    Ok(KnowledgeImage { state_root: state, commit_digest, commit, objects, events, segments, active_superblock: active.slot })
}

#[derive(Debug, Clone)]
struct V5Superblock { generation: u64, commit_offset: usize, commit_length: usize, commit_digest: String, state_root: String, slot: char }

fn read_v5_superblock(bytes: &[u8], offset: usize, slot: char) -> Option<V5Superblock> {
    let raw = bytes.get(offset..offset + V5_SUPERBLOCK_SIZE)?;
    if raw.get(0..8)? != SUPERBLOCK_MAGIC { return None; }
    let generation = u64::from_le_bytes(raw.get(8..16)?.try_into().ok()?);
    let commit_offset = usize::try_from(u64::from_le_bytes(raw.get(16..24)?.try_into().ok()?)).ok()?;
    let commit_length = usize::try_from(u64::from_le_bytes(raw.get(24..32)?.try_into().ok()?)).ok()?;
    if commit_length < V5_SEGMENT_HEADER_SIZE || commit_offset.checked_add(commit_length)? > bytes.len() { return None; }
    let commit_digest = digest_from_raw(raw.get(32..64)?);
    let state_root = digest_from_raw(raw.get(64..96)?);
    if digest_from_raw(raw.get(96..128)?) != digest_domain("superblock", raw.get(0..96)?) { return None; }
    Some(V5Superblock { generation, commit_offset, commit_length, commit_digest, state_root, slot })
}

fn read_v5_segment(bytes: &[u8], offset: usize) -> Result<KnowledgeImageSegment, KnoloError> {
    let header = read_slice(bytes, &mut offset.clone(), V5_SEGMENT_HEADER_SIZE)?;
    if header.get(0..4) != Some(SEGMENT_MAGIC) { return Err(KnoloError::InvalidPack("invalid V5 segment magic".into())); }
    let kind = header[4]; let schema = header[5]; let flags = u16::from_le_bytes([header[6], header[7]]);
    let payload_length = usize::try_from(u64::from_le_bytes(header[8..16].try_into().unwrap())).map_err(|_| KnoloError::InvalidPack("V5 segment length overflow".into()))?;
    if payload_length as u64 > V5_MAX_SEGMENT { return Err(KnoloError::InvalidPack("V5 segment exceeds safety limit".into())); }
    let length = V5_SEGMENT_HEADER_SIZE.checked_add(payload_length).ok_or_else(|| KnoloError::InvalidPack("V5 segment length overflow".into()))?;
    let payload = bytes.get(offset + V5_SEGMENT_HEADER_SIZE..offset + length).ok_or_else(|| KnoloError::InvalidPack("V5 segment exceeds file".into()))?;
    let digest = digest_from_raw(&header[16..48]);
    if digest != digest_domain("segment", payload) { return Err(KnoloError::InvalidPack("V5 segment digest mismatch".into())); }
    Ok(KnowledgeImageSegment { kind, schema, flags, offset, length, payload_length, digest })
}

fn parse_objects(payload: &[u8]) -> Result<Vec<KnowledgeObjectV1>, KnoloError> {
    let value = decode_cbor_exact(payload)?;
    if encode_cbor(&value) != payload { return Err(KnoloError::InvalidPack("non-canonical V5 object CBOR".into())); }
    let entries = match value { CborValue::Array(items) => items, _ => return Err(KnoloError::InvalidPack("invalid V5 object segment".into())) };
    entries.into_iter().map(|entry| {
        let map = as_map(&entry)?;
        let id = map_text(map, "id")?; let kind = map_text(map, "kind")?; let bytes = map_bytes(map, "bytes")?; let meta = map_value(map, "meta")?.clone();
        let body = CborValue::Map(vec![("bytes".into(), CborValue::Bytes(bytes.clone())), ("kind".into(), CborValue::Text(kind.clone())), ("meta".into(), meta.clone())]);
        if digest_domain("object", &encode_cbor(&body)) != id { return Err(KnoloError::InvalidPack("V5 object identity mismatch".into())); }
        Ok(KnowledgeObjectV1 { id, kind, bytes, meta })
    }).collect()
}

fn parse_events(payload: &[u8]) -> Result<Vec<KnowledgeEventV1>, KnoloError> {
    let value = decode_cbor_exact(payload)?;
    if encode_cbor(&value) != payload { return Err(KnoloError::InvalidPack("non-canonical V5 event CBOR".into())); }
    let entries = match value { CborValue::Array(items) => items, _ => return Err(KnoloError::InvalidPack("invalid V5 event segment".into())) };
    entries.into_iter().map(|entry| {
        let map = as_map(&entry)?; let id = map_text(map, "id")?; let version = map_uint(map, "version")?; if version != 1 { return Err(KnoloError::InvalidPack("unsupported V5 event version".into())); }
        let transaction_id = map_text(map, "transactionId")?; let actor = map_text(map, "actor")?; let actor_counter = map_uint(map, "actorCounter")?; let kind = map_text(map, "kind")?; let target = map_text(map, "target")?; let payload_id = map_text(map, "payload")?;
        let body = CborValue::Map(vec![("actor".into(), CborValue::Text(actor.clone())), ("actorCounter".into(), CborValue::UInt(actor_counter)), ("kind".into(), CborValue::Text(kind.clone())), ("parents".into(), map_value(map, "parents")?.clone()), ("payload".into(), CborValue::Text(payload_id.clone())), ("provenance".into(), map_value(map, "provenance")?.clone()), ("target".into(), CborValue::Text(target.clone())), ("transactionId".into(), CborValue::Text(transaction_id.clone())), ("version".into(), CborValue::UInt(1))]);
        if digest_domain("event", &encode_cbor(&body)) != id { return Err(KnoloError::InvalidPack("V5 event identity mismatch".into())); }
        Ok(KnowledgeEventV1 { id, transaction_id, actor, actor_counter, kind, target, payload: payload_id })
    }).collect()
}

fn parse_commit(value: &CborValue) -> Result<KnowledgeCommitV1, KnoloError> {
    let map = as_map(value)?; let version = map_uint(map, "version")?; if version != 1 { return Err(KnoloError::InvalidPack("unsupported V5 commit version".into())); }
    Ok(KnowledgeCommitV1 { state_root: String::new(), commit_digest: String::new(), parents: map_strings(map, "parents")?, object_root: map_text(map, "objectRoot")?, event_root: map_text(map, "eventRoot")?, policy_root: map_text(map, "policyRoot")?, sequence: map_uint(map, "sequence")?, actor: map_text(map, "actor")? })
}

fn commit_field(value: &CborValue, field: &str) -> Result<String, KnoloError> { map_text(as_map(value)?, field) }

fn as_map(value: &CborValue) -> Result<&[(String, CborValue)], KnoloError> { match value { CborValue::Map(entries) => Ok(entries), _ => Err(KnoloError::InvalidPack("expected V5 CBOR map".into())) } }
fn map_value<'a>(map: &'a [(String, CborValue)], key: &str) -> Result<&'a CborValue, KnoloError> { map.iter().find(|(name, _)| name == key).map(|(_, value)| value).ok_or_else(|| KnoloError::InvalidPack(format!("missing V5 field: {key}"))) }
fn map_text(map: &[(String, CborValue)], key: &str) -> Result<String, KnoloError> { match map_value(map, key)? { CborValue::Text(value) => Ok(value.clone()), _ => Err(KnoloError::InvalidPack(format!("V5 field is not text: {key}"))) } }
fn map_uint(map: &[(String, CborValue)], key: &str) -> Result<u64, KnoloError> { match map_value(map, key)? { CborValue::UInt(value) => Ok(*value), _ => Err(KnoloError::InvalidPack(format!("V5 field is not unsigned: {key}"))) } }
fn map_bytes(map: &[(String, CborValue)], key: &str) -> Result<Vec<u8>, KnoloError> { match map_value(map, key)? { CborValue::Bytes(value) => Ok(value.clone()), _ => Err(KnoloError::InvalidPack(format!("V5 field is not bytes: {key}"))) } }
fn map_strings(map: &[(String, CborValue)], key: &str) -> Result<Vec<String>, KnoloError> { match map_value(map, key)? { CborValue::Array(values) => values.iter().map(|value| match value { CborValue::Text(text) => Ok(text.clone()), _ => Err(KnoloError::InvalidPack("V5 array value is not text".into())) }).collect(), _ => Err(KnoloError::InvalidPack(format!("V5 field is not an array: {key}"))) } }

fn decode_cbor_exact(bytes: &[u8]) -> Result<CborValue, KnoloError> { let mut cursor = 0; let value = decode_cbor(bytes, &mut cursor)?; if cursor != bytes.len() { return Err(KnoloError::InvalidPack("trailing V5 CBOR bytes".into())); } Ok(value) }
fn decode_cbor(bytes: &[u8], cursor: &mut usize) -> Result<CborValue, KnoloError> {
    let initial = *bytes.get(*cursor).ok_or_else(|| KnoloError::InvalidPack("truncated V5 CBOR".into()))?; *cursor += 1; let major = initial >> 5; let ai = initial & 31;
    let length = |cursor: &mut usize| read_cbor_length(bytes, cursor, ai);
    match major { 0 => Ok(CborValue::UInt(length(cursor)?)), 1 => { let value = length(cursor)?; if value > i64::MAX as u64 { return Err(KnoloError::InvalidPack("V5 negative integer overflow".into())); } Ok(CborValue::NInt(-1 - value as i64)) }, 2 => { let len = usize::try_from(length(cursor)?).map_err(|_| KnoloError::InvalidPack("V5 bytes length overflow".into()))?; Ok(CborValue::Bytes(read_slice(bytes, cursor, len)?.to_vec())) }, 3 => { let len = usize::try_from(length(cursor)?).map_err(|_| KnoloError::InvalidPack("V5 text length overflow".into()))?; let value = std::str::from_utf8(read_slice(bytes, cursor, len)?).map_err(|_| KnoloError::InvalidPack("V5 text is not UTF-8".into()))?; Ok(CborValue::Text(value.to_string())) }, 4 => { let len = usize::try_from(length(cursor)?).map_err(|_| KnoloError::InvalidPack("V5 array length overflow".into()))?; let mut values = Vec::with_capacity(len); for _ in 0..len { values.push(decode_cbor(bytes, cursor)?); } Ok(CborValue::Array(values)) }, 5 => { let len = usize::try_from(length(cursor)?).map_err(|_| KnoloError::InvalidPack("V5 map length overflow".into()))?; let mut values = Vec::with_capacity(len); for _ in 0..len { let key = match decode_cbor(bytes, cursor)? { CborValue::Text(value) => value, _ => return Err(KnoloError::InvalidPack("V5 map key is not text".into())) }; if values.iter().any(|(name, _): &(String, CborValue)| name == &key) { return Err(KnoloError::InvalidPack("duplicate V5 map key".into())); } values.push((key, decode_cbor(bytes, cursor)?)); } Ok(CborValue::Map(values)) }, 7 if ai == 20 => Ok(CborValue::Bool(false)), 7 if ai == 21 => Ok(CborValue::Bool(true)), 7 if ai == 22 => Ok(CborValue::Null), _ => Err(KnoloError::InvalidPack("unsupported V5 CBOR type".into())) }
}
fn read_cbor_length(bytes: &[u8], cursor: &mut usize, ai: u8) -> Result<u64, KnoloError> { match ai { 0..=23 => Ok(ai as u64), 24 => Ok(read_slice(bytes, cursor, 1)?[0] as u64), 25 => Ok(u16::from_be_bytes(read_slice(bytes, cursor, 2)?.try_into().unwrap()) as u64), 26 => Ok(u32::from_be_bytes(read_slice(bytes, cursor, 4)?.try_into().unwrap()) as u64), 27 => Ok(u64::from_be_bytes(read_slice(bytes, cursor, 8)?.try_into().unwrap())), _ => Err(KnoloError::InvalidPack("indefinite V5 CBOR is not allowed".into())) } }

fn encode_cbor(value: &CborValue) -> Vec<u8> { let mut out = Vec::new(); encode_cbor_into(value, &mut out); out }
fn encode_cbor_into(value: &CborValue, out: &mut Vec<u8>) { match value { CborValue::Null => out.push(0xf6), CborValue::Bool(false) => out.push(0xf4), CborValue::Bool(true) => out.push(0xf5), CborValue::UInt(value) => encode_cbor_length(0, *value, out), CborValue::NInt(value) => encode_cbor_length(1, (-1 - *value) as u64, out), CborValue::Bytes(value) => { encode_cbor_length(2, value.len() as u64, out); out.extend_from_slice(value); }, CborValue::Text(value) => { encode_cbor_length(3, value.len() as u64, out); out.extend_from_slice(value.as_bytes()); }, CborValue::Array(values) => { encode_cbor_length(4, values.len() as u64, out); for value in values { encode_cbor_into(value, out); } }, CborValue::Map(values) => { let mut sorted = values.iter().collect::<Vec<_>>(); sorted.sort_by(|left, right| left.0.as_bytes().cmp(right.0.as_bytes())); encode_cbor_length(5, sorted.len() as u64, out); for (key, value) in sorted { encode_cbor_into(&CborValue::Text(key.clone()), out); encode_cbor_into(value, out); } } } }
fn encode_cbor_length(major: u8, value: u64, out: &mut Vec<u8>) { if value < 24 { out.push((major << 5) | value as u8); } else if value <= u8::MAX as u64 { out.extend_from_slice(&[(major << 5) | 24, value as u8]); } else if value <= u16::MAX as u64 { out.push((major << 5) | 25); out.extend_from_slice(&(value as u16).to_be_bytes()); } else if value <= u32::MAX as u64 { out.push((major << 5) | 26); out.extend_from_slice(&(value as u32).to_be_bytes()); } else { out.push((major << 5) | 27); out.extend_from_slice(&value.to_be_bytes()); } }

fn digest_domain(domain: &str, payload: &[u8]) -> String { let mut input = format!("knolo:{domain}:v1\0").into_bytes(); input.extend_from_slice(payload); digest_from_raw(&sha256(&input)) }
fn digest_from_raw(raw: &[u8]) -> String { format!("sha256-{}", raw.iter().map(|byte| format!("{byte:02x}")).collect::<String>()) }
fn digest_raw(digest: &str) -> Vec<u8> { let hex = digest.strip_prefix("sha256-").unwrap_or(""); (0..hex.len()).step_by(2).filter_map(|i| u8::from_str_radix(hex.get(i..i + 2)?, 16).ok()).collect() }

fn le_u16(bytes: &[u8], offset: usize) -> Result<u16, KnoloError> { Ok(u16::from_le_bytes(read_slice(bytes, &mut offset.clone(), 2)?.try_into().unwrap())) }

// Minimal SHA-256 implementation for the dependency-free Rust kernel.
fn sha256(input: &[u8]) -> [u8; 32] {
    const K: [u32; 64] = [
        0x428a2f98,0x71374491,0xb5c0fbcf,0xe9b5dba5,0x3956c25b,0x59f111f1,0x923f82a4,0xab1c5ed5,
        0xd807aa98,0x12835b01,0x243185be,0x550c7dc3,0x72be5d74,0x80deb1fe,0x9bdc06a7,0xc19bf174,
        0xe49b69c1,0xefbe4786,0x0fc19dc6,0x240ca1cc,0x2de92c6f,0x4a7484aa,0x5cb0a9dc,0x76f988da,
        0x983e5152,0xa831c66d,0xb00327c8,0xbf597fc7,0xc6e00bf3,0xd5a79147,0x06ca6351,0x14292967,
        0x27b70a85,0x2e1b2138,0x4d2c6dfc,0x53380d13,0x650a7354,0x766a0abb,0x81c2c92e,0x92722c85,
        0xa2bfe8a1,0xa81a664b,0xc24b8b70,0xc76c51a3,0xd192e819,0xd6990624,0xf40e3585,0x106aa070,
        0x19a4c116,0x1e376c08,0x2748774c,0x34b0bcb5,0x391c0cb3,0x4ed8aa4a,0x5b9cca4f,0x682e6ff3,
        0x748f82ee,0x78a5636f,0x84c87814,0x8cc70208,0x90befffa,0xa4506ceb,0xbef9a3f7,0xc67178f2,
    ];
    let mut data = input.to_vec(); let bit_len = (data.len() as u64) * 8; data.push(0x80); while data.len() % 64 != 56 { data.push(0); } data.extend_from_slice(&bit_len.to_be_bytes());
    let mut h: [u32; 8] = [0x6a09e667,0xbb67ae85,0x3c6ef372,0xa54ff53a,0x510e527f,0x9b05688c,0x1f83d9ab,0x5be0cd19];
    for chunk in data.chunks_exact(64) { let mut w = [0u32; 64]; for i in 0..16 { w[i] = u32::from_be_bytes(chunk[i*4..i*4+4].try_into().unwrap()); } for i in 16..64 { let s0 = w[i-15].rotate_right(7) ^ w[i-15].rotate_right(18) ^ (w[i-15] >> 3); let s1 = w[i-2].rotate_right(17) ^ w[i-2].rotate_right(19) ^ (w[i-2] >> 10); w[i] = w[i-16].wrapping_add(s0).wrapping_add(w[i-7]).wrapping_add(s1); } let mut a=h[0]; let mut b=h[1]; let mut c=h[2]; let mut d=h[3]; let mut e=h[4]; let mut f=h[5]; let mut g=h[6]; let mut hh=h[7]; for i in 0..64 { let s1=e.rotate_right(6)^e.rotate_right(11)^e.rotate_right(25); let ch=(e&f)^((!e)&g); let t1=hh.wrapping_add(s1).wrapping_add(ch).wrapping_add(K[i]).wrapping_add(w[i]); let s0=a.rotate_right(2)^a.rotate_right(13)^a.rotate_right(22); let maj=(a&b)^(a&c)^(b&c); let t2=s0.wrapping_add(maj); hh=g; g=f; f=e; e=d.wrapping_add(t1); d=c; c=b; b=a; a=t1.wrapping_add(t2); } h[0]=h[0].wrapping_add(a); h[1]=h[1].wrapping_add(b); h[2]=h[2].wrapping_add(c); h[3]=h[3].wrapping_add(d); h[4]=h[4].wrapping_add(e); h[5]=h[5].wrapping_add(f); h[6]=h[6].wrapping_add(g); h[7]=h[7].wrapping_add(hh); }
    let mut out = [0u8; 32]; for (i, value) in h.iter().enumerate() { out[i*4..i*4+4].copy_from_slice(&value.to_be_bytes()); } out
}
