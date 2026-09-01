# Changelog

All notable changes to the ICP canister adapter will be documented in this file.

## [5.1.0] - 2026-09-01

### Changed

- Coordinated the ICP adapter and bundled Rust template with the V5.1.0
  release line.
- Preserved the documented legacy pack Candid profile while the native V5
  verifier remains in the Rust core boundary.

## [5.0.0] - 2026-08-28

### Added
- Initial Rust ICP canister adapter for Knolo retrieval under `packages/icp-canister`.
- Candid-exposed `set_pack`, `clear_pack`, `pack_info`, `search`, and `health` methods.
- Thread-local in-memory pack caching with friendly status DTOs and lexical-only retrieval via the Rust core.
- Unit tests for pack loading, empty-query behavior, cached state handling, and DTO mapping.
- Stable-memory persistence for `.knolo` bytes and pack label, with upgrade restore hooks.
- Persistence helper tests covering snapshot encode/decode, clear behavior, and post-upgrade remounting.
- Phase 3 local `dfx` example under `examples/icp-knowledge-canister`, including a minimal `dfx.json`, sample pack generator, upload script, query script, and checked-in demo knowledge files.
- Phase 4 browser frontend under `examples/icp-knowledge-canister/frontend`, using a direct Vite React client with `@dfinity/agent` and no middleware API route.
- Phase 5 `knolo icp` CLI commands for local ICP init, pack build, upload, and query flows, plus a bundled ICP scaffold template shipped with `@knolo/cli`.
- Phase 6 local ICP end-to-end script at `scripts/e2e-icp-local.sh`, covering Rust builds, `dfx` startup and deploy, sample pack upload, lexical query assertion, and clean replica shutdown.
- Controller-only authorization for `set_pack` and `clear_pack` so anonymous callers cannot mutate packs.
- Hard `MAX_PACK_BYTES` (2 MiB) rejection for oversized uploads, with unit coverage.
- Local manual harness under `tests/icp-local` (generated seed data gitignored) with REST gateway for Postman and CLI testing.
- `knolo icp health|info|clear` operator commands.

### Changed
- Added the `knolo_icp.did` interface definition for the new canister package.
- Added a package-local `Cargo.lock` for reproducible Rust dependency resolution.
- Fixed pack position encoding and Rust block parsing so JS-built `.knolo` packs query correctly through the canister.
- End-to-end script now re-deploys after upload and asserts pack persistence across upgrade.

### Notes
- Phase 2 now persists `.knolo` bytes and label across upgrades.
- Write methods require the caller to be a canister controller (local `dfx` identity qualifies after deploy).
# Unreleased

- Phase 2 compatibility note: the TypeScript builder emits v4 by default, while the CLI ICP build workflow explicitly emits legacy v3 packs until the canister reader gains a v4 capability profile.
- Phase 3 note: analyzer profiles and retrieval-plan hashes are TypeScript-core features; the canister remains on the legacy v3 capability profile until it gains v4 field/chunk support.
- Phase 4 note: receipt generation/verification is currently a TypeScript-core capability; ICP support should follow its v4 reader and resource-limit profile.
- Phase 5 note: shared conformance fixtures and TrustBench currently certify only the TypeScript runtime; ICP remains a legacy-v3 profile until v4 equivalence is implemented.
- Future ICP v4 work must implement the shared magic/header, section-directory bounds checks, and SHA-256 digest verification before changing that default.
