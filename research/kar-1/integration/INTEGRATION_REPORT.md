# KAR-1 integration pilot

## Environment

Repository HEAD: `5111fc65f61073ee39cbe4923dc36dec760db5ed`

`spec/KAR-1.md` and `research/kar-1/` are additions on that commit. This pilot does not change `packages/*`.

- Node v22.14.0
- rustc 1.98.1 (48a229cea 2026-09-01)
- cargo 1.98.1 (797e8a9bc 2026-08-05)

Commands, from `research/kar-1` unless noted:

```bash
npm test
npm run bench
cargo test --manifest-path rust/Cargo.toml --offline
npm run test:integration
node --expose-gc integration/bench/scale.mjs
node integration/bench/cover.mjs
```

From the repository root:

```bash
npm test
cargo test --manifest-path packages/core-rust/Cargo.toml --offline
```

`npm test` inside `research/kar-1` uses the repository TypeScript binary at `../../node_modules/typescript`. The research package is not an npm workspace.

## Frozen semantics

Semantics version `kar-1-research-1` was not changed.

| Artifact | SHA-256 |
| --- | --- |
| `spec/KAR-1.md` | `a38f3c5e6098b88d13bd3595dce5c368bb46ace6159337858c18726b58504d66` |
| `research/kar-1/fixtures/expected.json` | `154215068cfc8ec50c0d973d2608afa74e237c04171081392d54569c47a3c9cf` |

Both hashes were checked before integration and again after the integration suite and the Rust parity run. The frozen TypeScript suite passed (16 tests). The frozen Rust verifier matched all 16 vectors. The hand-authored benchmark in `research/kar-1/bench/REPORT.md` passed.

`closeFrontiers` now also returns how many traversable edges it examined. That counter is not part of a certificate. `fixtures/expected.json` stayed byte-identical after the change.

## V5 adapter

The adapter is `research/kar-1/integration/`. The experimental entrypoint is `integration/index.mjs` (`runKar`, `explainKarResult`, `verifyKnoloKar`). `@knolo/core` does not export it. `packages/core/src/index.ts` contains no `kar` export.

Two identities are already defined, and they are different digests.

| Role | Value |
| --- | --- |
| Mounted image identity | V5 `stateRoot`, `digestDomain('state', digestBytes(commitDigest))` from `createKnowledgeImageV5` / `mountKnowledgeImageV5` |
| Evidence identity | V5 object id, `digestDomain('object', canonicalCbor({ kind, bytes, meta }))` |
| Frozen `KnowledgeRoot` | Research digest of `{ version: 1, evidence: [{ id, text }] }` sorted by id. `text` is the UTF-8 decoding of the object bytes |

`kar-1-research-1` defines `KnowledgeRoot` as that research digest and says verifiers must refuse to treat it as a V5 state root. The pilot keeps that definition.

- Evidence ids in the CEG are the object ids Knolo already assigned. The adapter does not mint a second evidence id.
- The sidecar stores `stateRoot`, `objectRoot`, `commitDigest`, and `knowledgeRoot`.
- `G.knowledgeRoot` is the research projection root. The frozen check is `G.knowledgeRoot = KnowledgeRoot(projection(K))`.
- The integration check is `sidecar.stateRoot = image.stateRoot`.
- Either mismatch returns `GRAPH_NOT_BOUND`.

Writing the V5 `stateRoot` into `G.knowledgeRoot` would make the frozen engine return `GRAPH_NOT_BOUND` for every real image. Teaching `evaluate` to accept a V5 state root as `KnowledgeRoot` would be a new semantics version. This pilot does not do that.

The CEG is a sidecar. Each scenario directory contains `knowledge.knolo` and `knowledge.kar.json`. The container bytes do not contain the sidecar marker. V5 container bytes and state-root computation are unchanged.

Normalized fixtures in `integration/fixtures/normalized/` are the projection, the CEG, the query, and the plan. The Rust crate reads those JSON values. It does not link the Knolo runtime.

## Test scenarios

Five hand-authored graphs over real V5 images created with `createKnowledgeImageV5`. Chunk bytes are the evidence text. Node ids are committed concept ids such as `lodging`. Evidence ids are object digests.

