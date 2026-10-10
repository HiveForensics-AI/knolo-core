function pct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

function statPct(stat) {
  if (!stat || stat.mean === null || stat.mean === undefined) return 'n/a';
  if (!stat.ci95 || stat.ci95[0] === null) return `${pct(stat.mean)} (n=${stat.n})`;
  return `${pct(stat.mean)} [${pct(stat.ci95[0])}, ${pct(stat.ci95[1])}] (n=${stat.n})`;
}

function statNum(stat, digits = 2) {
  if (!stat || stat.mean === null || stat.mean === undefined) return 'n/a';
  if (!stat.ci95 || stat.ci95[0] === null) return `${stat.mean.toFixed(digits)} (n=${stat.n})`;
  return `${stat.mean.toFixed(digits)} [${stat.ci95[0].toFixed(digits)}, ${stat.ci95[1].toFixed(digits)}] (n=${stat.n})`;
}

function ms(stat) {
  if (!stat || stat.p50 === null || stat.p50 === undefined) return 'n/a';
  const fmt = (value) => (value === null ? 'n/a' : value.toFixed(2));
  return `p50 ${fmt(stat.p50)} ms, p95 ${fmt(stat.p95)} ms, max ${fmt(stat.max)} ms (n=${stat.n})`;
}

function methodTable(block, methods) {
  const header = ['Metric', ...methods];
  const lines = [header.join(' | '), header.map(() => '---').join(' | ')];
  const rows = [
    ['Support coverage', 'sc', statPct],
    ['Opposition coverage', 'oc', statPct],
    ['Qualifier coverage', 'qc', statPct],
    ['Dual coverage success', 'dual', statPct],
    ['Mean set size', 'size', statNum],
    ['Redundancy', 'redundancy', statNum],
    ['False sufficiency', 'falseSufficiencyRate', statPct],
    ['False absence', 'falseAbsenceRate', statPct],
    ['Abstention rate', 'abstentionRate', statPct],
    ['nDCG', 'ndcg', statNum],
  ];
  for (const [label, key, fmt] of rows) {
    lines.push([label, ...methods.map((method) => fmt(block?.[method]?.[key]))].join(' | '));
  }
  return lines.join('\n');
}

function thresholdTable(rows) {
  const lines = ['| K | tau | gamma | n | Ceiling oracle dual | B0 dual |', '| --- | --- | --- | --- | --- | --- |'];
  for (const row of rows ?? []) {
    lines.push(`| ${row.K ?? ''} | ${row.tau} | ${row.gamma} | ${row.n ?? ''} | ${statPct(row.oracleDual)} | ${statPct(row.b0Dual)} |`);
  }
  return lines.join('\n');
}

function curveTable(curve) {
  const keys = Object.keys(curve);
  const header = ['K', ...keys.map((key) => `K=${key}`)];
  const metrics = [
    ['B0 dual success', 'b0Dual'],
    ['B1 production MMR dual success', 'b1Dual'],
    ['Ceiling oracle dual success', 'oracleDual'],
    ['Ceiling greedy dual success', 'greedyDual'],
    ['B2 lexical-pool oracle dual success', 'b2Dual'],
    ['B4 dual-query oracle dual success', 'b4Dual'],
    ['B4 dual-query top-k dual success', 'b4TopkDual'],
    ['B0 opposition coverage', 'b0Oc'],
    ['Ceiling oracle opposition coverage', 'oracleOc'],
    ['B2 opposition coverage', 'b2Oc'],
    ['B4 opposition coverage', 'b4Oc'],
    ['Conditional ceiling dual delta vs B0', 'conditionalCeilingDelta'],
    ['Feasible adversarial n', 'feasibleN'],
  ];
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const [label, key] of metrics) {
    const cells = keys.map((budget) => {
      const value = curve[budget][key];
      if (key === 'feasibleN') return String(value);
      return statPct(value);
    });
    lines.push(`| ${label} | ${cells.join(' | ')} |`);
  }
  return lines.join('\n');
}

