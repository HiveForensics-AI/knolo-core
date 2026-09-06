# VQF-1 baseline benchmarks

Phase 0 establishes the ordinary V4/V5 baseline before any codec changes.
KIP-0027 is a draft; no VQF compression or performance improvement is claimed.

## Reproduce

From the repository root with the existing Node dependencies installed:

```sh
npm run benchmark:vqf -- --samples 100 --output /tmp/vqf-baseline.json
npm run benchmark:vqf -- --samples 2 --warmup 0 --compare /tmp/vqf-baseline.json --output /tmp/vqf-repeat.json
```

The first command builds TypeScript and runs all four corpora at 32 and 128
documents. Each corpus/size runs sequentially in a fresh Node process. Reports
are created exclusively: an existing output file is never overwritten.
Use a fresh output filename on each run. `--sizes`, `--samples`, `--warmup`
and `--seed` are explicit options; `--help` lists them.

The comparison command recomputes the same corpus and asserts exact artifact
bytes via digests, segment/index digests, roots, fixture anchors, ordered hits,
scores and returned text/evidence. It ignores timing, memory and environment
fields. A mismatch exits nonzero; the harness does not update expected results.
Two samples are sufficient for this correctness check, not a latency estimate.

Saved results:

- [Baseline measurements and exact query outputs](benchmarks/vqf1/baseline.json)
- [Existing-suite baseline results](benchmarks/vqf1/checks.json)

The JSON records revision, harness hash, dirty-tree status, Node/V8/OS/CPU,
memory, seed, options, source manifests, artifact hashes and all raw timing
samples. Run on a quiet machine; compare matching corpus versions and hashes.
Performance data is machine-specific and is not a release threshold.

## Corpus contract

Corpus generator version 1 uses xorshift32 with seed `20260905`. Build V4
with graph generation disabled and no embeddings; migrate that exact artifact
to V5 through the existing public migration API. Source/chunk duplication is
therefore representative of the current migration path. Generated documents
carry stable IDs, headings and one of three namespaces.

| Corpus         | Construction                                                                                                          | Purpose                                                                       |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| Low redundancy | 96 seeded pseudorandom alphanumeric terms per document; first document includes Unicode and a known phrase            | Low language repetition, including absent-term queries                        |
| Enterprise     | Policy/procedure templates, four subjects, changing IDs, owners and revision values                                   | Repeated terminology and moderate boilerplate                                 |
| Repetitive     | Four contract variants with repeated sentences and phrases                                                            | High duplication and future positional factoring                              |
| Repository     | Explicit sorted source manifest, split into 2,048-code-point fragments, cycling only after all fragments are consumed | Repository documentation/code text; manifest and fragment/cycle mapping saved |

The repository manifest is fixed in the harness, rather than globbing all docs.
It includes README, selected host/coordination/interoperability docs, tokenizer
and indexer source, and KIPs 0001/0002/0003/0021. Every original file and the
complete generated corpus are hashed. Editing a listed file changes the
comparison baseline visibly. Corpus generation never modifies source files.

These are small engineering baselines, not gigabyte-scale or production
enterprise measurements. Repository cycling increases repetition at larger
sizes and must be considered when interpreting future compression ratios.
Semantic storage is explicitly zero in these lexical-only cases; a separate
semantic-enabled benchmark is required before changing semantic serialization.

## Measurement semantics

- Source bytes count UTF-8 document text once. Logical segment bytes are the
  sum of the original canonical V5 payload lengths. Physical payload bytes
  include codec envelopes when a codec exists; whole-artifact bytes also
  include outer headers and superblocks. This baseline uses no codec, so its
  payload ratio is 1 and reduction is 0.
- V4 section sizes include lexicon, postings, chunks, metadata and manifest.
  V5 object/event/commit sizes and the separate query-index size are recorded.
  The sidecar index is not counted inside the V5 image bytes.
- Build, migration and index-build times are single observations. Mount and
  query timings use three warmups and 100 measured calls in the saved baseline.
  Percentiles use nearest rank; raw samples are retained. Even 100 samples
  provide only a preliminary tail-latency estimate.
- V4 queries run on an already mounted pack. Expansion is disabled except in
  its explicit test case. Quoted phrases, repeated terms, Unicode, absent
  terms, namespace constraints and source constraints have fixed cases.
- V5 scan and indexed calls use the existing public EQL API. It remounts the
  image and revalidates the derived index on each indexed query; timings include
  that work. They are not measurements of a future trusted reader cache.
