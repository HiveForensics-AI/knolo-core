# KAR Experiment 5 — Vocabulary-independent semantic compilation

Research only. This directory does not change production Knolo, V5 roots, or the Experiment 4 compiler.

The candidate compiler reads documents and commits entity aliases, action aliases, and relations. It has no hand-authored domain lexicon. Query time is a deterministic dual-anchor walk over the frozen artifact.

```bash
KNOLO_DIST=/tmp/knolo-kar-dist node experiments/kar-generalization/src/run.mjs
```

`KAR_LIMIT=1` scores one instance of each split and writes only `/tmp/kar-generalization-summary.json`.
