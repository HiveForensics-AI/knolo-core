# KAR Experiment 3 — blind relationship activation

Measures whether deterministic anchors over the claim graph Knolo already stores can raise opposition and qualifier candidate recall without the answer key.

The activator sees the original query and `pack.claimGraph`. It does not see relation labels, fact ids, `counterQuery`, or `qualifierQuery`, and it does not use a cue dictionary.

```bash
npx tsc -p packages/core/tsconfig.json --outDir /tmp/knolo-kar-dist --declaration false
KNOLO_DIST=/tmp/knolo-kar-dist node experiments/kar-activation/src/run.mjs
```

`KAR_LIMIT=1` writes only `/tmp/kar-activation-report.md`. The full run writes:

- `experiments/kar-activation/results/results.json`
- `experiments/kar-activation/results/summary.json`
- `experiments/kar-activation/RELATIONSHIP_ACTIVATION_REPORT.md`

The adversarial corpus, seed `20261009`, and lexical ranker are the Experiment 1 fixtures and mirror. Scenario N is padded to 500 documents inside this run. The gate is opposition recall at depth 50 of at least 90%, qualifier recall at least 85%, and scenario D opposition recall at least 50%.
