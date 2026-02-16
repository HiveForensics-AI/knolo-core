# Changelog

All notable changes to this project will be documented in this file.

## [0.3.0] - 2026-02-16

### Changed
- Upgraded retrieval scoring to corpus-aware BM25L with true IDF, query-time document-frequency collection, and per-document length normalization.
- Fixed postings encoding/decoding to store block IDs as `bid + 1`, preserving `0` as an unambiguous delimiter and restoring first-block retrieval correctness.
- Improved pack quality by validating build input and persisting per-block token lengths (`len`) in pack blocks.
- Mounted packs now expose `blockTokenLens` for consistent scoring across runtimes.
- Added smart-quote phrase parsing support for `“...”` and `”...”` query phrases.
- Context patch snippets now propagate `source` values from hits.
- Hardened CLI docs loading with explicit JSON-shape validation and actionable error messages.
- Added automated tests for smart-quote phrase matching, near-duplicate behavior, first-block retrieval, and context snippet source propagation.
- Added namespace-aware packs and query-time namespace filtering (`query(..., { namespace })`) while preserving existing API defaults and version number.
- Added deterministic pseudo-relevance query expansion (`queryExpansion`) to improve lexical recall without embeddings or non-deterministic rerankers.

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
  - **Advanced retrieval** controls: phrase enforcement, proximity, and diversity
- Added optional `heading` + `docId` persistence in pack `blocks` payload
- Added pack metadata stat: `avgBlockLen` for stable ranking normalization
- Added support for mounting both v1 and v2 block formats
- Added heading overlap boost in query scoring
- Added KNS signature tie-breaker in ranking
- Added near-duplicate suppression + MMR diversification
- Added Expo/RN-safe UTF-8 encoder/decoder ponyfills

### Changed
- Retrieval pipeline now enforces quoted phrases from query and `requirePhrases`
- Query ranking now includes a proximity multiplier (minimal cover span)
- API docs and examples expanded in `README.md`

### Fixed
- Parser and phrase normalization now use tokenizer-normalized terms for consistency
- Improved binary pack writing for alignment-safe postings serialization via `DataView`
- Improved binary pack reading to handle non-zero byte offsets for `Uint8Array` inputs

[0.2.0]: https://github.com/HiveForensics-AI/knolo-core/releases/tag/v0.2.0
