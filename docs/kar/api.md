# Experimental KAR API

Import the experimental subpath. The root `@knolo/core` entry does not re-export these functions, and loading the root does not load this module.

```ts
import {
  createKarSession,
  evaluateKar,
  explainKarResult,
  verifyKar,
  inspectKarComplexity,
  validateKarSidecar,
  validateKarPlan,
  validateKarResult,
} from '@knolo/core/experimental/kar';
```

The module is marked experimental. Certificate `version` stays `kar-1-research-1`.

Authoring, compilation, diff, and bundle loading are a second experimental entry. Loading `@knolo/core/experimental/kar` does not load it.

```ts
import {
  compileCegSource,
  lintCegSource,
  loadKarBundle,
} from '@knolo/core/experimental/kar/authoring';
```

The contract is [Authoring](authoring.md). `loadKarBundle` validates bytes the host already has. It does not fetch a URL.

Producers, Domain Packs, and review live on the same authoring entry. Loading them does not load a model.

```ts
import {
  createRuleCegProducer,
  runRuleProducer,
  createOntologyCegProducer,
  runOntologyProducer,
  validateModelProposals,
  applyProducerDecisions,
  explainCegProposal,
  mergeProducerFragments,
  renderProducerReview,
  interpretDomainPack,
  instantiatePlanTemplate,
  domainPackRoot,
  testDomainFixtures,
} from '@knolo/core/experimental/kar/authoring';
```

`runRuleProducer` and `runOntologyProducer` return a `ceg-producer-run-1` artifact. `validateModelProposals` checks `ceg-model-proposals-1` and leaves every proposal `PROPOSED`. `compileCegSource` is still the only writer of `KarSidecarV1`. The narrative is [Producers](producers.md). The local model adapter, `proposeCegWithOllama`, is exported from `@knolo/semantic-ollama` and is not imported by core.

## Session

```ts
const session = createKarSession({
  image, // V5 bytes, or a mounted image remounted from its bytes
  graph, // KarSidecarV1
});
```

Session creation mounts the image, validates the sidecar, checks the V5 binding and the projection binding, canonicalizes the graph, and builds indexes once:

- `evidenceById`
- `nodeById`
- `relationsByFrom`
- `bindingsByNode`

Those indexes are execution structures. They are not hashed, and `verifyKar` will not accept them from the caller.

`createKarProjectionSession` is the same runtime over a research `{ version: 1, evidence }` image. Conformance tests and the scaling benchmark use it. Application code that has a V5 image uses `createKarSession`.

## Evaluate

```ts
const result = evaluateKar(session, {
  proposition: 'Can this enterprise customer cancel?',
  plan,
});
```

`result.status` is the frozen decision status. `result.code` is a stable API code such as `KAR_SEARCH_BOUND_EXCEEDED`, or `null` when the status is `SATISFIED` or `UNSATISFIED_EVIDENCE_REQUIREMENTS`.

`result.frontiers` keeps `F_S`, `F_O`, `F_Q`, `F_T`, and `F_A`. `result.selectedEvidence` resolves id, text, source, and metadata from the image. `result.witnesses` are the frozen witness objects. `result.certificate` is the full research result, including every root. There is no `hits` array and no relevance score.

`result.image` exposes both identities:

```ts
image: {
  stateRoot,      // V5 mounted identity, null for a projection session
  knowledgeRoot,  // frozen projection root
  objectRoot,
  commitDigest,
}
```

## Explain

```ts
const explanation = explainKarResult(session, result);
```

The explanation is deterministic. It reports the anchor, supplied grounding, populated frontiers, selected evidence, whether dropping each selected object would fail the floors, the witness path, applicability, requirement coverage, and the abstention or bound reason.

Applicability is filled only when a fresh closure on the session reproduces the certificate witnesses. Otherwise those fields stay unknown. `explainKarCertificate(result)` explains a saved certificate without an image and does not invent text that is not already on the result.

`renderKarEvaluation` and `renderKarExplanation` are the plain-text renderers used by the CLI.

## Verify

```ts
const verification = verifyKar({
  image, // bytes, remounted even if a mounted object is passed
  graph,
  proposition,
  plan,
  result,
});
```

Verification builds a new session from the bytes and recomputes the certificate. A matching certificate returns `{ ok: true, code: 'VERIFIED' }`. A mismatch returns `KAR_RESULT_MISMATCH` with the first differing field. A corrupt image returns `KAR_IMAGE_REJECTED`. A sidecar that does not bind returns `KAR_GRAPH_NOT_BOUND`.

`verifyKarProjection` is the research-image verifier used by the differential and tamper suites.

## Complexity

```ts
const estimate = inspectKarComplexity(session, plan, proposition);
```

The proposition is optional and is used when the anchor mode is `recompute`. The return value includes candidate count, distinct requirement masks, cardinality, `maxCoverVisits`, an estimated combination upper bound, and `risk` of `low`, `moderate`, `high`, or `unknown`. `advisory` is always true. Calling it does not change the next `evaluateKar` result.

## Validators

`validateKarSidecar`, `validateKarPlan`, and `validateKarResult` return `{ ok: true, value }` or `{ ok: false, errors }`. Each error has `code`, `path`, and `message`. Codes include:

- `KAR_SIDECAR_INVALID`
- `KAR_GRAPH_INVALID`
- `KAR_GRAPH_NOT_BOUND`
- `KAR_PLAN_INVALID`
- `KAR_RESULT_INVALID`

Anchor rejection, closure bounds, and search bounds are evaluation statuses. Their API codes are `KAR_ANCHOR_REJECTED`, `KAR_CLOSURE_BOUND_EXCEEDED`, and `KAR_SEARCH_BOUND_EXCEEDED`. The status string on the certificate is unchanged.

## Runtime

The evaluator uses the pure SHA-256 implementation in `@knolo/core`. It does not import `node:fs`, `node:path`, or `node:crypto`. A browser can evaluate image bytes, a CEG object, a plan, and a proposition without filesystem access. Reading files is the CLI's job.

JSON schemas for the sidecar, plan, and certificate are in `schemas/experimental/kar/`. They are developer validation tools. The runtime validators and the research oracle decide acceptance.
