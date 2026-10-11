# KAR-1 Phase 7 — Experimental Core Report

Semantics remain `kar-1-research-1`. This phase productized that frozen algorithm as an experimental Knolo API and CLI. It did not open a new semantics version.

## Frozen semantics

`kar-1-research-1` is unchanged.

| Artifact | SHA-256 |
| --- | --- |
| `spec/KAR-1.md` | `a38f3c5e6098b88d13bd3595dce5c368bb46ace6159337858c18726b58504d66` |
| `research/kar-1/fixtures/expected.json` | `154215068cfc8ec50c0d973d2608afa74e237c04171081392d54569c47a3c9cf` |

Both hashes were recorded before and after `npm test` and `npm run test:integration` in `research/kar-1`. The research tree was not moved or deleted. Expected vectors were not rewritten. Certificate `version` is still `kar-1-research-1`. Experimental status is a module flag, not a field inside the certificate.

`research/kar-1` remains the specification executable. `packages/core/src/experimental/kar` is the optimized implementation and is differential-tested against that oracle.

## API

Developers import the experimental subpath. The root `@knolo/core` entry does not export KAR and does not load it.

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

const session = createKarSession({ image, graph });
const result = evaluateKar(session, { proposition, plan });
const explanation = explainKarResult(session, result);
const verification = verifyKar({ image, graph, proposition, plan, result });
const complexity = inspectKarComplexity(session, plan, proposition);
```

`createKarSession` mounts the V5 image, validates the `KarSidecarV1` Committed Evidence Graph, checks the image binding, canonicalizes the graph, and builds `evidenceById`, `nodeById`, `relationsByFrom`, and `bindingsByNode` once. Those indexes are execution structures. They are not inputs to a digest.

`evaluateKar` returns a `KarEvaluation`: status, stable error code when the frozen status is a failure, both image identities, the five frontiers, resolved `selectedEvidence`, witnesses, and the frozen `certificate`. There is no `hits[]` ranking.

`verifyKar` ignores any caller-supplied session. It remounts the image bytes, rebuilds indexes internally, and recomputes the certificate. A bare `KarResult` is compared as the certificate. When the claimed object is an evaluation, `verifyKar` also checks the envelope fields that sit outside `KARRoot`: proposition, plan, image identity, selected evidence, status, code, frontiers, and witnesses.

`explainKarResult(session, result)` fills applicability and necessity only when the recomputed witnesses and frontiers match the certificate. `explainKarCertificate(result)` does not invent those fields. `inspectKarComplexity` is advisory. It does not call exact cover and it does not change a later evaluation.

`createKarProjectionSession`, `evaluateKarProjection`, and `verifyKarProjection` are the research-image entry points used by conformance tests. Application code with a V5 image uses `createKarSession`.

Validators return `{ ok, errors: [{ code, path, message }] }`. Codes include `KAR_SIDECAR_INVALID`, `KAR_GRAPH_INVALID`, `KAR_GRAPH_NOT_BOUND`, `KAR_PLAN_INVALID`, `KAR_RESULT_INVALID`, `KAR_RESULT_MISMATCH`, `KAR_IMAGE_REJECTED`, `KAR_ANCHOR_REJECTED`, `KAR_CLOSURE_BOUND_EXCEEDED`, and `KAR_SEARCH_BOUND_EXCEEDED`. Frozen decision statuses are unchanged. `SATISFIED` and `UNSATISFIED_EVIDENCE_REQUIREMENTS` have a null integration code.

Schemas, which mirror the frozen objects and are not the runtime oracle:

- `schemas/experimental/kar/kar-sidecar-v1.schema.json`
- `schemas/experimental/kar/kar-plan-v1.schema.json`
- `schemas/experimental/kar/kar-result-v1.schema.json`

The worked example is `examples/kar/`. It builds a two-chunk V5 image, a hand-authored CEG, and a plan, then evaluates, prints support and opposition, and verifies. It does not compile a graph.

## CLI

The commands are:

```bash
knolo kar evaluate --image knowledge.knolo --graph knowledge.kar.json --plan plan.json --query "..."
knolo kar verify   --image knowledge.knolo --graph knowledge.kar.json --plan plan.json --query "..." --result result.json
knolo kar explain  --result result.json
knolo kar inspect  --image knowledge.knolo --graph knowledge.kar.json --plan plan.json --query "..."
```

`evaluate --json` prints the evaluation object. `verify` prints `VERIFIED` and exits 0, or a code plus reason and a non-zero status. `explain --result` alone explains the certificate. Applicability and necessity stay unknown until `--image`, `--graph`, `--plan`, and `--query` are all present. `inspect` is diagnostic.

Captured output for `examples/kar` and the proposition `Can this enterprise customer cancel?`:

```text
STATUS
SATISFIED

