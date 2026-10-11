# KAR Experiment 2 — blind frontier discovery

Commit: `5111fc65f61073ee39cbe4923dc36dec760db5ed`

Seed: `20261009`

Fixtures: `kar-theory-fixtures-1` (the Experiment 1 corpus, unchanged)

Instances: 220

Frontier version: `kar-frontier-blind-1`

## Question

Can a deterministic generator, using only the original query and information Knolo already has, put the missing opposition and qualifier passages into a depth-50 candidate pool?

The Experiment 1 baseline on this corpus is opposition recall 78.1% at depth 50 and at depth 100, and qualifier recall 50.0%. Depth did not close the gap. The passages never received a lexical score.

## What the generator was not allowed to see

Relation labels, fact ids, required frontiers, `counterQuery`, and `qualifierQuery` stay inside the evaluator. The ranker receives `id`, `heading`, and `text`. The generators receive the query string and, for cue harvest only, that same raw text.

A source check refuses the generator file if it contains the distinctive hidden terms or the names of the withheld fields. Harvested terms may still coincide with hidden wording when a document's own sentence contains a frozen cue. Those coincidences are reported. They are not copied from the answer key into the source.

## Methods

All methods use the current lexical pipeline, including default pseudo-relevance expansion. Graph expansion stays off except in the one method that turns on the production expander.

- `baseline`: the original query. This must reproduce the Experiment 1 recall.
- `graph`: the original query with `graph.expand: true`, which calls `expandQueryWithGraph` on the claim graph `buildPack` already stores.
- `morphology`: rewrites of the query's own tokens (`non-`, `cannot`, `may not`, `no`, `prohibited`, `without`). No corpus.
- `cues`: the frozen cue list as a query, with no query-topic terms added.
- `cue-harvest`: up to 8 terms from sentences that contain a frozen cue, counted across the raw texts.
- `union`: the union of the top 50 blocks from baseline, graph, morphology, cues, and cue-harvest. This is the blind discovery pool. Each frontier contributes depth 50. The union can be larger than 50.

Recall is fact coverage of that pool, using fixture labels only after retrieval. A frontier with no required facts is omitted from the mean. An empty scored list counts as zero coverage of a required frontier.

Pre-registered gate, fixed before the run:

- Adversarial opposition recall of `union` at least 90%.
- Qualifier recall of `union` at least 85% on instances that require a qualifier.
- On scenario N, the union puts an unrequested contradiction in the pool on at most 10% of instances, and support recall does not fall more than 5 points from the baseline.

A miss means this corpus does not support raw-text deterministic discovery. It does not by itself design a claim layer.

## Results

