# Knolo

## The verifiable knowledge layer for trustworthy AI

Knolo turns organizational knowledge into portable, deterministic, and cryptographically verifiable runtime artifacts.

AI products are becoming easier to build. The hard problem is making their knowledge dependable: traceable to evidence, reproducible across environments, safe to move, and defensible under review. Knolo is infrastructure for that problem.

> **Knowledge should be an asset you can inspect, verify, migrate, and run—not opaque context trapped inside an application.**

**V6 · KAR · V5 Knowledge Images · V4 compatible · Local-first · Deterministic · Verifiable**

## Current release

This tree is Knolo 6.2.0. V6 adds [KAR](docs/kar/README.md): deterministic retrieval of a minimum evidence set from a V5 Knowledge Image and a Committed Evidence Graph. 6.1.0 adds [verifiable composition](docs/composition/README.md). 6.2.0 adds [Knolo Cortex](docs/cortex/README.md): bounded evidence retrieval with a verifiable trace. The host owns any model. Verification does not mean an answer is true. Lexical retrieval, V5 images, and V4 packs stay in place.

```ts
import {
  createKarSession,
  evaluateKar,
  verifyKar,
  explainKarResult,
  createKarDossier,
  createKarCoverage,
} from '@knolo/core/kar';
```

The root `@knolo/core` entry does not load KAR. `@knolo/core/experimental/kar` remains a compatibility entry for this cycle. `SATISFIED` means the declared evidence requirements were met. It does not mean a claim is proven. `UNSATISFIED_EVIDENCE_REQUIREMENTS` means those requirements were not met. It does not mean the claim is false.

The npm packages in this repository are `6.2.0`. `@knolo/cli` depends on `@knolo/core` `^6.2.0`. The other packages that depend on `@knolo/core` stay at `^6.0.0`. Publishing that version, and moving the npm `latest` dist-tag, is a separate step. `@knolo/reflex` stays `0.2.0`. `@knolo/evidence-gate` stays `0.1.0`. Rust, Python, and the ICP canister stay `5.5.1` and do not implement KAR, composition, or Cortex. The bundled contracts, policy, and operations Domain Packs are `review-required`. The local tag `v6.0.0` stays on the 6.0.0 commit. The local tag `v6.1.0` stays on the 6.1.0 commit.

Start with the [KAR guide](docs/kar/README.md), the [composition guide](docs/composition/README.md), the [Cortex guide](docs/cortex/README.md), the [6.2.0 release notes](docs/releases/v6.2.0.md), [`examples/kar-v6`](examples/kar-v6/README.md), [`examples/kar-coverage`](examples/kar-coverage/README.md), and [`examples/composition-v1`](examples/composition-v1/README.md).

## The opportunity

The next generation of AI products will compete on the quality and trustworthiness of their knowledge layer. Models may change quickly; durable value accumulates in the evidence, policies, retrieval behavior, runtime state, and operational history surrounding them.

Knolo provides a neutral substrate for that layer:

- **Portable knowledge** — package a knowledge base as a self-contained Knowledge Image rather than a proprietary database export.
- **Verifiable state** — every V5 image has deterministic encodings, domain-separated SHA-256 roots, bounded sections, and a commit history.
- **Traceable answers** — preserve source, chunk, claim, citation, and evidence identity through retrieval and agent execution.
- **Reproducible behavior** — use deterministic query plans, receipts, migration records, and runtime diagnostics to make results inspectable.
- **Composable infrastructure** — keep storage, verification, retrieval, policy, and agent execution separate so products can adopt only what they need.

This is the strategic thesis behind Knolo: a trusted knowledge runtime can become shared infrastructure beneath many AI applications, agents, and enterprise workflows.

## Why Knolo

| Conventional AI knowledge layer                             | Knolo                                                   |
| ----------------------------------------------------------- | ------------------------------------------------------- |
| Context assembled opaquely at request time                  | A mounted, inspectable Knowledge Image                  |
| Retrieval changes with hidden indexes and environment state | Deterministic plans, roots, and receipts                |
| Evidence is often discarded after generation                | Stable identities and provenance remain queryable       |
| Data is coupled to one application or vendor                | Portable artifacts with compatibility paths             |
| Audit is added after the product ships                      | Verification and bounded validation are core contracts  |
| Runtime state is difficult to reproduce                     | Immutable segments, commits, snapshots, and diagnostics |

