# @knolo/exchange

Host transport for a KIP-0028 offer. `@knolo/core` verifies the signed offer
and the V5 image. This package opens TLS, checks receive policy, and writes
the verified bytes into the content-addressed cache. npm `latest` is
`@knolo/exchange@0.1.1`. `@knolo/exchange@0.1.0` has no relay.

Pull and import do not adopt the image into a store, write `knolo.lock.json`,
or call Knolo Hub.

```bash
knolo exchange serve --config exchange.json
knolo exchange offer ./knowledge.knolo --to agent-b --config exchange.json
knolo exchange offer ./knowledge.knolo --to agent-b --via https://127.0.0.1:8443 --config exchange.json
knolo exchange pull <offer-id> --from agent-a --config exchange.json
knolo exchange pull <offer-id> --from https://127.0.0.1:8443 --config exchange.json
knolo exchange relay --config relay.json
knolo exchange export ./knowledge.knolo --to agent-b --out ./handoff --config exchange.json
knolo exchange import ./handoff --config exchange.json
knolo exchange adopt <receipt-id> --store <file> --home <dir> --config exchange.json
knolo exchange inspect <receipt-id> --home <dir> [--config exchange.json]
```

`serve` binds the address in `listen` and writes `endpoint.json` in the store
directory. `offer` copies the image into that store and registers the signed
offer on the local server. `offer --via` uploads the image and the signed
offer to a relay instead, and does not need a local `serve` process. `pull`
downloads from a configured peer or from an `https://` URL, checks the
SHA-256 and state root, then writes `~/.knolo/cache/sha256/<sha256>.knolo`
and a receipt under `~/.knolo/exchange/receipts/`. `export` writes `offer.cbor`
and `<sha256>.knolo` into a directory. `import` checks that directory and
writes the same cache and receipt. Neither command opens a socket.

`adopt` reads the cached image named by a recipient receipt. It opens a new
store, or fast-forwards a store that is directly behind that image. `equal`
leaves the file unchanged. `local-ahead` and `diverged` leave the file
unchanged and fail. The command does not call Knolo Hub.

Receive policy is `exchange.json`. An offer outside that policy is refused
before the image bytes are kept. Shipped configs keep `adopt` at `deny`.
The command runs only when that field is `allow`.

A later pull of a different offer for a digest already in the cache checks
the signature, recipient, expiry, and receive policy, then hashes the cached
file. A match skips the blob route and still writes a receipt for that offer.
A mismatch leaves the cached file in place until a newly downloaded image
verifies.

A capsule is a KIP-0029 proof for objects inside an image that already has
a verified offer. `attachExchangeCapsule` checks that offer, then checks the
capsule against the offer's state root. It does not mount a store or adopt
the image.

## Relay

`knolo exchange relay --config relay.json` stores an offer and its image so
the sender can go offline. The recipient pulls later with `--from` set to
that relay's `https://` URL. The relay answers `GET /v1/offers/:id`,
`POST /v1/offers/:id/decision`, and `GET /v1/blobs/:sha256`. Upload is
`PUT /v1/blobs/:sha256` and then `POST /v1/offers`. Knolo Hub is not this
relay. There is no hosted relay.

`relay.json` sets:

- `listen`: `127.0.0.1`, `::1`, or `0.0.0.0`, with a port.
- `tls.cert` and `tls.key`: the certificate and key the relay presents.
- `store`: directory for the offer CBOR and the image blobs.
- `maxBytes`: largest image the relay accepts.
- `retentionMs`: how long an offer is kept after `expiresAt`. The sweep then
  removes that offer and a blob that no remaining offer names. A blob that
  never received an offer is kept until it is older than this period, and for
  at least 30 seconds, so the offer upload is not swept first.
- `senders`: offer `keyId` values allowed to upload. The list is a name
  filter. It is not a signature check. Anyone who can reach `listen` and
  name an allowed `keyId` can fill the store.

The relay checks that the offer CBOR is well formed, that `keyId` is on that
list, that the offer has not expired, and that the stored blob length and
SHA-256 match the offer. It does not verify the offer or the decision for
the recipient, does not mount an image, does not adopt, and does not rewrite
bytes. A changed blob is served as stored. The recipient still checks the
signature, the recipient, the expiry, the receive policy, the SHA-256, and
the state root, and refuses a blob that does not match. Shipped exchange
configs keep `adopt` at `deny`.