| Scenario | Image | Result |
| --- | --- | --- |
| Support and opposition | General cancellation policy and enterprise commitment | `permits` maps to `F_S`, `prohibits` maps to `F_O`. Both floors are 1. Status `SATISFIED`. Both object ids are returned, one in each frontier. |
| Support, opposition, and qualifier | Standard policy, contradicting group agreement, grandfathered amendment | `F_S`, `F_O`, and `F_Q` are all required. The minimum set has cardinality 3. |
| Temporal applicability | Old rule `[2020-01-01, 2024-01-01)`, current rule `[2024-01-01, 2027-01-01)`, future rule `[2027-01-01, ∞)` | All three stay in `F_S`. The selected id is the old rule at `2023-06-15`, the current rule at `2024-01-01` and `2026-10-10`, and the future rule at `2027-03-01`. |
| Authority | Statute authority 80, staff memo authority 20 | `minAuthority: null` selects the lexicographically smaller applicable id. `minAuthority: 50` selects only the statute. `minAuthority: 100` returns `UNSATISFIED_EVIDENCE_REQUIREMENTS` and an empty set. The memo's applicability flag follows the threshold. |
| Genuine gap | Cancellation policy, plus a brochure reached only by an unmapped `mentions` edge | Opposition is required and has no applicable binding. Status `UNSATISFIED_EVIDENCE_REQUIREMENTS`. `evidenceIds` is `[]`. `F_S` still lists the policy. `F_O` is empty. There is no top-k fallback. |

Supplied grounding uses the query `Can the customer cancel the room?` and the witness `{ nodeId: "lodging", queryTerm: "room" }`. The query does not contain the node id `lodging`. `member-id-v1` therefore anchors nothing and abstains. Replacing the witness term `room` with `suite` keeps the same evidence ids and changes `AnchorRoot`. The witness is on the integration envelope, and `AnchorRoot` is the digest of the anchor commitment that contains that witness.

## Certificate examples

Satisfied root set, scenario `support-opposition`. Image `stateRoot` `sha256-fe6ac66f9e0f14a11d72d0125b95750bc0fa46dd53e49639e5eeb362cb26f7a6`. Research `knowledgeRoot` `sha256-f4d0c63d0ca3fdbd8a1d660c2232e07819731b814194f66e9441f04ccef93a8d`. These two digests differ.

| Root | Digest |
| --- | --- |
| KnowledgeRoot | `sha256-f4d0c63d0ca3fdbd8a1d660c2232e07819731b814194f66e9441f04ccef93a8d` |
| SemanticRoot | `sha256-22fb00919d1a84b54abbec1194850242ff81c80f30057d9dd2515896b7a7da14` |
| QueryRoot | `sha256-d551e83e07a43df818a7a11b9d9cff659e3ff5e7140cabda1cda013f62049585` |
| PlanRoot | `sha256-b43f51fc4d88b0adee9f123de01abe3bf80aeca56593ff4d75879b70f7ffb9f3` |
| AnchorRoot | `sha256-ed9b2b77a366c24cdaeeb76c976638d526ebe4b8eeec381e48fbd67c5366182c` |
| FrontierRoot | `sha256-08d716fbb644df4bf5ca718c7c4ecad2abea66effa5e90a642a559c9f5052c4e` |
| FrontierWitnessRoot | `sha256-e6cd5955d4549da03809810ca95ffe78a73cf93e76028148353ae1a52c721970` |
| EvidenceSetRoot | `sha256-eaa3f067f4e986461b72dd567909e70bd85a462ed0bc7bae536dca6460086797` |
| DecisionRoot | `sha256-ba643ef0dcb933a375cfd8f7bc3bb47ddad181564c32ed1918cffe0224a14550` |
| KARRoot | `sha256-ff8aa7a6978951c2c3e5d25a2d0039b00b718a6615216661b45c64bd9558d04f` |

Selected evidence, still split by frontier:

- `F_S`: `sha256-13841b4d369c4aa0abc103ce2ecbadf56b0a1bb43d599d1f1b964d1772a86db5` (`front-desk/cancellation-policy`)
- `F_O`: `sha256-5a62dde978bc98565bf7c6aa810c210b98b744f490d6ef03c2c544921be6e5db` (`contracts/enterprise-lodging`)

The same evaluation repeated 25 times produced the same canonical certificate. Evidence text is resolved beside the certificate. It is not copied into `kar`.

Abstention, scenario `genuine-gap`. Status `UNSATISFIED_EVIDENCE_REQUIREMENTS`. `evidenceIds` is `[]`. `F_S` contains the policy object. `F_O` is empty.

| Root | Digest |
| --- | --- |
| KnowledgeRoot | `sha256-88a349c6f5ccb047c164c5374a2c95d380a41828dcb7821081439370345a4907` |
| SemanticRoot | `sha256-602ed49051d50c9ef31e1a35a63c4f7aefd947bc05ed65d09e9dc281aa16c91c` |
| QueryRoot | `sha256-d551e83e07a43df818a7a11b9d9cff659e3ff5e7140cabda1cda013f62049585` |
| PlanRoot | `sha256-b43f51fc4d88b0adee9f123de01abe3bf80aeca56593ff4d75879b70f7ffb9f3` |
| AnchorRoot | `sha256-ed9b2b77a366c24cdaeeb76c976638d526ebe4b8eeec381e48fbd67c5366182c` |
| FrontierRoot | `sha256-ef50be990048339da69d096e68191521e2e3ddc195e231789524fc2a3aa62a27` |
| FrontierWitnessRoot | `sha256-709cdccaea3f2a4fd17a4fc42dedee5788d59557f4a7f0c6e03bc07a512e89c0` |
| EvidenceSetRoot | `sha256-4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945` |
| DecisionRoot | `sha256-624d13a2619077903e12c86b6bc02ff938e62eab61350b264cb129040494f0ad` |
| KARRoot | `sha256-18c7bea68ac65ed1bde36cfbde3d97c0c87fee4817c710238511f2eff42561a7` |

Explanation from `explainKarResult`, with no model: `unsatisfied F_S,F_O; returned evidence count 0; populated frontiers F_S; no top-k fallback`.

There is no relevance score. Frontiers stay separate fields (`F_S`, `F_O`, `F_Q`, `F_T`, `F_A`). The result has no `hits` array.

## Cross-runtime parity

`cargo test --manifest-path rust/Cargo.toml --offline` passed.

- `verifier_matches_typescript_vectors`: the 16 frozen vectors.
- `integration_fixtures_match_typescript`: every normalized V5 scenario (12 cases). Status, evidence ids, choices, frontiers, witnesses, decision, and all roots matched the TypeScript result.

The Rust crate consumed the projection JSON. It did not gain a V5 decoder.

## Exact-cover validation

Independent brute-force enumeration of 10,000 generated graphs, seed `20261010`.

Each graph has 1 to 10 candidates, 0 to 5 requirements spread across the five frontiers, cardinality from 0 through the candidate count, floors in `{0, 0.25, 0.5, 1}`, and mixed applicability (unauthorized, expired, and authority below `minAuthority`). The original 200-graph test still passes unchanged.

Mismatches: **0**. Recorded in `integration/fixtures/enumerate-10k.json`.

## Tamper testing

Every row was rejected by `verifyKnoloKar`. `pass` means the verifier failed closed.

| Mutation | Rejected | Reason |
| --- | --- | --- |
| KnowledgeRoot tamper | yes | `GRAPH_NOT_BOUND` |
| SemanticRoot/CEG tamper | yes | result mismatch |
| query tamper | yes | result mismatch |
| plan tamper | yes | result mismatch |
| anchor witness tamper | yes | result mismatch |
| relation tamper | yes | result mismatch |
| evidence binding tamper | yes | result mismatch |
| authority tamper | yes | result mismatch |
| validity tamper | yes | result mismatch |
| frontier mapping tamper | yes | result mismatch |
| threshold tamper | yes | result mismatch |
| as-of tamper | yes | result mismatch |
| frontier tamper | yes | result mismatch |
| evidence set tamper | yes | result mismatch |
| decision tamper | yes | result mismatch |
| KARRoot tamper | yes | result mismatch |
| modified evidence bytes | yes | `GRAPH_NOT_BOUND` |
| wrong Knowledge Image root | yes | `GRAPH_NOT_BOUND` |
| changed selected evidence | yes | result mismatch |
| corrupt container byte | yes | `IMAGE_REJECTED` segment digest mismatch |
| state root tamper | yes | `GRAPH_NOT_BOUND` |

