# VQF-1 conformance fixtures

This directory contains the shared fixtures for the opt-in VQF-1 codecs. The
portable contract currently covers required object and event segments read by
TypeScript, Rust, and Python. [`manifest.json`](manifest.json) records the
fixture roots, segment digests and flags, physical bytes, and decoded counts.

- `required-object-vqf.fixture.base64` exercises the compressed object segment.
- `required-event-vqf.fixture.base64` exercises the compressed event segment.
- `optional-query-index.fixture.base64` remains an optional, skip-compatible
  query-index prototype.

The lexical postings codec is TypeScript runtime-only and is not represented by
these portable fixtures. See [`../../docs/VQF1_FORMAT_FREEZE.md`](../../docs/VQF1_FORMAT_FREEZE.md)
and [`../../docs/VQF1_LEXICAL_STATUS.md`](../../docs/VQF1_LEXICAL_STATUS.md).
