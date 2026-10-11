# Real-corpus validation report

Phase 10 ran the frozen KAR pipeline on public documents that were not written for these rules. Package version remains `5.5.1`. Semantics remain `kar-1-research-1` and `ceg-source-1`. This report does not open `kar-1-research-2` or `ceg-source-2`.

Classification: `DOMAIN_PACK_QUALITY_BLOCKED`.

The pipeline runs from document bytes to a verified Evidence Dossier. Auto-accepted producer output cites real evidence and invents no dates, authority ranks, evidence ids, or referents. Relation precision and binding precision on the holdout are below the auto-accept gates in every domain. Reviewed KAR agreement is also below 95 percent in every domain. Those product-gate misses are reported here. They do not replace the pack-quality classification: the deterministic packs are the part that failed their own numeric gate, and the specified response is a new pack version scored on a fresh holdout.

## Corpus

The manifest is `research/kar-real-corpus/corpus-manifest.json`, format `kar-real-corpus-manifest-1`. It records 134 documents.

| Domain | Documents | Organizations | License |
| --- | ---: | --- | --- |
| contracts | 42 | 42 separate CUAD agreements | CC BY 4.0 |
| policy | 34 | Department of Justice 24, Office of Management and Budget 6, CISA 4 | US government work, 17 USC 105 |
| operations | 58 | Internal Revenue Service 42, Federal Aviation Administration 16 | US government work, 17 USC 105 |

Contracts are full agreement texts from the Atticus CUAD v1 release, materialized from the `context` field. Policy texts are public manuals and memoranda. Operations texts are IRS Internal Revenue Manual sections and FAA JO 7110.65 procedure excerpts. Federal Register information-collection notices were removed before any rule change and before holdout selection. They are not in the manifest as scored documents.

Stored text is UTF-8. `sourceDigest` equals `documentHash`. The manifest has no `retrievedAt` field.

The scored gates use the 30 holdout documents only. The other 104 documents are training, development, or reserve. Reserve text was not used to edit rules.

### Split

Split seed: `kar-real-corpus-20261010-split-v1`.

Holdout seed: `kar-real-corpus-20261010-holdout-v1`.

Holdout rule: `sha256(seed + newline + domain + newline + documentId)`, reserve sorted, first 10. The selector does not open document text. It refuses to run unless the three v2 roots are supplied and holdout selection is still unset.

| Domain | Train | Development | Holdout | Reserve |
| --- | ---: | ---: | ---: | ---: |
| contracts | 12 | 8 | 10 | 12 |
| policy | 10 | 8 | 10 | 6 |
| operations | 12 | 8 | 10 | 28 |

Policy training is 10 documents, not 12. Ten policy documents had already been read while the corpus was being assembled. They were pinned to training and could not enter the holdout. The policy pool after that pin and after the dropped Federal Register notices is 34 documents, which still supplies a 10-document holdout. Rules were not edited after the holdout ids were written.

Holdout ids:

- contracts: `contracts-003`, `contracts-005`, `contracts-011`, `contracts-015`, `contracts-018`, `contracts-020`, `contracts-024`, `contracts-029`, `contracts-030`, `contracts-036`
- policy: `policy-021`, `policy-022`, `policy-030`, `policy-031`, `policy-032`, `policy-033`, `policy-037`, `policy-038`, `policy-041`, `policy-042`
- operations: `operations-001`, `operations-004`, `operations-005`, `operations-006`, `operations-013`, `operations-017`, `operations-020`, `operations-030`, `operations-045`, `operations-049`

The contracts vary in termination, renewal, payment, restrictions, exceptions, amendments, precedence, effective dates, and survival language because they are unrelated commercial agreements. The policy set mixes ethics, security, and litigating-division rules. The operations set mixes short IRS organization descriptions with longer procedural sections and FAA phraseology. Three operations holdout documents produced an empty agreed graph. That is reported below, not filled in.

## Holdout protocol

Domain Pack roots were written into the manifest before holdout selection, under `domainPackRootBeforeHoldout`. No rule file changed after that write. v1 directories were not edited. Runtime code does not contain holdout sentences, document titles, or organization names as match patterns.

