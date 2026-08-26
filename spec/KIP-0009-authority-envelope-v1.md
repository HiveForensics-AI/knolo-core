# KIP-0009: Authority Envelope V1

Status: foundation implementation

KIP-0009 binds an externally verified principal to a V5 authorization result.
The runtime defines canonical signed payloads and chain validation, while the
application supplies key resolution and the cryptographic verifier for its
chosen algorithm.

## Envelope

```text
{
  "version": 1,
  "issuer": text,
  "subject": text,
  "authorizationRoot": digest,
  "keyringRoot"?: digest,
  "issuedAt": uint,
  "expiresAt": uint,
  "algorithm": text,
  "keyId"?: text,
  "delegations": [delegation...],
  "signature": bytes
}
```

The envelope signature covers canonical CBOR of all envelope fields except the
signature itself. Delegation entries are represented by their
`delegation-payload` digests in that signed payload. `authorityEnvelopeRoot` is
the digest of the signed payload and signature bytes.

## Delegation

Each delegation contains `delegator`, `delegatee`, one `query` or `read`
action, validity bounds, an algorithm, and a signature over its canonical
payload. A delegation may carry a `keyId` for rotation. The chain must begin at the envelope issuer, be continuous, and end
at the envelope subject. Every delegation must cover the authorization action.
The maximum chain depth is eight.

Validity uses the half-open interval `[issuedAt, expiresAt)`. The envelope
subject must equal the authorization principal, and the envelope
`authorizationRoot` must equal the verified policy decision’s root. Missing
keys, unsupported signatures, expired claims, discontinuous chains, or root
mismatches fail closed.

When `keyringRoot` is present, verification must receive the exact persisted
authority keyring root and reject missing or different roots. Envelopes without
this optional field retain the original V5 compatibility behavior.

The runtime does not prescribe Ed25519, WebCrypto, certificates, group
expansion, key rotation, or a network identity provider. Those are adapter
responsibilities. The TypeScript runtime includes a WebCrypto Ed25519 adapter
with validity- and revocation-aware keyring selection; other algorithms remain
host adapters.
