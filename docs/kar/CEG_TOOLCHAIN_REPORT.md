# KAR-1 Phase 8 — CEG Toolchain Report

KAR retrieval stays `kar-1-research-1`. This phase adds a separate authoring contract, `ceg-source-1`, that compiles a human source into the frozen `KarSidecarV1` the existing engine already accepts. It does not open `kar-1-research-2`.

Classification:

```text
READY_FOR_CEG_TOOLCHAIN_EXPERIMENTAL_RELEASE
```

A developer can create, review, compile, diff, validate, and distribute a Committed Evidence Graph from CEG Source. The compiled sidecar is the frozen graph KAR already consumes. Hand-writing runtime graph JSON is no longer required.

## Frozen KAR

| Artifact | SHA-256 |
| --- | --- |
| `spec/KAR-1.md` | `a38f3c5e6098b88d13bd3595dce5c368bb46ace6159337858c18726b58504d66` |
| `research/kar-1/fixtures/expected.json` | `154215068cfc8ec50c0d973d2608afa74e237c04171081392d54569c47a3c9cf` |
| `docs/kar/benchmarks.json` | `aa9c624b7fab93c4a0a89221845cd51a008ec3bcfa1cb0b689a7b7af06026db5` |

Those three files are unchanged. Expected vectors were not rewritten. `KARRoot`, `SemanticRoot`, `KnowledgeRoot`, frontiers, closure, anchors, minimum-cover, visit limits, and certificate fields are the Phase 7 objects. The published timing table remains [benchmarks.json](benchmarks.json). A confirmation re-run is quoted under [KAR regressions](#kar-regressions) and is not a replacement table.

`@knolo/core` stays at 5.5.1. The root entry does not export KAR. `@knolo/core/experimental/kar` does not load the authoring module.

## Format

`ceg-source-1` is the parsed object. `knowledge.ceg.yaml` and `knowledge.ceg.json` are encodings of that object. YAML is a bounded block subset (spaces, comments, quoted strings, safe integers, `true` / `false` / `null`). Flow collections, tabs, anchors, and multiline scalars are rejected. JSON accepts the same object. Duplicate keys are `CEG_DUPLICATE_KEY`. Unknown fields are `CEG_UNKNOWN_FIELD`.

```yaml
format: ceg-source-1
concepts:
  enterprise-contract:
    label: Enterprise contract
  cancellation:
    label: Cancellation
evidence:
  cancellation-policy:
    source: policy.md
    namespace: legal
relations:
  - from: enterprise-contract
    type: permits
    to: cancellation
bindings:
  - concept: cancellation
    evidence: cancellation-policy
    requirements:
      - cancellation-rule
    authority: 80
    validFrom: 2026-01-01
requirements:
  - cancellation-rule
```

| Source field | Role |
| --- | --- |
| `concepts.<name>.label` and `.note` | Authoring and review text. Absent from the node id. |
| `evidence.<alias>` | One deterministic selector. See [Evidence resolution](#evidence-resolution). |
| `relations[].type` | Any non-empty token without spaces. The compiler does not assign a frontier. |
| `bindings[]` | Concept, evidence alias, requirements, and optional authority, unauthorized, validity, provenance. |
| `requirements` | Optional catalog. A name that never appears on a binding warns `CEG_UNUSED_REQUIREMENT`. |

The committed graph stays the frozen shape:

```ts
type CommittedEvidenceGraph = {
  version: 1;
  knowledgeRoot: string;
  provenance: { producer: string; note?: string };
  nodes: Node[];
  relations: Relation[];
  bindings: EvidenceBinding[];
};
```

Labels, aliases, comments, and authoring notes stay in the source. The compiler writes `provenance.producer` as `knolo-ceg-compiler/source-v1` and omits `note`. Schema: [ceg-source-v1.schema.json](../../schemas/experimental/kar/ceg-source-v1.schema.json). Narrative: [ceg-source.md](ceg-source.md).

Self-relations and cycles compile. A cycle emits info `CEG_CYCLE_PRESENT` once. Cycle detection is iterative, so a long chain does not overflow the stack.

## Compiler

`compileCegSource({ source, image, plan?, limits?, catalog? })` returns `{ ok, sidecar, bytes, diagnostics, buildInfo, semanticRoot }` or `{ ok: false, diagnostics }`.

```text
same CEG Source + same Knowledge Image + compiler ceg-source-1
  = same KarSidecarV1 bytes
```

Steps:

1. Interpret the source object. Collections are ordered by UTF-16 code units. An error stops the compile.
2. Mount the image with the frozen KAR projection. `knowledgeRoot` is `KnowledgeRoot(projection(K))`. It is not the V5 `stateRoot`. The sidecar stores both.
3. Lint. Any error stops the compile. Warnings and info ride along with a successful sidecar.
4. Resolve every evidence alias to exactly one object id.
5. Derive node, relation, and binding ids.
6. Sort nodes, relations, and bindings by id. Sort each requirement list.
7. Run the graph through frozen `prepareGraph`. Attach `stateRoot`, `objectRoot`, `commitDigest`, and `knowledgeRoot`.

File bytes are `canonicalize(sidecar)` plus one trailing newline. Canonical JSON sorts object keys by UTF-16, preserves array order, and uses the same SHA-256 digest KAR already uses (`sha256-` plus lowercase hex of the canonical UTF-8). There is no timestamp, random id, network call, or model call on this path.

If `prepareGraph` rejects compiler output, the code is `CEG_SOURCE_INVALID`. That is treated as a compiler bug against the frozen parser. This phase did not need a KAR change to pass that check.

`knolo kar graph rebuild` calls the same compiler and then `diffCegGraphs` against `--previous`. The previous sidecar is not an input to id derivation or to the new bytes.

The sibling build record is `knowledge.kar.build.json`, format `ceg-build-1`. For an output path ending in `.json`, the build path replaces that suffix with `.build.json`.

```json
{
  "format": "ceg-build-1",
  "identity": {
    "compiler": { "id": "knolo-ceg-compiler", "version": "ceg-source-1" },
    "configRoot": "sha256-...",
    "sourceRoot": "sha256-...",
    "image": {
      "stateRoot": "sha256-...",
      "objectRoot": "sha256-...",
      "commitDigest": "sha256-...",
      "knowledgeRoot": "sha256-..."
    },
    "semanticRoot": "sha256-...",
    "sidecarDigest": "sha256-..."
  }
}
```

`configRoot` is `H({ format: "ceg-build-config-1", compiler, version, producer, limits })`. `sourceRoot` is `H({ format: "ceg-source-1", source })` of the canonical source, so YAML and JSON of the same object share it. `sidecarDigest` is `H(sidecar object)`. The raw-file digest used by the distribution manifest includes the trailing newline and is a different value. The identity block has no clock and no machine path. Schema: [ceg-build-v1.schema.json](../../schemas/experimental/kar/ceg-build-v1.schema.json). Narrative: [compilation.md](compilation.md).

## ID derivation

Ids are compiler identities. They are not certificate roots. The digest is `digest` from the frozen canonicalizer. Domain strings are frozen with `ceg-source-1`:

```text
node id = H({ domain: "ceg-node-v1", name })

relation id = H({
  domain: "ceg-relation-v1",
  from,        // node id
  relation,    // source type token
  to           // node id
})

binding id = H({
  domain: "ceg-binding-v1",
  nodeId,
  evidenceId,     // resolved Knowledge Image object id
  requirements,   // sorted by UTF-16
  authority,      // integer, or null when omitted
  unauthorized,   // true, or null when omitted or false
  validFrom,      // YYYY-MM-DD, or null
  validUntil,     // YYYY-MM-DD, or null
  provenance      // string, or null
})
```

`name` is the concept's local name. The label is outside the preimage. Array indexes and file order are outside the preimage. Adding an unrelated concept leaves existing node, relation, and binding ids unchanged.

The committed binding omits null optionals, matching frozen canonical form: omitted authority is not zero, and `unauthorized: false` is omitted. Authority `0` is kept. Binding sort distinguishes a missing authority from `0`.

Intentional edits change the affected id and therefore `SemanticRoot`, which remains `H({ knowledgeRoot, graph })`:

| Edit | What changes |
| --- | --- |
| `permits` to `prohibits` | That relation id, and `SemanticRoot` |
| authority `50` to `80` | That binding id, and `SemanticRoot` |
| `validUntil` | That binding id, and `SemanticRoot` |
| evidence object | That binding id, and `SemanticRoot` |
| a requirement string | That binding id, and `SemanticRoot` |

Unrelated ids stay put. The locked authoring fixture (actor `ceg-authoring-test`, sequence 1, `policy.md` / `front` and `contract.md` / `legal`, relation `prohibits`, authority 80, `validFrom` 2026-01-01, requirement `cancel-barred`) compiles to semantic root `sha256-b2803967e4de84ffd8e047dcb1dcca6063974cc8f7ca1da601e96b3db2c67a03`.

## Evidence resolution

Selectors name existing Knowledge Image objects. There is no second evidence identity, no embedding, no fuzzy match, and no model. Zero matches are `CEG_EVIDENCE_NOT_FOUND`. More than one match is `CEG_EVIDENCE_AMBIGUOUS`. The compiler never takes the first object.

Exactly one strategy is allowed:

| Selector | Match |
| --- | --- |
| `objectId` | Object id. Prefer this. |
| `source` | `meta.source` exactly. Optional `namespace` must equal `meta.namespace`. |
| `locator` | `meta.locator` exactly. |
| `meta` | Every listed string equals object metadata. `kind` matches `object.kind`. |

`source` matches only an explicit `meta.source`. Object kind is not used as a fallback source name, so a selector does not become ambiguous merely because every chunk has a kind. Resolution happens before any binding is written. A missing object fails compilation and never reaches KAR as a dangling evidence id.

`openEvidenceCatalog` mounts the image through the frozen V5 opener and projection. A rejected image becomes `CEG_IMAGE_REJECTED` (or the underlying `KarError` code when that code is already specific).

## Diagnostics

Severity is `error`, `warning`, or `info`. An error prevents compilation. A warning does not.

| Code | Severity | Meaning |
| --- | --- | --- |
| `CEG_DUPLICATE_CONCEPT` | error | The same concept name appears twice. |
| `CEG_DUPLICATE_KEY` | error | YAML or JSON repeats a key. |
| `CEG_DUPLICATE_EVIDENCE` | error | The same evidence alias appears twice. |
| `CEG_DUPLICATE_RELATION` | error | The same endpoints and type appear twice. |
| `CEG_DUPLICATE_BINDING` | error | The same concept, evidence, requirements, and applicability appear twice. |
| `CEG_DUPLICATE_REQUIREMENT` | error | One binding lists a requirement twice. |
| `CEG_DANGLING_RELATION` | error | An endpoint does not name a concept. |
| `CEG_UNKNOWN_CONCEPT` | error | A binding names a missing concept. |
| `CEG_UNKNOWN_EVIDENCE` | error | A binding names a missing alias. |
| `CEG_EVIDENCE_NOT_FOUND` | error | The selector matches nothing in the image. |
| `CEG_EVIDENCE_AMBIGUOUS` | error | The selector matches more than one object. |
| `CEG_EVIDENCE_SELECTOR` | error | The selector is not exactly one supported strategy. |
| `CEG_INVALID_RELATION` | error | The type is empty or contains whitespace. |
| `CEG_INVALID_IDENTIFIER` | error | A name, label, or note breaks the length or character bound. |
| `CEG_INVALID_AUTHORITY` | error | Authority is not a safe integer. |
| `CEG_INVALID_VALIDITY` | error | A date is not a real `YYYY-MM-DD`, or `validFrom` is not earlier than `validUntil`. |
| `CEG_UNKNOWN_FIELD` | error | The source contains a field outside the contract. |
| `CEG_LIMIT_EXCEEDED` | error | A configured bound is exceeded. |
| `CEG_SOURCE_INVALID` | error | The object is not `ceg-source-1`, or a later structural check failed. |
| `CEG_PARSE` | error | YAML or JSON could not be read. |
| `CEG_YAML_TAB` | error | A tab appears in YAML. |
| `CEG_YAML_UNSUPPORTED` | error | Flow collections or multiline scalars appear. |
| `CEG_IMAGE_MISMATCH` | error | Sidecar roots or a build record disagree with the mounted image. |
| `CEG_IMAGE_REJECTED` | error | The image itself was rejected. |
| `CEG_STALE_IMAGE` | error | The sidecar was compiled against a different image state. |
| `CEG_MANIFEST_MISMATCH` | error | Bundle bytes, format, or roots disagree with the manifest. |
| `CEG_UNUSED_CONCEPT` | warning | A concept has no relation and no binding. |
| `CEG_UNBOUND_CONCEPT` | warning | A concept is in the graph and has no binding. |
| `CEG_UNUSED_REQUIREMENT` | warning | A catalogued requirement is never bound. |
| `CEG_BINDING_WITHOUT_REQUIREMENTS` | warning | A binding has an empty requirement list. Compilation continues. |
| `CEG_UNREACHABLE_COMPONENT` | warning | Weakly connected components number more than one. |
| `CEG_EVIDENCE_MANY_CONCEPTS` | warning | One evidence alias is bound to more than one concept. |
| `CEG_PLAN_INVALID` | warning | A supplied plan failed frozen plan validation. |
| `CEG_PLAN_UNMAPPED_RELATION` | warning | A relation symbol is absent from the plan map. |
| `CEG_PLAN_EMPTY_OPPOSITION` | warning | The plan maps a symbol to `F_O` and the source has none of those edges. |
| `CEG_PLAN_EMPTY_QUALIFICATION` | warning | The same condition for `F_Q`. |
| `CEG_PLAN_EMPTY_FRONTIER` | warning | The same condition for another frontier. |
| `CEG_PLAN_REQUIREMENT_UNBOUND` | warning | A plan requirement never appears on a binding. |
| `CEG_CYCLE_PRESENT` | info | The relation graph contains a cycle. Cycles compile. |
| `CEG_CLAIM_IMPORT_LIMITED` | info | Claim import copied structure and did not invent KAR relations. |
| `CEG_CLAIM_EVIDENCE_UNMAPPED` | warning | Claim block indexes had no caller-supplied object map, so no bindings were emitted. |

Plan warnings describe the supplied plan. They do not write `prohibits = F_O` into KAR. An unmapped relation stays untraversable at query time, as in the frozen engine.

Default bounds (`CEG_LIMITS`):

| Bound | Default |
| --- | --- |
| `maxSourceBytes` | 32 MiB |
| `maxConcepts` | 200,000 |
| `maxRelations` | 400,000 |
| `maxBindings` | 400,000 |
| `maxRequirementsPerBinding` | 64 |
| `maxIdentifierLength` | 512 |
| `maxRelationNameLength` | 256 |
| `maxLabelLength` | 2,000 |
| `maxDepth` | 32 |
| `maxLines` | 2,000,000 |

A 100,000-node chain sits under these caps and compiled.

## CLI

Graph commands live beside the frozen evaluate commands. `knolo kar evaluate`, `verify`, `explain`, and `inspect` are unchanged. `knolo kar graph` and `knolo kar package` dispatch before a session is loaded.

```bash
knolo kar graph lint knowledge.ceg.yaml [--image knowledge.knolo] [--plan plan.json]
knolo kar graph review knowledge.ceg.yaml [--image knowledge.knolo]
knolo kar graph build --image knowledge.knolo --source knowledge.ceg.yaml --out knowledge.kar.json [--plan plan.json]
knolo kar graph validate --image knowledge.knolo --graph knowledge.kar.json [--build knowledge.kar.build.json]
knolo kar graph inspect knowledge.kar.json [--image knowledge.knolo] [--plan plan.json]
knolo kar graph diff old.kar.json new.kar.json
knolo kar graph check --image knowledge.knolo --graph knowledge.kar.json
knolo kar graph rebuild --image knowledge-v2.knolo --source knowledge.ceg.yaml --previous knowledge-v1.kar.json --out knowledge-v2.kar.json
knolo kar graph import claim-graph --image knowledge.knolo --out imported.ceg.yaml [--claim claim.json] [--block-map map.json]
knolo kar graph import json --input ontology.json --mapping mapping.json --out knowledge.ceg.yaml
knolo kar package --image knowledge.knolo --graph knowledge.kar.json --out dist/my-knowledge-kar/
knolo kar package verify dist/my-knowledge-kar/
```

`build` prints `CEG COMPILED`, the V5 state root, the knowledge root, the semantic root, node, relation, and binding counts, warnings, and the output path. `--json` prints that record. `rebuild` prints `CEG REBUILT` and the semantic diff. Failures print `severity  code  path  message` and exit 1.

`validate` checks the sidecar through the frozen parser, image roots, evidence ids present in the image, and semantic-root recomputation. Optional `--build` checks the `ceg-build-1` identity. Success prints `CEG VALID`. The parser accepts a sidecar whose arrays are not pre-sorted, because frozen KAR sorts during `prepareGraph`. The compiler still writes canonical bytes.

`inspect` needs no image. It prints producer, `knowledgeRoot`, `semanticRoot`, counts, relation symbols, requirements, authority min..max, validity from..until, component count, largest component, and unbound nodes. `--image` adds the freshness check and exits 1 when the sidecar is not bound. `--plan` adds readiness.

`diff` lists nodes, relations, and bindings added or removed, plus authority, validity, and requirement changes for a binding that keeps the same node id and evidence id. An evidence-id change is an add plus a remove. Both semantic roots are printed.

`check` prints `CEG BOUND` when the sidecar matches the image. A different image state is `CEG_STALE_IMAGE` with the message `CEG was compiled against a different image state. Recompile from the CEG Source.` Roots are not rewritten. Loading that pair through KAR still returns `KAR_GRAPH_NOT_BOUND`.

`review` lists each concept, relationship, evidence reference, a short source excerpt, authority, validity, and requirements. `--json` prints the same record. There is no review UI.

Import writes YAML unless the output path ends in `.json`.

## SDK

```ts
import {
  createCegSource,
  addCegConcept,
  addCegRelation,
  addCegBinding,
  lintCegSource,
  compileCegSource,
  diffCegGraphs,
  validateCegBuild,
  inspectCegQuality,
  inspectKarReadiness,
  loadKarBundle,
} from '@knolo/core/experimental/kar/authoring';
```

The builder is immutable. Call order does not change the compiled sidecar:

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

`CegProducer` returns a `CegSourceV1` or a fragment. `produceCegSource` canonicalizes a full source or merges fragments. `mergeCegSources` fails on a duplicate concept or evidence name. The deterministic compiler is still the only writer of the sidecar. This release ships no model producer and adds no LLM client.

`inspectCegQuality` returns descriptive counts: nodes, relations, bindings, relation-type distribution, bindings per node, requirements per binding, unbound nodes, component count, largest component, evidence coverage, evidence reuse, temporal bindings, authority bindings, and `semanticRoot`. It does not return a single quality score.

`inspectKarReadiness(graph, plans)` is static. It reports mapped relations, unmapped relations, frontiers whose mapped symbols have no edges, and requirements that no binding carries. It does not evaluate a query.

Narrative: [authoring.md](authoring.md) and [api.md](api.md).

## Distribution

Distribution pairs a Knowledge Image with a `KarSidecarV1`. The graph stays outside the V5 container. The manifest is operational metadata. It is not a member of `KARRoot`, `SemanticRoot`, or `KnowledgeRoot`.

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

`sha256` is `sha256-` plus the hex digest of the raw file bytes. A manifest that names image A and carries the bytes of CEG B fails `package verify` and `loadKarBundle`.

The canonical bundle is a directory:

```text
my-knowledge-kar/
  knowledge.knolo
  knowledge.kar.json
  kar-manifest.json
```

`package verify` checks file hashes, image roots, CEG-to-image binding, the semantic root, the manifest, and `createKarSession`. It does not run a query. Success prints `KAR BUNDLE VERIFIED`.

```ts
const loaded = loadKarBundle({
  image,       // Uint8Array the host already has
  graph,       // parsed KarSidecarV1
  manifest,
  graphBytes,  // optional raw sidecar bytes, checked against kar.sha256
});
```

`@knolo/core` does not fetch URLs. On a root mismatch the code is `CEG_MANIFEST_MISMATCH` or `CEG_STALE_IMAGE`.

A later `hub.knolo.dev` record can point at an existing bundle by four digests: `manifest.image.sha256`, `manifest.kar.sha256`, `manifest.kar.semanticRoot`, and the sha256 of the canonical manifest bytes. This phase does not publish to Hub. Schema: [kar-distribution-v1.schema.json](../../schemas/experimental/kar/kar-distribution-v1.schema.json). Narrative: [distribution.md](distribution.md).

## Importing

Importers write CEG Source. They do not assign frontiers.

`import claim-graph` reads the single image object of kind `claims`, or `--claim`. Zero claims objects is `CEG_SOURCE_INVALID`. More than one is `CEG_EVIDENCE_AMBIGUOUS`. Node ids and labels become concepts. Edge predicate `p` becomes the relation type, unchanged. Claim evidence is a list of block indexes. Without `--block-map`, those indexes warn `CEG_CLAIM_EVIDENCE_UNMAPPED` and no bindings are emitted. The info code `CEG_CLAIM_IMPORT_LIMITED` is always present. The importer does not invent `contradicts`, `qualifies`, `overrides`, validity, or authority.

`import json` requires an explicit `ceg-import-map-1` mapping. Paths are literal. There is no schema inference. Paths reject `__proto__`, `prototype`, and `constructor`. Evidence mapping uses exactly one of `objectId`, `locator`, or `source`, plus an optional `namespace` beside `source`. A bad field is `CEG_IMPORT_FIELD`.

Narrative: [importing.md](importing.md).

## Examples

Three offline workflows live in [examples/kar-ceg](../../examples/kar-ceg/README.md). `node examples/kar-ceg/run-all.mjs` runs them. Each builds an image, compiles a sidecar, and evaluates `Can this enterprise customer cancel?` to `SATISFIED`.

| Workflow | Path |
| --- | --- |
| Manual authoring | Documents, then `knowledge.ceg.yaml`, then compile, then KAR. Actor `ceg-manual-example`. Semantic root `sha256-3bc0763fe7cc8b941168fe5ee0998d1bad399d7be82779fd444b3fc206ee750c`. |
| ClaimGraph import | A `claims` object imports as `related` with zero bindings. The hand-edited `knowledge.ceg.yaml` adds `permits`, `prohibits`, requirements, authority, and validity, then compiles. Actor `ceg-claim-example`. |
| JSON import | `ontology.json` plus `mapping.json` become CEG Source, then a sidecar. Actor `ceg-json-example`. |

The generated `.knolo`, sidecar, build record, plan, and result are script outputs. The source files are the authored inputs. `examples/kar` remains the Phase 7 hand-authored sidecar (`producer` `hand`) and still evaluates.

## Determinism

`packages/core/test/ceg-authoring.test.mjs` (12 tests) covers YAML/JSON byte identity, builder call-order independence, id stability when an unrelated concept is added, authority / validity / evidence / requirement edits, missing and ambiguous evidence, stale-image refusal, allowed cycles, empty-opposition warning, claim import, JSON import, a swapped-image manifest, and a producer that still ends in `compileCegSource`.

`packages/core/test/ceg-proof.test.mjs`:

| Suite | Count | Seed | Result |
| --- | --- | --- | --- |
| Source reorderings | 10,000 | `0xceb000 + index` | 1 unique `SemanticRoot` per logical fixture |
| Independent reference compiler | 10,000 | `0x51c000 + index` | 0 mismatches on ids, nodes, relations, bindings, and `SemanticRoot` |
| Malformed and edge inputs | 25,000 | `0xf22000 + index` | 0 crashes, 0 hangs over 2,000 ms, 0 silent ambiguous accepts, 0 rejected valid cycles |

The ordering suite shuffles concepts, evidence aliases, relations, bindings, requirements, and top-level section order. Equivalent YAML and JSON compile to the same sidecar bytes and the same `sourceRoot`.

The reference compiler lives in the proof test. It reimplements the three domain preimages and then calls frozen `prepareGraph` and `semanticRootOf`. It does not call `cegNodeId`, `cegRelationId`, or `cegBindingId`. Comparison is canonical sidecar bytes plus semantic root.

Measured durations in the core `npm test` run: ordering 6,542 ms, reference 2,414 ms, fuzz 949 ms. A standalone run of the same file was 4,327 ms, 2,308 ms, and 934 ms.

Fuzz inputs include NUL and tab bytes, random JSON, bad YAML, two objects sharing `source: same.md` (must be `CEG_EVIDENCE_AMBIGUOUS`), a valid cycle (must compile), a stray `{`, a 2,001-character label, flow `relations: []`, a Unicode label plus an unknown field, and a `maxConcepts: 0` limit. The fuzz aborts on the first crash, silent accept, rejected cycle, or slow sample.

`packages/cli/test/kar-graph.test.mjs` runs the three examples, then lint, review, `build --json`, `validate --build`, inspect with and without `--image`, check, rebuild, diff, package, and `package verify` on the manual example. It also requires `CEG_STALE_IMAGE` plus the recompile message on image V2 with CEG V1, and `CEG_EVIDENCE_NOT_FOUND` when the source names a missing document. Existing `knolo kar evaluate` / `verify` / `explain` / `inspect` tests still pass, including the help tokens for the experimental command and `kar-1-research-1`.

## Generated testing

| Generator | Inputs | Requirement | Observed |
| --- | --- | --- | --- |
| Reordering | 10,000 | 1 `SemanticRoot` for one logical source | met |
| Reference compiler | 10,000 small objectId sources | 0 id or root mismatches | 0 |
| Fuzz | 25,000 malformed or edge sources | no crash, hang, or silent ambiguous resolution | 0 failures |
| KAR differential | 50,000, seed `20261011` | 0 mismatches against the research oracle | 0 |
| Exact-cover enumeration | 10,000 graphs, seed `20261010` | integration fixture agrees | passed |
| Tamper | 10,000 mutations, seed `20261012` | 0 accepted mutated certificates | 0 |

Research `npm test` still enumerates its own 200 tiny graphs (16 passing tests). That suite is unchanged.

## Scaling

[ceg-benchmarks.json](ceg-benchmarks.json) (SHA-256 `3e5d1d10726f39be2575b1bf7619e2a7132d645a611d8fa3911e6bb107c6c11b`) records one chain per size: `n` concepts, `n - 1` `permits` relations, `n` bindings to one object. `compileMs` includes lint, resolution, id derivation, and canonical serialization. Heap figures are resident bytes after compile, not a delta. Resolve time stays near zero because every binding names the same object.

| Nodes | Parse ms | Lint ms | Compile ms | Heap after | Semantic root |
| --- | --- | --- | --- | --- | --- |
| 100 | 4.108 | 1.334 | 18.371 | 6,413,280 | `sha256-b39c35386debbb85a51504e485786cf42e61db382bae5b89c36485b869fc0fd8` |
| 1,000 | 11.238 | 3.091 | 76.773 | 8,499,136 | `sha256-43d637a39e772c13fa02ea96b96b2f4b5548ea9c56af14f2414e1813ff5a09df` |
| 10,000 | 80.020 | 38.066 | 735.351 | 28,108,472 | `sha256-b1e3ce19a4bf928ef4e38ddba6e33cb601c5f1f627ff1decdc839cfcd31d804f` |
| 50,000 | 317.865 | 175.778 | 3,813.624 | 117,820,808 | `sha256-07ba5b06b0ca5c79e8e23880b248daaf2a1f5dc79d940b67a34ed70e8fe5a743` |
| 100,000 | 689.684 | 480.773 | 8,146.100 | 229,548,336 | `sha256-fe0d701098ce1e624b66e23c21a2bfa5f41518d8204d27281845fa3402d62857` |

A 50,000-node source, full compile 3,779.182 ms. Changing one relation and compiling again took 3,962.491 ms and changed `SemanticRoot`. That second number is another full compile. Incremental compilation is not implemented. Compile cost grows roughly with graph size through 100,000 nodes (about 8.1 s and 219 MiB resident). That is acceptable for an offline authoring step and is slower than a warm KAR evaluation of a similar chain, which is the intended split.

## KAR regressions

Phase 7 gates were re-run after the authoring code landed. KAR mismatches: 0. KAR regressions: 0.

| Gate | Result |
| --- | --- |
| `@knolo/core` `npm test` | Runtime check passed. 192 tests passed (177 prior plus 15 CEG). `scripts/test.mjs` reported all tests passed. Includes the 50,000 differential (~17.2 s) and 10,000 tamper (~4.7 s). |
| `@knolo/cli` | 51 passed, 1 pre-existing optional Hub skip, 0 failed. Includes graph/package tests and existing `kar evaluate`. |
| `research/kar-1` `npm test` | 16 passed. `expected.json` hash unchanged after the run. |
| `research/kar-1` `npm run test:integration` | 5 passed, including the 10,000-graph enumeration. |
| `research/kar-1/rust` `cargo test --offline` | 2 parity tests passed (`parity.rs`, `integration_parity.rs`). Rust semantic source was not edited. |
| `packages/core-rust` `cargo test --offline` | 24 passed. |
| reflex | 42 passed. |
| evidence-gate | 9 passed. |
| semantic-ollama | 5 passed. |
| langchain | 2 passed. |
| llamaindex | 2 passed. |
| create-knolo-app | 1 passed. |

The KAR bench was re-run alone with `--expose-gc` (131.17 s, exit 0). Every row had `certificateEqual` and `witnessesEqual`. The 50,000-node chain KARRoot remained `sha256-5610b21b0d7584916b9fe1c643ff74cd2373499c215bfadd932d264c27c1ddc3` and its frontier-witness root remained `sha256-034712eae3a07b6825a0c578ab290379b260d80f464050e103267cdd9e98d712`. The 50,000-node local graph KARRoot remained `sha256-a8333fb3a76b264a3953889d5b85c308daecec854e415f2f924445d1df2595c4`. `docs/kar/benchmarks.json` was restored to the Phase 7 bytes above. p50 confirmation, in milliseconds:

| Family | n | Research closure | Core closure | Speedup | Warm eval | Session | Verify |
| --- | --- | --- | --- | --- | --- | --- | --- |
| chain | 100 | 0.194 | 0.110 | 1.77 | 0.354 | 0.558 | 1.036 |
| chain | 1,000 | 3.904 | 0.447 | 8.74 | 0.722 | 3.277 | 4.678 |
| chain | 10,000 | 178.958 | 5.454 | 32.81 | 6.068 | 33.311 | 38.880 |
| chain | 50,000 | 16,722.159 | 45.102 | 370.76 | 43.954 | 204.166 | 240.810 |
| local | 100 | 0.082 | 0.019 | 4.40 | 0.189 | 0.796 | 1.091 |
| local | 1,000 | 0.447 | 0.019 | 23.86 | 0.198 | 7.722 | 9.138 |
| local | 10,000 | 3.864 | 0.022 | 175.63 | 0.193 | 85.494 | 87.997 |
| local | 50,000 | 28.175 | 0.028 | 998.57 | 0.221 | 494.169 | 472.012 |

The chain rows at 100 and 1,000 also kept the published KARRoots `sha256-562ca2695d07ccd3cfffda86228ba4e86f4dabad143c2121780e3363c6d18f88` and `sha256-3467e8382b6da993387999806ad34dfaf26179493fc0fb42f559c0615196f0e6`.

No KAR semantic change was required. Compiled graphs are accepted by `prepareGraph`, `createKarSession`, and `evaluateKar`.

## Known limitations

- Zip bundles are not produced. The canonical package is a directory. A host can archive that directory.
- `rebuild` is a full compile plus a diff. A one-relation edit of a 50,000-node source costs about the same as the first compile. Incremental compilation can be added later only if it preserves byte identity.
- Hub publishing is not implemented. The manifest is shaped so a later Hub record can cite the four digests without repacking.
- `openEvidenceCatalog` is used inside `compileCegSource` and is not re-exported from the public authoring index. In this repository, `knolo kar graph lint --image` and `review --image` load `packages/core/dist/experimental/kar/authoring/catalog.js`. A CLI install that cannot see that dist path cannot open a catalog for lint. `graph build` still resolves evidence, because compilation imports the catalog itself.
- Claim import is a bootstrap. It copies nodes and predicates. Rich relations, authority, and validity are authored afterwards.
- Overlapping validity windows on two different bindings are allowed. Frozen KAR applies each binding on its own interval. A single binding with an inverted or impossible window is `CEG_INVALID_VALIDITY`.
- `examples/kar` is still a hand-authored sidecar. The new compiler examples are `examples/kar-ceg`.
- The CEG is not embedded in the V5 container.

## What comes next

The following phase is semantic CEG producers and domain packs: rules, imported ontologies, optional model-assisted compilation, and reusable templates. KAR retrieval stays frozen. This phase does not start that work.

## Classification

```text
READY_FOR_CEG_TOOLCHAIN_EXPERIMENTAL_RELEASE
```
