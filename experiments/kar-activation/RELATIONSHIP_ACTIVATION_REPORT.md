# KAR Experiment 3 — blind relationship activation

Commit: `5111fc65f61073ee39cbe4923dc36dec760db5ed`

Seed: `20261009`

Fixtures: `kar-theory-fixtures-1` for the adversarial corpus. Scenario N is padded to 500 documents for this run only.

Instances: 220

Activation version: `kar-activation-blind-1`

## Question

Can deterministic anchors over the claim graph Knolo already stores put the missing opposition and qualifier passages into a depth-50 candidate pool, without the answer key and without a cue dictionary?

Experiment 2 left opposition recall at 78.1% and qualifier recall at 50.0%. Scenario D stayed at 0%. The stored `is` edge was never entered, because production expansion anchors a node only when its label equals a query token or starts with one.

## What the activator was not allowed to see

Relation labels, fact ids, required frontiers, `counterQuery`, and `qualifierQuery` stay inside the evaluator. Strategies receive the query string and `pack.claimGraph`. They do not read raw passage text and they do not rewrite the query with negation morphology.

A source check refuses the activator if it contains the distinctive hidden terms, the withheld field names, or an import of the fixture generator.

## Methods

All retrieval uses the current lexical pipeline, including default pseudo-relevance expansion. Blind strategies add at most 12 content terms. A content term has length at least 4 and is outside the frozen stop list used for overlap. Function words are not emitted. The term set is sorted before the cap. The union is the union of each blind strategy's top 50 with the baseline and the production prefix expander. It does not include the ceiling.

- `baseline`: the original query. This must reproduce the Experiment 1 adversarial opposition recall.
- `prefix`: `expandQueryWithGraph`, the production exact-label and prefix rule. A local mirror must match it on every instance.
- `endpoint`: an edge activates when either endpoint's content tokens intersect the query. Overlap uses tokens of length at least 4 outside a frozen stop list.
- `phrase`: a node activates when a query bigram or trigram occurs as a token sequence in its label, or a label bigram or trigram occurs in the query.
- `reverse`: from production prefix anchors, walk incoming edges and emit the subject side.
- `twohop`: from the union of prefix anchors and endpoint anchors, walk outgoing `is`, `defined_as`, `mentions`, and `ref` edges to depth 2.
- `bridge`: a subject that does not intersect the query is emitted when its object shares at least 2 content tokens with another query-overlapping node, or the Jaccard of those sets is at least 0.5.
- `typed`: bidirectional traversal for `is`, `are`, `defined_as`, and the absent exception, override, and time predicates; outgoing traversal for `mentions` and `ref`. An edge is entered only from an anchored endpoint. No extractor invents these predicates from raw text.
- `union`: the blind candidate pool.
- `ceiling`: every stored edge, with no term cap. This is a visibility diagnostic. It is not an anchoring strategy and it is not in the union.

Recall is fact coverage after retrieval. A frontier with no required facts is omitted from the mean. An empty scored list counts as zero coverage of a required frontier.

Pre-registered gate, fixed before the run:

- Adversarial opposition recall of `union` at depth 50 at least 90%.
- Qualifier recall of `union` at depth 50 at least 85% on instances that require a qualifier.
- Scenario D opposition recall of `union` at depth 50 at least 50%.
- Adversarial support recall of `union` does not fall more than 5 points from the baseline.
- On the padded scenario N, unrequested-contradiction inclusion of `union` at depth 10 is at most 10%. Depths 20 and 50 are reported. A recall pass with a depth-10 damage miss is `PROMISING BUT DAMAGE`, not a reason to write a specification.

## Results

