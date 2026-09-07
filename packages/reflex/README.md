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

Node.js 20 or newer is required. The package currently targets the V5 core
line and depends on `@knolo/core` 5.5.x.

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

## Runtime API

```ts
import { openReflexSessionV1, selectReflexContextV1 } from '@knolo/reflex';

const session = await openReflexSessionV1(packBytes, {
  namespace: 'support',
});
const selection = selectReflexContextV1(session, 'account recovery provider');

if (selection.disposition === 'ready') {
  // Send selection.context to the model and retain selection.receipt.
}
```

The selection result can be checked with
`verifyReflexSelectionReceiptV1`. Model output can be checked with
`validateReflexOutputV1` before it is accepted by an application.

## Ollama

```ts
import { createOllamaReflexAdapterV1 } from '@knolo/reflex';

const model = createOllamaReflexAdapterV1({
  modelId: 'huihui_ai/gemma-4-abliterated:26b',
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
npm run benchmark:reflex:local
```

That command uses the locally installed Gemma model when Ollama is available.
It is a development benchmark, not a certification claim; production teams
should supply a larger task set, a stable model revision, and a task-specific
judge.

## Versioning and status

`@knolo/reflex` is independently versioned and currently released as `0.1.0`.
Its V1 schemas are experimental. The package does not require a
`@knolo/core` version bump; it is compatible with the current 5.5.x core line.

## License

Apache-2.0
