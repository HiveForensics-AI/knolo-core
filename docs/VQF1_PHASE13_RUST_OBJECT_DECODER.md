# Phase 13 — Rust VQF Object Decoder

This phase ports the TypeScript VQF object codec to Rust. It is the first
required-segment decoder and must complete before compressed object segments
can be accepted by Rust or the ICP template.

## Contract

The decoder must accept only envelope version 1, the expected object codec kind,
zero envelope flags, bounded logical and physical lengths, and a matching
`knolo:vqf-physical:v1` body digest. The body decoder must then enforce the
object codec version, source-span flag, canonical table ordering, shortest-form
unsigned varints, bounds before allocation, and exact trailing-byte rejection.

Decoded objects must preserve the original canonical logical payload bytes and
reproduce each object identity with the `object` digest domain. Shared digest,
string, and blob tables must be expanded only within aggregate resource limits.
Source spans must resolve to the lowest matching byte offset in the referenced
source object and must never be treated as recursive spans.

## Implementation order

1. Add a bounded VQF byte reader and shortest-form unsigned LEB128 decoder to
   the Rust module.
2. Add envelope parsing and physical digest verification.
3. Add digest/string/blob table readers with duplicate and ordering checks.
4. Decode object records, metadata, remainder fields, and source spans.
5. Re-encode the canonical logical CBOR payload and require byte equality.
6. Dispatch required V5 object segments through the decoder only when the VQF1
   flag is present; ordinary segments keep the existing path.

## Fixtures and acceptance gates

Add compressed-object fixtures alongside
`conformance/vqf1/required-object-vqf.fixture.base64` with expected logical
payload digest, object IDs, object root, event root, and state root. Add vectors
for truncation, wrong codec kind, wrong physical digest, non-canonical varints,
duplicate table entries, invalid references, oversized declarations, and
trailing bytes.

The phase is complete only when:

- Rust produces the same logical payload bytes and roots as TypeScript;
- ordinary and compressed images mount to identical objects and events;
- all malformed vectors fail closed before large allocations;
- the ICP template is synchronized;
- `cargo test --manifest-path packages/core-rust/Cargo.toml` passes.

The Rust implementation was followed by Python parity and shared object/event
fixtures. Compressed object acceptance is now enabled in all three runtimes;
the remaining release work is malformed-vector expansion and final review.
