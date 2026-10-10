# Semantic producers report

Phase 9 adds a semantic producer layer in front of the frozen CEG compiler. KAR retrieval stays `kar-1-research-1`. CEG compilation stays `ceg-source-1`. This phase does not open `kar-1-research-2` or `ceg-source-2`.

## Architecture

```text
raw documents / structured data / ontology
                    |
                    v
             CEG Producers
                    |
                    v
        CEG Source fragments
                    |
                    v
       deterministic merge/review
                    |
                    v
              ceg-source-1
                    |
                    v
       deterministic compiler
                    |
                    v
      Committed Evidence Graph
                    |
                    v
                  KAR
```

A producer proposes authoring semantics. `compileCegSource()` is the only writer of `KarSidecarV1`. The run artifact is `ceg-producer-run-1`. Its `fragment` holds accepted source only. Observations, proposal state, confidence, aliases, and Domain Pack provenance stay in that artifact. They do not enter `SemanticRoot`.

| Producer | Id | Version |
| --- | --- | --- |
| Deterministic rules | `knolo-ceg-rule-producer` | `ceg-rules-1` |
| Structured ontology | `knolo-ceg-ontology-producer` | `ceg-ontology-1` |
| Model proposals | `knolo-ceg-model-producer` | `ceg-model-proposals-1` |

The model producer is optional. Its proposals stay `PROPOSED`. `autoAcceptModelOutput` is false.

Narrative: [Producers](producers.md), [Domain Packs](domain-packs.md), [Rule producer](rule-producer.md), [Model producer](model-producer.md).

## Domain Pack format

Format `ceg-domain-1`. Schema [`ceg-domain-v1.schema.json`](../../schemas/experimental/kar/ceg-domain-v1.schema.json).

A pack is a directory: `domain.yaml`, `rules/`, `plans/`, `fixtures/`, and `README.md`. It declares concept kinds, a canonical concept registry, a relation vocabulary, declarative rules, and recommended plan templates. Fixtures are tests and are excluded from the hash.

```text
DomainPackRoot = H(canonical domain pack body)
```

| Pack | Version | Rules | Fixtures | DomainPackRoot |
| --- | --- | --- | --- | --- |
| contracts | 1 | 23 | 10 | `sha256-f691628a70e0a28b6ddec59b7803c5326f7a17deddeb3c67af39516c382e4d07` |
| policy | 1 | 17 | 9 | `sha256-0391d52bd3756a9ad7b491d8af034d98ae85fd6497c3ae60b3aac08e297d62d5` |
| operations | 1 | 17 | 9 | `sha256-2f7a5a19bcb9b2310e578f0ee10fd115780f4c1e521abd4311732bcea6138681` |
| generic | 1 | 2 | 2 | `sha256-c389d2847921fb405f3298f1c9cd98bd962cbc67c39c04d7429162f8dbdabaa2` |

Plan templates instantiate frozen KAR plans through `instantiatePlanTemplate` and `validatePlan`. They are selected by name. They are not hidden frontier defaults.

A pack is data. Paths, URLs, credentials, and timestamps are rejected. Limits may only lower the producer ceilings. Unknown keys and over-ceiling values fail closed.

The three domain packs are validation domains for contracts, policy, and operations. They do not claim to cover every field.

## Deterministic rule producer

Rules are metadata equality or existence, heading exact or regex, phrase exact or regex, sentence cues, date capture, section relationship, and authority from metadata or an explicit authority literal. Exact phrases use letter-and-digit boundaries, so `may terminate` does not match inside `may not terminate`.

`autoAccept: true` admits concept, relation, and binding proposals as `ACCEPTED`. Date, authority, and incomplete rules remain observations. A missing referent such as `subject to the former` emits `CEG_PRODUCER_INCOMPLETE_REFERENCE` and does not invent the target. A missing or ambiguous date is omitted. An authority that is not an explicit integer is omitted. An impossible validity window is omitted with `CEG_PRODUCER_INVALID_WINDOW`.

Support (`permits`, `requires`, `supports`) and opposition (`prohibits`, `contradicts`) on the same ordered endpoints are both kept, with warning `CEG_PRODUCER_RELATION_CONFLICT`. The compiler does not choose a winner.

Every text match records `evidenceId`, `ruleId`, span, and `textDigest`. Rule identity stays on the observation. It is not stored in `binding.provenance`, because that string is inside the frozen binding id.

Generation past the configured ceiling fails with `CEG_PRODUCER_LIMIT`. `regexIsSafe` rejects backreferences, lookaround, and nested quantifiers such as `(a+)+` before `RegExp` runs. An optional in-memory cache keys canonical runs by `producerInputRoot`. Incremental production is deferred. A later incremental mode must match a full run byte for byte.

`knolo kar produce rules --auto` writes the accepted fragment as CEG Source and a sibling `*.production.json`. An existing output file is left unchanged.

## Ontology producer

`runOntologyProducer` accepts mapping format `ceg-ontology-map-1` or `ceg-import-map-1`. The ontology format is rewritten onto the existing import map, then `importJsonGraph` runs. Selectors remain `objectId`, `source`, `namespace`, `locator`, and `meta`. Zero matches are `CEG_EVIDENCE_NOT_FOUND`. More than one match is `CEG_EVIDENCE_AMBIGUOUS`.

