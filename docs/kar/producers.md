# Semantic CEG producers

KAR retrieval is frozen. The CEG compiler is the deterministic authoring step. A producer decides how semantic proposals are created. A Domain Pack configures reusable domain semantics. See [Domain Packs](domain-packs.md), [Rule producer](rule-producer.md), and [Model producer](model-producer.md).

```text
documents / ontology / model
        |
        v
   CEG producers
        |
        v
 CEG Source fragments + observations + proposals
        |
        v
 review / accept
        |
        v
   ceg-source-1
        |
        v
 compileCegSource()
        |
        v
 KarSidecarV1
        |
        v
 frozen KAR
```

A producer proposes authoring semantics. `compileCegSource()` remains the only writer of committed CEG bytes. Producer output is not a committed graph.

The existing producer interface is unchanged:

```ts
interface CegProducer {
  id: string;
  version: string;
  produce(input: CegProducerInput): Promise<CegSourceV1 | CegSourceFragment>;
}
```

`CegProducerInput` may carry `image`, `notes`, and `domainPack`. `produceCegSource` still canonicalizes a full `ceg-source-1` result, or merges a fragment.

## Run artifact

A run is format `ceg-producer-run-1`. Schema: [`producer-run-v1.schema.json`](../../schemas/experimental/kar/producer-run-v1.schema.json).

```ts
type CegProducerRun = {
  format: 'ceg-producer-run-1';
  producer: { id: string; version: string };
  fragment: CegSourceV1;
  diagnostics: CegDiagnostic[];
  observations: CegObservation[];
  proposals: CegProposal[];
  aliases?: CegAliasProposal[];
  provenance: CegProducerProvenance;
};
```

`fragment` contains only semantics that are already `ACCEPTED`. Model runs use an empty fragment, so model text never enters source by itself.

Provenance records producer id and version, Domain Pack id, version, and `DomainPackRoot`, the image roots, `configRoot`, and `inputRoot`. Those fields live in the producer artifact. They are not part of `SemanticRoot`.

Proposal states are `PROPOSED`, `ACCEPTED`, `REJECTED`, and `NEEDS_REVIEW`. When review is required, only `ACCEPTED` semantics enter the finalized source. Confidence stays on the proposal. It is not `EvidenceBinding.authority`.

Alias proposals stay on the run. `ceg-source-1` has no alias field, and KAR anchors remain the query-time grounding hatch.

## Producers

| Producer | Id | Version | Role |
| --- | --- | --- | --- |
| Rules | `knolo-ceg-rule-producer` | `ceg-rules-1` | Offline deterministic rules |
| Ontology | `knolo-ceg-ontology-producer` | `ceg-ontology-1` | Explicit nodes, edges, and evidence |
| Model | `knolo-ceg-model-producer` | `ceg-model-proposals-1` | Experimental proposals, always `PROPOSED` |

`createRuleCegProducer({ domainPack })` and `createOntologyCegProducer({ ontology, mapping })` implement `CegProducer`. Their `produce` methods return a fragment or throw diagnostic codes. The run helpers `runRuleProducer` and `runOntologyProducer` return the full artifact.

## Ontology producer

`runOntologyProducer({ ontology, mapping, image, auto })` accepts mapping format `ceg-ontology-map-1` or the existing `ceg-import-map-1`. The ontology format is rewritten onto the import map and then `importJsonGraph` runs. Core does not embed a vendor graph library.

Mapping fields are the Phase 8 fields: `concepts` (`path`, `name`, `label`), `relations` (`path`, `from`, `type`, `to`), `evidence` (`path`, `alias`, `objectId` or `source`), and `bindings` (`path`, `concept`, `evidence`, `requirements`, and optional authority, dates, and provenance).

Evidence selectors stay the Phase 8 selectors: `objectId`, `source`, `namespace`, `locator`, and `meta`. Zero matches are `CEG_EVIDENCE_NOT_FOUND`. More than one match is `CEG_EVIDENCE_AMBIGUOUS`. The producer does not keep the first match.

`auto: true` places the imported source in the fragment and marks proposals `ACCEPTED`. Otherwise the fragment is empty and proposals are `NEEDS_REVIEW`.

## Review

```bash
knolo kar produce rules --image knowledge.knolo --domain domains/contracts --out proposals.json
knolo kar produce review proposals.json
knolo kar produce apply --proposals proposals.json --decisions decisions.json --out generated.ceg.yaml
```

`renderProducerReview` prints each proposal with its relation, evidence excerpt, producer, and rule id. `explainCegProposal(run, id)` answers what was proposed, which producer and Domain Pack, which rule, which evidence and span, and which review state. A rule explanation does not call a model.

Decisions are format `ceg-decisions-1`. Schema: [`producer-decisions-v1.schema.json`](../../schemas/experimental/kar/producer-decisions-v1.schema.json). An empty decision list keeps proposals that are already `ACCEPTED` and drops `PROPOSED`, `NEEDS_REVIEW`, and `REJECTED`. An explicit decision overrides that default. Unknown ids and duplicate ids are errors.

`mergeProducerFragments` sorts fragments by their canonical text, deduplicates identical concepts, relations, and bindings, and keeps the UTF-16-least label when labels diverge (`CEG_PRODUCER_CONCEPT_DIVERGENCE`). A different selector for the same alias is `CEG_DUPLICATE_EVIDENCE`. Support and opposition on the same ordered endpoints are both kept. The rule producer adds `CEG_PRODUCER_RELATION_CONFLICT` as a warning. The merge does not delete either side.

An existing `--out` file is left in place. `produce rules --auto` writes the already-accepted fragment as CEG Source and a sibling `*.production.json`. It does not change proposal states. Model output cannot be auto-accepted.

## Commands

```bash
knolo kar produce rules --image knowledge.knolo --domain domains/contracts --out proposals.json
knolo kar produce rules --image knowledge.knolo --domain domains/contracts --out generated.ceg.yaml --auto
knolo kar produce ontology --input ontology.json --mapping mapping.json --out proposals.json
knolo kar produce model --input model.json --out proposals.json --image knowledge.knolo --domain domains/contracts
knolo kar produce review proposals.json
knolo kar produce apply --proposals proposals.json --out generated.ceg.yaml
```

Then the Phase 8 compile:

```bash
knolo kar graph build --image knowledge.knolo --source generated.ceg.yaml --out knowledge.kar.json
```

The worked copies are [`examples/kar-producers`](../../examples/kar-producers/README.md).
