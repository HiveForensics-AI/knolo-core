# KIP-0014: Authenticated Sync Messages V1

Status: foundation implementation

KIP-0014 defines transport-neutral signed metadata for V5 synchronization.
It does not open sockets, choose a transport, or transfer object bytes.

A sync request contains the sender, a nonce-derived request ID, expiry window,
advertised sync summary, requested object/event IDs, algorithm/key ID, and
optional keyring root. A response contains the signed request root, responder,
its summary, relation, and advertised transfer IDs. Both messages use
canonical CBOR and domain-separated roots.

WebCrypto Ed25519 helpers verify sender identity, message expiry, request-ID
derivation, signed request/response binding, and keyring-root continuity. The
runtime also provides a bounded in-memory replay cache and an exchange helper
that admits a request only after both messages verify. A malformed,
replay-shaped, expired, tampered, or keyring-incompatible message fails closed.
Durable replay-cache persistence and complete image transfer are defined by
KIP-0023. Sockets and transport-level anti-replay policy remain host
responsibilities.