export function renderReport(summary) {
  const g = summary.gates;
  const d = summary.decision;
  const plan = summary.planExample ?? {};
  const recall = summary.candidateRecall ?? {};
  const signal = summary.strongerSignal ?? {};
  const scenarios = Object.keys(summary.byScenario ?? {});
  const scenarioLines = ['| Scenario | B0 dual | B1 dual | Oracle dual | B2 oracle dual | B4 oracle dual | B0 opposition | Oracle opposition | Recall@50 opposition | Counter recall@50 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const scenario of scenarios) {
    const row = summary.byScenario[scenario];
    scenarioLines.push(
      `| ${scenario} | ${statPct(row.ceiling.B0?.dual)} | ${statPct(row.ceiling.B1?.dual)} | ${statPct(row.ceiling.ORACLE?.dual)} | ${statPct(row.lexical.ORACLE?.dual)} | ${statPct(row.dual.ORACLE?.dual)} | ${statPct(row.ceiling.B0?.oc)} | ${statPct(row.ceiling.ORACLE?.oc)} | ${statPct(row.recall[50]?.opposition)} | ${statPct(row.recall[50]?.counterOpposition)} |`,
    );
  }
  const recallLines = ['| Depth | Adversarial support | Adversarial opposition | Adversarial qualifier | Opposition after counter-query union |', '| --- | --- | --- | --- | --- |'];
  for (const depth of [10, 20, 50, 100]) {
    const row = recall[depth]?.adversarial;
    if (!row) continue;
    recallLines.push(`| ${depth} | ${statPct(row.support)} | ${statPct(row.opposition)} | ${statPct(row.qualifier)} | ${statPct(row.counterOpposition)} |`);
  }
  const thresholdLines = thresholdTable(summary.thresholdSensitivity);
  const thresholdK2Lines = thresholdTable(summary.thresholdSensitivityK2);
  const thresholdELines = thresholdTable(summary.thresholdSensitivityEEvenK2);
  const corpusLines = ['| Scenario | Corpus size mean | Scored blocks mean |', '| --- | --- | --- |'];
  for (const [scenario, row] of Object.entries(summary.corpus ?? {})) {
    if (scenario === 'all') continue;
    corpusLines.push(`| ${scenario} | ${statNum(row.corpusSize, 1)} | ${statNum(row.scoredCount, 1)} |`);
  }
  if (summary.corpus?.all) {
    corpusLines.push(`| all | ${statNum(summary.corpus.all.corpusSize, 1)} | ${statNum(summary.corpus.all.scoredCount, 1)} |`);
  }
  const split = summary.variationSplit ?? {};
  const splitLines = ['| Slice | Adversarial n | B0 dual | B1 dual | Oracle dual | B2 dual | B4 dual | B0 opposition | B2 opposition | B4 opposition | Recall@50 | Counter recall@50 |', '| --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- | --- |'];
  for (const label of ['variation0', 'rest']) {
    const row = split[label];
    if (!row) continue;
    splitLines.push(
      `| ${label} | ${row.adversarialN} | ${statPct(row.b0Dual)} | ${statPct(row.b1Dual)} | ${statPct(row.oracleDual)} | ${statPct(row.b2Dual)} | ${statPct(row.b4Dual)} | ${statPct(row.b0Oc)} | ${statPct(row.b2Oc)} | ${statPct(row.b4Oc)} | ${statPct(row.recall50)} | ${statPct(row.counterRecall50)} |`,
    );
  }
  const overlapLines = ['| Query-content overlap | n | B0 opposition | Oracle opposition | Recall@50 | Recall@100 | Counter recall@50 |', '| --- | --- | --- | --- | --- | --- | --- |'];
  for (const [label, row] of Object.entries(summary.overlapBins ?? {})) {
    overlapLines.push(`| ${label} | ${row.n} | ${statPct(row.b0Opposition)} | ${statPct(row.oracleOpposition)} | ${statPct(row.recall50)} | ${statPct(row.recall100)} | ${statPct(row.counterRecall50)} |`);
  }
  const dupLines = ['| Duplicate supports | n | B0 dual | B1 dual | Oracle dual |', '| --- | --- | --- | --- | --- |'];
  for (const [label, row] of Object.entries(summary.duplicateBins ?? {})) {
    dupLines.push(`| ${label} | ${row.n} | ${statPct(row.b0Dual)} | ${statPct(row.b1Dual)} | ${statPct(row.oracleDual)} |`);
  }
  const det = summary.determinism ?? [];
  const shuffleOracle = det.reduce((sum, row) => sum + row.shuffleOracleMismatches, 0);
  const shuffleBase = det.reduce((sum, row) => sum + row.shuffleBaselineMismatches, 0);
  const replayMiss = det.filter((row) => !row.replayMatch).length;

  return `# KAR theory validation

Commit: \`${summary.commit}\`

Seed: \`${summary.seed}\`

Generator: \`${summary.generator}\`

Instances: ${summary.instanceCount}${summary.limited ? ` (limited probe, ${summary.perScenario} per scenario; not the full 220-instance run)` : ''}

Retrieval implementation measured: current \`packages/core/src\` compiled into a temporary build. ${summary.distStale ? 'The committed `packages/core/dist` is stale relative to that source (`query.js` does not yet call `createLegacyLexicalPostingsReader`). The experiment did not modify or publish that dist.' : 'The committed dist matches the measured source.'}

## Executive conclusion

${d.label}

${executiveProse(summary)}

## Repository baseline

The measured retrieval path is pack query, plan version \`retrieval-v4.0\`. On this commit the default \`query()\` walk is:

1. Tokenize with NFKD, diacritic folding, lowercasing, and hyphen-preserving splits. There is no stemmer and no stopword list.
2. Collect lexical postings for query terms. V4 fielded chunks can add a field score.
3. Enforce namespace, source, and required-phrase constraints.
4. Rank with BM25L (\`k1=1.5\`, \`b=0.75\`), a bounded proximity multiplier, heading overlap, and a small field score.
5. Expand the query with pseudo-relevance feedback from the top 3 blocks and up to 4 new terms at weight 0.35. This expansion is on by default.
6. Optionally rerank with a semantic sidecar. Semantic rerank is off unless requested. This experiment left it off. No vector database was added.
7. Take the top \`5K\` scored blocks and run near-duplicate suppression plus MMR (\`lambda=0.8\`, 5-gram Jaccard cutoff 0.92). Tie-breaks are higher score, then lower block id.

\`DOCS.md\` still lists a KNS signature as a rank tie-break. Current \`query()\` does not apply \`knsSignature\`. The comment in \`query.ts\` says scores are not modified by that signature. Block id is the tie-break. The experiment follows the code.

Claim-graph expansion exists in \`expandQueryWithGraph\` and is off unless \`graph.expand\` is set. Default builds still store a claim graph. The experiment left graph expansion off, which is the production default.

V5 \`queryKnowledgeImageV5\` is a different operation: deterministic EQL filter, order, and limit over Knowledge Image objects. It is not the BM25 passage ranker. This experiment did not build a V5 image, did not change image bytes, and did not emit a V5 state root.

\`@knolo/evidence-gate\` checks host-supplied claim relations against a verified V5 image. It does not retrieve passages and it does not label support or contradiction. The benchmark labels were written in the fixture generator.

A representative plan from the first instance has \`generate=${JSON.stringify(plan.generate ?? [])}\`, \`rescore=${JSON.stringify(plan.rescore ?? [])}\`, \`diversify=${plan.diversify ?? 'n/a'}\`, \`expand=${JSON.stringify(plan.expand ?? {})}\`, and \`planHash=${plan.planHash ?? 'n/a'}\`.

## Hypotheses

Hypothesis A, evidence-set selection: once a candidate pool already contains the required support, opposition, and qualifier passages, does a minimum dual-frontier set beat BM25L top-k and the current MMR selector at the same evidence budget?

Hypothesis B, counter-evidence discovery: does the current lexical pipeline place materially contradictory or qualifying passages into a practical candidate pool when those passages use weaker query vocabulary than repeated supporting passages?

These hypotheses are scored separately. The selectors use fixture relation and fact labels. That is a selection ceiling. It is not a claim that the pipeline knows those labels.

## Experimental methodology

The corpus is a deterministic synthetic generator, version \`${summary.generator}\`, seed \`${summary.seed}\`, ${summary.perScenario} variations of scenarios A through J plus a negative-control scenario N. Relation labels are fixture fields: support, contradict, qualify, independent, and irrelevant. No model labeled them.

Required facts define three frontiers. Coverage is the size of the union of applicable facts in the selected set divided by the number of required facts. A frontier with no required facts is N/A and is omitted from the denominator. A passage contributes facts only on its own frontier, and only when it is applicable at the fixture \`asOf\` date, is not marked unauthorized, and meets \`minAuthority\` when that floor is set.

Primary floors are tau = 1, gamma = 1, and qualifier floor 1. The budget is the maximum set size. Compared budgets are K = 2, 3, 4, 5, 8, and 10. Primary tables use K = 5. Candidate depths are 10, 20, 50, and 100. Primary pool depth is 50.

KAR-ORACLE keeps at most one applicable passage per distinct fact mask in the selected set. Two passages with the same mask cannot both appear in a minimum cover, because dropping one preserves coverage and reduces size. The walk still tries each member of a mask group, because redundancy, authority, and passage id can differ. The exact walk then applies this lexicographic order among sets that meet the floors and fit in K: higher opposition coverage, higher support coverage, higher qualifier coverage, fewer inapplicable passages, smaller size, lower redundancy, higher total authority, then the lexicographically smaller sorted passage-id list. An independent dynamic program over fact masks checks feasibility. The run aborts if the two disagree. If no set meets the floors, the result is \`UNSATISFIED_EVIDENCE_REQUIREMENTS\` and the emitted set is empty. That means required evidence was not found within the declared corpus or candidate universe. It does not mean no such evidence exists anywhere.

Redundancy is the mean pairwise Jaccard similarity of the sets of production tokenizer tokens. A set of size 0 or 1 has redundancy 0.

KAR-GREEDY adds the candidate with the largest number of newly covered opposition facts, then support facts, then qualifier facts. Ties break on applicability, lower redundancy, higher authority, then id. It abstains when the floors are still unmet at size K.

Baselines:

- B0 is BM25L top-k from the pre-MMR ranking, using the same ranker as \`query()\`.
- B1 is \`query()\` itself, including default expansion and MMR.
- B1pool, reported at K = 5, runs the repository MMR function on the full corpus pool.
- B2 runs KAR-ORACLE and KAR-GREEDY on the lexical top-D pool of the normal query only.
- B4 unions the lexical top-D pools of the normal query and a hand-authored \`counterQuery\`, then runs the selectors. B4-TOPK takes the top K of that union by the better lexical score. The counter-query is a probe, not a proposed generator.
- A qualifier-query probe unions a third hand-authored query at depth 50. It is diagnostic only.

The lexical mirror was checked against \`query()\` on every instance at K = 3, 5, and 10. Parity mismatches: ${summary.parityMismatches}.

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
- Bootstrap intervals use 1000 resamples and seed ${summary.seed}. Decision reason: ${d.reason ?? 'n/a'}.

## Results

Primary budget K = ${summary.primaryK}. Means are paired with 95% percentile bootstrap intervals.

### Ceiling pool at K = ${summary.primaryK}

This pool is the whole fixture corpus. KAR may select a passage the lexical ranker never scored. B0 and B1 may not.

${methodTable(summary.overall?.ceiling?.[summary.primaryK], ['B0', 'B1', 'B1pool', 'ORACLE', 'GREEDY'])}

### Lexical candidate pool at depth ${summary.primaryDepth}, K = ${summary.primaryK}

B2. The selector sees only what the normal query returned.

${methodTable(summary.overall?.lexical?.[summary.primaryK], ['ORACLE', 'GREEDY'])}

### Normal query union counter-query, depth ${summary.primaryDepth}, K = ${summary.primaryK}

B4. TOPK is ordinary top-k over that union, so it separates "the extra query found the passage" from "the set selector was necessary".

${methodTable(summary.overall?.dual?.[summary.primaryK], ['ORACLE', 'GREEDY', 'TOPK'])}

### Qualifier-query probe at K = ${summary.primaryK}

${methodTable({ ORACLE: summary.overall?.qualifierProbe?.[summary.primaryK] }, ['ORACLE'])}

### Adversarial budget curve

Scenarios A, B, C, D, E, H, I, and J. Opposition is eligible and required. Scenarios F, G, and N are excluded here and reported below.

${curveTable(summary.budgetCurve ?? {})}

### OppositionRecall and candidate recall

Opposition coverage of the emitted set is the experiment's OppositionRecall@K. Abstention contributes 0. Candidate recall is different: it asks whether any prefix of the lexical ranking covers the required facts, before set selection. Depth 100 is the whole scored list when the pack has fewer than 100 blocks that share a query or expansion term. Corpus sizes:

${corpusLines.join('\n')}

${recallLines.join('\n')}

Gate values at K = ${g.primaryK}, depth ${g.primaryDepth}:

| Check | Result |
| --- | --- |
| Ceiling conditional dual delta vs B0 | ${statPct(g.gate1CeilingConditionalDualDelta)} on n=${g.ceilingFeasibleN} |
| Ceiling conditional dual delta vs production MMR | ${statPct(g.gate1VsProductionMmr)} |
| Lexical-pool conditional dual delta vs B0 | ${statPct(g.gate1LexicalPoolConditionalDualDelta)} on n=${g.lexicalFeasibleN} |
| B2 unconditional adversarial dual delta | ${statPct(g.b2UnconditionalDualDelta)} |
| Ceiling adversarial opposition delta | ${statPct(g.ceilingOppositionDelta)} |
| B2 adversarial opposition delta | ${statPct(g.b2OppositionDelta)} |
| B4 adversarial opposition delta | ${statPct(g.b4OppositionDelta)} |
| B4 absolute adversarial opposition coverage | ${statPct(g.b4OppositionAbsolute)} |
| B4 top-k adversarial opposition delta | ${statPct(g.b4TopkOppositionDelta)} |
| Oracle false sufficiency | ${statPct(g.oracleFalseSufficiency)} |
| Gap abstention accuracy | ${statPct(g.abstentionAccuracy)} |
| Greedy median minimum-set ratio | ${g.greedyMsr?.median == null ? 'n/a' : g.greedyMsr.median.toFixed(3)} (mean ${statNum(g.greedyMsr, 3)}) |
| Greedy miss rate where oracle succeeded | ${g.greedyMissRate === null ? 'n/a' : pct(g.greedyMissRate)} on n=${g.greedyComparable} |
| Repeated-run mismatches | ${summary.determinismMismatches} |

### Stronger success signal

Among adversarial instances where the ceiling oracle met the floors at K = ${summary.primaryK} and B0 did not (n=${signal.n} of ${signal.adversarialN}):

| | B0 | Ceiling oracle |
| --- | --- | --- |
| Support coverage | ${signal.b0Support === null ? 'n/a' : pct(signal.b0Support)} | ${signal.oracleSupport === null ? 'n/a' : pct(signal.oracleSupport)} |
| Opposition coverage | ${signal.b0Opposition === null ? 'n/a' : pct(signal.b0Opposition)} | ${signal.oracleOpposition === null ? 'n/a' : pct(signal.oracleOpposition)} |
| Qualifier coverage | ${signal.b0Qualifier === null ? 'n/a' : pct(signal.b0Qualifier)} | ${signal.oracleQualifier === null ? 'n/a' : pct(signal.oracleQualifier)} |
| Mean emitted size | ${signal.b0Size === null ? 'n/a' : signal.b0Size.toFixed(2)} | ${signal.oracleSize === null ? 'n/a' : signal.oracleSize.toFixed(2)} |
| Redundancy | ${signal.b0Redundancy === null ? 'n/a' : signal.b0Redundancy.toFixed(3)} | ${signal.oracleRedundancy === null ? 'n/a' : signal.oracleRedundancy.toFixed(3)} |

## Scenario-by-scenario analysis

${scenarioLines.join('\n')}

Scenario A is the near-duplicate support swamp. B0 is the pure BM25L prefix. B1 is allowed to drop near-duplicates, so a gain of B1 over B0 on A is evidence that today's MMR already does part of the anti-swamp job. The oracle's remaining gap, if any, is the low-overlap contradiction or qualifier, which MMR does not target.

Scenario B asks for support, a buried contract exception, and a grandfathering qualifier. One high-overlap partial contract covers only one opposition fact. Full floors require the low-overlap contract and the qualifier.

Scenario C mixes a current policy and contract with stale and future copies. Stale text is lexically close to the query and carries an opposition fact id, but it is outside the validity window. Selecting it does not count.

Scenario D puts query terms into irrelevant filing cards. Dense repetitions are the first 10 variations. The other 10 keep a similar length and still repeat the query.

Scenario E is the weak-vocabulary contradiction. Even variations split the two opposition facts across two passages. Overlap of query content words is 0, 1, 2, or 3 depending on the variation. The corpus is large enough that depth 100 is not the whole pack.

Scenario F removes a required fact from the corpus. The correct emitted result is unsatisfied within this corpus.

Scenario G keeps an opposing passage and makes it ineligible by staleness, a future window, an unauthorized flag, or authority below the fixture floor. The passage is lexically attractive. It must not satisfy opposition coverage.

Scenario H has a small cover. Even variations need two passages. Odd variations are a greedy trap: three opposition passages tie on marginal gain, and the lowest id is not part of any minimum cover that also includes support. The oracle should avoid it. Greedy at K = 3 should abstain or miss.

Scenario I records source diversity and does not constrain it. Duplicates share \`bulletin-house\`. One support passage has source \`regulator-memo\`. Even variations add opposition vocabulary to the duplicates so token redundancy can prefer the independent wording. That is a tie-break, not a diversity constraint.

Scenario J uses identical support text and identical opposition text. Passage id is the KAR tie-break. BM25L tie-breaks on block id, which follows insertion order.

Scenario N has no required opposition. A contradictory passage and a keyword-stuffed irrelevant passage are present anyway.

## Candidate-generation ceiling

Does the current Knolo lexical pipeline surface enough counter-evidence for KAR to operate?

On the adversarial scenarios, normal-query opposition recall by candidate depth is:

${recallLines.join('\n')}

B2 unconditional opposition delta versus B0 at K = ${g.primaryK} is ${statPct(g.b2OppositionDelta)}. B2 dual delta is ${statPct(g.b2UnconditionalDualDelta)}. The lexical-pool conditional dual delta, restricted to pools that already contain a feasible set, is ${statPct(g.gate1LexicalPoolConditionalDualDelta)} (n=${g.lexicalFeasibleN}).

If the unconditional B2 delta is small while the conditional delta is large, the selector is fine and the normal query is not supplying the pool. If both are small, either top-k already found the opposition or the opposition never became selectable inside the budget.

Overlap bins, adversarial scenarios only:

${overlapLines.join('\n')}

Duplicate-count bins:

${dupLines.join('\n')}

## Set-selection verdict

If the evidence reaches the candidate pool, is minimum dual-frontier selection materially better than top-k?

On the ceiling corpus, where every fixture passage is available and labels are known, the conditional dual-success delta versus B0 is ${statPct(g.gate1CeilingConditionalDualDelta)} (n=${g.ceilingFeasibleN}). Versus production MMR it is ${statPct(g.gate1VsProductionMmr)}.

The lexical-pool conditional comparison answers the same question after discovery has already succeeded: ${statPct(g.gate1LexicalPoolConditionalDualDelta)} (n=${g.lexicalFeasibleN}).

False sufficiency for the ceiling oracle is ${statPct(g.oracleFalseSufficiency)}. False absence is in the ceiling table. Gap abstention accuracy is ${statPct(g.abstentionAccuracy)}.

Greedy median set-size ratio against the oracle, counting only cases both solved, is ${g.greedyMsr?.median == null ? 'n/a' : g.greedyMsr.median.toFixed(3)}. The mean of those ratios is ${statNum(g.greedyMsr, 3)}. The fraction of oracle successes that greedy missed is ${g.greedyMissRate === null ? 'n/a' : pct(g.greedyMissRate)}. Gate 6 asks for a median at or below 1.25. The miss rate is reported beside it so a median of 1.0 cannot hide abstentions.

## Manual counter-query experiment

Does intentionally querying for opposition improve candidate recall enough to justify researching deterministic counter-query generation?

The counter-queries were written by hand in the fixture generator. They are not a design.

B4 opposition delta versus B0 is ${statPct(g.b4OppositionDelta)}. Ordinary top-k on the same union, B4-TOPK, has opposition delta ${statPct(g.b4TopkOppositionDelta)}. If those two deltas are close, the second query is doing the work and the set selector adds little once the passage is near the top of the union. If the oracle delta is larger, the union still contains redundant supports and the selector is what spends the budget on the opposing frontier.

The qualifier probe is the same idea for the third frontier. Its K = ${summary.primaryK} row is above. A single opposing query does not by itself name grandfathering, cutoffs, or amendments.

On negative-control instances, B4 included an unrequested contradiction or irrelevant passage in ${statPct(g.b4NegativeExtra)} of cases and abstained in ${statPct(g.b4NegativeAbstain)}. The ceiling selector's corresponding rates are ${statPct(g.negativeExtra)} and ${statPct(g.negativeAbstain)}, with mean size ${statNum(g.negativeSize)}.

## Negative controls

Scenario N requires support only. The ceiling selector abstained on ${statPct(g.negativeAbstain)}, included an unrequested passage on ${statPct(g.negativeExtra)}, and returned mean size ${statNum(g.negativeSize)}. A clean control abstains at most 5%, includes unrequested passages on at most 10%, and stays at or below mean size 1.25. This run is ${d.cleanNegative ? 'inside' : 'outside'} those bounds.

Conflict-seeking is not free if the B4 rates above are worse than the ceiling rates. The selector itself has no term that rewards disagreement once the opposition frontier is empty. Damage on N would be a bug or a property of the extra query, not of the lexicographic objective.

## Performance

Oracle latency is one exact ceiling selection at K = ${summary.primaryK}, measured separately from the full metric sweep. Greedy latency is the same scope. Candidate latency is the pre-MMR lexical ranking of the normal query. Baseline latency is production \`query()\` across all six budgets. Total latency includes pack build.

| Stage | Latency |
| --- | --- |
| Pack build | ${ms(summary.latency?.buildMs)} |
| Candidate generation | ${ms(summary.latency?.candidateMs)} |
| Counter-query candidate generation | ${ms(summary.latency?.counterCandidateMs)} |
| Production baseline queries | ${ms(summary.latency?.baselineMs)} |
| KAR-ORACLE | ${ms(summary.latency?.selectionMs)} |
| KAR-GREEDY | ${ms(summary.latency?.greedyMs)} |
| Total per instance | ${ms(summary.latency?.totalMs)} |

Peak heap observed in the ranking loop: ${summary.memory?.maxHeapBytes ?? 'n/a'} bytes.

The exact selector is a quality ceiling. Nothing here suggests it should run inside the production query path. Pools in this benchmark have few distinct fact masks, because duplicate supports share a mask. A corpus whose relevant passages all carry different masks would make the exact walk exponential. That cost was not the thing under test.

## Determinism

Representative cases: ${det.map((row) => row.id).join(', ') || 'none'}.

Each case was ranked and selected 100 times on a fixed pack. Repeated-run fingerprint mismatches, including replay mismatches: ${summary.determinismMismatches}.

Ten shuffled insertion orders per representative case changed the ceiling oracle's selected ids ${shuffleOracle} times and changed B0's selected ids ${shuffleBase} times. Oracle ties break on passage id, so a shuffle that preserves passage text and ids should not move the oracle. B0 ties break on block id, so a shuffle can change which tied passage wins. Shuffle mismatches for B0 are that block-id rule, recorded separately from the repeated-run failure count.

Replay digests cover the query, sorted candidate ids, fixture relation metadata, coverage requirements, selected ids, and selector version \`KAR-ORACLE-exp1\`. Two executions disagreed on ${replayMiss} representative cases. This digest is a benchmark check. It is not a KAR certificate format.

## Sensitivity analysis

Thresholds below use qTau = gamma. The lexicographic objective still prefers more coverage after a lower floor is met, so lowering tau or gamma does not shrink the oracle set when a full cover already fits in K. It changes the success label, and it can change the selected set, when the full cover does not fit and a partial cover does. K = ${summary.primaryK} is large enough for the designed minimum sets in this generator (the largest designed feasible set is 3). K = 2 is the budget that cannot hold a 3-passage cover. The oracle is re-run at each floor. B0's passages stay the same. Only the success label changes.

Adversarial scenarios at K = ${summary.primaryK}:

${thresholdLines}

Adversarial scenarios at K = 2:

${thresholdK2Lines}

Scenario E, even variations only, at K = 2. These split the two opposition facts across two passages and have no required qualifier, so gamma = 0.5 can be feasible inside K = 2 when gamma = 1 is not:

${thresholdELines}

Candidate depth, K, duplicate count, and contradiction overlap are the other sensitivity axes. Their tables are above. The overlap table is the direct check that a gain is not confined to zero-overlap caricatures. The duplicate table is the check that a gain is not confined to a single swamp size.

## Falsification attempts

These cases were built to make the theory fail, or to give the current ranker a fair chance to make KAR unnecessary.

1. Scenario A gives MMR a near-duplicate swamp, which is the case production dedupe is designed to handle. If B1 already matches the oracle there, KAR is not earning its keep on that pattern.
2. Scenario N offers a real contradiction that is not required. A selector that hunts for conflict should damage this set. The negative-control rates are the measurement.
3. Large K, especially K = 10, gives top-k room to include a low-ranked contradiction after it has taken the supports. The budget curve shows whether the gap closes.
4. Lower tau and gamma give partial top-k sets a chance to count as success. The K = 2 threshold table, and the even-E slice, are the cases where a partial cover can fit and a perfect cover cannot. The K = 5 table is the check that lowering the floor does nothing once the full cover already fits.
5. Overlap of 2 and 3+ query content words makes the contradiction lexically visible. If B0 opposition coverage rises to the oracle there, the theory's advantage is limited to dissimilar wording.
6. Scenario D asks whether BM25L is actually fooled by query-term stuffing. If B0 dual success is already high, the "lexical irrelevance" story failed.
7. Scenario H odd variations give greedy an equal-gain trap with a stable bad id. A median minimum-set ratio of 1.0 would be incomplete without the greedy miss rate beside it.
8. Scenario G makes the lexically best opposition ineligible. Counting it would be a false sufficiency. Abstaining is required.
9. Scenario F removes the required fact. Any confident sufficient set is a false sufficiency. The allowed statement is only that the fact was not in this corpus.
10. Shuffled insertion order tests whether the result depends on array position. Passage-id tie-break should not. Block-id tie-break may.
11. B4-TOPK tests whether a hand-authored second query plus ordinary top-k captures the gain without a new selector.
12. Variation 0 is the first draw of each template. The other variations change duplicate count, overlap, noise, and which frontier is split. If only variation 0 moved, the generator would be a single anecdote.

${splitLines.join('\n')}

13. The ceiling uses fixture labels. B2 and the candidate-recall table exist so those labels cannot be mistaken for retrieval. A ceiling win with a B2 loss is a blocked result, not an end-to-end win. The qualifier probe is separate from B4: the opposing query is not given grandfathering terms.

## Problems discovered

- The selection ceiling knows each passage's relation and facts because the fixture says so. Nothing in the current query path produces those labels. A production selector that assumed the labels would be using an input Knolo does not have.
- Default pseudo-relevance expansion adds terms from the top support passages. Those terms reinforce support wording. They are not a counter-evidence mechanism.
- MMR removes near-duplicate text. It does not know which frontier a passage serves. Textual diversity is not opposition coverage.
- One opposing query does not retrieve a qualifier that uses a third vocabulary. The qualifier probe is the measurement. Three frontiers can mean three discovery problems.
- The exact oracle is tractable here because duplicate passages share fact masks. That is an experimental convenience, not a production complexity bound.
- Validity, authorization, and authority are fixture filters. The lexical ranker does not read \`validFrom\`, \`validTo\`, \`unauthorized\`, or \`authority\`. Scenario C and G are unwinnable for B0 and B1 whenever the eligible wording is weaker than the ineligible wording, until some other component applies those constraints.
- V5 Knowledge Image query and the Evidence Gate do not fill this gap. One filters objects. The other checks relations the host already asserted.
- ${summary.distStale ? 'Committed `packages/core/dist` lags `packages/core/src` on the lexical postings reader. Measurements used a temporary compile of the source so the experiment would follow current code. Production package consumers of this commit still execute the committed dist.' : 'Committed dist and source agreed on the postings reader entry point.'}
- Hand-authored counter-queries can smuggle the answer vocabulary. B4 is an upper bound on a second lexical frontier, not evidence that a generator exists.

## Final recommendation

${recommendationProse(summary)}

The direct answer to the investment question: ${investmentProse(summary)}

Numbers behind that answer, at K = ${g.primaryK}: ceiling conditional dual delta ${statPct(g.gate1CeilingConditionalDualDelta)}; ceiling opposition delta ${statPct(g.ceilingOppositionDelta)}; B2 dual delta ${statPct(g.b2UnconditionalDualDelta)}; B2 opposition delta ${statPct(g.b2OppositionDelta)}; B4 opposition delta ${statPct(g.b4OppositionDelta)}; oracle false sufficiency ${statPct(g.oracleFalseSufficiency)}; gap abstention ${statPct(g.abstentionAccuracy)}; repeated-run mismatches ${summary.determinismMismatches}; greedy miss rate ${g.greedyMissRate === null ? 'n/a' : pct(g.greedyMissRate)}.
`;
}

