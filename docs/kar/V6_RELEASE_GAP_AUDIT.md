# V6 release gap audit

Date: 2026-10-11. Inspected tree: `feat/v6-kar-semantic-producers`. Packages that ship KAR are already `6.0.0-rc.1`. This audit does not replace [V6_RELEASE_READINESS.md](V6_RELEASE_READINESS.md). The earlier pre-productization notes stay in [V6_GAP_AUDIT.md](V6_GAP_AUDIT.md).

Phase 13 did not redesign KAR. Frozen contracts remain `kar-1-research-1` and `ceg-source-1`.

| Item | Status | What is in the tree |
| --- | --- | --- |
| KAR public API | PASS | `@knolo/core/kar` exports `createKarSession`, `evaluateKar`, `verifyKar`, `explainKarResult`, and `createKarDossier`. The root `@knolo/core` entry does not export KAR |
| CEG API | PASS | `@knolo/core/kar/authoring` exports `createCegSource`, `compileCegSource`, `validateCegSource`, `lintCegSource`, and `diffCegGraphs`. It re-exports the existing compiler |
| Package exports | PASS | `exports` maps `./kar`, `./kar/authoring`, `./experimental/kar`, and `./experimental/kar/authoring`, each with browser, react-native, import, and types. `sideEffects` is false. `files` is `dist` |
| Browser exports | PASS | esbuild 0.28.2 bundled the root, KAR, and authoring entries with `platform=browser` and found no Node builtin imports |
| Node exports | PASS | `@knolo/core/node` remains the filesystem entry. KAR session, evaluation, verification, and CEG compilation do not import `node:fs` |
| CLI | PASS | `knolo kar` covers evaluate, verify, explain, inspect, graph, produce, domain, package, dossier, demo, and conformance. Abstention exits 0. Verification failure exits non-zero. `--json` is accepted |
| Schemas | PASS | `schemas/experimental/kar` holds the frozen names. The core build copies them to `dist/schemas/kar`. Runtime validators and the schema walker agree in `kar-schema.test.mjs` |
| Evidence Dossier | PASS | Format `kar-evidence-dossier-1`. Sections separate support, opposition, qualification, temporal applicability, authority, the selected set, roots, and verification. Wording is `Evidence requirements satisfied` or `Evidence requirements not satisfied` |
| Verification | PASS | `verifyKar` and `knolo kar dossier verify` recompute the certificate. A flipped `karRoot` and a dossier sentence changed to `Claim proven` fail closed |
| Conformance vectors | PASS | `conformance/kar/v1` has 12 small vectors: support, opposition, qualification, temporal, authority, supplied anchor, abstention, both bounds, anchor rejection, and two tamper cases |
| Rust on those V5 vectors | NEEDS_HARDENING | The research Rust verifier matches `research/kar-1` fixtures. It does not execute the V5 public vectors. That is a documented limit, not a semantic mismatch |
| Domain Packs | PASS | contracts, policy, and operations v4 are packaged with `domain.yaml`, `rules/`, `plans/`, `fixtures/`, and `README.md`. Maturity is `review-required` in `domains/v6-catalog.json`. No v5 pack was created. Customer evidence is not in the packs |
| Examples | PASS | `examples/kar-v6` shows a Knowledge Image, CEG Source, compiled graph, plan, result, dossier, and verification. Contracts keeps support and opposition. Policy keeps a rule and an exception. Operations gap returns `UNSATISFIED_EVIDENCE_REQUIREMENTS` |
| Documentation | PASS | Product docs start at `docs/kar/README.md` and `quickstart.md`. Research reports stay under `docs/kar/research` and the existing phase reports. Quickstart contrasts `query()` with `evaluateKar()` |
| Migration | PASS | [migration-v6.md](migration-v6.md) shows the experimental import and the public import. Experimental modules carry `@deprecated` and stay operational |
| Versioning | PASS | `@knolo/core`, `@knolo/cli`, LangChain, LlamaIndex, semantic-ollama, and create-knolo-app are `6.0.0-rc.1` with core range `>=6.0.0-rc.1 <7`. Reflex stays `0.2.0`. Evidence Gate stays `0.1.0`. Rust and Python stay `5.5.0` |
| Release scripts | PASS | `scripts/check-release-metadata.mjs` expects `6.0.0-rc.1`. `scripts/smoke-v6-rc.sh` installs the packed tarballs. Final `6.0.0` is not cut |
| Security | PASS | Reserved object keys are rejected. Distribution manifests reject unknown fields. CLI reads are size-capped. Rule regex rejects backreferences, lookaround, and nested quantifiers. The regex scan stops on a match cap and does not use `Date.now()`. No archive extractor was added. Closure, cover, and source bounds were not loosened |
| Package contents | PASS | The smoked `@knolo/core` tarball had 285 files, 11 KAR schemas, and no research or corpus paths. Conformance vectors stay in the repository, not in the npm package |
| Hub compatibility | PASS | `examples/kar-v6/hub-labels.json` distinguishes a Knowledge Image, a Domain Pack, and a KAR bundle. Hub was not redesigned and nothing was uploaded |
| Human semantic validation | NEEDS_HARDENING | Pass A, Pass B, and adjudication are absent. `AnnotationGuideRoot` is null. Domain Pack v5 does not exist. Packs stay `review-required`. This does not block the engineering candidate |
| Node 20 execution | NEEDS_HARDENING | CI uses Node 20 and the CLI engine is `>=20`. This machine ran Node v22.14.0. Node 20 is not installed here |

`createKarDossier` takes `{ image, graph, plan, proposition }`. `verifyKar` takes bytes and objects. Those signatures were left as implemented.

No item in this audit is `MISSING` or `BLOCKED`.
