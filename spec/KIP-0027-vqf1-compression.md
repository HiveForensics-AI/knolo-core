# KIP-0027: VQF-1 proof-preserving physical compression

Status: draft for prototype; integer, bounded byte-I/O, digest/string tables,
exact byte factoring, internal object/event/query-index payload codecs, an
opt-in V5 physical transcode including optional kind-129 indexes, and a
lexical postings reader with a V4 sentinel-array adapter are implemented.
The interoperable byte format is not frozen.

## Purpose and compatibility

VQF-1 factors repeated bytes and identities and later introduces directly
addressable positional postings. It changes physical storage, never logical
knowledge. Existing canonical CBOR, object/event identity, commit composition,
state roots, token normalization, positions and scoring remain unchanged.

Read ordinary V3/V4/V5 artifacts. Continue writing ordinary artifacts by
default. VQF writing requires explicit opt-in. Compressed required V5 segments
require a VQF-aware runtime. No CESR semantics or new logical roots are added.

This draft supplements KIP-0001 only for the explicitly defined encodings
below. KIP-0002, KIP-0003 and KIP-0021 remain the logical contracts.

## Logical equivalence

For every compressed segment, decoding MUST reproduce the original canonical
payload bytes exactly. Preserving just an equivalent set of objects is
insufficient: ordering and all canonical fields affect the segment digest.

The following MUST remain identical to the original image:

- object and event IDs and ordered roots;
- object and event logical segment digests;
- commit payload bytes and commit digest;
- state root and query results.

Compression is a physical transcode, not a new commit. Preserve original
record order, metadata, provenance, parent order and accepted extension fields.
If a codec cannot represent a valid payload exactly, retain that segment in
ordinary form. Do not reconstruct the input exclusively from normalized
runtime objects that may have discarded extension fields.

Keep the commit segment uncompressed. Physical superblock commit offsets and
their checksums may change; generations and logical identities do not.
Preserve unknown optional payloads and their relative order. Do not make an
invalid superblock valid as a side effect of relocation; preserve valid-slot
selection and torn-slot fallback behavior.

## Proposed segment assignments

| Field                 | Proposed value | Meaning                                                 |
| --------------------- | -------------- | ------------------------------------------------------- |
| Required segment flag | `0x0001`       | VQF-1 logical-payload encoding, kinds 1 and 2, schema 1 |
| Optional segment kind | `129`          | VQF-1 derived query index, schema 1, outer flags 0      |

These allocations are provisional until format freeze. No named conflicting
reservation was found during the local review. Kind 128 remains available to
the existing unknown-optional-segment compatibility fixture.

For required kinds 1 and 2 with VQF flag `0x0001`, outer payload length is
physical envelope length and the outer digest is the existing
`digestDomain('segment', logicalPayload)`. Unknown required encoding flags,
unsupported schemas and VQF-compressed commits MUST be rejected.

Ordinary flags-0 segment verification remains unchanged. Older readers hash
physical bytes, including optional segments; therefore adding an optional
kind alone is insufficient for compatibility. Kind 129 MUST retain an outer
physical segment digest and flags 0. Its inner envelope carries the compressed
index; its reconstructed index retains the existing logical `indexRoot`.
An older reader can verify and skip this segment when required segments are
ordinary. Test this behavior against existing TypeScript, Rust and Python
readers before claiming interoperability.

## Proposed physical envelope

All fixed-width integers are unsigned little-endian.

| Offset | Bytes       | Field                                                   |
| ------ | ----------- | ------------------------------------------------------- |
| 0      | 4           | ASCII `VQF1`                                            |
| 4      | 1           | Codec version 1                                         |
| 5      | 1           | Codec kind: proposed 1 objects, 2 events, 3 query index |
| 6      | 2           | Reserved, zero                                          |
| 8      | 8           | Logical payload length                                  |
| 16     | 8           | Physical body length                                    |
| 24     | 32          | Raw physical body digest                                |
| 56     | body length | Encoded body                                            |

The physical digest is
`SHA256(UTF8("knolo:vqf-physical:v1\0") || physicalBody)`.
Body length MUST equal envelope length minus 56. The codec kind MUST agree
with the enclosing segment kind. Reserved fields, unsupported versions,
invalid bounds and trailing bytes MUST fail closed.

