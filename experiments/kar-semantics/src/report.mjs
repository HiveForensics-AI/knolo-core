function pct(point) {
  if (!point || !Number.isFinite(point.mean)) return 'n/a';
  const ci = point.ci95?.every((value) => Number.isFinite(value))
    ? ` [${(point.ci95[0] * 100).toFixed(1)}, ${(point.ci95[1] * 100).toFixed(1)}]`
    : '';
  return `${(point.mean * 100).toFixed(1)}%${ci} n=${point.n}`;
}

function num(point, digits = 1) {
  if (!point || !Number.isFinite(point.mean)) return 'n/a';
  return `${point.mean.toFixed(digits)} n=${point.n}`;
}

function row(summary, split, method) {
  const block = summary[split][method];
  if (!block) return '';
  const disconnect = split === 'holdout' ? pct(block.disconnect) : pct(block.scenarioD);
  return `| ${method} | ${pct(block.support)} | ${pct(block.opposition)} | ${pct(block.qualifier)} | ${pct(block.temporal)} | ${disconnect} |`;
}

export function renderReport(summary) {
  const decision = summary.decision;
  const methods = ['b0', 'b1', 'b2', 'b3', 's0', 's1', ...(summary.s2Status === 'RUN' ? ['s2'] : []), 'oracle'];
  const best = summary.best;
  const ablationRows = Object.entries(summary.ablations).map(([name, block]) => (
    `| ${name} | ${pct(block.developmentOpposition)} | ${pct(block.scenarioD)} | ${pct(block.holdoutOpposition)} | ${pct(block.holdoutQualifier)} | ${pct(block.holdoutSupport)} | ${pct(block.holdoutTemporal)} |`
  ));
  const s1Audit = summary.audits.s1;
  const s2Audit = summary.audits.s2;
  const ship = s1Audit && Number.isFinite(s1Audit.bytes.median) && s1Audit.bytes.median <= 262144;
  return `# KAR Experiment 4 — Committed Evidence Semantics

## Decision

**${decision.label}**

Candidate method: \`${decision.candidate}\`. Holdout gates ${decision.holdoutPass ? 'passed' : 'failed'}. Development gates ${decision.devPass ? 'passed' : 'failed'}. Damage gate ${decision.damagePass ? 'passed' : 'failed'}. Query-time determinism mismatches: ${summary.determinism.mismatches}.

Can Knolo move semantic interpretation to Knowledge Image construction, commit the resulting evidence relationships, and then perform deterministic opposition and qualification discovery at query time?

${decision.label === 'CURRENT_KAR_DIRECTION_NO_GO'
    ? 'On this benchmark, committed semantic compilation did not materially improve discovery of the disconnected evidence.'
    : 'The frozen semantic artifact supports deterministic query-time frontier retrieval, and the measured gain comes from relationships committed before the query is seen.'}

If yes, does the evidence now justify writing the formal KAR mathematical specification?

${decision.label === 'GO_TO_KAR_SPEC'
    ? 'The holdout gates, the semantic-disconnection cases, the damage bound, and query-time determinism all passed. That is enough evidence to write the specification later. This experiment does not write it.'
    : 'The evidence does not justify writing the formal KAR specification in this state. This experiment does not write it.'}

## What was frozen

Compiler files \`lexicon.mjs\`, \`compile.mjs\`, \`activate.mjs\`, \`canonicalize.mjs\`, and \`s2.mjs\` were hashed before holdout scoring. The runner refuses to score queries if that hash changes. The hash was refreshed before the official run so a dropped local-model connection is retried and generation length is capped. The prompt text, the lexicon, and the relation rules were not changed.

S1 is a ${summary.compilerClassification.s1}. S2 is ${summary.compilerClassification.s2}.

S2 status: ${summary.s2Status}.
${summary.model?.model ? `Provider ${summary.model.provider}, model ${summary.model.model}, digest ${summary.model.digest}, temperature ${summary.model.temperature}, prompt ${summary.model.promptDigest}, compiler ${summary.model.compiler}. Model calls ${summary.model.calls}, cache hits ${summary.model.cacheHits}, parse failures ${summary.model.failures}.` : ''}

Pre-registered gates, unchanged after the run: opposition recall at 50 ≥ 90%, qualifier recall at 50 ≥ 85%, scenario D or holdout disconnection ≥ 75%, support recall drops no more than 5 points, damage at 10 ≤ 10% for unrequested opposition and qualifiers, query-time mismatches = 0. Development and holdout must both clear the recall gates for \`GO_TO_KAR_SPEC\`.

## Development benchmark

Adversarial n=${summary.counts.adversarial}. Scenario D n=${summary.counts.scenarioD}. The oracle column is an evaluation ceiling. It is not a retrieval method.

| Method | Support@50 | Opposition@50 | Qualifier@50 | Temporal@50 | Scenario D opposition |
| --- | --- | --- | --- | --- | --- |
${methods.map((method) => row(summary, 'development', method)).filter(Boolean).join('\n')}

B0 is current lexical retrieval. B1 is lexical retrieval plus MMR. B2 is current claim-graph expansion. B3 is Experiment 3 blind activation. S0 is that same production graph projected into the experimental image. S1 is the deterministic compiler. S2 is the model-assisted compiler when it ran.

## Holdout benchmark

Holdout n=${summary.counts.holdout}. Disconnect cases n=${summary.counts.holdoutDisconnect}. Qualifier-required n=${summary.counts.holdoutQualifier}. Temporal n=${summary.counts.holdoutTemporal}. Domains: commercial contracts, software policy, and equipment operations. Seed ${summary.holdoutSeed}.

| Method | Support@50 | Opposition@50 | Qualifier@50 | Temporal@50 | Disconnect opposition |
| --- | --- | --- | --- | --- | --- |
${methods.map((method) => row(summary, 'holdout', method)).filter(Boolean).join('\n')}

In-lexicon opposition for S1: ${pct(summary.holdout.s1.inLexiconOpposition)}. Stress opposition for S1: ${pct(summary.holdout.s1.stressOpposition)}. In-lexicon qualifiers for S1: ${pct(summary.holdout.s1.inLexiconQualifier)}. Stress qualifiers for S1: ${pct(summary.holdout.s1.stressQualifier)}.
${summary.holdout.s2 ? `In-lexicon opposition for S2: ${pct(summary.holdout.s2.inLexiconOpposition)}. Stress opposition for S2: ${pct(summary.holdout.s2.stressOpposition)}. In-lexicon qualifiers for S2: ${pct(summary.holdout.s2.inLexiconQualifier)}. Stress qualifiers for S2: ${pct(summary.holdout.s2.stressQualifier)}.` : ''}

The stress stratum uses paraphrases that are absent from the frozen alias list. It is reported separately and was not removed after the run.

## Negative control

Instances n=${summary.counts.negative}. Corpus size ${summary.counts.negativeCorpus}. Damage is method inclusion minus baseline inclusion at depth 10.

| Method | Baseline opposition inclusion | Method opposition inclusion | Opposition damage | Qualifier damage | Pool growth at 50 |
| --- | --- | --- | --- | --- | --- |
| s1 | ${pct(summary.damage.s1.baselineOpposition)} | ${pct(summary.damage.s1.methodOpposition)} | ${pct(summary.damage.s1.opposition)} | ${pct(summary.damage.s1.qualifier)} | ${num(summary.damage.s1.poolGrowth)} |
${summary.damage.s2 ? `| s2 | ${pct(summary.damage.s2.baselineOpposition)} | ${pct(summary.damage.s2.methodOpposition)} | ${pct(summary.damage.s2.opposition)} | ${pct(summary.damage.s2.qualifier)} | ${num(summary.damage.s2.poolGrowth)} |` : ''}

## Ablation of ${best}

One feature is removed at a time. \`no-alias-no-reverse\` is an extra diagnostic for the case where the direct alias path and the sibling path are redundant.

| Ablation | Dev opposition | Scenario D | Holdout opposition | Holdout qualifier | Holdout support | Holdout temporal |
| --- | --- | --- | --- | --- | --- | --- |
${ablationRows.join('\n')}

## Artifact audit

| Artifact | Claims | Edges | Alias slots | Bytes | Build ms | Pack bytes |
| --- | --- | --- | --- | --- | --- | --- |
| s0 | ${num(summary.audits.s0.claims)} | ${num(summary.audits.s0.edges)} | ${num(summary.audits.s0.aliasCount)} | ${num(summary.audits.s0.bytes, 0)} | ${num(summary.audits.s0.latencyMs)} | ${num(summary.audits.s0.packBytes, 0)} |
| s1 | ${num(s1Audit.claims)} | ${num(s1Audit.edges)} | ${num(s1Audit.aliasCount)} | ${num(s1Audit.bytes, 0)} | ${num(s1Audit.latencyMs)} | ${num(s1Audit.packBytes, 0)} |
${s2Audit ? `| s2 | ${num(s2Audit.claims)} | ${num(s2Audit.edges)} | ${num(s2Audit.aliasCount)} | ${num(s2Audit.bytes, 0)} | ${num(s2Audit.latencyMs)} | ${num(s2Audit.packBytes, 0)} |` : ''}

S1 relation totals: ${Object.entries(s1Audit.relations).map(([key, value]) => `${key} ${value}`).join(', ') || 'none'}.
${s2Audit ? `S2 relation totals: ${Object.entries(s2Audit.relations).map(([key, value]) => `${key} ${value}`).join(', ') || 'none'}.` : ''}

Median S1 artifact size is ${ship ? 'small enough to store beside a Knowledge Image' : 'large enough that shipping it beside a Knowledge Image needs a separate budget'}. Median bytes ${s1Audit.bytes.median ?? 'n/a'} against median pack bytes ${s1Audit.packBytes.median ?? 'n/a'}. It is not integrated.

## Commitment proof

Instance ${summary.proof?.instance ?? 'n/a'}. First root ${summary.proof?.first ?? 'n/a'}. Second build ${summary.proof?.second ?? 'n/a'}. Reload of the frozen bytes ${summary.proof?.reloaded ?? 'n/a'}. Identical: ${summary.proof?.identical ? 'yes' : 'no'}. Canonical bytes ${summary.proof?.canonicalBytes ?? 'n/a'}. V5 state roots were not modified.

Query-time activation was repeated 100 times on the development proof artifact and 100 times on the first holdout artifact. Mismatches: ${summary.determinism.mismatches}.

## Existing selector on the discovered pool

This applies the Experiment 1 oracle selector at K=5. It sees benchmark labels, so it is not a retrieval result. Development adversarial B0 pool ${pct(summary.selector.b0)}, S1 pool ${pct(summary.selector.s1)}. Holdout B0 pool ${pct(summary.selector.holdoutB0)}, S1 pool ${pct(summary.selector.holdoutS1)}.

## Gain

Holdout opposition gain for the candidate: ${(decision.oppGain * 100).toFixed(1)} points. Holdout disconnect gain: ${(decision.disconnectGain * 100).toFixed(1)} points. Development scenario D gain: ${(decision.devDGain * 100).toFixed(1)} points.
`;
}
