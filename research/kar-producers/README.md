# KAR producer quality

This directory records the Phase 9 producer benchmark. It is not a KAR algorithm experiment. Retrieval semantics stay `kar-1-research-1`. Compilation stays `ceg-source-1`.

The benchmark generator declares the reference concepts, relations, and bindings. It then runs a producer and compares that output. Scores are reported per producer:

- `contracts-rules-v1`
- `policy-rules-v1`
- `operations-rules-v1`
- `generic-rules-v1`
- `ontology-producer`
- `model-producer` when a live model is measured

Run it from a built core tree:

```bash
cd packages/core && npm run build && node scripts/bench-producers.mjs
```

The script writes [`docs/kar/producer-benchmarks.json`](../../docs/kar/producer-benchmarks.json).

KAR utility compares the frozen evaluation of the reference CEG with the frozen evaluation of the produced CEG. Equal `SemanticRoot` values are not required.
