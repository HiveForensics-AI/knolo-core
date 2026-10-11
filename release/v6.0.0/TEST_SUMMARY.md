# Test summary

Package commit `172fcf79a477db35cbe296b70a001ccf774652b4` passed the full suite on Node 20.20.2 (npm 10.8.2) and Node 22.14.0 (npm 10.9.2), Linux x86_64. Logs from that run are local and are not part of the repository.

The commit that adds this directory changes documentation and release records only. The same suite is run again on that commit before `v6.0.0` is tagged. If that rerun changes any file, the tag is not created.

## Suite

| Step | Node 20 | Node 22 |
| --- | --- | --- |
| `@knolo/core` | 215 pass, 0 fail | 215 pass, 0 fail |
| `@knolo/cli` | 56 pass, 0 fail, 1 skipped | 56 pass, 0 fail, 1 skipped |
| KAR research unit | 16 pass | 16 pass |
| KAR research integration | 5 pass | 5 pass |
| KAR research Rust | pass | pass |
| `knolo-core-rust` | 24 pass | 24 pass |
| `@knolo/langchain` | 2 pass | 2 pass |
| `@knolo/llamaindex` | 2 pass | 2 pass |
| `@knolo/semantic-ollama` | 6 pass | 6 pass |
| `@knolo/reflex` | 42 pass | 42 pass |
| `@knolo/evidence-gate` | 9 pass | 9 pass |
| `create-knolo-app` | 1 pass | 1 pass |
| public conformance | 12 vectors | 12 vectors |
| documentation links | pass | pass |
| release metadata | pass | pass |
| `examples/kar-v6` | pass | pass |

The skipped CLI test is `optional live Hub read path smoke`. It is not a V6 failure.

## KAR and CEG

| Gate | Requirement | Result |
| --- | --- | --- |
| Differential | 50,000 graphs, seed 20261011 | 0 mismatches |
| Exact cover | 10,000 exhaustive graphs, seed 20261010 | 0 mismatches |
| Tamper | 10,000 mutations, seed 20261012 | 0 accepted |
| CEG reorder | 10,000 | 0 semantic mismatches |
| CEG reference compiler | 10,000 | 0 mismatches |
| Malformed CEG | 25,000 | fail closed, 0 crashes |
| Producer repeats and reorderings | 10,000 + 10,000 | 0 nondeterministic outputs |
| Rule order | 10,000 | one canonical source |
| Merge order and ontology mappings | 10,000 + 10,000 | 0 crashes |
| Malformed packs and producer outputs | 25,000 + 25,000 | fail closed, 0 crashes |

## Packed-tarball smokes

Run on Node 20 against tarballs packed from `172fcf79`.

| Smoke | Result |
| --- | --- |
| Install `@knolo/core` and `@knolo/cli` | pass |
| Lexical query and V5 image query | pass |
| CEG compile, dossier, verify | pass |
| Upgrade `5.5.1` tarball to `6.0.0` tarball | pass |
| Experimental import and `@knolo/core/kar` | same `karRoot` |
| Dossier tamper of root, evidence, sentence, plan, and graph | rejected |
| `examples/kar-v6` from the install | pass |
| Browser bundle, evaluate, dossier object | pass |

`@knolo/core` tarball: 285 files, packed 238229 bytes, unpacked 1104024 bytes, SHA-256 `8e990b2ff73da0ba077d256957669013c87c48297079675bf9ef5e0e963863ae`, npm shasum `95657ee537a5d6e335c69069f8863401dec5a2c1`.
