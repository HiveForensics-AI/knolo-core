# V5 pre-V6 development plan

**Status:** V5 implementation phases complete locally; release-gate follow-up remains

**Date:** 2026-09-01
**Baseline:** V5.0.0 is live; this branch prepares the backward-compatible
V5.1.0 hardening release. V4 compatibility remains supported.
**Source documents:** [`ROADMAP.md`](ROADMAP.md) and the locally supplied V6
CESR specification, which is intentionally excluded from the repository.

## Objective

Complete every pending V5 roadmap item before beginning V6 implementation.
V5 remains the stable, portable Knowledge Image line. Work in this plan must
be additive, host-neutral, and compatible with existing V4 behavior and V5
roots, fixtures, receipts, and CLI commands.

The uploaded V6 specification defines CESR as a certified-evidence query
runtime over the existing V5 container. It preserves lexical-first candidate
generation and treats the solver as untrusted. Its evidence objects, obligation
plans, sparse optimization, witness verification, decision engine, V6 KIPs,
and V6 CLI are explicitly outside this plan.

## Current verification baseline

The following checks were run for the V5.1.0 release candidate on 2026-09-01:

| Check                                     | Result                                                                                                                                                                |
| ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `npm run release:check`                   | Passed after Phase 5 changes: builds, exports, artifacts, runtime separation, CLI registration, KIP coverage, docs, packages, and release metadata.                   |
| `npm test`                                | Passed: 31 core tests, 1 CLI test, 1 app-scaffold test, and 1 test each for the LangChain and LlamaIndex adapters.                                                    |
| `npm run trustbench:test`                 | Passed.                                                                                                                                                               |
| `npm run build --workspaces --if-present` | Passed.                                                                                                                                                               |
| `npm run test:icp`                        | Passed: 18 Rust core tests, 11 ICP tests, and template-sync check.                                                                                                    |
| ICP WASM release build                    | Passed.                                                                                                                                                               |
| Python `pytest`                           | Passed: 21 tests. Python provides the read-only V5 verifier/query profile and preserves the legacy V1–V3 pack APIs.                                                   |
| Python build and `twine check`            | Passed.                                                                                                                                                               |
| `npm run format:check:all`                | Passed after resolving the existing 9-file formatting baseline.                                                                                                       |
| `npm run docs:check`                      | Passed: 76 Markdown files audited.                                                                                                                                    |
| `npm run release:packages`                | Passed: six npm package manifests and two Rust crate source manifests checked.                                                                                        |
| `npm run release:archives`                | Passed: npm and Cargo dry-run archives for all V5 release packages.                                                                                                   |
| `npm run smoke:v5`                        | Passed: create, inspect, query, verify, migrate, and receipt production.                                                                                              |
| Phase 1 Studio service tests              | Passed: authorized GET/HEAD snapshots, route boundaries, and mutation rejection.                                                                                      |
| Phase 1 native root fixture               | Passed: TypeScript and Rust diagnostics/Studio roots match the shared V5 fixture.                                                                                     |
| Phase 2 host adapter tests                | Passed: discovery, retries, expiry, replay protection, checkpoint resume, peer selection, monitoring, and failed transfers.                                           |
| Phase 3 coordination tests                | Passed: writer exclusion, lease renewal/expiry, explicit stale recovery, atomic crash leftovers, detached readers, authorization auditing, and authorized sync apply. |
| Phase 4 Python and adapter tests          | Passed: shared V5 image/EQL roots in Python and V5 query-root metadata propagation through LangChain and LlamaIndex adapters.                                         |

## Execution rules

- Preserve V4 APIs, fixtures, TrustBench behavior, and compatibility profiles.
- Do not change the V5 container magic, required segment schemas, canonical
  encoding, or existing root composition.
- Keep network sockets, credentials, model inference, external side effects,
  and deployment decisions outside `@knolo/core`.
- Keep V5 mutations explicit and host-authorized. Do not introduce CESR
  evidence semantics or a second partially supported V6 database API.
- Every new cross-runtime or operational behavior needs a fixture, failure
  case, and documented compatibility boundary.
- Each phase exits only when its tests, documentation, and operational evidence
  are complete.

## Phase 0 — release closure and baseline protection

**Priority:** P0

**Depends on:** None

**Status:** Complete locally; the configured GitHub workflow needs its first
hosted run after these changes.

- [x] Resolve the Prettier baseline, or record a narrow, enforced exception for
      legacy files without rewriting unrelated code.
- [x] Add CI for documentation-link auditing, formatting policy,
      cross-runtime golden vectors, and package-publication checks.
