/**
 * Report renderer. Numbers come from the summary object produced by the runner.
 */

function pct(metric) {
  if (!metric || metric.n === 0 || metric.mean === null || metric.mean === undefined) return 'n/a';
  const lo = metric.ci95?.[0];
  const hi = metric.ci95?.[1];
  const interval = Number.isFinite(lo) && Number.isFinite(hi) ? ` [${(lo * 100).toFixed(1)}, ${(hi * 100).toFixed(1)}]` : '';
  return `${(metric.mean * 100).toFixed(1)}%${interval} n=${metric.n}`;
}

function num(metric, digits = 1) {
  if (!metric || metric.n === 0 || metric.mean === null || metric.mean === undefined) return 'n/a';
  return `${metric.mean.toFixed(digits)} n=${metric.n}`;
}

function cell(block, method, field) {
  return pct(block?.[method]?.[field]);
}

export function renderReport(summary) {
  const decision = summary.decision?.label ?? 'INCONCLUSIVE';
  const model = summary.model ?? {};
  const gates = summary.gates ?? {};
  const holdout = summary.holdout ?? {};
  const development = summary.development ?? {};
  const damage = summary.damage ?? {};
  const methods = ['b0', 'l0', 'g1', 'oracle'];
  const header = '| Method | Support@50 | Opposition@50 | Qualifier@50 |\n| --- | --- | --- | --- |';
  const table = (block) => [header, ...methods.map((method) => `| ${method} | ${cell(block, method, 'support')} | ${cell(block, method, 'opposition')} | ${cell(block, method, 'qualifier')} |`)].join('\n');
  const ablationHeader = '| Ablation | Opposition@50 | Qualifier@50 | Support@50 |\n| --- | --- | --- | --- |';
  const ablationRows = Object.entries(summary.ablations?.holdout ?? {}).map(([name, metrics]) => (
    `| ${name} | ${pct(metrics.opposition)} | ${pct(metrics.qualifier)} | ${pct(metrics.support)} |`
  ));
  const domainRows = Object.entries(summary.holdoutDomains ?? {}).map(([name, metrics]) => (
    `| ${name} | ${pct(metrics.opposition)} | ${pct(metrics.qualifier)} |`
  ));
  const justify = decision === 'GO_TO_KAR_SPEC'
    ? 'The unseen-wording gates passed. The evidence justifies writing the formal KAR specification. This experiment does not write it.'
    : 'The evidence does not justify writing the formal KAR specification. This experiment does not write it.';
  return `# KAR Experiment 5 — Vocabulary-independent Semantic Compilation

## Decision

**${decision}**

Candidate method: \`g1\`. ${summary.decision?.gatesOk ? 'Holdout gates passed.' : 'Holdout gates did not all pass.'} Query-time mismatches: ${summary.determinism?.mismatches ?? 'n/a'}.

Can a compiler derive canonical concepts from the documents alone, without a hand-authored domain lexicon, commit those relationships, and then retrieve opposition and qualification for wording it was never given?

${decision === 'GO_TO_KAR_SPEC' ? 'Yes. The frozen artifact supported deterministic retrieval on wording outside the Experiment 4 lexicon.' : 'The measured result is the decision above. Retrieval stayed deterministic. Generalization is the quantity under test.'}

If yes, does the evidence justify writing the formal KAR specification?

${justify}

## What was frozen

Compiler files \`compile.mjs\`, \`activate.mjs\`, and \`canonicalize.mjs\` were hashed before this benchmark was scored. The runner refuses to score queries if that hash changes. The prompt, the alias cleaner, and the dual-anchor rule were not edited after that hash.

G1 is a non-deterministic compiler with committed frozen output. The local model runs only while the artifact is built. Query-time activation reads the frozen bytes and does not call a model.

L0 is the Experiment 4 deterministic lexicon compiler, used here as a vocabulary control. It is not the candidate.

S2 from Experiment 4 was not rerun. Its holdout result remains in that experiment.

Model status: ${model.available ? 'RUN' : 'NOT RUN — MODEL UNAVAILABLE'}.
Provider ${model.provider ?? 'n/a'}, model ${model.model ?? 'n/a'}, digest ${model.digest ?? 'n/a'}, temperature ${model.temperature ?? 'n/a'}, prompt ${model.promptDigest ?? 'n/a'}, compiler ${model.compiler ?? 'n/a'}.
Model calls ${model.calls ?? 0}, cache hits ${model.cacheHits ?? 0}, parse failures ${model.failures ?? 0}, attempted ${model.attempted ?? 0}, parse-failure rate ${model.parseRate === null || model.parseRate === undefined ? 'n/a' : `${(model.parseRate * 100).toFixed(1)}%`}.

## Pre-registered gates

These thresholds were fixed before scoring. They apply to the holdout, where every opposition sentence and every qualifier sentence is unseen wording.

- OppositionRecall@50 ≥ ${(gates.opposition * 100).toFixed(0)}%
- QualifierRecall@50 ≥ ${(gates.qualifier * 100).toFixed(0)}%
- Support recall drops no more than ${(gates.supportDrop * 100).toFixed(0)} points versus holdout B0
- Damage@10 ≤ ${(gates.damage * 100).toFixed(0)}% for unrequested opposition and qualifiers
- Query-time mismatches = 0
- L0 opposition@50 ≤ ${(gates.lexiconControl * 100).toFixed(0)}%, otherwise the fixture leaked the old lexicon and the run is inconclusive
- Parse-failure rate ≤ ${(gates.parseFailure * 100).toFixed(0)}%, otherwise the compiler did not actually run

Development uses the same kind of unseen pairs and is reported separately. It is not part of the gate.

## Method

G1 asks the local model to name the entity, other ordinary names for that entity, the underlying action, and ordinary verbs for that action. A persistence sentence is instructed to become a prohibition of ending it. A sentence about an earlier group keeping a different rule is instructed to become a qualification. The prompt does not list a domain synonym table.

Query-time activation is deterministic. The candidate seeds a claim only when the query matches both an entity alias and an action alias. Lexical retrieval is then unioned so support that is already in the lexical pool stays there. Action-only activation is a diagnostic. It is not the candidate, because a generic ending verb would attach unrelated persistence sentences to an unrelated query.

## Holdout

Holdout n=${summary.counts?.holdout ?? 0}. Every case is token-disjoint from its opposition and qualifier. Domains: lodging, software access, and field equipment. Seed ${summary.holdoutSeed}.

${table(holdout)}

B0 is lexical retrieval. L0 is the Experiment 4 lexicon compiler. G1 is the vocabulary-independent compiler. The oracle column lists the labeled evidence. It is not a retrieval method.

| Domain | G1 opposition | G1 qualifier |
| --- | --- | --- |
${domainRows.join('\n')}

## Development

Development n=${summary.counts?.development ?? 0}. Same construction, different entities and different wording. Seed ${summary.seed}.

${table(development)}

## Ablation of g1 on the holdout

| Ablation | Opposition@50 | Qualifier@50 | Support@50 |
| --- | --- | --- | --- |
${ablationRows.join('\n')}

\`full\` is the candidate. \`action-only\` drops the entity requirement. \`entity-only\` drops the action requirement. \`surface-only\` ignores paraphrase aliases and uses the words copied from the passage. \`siblings\` adds other claims that share a concept id. \`no-lexical-union\` omits the lexical pool.

## Negative control

Instances n=${summary.counts?.negative ?? 0}. Corpus size ${summary.counts?.negativeCorpus ?? 0}. Each query asks to cancel an unrelated record. Decoys are persistence and qualification sentences about other things, with the same syntactic shape as the benchmark. Damage is method inclusion minus baseline inclusion at depth 10.

| Check | Rate |
| --- | --- |
| Baseline opposition inclusion | ${pct(damage.baselineOpposition)} |
| Baseline qualifier inclusion | ${pct(damage.baselineQualifier)} |
| G1 opposition inclusion | ${pct(damage.g1Opposition)} |
| G1 qualifier inclusion | ${pct(damage.g1Qualifier)} |
| G1 opposition damage | ${pct(damage.opposition)} |
| G1 qualifier damage | ${pct(damage.qualifier)} |
| Action-only opposition damage | ${pct(damage.actionOnlyOpposition)} |
| Action-only qualifier damage | ${pct(damage.actionOnlyQualifier)} |
| Pool growth at 50 | ${num(damage.poolGrowth, 2)} |

## Artifact audit

| Artifact | Claims | Edges | Alias slots | Bytes | Build ms |
| --- | --- | --- | --- | --- | --- |
| l0 | ${num(summary.audits?.l0?.claims, 1)} | ${num(summary.audits?.l0?.edges, 1)} | ${num(summary.audits?.l0?.aliasSlots, 1)} | ${num(summary.audits?.l0?.bytes, 0)} | ${num(summary.audits?.l0?.buildMs, 1)} |
| g1 | ${num(summary.audits?.g1?.claims, 1)} | ${num(summary.audits?.g1?.edges, 1)} | ${num(summary.audits?.g1?.aliasSlots, 1)} | ${num(summary.audits?.g1?.bytes, 0)} | ${num(summary.audits?.g1?.buildMs, 1)} |

G1 relation totals: ${(summary.relationTotals ?? []).map((item) => `${item.relation} ${item.count}`).join(', ') || 'n/a'}.

Median G1 artifact size is ${summary.audits?.g1?.bytes?.median ?? 'n/a'} bytes. The 256 KiB comparison is descriptive. The artifact is not integrated.

## Commitment proof

Instance ${summary.proof?.instance ?? 'n/a'}. First root ${summary.proof?.first ?? 'n/a'}. Second build from the frozen model cache ${summary.proof?.second ?? 'n/a'}. Reload ${summary.proof?.reloaded ?? 'n/a'}. Identical: ${summary.proof?.identical ? 'yes' : 'no'}. Canonical bytes ${summary.proof?.canonicalBytes ?? 'n/a'}. V5 state roots were not modified.

Query-time activation was repeated ${summary.determinism?.runs ?? 0} times. Mismatches: ${summary.determinism?.mismatches ?? 'n/a'}.

## Gain

Holdout opposition gain of G1 over the better of B0 and L0: ${summary.decision?.oppGain === undefined ? 'n/a' : `${(summary.decision.oppGain * 100).toFixed(1)} points`}. Holdout qualifier gain: ${summary.decision?.qualGain === undefined ? 'n/a' : `${(summary.decision.qualGain * 100).toFixed(1)} points`}. Support drop versus holdout B0: ${summary.decision?.supportDrop === undefined ? 'n/a' : `${(summary.decision.supportDrop * 100).toFixed(1)} points`}.
`;
}
