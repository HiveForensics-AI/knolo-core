# V5 interoperability and trust boundary

This document freezes the V5 cross-runtime expectations that must remain true
before V6 work begins. It describes the portable artifact, verification roots,
query receipt shape, migration receipt rules, and the limits of the supported
profiles. It does not define CESR or any V6 evidence semantics.

## Frozen cross-runtime vectors

The following checked-in vectors are normative for the V5 foundation:

| Vector                     | TypeScript                                                                | Rust                                         | Python                                  |
| -------------------------- | ------------------------------------------------------------------------- | -------------------------------------------- | --------------------------------------- |
| Minimal Knowledge Image    | `conformance/v5/knowledge-image-v5.fixture.base64`                        | `packages/core-rust/tests/core_rust_test.rs` | `packages/core-python/tests/test_v5.py` |
| State root                 | `sha256-bc419264f60822bb8c601f01eb3020671e78056f4e6403ab6db087911d25d694` | same                                         | same                                    |
| Active commit              | `sha256-7a6ed0a7e488ee085053d6d8d885141e0a8b6abd5c40bd552e4d2b10b721b177` | same                                         | same                                    |
| EQL plan root              | `sha256-832b843bb24c188ec60f54689a2e6c3af7c4c8c1121c3c8fa782a89b06db5d11` | same                                         | same                                    |
| EQL result root            | `sha256-577f70602232871a16191a9648ddac3a8788f9508898ddad2f6a287efb489f9b` | same                                         | same                                    |
| V1–V3 migration state root | `sha256-e49edad45514b6ca08f2d350a094ff7750bfc7b833ac8b2ed17ddf7cafd3037c` | same                                         | legacy pack compatibility               |

TypeScript and Rust also consume the migration and diagnostics/Studio fixtures
listed in [`conformance/v5/README.md`](../conformance/v5/README.md). Python’s
V5 profile is intentionally read-only, so it verifies and queries the shared
image but does not produce V5 mutations or migration receipts.

## Receipt and root rules

- A V5 image is identified by its verified state root. The root is computed
  from the canonical required sections and the committed object/event roots;
  unknown optional sections do not change the required V5 root composition.
- Object and event identities use the declared domain-separated SHA-256
  digests. Canonical CBOR maps sort text keys by UTF-8 bytes; integer, byte
  string, array, map, and text encodings must be minimal and definite-length.
- A query receipt carries the query version, verified `stateRoot`, deterministic
  `planRoot`, and deterministic `resultRoot`. The TypeScript and Python EQL
  implementations derive these values from the same normalized query and
  ordered result identities.
- A migration receipt carries the source format/version, target V5 version,
  source and target state roots, and deterministic identity mappings. A
  migration is accepted only when the target image verifies and the receipt
  recomputes from the declared source and target artifacts.
- Application adapters may add framework metadata, but they must preserve the
  V5 roots and identify the compatibility profile. They must not claim that a
  model response is certified merely because it came from a V5 query.

## Compatibility and threat boundaries

V5 provides portable bytes, deterministic roots, fail-closed parsing, bounded
query planning, and explicit verification. It does not provide model truth,
confidentiality, key custody, network delivery, host policy, or an attestation
that an external model followed a query receipt. Hosts own credentials,
networking, model inference, UI, external side effects, deployment state, and
authorization decisions.

The supported Python profile is a read-only verifier/query implementation. The
Rust and WASM profiles expose the native verification boundary and do not
silently acquire Node or service behavior. ICP remains a synchronized legacy
compatibility profile. LangChain and LlamaIndex adapters expose V5 query roots
as metadata while leaving model execution to the host framework.

The V5 tests cover malformed encoding, digest and root mismatch, truncation,
invalid bounds, migration failures, replay/expiry behavior, crashed writes,
lease recovery, and concurrent readers. These are integrity and lifecycle
guarantees, not a promise that arbitrary hostile input is safe to execute in a
host process without ordinary sandboxing and resource limits.

## V5-to-V6 handoff boundary

The V6 document is reviewed as the next work stream, but remains outside the
V5 implementation and release surface. CESR evidence atoms, obligations,
witnesses, solver certificates, decision statuses, V6 KIPs, and `knolo v6`
commands must not be added to V5 modules or conformance fixtures.
