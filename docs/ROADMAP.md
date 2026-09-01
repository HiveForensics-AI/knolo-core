# Knolo roadmap

This roadmap describes the staged path from the V4 retrieval ecosystem to the
full V5 verifiable knowledge runtime. The `5.0.0` release is the bounded V5
foundation; V4 remains supported and the pre-V6 V5 contract work is now
complete locally.

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

## Completed V5 release hardening

- Keep V4 APIs, fixtures, TrustBench behavior, and compatibility profiles
  unchanged.
- Run `npm run release:check` before publishing. This checks package artifacts,
  public exports, runtime separation, CLI registration, and KIP coverage.
- Run workspace tests, TrustBench, and Rust conformance in CI.
- Resolve the existing repository-wide Prettier baseline or isolate the legacy
  formatting debt without rewriting unrelated files.
- Publish the foundation branch only after the working tree contains the
  release gate, specifications, fixtures, and documentation.

The release gate, formatting baseline, documentation audit, publication-source
checks, and clean V5 smoke are now implemented and passing locally. The
configured GitHub workflow remains the hosted confirmation point.

## Active pre-V6 development plan

The pre-V6 V5 work and completion gate are tracked in the
[V5 pre-V6 development plan](V5_PRE_V6_DEVELOPMENT_PLAN.md). Phases 1 and 2
are complete locally, including the read-only Node Studio service, native root
parity, shared diagnostics/management fixtures, and host-owned transport
adapters. Phases 3–5 are now complete locally as well, including durable writer
leases, explicit authorization gates, production sync application, the Python
and adapter V5 profiles, frozen interoperability evidence, and the written
V5-to-V6 handoff. The remaining items are external release-gate activities:
hosted CI confirmation, publication verification, and release-operator sign-off.

The V6 CESR specification is deliberately deferred until these phases and the
V5 completion gate are finished.

## Next implementation wave

1. Run the configured hosted V5 release workflow and record its result.
2. Verify publication artifacts and record the V5 release/operator sign-off.
3. After the gate closes, create the separate V6 implementation workstream.

## Later V5 capabilities

- Durable writer leases, authorized operations, and production sync
  orchestration are complete locally; see
  [`V5_COORDINATION.md`](V5_COORDINATION.md).
- More complete agent-host integrations for model providers and external tools
  remain host-owned extensions, not a V5 core requirement.

## Scope boundary

The V5 foundation is a verifiable runtime substrate, not a hosted service. The
core owns bytes, roots, validation, deterministic planning, and bounded state;
hosts own networking, credentials, model inference, external side effects,
deployment, and UI presentation.