Verify in this order: outer bounds and supported encoding; envelope bounds;
physical body digest; bounded decoding; exact logical length; existing logical
segment digest; existing object/event identities, commit and state-root rules.
For the optional index, additionally verify the ordinary outer physical digest
and the complete KIP-0021 derived contents against the image before use.

The body hash excludes the envelope header; length/kind/version checks and
logical verification remain mandatory. A self-declared physical hash is not
proof of membership in a trusted image.

## Primitive and factoring requirements

- Integers use shortest-form unsigned LEB128. The prototype maximum is `2^64-1`,
  at most ten bytes; the tenth byte may carry only bit 0 and no continuation.
  Reject negative, fractional, non-finite, unsafe numeric inputs, overflow,
  truncation and nonminimal encodings. Convert to JS numbers only after
  checking `Number.MAX_SAFE_INTEGER` and the relevant resource bound.
- Strictly increasing integer lists use first value plus one, then positive
  deltas, with explicit counts. Check accumulated values and first-value
  overflow before arithmetic or allocation.
- Digest tables contain sorted unique raw 32-byte SHA-256 digests. Ordinals
  are zero-based varints; restore exactly lowercase `sha256-` strings.
- String dictionaries sort by UTF-8 bytes. Store a string inline unless
  dictionary entry, tag, count and ordinal costs yield positive total savings.
  Selection and all equal-gain ties MUST be deterministic.
- Blob deduplication uses hashes only to locate candidates, followed by byte
  equality. Never merge logically distinct objects or events.
- Source spans reference a stored source blob with byte offset and length,
  never another span. Verify actual equality during encoding, choose the
  lowest matching UTF-8 byte offset in the identified source, and fall back
  to a blob if absent. Preserve logical metadata unchanged.
- Metadata and provenance initially remain canonical CBOR. Event records
  include or deterministically restore every V1 field, including version.
- Decode tables, counts, ordinals and spans within validated limits; reject
  duplicates where uniqueness is required and reject unconsumed bytes.

Canonical integer vectors: `0 → 00`, `1 → 01`, `127 → 7f`, `128 → 80 01`,
`255 → ff 01`, `300 → ac 02`. `80 00` and `81 00` are noncanonical.

Keep a segment ordinary when its complete VQF envelope is not smaller than
the original payload. Statistics MUST include envelope and directory costs.
Report logical/physical ratio and fractional reduction separately.

## Query and lazy-reader boundaries

The derived V5 index remains a candidate accelerator verified against the
same state root and full derived contents. Stale or malicious indexes MUST
not remove matching evidence silently. Preserve sidecar serialization.

Future lexical readers expose directly addressable term streams with exact
document IDs, positions, tf and df. Legacy adapters preserve existing block-ID
offset conventions. Varint postings and optional phrase factoring MUST feed
identical scoring inputs in the same deterministic order.

The TypeScript prototype now has that reader interface. Query evaluation uses
it through a V4 adapter that indexes the existing sentinel `Uint32Array` once
and then reads only requested term streams. Pack serializers are unchanged.
Term processing order follows stored stream order so BM25 sums, phrase
positions, expansion, ranking and block-id tie-breaks remain identical.
Construction may inspect the whole array; query-time accounting MUST show that
unrelated posting lists are not reread. Direct varint postings, lexicon pages
and microblocks remain a later increment.

Phrase references must preserve every offset for repeated terms, remain within
block boundaries and reconstruct exact sorted unique positional lists. Disable
factoring when equivalence or positive total savings cannot be demonstrated.
Profile parameters and tie-breaking rules must be explicit before freeze.

The initial reader fully verifies the image before exposing evidence. Later
selective materialization may use owned immutable, already-verified bytes.
Cold selective verification requires an authenticated mapping to committed
logical state; neither a body hash nor an uncommitted directory provides it.
Do not advertise that guarantee from this envelope alone.

## Limits, conformance and freeze gates

Retain the existing 512 MiB physical segment and 1,024-segment limits. Add
independent logical-output, aggregate-output, nesting, record/table/count and
work limits. Charge repeated shared-blob expansion against aggregate budgets.
Never allocate directly from an untrusted declared length. Exact defaults
remain open pending measured workloads and adversarial decoder tests.

