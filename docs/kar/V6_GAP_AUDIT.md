# V6 gap audit

Audit date: 2026-10-11. Branch `feat/v6-kar-semantic-producers` at `8b58b83`, package line `5.5.1`, plus uncommitted Phase 10–12C research. This file records that inspection. It does not replace the release-readiness matrix.

The frozen contracts found in the tree were `kar-1-research-1` and `ceg-source-1`. No `kar-1-research-2` or `ceg-source-2` was present. `research/kar-1` was intact as the semantic oracle.

## Classification

| Item | State at audit | Notes |
| --- | --- | --- |
| KAR runtime (`createKarSession`, `evaluateKar`, frontiers, minimum-cover, abstention) | COMPLETE | Lived at `@knolo/core/experimental/kar`. Semantics matched the oracle. Not on the root entry |
| Status set | COMPLETE | `SATISFIED`, `UNSATISFIED_EVIDENCE_REQUIREMENTS`, `SEARCH_BOUND_EXCEEDED`, `CLOSURE_BOUND_EXCEEDED`, `ANCHOR_REJECTED`, `PLAN_INVALID`, `GRAPH_NOT_BOUND`, `GRAPH_INVALID` |
| Stable KAR codes | COMPLETE | `karStatusCode` already mapped the non-decision statuses |
| CEG compiler | COMPLETE | `compileCegSource` was the only sidecar writer. Source stayed separate from the sidecar |
| CEG stable codes | COMPLETE | `CEG_EVIDENCE_NOT_FOUND`, `CEG_EVIDENCE_AMBIGUOUS`, `CEG_INVALID_RELATION`, `CEG_INVALID_VALIDITY`, `CEG_STALE_IMAGE`, `CEG_PARSE`, `CEG_UNKNOWN_FIELD` |
| Evidence Dossier | COMPLETE | `kar-evidence-dossier-1`, the five frontiers, status sentences, fail-closed verify |
| Verification | COMPLETE | Recomputes the certificate. Tamper of a root or of dossier language fails |
| CLI evaluate / verify / explain / inspect / graph / produce / domain / package / dossier | COMPLETE | Help existed. Verify failures were non-zero. Abstention stayed exit 0 |
| Domain Pack v4 framework | COMPLETE | contracts, policy, and operations v4 roots frozen. `AUTO_ACCEPT` / `NEEDS_REVIEW` / `OBSERVATION_ONLY` present. Relation-producing `AUTO_ACCEPT` count is 0 |
| Human gold | BLOCKED | Phase 12, 12B, and 12C are `HUMAN_REVIEW_REQUIRED`. This blocks a validated-pack claim. It does not block the runtime |
| Public `@knolo/core/kar` | MISSING | Only the experimental subpath was a supported import |
| `@knolo/core/kar/authoring` | MISSING | Authoring was experimental only |
| Experimental compatibility | COMPLETE | The experimental entry was the implementation. It had to stay |
| `validateCegSource` | MISSING | Parse and interpret existed. A single validate function did not |
| CLI `demo` and `conformance` | MISSING | No one-command product demo and no public vector runner |
| `knolo --version` core resolution | NEEDS_HARDENING | CLI version existed. It did not report the resolved core package |
| `examples/kar-v6` | MISSING | Research and `examples/kar-ceg` existed. No three-domain product showcase with contradiction, qualification, and abstention |
| `conformance/kar/v1` | MISSING | Research fixtures are the oracle. They are not a small public V5 vector set |
| Domain Pack maturity label | MISSING | Roots were frozen. A maturity field inside `domain.yaml` would be `CEG_UNKNOWN_FIELD` |
| Product docs (quickstart, migration, security, browser, dossiers) | NEEDS_HARDENING | `docs/kar` documented the experimental phase and pointed at research reports |
| Release notes `docs/releases/v6.0.0.md` | MISSING | `docs/RELEASE.md` is the V5.5.0 guide |
| Package version 6.0.0-rc.1 | MISSING | npm packages were `5.5.1`. `scripts/check-release-metadata.mjs` still expected `5.5.0` |
| Adapter ranges | NEEDS_HARDENING | `@knolo/cli`, langchain, llamaindex, semantic-ollama, and create-knolo-app depended on `^5.5.0`. reflex and evidence-gate pinned `5.5.0` |
| Rust and Python ports | COMPLETE | `5.5.0`. They do not implement KAR. Leave them |
| Browser isolation | NEEDS_HARDENING | Root and experimental KAR avoided Node builtins. The public subpath did not exist yet, so it was not checked |
| Schema files | COMPLETE | sidecar, plan, result, source, domain, distribution, and dossier schemas were published |
| Schema tests | MISSING | No test locked schema acceptance to runtime acceptance |
| YAML dangerous keys | NEEDS_HARDENING | JSON import rejected `__proto__` path segments. The YAML subset did not reject those keys before this release |
| Distribution unknown fields | NEEDS_HARDENING | Schema said `additionalProperties: false`. The loader ignored unknown manifest fields |
| CLI input size | NEEDS_HARDENING | File reads were unbounded |
| Hub redesign | BLOCKED | Out of scope. Hub already stores V5 images. Labels had to be documentation and catalog metadata |
| Tree published in the npm tarball | COMPLETE | `@knolo/core` `files` is `dist` only. Research corpora are not in that list |
| Normal Knolo regression at the previous gate | COMPLETE | The 2026-10-11 gate recorded 0 failures. It is not fresh proof for this tree |

## Not reimplemented

The audit did not replace the evaluator, the compiler, the dossier renderer, the producer policy classes, or the frozen v1–v4 packs. Product work adds a public facade, examples, vectors, docs, and the hardening rows above.

## Still blocked after productization

Human semantic-production validation remains `HUMAN_REVIEW_REQUIRED`. Domain Pack automatic extraction stays `review-required`. That is a release limitation, not a KAR semantics defect.
