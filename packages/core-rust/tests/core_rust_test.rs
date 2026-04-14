use knolo_core_rust::{mount_pack_from_bytes, query, QueryOptions};

fn build_test_pack_bytes() -> Vec<u8> {
    let meta = b"{\"version\":3,\"stats\":{\"docs\":2,\"blocks\":2,\"terms\":4,\"avgBlockLen\":2.5}}".to_vec();
    let lexicon = b"[[\"alpha\",1],[\"beta\",2],[\"gamma\",3],[\"delta\",4]]".to_vec();

    let postings: Vec<u32> = vec![
        1, 1, 1, 0, 0,
        2, 1, 2, 0, 2, 1, 0, 0,
        3, 1, 3, 0, 0,
        4, 2, 2, 0, 0,
    ];

    let blocks = b"[{\"text\":\"alpha beta gamma\",\"heading\":\"A\",\"docId\":\"a\",\"namespace\":\"docs\",\"len\":3},{\"text\":\"beta delta\",\"heading\":\"B\",\"docId\":\"b\",\"namespace\":\"guides\",\"len\":2}]".to_vec();

    let mut out = Vec::new();
    push_section(&mut out, &meta);
    push_section(&mut out, &lexicon);
    out.extend_from_slice(&(postings.len() as u32).to_le_bytes());
    for p in postings {
        out.extend_from_slice(&p.to_le_bytes());
    }
    push_section(&mut out, &blocks);
    out
}

fn push_section(out: &mut Vec<u8>, bytes: &[u8]) {
    out.extend_from_slice(&(bytes.len() as u32).to_le_bytes());
    out.extend_from_slice(bytes);
}

#[test]
fn mounts_pack_and_exposes_meta() {
    let bytes = build_test_pack_bytes();
    let pack = mount_pack_from_bytes(&bytes).expect("mount should succeed");

    assert_eq!(pack.meta.version, 3);
    assert_eq!(pack.meta.stats.blocks, 2);
    assert_eq!(pack.blocks.len(), 2);
    assert_eq!(pack.doc_ids[0].as_deref(), Some("a"));
    assert_eq!(pack.namespaces[1].as_deref(), Some("guides"));
}

#[test]
fn lexical_query_returns_expected_rank() {
    let bytes = build_test_pack_bytes();
    let pack = mount_pack_from_bytes(&bytes).expect("mount should succeed");

    let hits = query(
        &pack,
        "alpha beta",
        QueryOptions {
            top_k: 2,
            ..Default::default()
        },
    );

    assert_eq!(hits.len(), 2);
    assert_eq!(hits[0].source.as_deref(), Some("a"));
    assert_eq!(hits[1].source.as_deref(), Some("b"));
    assert!(hits[0].score > hits[1].score);
}

#[test]
fn namespace_filter_works() {
    let bytes = build_test_pack_bytes();
    let pack = mount_pack_from_bytes(&bytes).expect("mount should succeed");

    let hits = query(
        &pack,
        "beta",
        QueryOptions {
            top_k: 5,
            namespace: Some(vec!["docs".to_string()]),
            ..Default::default()
        },
    );

    assert_eq!(hits.len(), 1);
    assert_eq!(hits[0].namespace.as_deref(), Some("docs"));
}
