# GitHub release draft

Do not create the GitHub release until publication is authorized. Title: `Knolo 6.0.0`. Target: tag `v6.0.0`.

## Body

Knolo V6 introduces KAR, deterministic evidence-set retrieval over committed knowledge.

KAR evaluates evidence requirements over a committed Knowledge Image, a Committed Evidence Graph, and a plan. It returns a minimum sufficient typed evidence set and an Evidence Dossier. Verification recomputes that certificate. `SATISFIED` means the evidence requirements were satisfied. `UNSATISFIED_EVIDENCE_REQUIREMENTS` means they were not. Neither sentence says a claim is proven or false.

### Installation

```bash
npm install @knolo/core
```

The public entries are `@knolo/core/kar` and `@knolo/core/kar/authoring`. `@knolo/core/experimental/kar` remains a deprecated compatibility re-export for this major version.

### Migration

Projects on `5.5.1` keep build, mount, and query behavior. Move a KAR import from `@knolo/core/experimental/kar` to `@knolo/core/kar` when ready. Both imports evaluate the same committed inputs to the same `karRoot`. See `docs/kar/migration-v6.md`.

### What shipped

- KAR runtime, CEG compiler, and CEG authoring are supported.
- Evidence Dossiers and deterministic verification are supported.
- CLI, browser bundles of the library entries, and `create-knolo-app` templates target `6.0.0`.
- `@knolo/reflex` stays `0.2.0`. `@knolo/evidence-gate` stays `0.1.0`. Rust and Python stay on the 5.5.0 line and do not implement V6 KAR.

### Domain Packs

Initial V6 Domain Packs assist semantic production but require review before committing semantics. contracts v4, policy v4, and operations v4 remain `review-required`. KAR itself evaluates an already committed CEG deterministically and does not depend on automatic semantic extraction. Relation-producing automatic extraction is not human-validated.

### Compatibility and limits

Node 20 is the CI and CLI engine line. Node 22 also passed the suite. `SEARCH_BOUND_EXCEEDED` and `CLOSURE_BOUND_EXCEEDED` remain hard stops. There is no approximate cover. Long pathological chains can be expensive.

This release does not claim automatic contract understanding, validated autonomous legal reasoning, truth verification, complete contradiction detection, complete evidence discovery, or all-domain semantic extraction.