Property checks on the frozen engine also passed: raising a coverage floor does not turn an unsatisfied result into a satisfied one; reducing `K` does not produce a larger satisfying set; deleting selected evidence or its only admitting relation makes the old certificate fail and, in the relation case, abstains; an unmapped relation leaves status, frontiers, witnesses, and the selected set unchanged while changing `SemanticRoot` and `KARRoot`, because the CEG digest commits the whole graph; reordering nodes, relations, bindings, and evidence leaves the roots unchanged; duplicate node, relation, binding, and evidence ids return `GRAPH_INVALID` with an empty set.

## Performance

Measured with `node --expose-gc`. Anchor, closure, and cover are timed separately. Verification re-runs `evaluate` and checks the certificate. Heap is the `heapUsed` delta after a forced GC. The chain walks every edge (`depth = n - 1`, out-degree 1). The local family is out-degree 3 and `depth = 4`, so closure visits a fixed ball inside a larger graph. Eight evidence bindings share one support requirement, so cover stays on a tiny frontier.

Chain, full depth:

| Nodes | Edges visited | Frontier | Anchor p50 / p95 / max (ms) | Closure p50 / p95 / max (ms) | Cover p50 / p95 / max (ms) | Verify p50 / p95 / max (ms) | Heap p50 / max |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 100 | 99 | 8 | 0.018 / 0.103 / 0.103 | 0.18 / 0.86 / 0.86 | 0.094 / 0.89 / 0.89 | 1.48 / 1.93 / 1.93 | 0.32 / 0.54 MiB |
| 1,000 | 999 | 8 | 0.015 / 0.045 / 0.045 | 4.49 / 6.52 / 6.52 | 0.114 / 0.146 / 0.146 | 8.07 / 10.71 / 10.71 | 3.73 / 11.0 MiB |
| 10,000 | 9,999 | 8 | 0.013 / 0.030 / 0.030 | 178 / 193 / 193 | 0.111 / 0.123 / 0.123 | 204 / 207 / 207 | 13.3 / 13.3 MiB |
| 50,000 | 49,999 | 8 | 0.014 / 0.032 / 0.032 | 15,995 / 16,042 / 16,042 | 0.118 / 0.125 / 0.125 | 15,978 / 16,117 / 16,117 | 35.6 / 46.8 MiB |

Reps: 15, 9, 5, and 3. Full rows are in `integration/bench/scale-results.json`.

Local depth 4, degree 3. Visited edges stay at 30. Closure p50 is 0.078 ms, 0.44 ms, 4.21 ms, and 31.5 ms at 100, 1,000, 10,000, and 50,000 nodes. Verify p50 at 50,000 nodes is 473 ms. That cost tracks the 149,994 stored relations, not the 30 traversed edges. Heap p50 at 50,000 nodes is 25.6 MiB.

The first scaling wall is full-depth closure. Time jumps from about 0.18 s at 10,000 nodes to about 16 s at 50,000 nodes while the frontier stays at 8 items and cover stays under 0.2 ms. The reference copies the witness path at every hop, so a long chain is quadratic in depth. A depth-limited walk over a 50,000-node graph does not hit that wall. This pilot does not change the closure algorithm.

## Cover complexity

`minimum-cover` is unchanged. `maxCoverVisits` is 10,000. 470 deterministic cells. Details are in `integration/bench/cover-results.json`.

| Series | Cells | `SEARCH_BOUND_EXCEEDED` | Satisfied | Unsatisfied |
| --- | --- | --- | --- | --- |
| Shared mask (many candidates, repeated requirement masks) | 350 | 0 | 130 | 220 |
| Private requirement (each candidate covers a distinct required item) | 120 | 20 | 8 | 92 |

