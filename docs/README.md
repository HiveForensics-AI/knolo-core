# Knolo documentation

This directory contains the public implementation direction, release, and
operational guides for Knolo.

## Start here

- [V5 roadmap](ROADMAP.md) — delivered foundation, release hardening, and the
  next implementation waves.
- [Release guide](RELEASE.md) — preflight checks and publication commands for
  npm and crates.io, plus legacy runtime boundaries.
- [V5 host deployment boundary](V5_HOST_DEPLOYMENT.md) — adapter ownership,
  deployment sequence, retry behavior, and monitoring boundaries.
- [V5 coordination boundary](V5_COORDINATION.md) — durable writer leases,
  stale recovery, authorization gates, and production sync application.
- [V5 interoperability boundary](V5_INTEROPERABILITY.md) — frozen vectors,
  receipt/root rules, runtime compatibility, and trust limits.
- [V5 specification index](../spec/README.md) — KIP byte, root, runtime, and
  management contracts.
- [V5 conformance fixtures](../conformance/v5/README.md) — shared binary
  fixtures consumed by TypeScript and Rust.
- [V4 conformance fixtures](../conformance/README.md) — retrieval and TrustBench
  compatibility baseline.

Architecture sources, future-version specifications, and internal planning
records are kept local and are not part of the public repository. The
normative implementation contracts are the KIPs under `../spec/`.

## Current release boundary

The current release is the V5 foundation: deterministic Knowledge Images,
verification, migration, bounded runtime features, diagnostics, and a
read-only Studio management snapshot. V4 retrieval APIs remain compatible.
Networking, credentials, model execution, external side effects, and UI
presentation remain host responsibilities.