- Peak RSS is the worker process high-water mark including runtime imports,
  repeated builds, validation, mounting and queries. Final memory counters are
  also saved. This is not incremental codec memory or per-operation peak heap.
- Compression/decompression timings and bytes/streams/microblocks decoded per
  query are `null`, because no codec or instrumentation exists yet. Do not
  interpret them as zero-cost results.

The harness verifies deterministic V4 builds and V5 migrations within each
case, repeated lexical results, and exact equality between scanned and indexed
EQL results. It mounts all four existing V5 binary conformance fixtures and
saves their object/event roots, commit digest and state root.

## Recorded measurements

Measured on Node v20.20.2 / AMD Ryzen 9 7900X 12-Core Processor.
All sizes are bytes; times are milliseconds. Query columns use the fixed
`verifiable knowledge` V4 query and indexed `FROM chunk LIMIT 5` EQL query.

| Corpus         | Docs | V4 bytes | V5 bytes | Index bytes | V5 mount p50 | V4 query p50 | EQL indexed p50 | Peak RSS MiB |
| -------------- | ---: | -------: | -------: | ----------: | -----------: | -----------: | --------------: | -----------: |
| low-redundancy |   32 |   224684 |   104114 |       51080 |        11.41 |         0.24 |           17.22 |        131.5 |
| low-redundancy |  128 |   899579 |   410510 |      201217 |        44.56 |         0.91 |           70.63 |        161.0 |
| enterprise     |   32 |   113760 |    92652 |       50952 |        10.24 |        14.38 |           16.77 |        145.8 |
| enterprise     |  128 |   449416 |   364946 |      200705 |        40.91 |        16.79 |           67.36 |        162.5 |
| repetitive     |   32 |   164912 |   124936 |       50952 |        12.67 |        32.81 |           18.41 |        141.8 |
| repetitive     |  128 |   654299 |   493952 |      200705 |        49.53 |        36.52 |           75.60 |        177.4 |
| repository     |   32 |   297661 |   162733 |       50952 |        14.32 |        33.53 |           20.68 |        152.6 |
| repository     |  128 |  1060343 |   633681 |      200705 |        59.93 |        39.52 |           85.85 |        185.4 |

V4 and V5 are different representations; their sizes are not a compression
ratio. V5 here includes migration objects/events and excludes the separate
query-index sidecar. Every measured representation is uncompressed.

The low-redundancy query has few matches, while the repetitive cases have many;
latencies across corpora are not measurements of an identical candidate workload.
Use each corpus as its own comparison baseline.

## Baseline checks

All eight local checks passed before compression implementation:

| Command                                                 | Result                                                                                                                                          |
| ------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm test`                                              | 31 core Node test entries, core legacy regression script, and CLI/scaffold/adapter suites passed; TypeScript and no-Node runtime check included |
| `npm run test:icp`                                      | 18 Rust core tests, 11 ICP tests and template synchronization passed                                                                            |
| `.venv/bin/python -m pytest packages/core-python/tests` | 21 tests passed, Python 3.13.5                                                                                                                  |
| `npm run trustbench:test`                               | Existing conformance passed                                                                                                                     |
| `npm run smoke:v5`                                      | Clean V5 smoke passed                                                                                                                           |
| `npm run release:check`                                 | Build, release metadata, public exports, documentation and package archive checks passed                                                        |
| `npm run format:check:all`                              | Existing formatting checks passed                                                                                                               |
| `npm run docs:check`                                    | Existing documentation link audit passed                                                                                                        |

These are local checks, not hosted CI, publication verification or deployment.
Live ICP end-to-end tests are outside this unit/conformance baseline.

## Gates for the next phases

Phase 2 adds [table/factoring measurements](benchmarks/vqf1/phase2-tables.json)
on four small conformance fixtures. Reproduce with:

```sh
npm run benchmark:vqf:tables -- --output /tmp/vqf-tables.json
```

These are primitive costs, not whole-image compression results. Digest costs
compare raw ASCII occurrences against a table plus ordinal stream. String
costs include dictionary counts, lengths, tags and ordinals. Blob costs count
payload bytes only, excluding future blob-record/envelope overhead.

| Fixture                   | Digest ASCII → table + ordinals | Inline strings → dictionary + values | Blob payload → unique payload |
| ------------------------- | ------------------------------- | ------------------------------------ | ----------------------------- |
| Knowledge image           | 355 → 102 B                     | 34 → 34 B                            | 5 → 5 B                       |
| Migrated legacy V3        | 2059 → 382 B                    | 202 → 106 B                          | 154 → 128 B                   |
| Migrated V4 claims/agents | 2911 → 522 B                    | 280 → 150 B                          | 378 → 338 B                   |
| Transaction snapshot      | 781 → 236 B                     | 64 → 64 B                            | 12 → 12 B                     |

Unprofitable string candidates remain inline; the two equal-size cases have
empty dictionaries. Every fixture retains exact digests, strings and payloads.
Raw samples for 100 primitive-build iterations per fixture are in the report.

Phase 3 adds [object-body measurements](benchmarks/vqf1/phase3-objects.json).
These exclude the future 56-byte VQF envelope and unchanged outer segment
header, so they are not complete artifact ratios.

| Fixture                   | Logical object payload | Prototype body | Ratio | Source spans selected |
| ------------------------- | ---------------------: | -------------: | ----: | --------------------: |
| Knowledge image           |                  119 B |           72 B | 1.65× |                     0 |
| Migrated legacy V3        |                 1151 B |          853 B | 1.35× |                     0 |
| Migrated V4 claims/agents |                 1640 B |         1218 B | 1.35× |                     0 |
| Transaction snapshot      |                  240 B |          139 B | 1.73× |                     0 |

The two modes produce the same best body on these fixtures: their chunks equal
complete source blobs, so shared blob ordinals cost less than spans. Source
spans are selected and measured by the larger substring/property tests. Once
the envelope exists, the 119-byte fixture would fall back to ordinary storage
because `72 + 56` is larger than its logical payload.

Phase 4 adds [event-body measurements](benchmarks/vqf1/phase4-events.json), also
excluding the future envelope and unchanged outer segment header.

| Fixture                   | Logical event payload | Prototype body | Ratio |
| ------------------------- | --------------------: | -------------: | ----: |
| Knowledge image           |                 484 B |          219 B | 2.21× |
| Migrated legacy V3        |                2754 B |          903 B | 3.05× |
| Migrated V4 claims/agents |                3882 B |         1247 B | 3.11× |
| Transaction snapshot      |                1039 B |          464 B | 2.24× |

Each decoded event body reproduces the exact original payload and segment
digest.

Phase 5 adds [whole-image measurements](benchmarks/vqf1/phase5-images.json).
These include envelopes, all outer segment headers and superblocks.

| Fixture                   | Ordinary image | VQF image | Ratio | Reduction | Object VQF | Event VQF |
| ------------------------- | -------------: | --------: | ----: | --------: | :--------: | :-------: |
| Knowledge image           |         1848 B |    1639 B | 1.13× |     11.3% |     no     |    yes    |
| Migrated legacy V3        |         5160 B |    3123 B | 1.65× |     39.5% |    yes     |    yes    |
| Migrated V4 claims/agents |         6777 B |    3832 B | 1.77× |     43.5% |    yes     |    yes    |
| Transaction snapshot      |         2598 B |    2034 B | 1.28× |     21.7% |    yes     |    yes    |

The first fixture's object payload remains ordinary because 72 bytes of object
body plus the 56-byte envelope exceeds its 119-byte logical payload. Every
reported image preserves exact commit bytes/digest, state root, decoded objects
and decoded events.

Phase 6 adds [query-index measurements](benchmarks/vqf1/phase6-index.json).
Body sizes exclude the 56-byte envelope; sidecar/kind-129 sizes include it.

| Fixture                   | Logical CBOR | Prototype body | Ratio | Sidecar |
| ------------------------- | -----------: | -------------: | ----: | ------: |
| Knowledge image           |        734 B |          266 B | 2.76× |   322 B |
| Migrated legacy V3        |       4130 B |         1419 B | 2.91× |  1475 B |
| Migrated V4 claims/agents |       5275 B |         1768 B | 2.98× |  1824 B |
| Transaction snapshot      |       1251 B |          458 B | 2.73× |   514 B |

Every reconstructed index retains the original `indexRoot` and candidate sets.
Kind 129 uses outer flags 0 so older readers can verify and skip it.

```sh
npm run benchmark:vqf:index -- --output /tmp/vqf-index.json
```

Phase 8 adds [lexical-index measurements](benchmarks/vqf1/phase8-postings.json).
Complete-artifact ratios include lexicon pages, directories and microblock
headers versus V4 sentinel postings plus JSON lexicon bytes. Posting-stream
ratios compare only the varint lists with the V4 `Uint32Array`. These corpora
are generated for lexical measurement; they are not the Phase 0 image baseline.

| Corpus         | Docs | Terms | V4 postings | Posting stream | Stream ratio | V4 lexical | VQF artifact | Artifact ratio |
| -------------- | ---: | ----: | ----------: | -------------: | -----------: | ---------: | -----------: | -------------: |
| low-redundancy |   32 |  3072 |     61440 B |        12288 B |        5.00× |   114033 B |      57113 B |          2.00× |
| low-redundancy |  128 | 12288 |    245760 B |        49248 B |        4.99× |   461835 B |     232147 B |          1.99× |
| enterprise     |   32 |    52 |      8480 B |         2068 B |        4.10× |     9059 B |       2643 B |          3.43× |
| enterprise     |  128 |   148 |     33440 B |         8233 B |        4.06× |    35056 B |       9763 B |          3.59× |
| repetitive     |   32 |     5 |      2856 B |          709 B |        4.03× |     2918 B |        836 B |          3.49× |
| repetitive     |  128 |     5 |     11304 B |         2826 B |        4.00× |    11366 B |       2958 B |          3.84× |
| repository     |   32 |    70 |      3632 B |          838 B |        4.33× |     4486 B |       1524 B |          2.94× |
| repository     |  128 |   262 |     14384 B |         3342 B |        4.30× |    17857 B |       6065 B |          2.94× |

Every case reconstructed exact positions, tf and df, and matched ordinary V4
query scores. Query-time counters read one posting list for a single-term
lookup. Default 64 KiB microblocks stay as one block on these sizes; smaller
targets are covered by tests.

```sh
npm run benchmark:vqf:postings -- --output /tmp/vqf-postings.json
```

Phase 9 adds [phrase-factoring measurements](benchmarks/vqf1/phase9-phrases.json).
Ratios compare balanced/max artifacts with the unfactored `fast` layout on the
same generated lexical corpora. Low-redundancy cases correctly keep flags 0.

| Corpus         | Docs |     Fast | Balanced |      Max | Balanced phrases | Max phrases | Balanced ratio | Max ratio |
| -------------- | ---: | -------: | -------: | -------: | ---------------: | ----------: | -------------: | --------: |
| low-redundancy |   32 |  57113 B |  57113 B |  57113 B |                0 |           0 |          1.00× |     1.00× |
| low-redundancy |  128 | 232147 B | 232147 B | 232147 B |                0 |           0 |          1.00× |     1.00× |
| enterprise     |   32 |   2643 B |   1260 B |   1260 B |                3 |           3 |          2.10× |     2.10× |
| enterprise     |  128 |   9763 B |   3859 B |   3859 B |                3 |           3 |          2.53× |     2.53× |
| repetitive     |   32 |    836 B |    399 B |    269 B |                2 |           1 |          2.10× |     3.11× |
| repetitive     |  128 |   2958 B |   1081 B |    566 B |                2 |           1 |          2.74× |     5.23× |
| repository     |   32 |   1524 B |   1253 B |   1253 B |                2 |           2 |          1.22× |     1.22× |
| repository     |  128 |   6065 B |   4835 B |   4835 B |                2 |           2 |          1.25× |     1.25× |

Every case reconstructed exact positions, tf and df. Fast, balanced and max
matched ordinary V4 query scores. Phrase streams are omitted when they do not
reduce the complete artifact.

```sh
npm run benchmark:vqf:phrases -- --output /tmp/vqf-phrases.json
```

Keep exact logical payloads, IDs, roots and query outputs as hard gates.
For every later codec, report complete artifact size and segment/section
sizes, `logicalBytes / physicalBytes` and
`1 - physicalBytes / logicalBytes`, including all codec overhead. Keep a segment
ordinary if its encoded envelope is not smaller.

The proposed 3x total image and approximately 2x duplicated-text-plane
targets remain unmeasured. Phase 8 posting streams on these corpora are
4.0–5.0× smaller than V4 sentinel postings. Phase 9 phrase factoring further
reduces repetitive and enterprise lexical artifacts by 2.1–5.2× versus the
unfactored fast layout; that is a prototype observation, not a frozen or
release claim. Add larger corpus scales before selecting
decoder limits or accepting scalability claims. Set mount, query and memory regression
budgets against repeated measurements before evaluating a codec for release.