Shared masks do not hit the visit limit anywhere in this grid (up to 20 candidates, 8 requirements, 5 frontiers, cardinality 5). Frozen minimum-cover keeps one lex-smallest candidate per mask, so the search pool is the number of distinct masks.

Distinct masks do hit the limit:

| Candidates | Cells | `SEARCH_BOUND_EXCEEDED` |
| --- | --- | --- |
| 8 | 24 | 0 |
| 12 | 24 | 0 |
| 15 | 24 | 4 |
| 18 | 24 | 8 |
| 20 | 24 | 8 |

At 15 distinct required items, cardinality 1 through 5 still finishes and returns `UNSATISFIED_EVIDENCE_REQUIREMENTS` when the bound is below 15. Cardinality 15 returns `SEARCH_BOUND_EXCEEDED` on every frontier count tested (1, 2, 3, 5), with an empty evidence set. The full cover exists, and the visit budget is spent before it is proven. `2^15` is 32,768, above 10,000.

At 18 and 20 candidates, cardinality 5 also returns `SEARCH_BOUND_EXCEEDED`. The cumulative combination count through size 5 exceeds 10,000 (`C(18, 0..5)` is 12,616; `C(20, 0..5)` is 21,700). Cardinality 1 through 4 still exhausts and returns unsatisfied. Frontier count does not move this boundary when every private requirement is mandatory.

Exact KAR under the 10,000-visit budget is practical when masks repeat, and when a distinct-mask cover is smaller than about 12 items. It stops being a proof, and reports `SEARCH_BOUND_EXCEEDED`, once the minimum set is a large distinct combination. A later approximation would need its own profile name. The default algorithm was not changed.

## Regressions

KAR was not called by these suites. No package under `packages/` was modified.

| Suite | Result |
| --- | --- |
| `@knolo/cli` | 47 passed, 0 failed |
| `@knolo/core` | 169 passed, 0 failed; `scripts/test.mjs` reported all tests passed |
| `create-knolo-app` | 1 passed, 0 failed |
| `@knolo/evidence-gate` | 9 passed, 0 failed |
| `@knolo/langchain` | 2 passed, 0 failed |
| `@knolo/llamaindex` | 2 passed, 0 failed |
| `@knolo/reflex` | 42 passed, 0 failed |
| `@knolo/semantic-ollama` | 5 passed, 0 failed |
| `packages/core-rust` | 24 passed, 0 failed |

The production Rust crate is not linked by this pilot. Its V5, VQF, migration, and EQL fixtures still match.

Regression count attributable to KAR: **0**.

## Problems

These are recorded limits. None of them required a change to `kar-1-research-1`.

1. V5 `stateRoot` and frozen `KnowledgeRoot` are different digests on purpose. The sidecar binds `stateRoot`. `G.knowledgeRoot` binds the research projection. A future numbered KIP could register one domain. That would be a new semantics version.
2. Full-depth closure copies witness paths and takes about 16 s at 50,000 chain nodes. A compact path representation can preserve the same witness bytes. This phase does not change closure.
3. Exact minimum-cover returns `SEARCH_BOUND_EXCEEDED` once distinct combinations exceed `maxCoverVisits`. The empty set is intentional. An approximation needs a new named profile.
4. An unmapped relation does not change frontiers or the selected set. It does change `SemanticRoot` and `KARRoot`, because those digests commit the whole CEG.
5. On abstention the frozen decision records covered 0 on every frontier, including a frontier that had members. The explainer reports that certificate and the populated frontier list. The selected set stays empty.

The CEG is not embedded in the V5 container. There is no public `@knolo/core` export. There is no query-time model, embedding, or new ranking formula.

## Answer

`kar-1-research-1` can operate deterministically and verifiably over evidence taken from a real Knolo V5 Knowledge Image. Existing Knolo retrieval and V5 state-root semantics were not changed. The next phase is the experimental core API and developer experience.

READY_FOR_EXPERIMENTAL_CORE_INTEGRATION
