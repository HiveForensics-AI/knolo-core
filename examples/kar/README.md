# Experimental KAR example

This example builds a two-chunk V5 Knowledge Image and a hand-authored Committed Evidence Graph. It then asks KAR for the minimum evidence set that supplies both a cancellation allowance and an enterprise cancellation bar.

```bash
node examples/kar/run.mjs
```

The script writes `knowledge.knolo`, `knowledge.kar.json`, `plan.json`, and `result.json` in this directory. The same files drive the CLI:

```bash
knolo kar evaluate \
  --image examples/kar/knowledge.knolo \
  --graph examples/kar/knowledge.kar.json \
  --plan examples/kar/plan.json \
  --query "Can this enterprise customer cancel?"
```

`stateRoot` on the image and `knowledgeRoot` on the sidecar are different digests. KAR does not compile the graph, and it does not decide whether the customer can in fact cancel.
