# KAR

Knolo V6 introduces KAR: deterministic evidence-set retrieval over committed knowledge.

KAR retrieves a minimum evidence set under explicit evidence requirements rather than returning another ranked list of similar passages. Evidence remains typed as support, opposition, qualification, temporal/applicability, or authority according to the declared plan. The evaluation is deterministic and replayable over a committed Knowledge Image and Committed Evidence Graph.

KAR does not find all truth, prove a claim, guarantee that source documents are correct, understand every contract, or fully extract semantics by itself.

## Four layers

```text
documents
    ↓
Knowledge Image
    ↓
semantic producer / manual authoring
    ↓
CEG Source
    ↓
deterministic CEG compiler
    ↓
Committed Evidence Graph
    ↓
KAR
    ↓
minimum sufficient typed evidence set
    ↓
Evidence Dossier
    ↓
independent verification
```

1. Knowledge Image. Portable evidence. V5 `stateRoot` is its identity.
2. CEG authoring and compiler. Editable CEG Source becomes a KarSidecarV1.
3. KAR evaluation. Minimum applicable evidence under the declared plan.
4. Evidence Dossier and verification. The packaged result and an independent recomputation.

Normal Knolo retrieval still asks which evidence best matches a query. KAR asks a different question: what is the minimum applicable evidence set required to evaluate this proposition under the declared plan?

## Start here

- [Quickstart](quickstart.md)
- [API](api.md)
- [Plans](plans.md)
- [Committed Evidence Graph](ceg.md)
- [Authoring](authoring.md)
- [Producers](producers.md)
- [Domain Packs](domain-packs.md)
- [Evidence Dossiers](dossiers.md)
- [Verification](verification.md)
- [CLI](cli.md)
- [Browser](browser.md)
- [Security](security.md)
- [Migration to V6](migration-v6.md)
- [Limitations](limitations.md)
- [Hub labels](hub.md)
- [Concepts](concepts.md)
- [Research history](research/README.md)

The worked product examples are [`examples/kar-v6`](../../examples/kar-v6/README.md). Public vectors are [`conformance/kar/v1`](../../conformance/kar/v1/README.md).

```ts
import { createKarSession, evaluateKar, verifyKar, explainKarResult, createKarDossier } from '@knolo/core/kar';
```

`@knolo/core` does not load this module. `@knolo/core/experimental/kar` remains operational for the V6 cycle.

## Semantic production validation

Initial Domain Packs are experimental and review-oriented. Human gold for automatic relation commitment is not complete. KAR itself operates deterministically over the committed graph regardless of how the graph was produced.

Domain Pack maturity for the bundled v4 packs is `review-required`. See [`domains/v6-catalog.json`](../../domains/v6-catalog.json). A later human-validation pass can move a pack to `validated` without a new KAR version.

`SATISFIED` means the evidence requirements were satisfied. It does not mean the claim is proven. `UNSATISFIED_EVIDENCE_REQUIREMENTS` means the evidence requirements were not satisfied. It does not mean the claim is false.
