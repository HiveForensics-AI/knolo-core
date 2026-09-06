# VQF-1 Next Phases and Session Handoff

Status: implementation paused before production release. The TypeScript VQF
prototype, V5 reader API, CLI integration, frozen optional-index fixture, and
cross-runtime fail-closed behavior are complete. The interoperable VQF wire
format is still draft and must not be advertised as frozen.

## Resume point

The next implementation unit is format-hardening and release review for the
portable object and event codecs. Their freeze boundary is documented in
[VQF1_FORMAT_FREEZE.md](VQF1_FORMAT_FREEZE.md); native encoders remain
optional and TypeScript-only. The lexical audit is complete and its postings
artifact remains runtime-only.
The detailed Phase 13 contract is in
[VQF1_PHASE13_RUST_OBJECT_DECODER.md](VQF1_PHASE13_RUST_OBJECT_DECODER.md).

## Phase 13 — Rust object decoder

Implement the VQF envelope header and object codec in
`packages/core-rust/src/lib.rs` (prefer a dedicated module if the existing
file is split). Match the TypeScript contract for canonical CBOR validation,
unsigned varints, digest and string tables, shared blobs, source spans, limits,
trailing-byte rejection, and object identity verification.

Required fixtures and gates:

- ordinary object payloads and compressed object payloads decode to identical
  logical bytes;
- object IDs and object roots match TypeScript;
- malformed envelope, digest, table, count, offset, and identity vectors fail;
- `cargo test --manifest-path packages/core-rust/Cargo.toml` passes;
- the ICP template remains synchronized.

Complete. The bounded reader, envelope, digest/string/blob tables, object byte
modes, canonical CBOR fields, identity checks, logical-segment digest path,
and required object-segment dispatch are implemented. The ICP template is
synchronized and the compressed-object fixture mounts successfully in Rust.

## Phase 14 — Python object decoder

Port the same object codec contract to `packages/core-python/src/knolo/`.
Reuse the frozen Rust and TypeScript vectors rather than inventing Python-only
canonicalization. Verify bytes, IDs, roots, source spans, limits, and malformed
input behavior.

Complete. Python mounts the shared compressed-object fixture and participates
in the cross-runtime object and event parity suites.

Gate with:

```sh
.venv/bin/python -m pytest packages/core-python/tests
```

## Phase 15 — Cross-runtime object parity

Complete. `conformance/vqf1/manifest.json` records the compressed object
fixture's physical digest, roots, segment flags, and object count. TypeScript
and Python consume the manifest directly; Rust mounts the same fixture and
asserts the shared roots, segment layout, and decoded object count. All three
runtime suites pass.

## Phase 16 — Event decoder parity

The required event envelope and event body now decode in TypeScript, Rust, and
Python. The checked-in event fixture covers provenance, transaction IDs, actor
counters, parent references, event identity, canonical extension fields, event
roots, and complete image state roots. Remaining work is broader malformed
input and resource-limit vectors before calling the event codec frozen.

## Phase 17 — Native lexical reader parity

Complete. The prototype lexical artifact remains TypeScript runtime-only. It
has no authenticated V5 placement or native Rust/Python readers, so it is not
part of the portable VQF contract. Its internal tests and benchmarks remain
valid; they do not freeze lexical bytes. The decision and requirements for a
future portable lexical format are recorded in
[VQF1_LEXICAL_STATUS.md](VQF1_LEXICAL_STATUS.md).

## Phase 18 — Encoder parity and format freeze

The stable object/event envelope and codec boundary is documented in
[VQF1_FORMAT_FREEZE.md](VQF1_FORMAT_FREEZE.md). Encoding remains
TypeScript-only by design; Rust and Python are conformance readers. Remaining
gates are malformed-vector expansion, optional-index review, and release
review. KIP-0027 stays draft until those gates pass. A future lexical format
would require its own phase before inclusion.

## Phase 19 — Release candidate

The release preflight passes from the current worktree: workspace builds,
V5 release checks, package and archive checks, ICP tests and template sync,
TrustBench, V5 smoke, documentation links, and formatting. Before publishing,
commit and review the intentional VQF fixture, decoder, and documentation
changes, then rerun the commands below from that clean commit.

From a clean tagged tree:

```sh
npm test
npm run test:icp
.venv/bin/python -m pytest packages/core-python/tests
npm run trustbench:test
npm run smoke:v5
npm run release:check
npm run format:check:all
npm run docs:check
```

Review package contents, generated fixtures, changelogs, and the explicit
compatibility statement. Publish only after the release checks pass from the
same commit that was reviewed.

## Current compatibility statement

VQF compression is opt-in. TypeScript, Rust, and Python can read the prototype
required object and event VQF segments. The TypeScript lexical postings codec
is runtime-only and is not a portable V5 artifact. Existing V4/V5 ordinary
serializers remain the durable interoperable path.
