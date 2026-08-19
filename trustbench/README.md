# Knolo TrustBench

TrustBench is the reproducible Phase 5 quality and conformance harness for the
Knolo v4 TypeScript reference runtime.

Run from the repository root:

```bash
npm run trustbench:generate
npm run trustbench:test
```

`generate` rebuilds the checked-in v1/v3/v4 and corrupted fixtures, then writes
the canonical `conformance/expected/retrieval-v4.0.json` report. `test` checks
that report, verifies every committed pack profile mounts as expected, and
ensures corrupted v4 artifacts fail closed.

The report includes Recall@K, MRR, nDCG, mean hit count, answer/abstention
counts, abstention precision, receipt verification, hit IDs, rounded scores,
decisions, and retrieval-plan hashes. Scores are rounded to six decimals;
identities, decisions, plan hashes, and corruption outcomes are exact.

The TypeScript runtime is the reference profile. A Rust, Python, WASM, or ICP
profile should only be called equivalent after it consumes the same fixtures
and emits the same canonical result fields.
