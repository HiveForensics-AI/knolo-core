# V5 host deployment boundary

This document defines the host-owned deployment boundary for V5 image
synchronization. It is the operational companion to the transport-neutral
V5 exchange and the `executeKnowledgeSyncHostDeploymentV5` coordinator.

## Ownership

| Concern                                       | Owner                                     | Core contract                                                      |
| --------------------------------------------- | ----------------------------------------- | ------------------------------------------------------------------ |
| V5 request/response encoding and verification | `@knolo/core`                             | Signed canonical-CBOR exchange and verified image roots            |
| Peer discovery                                | Host adapter                              | Opaque `peerId` values returned through `discover()`               |
| Endpoint routing and sockets                  | Host adapter                              | `requestImage(peer, requestBytes, checkpoint)`                     |
| Credentials and TLS/session state             | Host adapter                              | Never passed into the core coordinator                             |
| Transfer retry policy                         | Core coordinator, bounded by host options | `maxAttempts`, terminal expiry/replay handling                     |
| Checkpoint persistence                        | Host adapter/store                        | Optional `load()` and `save()` callbacks keyed by request and peer |
| Logs, metrics, and alerts                     | Host monitoring sink                      | Typed deployment and transfer events                               |
| Image mutation or adoption                    | Explicit V5 store operation               | Not performed implicitly by deployment                             |

The core coordinator sees only an opaque peer ID and byte callbacks. A
production host can map that ID to a URL, socket, credential, proxy, or cloud
transport without adding any of those dependencies to `@knolo/core`.

## Deployment sequence

1. The host creates a signed V5 sync request and a replay cache.
2. The discovery adapter returns candidate peer IDs. If there is more than one,
   the host supplies `peerId` explicitly; the coordinator never guesses.
3. The coordinator loads the host-owned checkpoint, then calls the transport
   adapter with the signed request bytes and checkpoint offset.
4. The existing V5 exchange verifies the request, response, expiry, signatures,
   response binding, image bytes, and image state root before replay admission.
5. A bounded transfer interruption may return a
   `KnowledgeSyncTransferErrorV1` checkpoint. The coordinator saves it and
   retries from that offset.
6. On success, the coordinator saves a complete checkpoint and returns the
   verified image, response, peer, attempt count, and checkpoint. Applying the
   image to a durable store remains a separate explicit host operation.

`InMemoryKnowledgeSyncHostAdapterV5` is provided for deterministic local and
fake-host tests. It intentionally does not model sockets, credentials,
endpoint discovery, or durable checkpoint storage.

## Failure behavior

| Failure                                       | Retry behavior                         | Replay state                                      |
| --------------------------------------------- | -------------------------------------- | ------------------------------------------------- |
| Discovery failure or ambiguous peer selection | Terminal; no transfer is attempted     | Unchanged                                         |
| Request/response expiry                       | Terminal; emits `deployment.expired`   | Unchanged                                         |
| Request replay                                | Terminal; emits `deployment.replayed`  | Existing replay entry remains authoritative       |
| Transfer error with a valid checkpoint        | Retry until `maxAttempts`              | Unchanged until a full verified exchange succeeds |
| Repeated transfer failure                     | Terminal; emits `deployment.failed`    | Unchanged                                         |
| Verified exchange and image                   | No retry; emits `deployment.succeeded` | Request admitted after verification               |

Monitoring events contain request IDs, peer IDs, attempt counts, offsets, byte
counts, and safe error messages. They do not contain credentials, endpoint
secrets, image contents, or private key material.
