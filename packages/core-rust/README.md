# knolo-core-rust

**Compatibility status:** legacy v1–v3 Rust reader/query profile plus the V5
read-only Knowledge Image verifier, deterministic migration foundation, and
VQF-1 required object/event readers. The TypeScript runtime remains the V4
retrieval reference and canonical VQF encoder; this crate is a read-only V5
byte-contract implementation. The crate stays `5.5.1`. It evaluates and
verifies the public KAR V5 conformance vectors. Authoring, coverage reports,
Cortex, composition, the Python package, and the ICP canister stay outside
this runtime.

The shared implementation roadmap is [`../../docs/ROADMAP.md`](../../docs/ROADMAP.md).

Native Rust runtime support for Knolo `.knolo` packs.

## V5 Knowledge Image foundation

The crate also exposes a dependency-free, read-only V5 verifier:

```rust
use knolo_core_rust::{inspect_knowledge_image, migrate_v4_to_v5};

let migration = migrate_v4_to_v5(&v4_bytes)?;
let verification = inspect_knowledge_image(&migration.image)?;
assert_eq!(verification.state_root, migration.state_root);
```

V5 uses deterministic CBOR, SHA-256 domain-separated roots, A/B superblocks,
immutable object/event/commit segments, and fail-closed validation. The V4
reader and lexical query API remain compatible and unchanged. The crate also
implements bounded V5 EQL v1 with deterministic `plan_root` and `result_root`
values matching the TypeScript runtime.

Policy evaluation is also policy-root-bound and produces matching authorization
roots. The crate exposes canonical authority-envelope roots and injected
verifier callbacks; cryptographic algorithms and external identity resolution
remain host responsibilities. Optional key IDs are included in canonical
envelope payloads for rotation parity.

Required VQF-1 object and event segments are decoded with the same logical
payload, identity, segment-root, and state-root checks as TypeScript. Native VQF
encoding, lexical postings, and the optional query-index codec remain outside
the portable Rust writer contract.

Native inspection consumers can use `inspect_knowledge_runtime_v5` and
`inspect_knowledge_studio_management_v5` for the verified base diagnostics and
KIP-0026 management snapshot. Their diagnostics and management roots match the
shared TypeScript fixture; optional query, history, run, and replay panels stay
host/runtime extensions until their native contracts are added.

```rust
use knolo_core_rust::{mount_knowledge_image, query_knowledge_image_v5};

let image = mount_knowledge_image(&v5_bytes)?;
let result = query_knowledge_image_v5(&image, "FROM chunk SEARCH \"retention\" LIMIT 20")?;
println!("{}", result.result_root);
```

## KAR V5 vectors

`evaluate_kar_v5` and `verify_kar_v5` run the frozen `kar-1-research-1` evaluator on a mounted V5 image and a committed evidence graph. `SATISFIED` means the evidence requirements were met. It does not mean a claim is proven. `UNSATISFIED_EVIDENCE_REQUIREMENTS` is a completed evaluation.

The public vectors live in [`../../conformance/kar/v1/README.md`](../../conformance/kar/v1/README.md). `npm run test:rust` rebuilds those images with the TypeScript compiler and checks the committed fixtures, then `cargo test` runs the native evaluator. A direct `cargo test` uses the fixtures already in `tests/fixtures/kar-v1`. The crate does not compile CEG source and does not write V5 images.

## Included in this initial release

- `mount_pack_from_bytes(&[u8]) -> Pack`
- `query(&Pack, &str, QueryOptions) -> Vec<Hit>`
- Pack parsing support for:
  - `meta`
  - `lexicon`
  - `postings`
  - `blocks` (legacy string array and v3 object array)

## Example

```rust
use knolo_core_rust::{mount_pack_from_bytes, query, QueryOptions};

let bytes: Vec<u8> = std::fs::read("knowledge.knolo")?;
let pack = mount_pack_from_bytes(&bytes)?;

let hits = query(
    &pack,
    "react native bridge throttling",
    QueryOptions {
        top_k: 5,
        ..Default::default()
    },
);

for hit in hits {
    println!("{} => {}", hit.source.unwrap_or_default(), hit.score);
}
# Ok::<(), Box<dyn std::error::Error>>(())
```