Knolo does not try to be another model provider or another chat application. It is the knowledge and runtime foundation those products can build on.

## What exists today

The repository contains the V6 KAR surface on the V5 Knowledge Image foundation, alongside the unchanged V4 reference path.

### Knowledge Images

V5 defines a minimum verifiable container with:

- dual superblocks with generation-based recovery and an active commit pointer;
- immutable object and event segments;
- a commit record containing parent, object, event, view, schema, policy, runtime, and sequence roots;
- per-section bounds and digests;
- fail-closed validation for required sections, offsets, overlaps, duplicate sections, integer overflow, and digest mismatches;
- forward-compatible handling of unknown optional sections.

The result is a bounded byte artifact that can be mounted, inspected, verified, copied, and compared across runtimes. V5 `stateRoot` identifies the image. KAR's `knowledgeRoot` is a different digest.

### KAR

KAR asks for the minimum applicable evidence set required to evaluate a proposition under a declared plan. Support, opposition, qualification, temporal applicability, and authority stay typed by that plan. The evaluation is replayable. It is not a ranked-passage search and it does not replace `query()`.

A Committed Evidence Graph is compiled from editable CEG Source. `compileCegSource()` is the writer of those bytes. Authoring imports come from `@knolo/core/kar/authoring`. A coverage report says which supplied evidence requirements are met, which are gaps, and which plans did not decide. The worked demos are [`examples/kar-v6`](examples/kar-v6/README.md) and [`examples/kar-coverage`](examples/kar-coverage/README.md). Public vectors are [`conformance/kar/v1`](conformance/kar/v1/README.md) and [`conformance/kar/coverage-v1`](conformance/kar/coverage-v1/README.md).

Contracts, policy, and operations Domain Packs can propose CEG Source. Their maturity is `review-required` in [`domains/v6-catalog.json`](domains/v6-catalog.json). Human review is still required before those proposals are treated as validated semantics. KAR evaluates an already committed graph either way.

