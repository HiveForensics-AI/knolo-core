# CEG authoring examples

These examples stay offline. Each one starts from authoring input and ends at a frozen `KarSidecarV1` that `kar-1-research-1` evaluates.

```bash
node examples/kar-ceg/run-all.mjs
```

Run one workflow from the repository root:

```bash
node examples/kar-ceg/manual/run.mjs
node examples/kar-ceg/claim-import/run.mjs
node examples/kar-ceg/json-import/run.mjs
```

## Manual authoring

`manual/docs/*.md` become a Knowledge Image. `manual/knowledge.ceg.yaml` is the editable source. The script compiles `knowledge.kar.json` and evaluates the cancellation query.

## ClaimGraph import

`claim-import/claim.json` is stored as a `claims` object in the image. The importer writes `imported.ceg.yaml` with the predicate `related` and no bindings. `knowledge.ceg.yaml` is the developer edit that adds `permits`, `prohibits`, requirements, authority, and validity. The importer does not invent those fields.

## JSON import

`json-import/ontology.json` is an external graph. `mapping.json` is an explicit `ceg-import-map-1` map. The script writes `knowledge.ceg.yaml`, compiles it, and evaluates KAR.

Build `@knolo/core` before running the scripts. The generated image, sidecar, build record, plan, and result are local outputs of those scripts.
