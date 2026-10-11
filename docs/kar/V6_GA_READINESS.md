# V6 GA readiness

Classification: `READY_TO_PUBLISH_V6_GA`

This classification is for the KAR runtime, the CEG compiler, CEG authoring, Evidence Dossiers, and verification. It is not a claim that Domain Pack extraction has been human-validated. npm publish has not been run. The `v6.0.0` tag is applied only after the Node 20 and Node 22 suites pass on the commit that contains this file.

Package versions and ranges were committed in `172fcf79a477db35cbe296b70a001ccf774652b4` (`chore: release Knolo 6.0.0`, tree `5cedd82e7a2795375cf4740236c750c6bc9f477b`). That commit is the parent of this documentation. Its diff against the release candidate `39dd07e4d714760c739cd1d185b34a6c5ba0482c` is versions, dependency ranges, release notes, and the checks that assert those strings. It does not change the research oracle, KAR semantics, CEG semantics, or the restricted corpus.

## Matrix

| Area | Result | Note |
| --- | --- | --- |
| KAR runtime | PASS | `kar-1-research-1` unchanged |
| CEG compiler | PASS | `ceg-source-1` unchanged |
| CEG authoring | PASS | Public authoring entry unchanged |
| Evidence Dossier | PASS | Sentences stay requirement language |
| verification | PASS | Tamper fails closed |
| public API | PASS | `@knolo/core/kar` and `@knolo/core/kar/authoring` |
| CLI | PASS_WITH_LIMITATION | Suite passed. `knolo kar conformance` and `knolo kar demo` still need a repository checkout |
| Node 20 | PASS | v20.20.2, npm 10.8.2, Linux x86_64, on `172fcf79`. Re-run on this commit before the tag |
| Node 22 | PASS | v22.14.0, npm 10.9.2, Linux x86_64, on `172fcf79`. Re-run on this commit before the tag |
| browser | PASS | esbuild browser bundles of the packed tarball evaluated a dossier |
| Rust oracle parity | PASS_WITH_LIMITATION | Research fixtures match. Public V5 conformance vectors stay TypeScript |
| conformance | PASS | `conformance/kar/v1`, 12 vectors |
| security | PASS | Phase 13 guards unchanged by the version diff. npm audit reports 0 vulnerabilities |
| migration | PASS | Experimental and stable imports returned the same `karRoot` from the packed tarball |
| upgrade | PASS | Real `5.5.1` tarball, then the packed `6.0.0` tarball |
| package tarballs | PASS | Hashes in [v6.0.0-artifacts.json](../releases/v6.0.0-artifacts.json) |
| examples | PASS | `examples/kar-v6` from the packed tarball |
| documentation | PASS | Internal link check is part of the suite |
| Domain Packs | PASS_WITH_LIMITATION | `review-required`. contracts v4, policy v4, operations v4 |
| human semantic validation | PASS_WITH_LIMITATION | Pending. This does not block GA |
| Hub readiness | PASS_WITH_LIMITATION | Labels are prepared. Upload is not part of this release and does not block npm |

## Gates on 172fcf79

Both Node suites exited 0. Counts were the same on Node 20 and Node 22.

| Step | Result |
| --- | --- |
| `@knolo/core` | 215 pass, 0 fail |
| `@knolo/cli` | 56 pass, 0 fail, 1 skipped (`optional live Hub read path smoke`) |
| `research/kar-1` unit | 16 pass |
| `research/kar-1` integration | 5 pass, including 10,000 exact-cover comparisons, seed `20261010` |
| `research/kar-1` Rust | pass, research-vector parity |
| `knolo-core-rust` | 24 pass |
| `@knolo/langchain` | 2 pass |
| `@knolo/llamaindex` | 2 pass |
| `@knolo/semantic-ollama` | 6 pass |
| `@knolo/reflex` | 42 pass |
| `@knolo/evidence-gate` | 9 pass |
| `create-knolo-app` | 1 pass |
| `node conformance/kar/v1/run.mjs` | 12 vectors matched |
| documentation links | pass |
| release metadata | pass for `6.0.0` |
| `examples/kar-v6` | pass |

KAR differential: 50,000 generated graphs, seed `20261011`, 0 mismatches. The comparison is the canonical certificate: status, evidence IDs, choices, frontiers, witnesses, decision, and committed roots, against the frozen research oracle.

Exact cover: 10,000 exhaustive comparisons, seed `20261010`, 0 mismatches.

Tamper: 10,000 mutated certificates, seed `20261012`, 0 accepted.

CEG compiler: 10,000 source reorderings, one `SemanticRoot`; 10,000 reference-compiler comparisons; 25,000 malformed authoring inputs. 0 mismatches, 0 crashes.

Producer safety: 10,000 repeats, 10,000 reorderings, 10,000 rule orders, 10,000 merge orders, 10,000 ontology mappings, 25,000 malformed packs, 25,000 malformed producer outputs. 0 nondeterministic committed outputs, 0 crashes.

`spec/KAR-1.md` remains `sha256-a38f3c5e6098b88d13bd3595dce5c368bb46ace6159337858c18726b58504d66`. `research/kar-1/fixtures/expected.json` remains `sha256-154215068cfc8ec50c0d973d2608afa74e237c04171081392d54569c47a3c9cf`.

## Install, upgrade, and browser

