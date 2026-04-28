# Changelog

All notable changes to the ICP canister adapter will be documented in this file.

## [Unreleased]

### Added
- Initial Rust ICP canister adapter for Knolo retrieval under `packages/icp-canister`.
- Candid-exposed `set_pack`, `clear_pack`, `pack_info`, `search`, and `health` methods.
- Thread-local in-memory pack caching with friendly status DTOs and lexical-only retrieval via the Rust core.
- Unit tests for pack loading, empty-query behavior, cached state handling, and DTO mapping.
- Phase 1 verification script at `scripts/test-phase-1-icp-canister.sh`.
- Stable-memory persistence for `.knolo` bytes and pack label, with upgrade restore hooks.
- Persistence helper tests covering snapshot encode/decode, clear behavior, and post-upgrade remounting.
- Phase 3 local `dfx` example under `examples/icp-knowledge-canister`, including a minimal `dfx.json`, sample pack generator, upload script, query script, and checked-in demo knowledge files.

### Changed
- Added the `knolo_icp.did` interface definition for the new canister package.
- Added a package-local `Cargo.lock` for reproducible Rust dependency resolution.
- Fixed pack position encoding and Rust block parsing so JS-built `.knolo` packs query correctly through the canister.

### Notes
- Phase 2 now persists `.knolo` bytes and label across upgrades.
