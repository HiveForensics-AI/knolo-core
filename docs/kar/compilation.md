# CEG compilation

`compileCegSource` is deterministic:

```text
same CEG Source + same Knowledge Image + same compiler version
  = same KarSidecarV1 bytes
```

No timestamp, random id, insertion order, network call, or model call enters the sidecar.

## Steps

1. Parse YAML or JSON into the source object. Duplicate keys are `CEG_DUPLICATE_KEY`.
2. Interpret the object. Unknown fields are `CEG_UNKNOWN_FIELD`. Collections are canonicalized by UTF-16 code-unit order.
3. Open the Knowledge Image and project it with the frozen KAR projection. `knowledgeRoot` is that projection root. It is not the V5 `stateRoot`.
4. Lint. Any error stops the compile. Warnings are returned with a successful sidecar.
5. Resolve every evidence alias to exactly one object id.
6. Derive node, relation, and binding ids.
7. Build the frozen graph, run it through `prepareGraph`, and attach the image roots.

The sidecar is:

```ts
{
  version: 1,
  stateRoot,
  objectRoot,
  commitDigest,
  knowledgeRoot,
  graph: {
    version: 1,
    knowledgeRoot,
    provenance: { producer: 'knolo-ceg-compiler/source-v1' },
    nodes,
    relations,
    bindings,
  },
}
```

File bytes are canonical JSON plus a trailing newline. `provenance.note` is omitted.

If `prepareGraph` rejects the compiler output, compilation fails with `CEG_SOURCE_INVALID`. That is a compiler bug relative to frozen KAR, not a reason to change KAR.

## Identifier derivation

Ids are domain-separated digests of canonical JSON. The digest function is the same pure SHA-256 canonical digest KAR already uses. These domains are compiler identities. They are not certificate roots.

```text
node id = H({ domain: "ceg-node-v1", name })

relation id = H({
  domain: "ceg-relation-v1",
  from: nodeId,
  relation,
  to: nodeId
})

binding id = H({
  domain: "ceg-binding-v1",
  nodeId,
  evidenceId,
  requirements,          // sorted
  authority,             // null when omitted
  unauthorized,          // true or null
  validFrom,             // null when omitted
  validUntil,            // null when omitted
  provenance             // null when omitted
})
```

`name` is the concept's local name. The label is not in the preimage. Adding an unrelated concept does not change existing node, relation, or binding ids. Changing `permits` to `prohibits` changes that relation id. Changing authority, validity, the evidence object, or a requirement changes that binding id. `SemanticRoot` changes when the committed graph changes, because it remains `H({ knowledgeRoot, graph })`.

Array indexes and file order are not identities.

## Build record

`knowledge.kar.build.json` uses format `ceg-build-1`. Its `identity` object holds the compiler id and version, `configRoot`, `sourceRoot`, the four image roots, `semanticRoot`, and `sidecarDigest`. `configRoot` digests the compiler id, version, producer, and limits. `sourceRoot` digests the canonical source, so YAML and JSON of the same object share it. The identity block has no timestamp.

Schema: [`ceg-build-v1.schema.json`](../../schemas/experimental/kar/ceg-build-v1.schema.json).

## Commands

```bash
knolo kar graph build \
  --image knowledge.knolo \
  --source knowledge.ceg.yaml \
  --out knowledge.kar.json
```

Human output prints `CEG COMPILED`, the V5 state root, the knowledge root, the semantic root, node, relation, and binding counts, warnings, and the output path. `--json` prints that record.

```bash
knolo kar graph validate --image knowledge.knolo --graph knowledge.kar.json
knolo kar graph check --image knowledge.knolo --graph knowledge.kar.json
```

Validate and check confirm the sidecar schema, the frozen graph shape, the image roots, evidence ids, and the recomputed semantic root. A sidecar compiled against another image fails with `CEG_STALE_IMAGE` and the message `CEG was compiled against a different image state. Recompile from the CEG Source.` The tools do not rewrite roots. Frozen KAR still reports `KAR_GRAPH_NOT_BOUND` if that sidecar is loaded on the new image.

```bash
knolo kar graph diff old.kar.json new.kar.json
```

The diff lists nodes, relations, and bindings added or removed, plus authority, validity, and requirement changes for a binding that keeps the same node and evidence object. It prints both semantic roots.

```bash
knolo kar graph inspect knowledge.kar.json
```

Inspection does not need the image. It prints the producer, both roots, counts, relation symbols, requirements, authority and validity ranges, component count, and unbound nodes. `--image` adds the binding check.

## Rebuild

`knolo kar graph rebuild` runs a full compile and then a diff. Phase 8 does not skip recompilation when one relation changes. A previous graph must not affect the new bytes. Correctness is the requirement. Incremental compilation can come later without changing `ceg-source-1` output.

## Quality and readiness

`inspectCegQuality` returns counts: nodes, relations, bindings, relation-type distribution, bindings per node, requirements per binding, unbound nodes, component sizes, evidence coverage and reuse, and how many bindings carry a date or an authority. It does not return a single quality score.

`inspectKarReadiness(graph, plans)` is static. It reports relations the plans map, relations they never map, frontiers whose mapped relations are absent, and requirements that no binding carries. An opposition plan with no `prohibits` edges warns `CEG_PLAN_EMPTY_OPPOSITION`. It does not evaluate the query and it does not call a model.
