import { createKnowledgeImageV5 } from '../../../knowledge_image_v5.js';
import { createKarSession, evaluateKar } from '../session.js';
import { compileCegSource } from './compile.js';
import { diagnostic, type CegDiagnostic } from './diagnostics.js';
import { compareText, domainPackRoot, instantiatePlanTemplate, type DomainPackV1 } from './domain.js';
import { openEvidenceCatalog } from './catalog.js';
import { runRuleProducer } from './rules.js';

export type DomainFixture = {
  id: string;
  documents: Array<{ source: string; text: string; meta?: Record<string, string> }>;
  expect?: {
    concepts?: string[];
    relations?: Array<{ from: string; type: string; to: string }>;
    bindings?: Array<{ concept: string; source: string; requirements: string[]; authority?: number; validFrom?: string; validUntil?: string }>;
    diagnosticCodes?: string[];
    kar?: { template: string; proposition: string; status: string };
  };
};

export type DomainTestReport = {
  ok: boolean;
  domainPackRoot: string;
  rules: number;
  matchedRules: string[];
  unmatchedRules: string[];
  proposalCount: number;
  diagnosticCount: number;
  fixtures: Array<{ id: string; ok: boolean; message: string }>;
};

const encoder = new TextEncoder();

export function testDomainFixtures(pack: DomainPackV1, fixtures: readonly DomainFixture[]): DomainTestReport {
  const matched = new Set<string>();
  let proposalCount = 0;
  let diagnosticCount = 0;
  const results: DomainTestReport['fixtures'] = [];
  for (const fixture of fixtures) {
    const image = createKnowledgeImageV5({
      actor: `ceg-domain-${pack.id}`,
      sequence: 1,
      objects: [...fixture.documents].sort((left, right) => compareText(left.source, right.source)).map((document) => ({
        kind: 'chunk' as const,
        bytes: encoder.encode(document.text),
        meta: { source: document.source, ...(document.meta ?? {}) },
      })),
    });
    const ran = runRuleProducer({ pack, image: image.bytes });
    if (!ran.ok) {
      results.push({ id: fixture.id, ok: false, message: ran.diagnostics.map((item) => item.code).join(',') });
      continue;
    }
    proposalCount += ran.run.proposals.length;
    diagnosticCount += ran.run.diagnostics.length;
    for (const observation of ran.run.observations) {
      if (observation.ruleId) matched.add(observation.ruleId);
    }
    const problems = checkFixture(pack, fixture, ran.run, image.bytes);
    results.push({ id: fixture.id, ok: problems.length === 0, message: problems.join('; ') || 'pass' });
  }
  const unmatchedRules = pack.rules.map((rule) => rule.id).filter((id) => !matched.has(id)).sort(compareText);
  return {
    ok: results.every((result) => result.ok),
    domainPackRoot: domainPackRoot(pack),
    rules: pack.rules.length,
    matchedRules: [...matched].sort(compareText),
    unmatchedRules,
    proposalCount,
    diagnosticCount,
    fixtures: results,
  };
}

export function renderDomainTest(report: DomainTestReport): string {
  const lines = [
    report.ok ? 'CEG DOMAIN PASS' : 'CEG DOMAIN FAIL',
    `root             ${report.domainPackRoot}`,
    `rules            ${report.rules}`,
    `rules matched    ${report.matchedRules.length}`,
    `rules unmatched  ${report.unmatchedRules.join(', ') || '(none)'}`,
    `proposals        ${report.proposalCount}`,
    `diagnostics      ${report.diagnosticCount}`,
  ];
  for (const fixture of report.fixtures) {
    lines.push(`${fixture.ok ? 'pass' : 'fail'}  ${fixture.id}  ${fixture.message}`);
  }
  return lines.join('\n');
}

function checkFixture(pack: DomainPackV1, fixture: DomainFixture, run: { fragment: { concepts: Record<string, unknown>; relations: Array<{ from: string; type: string; to: string }>; bindings: Array<{ concept: string; evidence: string; requirements: string[]; authority?: number; validFrom?: string; validUntil?: string }> }; diagnostics: CegDiagnostic[] }, image: Uint8Array): string[] {
  const expect = fixture.expect ?? {};
  const problems: string[] = [];
  if (expect.concepts) {
    const actual = Object.keys(run.fragment.concepts).sort(compareText).join(',');
    const wanted = [...expect.concepts].sort(compareText).join(',');
    if (actual !== wanted) problems.push(`concepts ${actual}`);
  }
  if (expect.relations) {
    const actual = run.fragment.relations.map(relationKey).sort(compareText).join('|');
    const wanted = expect.relations.map(relationKey).sort(compareText).join('|');
    if (actual !== wanted) problems.push(`relations ${actual}`);
  }
  if (expect.bindings) {
    const catalog = openEvidenceCatalog(image);
    if (!catalog.ok) return ['catalog'];
    const bySource = new Map<string, string>();
    for (const object of catalog.catalog.objects) {
      if (object.source) bySource.set(object.source, object.id);
    }
    const actual = run.fragment.bindings.map((binding) => bindingKey(binding, binding.evidence)).sort(compareText).join('|');
    const wanted = expect.bindings.map((binding) => bindingKey({
      concept: binding.concept,
      requirements: binding.requirements,
      authority: binding.authority,
      validFrom: binding.validFrom,
      validUntil: binding.validUntil,
    }, bySource.get(binding.source) ?? '')).sort(compareText).join('|');
    if (actual !== wanted) problems.push(`bindings ${actual}`);
  }
  if (expect.diagnosticCodes) {
    const actual = run.diagnostics.map((item) => item.code).sort(compareText).join(',');
    const wanted = [...expect.diagnosticCodes].sort(compareText).join(',');
    if (actual !== wanted) problems.push(`diagnostics ${actual}`);
  }
  if (expect.kar) {
    const template = instantiatePlanTemplate(pack, expect.kar.template);
    if (!template.ok) return [...problems, 'plan'];
    const compiled = compileCegSource({ source: run.fragment as never, image });
    if (!compiled.ok) return [...problems, compiled.diagnostics.map((item) => item.code).join(',') || 'compile'];
    const session = createKarSession({ image, graph: compiled.sidecar });
    const result = evaluateKar(session, { proposition: expect.kar.proposition, plan: template.plan });
    if (result.status !== expect.kar.status) problems.push(`kar ${result.status}`);
  }
  return problems;
}

function relationKey(relation: { from: string; type: string; to: string }): string {
  return `${relation.from} ${relation.type} ${relation.to}`;
}

function bindingKey(binding: { concept: string; requirements: string[]; authority?: number; validFrom?: string; validUntil?: string }, evidence: string): string {
  return [
    binding.concept,
    evidence,
    [...binding.requirements].sort(compareText).join(','),
    binding.authority ?? '',
    binding.validFrom ?? '',
    binding.validUntil ?? '',
  ].join(' ');
}

export function domainFixtureDiagnostic(message: string): CegDiagnostic {
  return diagnostic('error', 'CEG_DOMAIN_FIXTURE', 'fixtures', message);
}