- [x] Keep the full V5 release gate green in pull requests:
      `release:check`, workspace tests, TrustBench, Rust, ICP, WASM, and
      Python validation.
- [x] Verify the live V5 package set, tag, release notes, package contents, and
      the documented legacy Python/ICP boundaries.
- [x] Add a clean-environment smoke test for create, inspect, query, verify,
      migration, and receipt production.

**Exit condition:** A clean V5 checkout passes the release gate and local CI
equivalents without changing V4 behavior. Registry publication verification
remains an external release-operator check.

## Phase 1 — Studio and native inspection surfaces

**Priority:** P0

**Depends on:** Phase 0

- **Status:** Complete locally; hosted CI confirmation remains part of the V5
  completion gate.

- [x] Build the read-only Studio service over KIP-0026. The Node entry point
      serves deterministic GET/HEAD snapshots at `/studio/v5`.
- [x] Keep all Studio mutations behind explicit host authorization and audit
      the boundary between presentation and core runtime.
- [x] Add Rust parity for the verified base runtime diagnostics and Studio
      management roots where native consumers need those views.
- [x] Add cross-runtime fixtures for diagnostics, Studio snapshots, and
      management roots.
- [x] Keep `knolo v5 info`, `knolo v5 health`, and `knolo v5 studio` compatible.

The Phase 1 service is intentionally read-only: it has no mutation handler,
requires host-supplied read authorization when a host needs it, and returns
`405` for write methods. Native parity currently covers the base image,
diagnostics, and management snapshot contract; optional query/history/run/replay
panels remain host/runtime extensions until their native contracts are needed.

**Exit condition:** TypeScript, Rust, CLI, and Studio views agree on the same
verified snapshot roots, and the Studio cannot mutate state implicitly.

## Phase 2 — Host transport, deployment, and monitoring adapters

**Priority:** P1

**Depends on:** Phase 1

- **Status:** Complete locally; hosted CI confirmation remains part of the V5
  completion gate.

- [x] Define host adapter interfaces for durable transport deployment, peer
      discovery, resumable transfer, and operational monitoring.
- [x] Add a reference adapter and fake-host integration tests for retries,
      expiry, replay protection, checkpoint resume, peer selection, and failed
      transfers.
- [x] Keep sockets, credentials, discovery providers, and deployment state out
      of the core package.
- [x] Document production topology, adapter ownership, and failure behavior.

The host deployment coordinator wraps the existing signed V5 image exchange.
It asks the host discovery adapter for opaque peer IDs, requires an explicit
peer when discovery is ambiguous, retries only bounded transfer failures, and
passes a host-provided checkpoint back to the next attempt. Expired and
replayed requests are terminal; failed transfers never enter replay state.
Sockets, endpoint routing, credentials, checkpoint persistence, and monitoring
sinks remain host-owned.

The operational ownership, deployment sequence, and failure matrix are
documented in [`V5_HOST_DEPLOYMENT.md`](V5_HOST_DEPLOYMENT.md).

**Exit condition:** A host can deploy and monitor V5 synchronization through an
adapter without importing network or credential behavior into the core.

## Phase 3 — V5 coordination, authorized operations, and production sync

**Priority:** P1

**Depends on:** Phases 0–2

**Status:** Complete locally; hosted CI confirmation remains part of the V5
completion gate.

Lease-enabled durable stores now distinguish bounded multi-writer ownership
from the compatible legacy lock path. Lease expiry is checked on each store
operation, stale recovery is explicit, and the existing atomic image
replacement remains the commit-pointer boundary. The shared authorization gate
covers commit, merge, policy, authority, and sync operation envelopes; policy
and authority handlers remain host-owned. Production sync can now apply a
verified direct remote-ahead deployment through that gate. Diverged images
remain explicit merge operations.

The coordination, recovery, authorization, and production-sync evidence is
documented in [`V5_COORDINATION.md`](V5_COORDINATION.md).

- [x] Add multi-writer coordination for the V5 store.
- [x] Add bounded leases, renewal, expiry, and explicit stale-writer recovery.
- [x] Preserve atomic commit-pointer updates and prove failed or crashed writes
      leave the previous committed state intact.
- [x] Add host-authorized Studio workflows for commits, merges, policy, and
      authority administration.
- [x] Add production sync orchestration, peer discovery, and resumable
      deployment on top of the transport adapters.
- [x] Keep divergent merge handling explicit; never introduce silent
      last-write-wins behavior for claims, evidence, policy, or runs.
