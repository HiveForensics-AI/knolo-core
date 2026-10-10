/**
 * Machine-readable CEG authoring diagnostics.
 * Severity `error` blocks compilation. `warning` and `info` do not.
 */

export type CegSeverity = 'error' | 'warning' | 'info';

export type CegDiagnostic = {
  severity: CegSeverity;
  code: string;
  path: string;
  message: string;
};

export function diagnostic(
  severity: CegSeverity,
  code: string,
  path: string,
  message: string,
): CegDiagnostic {
  return { severity, code, path, message };
}

export function hasErrors(diagnostics: readonly CegDiagnostic[]): boolean {
  return diagnostics.some((item) => item.severity === 'error');
}

export function sortDiagnostics(diagnostics: readonly CegDiagnostic[]): CegDiagnostic[] {
  return [...diagnostics].sort((left, right) => {
    const severity = severityRank(left.severity) - severityRank(right.severity);
    if (severity !== 0) return severity;
    if (left.code < right.code) return -1;
    if (left.code > right.code) return 1;
    if (left.path < right.path) return -1;
    if (left.path > right.path) return 1;
    if (left.message < right.message) return -1;
    if (left.message > right.message) return 1;
    return 0;
  });
}

function severityRank(severity: CegSeverity): number {
  if (severity === 'error') return 0;
  if (severity === 'warning') return 1;
  return 2;
}
