import type { Plan } from '../types.js';
import { diagnostic, type CegDiagnostic } from './diagnostics.js';
import { compareText, domainPackRoot, instantiatePlanTemplate, type DomainPackV1 } from './domain.js';

/**
 * Expand Domain Pack templates into coverage cases.
 * One proposition applies to every selected template unless `queries` replaces it.
 * Fixtures are not questions. This function does not compile a sidecar.
 */

export type KarCoveragePackCase = {
  id: string;
  proposition: string;
  plan: Plan;
};

export type KarCoveragePackExpansion =
  | { ok: true; cases: KarCoveragePackCase[]; domainPack: { id: string; version: string; root: string } }
  | { ok: false; diagnostics: CegDiagnostic[] };

export function coverageCasesFromDomainPack(input: {
  pack: DomainPackV1;
  proposition?: string;
  templates?: readonly string[];
  queries?: Record<string, string>;
}): KarCoveragePackExpansion {
  const diagnostics: CegDiagnostic[] = [];
  const selected = selectTemplates(input.pack, input.templates, diagnostics);
  const propositions = propositionsFor(selected, input.proposition, input.queries, diagnostics);
  if (diagnostics.length > 0 || !selected || !propositions) return { ok: false, diagnostics };
  const cases: KarCoveragePackCase[] = [];
  for (const name of selected) {
    const instantiated = instantiatePlanTemplate(input.pack, name);
    if (!instantiated.ok) {
      diagnostics.push(...instantiated.diagnostics);
      continue;
    }
    cases.push({ id: name, proposition: propositions[name], plan: instantiated.plan });
  }
  if (diagnostics.length > 0) return { ok: false, diagnostics };
  return {
    ok: true,
    cases,
    domainPack: { id: input.pack.id, version: input.pack.version, root: domainPackRoot(input.pack) },
  };
}

function selectTemplates(pack: DomainPackV1, templates: readonly string[] | undefined, diagnostics: CegDiagnostic[]): string[] | null {
  const known = new Set(Object.keys(pack.planTemplates));
  const names = templates ? [...templates] : [...known].sort(compareText);
  if (names.length === 0) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_PLAN_INVALID', 'planTemplates', 'Select at least one plan template.'));
    return null;
  }
  const seen = new Set<string>();
  for (const [index, name] of names.entries()) {
    if (typeof name !== 'string' || !validToken(name)) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_PLAN_INVALID', `templates[${index}]`, 'Plan template name is invalid.'));
      continue;
    }
    if (seen.has(name)) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_PLAN_INVALID', `templates.${name}`, `Plan template "${name}" is duplicated.`));
      continue;
    }
    seen.add(name);
    if (!known.has(name)) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_PLAN_INVALID', `planTemplates.${name}`, `Plan template "${name}" is missing.`));
    }
  }
  if (diagnostics.length > 0) return null;
  return names.sort(compareText);
}

function propositionsFor(
  names: string[] | null,
  proposition: string | undefined,
  queries: Record<string, string> | undefined,
  diagnostics: CegDiagnostic[],
): Record<string, string> | null {
  if (!names) return null;
  if (queries !== undefined) {
    if (!queries || typeof queries !== 'object' || Array.isArray(queries)) {
      diagnostics.push(diagnostic('error', 'CEG_DOMAIN_PLAN_INVALID', 'queries', 'Queries must be an object of template name to proposition.'));
      return null;
    }
    const wanted = new Set(names);
    for (const key of Object.keys(queries)) {
      if (!wanted.has(key)) {
        diagnostics.push(diagnostic('error', 'CEG_DOMAIN_PLAN_INVALID', `queries.${key}`, `Query "${key}" does not match a selected template.`));
      }
    }
    const out: Record<string, string> = {};
    for (const name of names) {
      const value = queries[name];
      if (typeof value !== 'string' || value.length === 0 || hasControl(value)) {
        diagnostics.push(diagnostic('error', 'CEG_DOMAIN_PLAN_INVALID', `queries.${name}`, `Proposition for "${name}" must be a non-empty string without control characters.`));
        continue;
      }
      out[name] = value;
    }
    return diagnostics.length > 0 ? null : out;
  }
  if (typeof proposition !== 'string' || proposition.length === 0 || hasControl(proposition)) {
    diagnostics.push(diagnostic('error', 'CEG_DOMAIN_PLAN_INVALID', 'proposition', 'One proposition is required unless queries are supplied.'));
    return null;
  }
  const out: Record<string, string> = {};
  for (const name of names) out[name] = proposition;
  return out;
}

function validToken(value: string): boolean {
  return value.length > 0 && value.length <= 128 && !hasControl(value) && !/\s/u.test(value);
}

function hasControl(value: string): boolean {
  for (let index = 0; index < value.length; index += 1) {
    const code = value.charCodeAt(index);
    if (code < 0x20 || code === 0x7f) return true;
  }
  return false;
}
