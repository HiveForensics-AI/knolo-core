# Exchange offer conformance

KIP-0028 cases. They build a V5 image in process, sign with Ed25519, and
check fail-closed results. They do not replace the fixtures in
`conformance/v5/`.

```bash
node conformance/exchange/v1/run.mjs
```

`packages/core/test/knowledge-exchange-v1.test.mjs` runs the same function.
Build `@knolo/core` first. A failed digest, mount, state root, recipient,
expiry, or revoked key leaves the replay cache empty.
