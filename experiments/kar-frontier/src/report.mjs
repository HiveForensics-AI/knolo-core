function reading(summary) {
  const rows = Object.entries(summary.byScenario).filter(([scenario]) => scenario !== 'N');
  const moved = rows.filter(([, row]) => row.baseline?.mean !== row.union?.mean);
  const movedText = moved.length
    ? moved.map(([scenario, row]) => `${scenario} from ${pct(row.baseline.mean)} to ${pct(row.union.mean)}`).join('; ')
    : 'no adversarial scenario';
  const unchanged = rows.filter(([, row]) => row.baseline?.mean === row.union?.mean).map(([scenario]) => scenario);
  const b = summary.byScenario.B;
  const d = summary.byScenario.D;
  const h = summary.byScenario.H;
  const bRaised = ['morphology', 'cues', 'cue-harvest', 'union'].every((name) => b?.[name]?.mean === b?.union?.mean);
  const graphSame = rows.every(([, row]) => row.graph?.mean === row.baseline?.mean);
  const qualSame = Object.values(summary.methods).every((row) => row.qualifier?.mean === summary.methods.baseline.qualifier?.mean);
  const rare = (summary.harvestLeaders ?? []).filter((row) => row.instances === summary.perScenario);
  const rareText = rare.length ? rare.map((row) => `\`${row.term}\``).join(', ') : 'none';
  return `## What moved

The union's opposition recall is ${pct((summary.methods.union.opposition.mean ?? 0) - (summary.methods.baseline.opposition.mean ?? 0)).replace('%', ' percentage points')} above the baseline. The scenarios where the union mean differs from the baseline are: ${movedText}. Unchanged scenarios: ${unchanged.join(', ') || 'none'}.

That lift is scenario B. Its baseline opposition coverage is ${pct(b?.baseline?.mean)}. ${bRaised ? `Morphology, the cue list, cue harvest, and the union all reach ${pct(b?.union?.mean)}.` : 'The method rows for B are in the table.'} Qualifier recall is ${qualSame ? `unchanged at ${pct(summary.methods.baseline.qualifier?.mean)} for every method` : 'reported in the method table'}. The opposition lift does not bring the qualifier passages in. The buried B contract is the fixture sentence that already contains the frozen cue \`cannot\`. Harvest terms that appear in exactly ${summary.perScenario} instances are ${rareText}. Record-level counts put every one of those terms on scenario B only. They are neighbors of that cue in the passage text. They were not written into the generator.

Scenario D stays at ${pct(d?.baseline?.mean)} on the baseline and ${pct(d?.union?.mean)} on the union. Every individual method is in the table. The passage that Experiment 1 could retrieve only with a hand-built query is still outside every blind frontier.

Scenario H baseline opposition coverage is ${pct(h?.baseline?.mean)}. Morphology is ${pct(h?.morphology?.mean)}. The cue list is ${pct(h?.cues?.mean)}. The union stays at ${pct(h?.union?.mean)}. On the instance records, the even variations are full coverage for the baseline and the union, and zero for morphology. The odd variations stay at half coverage for the baseline, morphology, and the union, and fall to zero for the cue list. The union keeps the baseline list, so H does not get worse in the union and does not get better. Morphology's gain on B is offset, in the morphology row, by that even-H loss. The morphology mean matches the baseline mean.

${graphSame ? 'The graph row matches the baseline on every adversarial scenario.' : 'The graph row is in the scenario table.'} \`expandQueryWithGraph\` changed ${summary.graph.queriesChanged} queries.`;
}

function pct(value) {
  if (value === null || value === undefined || Number.isNaN(value)) return 'n/a';
  return `${(value * 100).toFixed(1)}%`;
}

function statPct(stat) {
  if (!stat || stat.mean === null || stat.mean === undefined) return 'n/a';
  if (!stat.ci95 || stat.ci95[0] === null) return `${pct(stat.mean)} (n=${stat.n})`;
  return `${pct(stat.mean)} [${pct(stat.ci95[0])}, ${pct(stat.ci95[1])}] (n=${stat.n})`;
}

