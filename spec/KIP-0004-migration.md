# KIP-0004: V4 to V5 migration

Status: implemented foundation contract

Migration first mounts and verifies the complete source artifact. The receipt
`sourceDigest` is the raw source-byte SHA-256 digest (`sha256-<hex>`), which
keeps the identity stable across the TypeScript and Rust readers.

The V5 genesis commit uses actor `knolo-v4-migrator`, no parents, sequence `1`,
and the standard V5 schema, policy, runtime, transaction, object, event, and
view root rules.

Each legacy block produces two objects:

- `source`, containing the original block text and legacy block metadata;
- `chunk`, containing the same bytes plus heading, span, namespace, and source
  identity metadata.

Claims and agent registries are imported as traceable `json-v4` objects when
present. The metadata object records the source digest and source version.

The receipt body is a canonical CBOR map containing `version`, `kind`,
`sourceDigest`, `sourceVersion`, `stateRoot`, and sorted legacy block identity
mappings. Its `receiptDigest` is the `knolo:receipt:v1` digest of that body.

Migration is deterministic and idempotent: the same verified source bytes must
produce identical V5 image bytes and receipt bytes in both runtimes.
