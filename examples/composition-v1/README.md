# Composition demo

This directory is a demo. The sentences are not certified law, and a cited KAR result is not a truth verdict.

`run.mjs` builds a host image, a statute image, and a small Committed Evidence Graph. It prints `compositionRoot`, verifies the record, tampers one statute byte, and shows that `evaluateKar` keeps the same `karRoot` when the composition cites it.

```bash
node examples/composition-v1/run.mjs
```

Run it from the repository root after `npm run build --workspace @knolo/core`. The script writes `host.knolo`, `statute.knolo`, `statute.kar.json`, and `members.json` beside itself. No network is required.

The same directory can be composed from the CLI:

```bash
knolo compose create --members examples/composition-v1/members.json --host examples/composition-v1/host.knolo --out /tmp/composition-demo
knolo compose verify /tmp/composition-demo
```

`used` means the evaluation ran. Hub `attested: true` is unrelated.
