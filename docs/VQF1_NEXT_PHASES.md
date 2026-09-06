# VQF-1 Next Phases and Session Handoff

Status: implementation paused before production release. The TypeScript VQF
prototype, V5 reader API, CLI integration, frozen optional-index fixture, and
cross-runtime fail-closed behavior are complete. The interoperable VQF wire
format is still draft and must not be advertised as frozen.

## Resume point

The next implementation unit is native required-segment VQF decoding in Rust.
Start with the object envelope and object body, then port the same contract to
Python. Use the frozen fixtures under `conformance/vqf1/` and compare logical
payload bytes, object IDs, event IDs, state roots, and rejection behavior.

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

## Phase 14 — Python object decoder

Port the same object codec contract to `packages/core-python/src/knolo/`.
Reuse the frozen Rust and TypeScript vectors rather than inventing Python-only
canonicalization. Verify bytes, IDs, roots, source spans, limits, and malformed
input behavior.

Gate with:

```sh
.venv/bin/python -m pytest packages/core-python/tests
```

## Phase 15 — Cross-runtime object parity

Add a shared JSON manifest containing fixture names, logical payload digests,
object roots, and rejection vectors. Run TypeScript, Rust, and Python against
the same manifest. Do not freeze the object codec until all three runtimes
agree byte-for-byte on accepted and rejected cases.

## Phase 16 — Event decoder parity

Repeat Phases 13–15 for event envelopes and event bodies, including provenance,
transaction IDs, actor counters, event identity, canonical remainder fields,
resource limits, and malformed input. Verify event roots and complete image
state roots across all runtimes.

## Phase 17 — Native lexical reader parity

Decide whether the prototype lexical artifact is promoted to a frozen format.
If promoted, specify the final lexicon pages, posting directories, microblocks,
phrase section, profile defaults, and authenticated placement. Then implement
Rust and Python readers with exact positions, tf/df, phrase reconstruction,
query ordering, and rejection vectors. If it is not promoted, keep it
runtime-only and remove any release claims that imply portable lexical bytes.

## Phase 18 — Encoder parity and format freeze

Only after decoder parity succeeds, implement encoders or explicitly keep
encoding TypeScript-only. Freeze the envelope and codec specifications, limits,
profiles, deterministic tie breaks, and fixture roots. Update KIP-0027 status
from draft only after review of the complete fixture set.

## Phase 19 — Release candidate

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

VQF compression is opt-in. TypeScript can read the prototype required VQF
segments. Rust and Python verify ordinary V5 images, skip optional kind 129,
and reject required VQF flags until decoder parity lands. Existing V4/V5
ordinary serializers remain the durable interoperable path.
