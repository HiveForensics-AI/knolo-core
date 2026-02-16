# Changelog

All notable changes to this project will be documented in this file.
## [0.2.3] - 2026-02-16

### Added
- Added automated retrieval tests covering smart-quote phrase parsing, de-duplication behavior, and context patch source attribution.

### Changed
- Improved ranking accuracy with corpus-aware BM25L IDF and per-block length normalization.
- Pack builder now persists per-block token length metadata (`len`) for consistent scoring at query-time.
- Context patches now preserve snippet `source` values for better citation workflows.
- CLI now validates input shape and reports actionable document-format errors.

### Fixed
- Quoted phrase parsing now supports smart quotes (`“...”`) in addition to standard double quotes.

[0.2.3]: https://github.com/HiveForensics-AI/knolo-core/releases/tag/v0.2.3

---
## [0.2.2] - 2025-08-26

### Changed
- License updated from **MIT** → **Apache-2.0** for patent protection
- Updated `README.md`, `LICENSE`, and `package.json` to reflect new license
- Published to npm as v0.2.2

[0.2.2]: https://github.com/HiveForensics-AI/knolo-core/releases/tag/v0.2.2

---
## [0.2.1] - 2025-08-26

### Changed
- License updated from **MIT** → **Apache-2.0** for patent protection
- Updated `README.md` and `package.json` to reflect new license

[0.2.1]: https://github.com/HiveForensics-AI/knolo-core/releases/tag/v0.2.1


## [0.2.0] - 2025-08-26

### Added
- Introduced top-level `DOCS.md` with a full developer guide:
  - Core concepts, pack format, and end-to-end query flow
  - LLM **context patches** for structured prompt composition
  - **Advanced retrieval** controls: phrase enforcement, proximity constraints, and MMR
- React Native / Expo integration guide with example app and smoke test steps
- Migration notes and examples for upgrading from `0.1.x` → `0.2.0`

### Changed
- Default retrieval pipeline now exposes deterministic knobs (phrase/proximity/MMR) via config and code API
- Improved logging around query flow stages (retrieval → ranking → patch application → generation)

### Fixed
- Resolved edge-case token overflows when applying large context patches
- Correct handling of multi-pack composition when shared dependencies are present

### Migration
- No API breaks — `buildPack`, `mountPack`, `query`, and `makeContextPatch` are unchanged  
- Packs built with 0.1.x still load and query correctly  
- For **heading boosts** and `hit.source`, pass `heading` and `id` to `buildPack`  
- React Native/Expo apps no longer need TextEncoder/TextDecoder polyfills (ponyfills are included)  

[0.2.0]: https://github.com/HiveForensics-AI/knolo-core/releases/tag/v0.2.0
