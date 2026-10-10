# KAR theory validation

Commit: `5111fc65f61073ee39cbe4923dc36dec760db5ed`

Seed: `20261009`

Generator: `kar-theory-fixtures-1`

Instances: 220

Retrieval implementation measured: current `packages/core/src` compiled into a temporary build. The committed `packages/core/dist` is stale relative to that source (`query.js` does not yet call `createLegacyLexicalPostingsReader`). The experiment did not modify or publish that dist.

## Executive conclusion

PROMISING BUT BLOCKED

Review override of the harness label. The pre-registered rules returned GO because the lexical-pool oracle beat raw BM25L top-k by more than 20 points. Knolo does not stop at raw top-k. It already runs MMR. On all 160 adversarial instances, production MMR and the label-aware lexical-pool oracle completed the evidence set on the same instances, both at 68.8%. Selected ids often differed. Completion did not. A minimum-set selector placed on today's candidate list did not show a retrieval capability beyond the diversifier that already ships.

The minimum-set result itself stands. With the whole corpus visible, the oracle reaches 100% adversarial dual success against top-k at 31.3% and MMR at 68.8%. With a hand-authored opposing query, union top-k dual success is 56.3% and the oracle on that same union is 81.3%. On the 110 adversarial instances where top-k fails and the ceiling oracle succeeds, top-k averages 4.73 passages, redundancy 0.818, and 4.5% opposition coverage. The oracle averages 2.45 passages, redundancy 0.095, and covers the required frontiers. Relevance rank and evidence sufficiency are different objectives. nDCG still favors top-k.

What the gates did not show is a way to find the missing passages. Opposition recall is 78.1% at depth 50 and 78.1% at depth 100. Qualifier recall is 50%. The missing documents never receive a lexical score. The counter-query that lifts opposition recall to 100% uses the hidden evidence's own terms. The next measurement is whether a deterministic frontier generator can do that without those terms, without `counterQuery`, and without the fixture relation labels. That measurement is Experiment 2. This file does not start a KAR-1 design.

Baseline false-sufficiency in the tables treats every non-empty BM25 or MMR hit list as a claim that the evidence is sufficient. Those rankers do not make that claim. KAR's 0% false sufficiency is a check that the selector abstains when the fixture floors fail. It is not evidence about unsupported answers from a label-free system. Leave both figures out of any public or filing use.

The pre-registered gates at K = 5 pass on this commit. On the 180 instances whose ceiling corpus contains a feasible set, KAR-ORACLE dual coverage exceeds BM25L top-k by 61.1 percentage points (95% interval 54.4 to 68.3). The same comparison against production MMR is 27.8 points (interval 20.6 to 33.9). On the 160 adversarial instances, the normal-query top-50 pool plus the oracle exceeds top-k by 37.5 points of dual success (interval 30.0 to 45.0) and 34.4 points of opposition coverage (interval 26.9 to 42.2). Oracle false sufficiency is 0 of 220. The 40 intentional gaps abstain in every case. One hundred repeated executions and the replay digests have 0 mismatches. The negative-control selector returns one support passage and leaves the unrequested contradiction out, including when the hand-authored counter-query has retrieved it.

Those gates give the selector fixture relation and fact labels. The ceiling comparison answers Hypothesis A under that answer key. It answers how the set should be chosen once every passage is already a candidate.

Production MMR and the lexical-pool oracle have the same adversarial dual-success rate at K = 5, 68.8%, and the same rate in every scenario class. On scenarios A, E, and I the gain over raw top-k is the gain MMR already produces: near-duplicate supports collapse, and a contradiction that is already in the short scored list takes a freed slot. The ceiling's remaining advantage over MMR is 50 instances: all 20 of scenario B, all 20 of scenario D, and the 10 odd variations of scenario H. In those instances at least one required passage never receives a lexical score. A selector that can see only the current candidate list has nothing to select.

Scenario D shows the split cleanly. The contradiction is absent from the scored list at every depth. The hand-authored counter-query puts it in the union. Top-k on that union covers opposition and loses support, so dual success stays 0%. The oracle on the same union covers both, so dual success is 100%. Scenario B's qualifier stays out of the normal list and out of the counter-query list. A third hand-authored qualifier query is what makes B feasible. This report stops before any KAR-1 design. A later design would have to replace the fixture labels, and it would still need a way to surface passages that share no scored terms with the question.

## Repository baseline

The measured retrieval path is pack query, plan version `retrieval-v4.0`. On this commit the default `query()` walk is:

1. Tokenize with NFKD, diacritic folding, lowercasing, and hyphen-preserving splits. There is no stemmer and no stopword list.
2. Collect lexical postings for query terms. V4 fielded chunks can add a field score.
3. Enforce namespace, source, and required-phrase constraints.
4. Rank with BM25L (`k1=1.5`, `b=0.75`), a bounded proximity multiplier, heading overlap, and a small field score.
5. Expand the query with pseudo-relevance feedback from the top 3 blocks and up to 4 new terms at weight 0.35. This expansion is on by default.
6. Optionally rerank with a semantic sidecar. Semantic rerank is off unless requested. This experiment left it off. No vector database was added.
7. Take the top `5K` scored blocks and run near-duplicate suppression plus MMR (`lambda=0.8`, 5-gram Jaccard cutoff 0.92). Tie-breaks are higher score, then lower block id.

`DOCS.md` still lists a KNS signature as a rank tie-break. Current `query()` does not apply `knsSignature`. The comment in `query.ts` says scores are not modified by that signature. Block id is the tie-break. The experiment follows the code.

Claim-graph expansion exists in `expandQueryWithGraph` and is off unless `graph.expand` is set. Default builds still store a claim graph. The experiment left graph expansion off, which is the production default.

V5 `queryKnowledgeImageV5` is a different operation: deterministic EQL filter, order, and limit over Knowledge Image objects. It is not the BM25 passage ranker. This experiment did not build a V5 image, did not change image bytes, and did not emit a V5 state root.

`@knolo/evidence-gate` checks host-supplied claim relations against a verified V5 image. It does not retrieve passages and it does not label support or contradiction. The benchmark labels were written in the fixture generator.

A representative plan from the first instance has `generate=["lexical-postings","pseudo-relevance-expansion","fielded-chunks"]`, `rescore=["bm25l","proximity","heading"]`, `diversify=stable-id-mmr-v1`, `expand={"enabled":true,"graph":false}`, and `planHash=sha256-9da26999a8b189cd886e1908cac0b1b306d17c7d7815b9f53947f19997f6e947`.

## Hypotheses

Hypothesis A, evidence-set selection: once a candidate pool already contains the required support, opposition, and qualifier passages, does a minimum dual-frontier set beat BM25L top-k and the current MMR selector at the same evidence budget?

Hypothesis B, counter-evidence discovery: does the current lexical pipeline place materially contradictory or qualifying passages into a practical candidate pool when those passages use weaker query vocabulary than repeated supporting passages?

These hypotheses are scored separately. The selectors use fixture relation and fact labels. That is a selection ceiling. It is not a claim that the pipeline knows those labels.

## Experimental methodology

The corpus is a deterministic synthetic generator, version `kar-theory-fixtures-1`, seed `20261009`, 20 variations of scenarios A through J plus a negative-control scenario N. Relation labels are fixture fields: support, contradict, qualify, independent, and irrelevant. No model labeled them.

Required facts define three frontiers. Coverage is the size of the union of applicable facts in the selected set divided by the number of required facts. A frontier with no required facts is N/A and is omitted from the denominator. A passage contributes facts only on its own frontier, and only when it is applicable at the fixture `asOf` date, is not marked unauthorized, and meets `minAuthority` when that floor is set.

