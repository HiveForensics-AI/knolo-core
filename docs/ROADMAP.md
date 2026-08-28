# Knolo roadmap

This roadmap describes the staged path from the V4 retrieval ecosystem to the
full V5 verifiable knowledge runtime. The `5.0.0` release is the bounded V5
foundation; V4 remains supported while the remaining V5 contracts are
introduced incrementally.

## Delivered: V5 foundation

- Deterministic CBOR and SHA-256 domain-separated roots.
- Verified Knowledge Image container with A/B superblocks, immutable segments,
  commit metadata, bounds, and fail-closed validation.
- Deterministic V1–V4 migration with evidence-preserving identity mappings and
  migration receipts.
- TypeScript and Rust verification/migration fixtures with cross-runtime roots.
- Single-writer image storage with snapshot readers and Node durable storage.
- Read-only EQL, query indexes, query history, policy evaluation, authority
  envelopes, key rotation, sync summaries, fast-forward transfer, merge
  planning/application, signed transport metadata, durable runs, host-controlled
  execution, and replay protection.
- Deterministic runtime diagnostics and the KIP-0026 read-only Studio
  management snapshot.
- CLI inspection surfaces: `knolo v5 info`, `knolo v5 health`, and
  `knolo v5 studio`.

## Current release hardening

- Keep V4 APIs, fixtures, TrustBench behavior, and compatibility profiles
  unchanged.
- Run `npm run release:check` before publishing. This checks package artifacts,
  public exports, runtime separation, CLI registration, and KIP coverage.
- Run workspace tests, TrustBench, and Rust conformance in CI.
- Resolve the existing repository-wide Prettier baseline or isolate the legacy
  formatting debt without rewriting unrelated files.
- Publish the foundation branch only after the working tree contains the
  release gate, specifications, fixtures, and documentation.

## Next implementation wave

1. Build a Studio UI/service that consumes KIP-0026 snapshots and keeps all
   mutations behind explicit host authorization.
2. Add Rust parity for runtime diagnostics and Studio snapshot roots where the
   native runtime needs to serve those views.
3. Add host adapters for durable transport deployment, peer discovery, and
   operational monitoring without putting sockets or credentials in the core.
4. Add release CI jobs for the documentation link audit, formatting policy,
   cross-runtime golden vectors, and package publication checks.

## Later V5 capabilities

- Multi-writer coordination, leases, and stale-writer recovery.
- Authorized Studio mutation workflows for commits, merges, policy, and
  authority administration.
- Production sync orchestration, peer discovery, and resumable deployment.
- More complete agent-host integrations for model providers and external tools.
- Python and additional runtime profiles consuming the V5 contracts.
- WASM and embedded distribution profiles after the byte and root contracts are
  stable.

## Scope boundary

The V5 foundation is a verifiable runtime substrate, not a hosted service. The
core owns bytes, roots, validation, deterministic planning, and bounded state;
hosts own networking, credentials, model inference, external side effects,
deployment, and UI presentation.