function executiveProse(summary) {
  const g = summary.gates;
  const d = summary.decision;
  const label = d.label;
  if (label === 'GO') {
    return `The ceiling comparison and the normal lexical pool both move dual coverage and opposition coverage by at least 20 points at K = ${g.primaryK}, false sufficiency on the oracle is ${statPct(g.oracleFalseSufficiency)}, and gap cases abstain at ${statPct(g.abstentionAccuracy)}. Ordinary top-k is not already collecting the opposing frontier. The selector still used fixture labels. A design phase would have to replace those labels. This report does not start that design.`;
  }
  if (label === 'PROMISING BUT BLOCKED') {
    return `Dual-frontier set selection changes which passages are kept when the required passages are already in the pool. The conditional ceiling dual delta versus BM25L top-k is ${statPct(g.gate1CeilingConditionalDualDelta)}. The same comparison against production MMR is ${statPct(g.gate1VsProductionMmr)}. Oracle false sufficiency is ${statPct(g.oracleFalseSufficiency)} and intentional gaps abstain at ${statPct(g.abstentionAccuracy)}.

The block is discovery. On adversarial scenarios the normal query's B2 dual delta is ${statPct(g.b2UnconditionalDualDelta)} and its opposition delta is ${statPct(g.b2OppositionDelta)}. A hand-authored opposing query moves opposition coverage by ${statPct(g.b4OppositionDelta)}. That is large enough to study, and it is not an implementation. Fixture labels remain an oracle input. The result does not justify writing the KAR-1 contract yet. It justifies a narrower experiment on how a deterministic system would propose the opposing query, and on where relation labels would come from without a model in the evaluation loop.`;
  }
  if (label === 'INCONCLUSIVE') {
    return `The run did not separate a stable selection effect from harness or sample noise. Ceiling conditional dual delta is ${statPct(g.gate1CeilingConditionalDualDelta)}. Treat the tables as a failed or partial measurement, not as a product decision.`;
  }
  return `The pre-registered gates do not support KAR as a distinct retrieval capability on this lexical stack. Ceiling conditional dual delta versus top-k is ${statPct(g.gate1CeilingConditionalDualDelta)} (the gate asked for at least 20 points, with the interval above 0). Versus production MMR it is ${statPct(g.gate1VsProductionMmr)}. B2 opposition delta is ${statPct(g.b2OppositionDelta)} and B4 opposition delta is ${statPct(g.b4OppositionDelta)}. Oracle false sufficiency is ${statPct(g.oracleFalseSufficiency)}. Gap abstention is ${statPct(g.abstentionAccuracy)}. Negative-control bounds were ${d.cleanNegative ? 'met' : 'missed'}. Repeated-run mismatches: ${summary.determinismMismatches}.

A ceiling-only win would mean the objective is interesting once labels and passages are handed to the selector. This decision treats that as insufficient when the current lexical pipeline, including a hand-authored second query, does not put the opposing evidence into the budget. Adding a set selector on top of top-k would not create the missing passages.`;
}