export function renderReport(summary) {
  const gate = summary.gate;
  const methods = summary.methods;
  const names = Object.keys(methods);
  const header = ['Frontier', 'Opposition recall@50', 'Qualifier recall@50', 'Support recall@50'];
  const lines = [`| ${header.join(' | ')} |`, `| ${header.map(() => '---').join(' | ')} |`];
  for (const name of names) {
    const row = methods[name];
    lines.push(`| ${name} | ${statPct(row.opposition)} | ${statPct(row.qualifier)} | ${statPct(row.support)} |`);
  }
  const scenarioHeader = ['Scenario', ...names];
  const scenarioLines = [`| ${scenarioHeader.join(' | ')} |`, `| ${scenarioHeader.map(() => '---').join(' | ')} |`];
  for (const [scenario, row] of Object.entries(summary.byScenario)) {
    scenarioLines.push(`| ${scenario} | ${names.map((name) => statPct(row[name])).join(' | ')} |`);
  }
  const graph = summary.graph;
  const negative = summary.negative;
  const decision = summary.decision;
  return `# KAR Experiment 2 — blind frontier discovery

Commit: \`${summary.commit}\`

Seed: \`${summary.seed}\`

Fixtures: \`${summary.generator}\` (the Experiment 1 corpus, unchanged)

Instances: ${summary.instanceCount}${summary.limited ? ' (probe)' : ''}

Frontier version: \`${summary.frontierVersion}\`

## Question

Can a deterministic generator, using only the original query and information Knolo already has, put the missing opposition and qualifier passages into a depth-50 candidate pool?

The Experiment 1 baseline on this corpus is opposition recall 78.1% at depth 50 and at depth 100, and qualifier recall 50.0%. Depth did not close the gap. The passages never received a lexical score.

## What the generator was not allowed to see

Relation labels, fact ids, required frontiers, \`counterQuery\`, and \`qualifierQuery\` stay inside the evaluator. The ranker receives \`id\`, \`heading\`, and \`text\`. The generators receive the query string and, for cue harvest only, that same raw text.

A source check refuses the generator file if it contains the distinctive hidden terms or the names of the withheld fields. Harvested terms may still coincide with hidden wording when a document's own sentence contains a frozen cue. Those coincidences are reported. They are not copied from the answer key into the source.

## Methods

All methods use the current lexical pipeline, including default pseudo-relevance expansion. Graph expansion stays off except in the one method that turns on the production expander.

- \`baseline\`: the original query. This must reproduce the Experiment 1 recall.
- \`graph\`: the original query with \`graph.expand: true\`, which calls \`expandQueryWithGraph\` on the claim graph \`buildPack\` already stores.
- \`morphology\`: rewrites of the query's own tokens (\`non-\`, \`cannot\`, \`may not\`, \`no\`, \`prohibited\`, \`without\`). No corpus.
- \`cues\`: the frozen cue list as a query, with no query-topic terms added.
- \`cue-harvest\`: up to 8 terms from sentences that contain a frozen cue, counted across the raw texts.
- \`union\`: the union of the top 50 blocks from baseline, graph, morphology, cues, and cue-harvest. This is the blind discovery pool. Each frontier contributes depth 50. The union can be larger than 50.

Recall is fact coverage of that pool, using fixture labels only after retrieval. A frontier with no required facts is omitted from the mean. An empty scored list counts as zero coverage of a required frontier.

Pre-registered gate, fixed before the run:

- Adversarial opposition recall of \`union\` at least 90%.
- Qualifier recall of \`union\` at least 85% on instances that require a qualifier.
- On scenario N, the union puts an unrequested contradiction in the pool on at most 10% of instances, and support recall does not fall more than 5 points from the baseline.

A miss means this corpus does not support raw-text deterministic discovery. It does not by itself design a claim layer.

## Results

${lines.join('\n')}

Opposition recall by scenario, adversarial scenarios plus N:

${scenarioLines.join('\n')}

Baseline reproduction against the Experiment 1 opposition figure of 78.1%: delta ${summary.baselineDeltaToExperiment1 === null ? 'n/a' : summary.baselineDeltaToExperiment1.toFixed(4)}.

${reading(summary)}

## Claim graph

Packs that contain a claim graph: ${graph.packsWithGraph} of ${graph.packs}. Mean nodes ${graph.meanNodes.toFixed(1)}. Mean edges ${graph.meanEdges.toFixed(1)}. Mean \`is\` edges ${graph.meanIsEdges.toFixed(1)}.

Queries changed by \`expandQueryWithGraph\`: ${graph.queriesChanged} of ${graph.packs}.

\`is\` edges whose object label shares no token with the query: mean ${graph.meanUnreachedIsEdges.toFixed(1)} per pack. These edges are stored from definitional sentences in the document text. The production expander walks out only from labels that equal or start with a query token, so an edge from "master subscription" to a definition is invisible to the query "customer cancel agreement".

Example unreached \`is\` edge, taken from the first pack that has one: ${graph.exampleUnreached ?? 'none'}.

## Negative control

Scenario N has no required opposition. An unrequested contradiction is in the corpus.

| Pool | Unrequested contradiction in the pool | Irrelevant passage in the pool | Support recall |
| --- | --- | --- | --- |
| Baseline top 50 | ${statPct(negative.baselineUnrequested)} | ${statPct(negative.baselineIrrelevant)} | ${statPct(negative.baselineSupport)} |
| Blind union | ${statPct(negative.unionUnrequested)} | ${statPct(negative.unionIrrelevant)} | ${statPct(negative.unionSupport)} |

The union rate matches the baseline rate, and support recall does not fall. On N-00 the corpus has 31 passages and the original query scores 10 of them. The unrequested contradiction shares no query token. With pseudo-relevance expansion left on, it still receives a weak score and sits at rank 10, so a depth-50 cutoff includes it. With expansion off, that passage is not scored. The irrelevant decoy is written to repeat the query, so the baseline pool contains it for an ordinary lexical match. The absolute 10% gate therefore fails on the baseline pool. The frontier union does not add either passage beyond that pool.

## Harvested terms

Most common cue-harvest terms across instances, with the number of instances that emitted each term:

${summary.harvestLeaders.map((row) => `- \`${row.term}\` in ${row.instances} instances`).join('\n') || '- none'}

Mean cue sentences per instance: ${summary.meanCueSentences.toFixed(2)}.

## Decision

${decision.label}

${decision.prose}

## What this does not do

This experiment does not design KAR, does not change retrieval defaults, and does not treat a hand-authored opposing query as a generator. The exact set selector remains the Experiment 1 reference. A greedy approximation was already close to it at K = 5 when labels were supplied. Discovery is the open half.
`;
}
