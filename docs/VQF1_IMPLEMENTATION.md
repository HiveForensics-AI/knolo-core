# VQF-1 implementation status

Phases 0–7 establish the baseline, internal binary primitives, deterministic
tables, exact byte factoring, exact object/event payload codecs, an opt-in V5
physical transcode, a compressed query-index sidecar with optional kind 129,
and a lexical postings reader with a V4 compatibility adapter. Ordinary
V3/V4/V5 writing remains the default; query and retrieval behavior remain
unchanged.

See [KIP-0027](../spec/KIP-0027-vqf1-compression.md) for the draft contract and
[baseline benchmarks](VQF1_BENCHMARKS.md) for reproducible measurements and
exact ordinary-artifact/query results.

## Phase 0

The benchmark harness generates four deterministic corpus classes at two
sizes, records existing conformance roots, verifies repeatable V4 builds and
V5 migrations, and compares indexed EQL against scans. Its `--compare` mode
checks exact baseline identity independently of timing and memory noise.
No existing fixture or snapshot was rewritten.

## Phase 1

Internal modules under `packages/core/src/compression/vqf1/`:

| Module           | Contract                                                                                                |
| ---------------- | ------------------------------------------------------------------------------------------------------- |
| `varint.ts`      | Canonical unsigned LEB128 over `0..2^64-1`, at most ten bytes; checked conversion to safe numbers       |
| `byte_reader.ts` | Sequential byte, little-endian u16/u32/u64 and varint reads; checked ranges and trailing-byte detection |
| `byte_writer.ts` | Bounded growable output for the same primitives; independent output snapshots                           |

These modules are deliberately absent from the package entry-point exports.
They use no Node APIs and compile with the existing TypeScript configuration.

The reader borrows its input, which callers must keep unchanged for the duration
of reading. `readBytes` returns an independent copy, including when the input
is a Node Buffer. The writer copies appended bytes and returns independent
snapshots from `finish`. It starts with at most 64 bytes of capacity and grows
only after checking the requested output size.

Both accept an optional buffer ceiling, from zero through the existing V5
512 MiB physical segment ceiling. This is a primitive buffer limit, not an
approved future logical-segment or aggregate decompression budget. It does not
allocate 512 MiB on construction. Smaller limits should be passed for bounded
structures as their formats are implemented.

`readUVarint` retains full precision as `bigint`. `readUVarintNumber(maximum)`
checks the numeric bound before advancing, allowing a decoder to enforce a
count or size budget. Number inputs to writers must already be safe unsigned
integers; use `bigint` for larger values. Negative, fractional, non-finite,
unsafe and overflowing inputs are rejected. Failed reads and rejected writes
leave the cursor/output intact.

## Phase 2

`digest_table.ts` stores sorted unique raw 32-byte digests and supports exact
ordinal lookup, bounded encoding/decoding and strict digest validation.
`string_table.ts` selects repeated strings only when table entries, tags,
lengths, ordinals and table-count growth yield positive net savings. Its
inline/reference encoding preserves exact UTF-8, including leading BOMs and
decomposed Unicode, with native and fallback runtime codecs.

`byte_factor.ts` owns unique blobs sorted by raw byte order and maps every
original input to an ordinal. SHA-256 is only a candidate lookup: byte equality
is required even under collisions. Inputs, returned blobs and ordinal arrays
cannot accidentally mutate retained bytes. Source spans and blob wire framing
belong to the object-codec increment.

`table_utils.ts` supplies shared ordering, UTF-8 validation and limits. Default
table budgets are 1,000,000 entries and 64 MiB; see KIP-0027 for exact build and
decode accounting. The modules remain internal and do not change package
entry-point exports, image serializers or query execution.

The [Phase 2 fixture measurements](benchmarks/vqf1/phase2-tables.json) include
100 primitive-build samples per fixture and exact reconstruction checks.
Run `npm run benchmark:vqf:tables -- --output /tmp/vqf-tables.json` with a new
output path to reproduce. These small fixtures measure primitives, not image
compression ratios. Digest costs compare raw textual occurrences with table
plus ordinals; string costs include framing; blob savings exclude framing.

The [recorded Phase 2 checks](benchmarks/vqf1/phase2-checks.json) passed on
2026-09-06. They cover the complete local Node, Rust/ICP, Python, TrustBench,
V5 smoke, release/archive, formatting and exact Phase 0 comparison gate.

## Verification

Focused checks:

```sh
npm run build --workspace @knolo/core
node --test packages/core/test/vqf-varint.test.mjs packages/core/test/vqf-byte-io.test.mjs
node --test packages/core/test/vqf-tables.test.mjs
node --test packages/core/test/vqf-query-index.test.mjs
```

The tests cover canonical boundary vectors through `2^64-1`, every truncated
prefix of representative multibyte values, nonminimal representations,
invalid offsets, tenth-byte overflow, checked numeric conversion, and 1,000
seeded random u64 values with deliberately noncanonical alternatives.
Byte-I/O tests cover unaligned views, little-endian wire bytes, UTF-8 evidence,
zero-length buffers, limits, capacity growth, copy ownership and failure
atomicity. The regular `npm test` discovers these tests automatically.

Existing Node, Rust/ICP, Python, TrustBench, smoke and release checks remain
required. The benchmark comparison must continue matching the saved Phase 0
roots and exact query results. A repeat comparison is a correctness gate, not
evidence of a performance improvement.

The [recorded Phase 1 checks](benchmarks/vqf1/phase1-checks.json) all passed:
33 core Node test entries plus workspace/legacy tests, 18 Rust core tests,
11 ICP tests, 21 Python tests, TrustBench, V5 smoke, release checks, formatting,
documentation links, and exact comparison of all eight baseline cases.
The benchmark harness also passed its [negative controls](benchmarks/vqf1/harness-validation.json):
altered roots and invalid sizes were rejected, and an existing output remained
unchanged after an attempted overwrite.

Phase 2 adds 1,000 seeded digest/string/blob cases, dictionary count/ordinal
width-boundary tests, forced hash collisions, invalid UTF-8 and surrogate tests,
noncanonical references, malformed lengths/tables, and ownership/limit checks.

## Phase 3

`object_codec.ts` encodes canonical V5 object payloads using the Phase 1/2
primitives. It preserves record order, metadata and additional canonical fields,
then reconstructs the original payload byte-for-byte and rechecks every object
identity. The codec remains internal and has no effect on ordinary V5 mounting.

Exact source spans operate on bytes and select the lowest match. They reference
stored source blobs only. Candidate groups are enabled in object-record order
only when they reduce the complete body; whole-source duplicates therefore keep
the cheaper shared-blob representation. Malformed modes, ordinals, lengths,
spans, CBOR, identities, limits and noncanonical bodies fail closed.

The shared canonical-CBOR decoder now rejects impossible collection counts
before allocating or iterating, rejects duplicate map keys, and safely retains
`__proto__` as data. This is a runtime hardening change used by the object
decoder and covered by the ordinary V5 regression suite.

The [Phase 3 measurements](benchmarks/vqf1/phase3-objects.json) run 100 object
body encodes and decodes per conformance fixture and mode. Decode measurements
include full canonical re-encoding validation. Reproduce with a new path:

```sh
npm run benchmark:vqf:objects -- --output /tmp/vqf-objects.json
```

The measured bodies are 1.35–1.73× smaller on these four small fixtures before
the future 56-byte envelope. Exact migrated source/chunk duplicates correctly
stay as blob references because spans would add four bytes. The custom codec
tests demonstrate profitable substring spans separately.

Phase 3 adds exact round trips for every V5 conformance object payload, 1,000
seeded object payloads, Unicode and repeated-offset spans, complete-source and
empty chunks, absent sources, duplicate blobs, extensions, deterministic output,
hostile CBOR counts, prototype keys, corruption and resource limits.

The [recorded Phase 3 checks](benchmarks/vqf1/phase3-checks.json) cover the full
local regression, conformance, release, formatting and baseline-identity gates.

## Phase 4

`event_codec.ts` represents every fixed V1 event field directly while retaining
canonical provenance and additional fields. Digest ordinals factor event,
transaction, parent, target and payload identities; the existing string table
factors actors and kinds. Parent order and multiplicity remain unchanged.

Decoding bounds cumulative parent references and all existing byte, table and
record dimensions. It reconstructs the complete canonical event payload,
verifies every event ID, and requires deterministic physical re-encoding.
Unsupported flags, alternate representations, malformed fields, invalid
ordinals, truncation and trailing bytes fail closed.

The [Phase 4 measurements](benchmarks/vqf1/phase4-events.json) run 100 encodes
and decodes per V5 conformance fixture. They retain the exact event payload,
logical segment digest, commit digest and state root. Reproduce with:

```sh
npm run benchmark:vqf:events -- --output /tmp/vqf-events.json
```