Paper: [KAR-1: Frontier-Constrained Minimum Evidence Retrieval over Committed Knowledge Images](https://www.researchgate.net/publication/415581037_KAR-1_Frontier-Constrained_Minimum_Evidence_Retrieval_over_Committed_Knowledge_Images_Deterministic_Support_Opposition_Qualification_Temporal_and_Authority_Frontiers_with_Replayable_Evidence_Certifica) (preprint).

### Deterministic contracts

Rust and TypeScript share golden vectors for the core byte and root contracts:

- deterministic CBOR encoding;
- domain-separated `knolo:<domain>:v1` SHA-256 digests;
- object, event, commit, and state roots;
- superblock selection and torn-write recovery;
- section directory and digest validation;
- migration receipts.

### V4 migration

Existing V1–V4 artifacts remain readable. A V4 artifact can be verified first and then migrated deterministically into a V5 genesis image. The migration imports sources, chunks, claims, agents, and metadata; maps legacy block identifiers to stable evidence identities; and emits a receipt containing the source digest, destination root, and identity mappings.

### Read-only runtime foundation

The current V5 kernel supports the primitives needed to build trustworthy knowledge products:

- content-addressed objects and immutable events;
- snapshot readers with a single-writer concurrency profile;
- bounded EQL query planning and deterministic result receipts;
- query indexes and history;
- policy evaluation, authority sessions, signed envelopes, and key rotation;
- sync summaries, fast-forward exchange, merge planning, and replay;
- durable agent runs with host-controlled execution boundaries;
- runtime health and diagnostics;
- a read-only Studio management snapshot contract, KIP-0026;
- native Rust verification and migration foundations.

Transactions, authority mutation workflows, network orchestration, model inference, and the Studio UI/service remain deliberate follow-on layers.

## A simple architecture

```text
Sources, claims, agents, metadata
                │
                ▼
       Build or migrate deterministically
                │
                ▼
       ┌──────────────────────────┐
       │     V5 Knowledge Image    │
       │ objects · events · commit │
       │ roots · policy · runtime  │
       └──────────────────────────┘
          │          │          │
          ▼          ▼          ▼
       Verify      Query     CEG Source
          │          │          │
          │          │          ▼
          │          │   Committed Evidence Graph
          │          │          │
          │          │          ▼
          │          │         KAR
          │          │          │
          └──────────┼──────────┘
                     ▼
          Agents, products, dossiers, and Studio
```

The boundary is intentional. Knolo owns the artifact, identity, evidence, roots, validation, deterministic planning, and bounded runtime state. Host applications own networking, credentials, model inference, external side effects, and deployment choices.

## Product surface

| Layer                   | Role                                                                          | Current path                   |
| ----------------------- | ----------------------------------------------------------------------------- | ------------------------------ |
| Knowledge artifact      | Portable sources, chunks, claims, agents, metadata, objects, and events       | `@knolo/core`                  |
| Verification            | Container validation, roots, digests, receipts, and recovery                  | TypeScript and Rust            |
| Retrieval               | Lexical V4 retrieval plus bounded V5 query planning and indexes               | `@knolo/core`                  |
| KAR                     | Minimum evidence set under a declared plan                                    | `@knolo/core/kar`              |
| CEG authoring           | Compile CEG Source into a Committed Evidence Graph                            | `@knolo/core/kar/authoring`    |
| Domain Packs            | Review-required rules, vocabulary, and plan templates                         | `domains/`                     |
| Agent boundary          | Durable runs, evidence-aware context, policy, and authority primitives        | `@knolo/core`                  |
| Evidence Gate           | Claim-level support, conflict, abstention, and offline certificate checks     | `@knolo/evidence-gate`         |
| Operations              | Health, diagnostics, Studio snapshot, sync, merge, and replay                 | `@knolo/core` and `@knolo/cli` |
| Application integration | LangChain, LlamaIndex, Python, ICP, and starter workspace paths               | `examples/`, `packages/`       |
| Behavior packs          | Deterministic scoped procedures, constraints, context selection, and receipts | `@knolo/reflex`                |

## Quickstart

### Create a compatible application

```bash
npx create-knolo-app my-knowledge-app
cd my-knowledge-app
npm install
npm run dev
```

The starter workspace gives an application a V4-compatible retrieval path while leaving room to adopt V5 artifacts incrementally.

### Inspect and verify a V5 image

```bash
npm run knolo -- v5 info ./dist/knowledge.v5
npm run knolo -- v5 health ./dist/knowledge.v5
npm run knolo -- v5 studio ./dist/knowledge.v5
```

### Discover and install a Hub pack

The CLI can discover published packs at the production Hub and install one
only after verifying its manifest, Blob bytes, digest, size, and local V4/V5
Knowledge Image structure:

```bash
npm install -g @knolo/cli
knolo search "refund policy"
knolo info acme/refund-policy
knolo add acme/refund-policy@1.2.0
```

Installs are content-addressed and recorded in `knolo.lock.json`. Use
`KNOLO_HUB_URL` or `--registry` when testing a local or partner Hub.

Hub write APIs accept dashboard `kno_…` tokens with the required
`Authorization: Bearer kno_…` header. `knolo login` stores the raw secret
locally; GitHub sign-in is needed only to mint a token at
https://hub.knolo.dev/dashboard/tokens. `knolo publish` uses that token to ask
Hub for a public Blob PUT grant, uploads bytes to the grant URL (never with
the `kno_…` token), then completes with the public pack URL. Do not set
`PACKS_READ_WRITE_TOKEN` in the CLI — that is Hub’s store secret.

```bash
knolo login --token kno_…
knolo publish ./dist/knowledge.knolo --slug refund-policy \
  --version 1.2.0 --license Apache-2.0
knolo yank acme/refund-policy@1.2.0
```

The CLI uses pathname `sha256/<64-lowercase-hex>.knolo`. It rejects private
Blob hosts because Hub verification must fetch the artifact. It never sends
the `kno_…` token to Blob, in query strings, cookies, or pack bytes. A 401
normally means the `Bearer` word is missing or the token was revoked—not that
Hub requires a GitHub browser session. To smoke-test the stored credential,
use:

```bash
curl -sS -H "Authorization: Bearer kno_…" \
  -H "Accept: application/json" \
  https://hub.knolo.dev/api/v1/account
```

`POST /api/v1/tokens` is not a CLI login endpoint; it is dashboard/session
token minting only.

### Use the V5 kernel directly

```ts
import {
  migrateV4ToV5,
  mountKnowledgeImageV5,
  verifyKnowledgeImageV5,
} from '@knolo/core';

const { image, receipt } = await migrateV4ToV5(v4Bytes);
const verification = verifyKnowledgeImageV5(image);
const mounted = mountKnowledgeImageV5(image);

console.log({
  verified: verification.valid,
  stateRoot: mounted.commit.stateRoot,
  migratedFrom: receipt.sourceDigest,
});
```

The V5 APIs are additive. Existing V4 retrieval APIs and behavior remain the compatibility default for ordinary search.

### Evaluate a committed graph with KAR

From a checkout:

```bash
npm run build --workspace @knolo/core
node examples/kar-v6/run.mjs
```

`knolo kar demo` runs the same script. `knolo kar conformance` checks the public vectors. The [KAR quickstart](docs/kar/quickstart.md) covers the session, the dossier, and verification.

### Add deterministic behavior with Reflex

[`@knolo/reflex`](packages/reflex/README.md) is a separate public package for
building and running verifiable behavior packs above `@knolo/core`. Reflex
packs contain scoped atoms, procedures, constraints, and renderable bundles.
At runtime, Reflex selects bounded context for a request and returns a receipt
with the selected IDs, roots, and token accounting. Model inference remains
under the host application's control.

```bash
npm install @knolo/reflex @knolo/core
```

```ts
import { openReflexSessionV1, selectReflexContextV1 } from '@knolo/reflex';

const session = await openReflexSessionV1(packBytes, {
  namespace: 'support',
});
const selection = selectReflexContextV1(session, 'account recovery provider');

if (selection.disposition === 'ready') {
  // Give selection.context to the model and retain selection.receipt.
}
```

The package is independently versioned as `0.2.0`, compatible with
`@knolo/core` `^6.0.0`, and includes an optional adapter for a local Ollama
server. See the [Reflex package guide](packages/reflex/README.md) for the CLI,
verification, evaluation, optimization, distillation, and security details.

The current Reflex 0.2 development line adds frozen teacher provenance,
behavior-signature clusters, calibrated MRS selection, offline Pareto frontiers,
and a split-aware benchmark harness. These additions remain experimental until
the larger frozen evaluation set, conformance review, and release gates are
complete.

## Trust and engineering proof

Knolo’s trust model is expressed in executable contracts rather than marketing language. Run the repository checks locally:

```bash
npm ci
npm run release:check
npm test
npm run trustbench:test
cargo test --manifest-path packages/core-rust/Cargo.toml
```

The release check covers TypeScript build and tests, CLI compatibility, Rust tests, conformance fixtures, documentation formatting, and the V5 verification path. Cross-runtime fixtures are maintained under [`conformance/v5`](conformance/v5/README.md).

Corruption is treated as a normal operating condition to test: truncation, invalid offsets, overlapping or duplicate sections, malformed required sections, invalid generations, oversized declarations, and digest mismatches must fail closed. Unknown optional sections are accepted for forward compatibility.

## Built for more than one runtime

| Runtime                | Role                                                                          |
| ---------------------- | ----------------------------------------------------------------------------- |
| TypeScript             | V4 reference implementation and complete V5 foundation APIs                   |
| Rust                   | Native V5 byte contracts, verification, migration, and future embedded kernel |
| Python                 | Read-only V5 verifier/query with preserved V1–V3 pack APIs                    |
| Internet Computer      | Legacy compatibility profile with a synchronized Rust template                |
| LangChain / LlamaIndex | Adapter examples for application adoption                                     |
| CLI                    | Human and automation entry point for artifact inspection and diagnostics      |

The architecture is host-neutral: an agent can use Knolo as its knowledge substrate regardless of which model, orchestration framework, deployment target, or UI surrounds it.

## Who it is for

Knolo is designed for teams building:

- enterprise knowledge systems where every answer needs evidence and provenance;
- private, on-device, edge, or offline AI where data must remain portable;
- agent runtimes that need durable state without surrendering control to a hosted black box;
- regulated workflows that require deterministic exports, verification, and migration records;
- multi-product platforms that want one knowledge asset shared across applications and runtimes;
- AI infrastructure products whose differentiation depends on trust, not only model output.

## Roadmap

The active roadmap is maintained in [`docs/ROADMAP.md`](docs/ROADMAP.md).

### Delivered foundation

- V5 container, roots, deterministic encoding, and fail-closed validation;
- V1–V4 migration with deterministic receipts;
- shared Rust/TypeScript conformance vectors;
- read-only retrieval, indexes, history, policy, authority, key rotation, sync, merge, replay, and durable runs;
- runtime diagnostics and the KIP-0026 Studio snapshot;
- CLI inspection, health, and Studio management commands;
- preserved V4 compatibility;
- KAR evaluation, explanation, verification, Evidence Dossiers, and evidence coverage reports;
- CEG Source compilation and public KAR conformance vectors;
- offline composition records, bounded excerpts, and Ed25519 attestation envelopes;
- contracts, policy, and operations Domain Packs at maturity `review-required`.

### Still ahead

- publish `6.1.0` and run the registry smoke;
- human validation before a Domain Pack is treated as validated;
- KAR on Rust, Python, and ICP, which stay at `5.5.1`;
- host-owned extensions for model providers and external tools.

V5 remains the portable image and verification layer. V6 adds KAR on that layer. Domain Pack extraction is not a validated automatic semantic layer.

## Documentation

- [Documentation index](docs/README.md)
- [KAR](docs/kar/README.md)
- [KAR quickstart](docs/kar/quickstart.md)
- [Knolo 6.2.0 release notes](docs/releases/v6.2.0.md)
- [Knolo 6.1.0 release notes](docs/releases/v6.1.0.md)
- [Cortex](docs/cortex/README.md)
- [Knolo 6.0.0 release notes](docs/releases/v6.0.0.md)
- [Composition](docs/composition/README.md)
- [V5 roadmap](docs/ROADMAP.md)
- [V5 release guide](docs/RELEASE.md)
- [VQF-1 format freeze boundary](docs/VQF1_FORMAT_FREEZE.md)
- [VQF-1 lexical status](docs/VQF1_LEXICAL_STATUS.md)
- [VQF-1 phase handoff](docs/VQF1_NEXT_PHASES.md)
- [V5 specification index](spec/README.md)
- [TypeScript core](packages/core/README.md)
- [CLI](packages/cli/README.md)
- [Rust kernel](packages/core-rust/README.md)
- [Conformance fixtures](conformance/README.md)
- [Examples](examples/langchain-basic/README.md)
- [Architecture and design materials](docs/README.md)

## Repository layout

```text
packages/core/       TypeScript runtime, including `@knolo/core/kar`, `@knolo/core/composition`, and `@knolo/core/cortex`
packages/core-rust/  Native Rust V5 kernel and verifier (5.5.1), including public KAR V5 evaluate/verify. No Cortex, authoring, coverage, or composition
packages/cli/        Knolo command-line interface, including `knolo kar`, `knolo compose`, and `knolo cortex`
packages/core-python/ Python V5 verifier/query package (5.5.1, no KAR or Cortex)
packages/icp-canister/ Internet Computer compatibility package (5.5.1, no KAR or Cortex)
domains/             Review-required Domain Packs
examples/kar-v6/     Redistributable KAR demos
examples/            Framework and product integration examples
spec/                KIP contracts, including KAR-1
conformance/kar/v1/  Public KAR vectors
conformance/kar/coverage-v1/  Evidence coverage vectors
conformance/composition/v1/  Composition and attestation vectors
conformance/cortex/v1/  Cortex trace vectors
conformance/         Cross-runtime fixtures and acceptance tests
docs/kar/            KAR, CEG, dossiers, and the V6 release notes
docs/composition/    Offline composition and attestation
docs/cortex/         Knolo Cortex reasoned evidence retrieval
```

## Status and contribution

Knolo 6.2.0 is the product line in this repository. V5 Knowledge Images remain the evidence container. V4 retrieval remains the compatibility path for ordinary search. KAR semantics stay `kar-1-research-1`. Composition cites those artifacts and does not change their roots. Cortex retrieves over them and does not change their roots. Domain Packs stay review-required until a person validates them.

Before opening a change, run the relevant package tests and `npm run release:check`. Changes to byte formats, digest domains, identity rules, or required sections must include updated specification text and cross-runtime fixtures.

## License

See [`LICENSE`](LICENSE).
