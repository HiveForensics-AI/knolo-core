# knolo-core-rust

**Compatibility status:** legacy v1–v3 Rust reader/query profile plus the V5
read-only Knowledge Image verifier and deterministic migration foundation. The
TypeScript runtime remains the V4 retrieval reference, while this crate is the
native V5 byte-contract foundation.

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
