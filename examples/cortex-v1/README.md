# Cortex V1 example

Hand-authored demo for [Knolo Cortex](../../docs/cortex/README.md): bounded
evidence retrieval with a verifiable trace. Import from `@knolo/core/cortex`.
The root `@knolo/core` helper `createCortex` is a different API (memory
overlay). This example uses `createCortexSession`.

```bash
npm run build --workspace @knolo/core
node examples/cortex-v1/run.mjs
```

## What it shows

| Step | Result |
| --- | --- |
| `find_relevant` on a tiny V4 pack | Selected evidence, empty prose, status `ANSWERED` |
| `evidence_answer` with no host model | `INSUFFICIENT_EVIDENCE` and a `model-required` gap |
| `verifyCortexAnswer` on the real trace | `ok: true` (roots and receipts match) |
| `verifyCortexAnswer` on a tampered trace | `ok: false` (integrity check fails closed) |

## What verification does **not** mean

`verified.ok === true` means the Cortex trace matches the mounted image:
recomputed `traceRoot` / `answerRoot` / `evidenceRoot`, evidence identity, and
replayed retrieval receipts. It does **not** mean the claim is proven or that
the prose is true. Knolo does not call a model. The host owns any model.

Public locked vectors for the same contracts live in
[`conformance/cortex/v1`](../../conformance/cortex/v1/README.md).
