# Importing into CEG Source

Importers write CEG Source. They do not write a sidecar and they do not decide KAR frontiers. Compile the source with the Knowledge Image after review.

## ClaimGraph

```bash
knolo kar graph import claim-graph \
  --image knowledge.knolo \
  --out imported.ceg.yaml
```

The command reads the single object whose kind is `claims`. Zero claims objects is `CEG_SOURCE_INVALID`. More than one is `CEG_EVIDENCE_AMBIGUOUS`. `--claim claim.json` reads a file instead of the image object.

The importer copies node ids, labels, and edge predicates. An edge predicate `related` stays `related`. It does not invent `contradicts`, `qualifies`, `overrides`, validity, or authority. Claim evidence is a list of block indexes, not Knowledge Image object ids. Without `--block-map`, those indexes become the warning `CEG_CLAIM_EVIDENCE_UNMAPPED` and no bindings are emitted. The info code `CEG_CLAIM_IMPORT_LIMITED` is always present.

This is a bootstrap. A domain expert edits the generated source before compilation. See [`examples/kar-ceg/claim-import`](../../examples/kar-ceg/claim-import/run.mjs).

## JSON graph

```bash
knolo kar graph import json \
  --input ontology.json \
  --mapping mapping.json \
  --out knowledge.ceg.yaml
```

The mapping format is `ceg-import-map-1`. Paths are explicit. There is no schema inference and no wildcard. Paths reject `__proto__`, `prototype`, and `constructor`.

```json
{
  "format": "ceg-import-map-1",
  "concepts": { "path": "nodes", "name": "id", "label": "name" },
  "relations": { "path": "edges", "from": "source", "type": "rel", "to": "target" },
  "evidence": { "path": "documents", "alias": "alias", "source": "path" },
  "bindings": {
    "path": "supports",
    "concept": "node",
    "evidence": "doc",
    "requirements": "rules",
    "authority": "rank",
    "validFrom": "start"
  }
}
```

Evidence mapping uses exactly one of `objectId`, `locator`, or `source`, plus optional `namespace` beside `source`. A missing required field is `CEG_IMPORT_FIELD`.

The external file may already contain relation symbols and authorities. The mapping copies them. It does not discover them. See [`examples/kar-ceg/json-import`](../../examples/kar-ceg/json-import/run.mjs).

## Producers

`CegProducer.produce` returns a `CegSourceV1` or a fragment. `produceCegSource` canonicalizes a full source, or merges fragments. `mergeCegSources` fails on duplicate concept or evidence names. The compiler remains the step that resolves evidence and emits the sidecar.

A later producer can be a rules parser, an ontology importer, an Evidence Gate importer, or an optional model-assisted drafter. None of those are required to compile a source by hand.
