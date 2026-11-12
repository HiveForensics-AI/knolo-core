# Exchange capsule conformance

KIP-0029 cases. They build a V5 image in process and check the capsule
proof. A capsule does not mount a store. These cases do not replace the
fixtures in `conformance/v5/`.

```bash
node conformance/capsule/v1/run.mjs
```

Build `@knolo/core` first.
