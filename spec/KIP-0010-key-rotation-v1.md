# KIP-0010: Authority Key Rotation V1

Status: foundation implementation

KIP-0010 defines an append-only, verifiable authority keyring document. It
keeps key metadata outside the knowledge image while committing its active
keys and rotation history to a deterministic `authority-keyring` root.

## Key records

Each key record contains `version`, `principal`, `keyId`, `algorithm`,
`publicKey`, and optional `notBefore`, `notAfter`, and `revokedAt` values. Key
IDs are unique per principal. Validity uses half-open intervals and a key is
usable only when it is not expired or revoked.

## Rotation records

```text
{
  "version": 1,
  "kind": "key-rotation",
  "issuer": text,
  "issuerKeyId": text,
  "principal": text,
  "previousKeyId"?: text,
  "keyId": text,
  "algorithm": text,
  "publicKey": bytes,
  "notBefore": uint,
  "notAfter"?: uint,
  "revokedAt"?: uint,
  "issuedAt": uint,
  "expiresAt": uint,
  "signature": bytes
}
```

The issuer signs the canonical CBOR payload containing every field except
`signature`. When `previousKeyId` is present, replay verifies that the
predecessor belongs to the same principal and automatically records its
revocation at the new key's `notBefore` time. A rotation cannot be replayed
twice and cannot reuse an existing principal/key ID.

`keyRotationRoot` is the domain-separated digest of the canonical payload and
signature. `authorityKeyringRoot` commits to the sorted active key payloads,
the ordered rotation roots, the sequence, and the keyring version.

The TypeScript implementation provides canonical CBOR serialization,
fail-closed replay, an Ed25519/WebCrypto signer/verifier, and an atomic Node
keyring store. Authority envelopes can optionally carry this keyring root to
bind a decision to the exact persisted rotation state. Other algorithms and
external key custody remain host adapters.
