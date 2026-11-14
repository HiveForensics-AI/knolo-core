import { KiteError } from './errors.js';
import {
  KITE_CERTIFICATE_FORMAT,
  KITE_VERDICTS,
  KITE_WORLD_LABELS,
  type KiteCertificate,
  type KiteDerivation,
  type KiteSessionResult,
  type KiteVerdict,
  type KiteWorldLabel,
} from './types.js';

export function certificateFromResult(
  result: Pick<
    KiteSessionResult,
    | 'verdict'
    | 'question'
    | 'asOf'
    | 'stateRoot'
    | 'semanticRoot'
    | 'worldsChecked'
    | 'agrees'
    | 'witness'
    | 'met'
    | 'unmet'
    | 'dependencies'
    | 'bounds'
  >,
  derivation: KiteDerivation
): KiteCertificate | null {
  if (
    result.verdict === 'BOUND_EXCEEDED' ||
    derivation.baseWorld === null ||
    derivation.invarianceRoot === null
  ) {
    return null;
  }
  return {
    format: KITE_CERTIFICATE_FORMAT,
    verdict: result.verdict,
    baseWorld: derivation.baseWorld,
    question: result.question,
    asOf: result.asOf,
    stateRoot: result.stateRoot,
    semanticRoot: result.semanticRoot,
    invarianceRoot: derivation.invarianceRoot,
    worldsChecked: result.worldsChecked,
    agrees: result.agrees,
    witness: result.witness ? [...result.witness.changeIds] : null,
    variantsChecked: result.bounds.variantsChecked,
    counterfactualChanges: result.bounds.counterfactualChanges,
    met: result.met.map((item) => item.id),
    unmet: result.unmet.map((item) => item.id),
    negativeCollections: [...result.dependencies.negativeCollections],
    obligationIds: [...result.dependencies.obligationIds],
    sourcePartitions: [...result.dependencies.sourcePartitions],
  };
}

export function parseKiteCertificate(input: unknown): KiteCertificate {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new KiteError(
      'KITE_CERTIFICATE_MISMATCH',
      'Certificate must be an object.',
      'certificate'
    );
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record).sort().join(',');
  if (
    keys !==
    'agrees,asOf,baseWorld,counterfactualChanges,format,invarianceRoot,met,negativeCollections,obligationIds,question,semanticRoot,sourcePartitions,stateRoot,unmet,variantsChecked,verdict,witness,worldsChecked'
  ) {
    throw new KiteError(
      'KITE_CERTIFICATE_MISMATCH',
      'Certificate fields do not match knolo-kite-certificate-1.',
      'certificate'
    );
  }
  if (record.format !== KITE_CERTIFICATE_FORMAT) {
    throw new KiteError(
      'KITE_CERTIFICATE_MISMATCH',
      'Certificate format is not knolo-kite-certificate-1.',
      'certificate.format'
    );
  }
  if (record.verdict === 'BOUND_EXCEEDED') {
    throw new KiteError(
      'KITE_CERTIFICATE_MISMATCH',
      'An unfinished search is not a certificate.',
      'certificate.verdict'
    );
  }
  const verdict = verdictOf(record.verdict);
  const baseWorld = labelOf(record.baseWorld);
  return {
    format: KITE_CERTIFICATE_FORMAT,
    verdict,
    baseWorld,
    question: textOf(record.question, 'certificate.question'),
    asOf: nullableText(record.asOf, 'certificate.asOf'),
    stateRoot: textOf(record.stateRoot, 'certificate.stateRoot'),
    semanticRoot: nullableText(record.semanticRoot, 'certificate.semanticRoot'),
    invarianceRoot: textOf(record.invarianceRoot, 'certificate.invarianceRoot'),
    worldsChecked: countOf(record.worldsChecked, 'certificate.worldsChecked'),
    agrees: record.agrees === true,
    witness: witnessOf(record.witness),
    variantsChecked: countOf(
      record.variantsChecked,
      'certificate.variantsChecked'
    ),
    counterfactualChanges: countOf(
      record.counterfactualChanges,
      'certificate.counterfactualChanges'
    ),
    met: stringsOf(record.met, 'certificate.met'),
    unmet: stringsOf(record.unmet, 'certificate.unmet'),
    negativeCollections: stringsOf(
      record.negativeCollections,
      'certificate.negativeCollections'
    ),
    obligationIds: stringsOf(record.obligationIds, 'certificate.obligationIds'),
    sourcePartitions: stringsOf(
      record.sourcePartitions,
      'certificate.sourcePartitions'
    ),
  };
}

export function sameCertificate(
  actual: KiteCertificate,
  claimed: KiteCertificate
): boolean {
  return JSON.stringify(actual) === JSON.stringify(claimed);
}

function verdictOf(value: unknown): Exclude<KiteVerdict, 'BOUND_EXCEEDED'> {
  if (
    typeof value === 'string' &&
    value !== 'BOUND_EXCEEDED' &&
    (KITE_VERDICTS as readonly string[]).includes(value)
  ) {
    return value as Exclude<KiteVerdict, 'BOUND_EXCEEDED'>;
  }
  throw new KiteError(
    'KITE_CERTIFICATE_MISMATCH',
    'Certificate verdict is not a KITE verdict.',
    'certificate.verdict'
  );
}

function labelOf(value: unknown): KiteWorldLabel {
  if (
    typeof value === 'string' &&
    (KITE_WORLD_LABELS as readonly string[]).includes(value)
  ) {
    return value as KiteWorldLabel;
  }
  throw new KiteError(
    'KITE_CERTIFICATE_MISMATCH',
    'Certificate base world is not a KITE world label.',
    'certificate.baseWorld'
  );
}

function textOf(value: unknown, path: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new KiteError(
      'KITE_CERTIFICATE_MISMATCH',
      'Certificate text is missing.',
      path
    );
  }
  return value;
}

function nullableText(value: unknown, path: string): string | null {
  if (value === null) return null;
  return textOf(value, path);
}

function countOf(value: unknown, path: string): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || value < 0) {
    throw new KiteError(
      'KITE_CERTIFICATE_MISMATCH',
      'Certificate count is invalid.',
      path
    );
  }
  return value;
}

function stringsOf(value: unknown, path: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new KiteError(
      'KITE_CERTIFICATE_MISMATCH',
      'Certificate list is invalid.',
      path
    );
  }
  return [...value];
}

function witnessOf(value: unknown): string[] | null {
  if (value === null) return null;
  return stringsOf(value, 'certificate.witness');
}
