# KIP-0023: Verified image transfer and durable sync replay protection v1

Status: foundation implementation

This contract extends the authenticated, transport-neutral sync exchange with
complete Knowledge Image transfer and durable replay state. The host still
owns sockets, framing, peer discovery, and deployment.

## Verified image transfer

`exchangeKnowledgeSyncImageOverTransportV5` sends the canonical signed request
bytes to a host-provided `requestImage` adapter. The adapter returns signed
response bytes and complete image bytes. The runtime:

1. verifies the request before transport;
2. verifies the signed response and request binding;
3. mounts and fully verifies the returned Knowledge Image;
4. checks the image state root against the response summary;
5. checks advertised object and event IDs exist in the image; and
6. only then admits the request to replay protection.

Failed or tampered image transfers therefore do not consume replay capacity.
The returned image remains an independently verified snapshot; applying a
fast-forward or merge is an explicit caller operation.

## Durable replay state

`KnowledgeSyncReplayStateV1` records the bounded capacity, sorted request IDs,
expiry times, and a `sync-replay-cache` root. The state is canonical CBOR and
can be restored only when its root, digest formats, sorted entries, expiry
values, and capacity all verify.

`DurableKnowledgeSyncReplayStoreV5` persists that state with an exclusive lock
and temporary-file plus flush/rename replacement. A verified exchange commits
the next replay state before the in-memory cache changes; a persistence failure
therefore leaves the current cache unchanged. Corrupt existing state fails
closed and releases the newly acquired lock.

## Scope boundary

This KIP does not implement sockets, peer discovery, partial segment transfer,
distributed leases, or automatic image adoption. Those remain host or
subsequent runtime responsibilities.
