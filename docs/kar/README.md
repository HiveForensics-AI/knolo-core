# Experimental KAR

KAR answers a different question from ordinary Knolo retrieval.

A normal Knolo query asks which evidence best matches the query. KAR asks what minimum evidence set satisfies the declared support, opposition, qualification, temporal, and authority requirements.

The semantics are frozen at `kar-1-research-1`. This package path is experimental. It is not exported from the `@knolo/core` root, so existing callers do not load it.

```ts
import {
  createKarSession,
  evaluateKar,
  explainKarResult,
  verifyKar,
} from '@knolo/core/experimental/kar';
```

```bash
knolo kar evaluate \
  --image knowledge.knolo \
  --graph knowledge.kar.json \
  --plan plan.json \
  --query "Can this enterprise customer cancel?"
```

## The three objects

- The Knowledge Image is the evidence. Its `stateRoot` is the mounted V5 identity.
- The Committed Evidence Graph (CEG) is a sidecar of relationships over that evidence. Its `knowledgeRoot` is the frozen research projection of the image, and it is not the V5 `stateRoot`.
- KAR is deterministic evidence-set retrieval over that committed graph.

The CEG stays in a sidecar such as `knowledge.kar.json`. This phase does not put those bytes inside `.knolo`.

## What KAR does not do

KAR does not:

- decide objective truth;
- infer semantic relationships at query time;
- replace BM25;
- replace MMR;
- require embeddings;
- require a vector database;
- claim that absence from its result is global absence of evidence;
- silently approximate exact cover;
- generate the CEG by itself. Authoring and compilation live beside retrieval. See [Authoring](authoring.md).

`SATISFIED` means the selected set meets the plan. It does not mean the proposition is true. `UNSATISFIED_EVIDENCE_REQUIREMENTS` means the plan's requirements were not met inside the closure. It does not mean the proposition is false.

When exact cover exceeds `maxCoverVisits`, the status is `SEARCH_BOUND_EXCEEDED` and the selected set is empty. There is no greedy fallback.

## Read next

- [Concepts](concepts.md)
- [API](api.md)
- [CLI](cli.md)
- [Certificates](certificates.md)
- [Phase 7 report](EXPERIMENTAL_CORE_REPORT.md)
- [Authoring](authoring.md)
- [CEG Source](ceg-source.md)
- [Compilation](compilation.md)
- [Distribution](distribution.md)
- [Importing](importing.md)
- [CEG toolchain report](CEG_TOOLCHAIN_REPORT.md)
- [Producers](producers.md)
- [Domain Packs](domain-packs.md)
- [Rule producer](rule-producer.md)
- [Model producer](model-producer.md)
- [Semantic producers report](SEMANTIC_PRODUCERS_REPORT.md)

The worked example is [`examples/kar`](../../examples/kar/README.md). Schemas live in [`schemas/experimental/kar`](../../schemas/experimental/kar/).