`research/kar-real-corpus/supplement_corpus.py` now exits if holdout selection is already recorded, so a later run cannot reset the split.

## Reference semantics

The guide is `research/kar-real-corpus/ANNOTATION_GUIDE.md`. Annotators labeled only what the evidence quote states. A quote that points at missing text is an `incomplete` record with `INCOMPLETE_REFERENCE`, not a guessed relation.

Pass A and pass B were separate passes. Neither pass read Domain Packs, producer output, or the other pass. Both passes are the same model family. `results/producer-metrics.json` records `sameModel: true`. This is not two human annotators.

Every quote in both passes is an exact substring of the named evidence object. Pass A has 1,092 items and 117 incomplete records. Pass B has 2,759 items. Bad quotes: 0. Missing evidence ids: 0.

Adjudication keeps the intersection on `(evidenceId, relation, from, to, sorted requirements)`. Disagreements stay out of the gold. The gold has 432 items. Reference CEG Source files are `research/kar-real-corpus/reference/<id>.ceg.yaml`. Dropped quotes during compilation: 0.

| Domain | Gold items | Only pass A | Only pass B |
| --- | ---: | ---: | ---: |
| contracts | 246 | 256 | 550 |
| policy | 125 | 145 | 624 |
| operations | 61 | 27 | 683 |

`operations-001`, `operations-004`, and `operations-005` have an empty intersection. The passes described the same manuals with different endpoints, so the conservative gold is empty. Producer precision on an empty gold is null. It is not treated as a perfect score.

Pooled annotator agreement, pass A predicted against pass B:

| Domain | Relation precision | Relation recall | Binding precision | Binding recall | Same evidence and relation |
| --- | ---: | ---: | ---: | ---: | ---: |
| contracts | 56.4% (88/156) | 28.2% (88/312) | 53.6% (266/496) | 34.1% (266/779) | 87.4% (397/454) |
| policy | 84.6% (33/39) | 22.3% (33/148) | 55.6% (150/270) | 20.4% (150/737) | 91.1% (246/270) |
| operations | 50.0% (10/20) | 9.6% (10/104) | 76.1% (67/88) | 9.1% (67/738) | 89.8% (79/88) |

The last column ignores concept names. The passes often selected the same evidence and the same relation family, then named different targets (`role` versus `scope`, `step` versus `obligation`, `requirement` versus `control`).

The reviewed graph in this study is pass A compiled to CEG Source. Pass A did not see the intersection. Reviewed recall against the intersection is 1 by construction whenever the gold item survives compilation, because every gold item is taken from pass A. The precision column is the real review number: how much of pass A the second pass also stated. That precision is the ceiling for a reviewed-versus-intersection score in this study. It is below 98 percent in every domain.

## Domain Pack changes

v1 directories are unchanged. v2 directories are siblings. Roots below are the values frozen before holdout selection.

| Pack | v1 root | v1 rules | v2 root | v2 rules |
| --- | --- | ---: | --- | ---: |
| contracts | `sha256-f691628a70e0a28b6ddec59b7803c5326f7a17deddeb3c67af39516c382e4d07` | 23 | `sha256-4c16fdb2edf41fd6c5ca5d20106059210291b01c457980fb0e9565845840cfd0` | 36 |
| policy | `sha256-0391d52bd3756a9ad7b491d8af034d98ae85fd6497c3ae60b3aac08e297d62d5` | 17 | `sha256-f412af2b1109b3a8d5837f5f96a98be17a80f4462deb411f4f8fb66a3169ca6e` | 29 |
| operations | `sha256-2f7a5a19bcb9b2310e578f0ee10fd115780f4c1e521abd4311732bcea6138681` | 17 | `sha256-e8967d09e25ce5f6037444088494773264800d333aecc5d600d0d332764357ed` | 22 |

The change lists are in each v2 `README.md`.