The prototype bodies are 2.21–3.11× smaller before the future 56-byte envelope.
Phase 4 tests also cover an empty payload, extensions, repeated and reordered
parents, malformed records, resource limits, deterministic output, and 1,000
seeded event payloads.

The [recorded Phase 4 checks](benchmarks/vqf1/phase4-checks.json) cover the full
local regression, cross-runtime, conformance, release, formatting and exact
baseline-identity gates.

## Phase 5

`compressKnowledgeImageV5` writes VQF-1 envelopes only for object or event
segments whose complete envelope is smaller than the original logical payload.
The outer required-segment flag is `0x0001`; its existing digest field commits
to the reconstructed logical payload. Commit bytes/digest, roots and ordinary
segment behavior therefore remain unchanged.

Mounting recognizes flagged object/event segments, checks envelope
version/kind/reserved bytes, physical-body digest, declared lengths, canonical
codec reconstruction and the existing logical segment digest before continuing
normal commit/root verification. Compressed commits, unknown flags and malformed
envelopes fail closed. The compressor preserves raw commit and optional payloads,
and relocates only already-valid superblock pointers.

The [Phase 5 measurements](benchmarks/vqf1/phase5-images.json) include full
images, envelopes, headers and superblocks. Reproduce with:

```sh
npm run benchmark:vqf:images -- --output /tmp/vqf-images.json
```

The four small V5 fixtures become 1.13–1.77× smaller overall. The smallest
object segment remains ordinary because its envelope would grow it; every event
segment is profitable. Tests cover mixed compressed/plain images, both segment
kinds, deterministic retranscoding, no-growth fallback, unsupported flags,
physical corruption and rehashed inner corruption.

The [recorded Phase 5 checks](benchmarks/vqf1/phase5-checks.json) cover the full
local regression, cross-runtime, conformance, release, formatting and exact
baseline-identity gates.

## Phase 6

`query_index_codec.ts` encodes the existing canonical query-index CBOR using
digest tables, string dictionaries and delta-coded object ordinals. Decoding
reproduces `serializeKnowledgeQueryIndexV1` bytes exactly and rechecks
`indexRoot`. `serializeCompressedKnowledgeQueryIndexV1` wraps a profitable
envelope; ordinary CBOR sidecars remain the durable-store default.
`deserializeKnowledgeQueryIndexV1` accepts either form.

`compressKnowledgeImageV5({ index: true })` appends optional kind 129 with
outer flags 0 and the ordinary physical payload digest. Older TypeScript, Rust
and Python readers verify and skip that segment when required segments stay
ordinary. Required VQF object/event segments still fail closed on those older
readers. `queryIndexFromKnowledgeImageV5` decodes kind 129 and runs the existing
full derived-content verification before candidates are used.

The [Phase 6 measurements](benchmarks/vqf1/phase6-index.json) run 100 encodes
and decodes per V5 conformance fixture. Reproduce with:

```sh
npm run benchmark:vqf:index -- --output /tmp/vqf-index.json
```

Phase 6 tests also cover 1,000 seeded indexes, candidate/query-root identity,
malformed tables and deltas, rehashed inner corruption, unknown optional
preservation, and replacement of an existing kind 129 only when it is a valid
VQF index.

The [recorded Phase 6 checks](benchmarks/vqf1/phase6-checks.json) cover the full
local regression, cross-runtime, conformance, release, formatting and exact
baseline-identity gates.

## Phase 7

`lexical_postings.ts` is the query-facing postings reader. It exposes term
presence, document frequency, stored-stream order and per-term document
postings with positions and term frequency. `createLegacyLexicalPostingsReader`
parses the existing V4 sentinel array, including one-based block IDs for
version ≥ 3 and raw block IDs for older packs. Truncated streams and duplicate
term IDs fail closed. The V4 serializer and on-disk postings layout are
unchanged.

`query.ts` harvests candidates through this adapter instead of scanning the
entire posting array on every query. Requested terms are applied in stored
stream order so BM25 sums, phrase positions, expansion, ranking and block-id
tie-breaks stay identical. Query-time counters record posting lists actually
read; construction still inspects the legacy array once.

Reproduce the focused checks with:

```sh
node --test packages/core/test/vqf-postings.test.mjs
```

The [recorded Phase 7 checks](benchmarks/vqf1/phase7-checks.json) cover the core
regression, TrustBench, V5 smoke, release/archive, formatting, documentation
and exact Phase 0 baseline-identity gates.

Next implementation work is direct varint postings, lexicon pages and bounded
microblocks.
