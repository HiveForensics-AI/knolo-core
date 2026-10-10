function pct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

function statPct(stat) {
  if (!stat || stat.mean === null || stat.mean === undefined) return 'n/a';
  if (!stat.ci95 || stat.ci95[0] === null) return `${pct(stat.mean)} (n=${stat.n})`;
  return `${pct(stat.mean)} [${pct(stat.ci95[0])}, ${pct(stat.ci95[1])}] (n=${stat.n})`;
}

function num(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
  return Number(value).toFixed(2);
}

export function renderReport(summary) {
  const methods = summary.methods;
  const names = Object.keys(methods);
  const header = ['Strategy', 'Opposition@50', 'Qualifier@50', 'Support@50', 'Opposition@10', 'Opposition@20'];
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const name of names) {
    const row = methods[name];
    lines.push(`| ${name} | ${statPct(row[50].opposition)} | ${statPct(row[50].qualifier)} | ${statPct(row[50].support)} | ${statPct(row[10].opposition)} | ${statPct(row[20].opposition)} |`);
  }
  const scenarioHeader = ['Scenario', ...names];
  const scenarioLines = [`| ${scenarioHeader.join(' | ')} |`, `| ${scenarioHeader.map(() => '---').join(' | ')} |`];
  for (const [scenario, row] of Object.entries(summary.byScenario)) {
    scenarioLines.push(`| ${scenario} | ${names.map((name) => statPct(row[name])).join(' | ')} |`);
  }
  const activityLines = Object.entries(summary.activity).map(([name, row]) => {
    return `| ${name} | ${num(row.meanTerms)} | ${num(row.meanAnchored)} | ${num(row.meanEdges)} | ${row.queriesChanged} |`;
  });
  const predicates = Object.entries(summary.graph.predicateTotals)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([name, count]) => `- \`${name}\`: ${count}`)
    .join('\n');
  const negative = summary.negative;
  const negativeLines = [10, 20, 50].map((depth) => {
    const row = negative[depth];
    return `| ${depth} | ${statPct(row.baselineUnrequested)} | ${statPct(row.unionUnrequested)} | ${statPct(row.ceilingUnrequested)} | ${statPct(row.baselineIrrelevant)} | ${statPct(row.unionSupport)} |`;
  });
  const decision = summary.decision;
  return `# KAR Experiment 3 — blind relationship activation

Commit: \`${summary.commit}\`

Seed: \`${summary.seed}\`

Fixtures: \`${summary.generator}\` for the adversarial corpus. Scenario N is padded to ${summary.negativeCorpusMin} documents for this run only.

Instances: ${summary.instanceCount}${summary.limited ? ' (probe)' : ''}

Activation version: \`${summary.activationVersion}\`

## Question

Can deterministic anchors over the claim graph Knolo already stores put the missing opposition and qualifier passages into a depth-50 candidate pool, without the answer key and without a cue dictionary?

Experiment 2 left opposition recall at 78.1% and qualifier recall at 50.0%. Scenario D stayed at 0%. The stored \`is\` edge was never entered, because production expansion anchors a node only when its label equals a query token or starts with one.

## What the activator was not allowed to see

Relation labels, fact ids, required frontiers, \`counterQuery\`, and \`qualifierQuery\` stay inside the evaluator. Strategies receive the query string and \`pack.claimGraph\`. They do not read raw passage text and they do not rewrite the query with negation morphology.

A source check refuses the activator if it contains the distinctive hidden terms, the withheld field names, or an import of the fixture generator.

## Methods

All retrieval uses the current lexical pipeline, including default pseudo-relevance expansion. Blind strategies add at most 12 content terms. A content term has length at least 4 and is outside the frozen stop list used for overlap. Function words are not emitted. The term set is sorted before the cap. The union is the union of each blind strategy's top 50 with the baseline and the production prefix expander. It does not include the ceiling.

- \`baseline\`: the original query. This must reproduce the Experiment 1 adversarial opposition recall.
- \`prefix\`: \`expandQueryWithGraph\`, the production exact-label and prefix rule. A local mirror must match it on every instance.
- \`endpoint\`: an edge activates when either endpoint's content tokens intersect the query. Overlap uses tokens of length at least 4 outside a frozen stop list.
- \`phrase\`: a node activates when a query bigram or trigram occurs as a token sequence in its label, or a label bigram or trigram occurs in the query.
- \`reverse\`: from production prefix anchors, walk incoming edges and emit the subject side.
- \`twohop\`: from the union of prefix anchors and endpoint anchors, walk outgoing \`is\`, \`defined_as\`, \`mentions\`, and \`ref\` edges to depth 2.
- \`bridge\`: a subject that does not intersect the query is emitted when its object shares at least 2 content tokens with another query-overlapping node, or the Jaccard of those sets is at least 0.5.
- \`typed\`: bidirectional traversal for \`is\`, \`are\`, \`defined_as\`, and the absent exception, override, and time predicates; outgoing traversal for \`mentions\` and \`ref\`. An edge is entered only from an anchored endpoint. No extractor invents these predicates from raw text.
- \`union\`: the blind candidate pool.
- \`ceiling\`: every stored edge, with no term cap. This is a visibility diagnostic. It is not an anchoring strategy and it is not in the union.

Recall is fact coverage after retrieval. A frontier with no required facts is omitted from the mean. An empty scored list counts as zero coverage of a required frontier.

Pre-registered gate, fixed before the run:

- Adversarial opposition recall of \`union\` at depth 50 at least 90%.
- Qualifier recall of \`union\` at depth 50 at least 85% on instances that require a qualifier.
- Scenario D opposition recall of \`union\` at depth 50 at least 50%.
- Adversarial support recall of \`union\` does not fall more than 5 points from the baseline.
- On the padded scenario N, unrequested-contradiction inclusion of \`union\` at depth 10 is at most 10%. Depths 20 and 50 are reported. A recall pass with a depth-10 damage miss is \`PROMISING BUT DAMAGE\`, not a reason to write a specification.

## Results

${lines.join('\n')}

Opposition recall by scenario at depth 50:

${scenarioLines.join('\n')}

Baseline reproduction against the Experiment 1 opposition figure of 78.1%: delta ${summary.baselineDeltaToExperiment1 === null ? 'n/a' : summary.baselineDeltaToExperiment1.toFixed(4)}.

## What the anchors emitted

| Strategy | Mean extra terms | Mean anchored nodes | Mean edges touched | Instances with any extra term |
| --- | --- | --- | --- | --- |
${activityLines.join('\n')}

Production \`expandQueryWithGraph\` changed ${summary.prefixQueriesChanged} of ${summary.graph.packs} queries.

## Claim graph

Mean nodes ${num(summary.graph.meanNodes)}. Mean edges ${num(summary.graph.meanEdges)}.

Predicate totals across packs:

${predicates || '- none'}

Example stored \`is\` edge whose object shares no query token, from the first pack that has one: ${summary.graph.exampleUnreached ?? 'none'}.

Ceiling opposition rank, adversarial instances that require opposition: scored ${summary.ranks.ceilingOpposition.scored} of ${summary.ranks.ceilingOpposition.eligible}, median rank ${summary.ranks.ceilingOpposition.median ?? 'n/a'}, inside rank 10 on ${summary.ranks.ceilingOpposition.within10}. Baseline opposition inside rank 10: ${summary.ranks.baselineOpposition.within10} of ${summary.ranks.baselineOpposition.eligible}.

Ceiling qualifier rank, instances that require a qualifier: scored ${summary.ranks.ceilingQualifier.scored} of ${summary.ranks.ceilingQualifier.eligible}, median rank ${summary.ranks.ceilingQualifier.median ?? 'n/a'}, inside rank 10 on ${summary.ranks.ceilingQualifier.within10}. A depth-50 hit with a deep median rank is a weak tail score inside a short list, not a top-of-list term match.

## Negative control

Scenario N is padded with warehouse notes to ${summary.negativeCorpusMin} documents. The notes are not definitional sentences. The original unrequested contradiction and the high-lex decoy stay in the corpus. Mean baseline rank of the unrequested contradiction, when it receives a score: ${num(summary.unrequestedRank.mean)}. Instances where it receives no score: ${summary.unrequestedRank.missing}.

| Depth | Baseline unrequested | Union unrequested | Ceiling unrequested | Baseline irrelevant | Union support |
| --- | --- | --- | --- | --- | --- |
${negativeLines.join('\n')}

${[10, 20, 50].every((depth) => summary.negative[depth].baselineUnrequested.mean === summary.negative[depth].unionUnrequested.mean) ? 'The union inclusion rate equals the baseline rate at every depth. The anchors do not add the unrequested contradiction. Its mean baseline rank is 10, and none of the negative instances leave it unscored. Warehouse padding does not enter the scored list, so the 500-document corpus still has a short scored list and depth 10 contains that contradiction for the original query.' : 'The union and baseline inclusion rates differ. See the table.'}

## Decision

${decision.label}

${decision.prose}

## What this does not do

This experiment does not design KAR, does not add relation types to the extractor, and does not treat a hand-authored opposing query or a cue list as a generator. The minimum-set selector remains the Experiment 1 reference. Raw-text negation rewriting stays retired.
`;
}