No v1 rule was removed. Policy v2 copied the version 1 `subject to` pattern and narrowed the copy to `is subject to`, because `not subject to` was matching the broader phrase. The v1 file still says `subject to`. Added v2 cues are reusable phrases from training and development text: `notwithstanding`, `except as`, `supersedes all`, `shall pay`, `automatically renew`, `may be terminated`, `shall not`, `may not be`, `unless`, policy `shall not`, `is authorized`, `applies to`, `are subject to`, `be subject to`, `except as provided` as an incomplete-reference observation, operations `must`, `MUST`, `must not be`, sentence-initial `Do not`, and `unless`.

Bare `shall`, bare `must`, and bare `may not` were not auto-accepted on policy. Lowercase `do not` was not auto-accepted on operations. `effective date` was not turned into a parsed date. `survives` did not appear in the contract training and development text, so no survival cue was added.

## Producer quality

Auto-accepted output of the frozen v2 packs, scored against the intersection. Micro pools documents separately: the same endpoint label in two documents counts twice. An empty prediction has null precision, not 1. An empty gold has null recall, not 1.

Relation match is `(from, type, to)`. Binding match is `(concept, evidence id, sorted requirements)`.

| Domain | Relation micro | Relation macro | Binding micro | Binding macro | Concept micro |
| --- | --- | --- | --- | --- | --- |
| contracts | 65.7% / 29.5% (23/35, 23/78) | 61.3% / 27.1% | 37.4% / 16.4% (40/107, 40/244) | 33.5% / 14.6% | 82.5% / 41.8% (33/40, 33/79) |
| policy | 43.8% / 24.1% (7/16, 7/29) | 30.6% / 16.0% | 20.7% / 4.8% (6/29, 6/125) | 8.9% / 2.1% | 65.4% / 43.6% (17/26, 17/39) |
| operations | 58.3% / 87.5% (7/12, 7/8) | 69.0% / 92.9% | 81.0% / 83.6% (51/63, 51/61) | 86.5% / 83.6% | 81.0% / 94.4% (17/21, 17/18) |

The cells are precision / recall. Macro precision for policy relations uses 9 documents, because `policy-030` emitted no relations. Macro precision for operations relations and bindings uses 7 documents, because three holdout graphs are empty on both sides.

The auto-accept gates are relation precision at least 95 percent in each domain, and binding precision at least 99 percent. Every domain fails both. Operations has the highest binding precision, 81.0 percent, and still misses 99 percent. Its relation gold is only 8 triples, so the 58.3 percent relation figure is a small denominator and is reported beside the binding figure.

Recall is moderate on operations bindings and low on contracts and policy. That recall is the consequence of leaving broad duty words out of auto-accept. It is not adjusted.

Removing the concept name does not pass the binding gate: contracts 39.3 percent (42/107), policy 37.9 percent (11/29), operations 81.0 percent (51/63). The pack and the annotators disagree about which evidence rows carry the agreed label, not only about what the row is called.

## Grounding

| Domain | Accepted proposals checked | Excerpt found in that evidence object | Invented dates | Invented authority | Invented evidence | Invented referents |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| contracts | 538 | 538 | 0 | 0 | 0 | 0 |
| policy | 611 | 611 | 0 | 0 | 0 | 0 |
| operations | 1,117 | 1,117 | 0 | 0 | 0 | 0 |

Evidence grounding precision is 100 percent in each domain. The 99 percent grounding gate holds. A date counts as invented only when the date string is absent from the evidence text. No accepted binding carried a date or an authority value that failed that test. Incomplete-reference rules did not emit relations.

Reference bindings with an explicit authority rank: 0 in every domain. Authority is excluded from the KAR comparison. Reference bindings with `validFrom` or `validUntil`: 0. Prose dates remain in the quotes. They were not normalized.

## Review burden

The reviewer graph is pass A. It was built without producer output. Accepted relations are producer endpoint triples that pass A also states. Rejected relations are producer triples pass A does not state. Manual additions are pass A triples the producer did not state. Corrections in place: 0. Every deterministic proposal was auto-accepted by the pack. `NEEDS_REVIEW` proposals: 0. The model producer was not run.

