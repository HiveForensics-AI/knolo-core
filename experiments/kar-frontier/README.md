# KAR Experiment 2 — blind frontier discovery

Measures whether a deterministic generator can raise opposition and qualifier candidate recall without the Experiment 1 answer key.

The generator sees the original query and raw passage text. It does not see relation labels, fact ids, `counterQuery`, or `qualifierQuery`.

```bash
npx tsc -p packages/core/tsconfig.json --outDir /tmp/knolo-kar-dist --declaration false
KNOLO_DIST=/tmp/knolo-kar-dist node experiments/kar-frontier/src/run.mjs
```

`KAR_LIMIT=1` writes only `/tmp/kar-frontier-report.md`. The full run writes:

- `experiments/kar-frontier/results/results.json`
- `experiments/kar-frontier/results/summary.json`
- `experiments/kar-frontier/FRONTIER_DISCOVERY_REPORT.md`

The corpus, seed `20261009`, and lexical ranker are the Experiment 1 fixtures and mirror. The gate is opposition recall at depth 50 of at least 90%, qualifier recall at least 85%, and low negative-control damage.