Primary floors are tau = 1, gamma = 1, and qualifier floor 1. The budget is the maximum set size. Compared budgets are K = 2, 3, 4, 5, 8, and 10. Primary tables use K = 5. Candidate depths are 10, 20, 50, and 100. Primary pool depth is 50.

KAR-ORACLE keeps at most one applicable passage per distinct fact mask in the selected set. Two passages with the same mask cannot both appear in a minimum cover, because dropping one preserves coverage and reduces size. The walk still tries each member of a mask group, because redundancy, authority, and passage id can differ. The exact walk then applies this lexicographic order among sets that meet the floors and fit in K: higher opposition coverage, higher support coverage, higher qualifier coverage, fewer inapplicable passages, smaller size, lower redundancy, higher total authority, then the lexicographically smaller sorted passage-id list. An independent dynamic program over fact masks checks feasibility. The run aborts if the two disagree. If no set meets the floors, the result is `UNSATISFIED_EVIDENCE_REQUIREMENTS` and the emitted set is empty. That means required evidence was not found within the declared corpus or candidate universe. It does not mean no such evidence exists anywhere.

Redundancy is the mean pairwise Jaccard similarity of the sets of production tokenizer tokens. A set of size 0 or 1 has redundancy 0.

KAR-GREEDY adds the candidate with the largest number of newly covered opposition facts, then support facts, then qualifier facts. Ties break on applicability, lower redundancy, higher authority, then id. It abstains when the floors are still unmet at size K.

Baselines:

- B0 is BM25L top-k from the pre-MMR ranking, using the same ranker as `query()`.
- B1 is `query()` itself, including default expansion and MMR.
- B1pool, reported at K = 5, runs the repository MMR function on the full corpus pool.
- B2 runs KAR-ORACLE and KAR-GREEDY on the lexical top-D pool of the normal query only.
- B4 unions the lexical top-D pools of the normal query and a hand-authored `counterQuery`, then runs the selectors. B4-TOPK takes the top K of that union by the better lexical score. The counter-query is a probe, not a proposed generator.
- A qualifier-query probe unions a third hand-authored query at depth 50. It is diagnostic only.

The lexical mirror was checked against `query()` on every instance at K = 3, 5, and 10. Parity mismatches: 0.

Decision rules were fixed before reading the aggregate tables:

- Gate 1 uses K = 5 and only instances whose ceiling pool has a feasible set. The point estimate of KAR-ORACLE dual success must beat B0 by at least 20 percentage points. The 95% bootstrap interval of that delta must lie above 0. An interval that includes 0 is INCONCLUSIVE even if the point estimate clears 20 points. An interval that crosses 20 points but stays above 0 still uses the point estimate.
- Gate 2 is opposition coverage on scenarios A, B, C, D, E, H, I, and J. B2 must beat B0 by at least 20 points to count as end-to-end discovery. B4 counts as a research signal if its opposition delta is at least 20 points or its absolute opposition coverage is at least 70%.
- Gate 3: ceiling oracle false sufficiency is 0. A failure here is treated as a harness problem (INCONCLUSIVE), not as a scientific NO-GO, until the selector and the metric are shown to disagree for a real reason.
- Gate 4: scenarios F and G abstain at least 95% of the time.
- Gate 5: 100 repeated executions of one instance per scenario have 0 mismatches. Shuffle changes to BM25 block-id ties are recorded separately and do not by themselves fail this gate.
- Negative control N must not abstain above 5%, must not include an unrequested contradiction or irrelevant passage above 10%, and must keep mean set size at or below 1.25. Harm on the ceiling selector is a NO-GO. Harm that appears only on B4 blocks using B4 as a drop-in. It does not by itself reject the selection objective.
- GO requires the ceiling gates, a confidence interval above 0, a clean negative control, and a B2 gain of at least 20 points on both dual success and opposition coverage.
- PROMISING BUT BLOCKED requires those ceiling gates without the B2 gain, plus the B4 research signal above.
- A ceiling miss whose interval excludes 0 is NO-GO. Discovery that stays weak even with the hand-authored opposing query is NO-GO.
- Bootstrap intervals use 1000 resamples and seed 20261009. Decision reason: ceiling and normal lexical discovery both cleared the gates.

## Results

Primary budget K = 5. Means are paired with 95% percentile bootstrap intervals.

### Ceiling pool at K = 5

This pool is the whole fixture corpus. KAR may select a passage the lexical ranker never scored. B0 and B1 may not.

Metric | B0 | B1 | B1pool | ORACLE | GREEDY
--- | --- | --- | --- | --- | ---
Support coverage | 85.5% [80.9%, 89.8%] (n=220) | 90.0% [86.1%, 93.6%] (n=220) | 92.3% [88.6%, 95.5%] (n=220) | 81.8% [76.8%, 87.3%] (n=220) | 81.8% [76.4%, 87.3%] (n=220)
Opposition coverage | 27.5% [21.8%, 33.8%] (n=200) | 64.0% [57.5%, 70.3%] (n=200) | 70.3% [64.2%, 76.3%] (n=200) | 80.0% [74.5%, 85.5%] (n=200) | 80.0% [74.5%, 85.5%] (n=200)
Qualifier coverage | 21.7% [10.9%, 34.8%] (n=46) | 43.5% [28.3%, 58.7%] (n=46) | 43.5% [30.4%, 58.7%] (n=46) | 87.0% [76.1%, 95.7%] (n=46) | 87.0% [76.1%, 95.7%] (n=46)
Dual coverage success | 31.8% [25.9%, 37.7%] (n=220) | 59.1% [53.6%, 65.5%] (n=220) | 63.6% [57.3%, 69.6%] (n=220) | 81.8% [76.8%, 87.3%] (n=220) | 81.8% [76.4%, 86.8%] (n=220)
Mean set size | 4.73 [4.63, 4.81] (n=220) | 3.05 [2.90, 3.20] (n=220) | 5.00 [5.00, 5.00] (n=220) | 1.82 [1.69, 1.95] (n=220) | 1.86 [1.72, 2.01] (n=220)
Redundancy | 0.74 [0.71, 0.78] (n=220) | 0.22 [0.20, 0.25] (n=220) | 0.18 [0.16, 0.21] (n=220) | 0.06 [0.05, 0.07] (n=220) | 0.06 [0.05, 0.06] (n=220)
False sufficiency | 68.2% [61.8%, 73.6%] (n=220) | 40.9% [35.0%, 47.3%] (n=220) | 36.4% [30.5%, 42.7%] (n=220) | 0.0% [0.0%, 0.0%] (n=220) | 0.0% [0.0%, 0.0%] (n=220)
False absence | 0.0% [0.0%, 0.0%] (n=220) | 0.0% [0.0%, 0.0%] (n=220) | 0.0% [0.0%, 0.0%] (n=220) | 0.0% [0.0%, 0.0%] (n=220) | 0.0% [0.0%, 0.0%] (n=220)
Abstention rate | 0.0% [0.0%, 0.0%] (n=220) | 0.0% [0.0%, 0.0%] (n=220) | 0.0% [0.0%, 0.0%] (n=220) | 18.2% [12.7%, 23.2%] (n=220) | 18.2% [13.2%, 23.2%] (n=220)
nDCG | 0.79 [0.75, 0.84] (n=220) | n/a | n/a | 0.53 [0.49, 0.57] (n=220) | n/a

### Lexical candidate pool at depth 50, K = 5

B2. The selector sees only what the normal query returned.

