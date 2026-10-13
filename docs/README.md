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
- [VQF-1 benchmarks](VQF1_BENCHMARKS.md) — reproducible ordinary and opt-in
  physical-compression measurements.
- [VQF-1 implementation status](VQF1_IMPLEMENTATION.md) — internal codecs,
  source spans, VQF envelope semantics, limits, and validation commands.
- [VQF-1 format freeze boundary](VQF1_FORMAT_FREEZE.md) — portable
  object/event envelope rules and the TypeScript-only encoder boundary.
- [VQF-1 lexical status](VQF1_LEXICAL_STATUS.md) — why lexical postings remain
  a TypeScript runtime artifact.
- [VQF-1 next phases](VQF1_NEXT_PHASES.md) — decoder parity, hardening, and
  release handoff.
- [Reflex 0.2 empirical intelligence plan](REFLEX_0.2_PLAN.md) — provenance,
  clustering, capability calibration, MRS frontiers, and benchmark gates.
- [Evidence Gate implementation plan](EVIDENCE_GATE_IMPLEMENTATION_PLAN.md) —
  claim-level evidence decisions, certificates, verification, and the first
  product pilot.
- [Knolo for OpenClaw implementation plan](OPENCLAW_IMPLEMENTATION_PLAN.md) —
  read-only V5 plugin scope, tool and audit contracts, delivery phases, and
  later grounding and memory modes.
- [`@knolo/openclaw`](../packages/openclaw/README.md) — local V5 mounts,
  policy-aware retrieval, query records, and the native OpenClaw tool plugin.
- [`@knolo/evidence-gate`](../packages/evidence-gate/README.md) — the current
  TypeScript vertical slice for deterministic claim-level verification.
- [KAR](kar/README.md) — minimum evidence-set retrieval over a Committed
  Evidence Graph. Import it from `@knolo/core/kar`. The root `@knolo/core`
  entry does not load it.
- [Composition](composition/README.md) — offline citations and attestations.
  Import it from `@knolo/core/composition`. It does not change KAR or V5 roots.

Architecture sources, future-version specifications, and internal planning
records are kept local and are not part of the public repository. The
normative implementation contracts are the KIPs under `../spec/`.

## Current release boundary

The current product line in this repository is Knolo 6.1.0. V6 adds KAR on
the V5 Knowledge Image: deterministic images, verification, migration,
bounded runtime features, diagnostics, and a read-only Studio management
snapshot remain. 6.1.0 adds offline composition and attestation.
`@knolo/cli` depends on `@knolo/core` `^6.1.0`. The other packages that
depend on `@knolo/core` stay at `^6.0.0`. V4 retrieval APIs remain compatible.
Rust, Python, and ICP stay 5.5.1 and do not implement KAR or composition.
Bundled Domain Packs are `review-required`. Networking,
credentials, model execution, external side effects, and UI presentation
remain host responsibilities.
