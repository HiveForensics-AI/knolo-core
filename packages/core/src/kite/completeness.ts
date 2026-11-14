import type { KiteCompleteness, KiteCompletenessRule } from './types.js';

export function coveredObligationIds(
  rules: readonly KiteCompletenessRule[],
  completeness: KiteCompleteness,
  unmet: ReadonlySet<string>
): string[] {
  const signed = new Set(completeness.declarations.map((item) => item.id));
  return rules
    .filter((rule) => unmet.has(rule.obligationId) && signed.has(rule.id))
    .map((rule) => rule.obligationId)
    .sort();
}

export function openRequirementIds(
  requireIds: readonly string[],
  met: ReadonlySet<string>,
  covered: ReadonlySet<string>
): string[] {
  return requireIds.filter((id) => !met.has(id) && !covered.has(id));
}

export function completenessGapIds(
  rules: readonly KiteCompletenessRule[],
  completeness: KiteCompleteness
): string[] {
  const signed = new Set(completeness.declarations.map((item) => item.id));
  return rules.filter((rule) => !signed.has(rule.id)).map((rule) => rule.id);
}

export function negativeCollections(
  rules: readonly KiteCompletenessRule[]
): string[] {
  return [...new Set(rules.map((rule) => rule.collection))].sort();
}
