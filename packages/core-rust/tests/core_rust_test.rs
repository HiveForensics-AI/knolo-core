use knolo_core_rust::{authority_envelope_root_v1, authority_keyring_root_v1, authority_session_root_v1, evaluate_knowledge_query_policy_v5, inspect_knowledge_image, key_rotation_root_v1, mount_pack_from_bytes, migrate_v4_to_v5, mount_knowledge_image, query, query_knowledge_image_v5, sync_request_root_v1, sync_response_root_v1, sync_summary_root_v1, verify_knowledge_authority_envelope_v5, verify_knowledge_authority_envelope_with_keyring_root_v5, KnowledgeAuthorityEnvelopeV1, KnowledgeAuthorityKeyV1, KnowledgeAuthorityKeyringV1, KnowledgeKeyRotationRecordV1, KnowledgePolicyV1, QueryOptions};

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
    assert_eq!(pack.blocks[0], "alpha beta gamma");
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

#[test]
fn rust_migration_roundtrips_through_v5_verifier() {
    let bytes = build_test_pack_bytes();
    let migrated = migrate_v4_to_v5(&bytes).expect("migration should succeed");
    let verified = inspect_knowledge_image(&migrated.image).expect("migrated image should verify");
    assert_eq!(verified.state_root, migrated.state_root);
    assert_eq!(migrated.mappings.len(), 2);
    assert!(!migrated.receipt.is_empty());
}

#[test]
fn migrates_checked_in_v4_fixture() {
    let source = include_bytes!("../../../conformance/packs/verified-v4.knolo");
    let migrated = migrate_v4_to_v5(source).expect("checked-in V4 fixture should migrate");
    let verified = inspect_knowledge_image(&migrated.image).expect("migrated V4 fixture should verify");
    assert_eq!(verified.state_root, migrated.state_root);
    assert!(!migrated.mappings.is_empty());
}

#[test]
fn rejects_corrupted_v4_before_migration() {
    let source = include_bytes!("../../../conformance/packs/verified-v4.knolo");
    let mut corrupted = source.to_vec();
    let last = corrupted.len() - 1;
    corrupted[last] ^= 0x01;
    assert!(migrate_v4_to_v5(&corrupted).is_err());
}

#[test]
fn verifies_shared_v5_binary_fixture() {
    let encoded = include_str!("../../../conformance/v5/knowledge-image-v5.fixture.base64");
    let image = decode_base64(encoded);
    let verified = inspect_knowledge_image(&image).expect("shared V5 fixture should verify");
    assert_eq!(verified.state_root, "sha256-bc419264f60822bb8c601f01eb3020671e78056f4e6403ab6db087911d25d694");
    assert_eq!(verified.commit_digest, "sha256-7a6ed0a7e488ee085053d6d8d885141e0a8b6abd5c40bd552e4d2b10b721b177");
    assert_eq!(verified.segments.len(), 3);
}

#[test]
fn v5_eql_matches_shared_query_roots() {
    let bytes = decode_base64(include_str!("../../../conformance/v5/knowledge-image-v5.fixture.base64"));
    let image = mount_knowledge_image(&bytes).expect("shared V5 fixture should mount");
    let result = query_knowledge_image_v5(&image, "FROM metadata SEARCH \"hello\" LIMIT 10").expect("V5 EQL should execute");
    assert_eq!(result.state_root, "sha256-bc419264f60822bb8c601f01eb3020671e78056f4e6403ab6db087911d25d694");
    assert_eq!(result.plan_root, "sha256-832b843bb24c188ec60f54689a2e6c3af7c4c8c1121c3c8fa782a89b06db5d11");
    assert_eq!(result.result_root, "sha256-577f70602232871a16191a9648ddac3a8788f9508898ddad2f6a287efb489f9b");
    assert_eq!(result.hits.len(), 1);
}

#[test]
fn v5_policy_matches_shared_authorization_root() {
    let bytes = decode_base64(include_str!("../../../conformance/v5/knowledge-image-v5.fixture.base64"));
    let image = mount_knowledge_image(&bytes).expect("shared V5 fixture should mount");
    let query_result = query_knowledge_image_v5(&image, "FROM metadata SEARCH \"hello\" LIMIT 10").expect("V5 EQL should execute");
    let authorization = evaluate_knowledge_query_policy_v5(&image, &query_result, &KnowledgePolicyV1 { default: "deny".into(), rules: Vec::new() }, "anonymous", "query").expect("policy should evaluate");
    assert_eq!(authorization.policy_root, "sha256-92a33041498984ee8303a0862158a6624776418fd5b854fb293d66e63febee9f");
    assert_eq!(authorization.authorization_root, "sha256-df948ba76cacb47bdaf9ca02f4a52529747c9e4de91b9b9d04543a2ecb50e637");
    assert_eq!(authorization.decision, "deny");
}

