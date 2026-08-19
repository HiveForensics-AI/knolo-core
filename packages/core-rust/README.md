# knolo-core-rust

**Compatibility status:** legacy v1–v3 Rust reader/query profile. The
TypeScript runtime is the Phase 5 v4 TrustBench reference until Rust supports
the v4 container, analyzer identity, retrieval plan, and receipt contract.

Native Rust runtime support for Knolo `.knolo` packs.

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