| Domain | Proposals | Auto-accepted | Relations emitted | Kept by pass A | Rejected | Manual additions |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| contracts | 538 | 538 | 35 | 35 | 0 | 121 |
| policy | 611 | 611 | 16 | 11 | 5 | 28 |
| operations | 1,117 | 1,117 | 12 | 12 | 0 | 8 |

Relation acceptance, kept / emitted: contracts 100 percent, policy 68.8 percent, operations 100 percent. Manual-addition rate, additions / (kept + additions): contracts 77.6 percent, policy 71.8 percent, operations 40.0 percent. Dividing kept relations by proposal count is a different and smaller ratio, because one relation is many hit proposals. The relation ratio is the one that matches the compiled graph.

Reviewed quality against the intersection:

| Domain | Relation precision | Relation recall | Binding precision | Binding recall |
| --- | ---: | ---: | ---: | ---: |
| contracts | 50.0% (78/156) | 100% by construction | 49.2% (244/496) | 100% by construction |
| policy | 74.4% (29/39) | 100% by construction | 46.3% (125/270) | 100% by construction |
| operations | 40.0% (8/20) | 100% by construction | 69.3% (61/88) | 100% by construction |

The reviewed gates ask for relation precision at least 98 percent and recall at least 95 percent, binding precision at least 99 percent and recall at least 95 percent, and grounding at least 99.5 percent. Grounding of the compiled reference quotes is 100 percent (0 dropped). Precision fails in every domain. Recall meets 95 percent only because the gold is a subset of pass A. The agreement table is the non-circular comparison.

## KAR utility

Each holdout document was evaluated with a fixed catalog written from the annotation guide, not from producer output. Contracts: 14 questions, 140 evaluations. Policy: 12 questions, 120 evaluations. Operations: 12 questions, 120 evaluations. Total: 380.

R2 is KAR on the reference CEG. R3 is KAR on the uncorrected producer CEG. R4 is KAR on the pass A CEG. The plan maps `permits`, `requires`, `supports`, and `supersedes` to support, `prohibits`, `contradicts`, and `overrides` to opposition, `qualifies` and `excepts` to qualification, and `valid_before`, `valid_after`, and `applies_to` to temporal. Depth is 2. `asOf` is `2026-06-01`. Floors on the asked frontiers are `1`, meaning every listed requirement token must be covered. `minAuthority` is null.

A catalog question is also marked as a gap when any required token is absent from that document's gold items. Reference statuses of `UNSATISFIED_EVIDENCE_REQUIREMENTS`: contracts 67 of 140, policy 81 of 120, operations 112 of 120. Each domain has more than 10. Many of those abstentions exist because the intersection does not contain the catalog token, including tokens the source text might support under a label the two passes did not both use. The dedicated gap questions (`survival-duty`, `equipment-used`, `termination-right` on the wrong domain, `payment-duty` on operations) are inside that count.

| Domain | Questions | R3 status | R3 required frontier | R3 frontier membership | R3 evidence recall | R3 abstain | R4 status | R4 required frontier | R4 frontier membership | R4 evidence recall | R4 abstain |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| contracts | 140 | 62.1% | 62.1% | 7.1% | 54.2% | 62.1% | 86.4% | 86.4% | 18.6% | 81.4% | 86.4% |
| policy | 120 | 71.7% | 71.7% | 42.5% | 70.2% | 71.7% | 89.2% | 89.2% | 40.8% | 85.5% | 89.2% |
| operations | 120 | 90.8% | 90.8% | 63.3% | 98.2% | 90.8% | 83.3% | 83.3% | 44.2% | 98.0% | 83.3% |

R4 selected-evidence precision is 71.1 percent on contracts, 76.7 percent on policy, and 81.7 percent on operations. The product gates ask for status, required-frontier, selected-evidence recall, and abstention agreement of at least 95 percent on the reviewed graph, per domain. Operations meets selected-evidence recall at 98.0 percent. Every other reviewed cell in that gate list is below 95 percent. On operations, pass A lowers status agreement relative to the raw producer graph (83.3 percent versus 90.8 percent), because the extra pass A relations change some answers away from the thinner intersection.