| Frontier | Opposition recall@50 | Qualifier recall@50 | Support recall@50 |
| --- | --- | --- | --- |
| baseline | 78.1% [72.5%, 83.1%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 96.9% [95.0%, 98.4%] (n=160) |
| graph | 78.1% [72.8%, 83.4%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 96.9% [94.7%, 98.8%] (n=160) |
| morphology | 78.1% [72.2%, 84.4%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 96.9% [95.0%, 98.4%] (n=160) |
| cues | 75.0% [67.5%, 81.9%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 62.5% [55.0%, 69.4%] (n=160) |
| cue-harvest | 75.0% [68.1%, 81.3%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 67.5% [60.0%, 74.4%] (n=160) |
| union | 84.4% [78.8%, 89.7%] (n=160) | 50.0% [32.5%, 65.0%] (n=40) | 96.9% [94.7%, 98.8%] (n=160) |

Opposition recall by scenario, adversarial scenarios plus N:

| Scenario | baseline | graph | morphology | cues | cue-harvest | union |
| --- | --- | --- | --- | --- | --- | --- |
| A | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| B | 50.0% [50.0%, 50.0%] (n=20) | 50.0% [50.0%, 50.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| C | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| D | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) |
| E | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| H | 75.0% [65.0%, 85.0%] (n=20) | 75.0% [65.0%, 85.0%] (n=20) | 25.0% [12.5%, 35.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 75.0% [65.0%, 85.0%] (n=20) |
| I | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| J | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| N | n/a | n/a | n/a | n/a | n/a | n/a |

Baseline reproduction against the Experiment 1 opposition figure of 78.1%: delta 0.0000.

## What moved

The union's opposition recall is 6.3 percentage points above the baseline. The scenarios where the union mean differs from the baseline are: B from 50.0% to 100.0%. Unchanged scenarios: A, C, D, E, H, I, J.

That lift is scenario B. Its baseline opposition coverage is 50.0%. Morphology, the cue list, cue harvest, and the union all reach 100.0%. Qualifier recall is unchanged at 50.0% for every method. The opposition lift does not bring the qualifier passages in. The buried B contract is the fixture sentence that already contains the frozen cue `cannot`. Harvest terms that appear in exactly 20 instances are `annual`, `early`, `enterprise`, `master`, `orders`, `terminate`, `terms`. Record-level counts put every one of those terms on scenario B only. They are neighbors of that cue in the passage text. They were not written into the generator.

Scenario D stays at 0.0% on the baseline and 0.0% on the union. Every individual method is in the table. The passage that Experiment 1 could retrieve only with a hand-built query is still outside every blind frontier.

Scenario H baseline opposition coverage is 75.0%. Morphology is 25.0%. The cue list is 0.0%. The union stays at 75.0%. On the instance records, the even variations are full coverage for the baseline and the union, and zero for morphology. The odd variations stay at half coverage for the baseline, morphology, and the union, and fall to zero for the cue list. The union keeps the baseline list, so H does not get worse in the union and does not get better. Morphology's gain on B is offset, in the morphology row, by that even-H loss. The morphology mean matches the baseline mean.

The graph row matches the baseline on every adversarial scenario. `expandQueryWithGraph` changed 0 queries.

## Claim graph

Packs that contain a claim graph: 220 of 220. Mean nodes 2.9. Mean edges 1.7. Mean `is` edges 1.7.

Queries changed by `expandQueryWithGraph`: 0 of 220.

`is` edges whose object label shares no token with the query: mean 1.7 per pack. These edges are stored from definitional sentences in the document text. The production expander walks out only from labels that equal or start with a query token, so an edge from "master subscription" to a definition is invisible to the query "customer cancel agreement".

Example unreached `is` edge, taken from the first pack that has one: the master subscription is non-terminable and irrevocable under a minimum annual commitment for the committed renewal cycle.

## Negative control

Scenario N has no required opposition. An unrequested contradiction is in the corpus.

| Pool | Unrequested contradiction in the pool | Irrelevant passage in the pool | Support recall |
| --- | --- | --- | --- |
| Baseline top 50 | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| Blind union | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |

The union rate matches the baseline rate, and support recall does not fall. On N-00 the corpus has 31 passages and the original query scores 10 of them. The unrequested contradiction shares no query token. With pseudo-relevance expansion left on, it still receives a weak score and sits at rank 10, so a depth-50 cutoff includes it. With expansion off, that passage is not scored. The irrelevant decoy is written to repeat the query, so the baseline pool contains it for an ordinary lexical match. The absolute 10% gate therefore fails on the baseline pool. The frontier union does not add either passage beyond that pool.

## Harvested terms

Most common cue-harvest terms across instances, with the number of instances that emitted each term:

- `confirms` in 160 instances
- `policy` in 160 instances
- `special` in 160 instances
- `without` in 160 instances
- `annual` in 20 instances
- `early` in 20 instances
- `enterprise` in 20 instances
- `master` in 20 instances
- `orders` in 20 instances
- `terminate` in 20 instances
- `terms` in 20 instances

Mean cue sentences per instance: 6.03.

## Decision

FAIL

The blind union reaches opposition recall 84.4% and qualifier recall 50.0%. The gate asked for at least 90% and 85%. Negative-control unrequested inclusion is 100.0% in the union and 100.0% in the baseline top 50. Support recall on N changes by 0.0% relative to the baseline. The per-method table is the measurement of what each frontier moved. The definitional edges stored in the pack stay unreached when `expandQueryWithGraph` changes no query, because the expander only walks labels that match the query. On this evidence, raw-text deterministic discovery does not meet the recall target. Frontier discovery still needs a relationship layer that connects the question to those edges. This run does not design that layer.

## What this does not do

This experiment does not design KAR, does not change retrieval defaults, and does not treat a hand-authored opposing query as a generator. The exact set selector remains the Experiment 1 reference. A greedy approximation was already close to it at K = 5 when labels were supplied. Discovery is the open half.