Node 20.20.2. The install smoke used the packed `@knolo/core@6.0.0` and `@knolo/cli@6.0.0` tarballs: lexical query, V5 image query, CEG compile, dossier build, dossier verify, and `knolo --version` printing `6.0.0`.

The upgrade smoke built `@knolo/core@5.5.1` from commit `5111fc6`, packed it, and installed that tarball. `buildPack`, `mountPack`, and the V5 image query succeeded, and `stateRoot` stayed distinct from `commitDigest`. Replacing the install with `knolo-core-6.0.0.tgz` kept that behavior. `@knolo/core/experimental/kar` and `@knolo/core/kar` returned `karRoot` `sha256-542547026de3cffc1b1565aa90c8b1aa582f3460714a6b4b3189b3a0d3b226c7`.

Independent dossier tamper rejected:

| Change | Code |
| --- | --- |
| `karRoot` | `KAR_RESULT_MISMATCH` |
| selected evidence | `KAR_RESULT_MISMATCH` |
| status sentence changed to `Claim proven` | `KAR_RESULT_MISMATCH` |
| plan depth | `KAR_RESULT_MISMATCH` |
| graph node id | `KAR_GRAPH_INVALID` |

`examples/kar-v6/run.mjs` against that install printed support plus opposition, rule plus exception, `SATISFIED`, and `UNSATISFIED_EVIDENCE_REQUIREMENTS`.

Browser bundles of the installed `dist` (`esbuild` 0.28.2, `--platform=browser`) were 444.6 KB, 148.9 KB, and 257.9 KB. They contain no `node:fs`, `node:path`, `node:crypto`, `fs/promises`, `node:os`, or `node:module`. The bundled entry points created a dossier with format `kar-evidence-dossier-1` and status `SATISFIED`.

## Performance

Measured on `172fcf79` with Node 20.20.2. These are separate measurements. The 50,000-node chain is a pathological closure case. It is not a public warm-evaluation number. Frozen files were restored after the rerun: `scale-results.json` `sha256-77093ffe56710d0055d5863febc5a722a12577608322e284bf5a17f428241981`, `cover-results.json` `sha256-d33156d7b8f7113d7604f9cf2f5665f2a9ac583f23c66d64cf2071a7c6e8f33f`, `docs/kar/ceg-benchmarks.json` `sha256-3e5d1d10726f39be2575b1bf7619e2a7132d645a611d8fa3911e6bb107c6c11b`.

Public surface, 30 repetitions, 3 concepts, 2 relations, status `SATISFIED`:

| Step | Milliseconds |
| --- | --- |
| CEG compile | 1.434 |
| session creation | 0.637 |
| warm evaluation | 0.238 |
| cold verification | 1.207 |

Closure and exact-cover step, p50 milliseconds, chain of degree 1:

| Nodes | Closure | Exact-cover step |
| --- | --- | --- |
| 100 | 0.174 | 0.082 |
| 1,000 | 3.457 | 0.098 |
| 10,000 | 207.981 | 0.118 |
| 50,000 | 19687.756 | 0.146 |

Same steps, local degree 3 and depth 4:

| Nodes | Closure | Exact-cover step |
| --- | --- | --- |
| 100 | 0.075 | 0.085 |
| 1,000 | 0.505 | 0.063 |
| 10,000 | 4.523 | 0.069 |
| 50,000 | 47.750 | 0.115 |

Exact-cover benchmark rerun: 470 cells, 20 `SEARCH_BOUND_EXCEEDED` cells where the visit bound is hit, median cell 0.364 ms, maximum cell 21.225 ms. Those bound results are the bounded algorithm stopping. They are not mismatches.

CEG compilation rerun, compile milliseconds: 100 nodes 27.324, 1,000 nodes 92.251, 10,000 nodes 808.643, 50,000 nodes 4276.868, 100,000 nodes 8745.385.

## Security and dependencies

`npm audit` on the workspace: info 0, low 0, moderate 0, high 0, critical 0. Nothing to classify as `BLOCKING`, `NON_BLOCKING`, `DEV_ONLY`, or `FALSE_POSITIVE`. No dependency was upgraded for this release.

The version diff does not touch reserved-key rejection, path handling, manifest validation, unknown fields, source caps, regex safety, graph bounds, cover bounds, closure bounds, or proposal limits. `regexIsSafe` still rejects `(a+)+`, `(.*)+`, `(?=a)`, `(?!a)`, and `\1`. `maxCoverVisits` `0` still returns `SEARCH_BOUND_EXCEEDED`. There is no approximate cover.

## Domain Packs

`domains/v6-catalog.json` stays `review-required` for contracts v4, policy v4, and operations v4. No human-gold artifact was supplied. Pack roots stay:

- contracts `sha256-1ffea8ded1877f28ce61c9e98bb79644f8bbe237c22baae6984983d92ede39a5`
- policy `sha256-109ad58943b28a93453205ea86585843931eb69d8a989bcd071e8e48c70eacea`
- operations `sha256-edde04257c55c480c95ce3db90074238a54ab05ee8c9d25135190f5da70f6da4`

## After GA

Do not start KAR-2 from this release. Next work is human Domain Pack validation, promoting a pack only when that pack passes the frozen gates, Hub distribution, adoption, local examples, and external conformance implementations. Validated successors can be `contracts-v5`, `policy-v5`, and `operations-v5` without changing KAR-1 and without requiring Knolo 7.

Publication steps, the tag, rollback, and the post-publish smoke are in [release/v6.0.0](../../release/v6.0.0/README.md).