No evaluation returned `COMPILE_FAILED`. Statuses were `SATISFIED` or `UNSATISFIED_EVIDENCE_REQUIREMENTS` only.

Exact frontier membership, per frontier, is in `research/kar-real-corpus/results/frontier-agreement.json`. A frontier agrees when the two graphs admit the same evidence ids to that frontier. Authority agrees on every question because both sides have an empty authority frontier: the corpus has no explicit authority rank.

| Domain | Pipeline | Support | Opposition | Qualifier | Temporal |
| --- | --- | ---: | ---: | ---: | ---: |
| contracts | R3 | 0/140 | 0/140 | 14/140 | 42/140 |
| contracts | R4 | 14/140 | 0/140 | 14/140 | 84/140 |
| policy | R3 | 12/120 | 36/120 | 36/120 | 120/120 |
| policy | R4 | 12/120 | 72/120 | 12/120 | 108/120 |
| operations | R3 | 60/120 | 108/120 | 72/120 | 108/120 |
| operations | R4 | 36/120 | 60/120 | 60/120 | 96/120 |

Required-frontier agreement, reported in the utility table, is the gate. Exact membership of every admitted evidence id is stricter, and it fails on support and opposition for contracts. The producer and the reference admit different evidence rows to those frontiers even when the coverage decision matches.

Empty selected sets agree as a match. A missing anchor was injected so a document with no gold items abstains instead of failing the plan.

### Actual question mix

Questions can carry more than one label. Gap overrides are included in the gap count.

| Label | Contracts | Policy | Operations |
| --- | ---: | ---: | ---: |
| support-only | 50 | 30 | 30 |
| support + opposition | 30 | 20 | 20 |
| support + qualification | 20 | 20 | 20 |
| temporal applicability | 10 | 10 | 10 |
| authority/applicability | 10 | 20 | 10 |
| genuine evidence gaps | 74 | 81 | 112 |

### Contradiction and qualification

A case is a holdout document whose gold relations include at least one support-family relation and one opposition-family or qualifier-family relation. "Both kept" means the candidate graph still contains at least one gold relation of each family. The producer does not delete one side to resolve a conflict. A lost side here is a side the producer never emitted.

| Domain | Support and opposition in gold | Producer kept both | Reviewed kept both | Same endpoints in gold | Producer kept the pair | Reviewed kept the pair |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| contracts | 8 | 7 | 8 | 1 | 0 | 1 |
| policy | 7 | 0 | 7 | 0 | 0 | 0 |
| operations | 0 | 0 | 0 | 0 | 0 | 0 |

Reviewed retention of both families is expected when the gold is a subset of pass A. The producer missed the opposition family on 1 contract document and on all 7 policy documents that have both families. The one same-endpoint contract conflict is in the reviewed graph and absent from the producer graph.

| Domain | Support and qualification in gold | Producer kept both | Reviewed kept both |
| --- | ---: | ---: | ---: |
| contracts | 5 | 5 | 5 |
| policy | 3 | 2 | 3 |
| operations | 0 | 0 | 0 |

### Temporal validity and authority

No reference binding has `validFrom`, `validUntil`, or `authority`. Multi-`asOf` probes were not run. Authority was not scored. Pass A contains 42 `valid_before` or `valid_after` relations, and none of those quotes contain an ISO `YYYY-MM-DD` date. Examples are `effective as of July 1, 2020` and header lines such as `Effective Date (07-10-2025)`. The frozen producer records an ISO date only when that exact string is in the evidence. It did not invent one. KAR's temporal filter therefore had no committed window to apply. That is a corpus and annotation limit under the existing date rule, not a missing KAR concept.

## Baseline retrieval

R0 is `query()` with query expansion disabled and semantic reranking disabled, with the returned hits re-sorted by score. Near-duplicate suppression inside `query()` still applies. R1 is default `query()` with expansion and MMR, semantic reranking off. There is no public switch that disables MMR alone. The comparison is gold evidence recall at K. A retrieval hit is not treated as a sufficiency decision.