Freeze requires exact logical payload and root goldens, deterministic encoding,
1,000 seeded randomized codec cases, old-reader rejection/skip tests, malformed
fixtures, unchanged lexical/EQL regressions, and reproducible benchmark results.
Rehash malformed physical bodies in tests to exercise inner validation too.
Then add Rust/Python decoding parity for the TypeScript golden fixtures.

Open wire decisions before freeze: complete profile defaults;
lexical artifact placement and evidence mapping; lexicon pages and microblock
directories; phrase selection and authenticated lazy verification. No VQF
container conformance bytes are published by this draft.

## Phase 2 prototype table encoding

These internal encodings are tested but remain provisional until container
integration and format freeze. All counts, lengths and ordinals use canonical
unsigned varints.

Digest tables encode a count followed by exactly `count * 32` raw bytes,
strictly sorted and unique. Digest inputs must be exactly 71 characters:
`sha256-` plus 64 lowercase hexadecimal digits. Ordinal lookup rejects an
absent digest; invalid ordinals, duplicate/unsorted entries, incorrect lengths,
nonminimal integers and trailing bytes are rejected.

String tables encode a count followed by `(UTF-8 byte length, bytes)` entries,
strictly sorted by UTF-8 bytes. Value records use byte tag 0 followed by length
and inline bytes, or byte tag 1 followed by an ordinal. A reference is canonical
only when it is shorter than inline representation; an inline value is rejected
when the table offers a shorter reference. Ties stay inline. Unknown tags,
invalid ordinals and trailing bytes are rejected.

Dictionary selection counts exact input string occurrences, sorts candidates
by UTF-8 bytes, then greedily appends only profitable candidates. For a candidate
of length `L`, frequency `F`, and prospective zero-based ordinal `N`, let `v(x)`
be the unsigned-varint width. Its exact incremental gain is:

```text
F * ((1 + v(L) + L) - (1 + v(N)))
  - (v(L) + L)
  - (v(N + 1) - v(N))
```

Accept only positive gain. Previously assigned ordinals do not change. This is
a deterministic greedy rule, not a claim of globally optimal selection.
The empty-table count byte is included in both comparison baselines.

UTF-8 round trips must preserve leading BOMs, composed/decomposed characters,
NULs and supplementary characters exactly. Reject malformed UTF-8 and unpaired
UTF-16 surrogates; never normalize or replace evidence during factoring. Apply
the same rules with native and runtime-fallback UTF-8 helpers.

Exact byte factoring uses SHA-256 to locate candidates and compares actual
bytes before reuse. Unique blobs are sorted lexicographically by raw bytes,
and original input order maps to their zero-based ordinals. Own retained bytes
and return copies. Empty blobs are valid. No source spans or blob wire framing
are implemented at this phase. Report duplicate payload bytes saved separately
from overhead-inclusive compression savings.

Prototype table defaults are 1,000,000 entries and 64 MiB; callers may lower
the entry cap or choose a byte cap up to the existing 512 MiB buffer ceiling.
Build entry limits count all occurrences, including duplicates. String build
byte limits cover aggregate input UTF-8 bytes and the encoded table; blob build
byte limits cover aggregate input payload bytes, including duplicates. Digest
limits cover the encoded table. Decode limits cover encoded input and counts,
with bounds checked before copying entries. These are internal table budgets,
not the future container's aggregate decompression/memory defaults.

## Phase 3 prototype object body

The internal object codec accepts an existing canonical V5 object-segment
payload and reconstructs those payload bytes exactly. It is used by the current
opt-in envelope/transcode path.

The provisional body is:

```text
u8 codecVersion = 1
u8 flags (bit 0: source-span selection enabled)
uvarint digestTableLength; digestTable
uvarint stringTableLength; stringTable
uvarint blobCount
  repeated: uvarint blobLength; blobBytes
uvarint objectCount
  repeated:
    uvarint objectDigestOrdinal
    stringValue kind
    u8 byteMode
      mode 0: uvarint blobOrdinal
      mode 1: uvarint sourceBlobOrdinal; uvarint byteOffset; uvarint byteLength
    uvarint metadataLength; canonicalMetadataMap
    uvarint extensionLength; canonicalExtensionMap
```

Blob entries are strictly sorted and unique raw byte strings. Mode 1 is legal
only when the source-span flag is set. Source records always have mode 0, so a
span never references another span. Object records remain in original order.
The extension map contains every original key except `id`, `kind`, `bytes`, and
`meta`; those reserved keys are rejected if found in the extension stream.

