# @knolo/exchange

Host transport for a KIP-0028 offer. `@knolo/core` verifies the signed offer
and the V5 image. This package opens TLS, checks receive policy, and writes
the verified bytes into the content-addressed cache.

Pull and import do not adopt the image into a store, write `knolo.lock.json`,
or call Knolo Hub.

```bash
knolo exchange serve --config exchange.json
knolo exchange offer ./knowledge.knolo --to agent-b --config exchange.json
knolo exchange pull <offer-id> --from agent-a --config exchange.json
knolo exchange export ./knowledge.knolo --to agent-b --out ./handoff --config exchange.json
knolo exchange import ./handoff --config exchange.json
knolo exchange adopt <receipt-id> --store <file> --home <dir> --config exchange.json
knolo exchange inspect <receipt-id> --home <dir> [--config exchange.json]
```

`serve` binds the address in `listen` and writes `endpoint.json` in the store
directory. `offer` copies the image into that store and registers the signed
offer on the local server. `pull` downloads from the peer URL, checks the
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

## Private relay

A future relay is another host. It stores the same offer CBOR and blob and
speaks `GET /v1/offers/:id`, `POST /v1/offers/:id/decision`, and
`GET /v1/blobs/:sha256`. Knolo Hub is not that relay. This package does not
run a relay process.