#[test]
fn v5_authority_envelope_root_and_injected_verifier_match() {
    let bytes = decode_base64(include_str!("../../../conformance/v5/knowledge-image-v5.fixture.base64"));
    let image = mount_knowledge_image(&bytes).expect("shared V5 fixture should mount");
    let query_result = query_knowledge_image_v5(&image, "FROM metadata SEARCH \"hello\" LIMIT 10").expect("V5 EQL should execute");
    let authorization = evaluate_knowledge_query_policy_v5(&image, &query_result, &KnowledgePolicyV1 { default: "deny".into(), rules: Vec::new() }, "anonymous", "query").expect("policy should evaluate");
    let envelope = KnowledgeAuthorityEnvelopeV1 { version: 1, issuer: "root".into(), subject: "anonymous".into(), authorization_root: authorization.authorization_root.clone(), keyring_root: None, issued_at: 0, expires_at: 200, algorithm: "test-v1".into(), key_id: None, delegations: Vec::new(), signature: vec![7, 8] };
    assert_eq!(authority_envelope_root_v1(&envelope), "sha256-ba807df11575c870d3022a487418b0cd1e5fb021fb603e046b71b73b5db16a92");
    let rotated = KnowledgeAuthorityEnvelopeV1 { key_id: Some("root-2026".into()), ..envelope.clone() };
    assert_eq!(authority_envelope_root_v1(&rotated), "sha256-0262cc90f2e6e37096d33421d819c648b5330ccdd712d918ad799ca9fca36f52");
    let verified = verify_knowledge_authority_envelope_v5(&image, &query_result, &KnowledgePolicyV1 { default: "deny".into(), rules: Vec::new() }, &authorization, &envelope, 100, |_principal, _algorithm, _key_id| Some(vec![1]), |algorithm, key, _message, signature| algorithm == "test-v1" && key == [1] && signature == [7, 8]).expect("injected verifier should accept");
    assert_eq!(verified.delegation_depth, 0);
    let anchored = KnowledgeAuthorityEnvelopeV1 { keyring_root: Some("sha256-100546c50640211880e55a9b4bbb8d45c5df1f126576eb18db39133805886182".into()), ..envelope.clone() };
    assert_eq!(authority_envelope_root_v1(&anchored), "sha256-8958f2ebaeb2bf0c462f864ceac9e938e96e745729239fee3da58d7d38016a48");
    let anchored_verified = verify_knowledge_authority_envelope_with_keyring_root_v5(&image, &query_result, &KnowledgePolicyV1 { default: "deny".into(), rules: Vec::new() }, &authorization, &anchored, 100, Some("sha256-100546c50640211880e55a9b4bbb8d45c5df1f126576eb18db39133805886182"), |_principal, _algorithm, _key_id| Some(vec![1]), |algorithm, key, _message, signature| algorithm == "test-v1" && key == [1] && signature == [7, 8]).expect("anchored verifier should accept");
    assert_eq!(anchored_verified.keyring_root.as_deref(), Some("sha256-100546c50640211880e55a9b4bbb8d45c5df1f126576eb18db39133805886182"));
    assert!(verify_knowledge_authority_envelope_with_keyring_root_v5(&image, &query_result, &KnowledgePolicyV1 { default: "deny".into(), rules: Vec::new() }, &authorization, &anchored, 100, Some("sha256-"), |_principal, _algorithm, _key_id| Some(vec![1]), |algorithm, key, _message, signature| algorithm == "test-v1" && key == [1] && signature == [7, 8]).is_err());
}

#[test]
fn v5_key_rotation_roots_match_typescript_contract() {
    let key = KnowledgeAuthorityKeyV1 { version: 1, principal: "root".into(), key_id: "root-old".into(), algorithm: "Ed25519".into(), public_key: (1u8..=32).collect(), not_before: Some(0), not_after: None, revoked_at: None };
    let record = KnowledgeKeyRotationRecordV1 { version: 1, kind: "key-rotation".into(), issuer: "root".into(), issuer_key_id: "root-old".into(), principal: "root".into(), previous_key_id: Some("root-old".into()), key_id: "root-2027".into(), algorithm: "Ed25519".into(), public_key: (1u8..=32).rev().collect(), not_before: 100, not_after: None, revoked_at: None, issued_at: 100, expires_at: 500, signature: vec![7, 8] };
    let keyring = KnowledgeAuthorityKeyringV1 { version: 1, sequence: 1, keys: vec![key], rotations: vec![record.clone()] };
    assert_eq!(key_rotation_root_v1(&record), "sha256-13d38c0bf947274f714ef66483ce92dfbb5d7f10f0d4a49434a1ddac4eb52ea4");
    assert_eq!(authority_keyring_root_v1(&keyring), "sha256-100546c50640211880e55a9b4bbb8d45c5df1f126576eb18db39133805886182");
}

