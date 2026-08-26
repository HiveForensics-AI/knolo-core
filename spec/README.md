# Knolo V5 specifications

The V5 foundation freezes the byte-level contracts before introducing
transactions, EQL, authority, or durable agent execution.

| Spec | Contract |
| --- | --- |
| KIP-0001 | V5 Knowledge Image container, superblocks, segments, bounds, and mount rules |
| KIP-0002 | Knowledge events, object identity, and root construction |
| KIP-0003 | Canonical CBOR and SHA-256 domain-separated digests |
| KIP-0004 | Deterministic V1–V4 migration and receipt semantics |
| KIP-0005 | Single-writer transactions and snapshot readers |
| KIP-0006 | Node durable storage, lock ownership, atomic replacement, and reopen validation |
| KIP-0007 | Bounded EQL v1, deterministic query plans, and result roots |
| KIP-0008 | Policy-root-bound query/read authorization and authorization roots |
| KIP-0009 | Signed authority envelopes, external principal binding, and bounded delegation |
| KIP-0010 | Canonical keyring metadata, signed rotations, replay, and persistence |
| KIP-0011 | Keyring-root selection and composed authority session verification |
| KIP-0012 | Verifiable sync summaries, fast-forward plans, and divergence safety |
| KIP-0013 | Verified fast-forward import and atomic durable adoption |
| KIP-0014 | Authenticated sync request/response metadata and binding |
| KIP-0015 | Divergent branch merge planning and conflict roots |
| KIP-0016 | Authorized resolution and atomic two-parent merge application |
| KIP-0017 | Canonical bounded sync wire encoding and decoding |
| KIP-0018 | Bounded EQL equality joins and deterministic ordering |
| KIP-0019 | Host-injected authenticated sync transport adapter |
| KIP-0020 | Durable agent run journals, checkpoints, and resume |
| KIP-0021 | State-root-bound query indexes and append-only query history |
| KIP-0022 | Host-controlled agent execution and tool-policy boundary |

The TypeScript and Rust implementations must consume the same vectors under
`conformance/v5/` and reject malformed input fail-closed.
