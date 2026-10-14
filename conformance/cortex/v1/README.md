# Cortex conformance v1

Three offline vectors for Knolo Cortex on a tiny V4 pack and a tiny V5 image. `find_relevant` returns selected evidence and no prose. `evidence_answer` without a model returns `INSUFFICIENT_EVIDENCE`. A changed answer body fails closed. These checks do not edit the KAR, coverage, or composition locks.

Verification recomputes trace roots, evidence identity, and retrieval receipts. The evidence root commits each source label. Selected evidence must come from a replayed round. Verification does not mean the answer is true.

```bash
node conformance/cortex/v1/run.mjs
```

`CORTEX_V1_ACCEPT=1` rewrites `expected.json`. Normal runs compare the locked roots, statuses, and the tamper code. The vectors do not lock evidence text.
