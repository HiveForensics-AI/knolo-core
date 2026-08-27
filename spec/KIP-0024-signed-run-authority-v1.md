# KIP-0024: Signed run authority v1

Status: foundation implementation

This contract authorizes a durable V5 run without coupling Knolo to a model,
agent framework, credential provider, or scheduler. It binds a signed
authority envelope to the exact run and Knowledge Image snapshot that the host
intends to execute.

## Envelope and roots

The envelope contains issuer, subject, run ID, run root, image state root,
validity window, algorithm/key ID, optional keyring root, and signature. The
signature covers the canonical payload of every field except the signature.
The envelope root is:

```text
SHA-256("knolo:run-authority-envelope:v1\0" || canonical_cbor({
  payload: canonical_cbor(envelope_without_signature),
  signature
}))
```

Verification first validates the durable run journal, then requires exact
equality for `runId`, `runRoot`, and `imageStateRoot`. If `keyringRoot` is
present, the supplied persisted keyring must expose that exact root. Validity
uses the half-open interval `[issuedAt, expiresAt)`.

## Verification boundary

The generic verifier accepts host-provided key resolution and signature
verification functions. The Ed25519/WebCrypto adapter resolves the issuer key
from the existing authority keyring and honors its validity and revocation
metadata. Missing keys, invalid signatures, expired envelopes, or any root or
keyring mismatch fail closed.

The envelope authorizes the run identity only. The host remains responsible
for deciding whether the principal may use a model or tool, supplying
credentials, enforcing rate limits, scheduling execution, and recording
external side effects. Delegation chains and distributed leases remain
subsequent extensions.
