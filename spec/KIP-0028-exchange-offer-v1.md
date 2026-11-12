# KIP-0028: Exchange Offer V1

Status: foundation implementation

KIP-0028 defines a signed offer, accept or reject, and receipt for handing one
complete V5 Knowledge Image to one named recipient. It is not a sync request.
KIP-0014 remains the replica-sync message. This contract does not change
`stateRoot`, `objectRoot`, or the sync wire codec.

## Messages

Each message is canonical CBOR. Optional text fields and keyring roots are
`null` on the wire when absent. Domain-separated SHA-256 roots use the same
`digestDomain` construction as the V5 image. Ed25519 signatures cover the
payload without the signature bytes. Verification takes `now` from the host.
Core does not read a clock, a socket, or the filesystem.

An offer (`kind: exchange-offer`) binds:

- `sender` and `recipient` principals
- `artifactKind`, which is `knowledge-image` in this version
- artifact `sha256` as 64 lowercase hex characters, `stateRoot`, and `sizeBytes`
- optional `namespace` label
- `nonce`, `issuedAt`, `expiresAt`
- `algorithm`, optional `keyId`, optional `keyringRoot`

`offerId` is `digestDomain('exchange-offer-id', …)` over the artifact, parties,
namespace, nonce, and validity window. It does not include the signature or
the key id. A copied offer still names one recipient. The recipient's host
must pass that principal as `expectedRecipient`.

A decision (`kind: exchange-decision`) is `accept` or `reject`. It carries
`offerId` and `offerRoot`. `offerRoot` is the digest of the signed offer
payload plus its signature. The recipient signs the decision. A decision whose
parties or offer root do not match the offer fails closed.

A receipt (`kind: exchange-receipt`) records `role` (`sender` or `recipient`),
the offer's artifact identity, the decision, a verification code, and a policy
label. The signer is the principal for that role. `verification: verified`
requires `decision: accept`. A rejection cannot be recorded as verified.

Verification codes are `verified`, `digest-mismatch`, `state-root-mismatch`,
`expired`, `replay`, `unauthorized-recipient`, `revoked-key`, `policy-denied`,
`mount-failed`, `oversized`, and `interrupted`.

## Artifact check and replay

`verifyKnowledgeExchangeArtifactV1` checks, in order, size, SHA-256, V5 mount,
and `stateRoot`. A skill archive or any other non-image fails mount.
`acceptKnowledgeExchangeTransferV1` verifies the offer, then the artifact, and
only then admits `offerId` to `KnowledgeSyncReplayCacheV1`. A failed transfer
does not consume a replay entry. A second admission of the same id fails.

The cache stores an id and an expiry. Exchange ids use that shape. Admission
does not mount the image into a store, fast-forward it, or merge it.

## Key window

The Ed25519 helpers resolve one key by principal and `keyId`. `revokedAt <= now`
fails with a revoked-key error. `notBefore` and `notAfter` outside the open
window fail with a validity-window error. A missing or ambiguous key fails
signature verification. Those helpers do not generate keys.

## Boundary

Sockets, TLS, peer URLs, policy files, and cache paths belong to the host
package. This KIP does not define partial segment transfer, automatic
adoption, or skill activation. Diverged images stay on the KIP-0013 and
KIP-0015 path. Evidence capsules and Merkle inclusion proofs are out of scope.
The object root remains a flat digest of the object-id list.

Conformance cases live in [`conformance/exchange/v1`](../conformance/exchange/v1/README.md).
They do not modify the V5 image fixtures.
