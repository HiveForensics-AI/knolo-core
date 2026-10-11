# Committed Evidence Graph

The Committed Evidence Graph (CEG) is the graph KAR evaluates. It is a sidecar, `KarSidecarV1`, not a section inside the Knowledge Image.

```text
human / producer
    ↓
CEG Source
    ↓
compileCegSource()
    ↓
KarSidecarV1
    ↓
createKarSession()
```

CEG Source (`ceg-source-1`) is the editable authoring document. The sidecar is the committed runtime graph. Producers must not write sidecar bytes. `compileCegSource()` is the only writer of those bytes.

```ts
import { parseCegSource, compileCegSource, validateCegSource, lintCegSource, diffCegGraphs } from '@knolo/core/kar/authoring';
```

`validateCegSource` accepts YAML or JSON text, or an object. It does not compile. `compileCegSource` binds the source to Knowledge Image bytes and emits the sidecar plus canonical bytes.

Stable compiler error codes include:

| Code | Meaning |
| --- | --- |
| `CEG_EVIDENCE_NOT_FOUND` | A selector does not match the image |
| `CEG_EVIDENCE_AMBIGUOUS` | A selector matches more than one object |
| `CEG_INVALID_RELATION` | A relation is not usable |
| `CEG_INVALID_VALIDITY` | A date or validity field is not usable |
| `CEG_STALE_IMAGE` | The source was compiled against a different image identity |
| `CEG_PARSE` | YAML or JSON could not be read, including a forbidden key |
| `CEG_YAML_UNSUPPORTED` | Flow collections, anchors, or another rejected YAML feature |
| `CEG_UNKNOWN_FIELD` | A Domain Pack or source field is outside the contract |

The exact diagnostic depends on the failing field. Codes are stable. Do not match prose alone.

`SemanticRoot` is `H(KnowledgeRoot, G)`. If the sidecar `knowledgeRoot` does not match the image projection, KAR returns `GRAPH_NOT_BOUND` / `KAR_GRAPH_NOT_BOUND`. `stateRoot` is the V5 identity and is not `knowledgeRoot`.

Authoring detail stays in [Authoring](authoring.md), [CEG Source](ceg-source.md), and [Compilation](compilation.md). Distribution manifests are `kar-distribution-1` and reject unknown fields. See [Distribution](distribution.md).

The published schemas are in [`schemas/experimental/kar`](../../schemas/experimental/kar). The `@knolo/core` build copies them to `dist/schemas/kar`, so the npm package contains the same JSON.