Recall is the mean across holdout documents that contain that gold class. An empty class is omitted. Redundancy is mean pairwise token Jaccard of the hits.

| Domain | System | Class | @5 | @10 | @20 | @50 | Redundancy @5 |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| contracts | R0 | support | 26.8% | 44.6% | 66.5% | 76.3% | 0.14 |
| contracts | R0 | opposition | 37.3% | 54.3% | 92.2% | 95.8% | 0.15 |
| contracts | R0 | qualifier | 60.0% | 100% | 100% | 100% | 0.13 |
| contracts | R0 | temporal | 78.6% | 78.6% | 78.6% | 78.6% | 0.15 |
| contracts | R0 | all gold evidence | 24.7% | 41.3% | 62.3% | 71.9% | 0.14 |
| contracts | R1 | support | 26.6% | 45.9% | 72.2% | 98.1% | 0.15 |
| contracts | R1 | opposition | 43.0% | 64.2% | 92.7% | 100% | 0.16 |
| contracts | R1 | qualifier | 60.0% | 100% | 100% | 100% | 0.15 |
| contracts | R1 | temporal | 83.3% | 83.3% | 88.1% | 100% | 0.15 |
| contracts | R1 | all gold evidence | 24.0% | 40.4% | 69.9% | 97.4% | 0.15 |
| policy | R0 | support | 44.1% | 60.6% | 68.2% | 80.2% | 0.14 |
| policy | R0 | opposition | 46.7% | 76.6% | 85.1% | 92.9% | 0.16 |
| policy | R0 | qualifier | 11.1% | 55.6% | 66.7% | 100% | 0.14 |
| policy | R0 | temporal | 0% | 100% | 100% | 100% | 0.13 |
| policy | R0 | all gold evidence | 43.7% | 55.2% | 62.4% | 63.9% | 0.14 |
| policy | R1 | support | 47.1% | 62.6% | 75.1% | 93.6% | 0.15 |
| policy | R1 | opposition | 34.7% | 71.0% | 85.1% | 92.9% | 0.16 |
| policy | R1 | qualifier | 27.8% | 55.6% | 66.7% | 100% | 0.14 |
| policy | R1 | temporal | 0% | 0% | 100% | 100% | 0.15 |
| policy | R1 | all gold evidence | 41.9% | 59.0% | 74.1% | 87.1% | 0.16 |
| operations | R0 | support | 34.1% | 69.3% | 93.0% | 97.6% | 0.10 |
| operations | R0 | all gold evidence | 34.0% | 69.2% | 93.7% | 98.2% | 0.10 |
| operations | R1 | support | 34.1% | 66.2% | 88.0% | 99.4% | 0.12 |
| operations | R1 | all gold evidence | 39.5% | 67.7% | 93.7% | 100% | 0.09 |
| operations | R1 | temporal | 0% | 0% | 0% | 100% | 0.11 |

Operations has no agreed opposition class and no agreed qualifier class, so those recalls are omitted. Operations temporal recall is 0 through K=20 for R0 and for R1, and 100 percent at K=50 for R1. Result size at K=5 is 4 or 5 hits on almost every query. Lexical retrieval's job in this table is to surface gold evidence somewhere in a ranked list. KAR's job is to return a minimum set for a declared frontier. At K=50, lexical recall of all gold evidence is high on contracts R1 (97.4 percent) and operations (98 to 100 percent). The ranked list is large. KAR's selected set is the cover of the plan, and its agreement with the reference cover is the utility table above.

## Failure taxonomy

`research/kar-real-corpus/FAILURE_TAXONOMY.md` classifies all 265 missed gold items and 26 extra relations.

229 missed items are duties or permissions written with wording the frozen cues do not auto-accept. 12 are cross-section pointers. 10 are prose dates. 9 are authority sentences without a numeric rank. 13 are short fragments. 3 are `shall not` inside a surviving-duty sentence. The 26 extra relations are `unless`, `subject to`, `provided`, `except as`, `notwithstanding`, `shall not`, policy `control`, `supersedes all`, and operations `must not be`.

