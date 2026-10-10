# Experimental KAR CLI

```bash
knolo kar evaluate
knolo kar verify
knolo kar explain
knolo kar inspect
```

`knolo kar --help` prints the same contract. The command is experimental and uses `@knolo/core/experimental/kar`. It does not change `knolo query`.

## Evaluate

```bash
knolo kar evaluate \
  --image knowledge.knolo \
  --graph knowledge.kar.json \
  --plan plan.json \
  --query "Can this enterprise customer cancel?"
```

Human output shows the status, the five frontiers, the selected evidence, the KAR root, the V5 state root, and the KAR knowledge root. `--json` prints the full evaluation, including `certificate`.

## Verify

```bash
knolo kar verify \
  --image knowledge.knolo \
  --graph knowledge.kar.json \
  --plan plan.json \
  --query "Can this enterprise customer cancel?" \
  --result result.json
```

A matching certificate prints `VERIFIED` and exits 0. A mismatch prints a stable code and a reason, then exits non-zero. `VERIFIED` means the certificate matches these inputs. It does not mean the proposition was satisfied. The certificate status can be `UNSATISFIED_EVIDENCE_REQUIREMENTS` and still verify.

## Explain

```bash
knolo kar explain --result result.json
```

That form uses only the saved result. It does not look up evidence that is not already in the file.

To recompute applicability and necessity from the graph, pass the image, sidecar, plan, and query together:

```bash
knolo kar explain \
  --result result.json \
  --image knowledge.knolo \
  --graph knowledge.kar.json \
  --plan plan.json \
  --query "Can this enterprise customer cancel?"
```

Passing only some of those inputs is an error.

## Inspect

```bash
knolo kar inspect \
  --image knowledge.knolo \
  --graph knowledge.kar.json \
  --plan plan.json
```

Inspection prints the V5 state root, the KAR knowledge root, the CEG semantic root, node and relation counts, relation symbols, and, when a plan is present, the advisory cover risk and resource bounds. It does not evaluate the proposition. Omit `--plan` when you only want graph metadata. Cover risk is then reported as not supplied.

## Graph authoring

`knolo kar graph` compiles CEG Source. It does not change `evaluate`. The command list and the source contract are in [Authoring](authoring.md), [CEG Source](ceg-source.md), and [Compilation](compilation.md).

```bash
knolo kar graph build --image knowledge.knolo --source knowledge.ceg.yaml --out knowledge.kar.json
knolo kar graph lint knowledge.ceg.yaml
knolo kar graph review knowledge.ceg.yaml
knolo kar graph validate --image knowledge.knolo --graph knowledge.kar.json
knolo kar graph inspect knowledge.kar.json
knolo kar graph diff old.kar.json new.kar.json
knolo kar graph check --image knowledge.knolo --graph knowledge.kar.json
knolo kar package --image knowledge.knolo --graph knowledge.kar.json --out dist/my-knowledge-kar/
knolo kar package verify dist/my-knowledge-kar/
```

`knolo kar graph inspect` reads a sidecar without an image. `knolo kar inspect` still opens a session and expects `--image` and `--graph`.

## Producers and domain packs

`knolo kar produce` writes CEG Source proposals. `knolo kar domain` validates a Domain Pack. Neither command evaluates KAR, and neither writes a sidecar. The contracts are [Producers](producers.md) and [Domain Packs](domain-packs.md).

```bash
knolo kar produce rules --image knowledge.knolo --domain domains/contracts --out proposals.json
knolo kar produce rules --image knowledge.knolo --domain domains/contracts --out generated.ceg.yaml --auto
knolo kar produce review proposals.json
knolo kar produce apply --proposals proposals.json --decisions decisions.json --out generated.ceg.yaml
knolo kar produce ontology --input ontology.json --mapping mapping.json --out proposals.json
knolo kar produce model --input model.json --out proposals.json --image knowledge.knolo --domain domains/contracts
knolo kar domain validate domains/contracts
knolo kar domain inspect domains/contracts
knolo kar domain test domains/contracts
```

`--auto` writes the already-accepted deterministic fragment as CEG Source and a sibling `*.production.json`. It does not accept model output. An existing `--out` file, and an existing production sibling, are left unchanged. Compile the source with `knolo kar graph build`.

## Example

[`examples/kar/run.mjs`](../../examples/kar/run.mjs) writes a two-chunk image, a hand-authored sidecar, a plan, and a result. The CLI tests run against those files.