| Strategy | Opposition@50 | Qualifier@50 | Support@50 | Opposition@10 | Opposition@20 |
| --- | --- | --- | --- | --- | --- |
| baseline | 78.1% [72.5%, 83.4%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 96.9% [95.0%, 98.4%] (n=160) | 40.6% [33.4%, 47.5%] (n=160) | 76.3% [70.6%, 81.6%] (n=160) |
| prefix | 78.1% [72.2%, 83.4%] (n=160) | 50.0% [32.5%, 65.0%] (n=40) | 96.9% [94.7%, 98.8%] (n=160) | 40.6% [33.1%, 47.8%] (n=160) | 76.3% [70.3%, 81.6%] (n=160) |
| endpoint | 78.1% [72.5%, 83.1%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 96.9% [95.0%, 98.4%] (n=160) | 40.6% [34.1%, 47.5%] (n=160) | 76.3% [70.3%, 81.9%] (n=160) |
| phrase | 78.1% [72.5%, 83.4%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 96.9% [94.7%, 98.4%] (n=160) | 40.6% [33.8%, 48.1%] (n=160) | 76.3% [69.7%, 81.6%] (n=160) |
| reverse | 78.1% [72.2%, 83.1%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 96.9% [95.0%, 98.4%] (n=160) | 40.6% [33.8%, 48.1%] (n=160) | 76.3% [70.9%, 81.6%] (n=160) |
| twohop | 78.1% [72.8%, 83.4%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 96.9% [94.7%, 98.4%] (n=160) | 40.6% [33.1%, 47.5%] (n=160) | 76.3% [70.3%, 81.9%] (n=160) |
| bridge | 78.1% [72.8%, 83.4%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 96.9% [94.7%, 98.4%] (n=160) | 40.6% [33.7%, 47.8%] (n=160) | 76.3% [70.6%, 81.9%] (n=160) |
| typed | 78.1% [72.8%, 83.8%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 96.9% [95.0%, 98.8%] (n=160) | 40.6% [34.1%, 47.8%] (n=160) | 76.3% [70.6%, 81.9%] (n=160) |
| union | 78.1% [72.8%, 83.8%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 96.9% [94.7%, 98.8%] (n=160) | 40.6% [33.4%, 47.5%] (n=160) | 76.3% [70.0%, 81.6%] (n=160) |
| ceiling | 100.0% [100.0%, 100.0%] (n=160) | 72.5% [59.9%, 85.0%] (n=40) | 96.9% [95.0%, 98.8%] (n=160) | 100.0% [100.0%, 100.0%] (n=160) | 100.0% [100.0%, 100.0%] (n=160) |

Opposition recall by scenario at depth 50:

| Scenario | baseline | prefix | endpoint | phrase | reverse | twohop | bridge | typed | union | ceiling |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| B | 50.0% [50.0%, 50.0%] (n=20) | 50.0% [50.0%, 50.0%] (n=20) | 50.0% [50.0%, 50.0%] (n=20) | 50.0% [50.0%, 50.0%] (n=20) | 50.0% [50.0%, 50.0%] (n=20) | 50.0% [50.0%, 50.0%] (n=20) | 50.0% [50.0%, 50.0%] (n=20) | 50.0% [50.0%, 50.0%] (n=20) | 50.0% [50.0%, 50.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| C | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| D | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| E | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| H | 75.0% [65.0%, 85.0%] (n=20) | 75.0% [62.5%, 87.5%] (n=20) | 75.0% [65.0%, 85.0%] (n=20) | 75.0% [65.0%, 85.0%] (n=20) | 75.0% [62.5%, 85.0%] (n=20) | 75.0% [65.0%, 85.0%] (n=20) | 75.0% [65.0%, 85.0%] (n=20) | 75.0% [62.5%, 85.0%] (n=20) | 75.0% [65.0%, 85.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| I | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| J | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| N | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a | n/a |

Baseline reproduction against the Experiment 1 opposition figure of 78.1%: delta 0.0000.

## What the anchors emitted

| Strategy | Mean extra terms | Mean anchored nodes | Mean edges touched | Instances with any extra term |
| --- | --- | --- | --- | --- |
| endpoint | 0.36 | 0.18 | 0.09 | 20 |
| phrase | 0.09 | 0.09 | 0.09 | 20 |
| reverse | 0.00 | 0.00 | 0.00 | 0 |
| twohop | 0.36 | 0.18 | 0.09 | 20 |
| bridge | 0.00 | 0.09 | 0.00 | 0 |
| typed | 0.27 | 0.09 | 0.09 | 20 |

Production `expandQueryWithGraph` changed 0 of 220 queries.

## Claim graph

Mean nodes 2.92. Mean edges 1.69.

Predicate totals across packs:

- `is`: 371

Example stored `is` edge whose object shares no query token, from the first pack that has one: the master subscription is non-terminable and irrevocable under a minimum annual commitment for the committed renewal cycle.

Ceiling opposition rank, adversarial instances that require opposition: scored 160 of 160, median rank 1, inside rank 10 on 160. Baseline opposition inside rank 10: 76 of 160.

Ceiling qualifier rank, instances that require a qualifier: scored 29 of 40, median rank 10, inside rank 10 on 16. A depth-50 hit with a deep median rank is a weak tail score inside a short list, not a top-of-list term match.

## Negative control

Scenario N is padded with warehouse notes to 500 documents. The notes are not definitional sentences. The original unrequested contradiction and the high-lex decoy stay in the corpus. Mean baseline rank of the unrequested contradiction, when it receives a score: 10.00. Instances where it receives no score: 0.

| Depth | Baseline unrequested | Union unrequested | Ceiling unrequested | Baseline irrelevant | Union support |
| --- | --- | --- | --- | --- | --- |
| 10 | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| 20 | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| 50 | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |

The union inclusion rate equals the baseline rate at every depth. The anchors do not add the unrequested contradiction. Its mean baseline rank is 10, and none of the negative instances leave it unscored. Warehouse padding does not enter the scored list, so the 500-document corpus still has a short scored list and depth 10 contains that contradiction for the original query.

## Decision

FAIL

Blind union opposition recall at depth 50 is 78.1%. Qualifier recall is 50.0%. Scenario D opposition recall is 0.0%. Support recall changes by 0.0% relative to the baseline. The gate asked for at least 90% opposition, 85% qualifier, scenario D at least 50%, and support within 5 points of the baseline. The all-edges ceiling reaches scenario D opposition recall 100.0%. Those definitional edges are stored. The blind anchors do not reach them. The ceiling qualifier recall at depth 50 is 72.5%. Among 40 instances that require a qualifier, the ceiling places that passage inside rank 10 on 16 and gives it any score on 29. Median rank when scored: 10. On the 500-document negative corpus, unrequested-contradiction inclusion for the blind union is 100.0% at depth 10, 100.0% at depth 20, and 100.0% at depth 50. Scenario D stays below the pre-registered bar. Exact and prefix anchors, endpoint overlap, phrase anchors, reverse edges, two-hop closure, structural bridges, and typed traversal do not put that lexically disconnected contradiction into the candidate pool. The exception, override, and time predicates the typed rule knows how to walk do not occur in these packs. This run does not design that layer and does not write a KAR specification.

## What this does not do

This experiment does not design KAR, does not add relation types to the extractor, and does not treat a hand-authored opposing query or a cue list as a generator. The minimum-set selector remains the Experiment 1 reference. Raw-text negation rewriting stays retired.
