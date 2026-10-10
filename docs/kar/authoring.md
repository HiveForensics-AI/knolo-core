# CEG authoring

KAR retrieval is frozen at `kar-1-research-1`. Authoring is a separate contract, `ceg-source-1`. It compiles a human source into the Committed Evidence Graph that the frozen engine already accepts.

```text
documents
  -> Knowledge Image
  -> CEG Source
  -> compiler
  -> Committed Evidence Graph (KarSidecarV1)
  -> KAR
  -> minimum sufficient evidence set
  -> replayable KAR certificate
```

The Knowledge Image is the evidence. CEG Source is the editable description of concepts, relations, and bindings. The Committed Evidence Graph is the canonical sidecar bound to that image. KAR does not read the source file.

Developers normally keep both the source and the compiled sidecar in version control. The source is what a person edits. The sidecar is what a KAR session loads.

## Experimental API

Authoring is not exported from `@knolo/core` or from `@knolo/core/experimental/kar`.

```ts
import {
  createCegSource,
  lintCegSource,
  compileCegSource,
  diffCegGraphs,
  validateCegBuild,
} from '@knolo/core/experimental/kar/authoring';
```

An immutable builder ignores call order:

```ts
const source = createCegSource()
  .concept('contract')
  .concept('cancellation')
  .relation('contract', 'permits', 'cancellation')
  .bind('cancellation', {
    evidence: 'clause',
    requirements: ['cancel-rule'],
  })
  .build();
```

`compileCegSource({ source, image })` returns the sidecar, diagnostics, and a build record. The same source, the same image, and the same compiler version produce the same sidecar bytes. The compiler does not call a network, a clock, or a model.

`CegProducer` is the boundary for a future rules parser, ontology importer, or model-assisted drafter. A producer returns CEG Source or a fragment. The deterministic compiler is still the only writer of the committed graph. This release does not ship a model producer and does not depend on an LLM API.

## Commands

```bash
knolo kar graph lint knowledge.ceg.yaml
knolo kar graph review knowledge.ceg.yaml
knolo kar graph build --image knowledge.knolo --source knowledge.ceg.yaml --out knowledge.kar.json
knolo kar graph validate --image knowledge.knolo --graph knowledge.kar.json
knolo kar graph inspect knowledge.kar.json
knolo kar graph diff old.kar.json new.kar.json
knolo kar graph check --image knowledge.knolo --graph knowledge.kar.json
knolo kar graph rebuild --image knowledge-v2.knolo --source knowledge.ceg.yaml --previous knowledge-v1.kar.json --out knowledge-v2.kar.json
```

`rebuild` compiles the new source against the new image and prints a semantic diff against `--previous`. The previous sidecar does not change the new bytes.

Worked copies live in [`examples/kar-ceg`](../../examples/kar-ceg/README.md). Semantic proposals that feed this compiler are described in [Producers](producers.md).

## What stays out of the sidecar

Labels, local aliases, comments, and authoring notes stay in the source. The committed graph keeps the frozen shape: version, knowledge root, producer provenance, nodes, relations, and bindings. The compiler sets `provenance.producer` to `knolo-ceg-compiler/source-v1`. Machine paths and timestamps stay out of that field.

The build identity is a sibling file, `knowledge.kar.build.json`, format `ceg-build-1`.
