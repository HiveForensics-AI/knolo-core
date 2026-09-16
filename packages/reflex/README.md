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
0.1 images. Bundles use `triggerMode: "all"` by default for compatibility;
distilled bundles use `triggerMode: "any"` so one learned intent can route to a
small behavior bundle without requiring every trigger in the family.

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
the full selection decision. Each receipt also commits to the complete
selection policy, including scope, budgets, tokenizer, renderer, and MRS
configuration.

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
REFLEX_MODELS=gemma4:e2b npm run benchmark:reflex:local -- \
  /tmp/knolo-reflex-gemma4-e2b-benchmark.json
npm run benchmark:reflex:check -- \
  /tmp/knolo-reflex-gemma4-e2b-benchmark.json
```

The harness records plain, full-Reflex, and MRS-Reflex variants, assigns a
deterministic 60/20/20 calibration/development/test split, and commits task,
split, behavior, selection-policy, frontier, and run-plan digests. Use
`--dry-run` to generate and validate the plan without model inference. Set
`REFLEX_MODEL_CLASS` only when the evaluation owner has verified a model class;
the harness never infers parameter count from a model tag. Set
`REFLEX_VALIDATE_OUTPUT=1` to enable the bundle output-schema check. The
six-task fixture is intentionally exploratory and cannot support certification;
production evidence requires a larger frozen task set, stable model revisions,
and application-owned judges.
For a bounded local smoke test, set `REFLEX_TASK_LIMIT=1`; limited runs are
always exploratory.

Before using a supplied production dataset, validate its minimum size and split
ratios with:

```bash
npm run benchmark:reflex:dataset:check -- ./tasks-500.json
```

Certification requires a dataset wrapper with `kind: production` and a
`source` object containing non-empty `id`, `revision`, and `owner` fields; an
unwrapped task array is treated as unclassified and cannot become production
evidence.

The current six-task fixture intentionally fails this production-dataset gate.
For pipeline smoke testing only, `npm run benchmark:reflex:dataset:test-fixture`
generates a clearly labeled synthetic 500-task dataset; it is never production
evidence and remains uncertified by the benchmark harness.
The `public-seed` dataset class is likewise structural test data: public intent
labels still require Knolo-owned expectations and judges before production use.
For intent datasets, the harness uses `taskType: intent-classification`, asks
the model for one JSON intent label, and records the
`knolo.reflex.intent-exact-json/v1` judge contract in the report.

To create an additional public seed with out-of-scope examples, download the
official CLINC OOS repository and run:

```bash
git clone --depth 1 https://github.com/clinc/oos-eval.git /tmp/knolo-clinc-oos
npm run benchmark:reflex:dataset:clinc
npm run benchmark:reflex:dataset:check -- /tmp/knolo-clinc-oos-500.json
```

This produces a deterministic 500-task seed with 150 in-scope labels and an
`oos` label. It remains public-seed-only until Knolo reviews the labels and
creates its own expectations and policy judgments.

To prepare that review, generate a fail-closed template:

```bash
npm run benchmark:reflex:dataset:review-template -- \
  /tmp/knolo-clinc-oos-500.json /tmp/knolo-reflex-dataset-review.json
```

After a human reviewer fills every task and records their identity, apply it:

```bash
npm run build --workspace @knolo/reflex
node scripts/apply-reflex-dataset-review.mjs \
  /tmp/knolo-clinc-oos-500.json \
  /tmp/knolo-reflex-dataset-review.json \
  ./tasks-production.json
```

The apply step refuses incomplete approvals, mismatched task digests, missing
policy decisions, or missing reviewer provenance.

Use `REFLEX_MODELS=model-a,model-b,...` to run the same held-out suite across
multiple Ollama models (for example the 0.5B, 1B/1.5B, 3B, and 7B candidates).
The script records one comparison per model; it does not infer parameter count
or capability from a model name.

Evaluation certification requires the configured risk bound, zero policy
violations, and the configured global/per-family coverage floors. The default
minimum coverage is 100%; lower floors must be explicit in evaluation config.
A dataset split digest is also required for a result to be labeled
`certified`; exploratory evaluations may omit it and remain `uncertified`.

Output schemas intentionally support a small fail-closed subset: `type`,
`required`, `properties`, `additionalProperties`, `items`, `enum`, and `const`.
Unknown schema keywords are rejected when a bundle is built or verified.

For offline research, `distillReflexBehaviorV1` converts frozen teacher records
through an injected extractor into deduplicated atoms and bundle candidates.
Teacher records use the versioned `knolo.reflex.teacher-record/v1` contract and
carry model, prompt, extractor, judge, dataset-split, and evidence provenance.
`computeReflexTeacherRecordRootV1` commits the input record, while each accepted
record receives an `extractionRoot` committing the normalized extracted atoms
and triggers. Records with a supplied root are verified before extraction. An
extractor may return an explicit `behaviorSignature`; records with the same
family and signature share a deterministic bounded cluster and bundle, while
records without one remain isolated rather than being silently unioned.
`optimizeMinimumReflexSetV1` exhaustively solves small surrogate candidate pools
and reports `search_limit` instead of claiming optimality for larger pools.
The exact solver caps exhaustive search at 30 atoms; production use should
prefer an offline Pareto frontier or another bounded solver.

For production request paths, build and validate that frontier offline from
the exact candidate problem, then provide it alongside the same `mrs` config:

```ts
import { buildReflexMRSFrontierV1, openReflexSessionV1 } from '@knolo/reflex';

const frontier = buildReflexMRSFrontierV1({
  atoms: candidateAtoms,
  requiredAtomIds,
  intercept: 0,
  successThreshold: 0.7,
  maxTokenCost: 512,
});
const session = await openReflexSessionV1(packBytes, {
  namespace: 'support',
  mrs,
  mrsFrontier: frontier,
});
```

The frontier stores only nondominated selections and is content-addressed by
the full MRS problem digest. Runtime lookup validates the frontier, checks that
the current candidate problem matches that digest, and rechecks dependencies,
conflicts, scope, atom count, and input budgets. A frontier is therefore an
offline artifact for a fixed candidate pool; changing model coefficients,
tokenizer, token costs, or budgets requires rebuilding it. Its digest and the
selected entry digest are included in the selection receipt.

Capability calibration is available for frozen model ablation observations:

```bash
reflex calibrate ./ablation-observations.json ./calibration-config.json \
  ./capability-calibration.json
```

`calibrateReflexCapabilityV1` fits a bounded logistic surrogate for one model
revision and behavior family using only `calibration` observations. It emits
per-atom coefficients, declared pair interactions, standard errors, sample
counts, and deterministic coefficient/calibration digests. Both successful and
failed observations are required; development and test observations are
rejected from fitting.

## Versioning and status

`@knolo/reflex` is independently versioned and currently released as `0.2.0`.
Its V1 schemas are experimental. The package does not require a
`@knolo/core` version bump; it is compatible with `@knolo/core` `5.5.0`.

## License

Apache-2.0
