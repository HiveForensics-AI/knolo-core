# KAR distribution

Distribution pairs a Knowledge Image with a `KarSidecarV1`. It does not embed the graph in the V5 container, and it does not change `KARRoot`, `SemanticRoot`, or `KnowledgeRoot`.

The manifest format is `kar-distribution-1`:

```json
{
  "format": "kar-distribution-1",
  "image": {
    "file": "knowledge.knolo",
    "stateRoot": "sha256-...",
    "objectRoot": "sha256-...",
    "commitDigest": "sha256-...",
    "knowledgeRoot": "sha256-...",
    "sha256": "sha256-..."
  },
  "kar": {
    "file": "knowledge.kar.json",
    "semanticRoot": "sha256-...",
    "sha256": "sha256-..."
  }
}
```

`sha256` is the raw file digest, `sha256-` plus lowercase hex. `semanticRoot` is the frozen graph root. A manifest that names image A and carries the hash of CEG B fails verification. Schema: [`kar-distribution-v1.schema.json`](../../schemas/experimental/kar/kar-distribution-v1.schema.json).

## Package

```bash
knolo kar package \
  --image knowledge.knolo \
  --graph knowledge.kar.json \
  --out dist/my-knowledge-kar/
```

The directory is the canonical bundle:

```text
my-knowledge-kar/
  knowledge.knolo
  knowledge.kar.json
  kar-manifest.json
```

```bash
knolo kar package verify dist/my-knowledge-kar/
```

Verification checks file hashes, image roots, CEG-to-image binding, the semantic root, the manifest, and `createKarSession`. It does not run a query. A mismatch exits non-zero.

Zip archives are not part of this release. A directory bundle can be archived by the host.

## Runtime loading

The host downloads bytes. `@knolo/core` does not fetch URLs.

```ts
import { loadKarBundle } from '@knolo/core/experimental/kar/authoring';

const loaded = loadKarBundle({
  image,      // Uint8Array
  graph,      // parsed KarSidecarV1
  manifest,   // parsed kar-distribution-1
  graphBytes, // optional raw sidecar bytes, checked against kar.sha256
});
```

On success the caller receives the semantic root and can open a KAR session with the same bytes. On a root mismatch the code is `CEG_MANIFEST_MISMATCH` or `CEG_STALE_IMAGE`.

## Hub

This phase does not publish to Hub. The manifest is shaped so a later `hub.knolo.dev` record can point at an existing bundle without repacking it:

```text
Knowledge Image digest   manifest.image.sha256
CEG digest               manifest.kar.sha256
SemanticRoot             manifest.kar.semanticRoot
manifest digest          sha256 of the canonical manifest bytes
```

Those four values name the artifacts. They are operational metadata. They are not members of `KARRoot`.
