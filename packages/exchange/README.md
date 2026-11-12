# @knolo/exchange

Host transport for a KIP-0028 offer. `@knolo/core` verifies the signed offer
and the V5 image. This package opens TLS, checks receive policy, and writes
the verified bytes into the content-addressed cache.

It does not adopt the image into a store, write `knolo.lock.json`, or call
Knolo Hub.

```bash
knolo exchange serve --config exchange.json
knolo exchange offer ./knowledge.knolo --to agent-b --config exchange.json
knolo exchange pull <offer-id> --from agent-a --config exchange.json
knolo exchange inspect <receipt-id> --home <dir> [--config exchange.json]
```

`serve` binds the address in `listen` and writes `endpoint.json` in the store
directory. `offer` copies the image into that store and registers the signed
offer on the local server. `pull` downloads from the peer URL, checks the
SHA-256 and state root, then writes `~/.knolo/cache/sha256/<sha256>.knolo`
and a receipt under `~/.knolo/exchange/receipts/`.

Receive policy is `exchange.json`. An offer outside that policy is refused
before the image bytes are kept. `adopt` stays `deny` in this version.