function recommendationProse(summary) {
  const action = summary.decision.recommendation;
  if (action === 'proceed to formal KAR-1 design') {
    return 'Proceed to formal KAR-1 design only as a follow-on task. This experiment stops at the report. The design would still have to name the source of relation labels and the candidate generator. Those were oracles and hand-authored strings here.';
  }
  if (action === 'run another research experiment') {
    return 'Run another research experiment. Do not open a KAR-1 design. The selection objective showed a measurable gap versus top-k when passages and labels were already available, and the hand-authored opposing query moved candidate opposition recall. The next useful experiment is deterministic opposing-query generation and a non-model way to test it. It should keep relation labels as fixtures until a separate labeling study exists.';
  }
  return 'Stop. Do not design KAR-1 from this result. Either minimum dual-frontier selection did not beat top-k and MMR by the pre-registered margin once the pool was fair, or counter-evidence remained outside the lexical candidate pool even with a hand-authored opposing query, or a control failed (false sufficiency, abstention, determinism, or the negative-control bounds). A further lexical selector will not repair a missing passage.';
}

function investmentProse(summary) {
  if (summary.decision.label === 'GO') {
    return 'the evidence supports more investment. Ordinary top-k does not already produce sufficient dual-frontier sets, and the current lexical pool is good enough for the selector to matter.';
  }
  if (summary.decision.label === 'PROMISING BUT BLOCKED') {
    return 'the set-selection objective is worth another research experiment, and it is not yet worth a retrieval-contract design. Ordinary top-k leaves opposition out when the wording diverges. The current pipeline also fails to surface that opposition reliably. The complexity is justified only after discovery is shown without hand-authored queries.';
  }
  if (summary.decision.label === 'INCONCLUSIVE') {
    return 'the evidence does not yet answer the investment question. The measurement needs a corrected rerun before anyone spends design time.';
  }
  return 'ordinary deterministic top-k, including the current MMR stage where it already removes near-duplicates, is not shown to be the wrong tool by a margin that survives discovery. Additional KAR machinery is not justified by this benchmark.';
}
