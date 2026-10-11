# V6 release readiness

Date: 2026-10-11. Candidate: `6.0.0-rc.1`. This file is the release matrix. The Phase 13 inspection is [V6_RELEASE_GAP_AUDIT.md](V6_RELEASE_GAP_AUDIT.md). The earlier pre-productization notes stay in [V6_GAP_AUDIT.md](V6_GAP_AUDIT.md). Split timings are in [V6_PERFORMANCE.md](V6_PERFORMANCE.md).

Classification: `READY_FOR_V6_RC_WITH_EXPERIMENTAL_DOMAIN_PACKS`.

The KAR/CEG architecture is packaged, documented, tested, secured, migration-ready, and usable whether a Committed Evidence Graph was hand-authored, rule-produced, ontology-produced, or model-assisted. Human Domain Pack validation has not passed. Domain Packs stay `review-required`. This candidate is not `6.0.0` and it has not been published to npm.

## Semantic production validation

Initial Domain Packs are experimental and review-oriented. Phase 12, 12B, and 12C remain `HUMAN_REVIEW_REQUIRED`. Domain pack v5 was not built. KAR itself operates deterministically over the committed graph regardless of how the graph was produced.

`AUTO_ACCEPT`, `NEEDS_REVIEW`, and `OBSERVATION_ONLY` are unchanged. Relation-producing v4 rules are not auto-accepted. Empty `AUTO_ACCEPT` is not a precision of 100 percent.

## Matrix

| Area | Result | Evidence |
| --- | --- | --- |
| KAR runtime | PASS | Phase 13 re-run of `@knolo/core` test after the match-cap change: 215 pass, 0 fail. Includes 50,000 differential cases, seed `20261011`, and 10,000 certificate tampers, seed `20261012` |
| CEG compiler | PASS | Same suite: 10,000 source reorderings, 10,000 reference-compiler comparisons, 25,000 malformed authoring inputs. 0 mismatches, 0 crashes |
| CEG authoring | PASS | Public `@knolo/core/kar/authoring`. Reserved object keys fail closed. Experimental authoring remains |
| Domain Pack framework | PASS | `ceg-domain-1` interpreter, fixture tests, and malformed-pack gate. Maturity stays outside `DomainPackRoot` |
| Domain Packs | PASS_WITH_LIMITATION | contracts, policy, and operations v4 are distributed at `review-required`. They are not `validated` |
| Evidence Dossier | PASS | Dossier language and repeatability covered by the core suite, the public vectors, and the install smoke |
| Verification | PASS | Public vectors reject a flipped `karRoot` and a dossier sentence changed to "Claim proven" |
| CLI | PASS | `@knolo/cli` test after the reserved-key fix: 57 tests, 56 pass, 0 fail, 1 skipped |
| Browser | PASS | esbuild 0.28.2 bundled `@knolo/core`, `@knolo/core/kar`, and authoring for `platform=browser` with no Node builtin imports. `scripts/check-kar-bundle-graph.mjs` passed |
| Node | PASS_WITH_LIMITATION | Executed on Node v22.14.0. CI and the CLI engine are Node `>=20` / `node-version: 20`. Node 20 is not installed on this machine, so that exact CI version was not executed. Node v21.6.1 is installed and was not used for the suite |
| Rust parity | PASS_WITH_LIMITATION | `research/kar-1` `cargo test --offline` matched the research oracle, including `verifier_matches_typescript_vectors`. `packages/core-rust` 24 tests passed. The new public `conformance/kar/v1` vectors are TypeScript over V5 images. Rust did not execute that set |
| Documentation | PASS | Product tree under `docs/kar/`. Research stays in `docs/kar/research/`. `node scripts/check-doc-links.mjs` is the link gate |
| Migration | PASS | `@knolo/core/experimental/kar` remains a compatibility re-export. [migration-v6.md](migration-v6.md) |
| Security | PASS | Focused review in [security.md](security.md). Reserved keys, unknown manifest fields, size caps, and bounds are fail-closed. Rule matching stops on a match cap and does not use a wall clock. No KAR certificate change |
| Package publishing | PASS_WITH_LIMITATION | Local tarball smoke passed. npm publish was not run |
| Hub | PASS_WITH_LIMITATION | `domains/v6-catalog.json` and `examples/kar-v6/hub-labels.json` label images, packs, and KAR bundles. Nothing was uploaded. Hub was not redesigned |
| Human semantic validation | PASS_WITH_LIMITATION | Incomplete. This is an allowed engineering release. It is not `READY_FOR_V6_RC` |

## Phase 13 checklist

| Area | Status |
| --- | --- |
| KAR runtime | PASS |
| CEG compiler | PASS |
| CEG authoring | PASS |
| Verification | PASS |
| Evidence Dossier | PASS |
| Public API | PASS |
| CLI | PASS |
| Browser | PASS |
| Node | PASS_WITH_LIMITATION |
| Rust parity | PASS_WITH_LIMITATION |
| Security | PASS |
| Conformance | PASS |
| Docs | PASS |
| Migration | PASS |
| Examples | PASS |
| Domain Packs | PASS_WITH_LIMITATION |
| Human semantic validation | PASS_WITH_LIMITATION |
| Hub readiness | PASS_WITH_LIMITATION |
| Package smoke test | PASS_WITH_LIMITATION |

Node means the suite ran on Node v22.14.0, not on the CI Node 20 image. Rust parity means the research oracle, not the V5 public vectors. Package smoke passed locally and was not published. Domain Packs and human validation stay `review-required`.

## Commands and results

Run on 2026-10-11 from this tree, Node v22.14.0, unless noted.

