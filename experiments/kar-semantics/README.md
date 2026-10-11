# KAR Experiment 4 — Committed Evidence Semantics

Research-only harness. It does not change production retrieval, pack formats, or V5 roots.

The semantic compiler in `src/lexicon.mjs`, `src/compile.mjs`, `src/activate.mjs`, `src/canonicalize.mjs`, and `src/s2.mjs` is frozen by `frozen/COMPILER_HASH.txt`. The runner stops if those bytes change. Holdout queries are not visible to the compiler.

```bash
KNOLO_DIST=/tmp/knolo-kar-dist node experiments/kar-semantics/src/run.mjs
```

`KAR_LIMIT=1` writes a probe under `/tmp` only. `KAR_SKIP_S2=1` skips the local model. When Ollama is absent, S2 is recorded as `NOT RUN — MODEL UNAVAILABLE`.
