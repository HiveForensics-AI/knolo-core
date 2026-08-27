# Knolo documentation

This directory contains the implementation direction and source architecture
materials for Knolo.

## Start here

- [V5 roadmap](ROADMAP.md) — delivered foundation, release hardening, and the
  next implementation waves.
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