#[test]
fn v5_authority_session_root_matches_typescript_contract() {
    assert_eq!(authority_session_root_v1(
        "sha256-13ab8579c3e6e228ac89d40bdb70a2bea49eb3b397fa0714ead40d691fef510e",
        "sha256-efc0fda6c442ea927e41d9f958e3ba2905ce8f8d61f862f14c766fa21a01a66b",
        "sha256-fa5dd65b4ebed5d2d6d25becf4d1776bbce8065faee8e5af9fa24e106cf18b85",
        "sha256-014c4b9bd7703c5d5d19ccbc876110d3829a61b62478576e8333f40439ac0f2d",
        "sha256-cbb1a4834dbf165a2ab848eb1b69e11fd6f8fc081a7fab706f695ad7b6a00c23",
        Some("sha256-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"),
    ), "sha256-4987a5d07dfce422bab73c7f211f31a77a595317d391099458bd878ca4ea0595");
}

#[test]
fn v5_sync_summary_root_matches_typescript_contract() {
    let digest = |value: &str| format!("sha256-{}", value.repeat(64));
    let parents = vec![digest("3")];
    assert_eq!(sync_summary_root_v1(&digest("1"), &digest("2"), 3, &parents, &digest("4"), &digest("5"), Some(&digest("6"))), "sha256-ee0e65a223dbe317f38b214e8dab2ccde1387effcdb6cd87e9bfd0651d8dd931");
}

#[test]
fn v5_sync_message_roots_match_typescript_contract() {
    let digest = |value: &str| format!("sha256-{}", value.repeat(64));
    let summary = "sha256-ee0e65a223dbe317f38b214e8dab2ccde1387effcdb6cd87e9bfd0651d8dd931".to_string();
    let keyring = Some(digest("6"));
    let object_ids: Vec<String> = Vec::new();
    let event_ids: Vec<String> = Vec::new();
    let request_id = "sha256-667cdb2ecf98688a4461c9ff7e6bd62396e3d11bd740343764c79b6f37f62ae1".to_string();
    let request_root = sync_request_root_v1(&request_id, "local", &summary, &object_ids, &event_ids, "Ed25519", Some("local-1"), keyring.as_deref(), &[1, 2, 3, 4], 100, 300, &[7, 8]);
    assert_eq!(request_root, "sha256-ca556127c2ff52ca08bf5e2a42cdd89380e3694a4b109916933261051df67d3d");
    let response_root = sync_response_root_v1(&request_root, "peer", &summary, "equal", &object_ids, &event_ids, "Ed25519", Some("peer-1"), keyring.as_deref(), 100, 300, &[9, 10]);
    assert_eq!(response_root, "sha256-2b040a5d533ba543b57d381dbe2b8f8a84f3445f5c74906d3aa441c7aec14b44");
}

#[test]
fn legacy_migration_matches_shared_cross_runtime_image() {
    let source = decode_base64(include_str!("../../../conformance/packs/legacy-v3-migration.fixture.base64"));
    let expected = decode_base64(include_str!("../../../conformance/v5/migrated-legacy-v3.fixture.base64"));
    let migrated = migrate_v4_to_v5(&source).expect("legacy fixture should migrate");
    assert_eq!(migrated.image, expected);
    assert_eq!(migrated.state_root, "sha256-e49edad45514b6ca08f2d350a094ff7750bfc7b833ac8b2ed17ddf7cafd3037c");
}

#[test]
fn v4_claims_and_agents_migration_matches_shared_image() {
    let source = decode_base64(include_str!("../../../conformance/packs/v4-claims-agents-migration.fixture.base64"));
    let expected = decode_base64(include_str!("../../../conformance/v5/migrated-v4-claims-agents.fixture.base64"));
    let migrated = migrate_v4_to_v5(&source).expect("claims and agents fixture should migrate");
    assert_eq!(migrated.image, expected);
    assert_eq!(migrated.state_root, "sha256-fbd098cf220b414a1dea60fe237da2bfbe4728831db6bd6f43b3c8125987d059");
}

#[test]
fn verifies_shared_transaction_snapshot_fixture() {
    let image = decode_base64(include_str!("../../../conformance/v5/transaction-snapshot.fixture.base64"));
    let verified = inspect_knowledge_image(&image).expect("transaction snapshot should verify");
    assert_eq!(verified.state_root, "sha256-c9ef511f748fe0e15191ff9020c4d3eb00e09da1b5088319c6ec3215e4868eb6");
    assert_eq!(verified.commit_digest, "sha256-c0c6d24c1be3e74cc004ccc83b15ed16ffaf342215db426199fbad535f44076e");
}

fn decode_base64(value: &str) -> Vec<u8> {
    let mut output = Vec::new();
    let mut accumulator = 0u32;
    let mut bits = 0u8;
    for byte in value.bytes().filter(|byte| !byte.is_ascii_whitespace()) {
        if byte == b'=' { break; }
        let digit = match byte {
            b'A'..=b'Z' => byte - b'A',
            b'a'..=b'z' => byte - b'a' + 26,
            b'0'..=b'9' => byte - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            _ => continue,
        } as u32;
        accumulator = (accumulator << 6) | digit;
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            output.push((accumulator >> bits) as u8);
            accumulator &= (1u32 << bits) - 1;
        }
    }
    output
}
