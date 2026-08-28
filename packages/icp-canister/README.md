# knolo-icp-canister

Internet Computer adapter for the Knolo retrieval runtime.

## Compatibility status

This crate is the V5 release-line ICP adapter, but its canister API currently
serves the legacy `.knolo` retrieval profile. It provides controller-protected
pack upload and clearing, stable-memory persistence across upgrades, health and
pack information queries, and lexical search over the mounted pack.

The native V5 Knowledge Image verifier and migration APIs are provided by the
[`knolo-core-rust`](https://crates.io/crates/knolo-core-rust) crate. The ICP
canister will consume the V5 image contract in a subsequent adapter upgrade.

## Candid interface

The package exposes:

- `set_pack(bytes, label)` — controller-only pack upload;
- `clear_pack()` — controller-only removal;
- `pack_info()` — mounted pack metadata;
- `search(query, top_k)` — deterministic lexical retrieval;
- `health()` — canister health status.

Pack bytes and their label survive canister upgrades through stable memory. A
single upload is limited to 2 MiB by the current adapter contract.

## Local validation

From the repository root:

```bash
cargo test --manifest-path packages/core-rust/Cargo.toml
cargo test --manifest-path packages/icp-canister/Cargo.toml
cargo build --target wasm32-unknown-unknown --release --manifest-path packages/icp-canister/Cargo.toml
```

See the [ICP example](../../examples/icp-knowledge-canister/README.md) and the
[V5 roadmap](../../docs/ROADMAP.md) for deployment and upgrade planning.

## License

Apache-2.0
