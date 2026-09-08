# @knolo/reflex

`@knolo/reflex` provides deterministic, verifiable behavior packs for
`@knolo/core` Knowledge Images. A Reflex pack stores scoped atoms, procedures,
constraints, and renderable bundles. At runtime it selects the smallest
eligible context for a request and returns a receipt containing the selected
IDs, roots, and token accounting.

The package is local-first. It does not include a model, send prompts to a
remote service, or require a hosted registry. The Ollama adapter is an
optional integration for a locally running Ollama server.

## Install

```bash
npm install @knolo/reflex @knolo/core
```

Node.js 20 or newer is required. The package currently targets V5 and depends
on `@knolo/core` `5.5.0`.

## Build and verify a pack

The CLI accepts a JSON build description and writes a `.knolo` image:

```bash
reflex build ./reflex-input.json ./dist/support.knolo
reflex inspect ./dist/support.knolo
reflex verify ./dist/support.knolo
reflex query ./dist/support.knolo support "account recovery provider"
```

The compiler is deterministic: the same input produces the same state root and
behavior root. `verify` validates the underlying V5 image, Reflex manifest,
cross-object references, projections, and independent resource limits.

Bundle build inputs may use `requiredAtomKeys` and `triggerAtomKeys`. Trigger
atoms activate a bundle; required atoms are then added by deterministic
dependency closure. New atom relationships should use logical keys such as
`support.verify-identity`; digest relationships remain readable for early
0.1 images.

## Runtime API

```ts
import { openReflexSessionV1, selectReflexContextV1 } from '@knolo/reflex';

const session = await openReflexSessionV1(packBytes, {
  namespace: 'support',
  locale: 'en',
});
const selection = selectReflexContextV1(session, 'account recovery provider');

if (selection.disposition === 'ready') {
  // Send selection.context to the model and retain selection.receipt.
}
```

For a finite, explicitly configured candidate pool, runtime selection can use
the exact MRS optimizer. Contributions are a host-owned surrogate model and do
not claim to predict model quality outside the declared pool:

```ts
const session = await openReflexSessionV1(packBytes, {
  namespace: 'support',
  mrs: {
    successThreshold: 0.7,
    contributionByAtomKey: { 'support.account-recovery': 1.0 },
  },
});
```

The selection result can be checked with
`verifyReflexSelectionReceiptV1`. Model output can be checked with
`validateReflexOutputV1` and the selected bundle's `outputSchema` before it is
accepted by an application. Use the session-aware receipt verifier to replay
the full selection decision.

## Ollama

```ts
import { createOllamaReflexAdapterV1 } from '@knolo/reflex';

const model = createOllamaReflexAdapterV1({
  modelId: 'gemma4:e2b',
  judge(output) {
    return { failure: output.length === 0 };
  },
});
```

The adapter calls `POST /api/generate` on `http://localhost:11434` by default.
It requires an explicit judge because application policy and task correctness
are domain-specific. No network request is made by the package unless the
adapter is invoked.

## Evaluation

The package includes comparison and evaluation helpers:

```bash
REFLEX_MODELS=gemma4:e2b npm run benchmark:reflex:local -- /tmp/knolo-reflex-gemma4-e2b.json
```

That command uses `gemma4:e2b` by default when Ollama is available.
It is a development benchmark, not a certification claim; production teams
should supply a larger task set, a stable model revision, and a task-specific
judge.

Use `REFLEX_MODELS=model-a,model-b,...` to run the same held-out suite across
multiple Ollama models (for example the 0.5B, 1B/1.5B, 3B, and 7B candidates).
The script records one comparison per model; it does not infer parameter count
or capability from a model name.

Evaluation certification requires the configured risk bound, zero policy
violations, and the configured global/per-family coverage floors. The default
minimum coverage is 100%; lower floors must be explicit in evaluation config.

For offline research, `distillReflexBehaviorV1` converts frozen teacher records
through an injected extractor into deduplicated atoms and bundle candidates.
`optimizeMinimumReflexSetV1` exhaustively solves small surrogate candidate pools
and reports `search_limit` instead of claiming optimality for larger pools.

## Versioning and status

`@knolo/reflex` is independently versioned and currently released as `0.1.0`.
Its V1 schemas are experimental. The package does not require a
`@knolo/core` version bump; it is compatible with `@knolo/core` `5.5.0`.

## License

Apache-2.0
