# KAR theory experiment

Isolated falsification harness for the Knolo Adversarial Retrieval hypothesis. It does not change `@knolo/core`, pack formats, or retrieval defaults.

## Reproduce

From the repository root, with Node 22:

```bash
npx tsc -p packages/core/tsconfig.json --outDir /tmp/knolo-kar-dist --declaration false
KNOLO_DIST=/tmp/knolo-kar-dist node experiments/kar-theory/src/run.mjs
```

The compile writes outside the repo. The runner compiles there itself when `KNOLO_DIST` is unset and `/tmp/knolo-kar-dist/query.js` is missing.

A one-variation probe does not write repository artifacts:

```bash
KNOLO_DIST=/tmp/knolo-kar-dist KAR_LIMIT=1 node experiments/kar-theory/src/run.mjs
```

That probe writes `/tmp/kar-probe-summary.json` and `/tmp/kar-probe-report.md`. The full run (`KAR_LIMIT` unset, 20 variations per scenario, 220 instances) writes:

- `experiments/kar-theory/fixtures/instances.json`
- `experiments/kar-theory/fixtures/seed.json`
- `experiments/kar-theory/results/results.json`
- `experiments/kar-theory/results/summary.json`
- `experiments/kar-theory/KAR_THEORY_REPORT.md`

## Fixed inputs

- Seed: `20261009` (`kar-theory-fixtures-1`)
- Primary budget: K = 5
- Primary candidate depth: 50
- Floors: tau = 1, gamma = 1, qualifier floor = 1
- Bootstrap: 1000 resamples, same seed
- Selectors: `KAR-ORACLE-exp1`, `KAR-GREEDY-exp1`

Relation labels are fixture fields. The run does not call a language model and does not add a vector index.

The full-run label is the study result. A probe label is not. Eleven instances make the bootstrap interval too wide to decide the theory.