None of these is a concept the frozen CEG cannot store. The response is a new pack version and a new holdout, plus review for the long tail. It is not a KAR change.

## Product workflow

The developer workflow is `docs/kar/EVIDENCE_REVIEW_WORKFLOW.md`. The worked example is `examples/kar-real/contracts/`, using training document `contracts-041` (Ultragenyx supply agreement, CUAD, CC BY 4.0). It is not a holdout document.

The example builds an image, runs contracts v2, keeps auto-accepted proposals, adds one writing duty whose quote is an exact evidence substring (`Every termination has to be in writing.`), compiles with `compileCegSource`, and builds two dossiers through `createKarDossier` and the CLI.

The termination plan requires support tokens `termination-right` and `stated-obligation`, and qualification token `stated-exception`. Status: `SATISFIED`. Selected evidence: 3 objects. The rendered sentence is `Evidence requirements satisfied`. The survival plan requires `survival-duty`. Status: `UNSATISFIED_EVIDENCE_REQUIREMENTS`. Selected evidence: empty. The rendered sentence is `Evidence requirements not satisfied`.

`COMPARISON.md` places the lexical top 5 beside the dossier. Lexical retrieval returns the best matching evidence for the question text. KAR returns a minimum set for the declared frontiers. The top lexical hit is the breach-termination sentence. The dossier also keeps the renewal exception and the writing duty because the plan requires those tokens.

Both dossiers verify. A copy of `evidence.md` whose status sentence was changed to `Claim proven true` fails `kar dossier verify` with `KAR_RESULT_MISMATCH` and reason `dossier rendering mismatch`. The original directory still verifies. Repeated `createKarDossier` calls on the same image, graph, plan, and proposition produced the same manifest and the same rendering.

`createKarDossier` is exported from `@knolo/core/experimental/kar` and returns the dossier object. The CLI writes the directory. No model is called at query time. The dossier does not generate a prose answer.

## Regressions

Re-run in this phase, after the dossier and pack code had landed. KAR mismatches: 0. CEG compiler mismatches: 0. KAR-attributable test failures: 0.

| Suite | Result |
| --- | --- |
| `@knolo/cli` | 55 tests, 54 passed, 1 skipped, 0 failed |
| `@knolo/core` | 206 tests, 0 failed, including 50,000 differential graphs (seed 20261011), 10,000 producer repeats and reorderings, 10,000 rule orders, 10,000 merge orders, 10,000 ontology mappings, 10,000 source reorderings, 10,000 reference compiles, 25,000 malformed packs, 25,000 malformed producer outputs, 25,000 malformed authoring inputs, and 10,000 certificate tamper cases (seed 20261012) |
| `@knolo/evidence-gate` | 9 tests, 0 failed |
| `@knolo/langchain` | 2 tests, 0 failed |
| `@knolo/llamaindex` | 2 tests, 0 failed |
| `@knolo/reflex` | 42 tests, 0 failed |
| `@knolo/semantic-ollama` | 6 tests, 0 failed |
| `create-knolo-app` | 1 test, 0 failed |
| `research/kar-1` unit | 16 tests, 0 failed |
| `research/kar-1` integration | 5 tests, 0 failed, including 10,000 exact-cover graphs (seed 20261010) |
| `core-rust` | 24 tests, 0 failed |
| `kar1-research` | `integration_fixtures_match_typescript` and `verifier_matches_typescript_vectors` passed |

The 50,000-node closure benchmark was re-run into `research/kar-real-corpus/results/closure-scale-rerun.json`. Chain closure at 50,000 nodes: p50 15,943 ms, 49,999 edges, frontier 8. Local degree 3, depth 4, at 50,000 nodes: closure p50 27.3 ms. The published file `research/kar-1/integration/bench/scale-results.json` was restored and still hashes to `77093ffe56710d0055d5863febc5a722a12577608322e284bf5a17f428241981`.

Frozen files, unchanged:

