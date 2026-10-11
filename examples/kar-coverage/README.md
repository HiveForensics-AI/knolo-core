# Evidence coverage example

A hand-authored procedure with two questions. One evidence requirement is met. The other is a gap because the committed graph has no permit token.

This is not a completeness claim. `met` means the declared requirements were satisfied. It does not prove the proposition. `gap` means those requirements were not satisfied. It does not mean the proposition is false. Bundled Domain Packs stay `review-required` in [`domains/v6-catalog.json`](../../domains/v6-catalog.json). This example does not accept producer proposals.

```bash
npm run build --workspace @knolo/core
node examples/kar-coverage/run.mjs
```

The script writes `knowledge.knolo`, `knowledge.kar.json`, `met.json`, and `gap.json`. A coverage directory is built with the CLI:

```bash
knolo kar coverage build \
  --image examples/kar-coverage/knowledge.knolo \
  --graph examples/kar-coverage/knowledge.kar.json \
  --plan examples/kar-coverage/met.json \
  --query "What evidence shows the valve is closed?" \
  --plan examples/kar-coverage/gap.json \
  --query "What evidence shows the missing permit?" \
  --out /tmp/kar-coverage
knolo kar coverage verify /tmp/kar-coverage
```

Changing `coverage.md` from "Evidence requirements satisfied" to "Claim proven" makes verify fail.