Metric | ORACLE | GREEDY
--- | --- | ---
Support coverage | 59.1% [52.7%, 65.5%] (n=220) | 59.1% [52.3%, 65.9%] (n=220)
Opposition coverage | 55.0% [47.5%, 61.5%] (n=200) | 55.0% [47.0%, 62.0%] (n=200)
Qualifier coverage | 43.5% [30.4%, 56.5%] (n=46) | 43.5% [30.4%, 56.6%] (n=46)
Dual coverage success | 59.1% [52.3%, 65.5%] (n=220) | 59.1% [52.3%, 65.5%] (n=220)
Mean set size | 1.27 [1.13, 1.43] (n=220) | 1.27 [1.12, 1.43] (n=220)
Redundancy | 0.05 [0.04, 0.06] (n=220) | 0.05 [0.04, 0.06] (n=220)
False sufficiency | 0.0% [0.0%, 0.0%] (n=220) | 0.0% [0.0%, 0.0%] (n=220)
False absence | 0.0% [0.0%, 0.0%] (n=220) | 0.0% [0.0%, 0.0%] (n=220)
Abstention rate | 40.9% [34.5%, 47.7%] (n=220) | 40.9% [35.4%, 47.7%] (n=220)
nDCG | n/a | n/a

### Normal query union counter-query, depth 50, K = 5

B4. TOPK is ordinary top-k over that union, so it separates "the extra query found the passage" from "the set selector was necessary".

Metric | ORACLE | GREEDY | TOPK
--- | --- | --- | ---
Support coverage | 68.2% [62.3%, 74.1%] (n=220) | 68.2% [62.3%, 74.1%] (n=220) | 85.5% [80.9%, 90.0%] (n=220)
Opposition coverage | 65.0% [59.0%, 72.5%] (n=200) | 65.0% [58.5%, 71.5%] (n=200) | 86.5% [81.5%, 91.0%] (n=200)
Qualifier coverage | 43.5% [30.4%, 56.5%] (n=46) | 43.5% [30.4%, 58.7%] (n=46) | 0.0% [0.0%, 0.0%] (n=46)
Dual coverage success | 68.2% [61.8%, 74.5%] (n=220) | 68.2% [62.3%, 74.1%] (n=220) | 50.0% [43.2%, 57.3%] (n=220)
Mean set size | 1.45 [1.32, 1.60] (n=220) | 1.45 [1.30, 1.60] (n=220) | 4.82 [4.77, 4.87] (n=220)
Redundancy | 0.06 [0.05, 0.07] (n=220) | 0.06 [0.05, 0.07] (n=220) | 0.49 [0.47, 0.51] (n=220)
False sufficiency | 0.0% [0.0%, 0.0%] (n=220) | 0.0% [0.0%, 0.0%] (n=220) | 50.0% [43.2%, 56.4%] (n=220)
False absence | 0.0% [0.0%, 0.0%] (n=220) | 0.0% [0.0%, 0.0%] (n=220) | 0.0% [0.0%, 0.0%] (n=220)
Abstention rate | 31.8% [25.9%, 37.7%] (n=220) | 31.8% [26.4%, 38.2%] (n=220) | 0.0% [0.0%, 0.0%] (n=220)
nDCG | n/a | n/a | n/a

### Qualifier-query probe at K = 5

Metric | ORACLE
--- | ---
Support coverage | 77.3% [71.4%, 82.7%] (n=220)
Opposition coverage | 75.0% [68.5%, 81.0%] (n=200)
Qualifier coverage | 87.0% [78.3%, 95.7%] (n=46)
Dual coverage success | 77.3% [71.8%, 82.3%] (n=220)
Mean set size | 1.73 [1.59, 1.86] (n=220)
Redundancy | 0.06 [0.05, 0.07] (n=220)
False sufficiency | 0.0% [0.0%, 0.0%] (n=220)
False absence | 0.0% [0.0%, 0.0%] (n=220)
Abstention rate | 22.7% [17.3%, 28.6%] (n=220)
nDCG | n/a

### Adversarial budget curve

Scenarios A, B, C, D, E, H, I, and J. Opposition is eligible and required. Scenarios F, G, and N are excluded here and reported below.

| K | K=2 | K=3 | K=4 | K=5 | K=8 | K=10 |
| --- | --- | --- | --- | --- | --- | --- |
| B0 dual success | 0.0% [0.0%, 0.0%] (n=160) | 12.5% [7.5%, 18.1%] (n=160) | 25.0% [18.1%, 31.3%] (n=160) | 31.3% [24.4%, 38.8%] (n=160) | 31.3% [23.8%, 38.1%] (n=160) | 33.8% [26.3%, 41.3%] (n=160) |
| B1 production MMR dual success | 13.8% [9.4%, 19.4%] (n=160) | 36.9% [29.4%, 44.4%] (n=160) | 60.6% [53.1%, 68.1%] (n=160) | 68.8% [61.9%, 75.6%] (n=160) | 68.8% [61.3%, 75.6%] (n=160) | 68.8% [61.3%, 75.6%] (n=160) |
| Ceiling oracle dual success | 62.5% [54.4%, 70.0%] (n=160) | 100.0% [100.0%, 100.0%] (n=160) | 100.0% [100.0%, 100.0%] (n=160) | 100.0% [100.0%, 100.0%] (n=160) | 100.0% [100.0%, 100.0%] (n=160) | 100.0% [100.0%, 100.0%] (n=160) |
| Ceiling greedy dual success | 62.5% [55.0%, 70.0%] (n=160) | 93.8% [89.4%, 96.9%] (n=160) | 100.0% [100.0%, 100.0%] (n=160) | 100.0% [100.0%, 100.0%] (n=160) | 100.0% [100.0%, 100.0%] (n=160) | 100.0% [100.0%, 100.0%] (n=160) |
| B2 lexical-pool oracle dual success | 43.8% [35.6%, 51.3%] (n=160) | 68.8% [61.3%, 76.3%] (n=160) | 68.8% [61.3%, 76.3%] (n=160) | 68.8% [61.3%, 76.3%] (n=160) | 68.8% [61.3%, 76.3%] (n=160) | 68.8% [61.2%, 76.3%] (n=160) |
| B4 dual-query oracle dual success | 56.3% [48.1%, 63.7%] (n=160) | 81.3% [75.6%, 86.9%] (n=160) | 81.3% [75.0%, 87.5%] (n=160) | 81.3% [75.0%, 86.9%] (n=160) | 81.3% [75.6%, 86.9%] (n=160) | 81.3% [75.0%, 87.5%] (n=160) |
| B4 dual-query top-k dual success | 25.0% [18.8%, 31.9%] (n=160) | 43.8% [35.6%, 51.9%] (n=160) | 50.0% [42.5%, 57.5%] (n=160) | 56.3% [48.7%, 63.7%] (n=160) | 62.5% [55.0%, 69.4%] (n=160) | 75.0% [68.7%, 81.9%] (n=160) |
| B0 opposition coverage | 3.1% [1.3%, 5.0%] (n=160) | 15.6% [10.6%, 20.9%] (n=160) | 34.4% [27.2%, 41.3%] (n=160) | 34.4% [27.5%, 41.6%] (n=160) | 36.3% [29.7%, 43.1%] (n=160) | 40.6% [33.8%, 48.1%] (n=160) |
| Ceiling oracle opposition coverage | 62.5% [55.0%, 70.0%] (n=160) | 100.0% [100.0%, 100.0%] (n=160) | 100.0% [100.0%, 100.0%] (n=160) | 100.0% [100.0%, 100.0%] (n=160) | 100.0% [100.0%, 100.0%] (n=160) | 100.0% [100.0%, 100.0%] (n=160) |
| B2 opposition coverage | 43.8% [35.6%, 51.9%] (n=160) | 68.8% [61.3%, 75.6%] (n=160) | 68.8% [61.9%, 76.3%] (n=160) | 68.8% [61.9%, 76.3%] (n=160) | 68.8% [61.3%, 75.6%] (n=160) | 68.8% [62.5%, 75.6%] (n=160) |
| B4 opposition coverage | 56.3% [48.8%, 64.4%] (n=160) | 81.3% [75.0%, 86.9%] (n=160) | 81.3% [74.4%, 86.9%] (n=160) | 81.3% [75.0%, 86.9%] (n=160) | 81.3% [75.6%, 87.5%] (n=160) | 81.3% [75.6%, 86.9%] (n=160) |
| Conditional ceiling dual delta vs B0 | 100.0% [100.0%, 100.0%] (n=100) | 87.5% [81.9%, 92.5%] (n=160) | 75.0% [68.7%, 81.3%] (n=160) | 68.8% [61.3%, 76.3%] (n=160) | 68.8% [61.9%, 75.6%] (n=160) | 66.3% [58.8%, 73.1%] (n=160) |
| Feasible adversarial n | 100 | 160 | 160 | 160 | 160 | 160 |