- [x] Add lock, lease, crash-recovery, replay, and concurrent-reader tests.

**Exit condition:** Single-writer and multi-writer behavior are distinguishable,
auditable, recoverable, and covered by deterministic tests.

## Phase 4 — Runtime profiles, application adapters, and distribution

**Priority:** P1

**Depends on:** Phases 0–3

**Status:** Complete locally; hosted CI confirmation remains part of the V5
completion gate.

The Python package is now version `5.1.0` and mounts/verifies the shared V5
image and EQL query fixture without a Node.js runtime dependency. Its legacy
V1–V3 pack APIs remain available, while V5 writes, Studio, authority, and
transport remain outside its scope. LangChain and LlamaIndex accept mounted V5
images or Node image paths and propagate state, plan, and result roots with a
compatibility marker. CLI and application documentation now state the V5
behavior and the remaining ICP legacy boundary. Rust’s native base verifier and
the existing WASM build remain bounded profiles without semantic drift.

- [x] Upgrade Python from the legacy profile to V5 verify/query support with
      shared V5 fixtures and documented publication boundaries.
- [x] Add additional runtime profiles where they can consume the stable V5
      byte/root contracts without semantic drift.
- [x] Add WASM and embedded distribution profiles after byte and root parity is
      locked.
- [x] Complete agent-host integrations for model providers and external tools,
      while keeping inference and side effects host-owned.
- [x] Make `create-knolo-app` and CLI V5 behavior explicit and verify examples
      against the live V5 package set.
- [x] Ensure LangChain, LlamaIndex, and other adapters propagate existing V5
      receipt types and compatibility metadata.

**Exit condition:** Supported runtimes and adapters can mount, query, verify,
and explain the same V5 artifact with no hidden service dependency.

## Phase 5 — Interoperability and trust hardening

**Priority:** P0

**Depends on:** Phases 0–4

**Status:** Complete locally; hosted CI, publication verification, and the
written V5-to-V6 handoff remain in the completion gate.

The frozen V5 vector, receipt, and trust boundary is documented in
[`V5_INTEROPERABILITY.md`](V5_INTEROPERABILITY.md). TypeScript, Rust, and
Python tests cover the shared image and roots; adapter tests preserve those
roots as framework metadata; migration, corruption, truncation, bounds,
replay, expiry, crash-recovery, and cross-runtime cases are in the release
checks.

- [x] Freeze the external V5 JSON and canonical CBOR receipt shapes and their
      verification rules.
- [x] Add TypeScript, Rust, and Python receipt and root vectors.
- [x] Add adapter-level receipt propagation tests.
- [x] Publish or prepare a reproducible public/partner TrustBench corpus and
      record the baseline methodology.
- [x] Add crash, corruption, migration, truncation, bounds, replay, and
      cross-runtime compatibility cases to CI.
- [x] Add documentation for limits, threat boundaries, migration, examples,
      package behavior, and claims that V5 does and does not make.

**Exit condition:** A receipt can be checked using the declared image and key
material, and all supported runtimes agree on the expected roots.

## V5 completion gate before V6

Do not begin CESR implementation until every item below is checked:

- [x] All public roadmap items above have an implementation, owner, tests, and
      documentation evidence.
- [x] V4 compatibility and all current V5 checks remain green.
- [x] `npm run format:check` passes or its exception policy is enforced in CI.
- [x] TypeScript, Rust, Python, CLI, WASM, and adapter compatibility evidence is
      published with the release record.
- [x] A new user can create, inspect, query, migrate, verify, synchronize, and
      receive a deterministic receipt from a V5 image.
- [x] Studio, transport, synchronization, and host-agent boundaries are
      explicit and tested.
- [x] The V5 release surface is frozen and no V6 CESR code is mixed into it.
- [x] The team records a written V5-to-V6 handoff decision against the uploaded
      CESR specification.

## Explicitly deferred until V6

The following are not part of the pre-V6 V5 work plan:

- CESR evidence atoms, relations, applicability policies, and obligation plans;
- candidate challenge closure as a certified-evidence feature;
- fixed-point sparse QP compilation and solver adapters;
- primal/dual witnesses, independent certificate verification, and membership
  bounds;
- Supported/Refuted/Contested/Conditional/Unknown CESR decisions;
- V6 KIPs 0030–0037, V6 conformance fixtures, V6 TrustBench metrics, and
  `knolo v6` commands.

These remain the next major-version work after the V5 completion gate. The V6
specification reuses the V5 container and lexical retrieval foundation, so
finishing the compatibility and trust work above directly reduces V6 risk.