`auto: true` puts the imported source in the fragment and marks proposals `ACCEPTED`. Otherwise the fragment is empty and proposals are `NEEDS_REVIEW`.

## Optional model producer

`MODEL_PRODUCER_EXPERIMENTAL_ONLY`.

Core `validateModelProposals` does not call a model and does not repair JSON. Malformed output is `CEG_PRODUCER_OUTPUT_INVALID`. A claim that does not cite evidence present in the catalog is `CEG_PRODUCER_UNGROUNDED`. Dates and authority are copied only when the quote contains the literal. Confidence stays on the proposal. Aliases stay on the run.

The local adapter `proposeCegWithOllama` lives in `@knolo/semantic-ollama`. The default endpoint is `http://127.0.0.1:11434`. Tests inject `fetchImpl`. No live model was scored. `knolo kar produce model --auto` refuses to run.

Schema for the model object: [`producer-proposals-v1.schema.json`](../../schemas/experimental/kar/producer-proposals-v1.schema.json). Run schema: [`producer-run-v1.schema.json`](../../schemas/experimental/kar/producer-run-v1.schema.json). Decisions: [`producer-decisions-v1.schema.json`](../../schemas/experimental/kar/producer-decisions-v1.schema.json).

## Review workflow

```bash
knolo kar produce rules --image knowledge.knolo --domain domains/contracts --out proposals.json
knolo kar produce review proposals.json
knolo kar produce apply --proposals proposals.json --decisions decisions.json --out generated.ceg.yaml
knolo kar graph build --image knowledge.knolo --source generated.ceg.yaml --out knowledge.kar.json
```

`renderProducerReview` prints the relation, evidence excerpt, producer, and rule id. `explainCegProposal` answers the same questions from the run file. A rule explanation does not call a model.

An empty `ceg-decisions-1` file keeps proposals that are already `ACCEPTED` and leaves `PROPOSED`, `NEEDS_REVIEW`, and `REJECTED` out. Unknown and duplicate decision ids are errors.

`examples/kar-producers/contracts/run.mjs` builds an image from three contract notes, runs the contracts pack, compiles, and evaluates `showcase-review`. The result is `SATISFIED`, frontiers `F_S`, `F_O`, and `F_Q` are populated, and `verifyKar` returns `VERIFIED`. Semantic root: `sha256-dda25bc736b82b336240f765b76fa7e55c7ecf0aad3994621e3f2c89675fa30e`.

`examples/kar-producers/mixed/run.mjs` merges the rule producer, the ontology producer, and a hand-written fragment, then compiles and evaluates the same plan. The result is `SATISFIED` and `VERIFIED`, with the same three frontiers populated.

## Benchmarks

This is a producer-quality benchmark. It is not a KAR algorithm experiment. Reference concepts, relations, and bindings are declared by the generator. The producer runs after that declaration. Scores are separate per producer. The file is [`producer-benchmarks.json`](producer-benchmarks.json). `docs/kar/benchmarks.json` was not rewritten.

Each domain row is 100 synthetic scenarios. The document text contains the exact phrases the Domain Pack rules declare, plus a noise sentence and, on a subset, an explicit date line or an authority metadata field. A score of 1.0 means the deterministic rules emitted that declared graph. It is not a measurement of unseen contract, policy, or procedure language. Real corpora are the next phase.

| Producer | Concept P/R | Relation P/R | Binding P/R | Grounding | Temporal | Authority | Contradictions kept | KAR status | KAR frontiers | KAR selected | KAR abstention |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| `contracts-rules-v1` | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| `policy-rules-v1` | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| `operations-rules-v1` | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| `generic-rules-v1` | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 1.0000 / 1.0000 | 1.0000 | 1.0000 | 1.0000 | n/a | 1.0000 | 1.0000 | 1.0000 | 1.0000 |
| `ontology-producer` | — | recall 1.0000 | — | 1.0000 | — | — | — | — | — | — | — |
| `model-producer` | not measured | not measured | not measured | not measured | not measured | not measured | not measured | not measured | not measured | not measured | not measured |

`generic-rules-v1` has one relation, `related`. Its scenarios ask only for that relation, so recall 1.0 is the pack doing the one thing it declares. It had no support-plus-opposition cases. The JSON file records `contradictionsKept: 1` for that empty set; the table marks it n/a.

Micro precision and micro recall match the macro figures above. Proposed and reference counts: contracts, policy, and operations each proposed 209 concepts and 127 relations and bindings. Generic proposed 192 concepts and 92 relations and bindings. Ontology: 100 of 100 mapped relations landed on the declared object id.

Evidence grounding precision for the deterministic producers is 1.0, above the 0.99 initial target, on this cue-matched set. No benchmark case invented a date or an authority. Opposition pairs that the generator declared were present on both sides after production.

## KAR utility

For each scenario the benchmark compiles the declared reference source and the produced fragment with the unchanged compiler, then runs frozen `evaluateKar`. Agreement is status, frontier arrays, selected evidence ids, and whether both sides abstain. All four rule rows agree on all four checks across 100 scenarios. Equal `SemanticRoot` values are not required and were not used as the pass condition.