Encoding validates the original object ID against canonical `{kind, bytes,
meta}`. Decoding validates every reconstructed identity, its logical-size
budget, all ordinals and byte bounds, then re-encodes the complete body with the
declared flag. The input body must match that canonical re-encoding exactly.
This rejects unused or unsorted tables, alternate inline/reference choices,
nonminimal integers, noncanonical span choices, and trailing bytes.

Source-span candidates require a `chunk` whose metadata `sourceObject` names an
unambiguous source record and whose bytes exactly match a source byte range.
Search and offsets operate on bytes. The lowest matching offset is canonical.
Candidates with identical chunk bytes form a group. Starting from blob-only
encoding, groups are considered by their first object-record position and are
accepted only when enabling the entire group strictly reduces the complete
object body. Ties remain blob references. This prevents whole-source duplicate
chunks from growing when ordinary blob deduplication is cheaper.

The prototype also hardens the shared canonical-CBOR reader: declared array and
map counts are bounded by remaining input before iteration, duplicate map keys
are rejected, and a literal `__proto__` key is defined as ordinary data without
changing the decoded object's prototype.

## Phase 4 prototype event body

The internal event codec accepts an existing canonical V5 event-segment payload
and reconstructs it byte-for-byte. It is used by the current opt-in
envelope/transcode path.

```text
u8 codecVersion = 1
u8 flags = 0
uvarint digestTableLength; digestTable
uvarint stringTableLength; stringTable
uvarint eventCount
  repeated:
    uvarint eventVersion
    uvarint eventDigestOrdinal
    uvarint transactionDigestOrdinal
    uvarint parentCount; repeated uvarint parentDigestOrdinal
    stringValue actor
    uvarint actorCounter
    stringValue kind
    uvarint targetDigestOrdinal
    uvarint payloadDigestOrdinal
    uvarint provenanceLength; canonicalProvenanceMap
    uvarint extensionLength; canonicalExtensionMap
```

The digest table includes event, transaction, parent, target and payload
digests. Parent entries retain their original order and multiplicity. The
string table is built from actor and kind occurrences. Version remains explicit
and must be 1; actors are nonempty and actor counters are positive safe integers.
Provenance remains canonical CBOR. The extension map contains every original
key outside the fixed V1 schema and may not redefine a fixed key.

Encoding verifies each input event identity. Decoding bounds cumulative parent
references, tables, records and logical/physical bytes, reconstructs every
canonical record, verifies its identity, and requires the complete physical
body to equal deterministic re-encoding. This rejects unused tables, alternate
string encodings, nonminimal integers, invalid ordinals and trailing bytes.

## Phase 6 prototype query-index body

The internal query-index codec accepts the existing canonical CBOR from
`serializeKnowledgeQueryIndexV1` and reconstructs those bytes exactly. It is
used by compressed sidecars and by optional V5 segment kind 129.

```text
u8 codecVersion = 1
u8 flags = 0
uvarint digestTableLength; digestTable
uvarint stringTableLength; stringTable
uvarint objectCount
  repeated uvarint objectDigestOrdinal
uvarint kindPostingCount
  repeated: stringValue key; uvarint idCount; delta-encoded object ordinals
uvarint fieldPostingCount
  repeated: stringValue key; uvarint idCount; delta-encoded object ordinals
uvarint stateRootDigestOrdinal
uvarint indexRootDigestOrdinal
```

The digest table contains `objectIds`, `stateRoot` and `indexRoot`. Object-ID
UTF-8 order is not digest-table raw-byte order, so object records store explicit
digest ordinals. Posting lists store object ordinals (indexes into `objectIds`)
and encode them as strictly increasing integer lists: first value plus one, then
positive deltas, with an explicit count. Kind and field map keys go through the
string table and are written in canonical UTF-8 key order. Field keys that embed
digest text remain strings.

Decoding reconstructs the canonical CBOR, verifies `indexRoot` against the
derived body, then requires the physical body to equal deterministic
re-encoding. Keep a sidecar or kind-129 segment ordinary when the complete
envelope is not smaller than the canonical CBOR. Kind 129 uses outer flags 0 and
the ordinary physical payload digest so older readers can verify and skip it.
Required VQF object/event segments remain incompatible with those older
readers. Ordinary CBOR sidecars remain the durable-store default; deserializers
accept a `VQF1` envelope when present.