| File | SHA-256 |
| --- | --- |
| `docs/kar/benchmarks.json` | `aa9c624b7fab93c4a0a89221845cd51a008ec3bcfa1cb0b689a7b7af06026db5` |
| `docs/kar/ceg-benchmarks.json` | `3e5d1d10726f39be2575b1bf7619e2a7132d645a611d8fa3911e6bb107c6c11b` |
| `spec/KAR-1.md` | `a38f3c5e6098b88d13bd3595dce5c368bb46ace6159337858c18726b58504d66` |
| `research/kar-1/fixtures/expected.json` | `154215068cfc8ec50c0d973d2608afa74e237c04171081392d54569c47a3c9cf` |

Phase 9 cue-matched producer scores are not real-corpus recall. This report does not reuse them.

## Benchmark freeze

`real-corpus-benchmark-1` records this blocked measurement. It is not a semantic version. The manifest is `research/kar-real-corpus/real-corpus-benchmark-1.json`.

| Record | Root |
| --- | --- |
| Corpus manifest | `sha256-1c32e620d5525826afb4007233e96894fa2934611ab3a5f7131a59d1ab0247ae` |
| Query manifest | `sha256-4398f3b7a6b9037dcc1c6b45cd1b97665c193a2c32417d08729d1d7957aa2b51` |
| Reference CEG set | `sha256-075bad7ca06a1a75b4602236acc89f6e4ea0a881c77d92d1086548c82786cb60` |
| Results directory | `sha256-96079d03142cef029051395c181c20e683df8f7aa0585865a11e2b7773c13e27` |

The query manifest has 38 templates. Each template is run on each of the 10 holdout documents in its domain, which is 380 evaluations. Its root is the SHA-256 of the compact JSON body before the `queryManifestRoot` field is added. The reference root is the SHA-256 of the sorted per-file digests of the 30 reference CEG Source files. The results root is the SHA-256 of the sorted digests of the JSON files in `research/kar-real-corpus/results/`. Domain Pack roots are in the table above. Rejection rate on emitted relations is 0/35 for contracts, 5/16 for policy, and 0/12 for operations. Time per document was not measured.

## Limitations

- Both annotation passes are the same model family. Agreement on binding endpoints is about one half to three quarters. A 98 percent reviewed-precision claim needs a stricter guide or a human adjudication pass.
- Reviewed recall against the intersection is 1 by construction.
- Policy training has 10 documents. Operations gold is empty on 3 holdout documents. Operations agreed relations number 8.
- IRS manuals are 42 of the 58 operations documents. FAA text is the other 16. The operations result is not a broad sample of industrial procedures.
- No committed ISO validity window and no explicit authority rank appear in the reference bindings, so those KAR behaviors were not exercised on this corpus.
- The model producer was not scored. Phase 10 does not depend on it.
- The dossier example is one training contract. It shows the workflow. It is not the holdout score.

## Classification

`DOMAIN_PACK_QUALITY_BLOCKED`

KAR and the CEG compiler remain sound: historical gates are green, grounding on this corpus is 100 percent, and invented dates, authority, evidence, and referents are 0. Deterministic relation precision is 65.7, 43.8, and 58.3 percent. Deterministic binding precision is 37.4, 20.7, and 81.0 percent. The release bar is 95 percent relation precision per domain and 99 percent binding precision. The packs do not clear it.

The Evidence Dossier workflow runs and fails closed on a tampered rendering. Reviewed status agreement is 86.4, 89.2, and 83.3 percent, below the 95 percent product bar. That miss is recorded. It is not a reason to change KAR. The next measurement is a new Domain Pack version and a new holdout.

Has semantic production, review, deterministic CEG compilation, and KAR been demonstrated, on real documents not built around the rules, to reliably produce a minimum sufficient evidence set for a practical review workflow? The machinery has been run on those documents, and it abstains when the declared tokens are absent. It has not met the reliability bars this phase set for auto-accepted semantics or for reviewed KAR agreement. The branch is not a v6 release candidate. Version stays `5.5.1`.