The contracts showcase and the mixed-producer example both verify. `SATISFIED` means the plan's floors were met. It does not mean the proposition is true.

## Security and fuzzing

Producer proof suite, included in `@knolo/core` `npm test`, exit 0:

| Check | Count | Result |
| --- | --- | --- |
| Same image, producer, and pack | 10,000 runs | 1 canonical fragment |
| Image object and metadata reorderings | 10,000 | same fragment and 1 compiled `SemanticRoot` |
| Rule-order permutations | 10,000 | 1 canonical source |
| Fragment merge orders | 10,000 | both relations kept, label independent of order |
| Ontology mappings | 10,000 | no crash, declared relation kept |
| Malformed Domain Packs | 25,000 | fail closed, 0 crashes |
| Malformed producer outputs | 25,000 | 0 accepted relations, 0 non-`PROPOSED` survivors, 0 crashes |
| Regex and decision fuzz | 1,000 patterns, 2,000 decision files | no hang, no throw; `(a+)+`, `(.*)+`, `(?=a)`, `(?!a)`, and `\1` rejected |

Phase 8 compiler proof, same core run:

| Check | Count | Result |
| --- | --- | --- |
| CEG source reorderings | 10,000 | 1 `SemanticRoot` |
| Independent reference compiles | 10,000 | 0 mismatches |
| Malformed CEG inputs | 25,000 | fail closed |

## Regressions

KAR mismatches: 0. CEG compiler mismatches: 0. Frozen hashes after the research run match the Phase 8 bytes.

| Gate | Result |
| --- | --- |
| `@knolo/core` `npm test` | Runtime check passed. 205 tests passed, 0 failed. Includes producer proof, 10,000 CEG reorderings, 10,000 reference compiles, 25,000 CEG fuzz cases, 50,000 KAR differential cases (seed `20261011`, 17.96 s), and 10,000 tamper cases (seed `20261012`). `scripts/test.mjs` reported all tests passed. |
| `research/kar-1` `npm test` | 16 passed. `expected.json` hash unchanged: `154215068cfc8ec50c0d973d2608afa74e237c04171081392d54569c47a3c9cf`. |
| `research/kar-1` `npm run test:integration` | 5 passed, including 10,000 exact-cover graphs, seed `20261010`. |
| `research/kar-1/rust` `cargo test --offline` | 2 parity tests passed. |
| `packages/core-rust` `cargo test --offline` | 24 passed. |
| reflex | 42 passed. |
| evidence-gate | 9 passed. |
| semantic-ollama | 6 passed. The new case injects `fetchImpl` and does not call a live server. |
| langchain | 2 passed. |
| llamaindex | 2 passed. |
| create-knolo-app | 1 passed. |
| `@knolo/cli` | 53 passed, 1 pre-existing optional Hub skip, 0 failed. Includes `kar produce`, `kar domain`, existing `kar evaluate`, and the Phase 8 graph/package tests. |

Unchanged file hashes:

| File | SHA-256 |
| --- | --- |
| `docs/kar/benchmarks.json` | `aa9c624b7fab93c4a0a89221845cd51a008ec3bcfa1cb0b689a7b7af06026db5` |
| `docs/kar/ceg-benchmarks.json` | `3e5d1d10726f39be2575b1bf7619e2a7132d645a611d8fa3911e6bb107c6c11b` |
| `spec/KAR-1.md` | `a38f3c5e6098b88d13bd3595dce5c368bb46ace6159337858c18726b58504d66` |

No KAR semantic change was required. Produced source compiles through `compileCegSource()`. The public `@knolo/core` barrel still does not export KAR. `@knolo/core/experimental/kar` still does not import authoring.

## Known limitations

- The producer benchmark uses cue-matched synthetic documents. It shows deterministic grounding and KAR agreement for those cues. It does not measure recall on a real contract, policy, or procedure corpus.
- The model producer is `MODEL_PRODUCER_EXPERIMENTAL_ONLY`. No live model quality numbers are reported.
- Incremental production is deferred. Phase 8 compilation remains a full compile.
- The producer cache is optional and in memory. It is not committed semantics.
- Alias proposals stay in producer metadata. `ceg-source-1` has no alias field. Query grounding still uses supplied KAR anchors.
- Domain Pack distribution is a directory plus the identity fields a later Hub record can cite. Hub publishing is not implemented.
- `openEvidenceCatalog` remains an internal authoring module. `knolo kar produce model --image` loads `catalog.js` from the package dist, the same way Phase 8 lint does.
- The generic pack is a one-relation control. It is reported separately.
- These packs do not cover every domain. A new domain publishes a new pack version. A released pack is not edited in place.

## What comes next

The following phase is real-world domain validation and a first end-to-end KAR product workflow on actual contract, policy, and procedure corpora. KAR retrieval and `ceg-source-1` stay frozen. This phase does not start that work.

## Classification

```text
READY_FOR_SEMANTIC_PRODUCERS_EXPERIMENTAL_RELEASE
```
