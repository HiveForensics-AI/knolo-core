# Knolo documentation

This directory contains the implementation direction and source architecture
materials for Knolo.

## Start here

- [V5 roadmap](ROADMAP.md) — delivered foundation, release hardening, and the
  next implementation waves.
- [V5 pre-V6 development plan](V5_PRE_V6_DEVELOPMENT_PLAN.md) — active
  dependency-ordered work plan and completion gates.
- [Release guide](RELEASE.md) — preflight checks and publication commands for
  npm and crates.io, plus legacy runtime boundaries.
- [V5 host deployment boundary](V5_HOST_DEPLOYMENT.md) — adapter ownership,
  deployment sequence, retry behavior, and monitoring boundaries.
- [V5 coordination boundary](V5_COORDINATION.md) — durable writer leases,
  stale recovery, authorization gates, and production sync application.
- [V5 interoperability boundary](V5_INTEROPERABILITY.md) — frozen vectors,
  receipt/root rules, runtime compatibility, and trust limits.
- [V5-to-V6 handoff](V5_TO_V6_HANDOFF.md) — reviewed V6 scope, do-not-cross
  rules, and remaining release gates.
- [V5.1.0 release record](V5_1_0_RELEASE_RECORD.md) — candidate contents,
  local evidence, and the external publication checklist.
- [V5.2 Hub CLI release record](V5_2_0_HUB_CLI_RELEASE_RECORD.md) — local Hub
  read-path implementation, smoke commands, evidence, and remaining release
  decision.
- [V5 specification index](../spec/README.md) — KIP byte, root, runtime, and
  management contracts.
- [V5 conformance fixtures](../conformance/v5/README.md) — shared binary
  fixtures consumed by TypeScript and Rust.
- [V4 conformance fixtures](../conformance/README.md) — retrieval and TrustBench
  compatibility baseline.

The reviewed architecture source is kept locally as
`Knolo_V5_Verifiable_Knowledge_Runtime_Architecture.docx`. It is an input
artifact rather than a generated build output; the repository’s normative
implementation contracts are the KIPs under `../spec/`.

## Current release boundary

The current release is the V5 foundation: deterministic Knowledge Images,
verification, migration, bounded runtime features, diagnostics, and a
read-only Studio management snapshot. V4 retrieval APIs remain compatible.
Networking, credentials, model execution, external side effects, and UI
presentation remain host responsibilities.