SUPPORT
sha256-00446cb20191782f952130e3c81d389a6986ce03a4f4261ea98f8ff24c506a81  front-desk/cancellation-policy  A guest may cancel a lodging reservation before the day of arrival.

OPPOSITION
sha256-4329cc17d44280d26cd8bce1b028db6ab14ef7a97f9683917f16003233ed32ba  contracts/enterprise-lodging  An enterprise customer may not cancel after the contract is signed.

QUALIFICATION
(none)

TEMPORAL
(none)

AUTHORITY
(none)

SELECTED EVIDENCE
sha256-00446cb20191782f952130e3c81d389a6986ce03a4f4261ea98f8ff24c506a81  F_S
sha256-4329cc17d44280d26cd8bce1b028db6ab14ef7a97f9683917f16003233ed32ba  F_O

KAR ROOT
sha256-3318470a00dc07289d208b564e6f63062f2c40db31f4a566dbfee4a8c52535b5

V5 STATE ROOT
sha256-866223845fddfde2bba6d10b4f89e02f447dd95b36c773be0631ffef5c674ad9

KAR KNOWLEDGE ROOT
sha256-d61a57849a8230a45690af4eecabbcf67ccd1f000224697fcc2d3eef9468b0be
```

`knolo kar verify` printed `VERIFIED`. These roots belong to this example image. They are not the integration-pilot fixtures.

`inspect` on the same files:

```text
V5 state root        sha256-866223845fddfde2bba6d10b4f89e02f447dd95b36c773be0631ffef5c674ad9
KAR knowledge root   sha256-d61a57849a8230a45690af4eecabbcf67ccd1f000224697fcc2d3eef9468b0be
CEG semantic root    sha256-d5abbbf9f27fb1e740a5151d015562ff89716ea391c2c33496b48f2a3eb8d7b1
object root          sha256-624294fd10cf551794f6bffaf0121f4d15e7ae78d68b5d9622756cd262cc3ab7
commit digest        sha256-fe9b981131fee7e801b28e6b8c039117fb503333ed97e9aab5806e0307aa2e30
nodes                3
relations            2
evidence bindings    2
relation types       prohibits, supports
cover risk           low
candidates           2
distinct masks       2
cardinality bound    4
max cover visits     1000
combination bound    4
```

Certificate-only `explain` reports `applicable unknown` and `necessary unknown`. The same command with image, graph, plan, and query reports both selected objects as applicable and necessary, with requirements `cancel-allowed` and `cancel-barred`.

## Differential testing

| Suite | Seed | Cases | Mismatches |
| --- | --- | --- | --- |
| Experimental core vs research `evaluate` | `20261011` | 50,000 | 0 |
| Frozen vectors | — | 16 | 0 |
| Integration fixtures | — | 12 | 0 |
| 400-node chain witness bytes | — | 1 | 0 |

The comparison is canonical equality of the whole result: `status`, `evidenceIds`, `choices`, `frontiers`, `witnesses`, `decision`, and every root. The generator includes invalid images and graphs, unbound knowledge roots, supplied and recomputed anchors, all three profiles, closure-bound cases, and plans whose `maxCoverVisits` is in `0..3`. The 50,000-case test passed again inside `@knolo/core`'s suite after the session-root reuse (`duration_ms` 16431.8).

## Certificate parity

For every differential input, the experimental certificate canonicalizes to the research certificate. That includes:

```text
knowledgeRoot
semanticRoot
queryRoot
planRoot
anchorRoot
frontierRoot
frontierWitnessRoot
evidenceSetRoot
decisionRoot
karRoot
```

`FrontierWitnessRoot` is still emitted and verified, and it is still outside the `KARRoot` preimage. Parent pointers never appear in a witness. A witness path is still `{ node }` on the first step and `{ relation, node }` after that, materialized only when that witness is first admitted.

The scaling benchmark additionally requires equal witness bytes, equal `FrontierWitnessRoot`, and equal `KARRoot` on every size. It throws if a full chain does not traverse `n - 1` edges. All eight rows recorded `certificateEqual: true` and `witnessesEqual: true`.

V5 `stateRoot` stays distinct from research `KnowledgeRoot`. The example above shows both. `KnowledgeRoot` was not redefined.

## Performance

Source: `docs/kar/benchmarks.json`, generated 2026-10-10 by `node --expose-gc packages/core/scripts/bench-kar.mjs`. Times are milliseconds. Repetitions are 15, 9, 5, and 3 for 100, 1,000, 10,000, and 50,000 nodes. Heap is the resident delta across session construction, two evaluations, closure, and cover in one repetition. It is not closure alone.

The benchmark uses projection sessions over a research `{ version: 1, evidence }` image. It does not mount 50,000 V5 objects. V5 mount, binding, and verification are covered by the example and by the session tests.

Closure speedup is research p50 divided by experimental p50.

### Full-depth chain (degree 1, depth n − 1)

| Nodes | Edges | Research closure p50 | Core closure p50 / p95 | Speedup | Session p50 | Cold eval p50 | Warm eval p50 | Core verify p50 | Heap p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 99 | 0.197 | 0.113 / 0.141 | 1.75× | 0.658 | 0.519 | 0.400 | 1.292 | 1.18 MiB |
| 1,000 | 999 | 3.759 | 0.474 / 3.227 | 7.93× | 3.189 | 0.880 | 0.891 | 5.229 | 6.34 MiB |
| 10,000 | 9,999 | 183.015 | 6.941 / 10.810 | 26.37× | 34.140 | 9.732 | 6.419 | 42.421 | 8.98 MiB |
| 50,000 | 49,999 | 16,885.609 | 45.060 / 48.220 | 374.74× | 202.995 | 48.938 | 44.433 | 237.940 | 69.34 MiB |

The 50,000-node chain is the performance gate. Research closure p95 was 16,952.023 ms. Experimental closure p95 was 48.220 ms. Witnesses, `FrontierWitnessRoot` (`sha256-034712eae3a07b6825a0c578ab290379b260d80f464050e103267cdd9e98d712`), and `KARRoot` (`sha256-5610b21b0d7584916b9fe1c643ff74cd2373499c215bfadd932d264c27c1ddc3`) matched. Research verification of that chain stayed at 16,881.061 ms p50 because it repeats the path-copying closure. Experimental verification rebuilds a session and still finishes in 237.940 ms p50.

Warm evaluation of a full-depth chain is a full walk, so it tracks closure cost. The local family is the session-index measurement.

### Bounded local graph (degree 3, depth 4)

Every size visits 30 edges. Cover stays under 0.06 ms p50 on the shared eight-member requirement mask.

| Nodes | Relations | Research closure p50 | Core closure p50 | Session p50 | Cold eval p50 | Warm eval p50 / p95 | Verify p50 | Heap p50 |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 100 | 294 | 0.121 | 0.018 | 0.846 | 0.272 | 0.189 / 0.273 | 1.136 | 1.38 MiB |
| 1,000 | 2,994 | 0.462 | 0.019 | 7.794 | 0.324 | 0.194 / 0.259 | 9.397 | 9.55 MiB |
| 10,000 | 29,994 | 3.915 | 0.021 | 89.183 | 0.332 | 0.189 / 0.190 | 86.407 | 23.85 MiB |
| 50,000 | 149,994 | 29.751 | 0.028 | 498.924 | 0.347 | 0.229 / 0.244 | 482.247 | 112.87 MiB |

Warm local evaluation stays near 0.2 ms from 100 nodes to 50,000 nodes. Session construction and cold verification grow with the whole graph because they canonicalize it once. A second query on the same session does not. The 50,000-node local `KARRoot` shared by both implementations is `sha256-a8333fb3a76b264a3953889d5b85c308daecec854e415f2f924445d1df2595c4`.

The gate holds: the 50,000-node full-depth closure is 374.74× faster than the research reference, p95 is under 2 seconds, and the certificate bytes match. Warm bounded queries scale with the visited neighborhood.

## Exact cover

`minimum-cover` is unchanged. There is no greedy fallback, no raised visit budget, and no approximate set. `SEARCH_BOUND_EXCEEDED` still returns an empty selected set while leaving the already computed frontiers in the certificate. A cardinality bound that excludes every feasible set remains `UNSATISFIED_EVIDENCE_REQUIREMENTS`.

Internal cover work uses requirement bitmasks and incremental popcount. The mask key used to keep the lexicographically smallest evidence id is still the same string key as the research implementation. Combination order and the `visits += 1; if (visits > limit)` check are unchanged.

The frozen research enumeration, seed `20261010`, remains 0 mismatches on 10,000 tiny graphs (`research/kar-1/integration/fixtures/enumerate-10k.json`). The experimental cover is not a second enumerator. It matches the research evaluator on the 50,000 differential cases, including the cases that draw a visit limit below 4. The research suite's 200-graph enumeration also passed.

`inspectKarComplexity` estimates candidates, distinct requirement masks, cardinality, `maxCoverVisits`, and a combination upper bound. Risk is `high` when that bound is capped, exceeds `maxCoverVisits`, or the distinct-mask count is at least 15. The helper does not select a set.

## Tamper tests

Randomized single-field mutations use seed `20261012`. The loop keeps a mutation only when the canonical bytes change, and it stops at 10,000 such mutations across the frozen certificates.

| Generated canonical mutations | Accepted verifications |
| ---: | ---: |
| 10,000 | 0 |

Mutations cover status, evidence ids, choices, a frontier member, witness anchor, cardinality, coverage counts, every root, witness order, profile, an extra `note`, an extra root, and `version: kar-1-research-2`. A changed `version` or a decision status that no longer matches the result status is `KAR_RESULT_INVALID`. Every other canonical change verified here is `KAR_RESULT_MISMATCH`.

No result field is a silent no-op. If a mutation does not change canonical bytes, it is discarded before verification and is not one of the 10,000. Adding `note` does change the canonical form, and verification rejects it. The committed certificate is the whole `KarResult`. Envelope display fields are outside `KARRoot` and are checked when `verifyKar` is given an evaluation.

The frozen integration tamper matrix also passed inside `npm run test:integration` (`every committed tamper fails verification`).

## Browser and runtime

`@knolo/core/experimental/kar` hashes with the existing runtime `sha256Hex` helper. A scan of `packages/core/dist/experimental/kar` found no `node:fs`, `node:path`, `node:crypto`, or `fs/promises`. `packages/core/scripts/check-runtime-no-node.mjs` passed: the root bundle does not mention `experimental/kar`, and the experimental entry does not mention those Node specifiers.

Filesystem reads live in `packages/cli/bin/kar.mjs`. A runtime that can supply image bytes, a CEG object, a plan, and a query can call `createKarSession` and `evaluateKar` without a filesystem. This was checked by the import scan and the runtime script. It was not executed inside a browser process.

## Regression results

KAR-attributable regressions: 0.

| Suite | Result |
| --- | --- |
| `research/kar-1` `npm test` | 16 pass, 0 fail |
| `research/kar-1` `npm run test:integration` | 5 pass, including the 10,000-graph enumeration |
| `research/kar-1` `cargo test --offline` | TypeScript vector parity and integration fixtures pass |
| `@knolo/core` `npm test` | runtime check pass; 177 tests pass; `scripts/test.mjs` pass |
| `@knolo/cli` `npm test` | 48 pass, 1 pre-existing skip (optional live Hub smoke), 0 fail |
| `@knolo/reflex` | 42 pass |
| `@knolo/langchain` | 2 pass |
| `@knolo/llamaindex` | 2 pass |
| `@knolo/evidence-gate` | 9 pass |
| `@knolo/semantic-ollama` | 5 pass |
| `create-knolo-app` | 1 pass |
| `packages/core-rust` `cargo test --offline` | 24 pass |

The core script suite covers V4 lexical retrieval, score filtering, near-duplicate dedupe, semantic rerank, receipts, and pack mount behavior. The core Node tests cover V5 images, VQF, EQL, migration, authority, and sync. Adapter packages cover LangChain and LlamaIndex. CLI tests cover the existing commands plus `knolo kar`.

## Known limits

- Exact cover is still combinatorial. Distinct private requirement masks around 15 or more can return `SEARCH_BOUND_EXCEEDED` under the plan's `maxCoverVisits`. The estimator warns. The evaluator does not approximate.
- The CEG stays in an external sidecar (`knowledge.kar.json`). It is not embedded in `.knolo`, and the V5 format was not modified.
- V5 `stateRoot` and research `KnowledgeRoot` are different digests. Both are exposed. `KnowledgeRoot` was not redefined.
- Semantic compilation is out of scope. There is no `buildCEGWithLLM`. KAR does not infer edges at query time.
- On abstention the frozen decision still records covered 0 on every frontier, including populated ones. The explainer reports both.
- A session treats its graph as immutable after creation. The semantic root is cached on the session. `verifyKar` does not trust that cache: it builds a new session from the original bytes.
- The 50,000-node timings are projection sessions. Building the session still canonicalizes the whole graph once. Warm local queries avoid that rescan. Cold verification does not.
- This phase did not run the evaluator inside a browser process. The runtime-safety claim is the import scan above.

## Classification

```text
READY_FOR_KAR_EXPERIMENTAL_RELEASE
```

The freeze is intact, frozen vectors match, the 50,000 differential cases have 0 mismatches, the Rust verifier matches, tamper tests fail closed, the 50,000-node closure gate passes with identical witnesses and roots, the experimental entry is free of Node filesystem and crypto imports, the CLI and API work, and existing Knolo suites show 0 KAR-attributable failures.

The next phase is CEG authoring, compilation, and distribution. It is not a change to KAR retrieval semantics.

## Answer

Yes. A normal Knolo developer can use KAR through `@knolo/core/experimental/kar` and `knolo kar`, with the same frozen semantics and certificates as `kar-1-research-1`, at the runtime measured above.

```text
READY_FOR_KAR_EXPERIMENTAL_RELEASE
```
