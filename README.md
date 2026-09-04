# Knolo

## The verifiable knowledge layer for trustworthy AI

Knolo turns organizational knowledge into portable, deterministic, and cryptographically verifiable runtime artifacts.

AI products are becoming easier to build. The hard problem is making their knowledge dependable: traceable to evidence, reproducible across environments, safe to move, and defensible under review. Knolo is infrastructure for that problem.

> **Knowledge should be an asset you can inspect, verify, migrate, and run—not opaque context trapped inside an application.**

**V5 Foundation · V4 Compatible · Local-first · Deterministic · Verifiable**

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

The repository contains a working V5 foundation release alongside the unchanged V4 reference path.

### Knowledge Images

V5 defines a minimum verifiable container with:

- dual superblocks with generation-based recovery and an active commit pointer;
- immutable object and event segments;
- a commit record containing parent, object, event, view, schema, policy, runtime, and sequence roots;
- per-section bounds and digests;
- fail-closed validation for required sections, offsets, overlaps, duplicate sections, integer overflow, and digest mismatches;
- forward-compatible handling of unknown optional sections.

The result is a bounded byte artifact that can be mounted, inspected, verified, copied, and compared across runtimes.

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
       Verify      Query      Sync / merge
          │          │          │
          └──────────┼──────────┘
                     ▼
          Agents, products, and Studio
```

The boundary is intentional. Knolo owns the artifact, identity, evidence, roots, validation, deterministic planning, and bounded runtime state. Host applications own networking, credentials, model inference, external side effects, and deployment choices.

## Product surface

| Layer                   | Role                                                                    | Current path                   |
| ----------------------- | ----------------------------------------------------------------------- | ------------------------------ |
| Knowledge artifact      | Portable sources, chunks, claims, agents, metadata, objects, and events | `@knolo/core`                  |
| Verification            | Container validation, roots, digests, receipts, and recovery            | TypeScript and Rust            |
| Retrieval               | Lexical V4 retrieval plus bounded V5 query planning and indexes         | `@knolo/core`                  |
| Agent boundary          | Durable runs, evidence-aware context, policy, and authority primitives  | `@knolo/core`                  |
| Operations              | Health, diagnostics, Studio snapshot, sync, merge, and replay           | `@knolo/core` and `@knolo/cli` |
| Application integration | LangChain, LlamaIndex, Python, ICP, and starter workspace paths         | `examples/`, `packages/`       |

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

The V5 APIs are additive. Existing V4 retrieval APIs and behavior remain the compatibility default for this release.

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
- preserved V4 compatibility.

### Next product wave

- hosted CI confirmation and publication verification for the V5 release;
- written V5-to-V6 handoff against the reviewed V6 specification;
- host-owned extensions for model providers and external tools.

The current scope is intentionally a foundation release. It proves the portable artifact and verification layer before adding broader mutation, coordination, and hosted-management surfaces.

## Documentation

- [Documentation index](docs/README.md)
- [V5 roadmap](docs/ROADMAP.md)
- [V5 release guide](docs/RELEASE.md)
- [V5 specification index](spec/README.md)
- [TypeScript core](packages/core/README.md)
- [CLI](packages/cli/README.md)
- [Rust kernel](packages/core-rust/README.md)
- [Conformance fixtures](conformance/README.md)
- [Examples](examples/langchain-basic/README.md)
- [Architecture and design materials](docs/README.md)

## Repository layout

```text
packages/core/       TypeScript V4 and V5 knowledge runtime
packages/core-rust/  Native Rust V5 kernel and verifier
packages/cli/        Knolo command-line interface
packages/core-python/ Python V5 verifier/query package with legacy pack APIs
packages/icp-canister/ Internet Computer compatibility package
examples/            Framework and product integration examples
spec/                KIP contracts and normative schemas
conformance/         Cross-runtime fixtures and acceptance tests
docs/                Architecture, roadmap, and operational guides
```

## Status and contribution

Knolo V5 is an active foundation release. Interfaces marked V5 are evolving toward the published specification; V4 compatibility remains the stable adoption path while the new contracts harden.

Before opening a change, run the relevant package tests and `npm run release:check`. Changes to byte formats, digest domains, identity rules, or required sections must include updated specification text and cross-runtime fixtures.

## License

See [`LICENSE`](LICENSE).
