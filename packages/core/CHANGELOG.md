# Changelog

All notable changes to this project will be documented in this file.

## [5.1.0] - 2026-09-01

### v5.1.0 / V5 Completion and Interoperability Hardening

- Added bounded durable writer leases, renewal, expiry, explicit stale recovery,
  and host-authorized production sync application.
- Added read-only V5 Studio/diagnostics service boundaries and cross-runtime
  diagnostics/management fixtures.
- Added Python V5 Knowledge Image verification/query support and V5 image
  support to the LangChain and LlamaIndex adapters.
- Added shared V5 interoperability vectors, receipt/root rules, trust-boundary
  documentation, and the conditional V5-to-V6 handoff.
- Bumped the coordinated JavaScript runtime and adapter packages to `5.1.0`;
  the existing V4 APIs remain compatible.

## [5.0.0] - 2026-08-28

### v5.0.0 / V5 Foundation

- Published the verifiable Knowledge Image foundation beside the unchanged V4 retrieval APIs.
- Added deterministic CBOR, domain-separated SHA-256 roots, fail-closed container validation, and cross-runtime conformance fixtures.
- Added deterministic V1–V4 migration with evidence identity mappings and migration receipts.
- Added read-only V5 retrieval, indexes, history, policy, authority, key rotation, sync, merge, replay, durable runs, diagnostics, and Studio management snapshots.
- Added Rust verification and migration foundations and CLI inspection, health, and Studio commands.
- Bumped the publishable JavaScript and Rust runtime surfaces to `5.0.0`; Python remains a separately versioned legacy compatibility profile.

### v4.0.0 / Phase 5

- Completed the TypeScript TrustBench reference profile and repository conformance documentation.
- Added aggregate Recall@K, MRR, nDCG, hit-count, abstention-precision, and receipt-verification reporting.
- Added explicit v1/v3/v4 profile mounting checks and a TrustBench operator README.
- Bumped `@knolo/core` to `4.0.0`; legacy v1–v3 readers remain supported.

### Changed

- Enforced namespace, source, and required-phrase constraints after every lexical, expansion, and reranking stage.
- Removed KNS relevance perturbations; equal scores now use stable block-ID ordering.
- Preserved raw source text in built packs so Markdown, code, paths, identifiers, and evidence spans remain intact.
- Phase 2 packs now use a self-describing v4 container by default, with SHA-256 manifest, section, and pack identities.
- Legacy v1–v3 packs remain readable; `buildPack(..., { format: 3 })` preserves the legacy writer for older runtimes.

### Added

- Strict v4 header, section-directory, bounds, overlap, schema, and digest validation.
- v4 source manifests and stable document chunks with exact raw spans.
- CLI support for `knolo inspect`, `knolo migrate <pack> --to 4`, and `knolo verify`.
- Browser/React-Native-safe SHA-256 implementation for independent pack verification.
- Phase 3 analyzer profiles, profile digests, fielded chunk signals, and deterministic `queryWithPlan()` retrieval plans.
- Phase 4 `queryWithReceipt()`/`verifyReceipt()` APIs with pack/source identities, exact evidence spans, answer/clarify/abstain decisions, and replay hashes.
- Phase 5 TrustBench conformance fixtures, canonical retrieval output, corruption fixtures, and reproducible Recall@K/MRR evaluation.

### Phase 2 handoff

- Phase 3 should make the v4 analyzer profile and retrieval plan canonical; the current v4 chunks expose raw text and basic source spans but do not yet implement fielded retrieval.
- Phase 4 should bind receipts to the v4 manifest/section digests and add independent receipt verification.
- ICP and other external runtimes should add v4 readers before their builders switch from `format: 3`.

### Phase 3 handoff

- Phase 4 should add receipts around `queryWithPlan()` and bind plan hashes to manifest/source digests.
- Fielded retrieval currently uses deterministic chunk metadata for heading, code-symbol, path, and table signals; future work can split these into dedicated postings channels without changing the plan contract.
- Analyzer profiles are immutable declarations with SHA-256 digests; new profiles require explicit IDs and conformance fixtures.

### Phase 4 handoff

- Receipts are integrity-verifiable but unsigned; Phase 6 should add key IDs, signatures, rotation, revocation, and signed quality certificates.
- ClaimGraph edges remain deterministic and evidence-indexed by block IDs; Phase 5/next graph work should add source digests, temporal validity, authority, contradiction, and conflict policies.
- `query --receipt <file> --json`, `explain`, and `diff` provide local operator workflows; hosted registry/distribution is intentionally out of scope.

### Phase 5 handoff

- `conformance/` is the shared fixture contract; regenerate with `npm run trustbench:generate` and gate with `npm run trustbench:test`.
- TypeScript is the first canonical runtime profile. Rust, Python, and ICP remain explicitly unmarked until they consume the v4 fixtures and produce equivalent canonical rows.
- Metrics currently include Recall@K, reciprocal rank, hit count, decision, receipt verification, and deterministic plan hashes. TrustBench can add nDCG, attribution, abstention calibration, and latency baselines as runtime profiles mature.

### Earlier additions

- Deterministic append-only document patch packs with base fingerprints, JSON serialization, merging, replay into `LivePack`, and `LivePack.serializePatchPack()`.
- Knolo Cortex, a local-first overlay memory layer for `.knolo` packs with deterministic lexical recall, append-only logs, portable serialization, and no required vector DB.
- Added the initial memory surface under `@knolo/core`, including memory normalization, immutable cortex writes, recall ranking, and consolidation helpers, while keeping the existing pack runtime API unchanged.
- Added `memoryToClaimOps()` to bridge Cortex memories into deterministic ClaimGraph ops without changing the existing graph builder.

## [0.3.1] - 2026-02-16

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
