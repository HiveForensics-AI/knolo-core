# Changelog

All notable changes to the ICP canister adapter will be documented in this file.

## [Unreleased]

### Added
- Initial Rust ICP canister adapter for Knolo retrieval under `packages/icp-canister`.
- Candid-exposed `set_pack`, `clear_pack`, `pack_info`, `search`, and `health` methods.
- Thread-local in-memory pack caching with friendly status DTOs and lexical-only retrieval via the Rust core.
- Unit tests for pack loading, empty-query behavior, cached state handling, and DTO mapping.
- Phase 1 verification script at `scripts/test-phase-1-icp-canister.sh`.

### Changed
- Added the `knolo_icp.did` interface definition for the new canister package.
- Added a package-local `Cargo.lock` for reproducible Rust dependency resolution.

### Notes
- Stable-memory persistence is deferred to Phase 2.
