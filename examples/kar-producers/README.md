# Semantic producer examples

These examples turn documents into CEG Source with a Domain Pack, then compile that source with the frozen CEG compiler and evaluate it with frozen KAR.

KAR retrieval is not changed. A producer does not write `KarSidecarV1`.

## Contracts

Raw notes in `contracts/docs/` become a Knowledge Image. The contracts Domain Pack proposes support, opposition, and qualification. `showcase-review` is an explicit plan template.

```bash
node examples/kar-producers/contracts/run.mjs
```

The same workflow from the CLI, after the script has written `knowledge.knolo`:

```bash
knolo kar produce rules \
  --image examples/kar-producers/contracts/knowledge.knolo \
  --domain domains/contracts \
  --out /tmp/contract-proposals.json

knolo kar produce review /tmp/contract-proposals.json

knolo kar produce apply \
  --proposals /tmp/contract-proposals.json \
  --out /tmp/generated.ceg.yaml

knolo kar graph build \
  --image examples/kar-producers/contracts/knowledge.knolo \
  --source /tmp/generated.ceg.yaml \
  --out /tmp/knowledge.kar.json
```

## Mixed producers

`mixed/run.mjs` merges a rule fragment, an ontology fragment, and a hand-written fragment. It does not call a model.

```bash
node examples/kar-producers/mixed/run.mjs
```
