use candid::CandidType;
use ic_cdk_macros::{query, update};
use knolo_core_rust::{mount_pack_from_bytes, query as knolo_query, Pack, QueryOptions};
use serde::Deserialize;
use std::cell::RefCell;

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct HitDto {
    pub block_id: u64,
    pub score: f64,
    pub text: String,
    pub source: Option<String>,
    pub namespace: Option<String>,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct PackInfo {
    pub loaded: bool,
    pub label: Option<String>,
    pub version: Option<u32>,
    pub docs: Option<u64>,
    pub blocks: Option<u64>,
    pub terms: Option<u64>,
}

#[derive(CandidType, Deserialize, Clone, Debug, PartialEq)]
pub struct HealthDto {
    pub ok: bool,
    pub message: String,
}

#[derive(Default)]
struct CanisterState {
    loaded_pack: Option<LoadedPack>,
}

struct LoadedPack {
    label: Option<String>,
    pack: Pack,
}

thread_local! {
    // TODO(phase-2): move pack persistence to stable memory with pre_upgrade/post_upgrade hooks.
    static STATE: RefCell<CanisterState> = RefCell::new(CanisterState::default());
}

#[update]
fn set_pack(bytes: Vec<u8>, label: String) -> HealthDto {
    STATE.with(|state| set_pack_in_state(&mut state.borrow_mut(), &bytes, label))
}

#[update]
fn clear_pack() -> HealthDto {
    STATE.with(|state| clear_pack_in_state(&mut state.borrow_mut()))
}

#[query]
fn pack_info() -> PackInfo {
    STATE.with(|state| pack_info_from_state(&state.borrow()))
}

#[query]
fn search(q: String, top_k: u32) -> Vec<HitDto> {
    STATE.with(|state| search_in_state(&state.borrow(), q.as_str(), top_k))
}

#[query]
fn health() -> HealthDto {
    STATE.with(|state| health_from_state(&state.borrow()))
}

fn set_pack_in_state(state: &mut CanisterState, bytes: &[u8], label: String) -> HealthDto {
    if bytes.is_empty() {
        return HealthDto {
            ok: false,
            message: "Pack bytes were empty.".to_string(),
        };
    }

    match mount_pack_from_bytes(bytes) {
        Ok(pack) => {
            let label = normalize_label(label);
            let success_message = match label.as_deref() {
                Some(label) => format!("Pack loaded successfully: {label}"),
                None => "Pack loaded successfully.".to_string(),
            };

            state.loaded_pack = Some(LoadedPack { label, pack });

            HealthDto {
                ok: true,
                message: success_message,
            }
        }
        Err(err) => HealthDto {
            ok: false,
            message: format!("Failed to mount pack: {err}"),
        },
    }
}

fn clear_pack_in_state(state: &mut CanisterState) -> HealthDto {
    let had_pack = state.loaded_pack.take().is_some();

    HealthDto {
        ok: true,
        message: if had_pack {
            "Pack cleared.".to_string()
        } else {
            "No pack was loaded.".to_string()
        },
    }
}

fn pack_info_from_state(state: &CanisterState) -> PackInfo {
    match state.loaded_pack.as_ref() {
        Some(loaded) => PackInfo {
            loaded: true,
            label: loaded.label.clone(),
            version: Some(loaded.pack.meta.version),
            docs: Some(to_nat64(loaded.pack.meta.stats.docs)),
            blocks: Some(to_nat64(loaded.pack.meta.stats.blocks)),
            terms: Some(to_nat64(loaded.pack.meta.stats.terms)),
        },
        None => PackInfo {
            loaded: false,
            label: None,
            version: None,
            docs: None,
            blocks: None,
            terms: None,
        },
    }
}

fn search_in_state(state: &CanisterState, q: &str, top_k: u32) -> Vec<HitDto> {
    if q.trim().is_empty() || top_k == 0 {
        return Vec::new();
    }

    let Some(loaded) = state.loaded_pack.as_ref() else {
        return Vec::new();
    };

    let top_k = usize::try_from(top_k.min(50)).unwrap_or(50);

    knolo_query(
        &loaded.pack,
        q,
        QueryOptions {
            top_k,
            ..Default::default()
        },
    )
    .into_iter()
    .map(|hit| HitDto {
        block_id: to_nat64(hit.block_id),
        score: hit.score,
        text: hit.text,
        source: hit.source,
        namespace: hit.namespace,
    })
    .collect()
}

fn health_from_state(state: &CanisterState) -> HealthDto {
    match state.loaded_pack.as_ref() {
        Some(loaded) => HealthDto {
            ok: true,
            message: match loaded.label.as_deref() {
                Some(label) => format!("Pack loaded and ready: {label}"),
                None => "Pack loaded and ready.".to_string(),
            },
        },
        None => HealthDto {
            ok: false,
            message: "No pack loaded. Call set_pack(bytes, label) first.".to_string(),
        },
    }
}

fn normalize_label(label: String) -> Option<String> {
    let trimmed = label.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed.to_string())
    }
}

