# VQF-1 portable format freeze boundary

This document records the Phase 18 boundary for the portable VQF codecs. The
TypeScript implementation remains the only encoder. Rust and Python are
conformance readers; they do not need to emit VQF bytes for image
interoperability.

## Frozen portable contract

- The VQF envelope is `VQF1`, version `1`, with codec kinds `1` (objects), `2`
  (events), and `3` (query index). Reserved envelope flags are zero.
- Fixed-width envelope integers are unsigned little-endian. The header is 56
  bytes: logical length, physical body length, and the raw
  `knolo:vqf-physical:v1\0` SHA-256 digest.
- Required V5 object and event segments use schema `1` and flag `0x0001`; the
  commit segment stays ordinary. The segment digest authenticates the
  reconstructed logical payload.
- Logical payloads are canonical CBOR and must reconstruct byte-for-byte.
  Object and event IDs, ordered roots, commit digest, and state root are
  preserved.
- Tables are sorted and unique, references are bounded ordinals, unsigned
  varints use shortest form, and decoders reject trailing bytes and malformed
  canonical CBOR.
- Default safety limits are 512 MiB logical/physical payloads, one million
  table entries or records, and the codec-specific bounded parent, blob,
  string, digest, position, and phrase limits already enforced by the
  implementations.
- Compression is deterministic. Records retain input order; map encoding uses
  canonical key ordering; compression falls back to the ordinary segment when
  the complete envelope is not smaller.

## Encoder boundary

`@knolo/core` is the canonical VQF encoder. Native runtimes must accept the
frozen bytes and may remain read-only. This avoids requiring duplicate writers
while preserving cross-runtime image compatibility. Any future native encoder
must reproduce the same bytes and pass the shared fixtures before it is used in
production.

The image profiles remain explicit: `fast` disables source-relative object
spans, `balanced` enables them, and `max` may perform more expensive exact
factoring. Event encoding has no profile-dependent logical behavior. Profile
selection never changes logical payloads or roots.

## Outside the freeze

The TypeScript lexical postings artifact is runtime-only, as recorded in
`VQF1_LEXICAL_STATUS.md`. Its pages, directories, microblocks, phrase data,
and profiles are not portable VQF bytes. Optional query-index encoding also
remains provisional until its complete derived-content vectors are reviewed.

KIP-0027 remains draft overall until malformed-vector coverage, release
review, and the explicit compatibility statement are complete.