### OppositionRecall and candidate recall

Opposition coverage of the emitted set is the experiment's OppositionRecall@K. Abstention contributes 0. Candidate recall is different: it asks whether any prefix of the lexical ranking covers the required facts, before set selection. Depth 100 is the whole scored list when the pack has fewer than 100 blocks that share a query or expansion term. Corpus sizes:

| Scenario | Corpus size mean | Scored blocks mean |
| --- | --- | --- |
| A | 118.2 (n=20) | 17.1 (n=20) |
| B | 92.8 (n=20) | 9.8 (n=20) |
| C | 36.5 (n=20) | 5.5 (n=20) |
| D | 51.0 (n=20) | 9.0 (n=20) |
| E | 135.2 (n=20) | 14.2 (n=20) |
| F | 28.0 (n=20) | 7.0 (n=20) |
| G | 30.0 (n=20) | 9.0 (n=20) |
| H | 26.0 (n=20) | 3.0 (n=20) |
| I | 33.0 (n=20) | 12.0 (n=20) |
| J | 20.0 (n=20) | 4.0 (n=20) |
| N | 31.0 (n=20) | 10.0 (n=20) |
| all | 54.7 (n=220) | 9.2 (n=220) |

| Depth | Adversarial support | Adversarial opposition | Adversarial qualifier | Opposition after counter-query union |
| --- | --- | --- | --- | --- |
| 10 | 96.9% [95.0%, 98.4%] (n=160) | 40.6% [33.4%, 47.5%] (n=160) | 25.0% [12.5%, 37.5%] (n=40) | 100.0% [100.0%, 100.0%] (n=160) |
| 20 | 96.9% [94.7%, 98.4%] (n=160) | 76.3% [70.3%, 81.6%] (n=160) | 47.5% [32.5%, 62.5%] (n=40) | 100.0% [100.0%, 100.0%] (n=160) |
| 50 | 96.9% [95.0%, 98.8%] (n=160) | 78.1% [72.5%, 83.4%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 100.0% [100.0%, 100.0%] (n=160) |
| 100 | 96.9% [95.0%, 98.8%] (n=160) | 78.1% [72.5%, 83.4%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 100.0% [100.0%, 100.0%] (n=160) |

Gate values at K = 5, depth 50:

| Check | Result |
| --- | --- |
| Ceiling conditional dual delta vs B0 | 61.1% [54.4%, 68.3%] (n=180) on n=180 |
| Ceiling conditional dual delta vs production MMR | 27.8% [20.6%, 33.9%] (n=180) |
| Lexical-pool conditional dual delta vs B0 | 46.2% [37.7%, 54.6%] (n=130) on n=130 |
| B2 unconditional adversarial dual delta | 37.5% [30.0%, 45.0%] (n=160) |
| Ceiling adversarial opposition delta | 65.6% [58.4%, 72.8%] (n=160) |
| B2 adversarial opposition delta | 34.4% [26.9%, 42.2%] (n=160) |
| B4 adversarial opposition delta | 46.9% [38.1%, 55.3%] (n=160) |
| B4 absolute adversarial opposition coverage | 81.3% [75.0%, 86.9%] (n=160) |
| B4 top-k adversarial opposition delta | 65.6% [58.1%, 72.5%] (n=160) |
| Oracle false sufficiency | 0.0% [0.0%, 0.0%] (n=220) |
| Gap abstention accuracy | 100.0% [100.0%, 100.0%] (n=40) |
| Greedy median minimum-set ratio | 1.000 (mean 1.019 [1.007, 1.030] (n=180)) |
| Greedy miss rate where oracle succeeded | 0.0% on n=180 |
| Repeated-run mismatches | 0 |

### Stronger success signal

Among adversarial instances where the ceiling oracle met the floors at K = 5 and B0 did not (n=110 of 160):

| | B0 | Ceiling oracle |
| --- | --- | --- |
| Support coverage | 77.3% | 100.0% |
| Opposition coverage | 4.5% | 100.0% |
| Qualifier coverage | 0.0% | 100.0% |
| Mean emitted size | 4.73 | 2.45 |
| Redundancy | 0.818 | 0.095 |

## Scenario-by-scenario analysis

| Scenario | B0 dual | B1 dual | Oracle dual | B2 oracle dual | B4 oracle dual | B0 opposition | Oracle opposition | Recall@50 opposition | Counter recall@50 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| A | 0.0% [0.0%, 0.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| B | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 50.0% [50.0%, 50.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| C | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| D | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| E | 0.0% [0.0%, 0.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| F | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 65.0% [45.0%, 85.0%] (n=20) | 65.0% [45.0%, 85.0%] (n=20) |
| G | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) |
| H | 50.0% [30.0%, 75.0%] (n=20) | 50.0% [25.0%, 70.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 50.0% [25.0%, 75.0%] (n=20) | 50.0% [25.0%, 70.0%] (n=20) | 75.0% [65.0%, 85.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 75.0% [65.0%, 85.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| I | 0.0% [0.0%, 0.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 0.0% [0.0%, 0.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| J | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) |
| N | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | 100.0% [100.0%, 100.0%] (n=20) | n/a | n/a | n/a | n/a |

Scenario A is the near-duplicate support swamp. BM25L top-k dual success is 0%. Opposition coverage is 0%. Production MMR and the lexical-pool oracle are both at 100%, including the even variations that also require a qualifier. Median rank of the first opposition passage is 17, and the mean scored list is 17 blocks, so the contradiction is inside the list and outside the raw top 5. MMR reaches it by collapsing the copies. The set selector reaches the same successes once the list is the pool. On this pattern the current diversifier already does the job the oracle does.

Scenario B needs support, both opposition facts, and a grandfathering qualifier. Every method that can see only lexical hits has dual success 0%. Candidate opposition recall stays 50% at depth 100: the high-overlap partial contract is retrieved and the full contract is not. Qualifier recall on the normal query and on the counter-query union is 0%. The ceiling oracle returns the designed set of 3. The separate qualifier-query probe, which is not B4, reaches dual success 100% and qualifier coverage 100% on these 20 instances. Three frontiers were three discovery problems.

Scenario C mixes current, stale, and future copies. Top-k, MMR, and both oracles are at 100% dual success. The current policy and current contract outranked the stale copy in this generator. The date filter still matters for the ceiling oracle, which selected `current-policy` and `current-contract` and left stale and future ids out. B0 happened to do the same because the current wording is lexically strong.

Scenario D stuffs query terms into irrelevant cards. Both the dense cards and the same-length cards leave the real contradiction unscored: opposition recall is 0% at depth 100, and the mean scored list is 9 blocks. Top-k and MMR dual success are 0%. The ceiling oracle is at 100% with mean size 2. After the hand-authored counter-query, the union oracle is at 100% dual success and top-k on that same union is at 0% dual success, with opposition coverage 100%. The second query finds the contradiction and the ordinary prefix spends the budget on it while dropping support. The selector is what keeps both frontiers inside K = 5. That comparison uses fixture labels.

Scenario E uses different wording for the contradiction. Even variations split the two opposition facts. Opposition recall is 100% at depth 50 even for the zero-overlap variations, so "different vocabulary" was not the same thing as "absent from the postings" in this generator. Top-k opposition coverage is still 0% and dual success is 0%. MMR and the lexical-pool oracle are both at 100%. The contradiction sits in the scored list, behind the duplicate supports, and either dedupe or the set selector can spend a slot on it.

Scenario F deletes one required fact. The oracle abstains on all 20. Top-k still returns 5 passages and is scored as false sufficiency on all 20. The allowed statement is that the required fact was not in this benchmark corpus.

Scenario G keeps an opposing passage and makes it ineligible by staleness, a future window, an unauthorized flag, or authority below the fixture floor. The contract text also contains the query, so it is lexically attractive. The oracle abstains on all 20. Treating that passage as opposition would have been a fixture failure, and the validator rejected any such selection before the run. Top-k false sufficiency on G is 100%: the supports look relevant and the eligible opposition fact is absent from the candidate universe.

Scenario H has a small cover. Even variations need two passages, and top-k, MMR, the lexical-pool oracle, and the union oracle all succeed. Odd variations are the greedy trap, and the full cover is not in the lexical list: normal-query recall is 0.5 for support and 0.5 for opposition, the scored list has 2 blocks, and B2, B4, and top-k dual success are 0%. The ceiling oracle returns `cover-support`, `mm-left`, and `mm-right` and excludes `aa-partial`. At K = 3 greedy abstains on all 10 odd variations. At K = 4 and K = 5 greedy succeeds and includes `aa-partial`, so the minimum-set ratio on those 10 is 4/3. The median ratio across all 180 oracle successes stays 1.0 because these 10 are the only inflation.

Scenario I records source diversity and does not require it. Top-k dual success is 0%. MMR and the lexical-pool oracle are at 100%. The ceiling oracle selects the `regulator-memo` passage on the 10 even variations, where the duplicates share more tokens with the contract, and keeps a house duplicate on the 10 odd variations. That is the redundancy tie-break. It was not a diversity constraint.

Scenario J uses identical support text and identical opposition text. Every method reaches dual success 100%. The oracle's pair is the lexicographically smaller ids. Shuffling insertion order changed B0's selected ids on 6 of 10 shuffles of J-00 and left the oracle ids unchanged. Repeated runs on a fixed pack matched.

Scenario N has no required opposition. The ceiling oracle, the greedy selector, and the union oracle return exactly one support. The unrequested contradiction and the lexical decoy stay out. Mean size is 1. B4 does not abstain and does not include the unrequested passage.

## Candidate-generation ceiling

Does the current Knolo lexical pipeline surface enough counter-evidence for KAR to operate?

On the adversarial scenarios, normal-query opposition recall by candidate depth is:

| Depth | Adversarial support | Adversarial opposition | Adversarial qualifier | Opposition after counter-query union |
| --- | --- | --- | --- | --- |
| 10 | 96.9% [95.0%, 98.4%] (n=160) | 40.6% [33.4%, 47.5%] (n=160) | 25.0% [12.5%, 37.5%] (n=40) | 100.0% [100.0%, 100.0%] (n=160) |
| 20 | 96.9% [94.7%, 98.4%] (n=160) | 76.3% [70.3%, 81.6%] (n=160) | 47.5% [32.5%, 62.5%] (n=40) | 100.0% [100.0%, 100.0%] (n=160) |
| 50 | 96.9% [95.0%, 98.8%] (n=160) | 78.1% [72.5%, 83.4%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 100.0% [100.0%, 100.0%] (n=160) |
| 100 | 96.9% [95.0%, 98.8%] (n=160) | 78.1% [72.5%, 83.4%] (n=160) | 50.0% [35.0%, 65.0%] (n=40) | 100.0% [100.0%, 100.0%] (n=160) |

B2 unconditional opposition delta versus B0 at K = 5 is 34.4% [26.9%, 42.2%] (n=160). B2 dual delta is 37.5% [30.0%, 45.0%] (n=160). The lexical-pool conditional dual delta, restricted to pools that already contain a feasible set, is 46.2% [37.7%, 54.6%] (n=130).

The current lexical pipeline surfaces enough counter-evidence for a set selector to matter on A, C, E, I, J, and the even half of H. It does not surface enough on D, on B's full contract and qualifier, or on the odd half of H. Depth 50 and depth 100 are the same number, 78.1% adversarial opposition recall, because the scored lists are short. Mean scored blocks are about 17 on A, 9 on D, and 2 on odd H. Documents that share neither a query term nor an expansion term never enter the list, so raising depth from 50 to 100 adds nothing. Of 160 adversarial instances, 20 have no opposition passage anywhere in the scored list, and all 20 are scenario D. Full opposition coverage appears somewhere in the normal scored list on 110 of 160. The counter-query union reaches full opposition coverage on all 160. Qualifier recall on the normal list stays at 50% of the 40 instances that require a qualifier, and it stays there after the counter-query. The missing half is scenario B.

B2's unconditional dual-success rate equals production MMR, scenario by scenario. Where the contradiction is already scored, today's dedupe spends the budget on it as often as the label-aware oracle does. Where the contradiction is unscored, both fail together.

Overlap bins, adversarial scenarios only:

| Query-content overlap | n | B0 opposition | Oracle opposition | Recall@50 | Recall@100 | Counter recall@50 |
| --- | --- | --- | --- | --- | --- | --- |
| 0 | 136 | 40.4% [32.0%, 48.2%] (n=136) | 100.0% [100.0%, 100.0%] (n=136) | 74.3% [68.4%, 80.5%] (n=136) | 74.3% [67.6%, 80.1%] (n=136) | 100.0% [100.0%, 100.0%] (n=136) |
| 1 | 8 | 0.0% [0.0%, 0.0%] (n=8) | 100.0% [100.0%, 100.0%] (n=8) | 100.0% [100.0%, 100.0%] (n=8) | 100.0% [100.0%, 100.0%] (n=8) | 100.0% [100.0%, 100.0%] (n=8) |
| 2 | 8 | 0.0% [0.0%, 0.0%] (n=8) | 100.0% [100.0%, 100.0%] (n=8) | 100.0% [100.0%, 100.0%] (n=8) | 100.0% [100.0%, 100.0%] (n=8) | 100.0% [100.0%, 100.0%] (n=8) |
| 3+ | 8 | 0.0% [0.0%, 0.0%] (n=8) | 100.0% [100.0%, 100.0%] (n=8) | 100.0% [100.0%, 100.0%] (n=8) | 100.0% [100.0%, 100.0%] (n=8) | 100.0% [100.0%, 100.0%] (n=8) |

Duplicate-count bins:

| Duplicate supports | n | B0 dual | B1 dual | Oracle dual |
| --- | --- | --- | --- | --- |
| 1-10 | 121 | 41.3% [32.2%, 50.4%] (n=121) | 62.8% [54.5%, 71.1%] (n=121) | 100.0% [100.0%, 100.0%] (n=121) |
| 11-20 | 39 | 0.0% [0.0%, 0.0%] (n=39) | 87.2% [76.9%, 97.4%] (n=39) | 100.0% [100.0%, 100.0%] (n=39) |
| 21+ | 0 | n/a | n/a | n/a |

## Set-selection verdict

If the evidence reaches the candidate pool, is minimum dual-frontier selection materially better than top-k?

On the ceiling corpus, where every fixture passage is available and labels are known, the conditional dual-success delta versus B0 is 61.1% [54.4%, 68.3%] (n=180). Versus production MMR it is 27.8% [20.6%, 33.9%] (n=180). Yes. Minimum dual-frontier selection is materially better than top-k, and it is materially better than MMR, when the pool is the whole fixture and the labels are given.

After discovery has already succeeded, the lexical-pool conditional dual delta versus top-k is 46.2% [37.7%, 54.6%] (n=130). That conditional set is the instances where a feasible subset of the top 50 already exists. On that subset the selector beats the raw prefix. It does not beat production MMR on the unconditional adversarial table, because MMR's successes and the lexical-pool oracle's successes are the same scenario classes.

False sufficiency for the ceiling oracle is 0.0% [0.0%, 0.0%] (n=220). False absence is 0. Gap abstention accuracy is 100.0% [100.0%, 100.0%] (n=40). Adversarial top-k false sufficiency at K = 5 is 68.8%. On F and G it is 100%, because top-k returns hits and has no abstention.

Among the 110 adversarial instances where the ceiling oracle succeeds at K = 5 and top-k does not, top-k support coverage averages 77.3%, opposition coverage averages 4.5%, and qualifier coverage averages 0%, at mean size 4.73 and redundancy 0.818. The oracle on those same instances covers all three frontiers at mean size 2.45 and redundancy 0.095. Secondary nDCG at K = 5 still favors top-k: 0.757 versus 0.680 on the adversarial instances. Sufficiency and rank quality move in different directions.

Greedy median set-size ratio against the oracle, counting only cases both solved at K = 5, is 1.000. The mean of those ratios is 1.019 [1.007, 1.030] (n=180). The fraction of K = 5 oracle successes that greedy missed is 0.0%. That median hides a real miss at a tighter budget. On the 10 odd H variations, greedy abstains at K = 3 while the oracle returns the size-3 cover. At K = 4 and K = 5 greedy succeeds on those 10 with ratio 1.333. Gate 6, which is defined at the primary budget, passes. The K = 3 trap is the reason the miss rate is reported beside the median.

## Manual counter-query experiment

Does intentionally querying for opposition improve candidate recall enough to justify researching deterministic counter-query generation?

The counter-queries were written by hand in the fixture generator. They are not a design.

B4 opposition delta versus B0 is 46.9% [38.1%, 55.3%] (n=160). Absolute B4 opposition coverage is 81.3% [75.0%, 86.9%] (n=160). Ordinary top-k on the same union, B4-TOPK, has a larger opposition delta, 65.6% [58.1%, 72.5%] (n=160). Dual success goes the other way: the union oracle is at 81.3% adversarial dual success and B4-TOPK is at 56.3%. The oracle's opposition average is lower because an unsatisfied set is emitted empty, so opposition coverage counts as 0 when the support or qualifier floor is still missed. Top-k always emits its prefix, so it can score opposition coverage on a set that is not sufficient. Scenario D is the clear case for the selector: union top-k opposition coverage is 100% and dual success is 0%; the union oracle's dual success is 100%. Scenario B is the clear limit: counter-query opposition recall is 100% and B4 dual success is still 0%, because the qualifier is in neither list.

The qualifier probe unions a third hand-authored query at depth 50. On the 40 adversarial instances that require a qualifier, that probe reaches qualifier coverage 100% and dual success 100%. The normal list and the counter-query union each sit at 50% qualifier recall, and scenario B is the miss. The probe is a measurement. It is not part of B4, and the strings were written into the fixture generator.

Yes. Intentionally querying an opposing frontier moves candidate opposition recall from 78.1% to 100% on the adversarial set, which is large enough to justify a later experiment on deterministic counter-query generation. It does not by itself cover a third vocabulary, and the strings used here were authored with the contradiction's wording in hand.

On negative-control instances, B4 included an unrequested contradiction or irrelevant passage in 0.0% [0.0%, 0.0%] (n=20) of cases and abstained in 0.0% [0.0%, 0.0%] (n=20). The ceiling selector's corresponding rates are 0.0% [0.0%, 0.0%] (n=20) and 0.0% [0.0%, 0.0%] (n=20), with mean size 1.00 [1.00, 1.00] (n=20).

## Negative controls

Scenario N requires support only. The ceiling selector abstained on 0.0% [0.0%, 0.0%] (n=20), included an unrequested passage on 0.0% [0.0%, 0.0%] (n=20), and returned mean size 1.00 [1.00, 1.00] (n=20). A clean control abstains at most 5%, includes unrequested passages on at most 10%, and stays at or below mean size 1.25. This run is inside those bounds.

Conflict-seeking is not free if the B4 rates above are worse than the ceiling rates. The selector itself has no term that rewards disagreement once the opposition frontier is empty. Damage on N would be a bug or a property of the extra query, not of the lexicographic objective.

## Performance

Oracle latency is one exact ceiling selection at K = 5, measured separately from the full metric sweep. Greedy latency is the same scope. Candidate latency is the pre-MMR lexical ranking of the normal query. Baseline latency is production `query()` across all six budgets. Total latency includes pack build.

| Stage | Latency |
| --- | --- |
| Pack build | p50 5.67 ms, p95 21.69 ms, max 73.71 ms (n=220) |
| Candidate generation | p50 0.58 ms, p95 2.15 ms, max 6.85 ms (n=220) |
| Counter-query candidate generation | p50 0.33 ms, p95 2.09 ms, max 3.20 ms (n=220) |
| Production baseline queries | p50 19.37 ms, p95 70.31 ms, max 91.53 ms (n=220) |
| KAR-ORACLE | p50 0.05 ms, p95 0.14 ms, max 0.26 ms (n=220) |
| KAR-GREEDY | p50 0.02 ms, p95 0.07 ms, max 0.34 ms (n=220) |
| Total per instance | p50 82.50 ms, p95 305.97 ms, max 371.18 ms (n=220) |

Peak heap observed in the ranking loop: 113059888 bytes.

The exact selector is a quality ceiling. Nothing here suggests it should run inside the production query path. Pools in this benchmark have few distinct fact masks, because duplicate supports share a mask. A corpus whose relevant passages all carry different masks would make the exact walk exponential. That cost was not the thing under test.

## Determinism

Representative cases: A-00, B-00, C-00, D-00, E-00, F-00, G-00, H-00, I-00, J-00, N-00.

Each case was ranked and selected 100 times on a fixed pack. Repeated-run fingerprint mismatches, including replay mismatches: 0.

Ten shuffled insertion orders per representative case changed the ceiling oracle's selected ids 0 times and changed B0's selected ids 92 times. Oracle ties break on passage id, so a shuffle that preserves passage text and ids should not move the oracle. B0 ties break on block id, so a shuffle can change which tied passage wins. Shuffle mismatches for B0 are that block-id rule, recorded separately from the repeated-run failure count.

Replay digests cover the query, sorted candidate ids, fixture relation metadata, coverage requirements, selected ids, and selector version `KAR-ORACLE-exp1`. Two executions disagreed on 0 representative cases. This digest is a benchmark check. It is not a KAR certificate format.

## Sensitivity analysis

Thresholds below use qTau = gamma. The lexicographic objective still prefers more coverage after a lower floor is met, so lowering tau or gamma does not shrink the oracle set when a full cover already fits in K. It changes the success label, and it can change the selected set, when the full cover does not fit and a partial cover does. K = 5 is large enough for the designed minimum sets in this generator (the largest designed feasible set is 3). K = 2 is the budget that cannot hold a 3-passage cover. The oracle is re-run at each floor. B0's passages stay the same. Only the success label changes.

Adversarial scenarios at K = 5:

| K | tau | gamma | n | Ceiling oracle dual | B0 dual |
| --- | --- | --- | --- | --- | --- |
| 5 | 1 | 1 | 160 | 100.0% [100.0%, 100.0%] (n=160) | 31.3% [23.8%, 38.8%] (n=160) |
| 5 | 1 | 0.75 | 160 | 100.0% [100.0%, 100.0%] (n=160) | 31.3% [24.4%, 39.4%] (n=160) |
| 5 | 1 | 0.5 | 160 | 100.0% [100.0%, 100.0%] (n=160) | 31.3% [24.4%, 38.1%] (n=160) |
| 5 | 0.75 | 1 | 160 | 100.0% [100.0%, 100.0%] (n=160) | 31.3% [24.4%, 38.8%] (n=160) |
| 5 | 0.75 | 0.75 | 160 | 100.0% [100.0%, 100.0%] (n=160) | 31.3% [24.4%, 39.4%] (n=160) |
| 5 | 0.75 | 0.5 | 160 | 100.0% [100.0%, 100.0%] (n=160) | 31.3% [25.0%, 38.8%] (n=160) |
| 5 | 0.5 | 1 | 160 | 100.0% [100.0%, 100.0%] (n=160) | 31.3% [24.4%, 38.8%] (n=160) |
| 5 | 0.5 | 0.75 | 160 | 100.0% [100.0%, 100.0%] (n=160) | 31.3% [23.8%, 37.5%] (n=160) |
| 5 | 0.5 | 0.5 | 160 | 100.0% [100.0%, 100.0%] (n=160) | 37.5% [30.0%, 45.0%] (n=160) |

Adversarial scenarios at K = 2:

| K | tau | gamma | n | Ceiling oracle dual | B0 dual |
| --- | --- | --- | --- | --- | --- |
| 2 | 1 | 1 | 160 | 62.5% [55.0%, 70.6%] (n=160) | 0.0% [0.0%, 0.0%] (n=160) |
| 2 | 1 | 0.75 | 160 | 62.5% [55.0%, 70.0%] (n=160) | 0.0% [0.0%, 0.0%] (n=160) |
| 2 | 1 | 0.5 | 160 | 75.0% [67.5%, 81.3%] (n=160) | 0.0% [0.0%, 0.0%] (n=160) |
| 2 | 0.75 | 1 | 160 | 62.5% [54.4%, 69.4%] (n=160) | 0.0% [0.0%, 0.0%] (n=160) |
| 2 | 0.75 | 0.75 | 160 | 62.5% [55.0%, 69.4%] (n=160) | 0.0% [0.0%, 0.0%] (n=160) |
| 2 | 0.75 | 0.5 | 160 | 75.0% [68.1%, 81.3%] (n=160) | 0.0% [0.0%, 0.0%] (n=160) |
| 2 | 0.5 | 1 | 160 | 62.5% [55.0%, 69.4%] (n=160) | 0.0% [0.0%, 0.0%] (n=160) |
| 2 | 0.5 | 0.75 | 160 | 62.5% [55.0%, 70.0%] (n=160) | 0.0% [0.0%, 0.0%] (n=160) |
| 2 | 0.5 | 0.5 | 160 | 75.0% [68.1%, 81.3%] (n=160) | 6.3% [2.5%, 10.6%] (n=160) |

Scenario E, even variations only, at K = 2. These split the two opposition facts across two passages and have no required qualifier, so gamma = 0.5 can be feasible inside K = 2 when gamma = 1 is not:

| K | tau | gamma | n | Ceiling oracle dual | B0 dual |
| --- | --- | --- | --- | --- | --- |
| 2 | 1 | 1 | 10 | 0.0% [0.0%, 0.0%] (n=10) | 0.0% [0.0%, 0.0%] (n=10) |
| 2 | 1 | 0.75 | 10 | 0.0% [0.0%, 0.0%] (n=10) | 0.0% [0.0%, 0.0%] (n=10) |
| 2 | 1 | 0.5 | 10 | 100.0% [100.0%, 100.0%] (n=10) | 0.0% [0.0%, 0.0%] (n=10) |
| 2 | 0.75 | 1 | 10 | 0.0% [0.0%, 0.0%] (n=10) | 0.0% [0.0%, 0.0%] (n=10) |
| 2 | 0.75 | 0.75 | 10 | 0.0% [0.0%, 0.0%] (n=10) | 0.0% [0.0%, 0.0%] (n=10) |
| 2 | 0.75 | 0.5 | 10 | 100.0% [100.0%, 100.0%] (n=10) | 0.0% [0.0%, 0.0%] (n=10) |
| 2 | 0.5 | 1 | 10 | 0.0% [0.0%, 0.0%] (n=10) | 0.0% [0.0%, 0.0%] (n=10) |
| 2 | 0.5 | 0.75 | 10 | 0.0% [0.0%, 0.0%] (n=10) | 0.0% [0.0%, 0.0%] (n=10) |
| 2 | 0.5 | 0.5 | 10 | 100.0% [100.0%, 100.0%] (n=10) | 0.0% [0.0%, 0.0%] (n=10) |

Candidate depth, K, duplicate count, and contradiction overlap are the other sensitivity axes. Their tables are above. The overlap table is the direct check that a gain is not confined to zero-overlap caricatures. The duplicate table is the check that a gain is not confined to a single swamp size.

## Falsification attempts

These cases were built to make the theory fail, or to give the current ranker a fair chance to make KAR unnecessary.

1. Scenario A gives MMR a near-duplicate swamp, which is the case production dedupe is designed to handle. B1 matches the ceiling oracle there: both are at 100% dual success, and B0 is at 0%. On this pattern a new selector does not beat the diversifier that already ships.
2. Scenario N offers a real contradiction that is not required. The ceiling selector and the union oracle both returned exactly one support on all 20 instances. Unrequested inclusion was 0% and abstention was 0%, including after the counter-query had retrieved the unrequested passage. Conflict-seeking did not damage the control.
3. Large K, especially K = 10, gives top-k room to include a low-ranked contradiction after it has taken the supports. Adversarial top-k dual success moves from 31.3% at K = 5 to 33.8% at K = 10, and opposition coverage moves from 34.4% to 40.6%. The gap to the ceiling oracle, which is at 100% from K = 3 upward, stays open. The scored lists are too short, and too full of duplicate supports, for a longer prefix to pick up the passages that never matched.
4. Lower tau and gamma give partial top-k sets a chance to count as success. At K = 5 the ceiling oracle stays at 100% across the grid, and top-k stays at 31.3% until both floors are 0.5, where it rises only to 37.5%. The full cover already fits, so lowering the floor barely helps the prefix. At K = 2, even-E opposition is split across two passages. With gamma = 1 the ceiling oracle is at 0%. With gamma = 0.5 it is at 100%, and top-k stays at 0%. A looser opposition floor creates successes for the selector inside a budget that cannot hold the full cover. It does not rescue top-k on that slice.
5. Overlap of 2 and 3+ query content words makes the contradiction lexically visible. Those bins have only 8 adversarial instances each. Top-k opposition coverage is 0% in all three non-zero bins, while candidate recall is 100%. The contradiction is in the list and still outside the top 5. The zero-overlap bin has 136 instances, top-k opposition coverage 40.4%, and recall 74.3%. The selection gap is present in the high-overlap bins. Those bins are too small to carry the conclusion by themselves, and the zero-overlap majority already contains the same shape wherever the passage was scored.
6. Scenario D asks whether BM25L is actually fooled by query-term stuffing. Top-k and MMR dual success are 0% on both the dense cards and the same-length cards. The real contradiction is never scored. The stuffing story holds for candidate generation. It is also the class a set selector cannot repair without a second query or a different candidate generator.
7. Scenario H odd variations give greedy an equal-gain trap with a stable bad id. At K = 3 the oracle succeeds on all 10 and greedy abstains on all 10. At K = 5 greedy succeeds with minimum-set ratio 1.333 on those 10, and the all-instance median ratio is 1.0 with a miss rate of 0. The median alone would have hidden the trap. The K = 3 row of the budget curve shows it: greedy adversarial dual success is 93.8% where the oracle is at 100%, and those 10 misses are the entire difference.
8. Scenario G makes the lexically best opposition ineligible. Counting it would be a false sufficiency. Abstaining is required.
9. Scenario F removes the required fact. Any confident sufficient set is a false sufficiency. The allowed statement is only that the fact was not in this corpus.
10. Shuffled insertion order tests whether the result depends on array position. Passage-id tie-break should not. Block-id tie-break may.
11. B4-TOPK tests whether a hand-authored second query plus ordinary top-k captures the gain without a new selector. On the adversarial set its dual success is 56.3%, against 81.3% for the union oracle. On scenario D the prefix covers opposition and drops support. The second query and the selector are doing different jobs.
12. Variation 0 is the first draw of each template. The other 152 adversarial variations change duplicate count, overlap, noise, and which frontier is split. Variation 0 top-k dual success is 37.5% and the rest is 30.9%. Lexical-pool oracle dual success is 75.0% on variation 0 and 68.4% on the rest. The direction is the same. A single handcrafted row is not carrying the aggregate.

| Slice | Adversarial n | B0 dual | B1 dual | Oracle dual | B2 dual | B4 dual | B0 opposition | B2 opposition | B4 opposition | Recall@50 | Counter recall@50 |
| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |
| variation0 | 8 | 37.5% [12.5%, 75.0%] (n=8) | 75.0% [37.5%, 100.0%] (n=8) | 100.0% [100.0%, 100.0%] (n=8) | 75.0% [37.5%, 100.0%] (n=8) | 87.5% [62.5%, 100.0%] (n=8) | 37.5% [12.5%, 75.0%] (n=8) | 75.0% [37.5%, 100.0%] (n=8) | 87.5% [62.5%, 100.0%] (n=8) | 81.3% [50.0%, 100.0%] (n=8) | 100.0% [100.0%, 100.0%] (n=8) |
| rest | 152 | 30.9% [23.0%, 38.2%] (n=152) | 68.4% [60.5%, 75.7%] (n=152) | 100.0% [100.0%, 100.0%] (n=152) | 68.4% [60.5%, 75.7%] (n=152) | 80.9% [75.0%, 87.5%] (n=152) | 34.2% [27.3%, 41.4%] (n=152) | 68.4% [60.5%, 75.7%] (n=152) | 80.9% [74.3%, 86.8%] (n=152) | 78.0% [72.4%, 83.9%] (n=152) | 100.0% [100.0%, 100.0%] (n=152) |

13. The ceiling uses fixture labels. B2 and the candidate-recall table exist so those labels cannot be mistaken for retrieval. A ceiling win with a B2 loss is a blocked result, not an end-to-end win. The qualifier probe is separate from B4: the opposing query is not given grandfathering terms.

## Problems discovered

- The selection ceiling knows each passage's relation and facts because the fixture says so. Nothing in the current query path produces those labels. A production selector that assumed the labels would be using an input Knolo does not have.
- Baseline false-sufficiency counts any non-empty BM25 or MMR result as a sufficiency claim. Those rankers do not make that claim. The rate is a harness convention. KAR's zero false-sufficiency follows from emitting SATISFIED only when the fixture floors pass. It checks the implementation. It is not a measure of unsupported answers from a system that cannot see the answer key.
- Default pseudo-relevance expansion adds terms from the top support passages, which usually reinforces support wording. It also assigned a score to some zero-overlap contradictions. Scenario E's zero-overlap variations still have opposition recall 100%. Scenario D never received a score. Expansion is an accidental retrieval path here, not an opposing-frontier mechanism.
- MMR removes near-duplicate text. On this benchmark that was enough to match the lexical-pool oracle's dual success in every scenario class at K = 5. The match happens because the non-duplicate blocks left in the short scored list are the contradiction and, when present, the qualifier. A corpus whose non-duplicates are irrelevant would not inherit that match.
- Validity, authorization, and authority are fixture filters inside the selector. The lexical ranker does not read `validFrom`, `validTo`, `unauthorized`, or `authority`. Scenario C was still solved by top-k, because the current wording outranked the stale copy. Scenario G abstains correctly only in the selector. Top-k's false sufficiency there is 100%.
- One opposing query does not retrieve a qualifier that uses a third vocabulary. The qualifier probe is the measurement. Three frontiers can mean three discovery problems.
- The exact oracle is tractable here because duplicate passages share fact masks. That is an experimental convenience, not a production complexity bound.
- V5 Knowledge Image query and the Evidence Gate do not fill this gap. One filters objects. The other checks relations the host already asserted.
- Committed `packages/core/dist` lags `packages/core/src` on the lexical postings reader. Measurements used a temporary compile of the source so the experiment would follow current code. Production package consumers of this commit still execute the committed dist.
- Hand-authored counter-queries can smuggle the answer vocabulary. B4 is an upper bound on a second lexical frontier, not evidence that a generator exists.

## Final recommendation

Run another research experiment. Do not open a KAR-1 design from Experiment 1. The review decision is PROMISING BUT BLOCKED. The harness label remains GO under rules that compared the lexical-pool oracle with raw top-k. The review override stands because that oracle tied production MMR on evidence-set completion.

The direct answer to the investment question: keep the minimum-set objective, and do not build it yet. Ordinary top-k leaves required opposition out. The current MMR stage already completes the evidence set on the same instances as a label-aware selector over today's lexical pool. The open problem is deterministic frontier discovery for passages that never score, plus a source of relation labels that is not the fixture answer key. Experiment 2 tests the discovery half.

Numbers behind that answer, at K = 5. Ceiling conditional dual delta versus top-k: 61.1 percentage points, 95% interval 54.4 to 68.3, n = 180. Versus production MMR: 27.8 points, interval 20.6 to 33.9, n = 180. Adversarial dual success: top-k 31.3%, production MMR 68.8%, lexical-pool oracle 68.8%, counter-query union oracle 81.3%, ceiling oracle 100%. Adversarial opposition coverage: top-k 34.4%, lexical-pool oracle 68.8%, union oracle 81.3%, ceiling oracle 100%. Candidate opposition recall at depth 50 and at depth 100: 78.1%, and 100% after the hand-authored counter-query. Oracle false sufficiency: 0 of 220. Gap abstention: 40 of 40. Repeated-run mismatches: 0. Greedy median minimum-set ratio at K = 5: 1.000, with miss rate 0; at K = 3 the 10 odd-H traps are greedy abstentions and oracle successes. On the 110 adversarial instances where the ceiling oracle succeeds and top-k does not, top-k support coverage is 77.3% and opposition coverage is 4.5%, at mean size 4.73, while the oracle covers both frontiers at mean size 2.45.