| Command | Result |
| --- | --- |
| `npm test` in `packages/core` | Phase 13 re-run: 215 pass, 0 fail. Log `/tmp/knolo-v6-phase13-core.log` |
| Producer gates inside that suite | 10,000 repeats and reorderings; 10,000 rule orders; 10,000 merge orders and ontology mappings; 25,000 malformed packs and outputs. 0 crashes |
| CEG gates inside that suite | 10,000 reorderings, one `SemanticRoot`; 10,000 reference matches; 25,000 malformed inputs fail closed |
| KAR differential | `differential 50000 generated graphs seed 20261011` pass |
| KAR tamper | `randomized certificate tamper seed 20261012`, `TAMPER_COUNT` 10000, pass |
| `npm test` in `research/kar-1` | 16 pass, 0 fail |
| `npm run test:integration` in `research/kar-1` | 5 pass, including minimum-cover versus exhaustive enumeration on 10,000 tiny graphs, seed `20261010` |
| `npm run test:rust` in `research/kar-1` | `integration_fixtures_match_typescript` and `verifier_matches_typescript_vectors` passed |
| `npm run test:rust` at the repo root | `knolo-core-rust` 24 passed |
| `npm test` in `packages/cli` | 57 tests, 56 pass, 0 fail, 1 skipped. Log `/tmp/knolo-v6-cli-test-2.log` |
| Adapter tests before the reserved-key parser fix | langchain 2, llamaindex 2, semantic-ollama 6, reflex 42, evidence-gate 9, all pass. The parser fix rejects only reserved object keys and does not change lexical, BM25, MMR, V5, Reflex, or Evidence Gate behavior |
| `npm test --workspace create-knolo-app` | 1 pass. The scaffold accepts `>=6.0.0-rc.1 <7` and builds `dist/knowledge.knolo` from the packed tarballs |
| `node conformance/kar/v1/run.mjs` | 12 vectors matched, including abstention, both bounds, anchor rejection, and both tamper cases |
| `bash scripts/smoke-v6-rc.sh` | Passed from the packed tarballs. `@knolo/core` `6.0.0-rc.1` shasum `4b82a2889b81f733fe1ec568ccef7bc1e1a3526a`, 285 files. `@knolo/cli` `6.0.0-rc.1` shasum `c915db7d5e816e3634a3bf37bca0f9f5aeb1894f`, 42 files. The installed core tree had 11 schemas and no `research/` or corpus paths |
| esbuild 0.28.2 `--bundle --platform=browser` | Root 451 KB, KAR 150 KB, authoring 260 KB. No `node:` imports |
| Closure bench `npm run bench:integration` in `research/kar-1` | Exit 0. Chain degree 1 closure p50: n=100 0.18 ms, n=1000 3.59 ms, n=10000 178.59 ms, n=50000 16290.93 ms. Local degree 3 depth 4 closure p50 at n=50000: 27.47 ms. Published `scale-results.json` restored to `sha256-77093ffe56710d0055d5863febc5a722a12577608322e284bf5a17f428241981`. Published `cover-results.json` restored to `sha256-d33156d7b8f7113d7604f9cf2f5665f2a9ac583f23c66d64cf2071a7c6e8f33f` |
| `node scripts/check-release-metadata.mjs` | Passed for npm `6.0.0-rc.1`, CLI `6.0.0-rc.1`. Rust and Python stay `5.5.0` |
| `node scripts/check-doc-links.mjs` | Passed for 202 Markdown files |

## Versions prepared

| Package | Version | `@knolo/core` range |
| --- | --- | --- |
| `@knolo/core` | `6.0.0-rc.1` | |
| `@knolo/cli` | `6.0.0-rc.1` | `>=6.0.0-rc.1 <7` |
| `@knolo/langchain` | `6.0.0-rc.1` | `>=6.0.0-rc.1 <7` |
| `@knolo/llamaindex` | `6.0.0-rc.1` | `>=6.0.0-rc.1 <7` |
| `@knolo/semantic-ollama` | `6.0.0-rc.1` | `>=6.0.0-rc.1 <7` |
| `create-knolo-app` | `6.0.0-rc.1` | template uses `>=6.0.0-rc.1 <7` |
| `@knolo/reflex` | `0.2.0` | `>=6.0.0-rc.1 <7` |
| `@knolo/evidence-gate` | `0.1.0` | `>=6.0.0-rc.1 <7` |
| `knolo-core-rust`, ICP canister, Python `knolo` | `5.5.0` | not KAR |

`@knolo/semantic-ollama` engines stay `>=18`. CLI engines stay `>=20`.

## Domain Pack maturity

| Pack | Version | Maturity | DomainPackRoot |
| --- | --- | --- | --- |
| contracts | 4 | review-required | `sha256-1ffea8ded1877f28ce61c9e98bb79644f8bbe237c22baae6984983d92ede39a5` |
| policy | 4 | review-required | `sha256-109ad58943b28a93453205ea86585843931eb69d8a989bcd071e8e48c70eacea` |
| operations | 4 | review-required | `sha256-edde04257c55c480c95ce3db90074238a54ab05ee8c9d25135190f5da70f6da4` |

Maturity is in `domains/v6-catalog.json`. It is not a field of `domain.yaml` and it is not part of `DomainPackRoot`.

## What this candidate does not claim

- npm publish
- final `6.0.0`
- validated automatic semantic extraction
- Rust execution of `conformance/kar/v1`
- a Node 20 run on this machine
- a Hub upload
- that `SATISFIED` means a claim is proven
- that `UNSATISFIED_EVIDENCE_REQUIREMENTS` means a claim is false

Final `6.0.0` waits for this RC smoke, which has passed locally, and for a second full suite on the release commit. Domain Packs stay `review-required` in that final release unless a later human-gold artifact meets the frozen gates. That promotion does not require a new KAR version.