fn to_nat64(value: usize) -> u64 {
    u64::try_from(value).unwrap_or(u64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build_test_pack_bytes() -> Vec<u8> {
        let meta =
            b"{\"version\":3,\"stats\":{\"docs\":2,\"blocks\":2,\"terms\":4,\"avgBlockLen\":2.5}}"
                .to_vec();
        let lexicon = b"[[\"alpha\",1],[\"beta\",2],[\"gamma\",3],[\"delta\",4]]".to_vec();

        let postings: Vec<u32> = vec![
            1, 1, 1, 0, 0, 2, 1, 2, 0, 2, 1, 0, 0, 3, 1, 3, 0, 0, 4, 2, 2, 0, 0,
        ];

        let blocks = b"[{\"text\":\"alpha beta gamma\",\"heading\":\"A\",\"docId\":\"a\",\"namespace\":\"docs\",\"len\":3},{\"text\":\"beta delta\",\"heading\":\"B\",\"docId\":\"b\",\"namespace\":\"guides\",\"len\":2}]".to_vec();

        let mut out = Vec::new();
        push_section(&mut out, &meta);
        push_section(&mut out, &lexicon);
        out.extend_from_slice(&(postings.len() as u32).to_le_bytes());
        for posting in postings {
            out.extend_from_slice(&posting.to_le_bytes());
        }
        push_section(&mut out, &blocks);
        out
    }

    fn push_section(out: &mut Vec<u8>, bytes: &[u8]) {
        out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
        out.extend_from_slice(bytes);
    }

    #[test]
    fn set_pack_populates_pack_info_and_health() {
        let mut state = CanisterState::default();

        let result = set_pack_in_state(
            &mut state,
            &build_test_pack_bytes(),
            "docs-pack".to_string(),
        );

        assert!(result.ok);
        assert!(result.message.contains("docs-pack"));

        let info = pack_info_from_state(&state);
        assert_eq!(
            info,
            PackInfo {
                loaded: true,
                label: Some("docs-pack".to_string()),
                version: Some(3),
                docs: Some(2),
                blocks: Some(2),
                terms: Some(4),
            }
        );

        let health = health_from_state(&state);
        assert!(health.ok);
        assert!(health.message.contains("ready"));
    }

    #[test]
    fn invalid_pack_returns_friendly_error_and_preserves_loaded_pack() {
        let mut state = CanisterState::default();

        let first = set_pack_in_state(
            &mut state,
            &build_test_pack_bytes(),
            "kept-pack".to_string(),
        );
        assert!(first.ok);

        let result = set_pack_in_state(&mut state, &[1, 2, 3], "bad-pack".to_string());

        assert!(!result.ok);
        assert!(result.message.contains("Failed to mount pack"));

        let info = pack_info_from_state(&state);
        assert_eq!(info.label.as_deref(), Some("kept-pack"));
        assert_eq!(info.blocks, Some(2));
    }

    #[test]
    fn search_returns_ranked_hits_and_maps_fields() {
        let mut state = CanisterState::default();
        set_pack_in_state(
            &mut state,
            &build_test_pack_bytes(),
            "docs-pack".to_string(),
        );

        let hits = search_in_state(&state, "alpha beta", 50);

        assert_eq!(hits.len(), 2);
        assert_eq!(hits[0].block_id, 0);
        assert_eq!(hits[0].source.as_deref(), Some("a"));
        assert_eq!(hits[0].namespace.as_deref(), Some("docs"));
        assert!(hits[0].score > hits[1].score);
    }

    #[test]
    fn search_returns_empty_when_query_is_blank_or_top_k_is_zero() {
        let mut state = CanisterState::default();
        set_pack_in_state(
            &mut state,
            &build_test_pack_bytes(),
            "docs-pack".to_string(),
        );

        assert!(search_in_state(&state, "   ", 5).is_empty());
        assert!(search_in_state(&state, "beta", 0).is_empty());
    }

    #[test]
    fn search_without_pack_is_empty_and_health_explains_why() {
        let state = CanisterState::default();

        assert!(search_in_state(&state, "alpha", 5).is_empty());
        assert_eq!(
            health_from_state(&state),
            HealthDto {
                ok: false,
                message: "No pack loaded. Call set_pack(bytes, label) first.".to_string(),
            }
        );
    }

    #[test]
    fn clear_pack_resets_loaded_state() {
        let mut state = CanisterState::default();
        set_pack_in_state(
            &mut state,
            &build_test_pack_bytes(),
            "docs-pack".to_string(),
        );

        let result = clear_pack_in_state(&mut state);

        assert!(result.ok);
        assert_eq!(result.message, "Pack cleared.");
        assert_eq!(
            pack_info_from_state(&state),
            PackInfo {
                loaded: false,
                label: None,
                version: None,
                docs: None,
                blocks: None,
                terms: None,
            }
        );
    }
}
