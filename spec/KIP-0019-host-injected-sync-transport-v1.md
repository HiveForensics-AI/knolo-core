# KIP-0019: Host-Injected Sync Transport V1

Status: foundation implementation

KIP-0019 provides a transport-neutral exchange adapter over KIP-0017 wire
bytes. A host supplies one `request(bytes)` function; the runtime encodes and
verifies the signed request, invokes the host transport, decodes the returned
response, verifies the request/response binding and Ed25519 signatures, and
admits the request to replay protection only after success.

Duplicate requests are rejected before a second transport call. Invalid,
expired, oversized, tampered, or keyring-incompatible responses never enter the
replay cache. The adapter returns only verified request/response metadata and
wire bytes; it does not open sockets, define framing, transfer image objects,
or persist replay state.
