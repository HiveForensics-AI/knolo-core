import { KiteError } from './errors.js';
import {
  KITE_BOUNDS,
  KITE_CONDITION_KINDS,
  KITE_CONTRACT_FORMAT,
  type KiteBounds,
  type KiteConditionKind,
  type KiteContract,
  type KiteObligation,
} from './types.js';

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const TERM = /^[A-Za-z0-9]+(?:[ -][A-Za-z0-9]+)*$/;

export function parseKiteContract(input: unknown): KiteContract {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new KiteError(
      'KITE_CONTRACT_INVALID',
      'Contract must be an object.',
      'contract'
    );
  }
  const record = input as Record<string, unknown>;
  const keys = Object.keys(record).sort();
  if (keys.join(',') !== 'format,obligations,question') {
    throw new KiteError(
      'KITE_CONTRACT_INVALID',
      'Contract fields must be format, question, and obligations.',
      'contract'
    );
  }
  if (record.format !== KITE_CONTRACT_FORMAT) {
    throw new KiteError(
      'KITE_CONTRACT_INVALID',
      'Contract format is not knolo-kite-contract-1.',
      'format'
    );
  }
  const question = normalizeQuestion(record.question);
  if (!Array.isArray(record.obligations) || record.obligations.length === 0) {
    throw new KiteError(
      'KITE_CONTRACT_INVALID',
      'Contract needs at least one obligation.',
      'obligations'
    );
  }
  const seen = new Set<string>();
  const obligations = record.obligations.map((item, index) =>
    parseObligation(item, index, seen)
  );
  return { format: KITE_CONTRACT_FORMAT, question, obligations };
}

export function resolveKiteBounds(input: unknown): KiteBounds {
  const bounds: KiteBounds = { ...KITE_BOUNDS };
  if (input === undefined) return bounds;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new KiteError(
      'BOUND_EXCEEDED',
      'Bounds must be an object.',
      'bounds'
    );
  }
  const record = input as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (
      key !== 'maxGraphNodes' &&
      key !== 'maxVariants' &&
      key !== 'maxCounterfactualChanges' &&
      key !== 'maxRetrievals'
    ) {
      throw new KiteError(
        'BOUND_EXCEEDED',
        `Unknown bound ${key}.`,
        `bounds.${key}`
      );
    }
    const value = record[key];
    const cap = KITE_BOUNDS[key as keyof typeof KITE_BOUNDS];
    if (
      !Number.isInteger(value) ||
      (value as number) < 1 ||
      (value as number) > cap
    ) {
      throw new KiteError(
        'BOUND_EXCEEDED',
        `${key} must be an integer from 1 to ${cap}.`,
        `bounds.${key}`
      );
    }
    bounds[key as keyof KiteBounds] = value as number;
  }
  return bounds;
}

function parseObligation(
  input: unknown,
  index: number,
  seen: Set<string>
): KiteObligation {
  const path = `obligations.${index}`;
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new KiteError(
      'KITE_CONTRACT_INVALID',
      'Obligation must be an object.',
      path
    );
  }
  const record = input as Record<string, unknown>;
  if (Object.keys(record).sort().join(',') !== 'id,kind,term') {
    throw new KiteError(
      'KITE_CONTRACT_INVALID',
      'Obligation fields must be id, kind, and term.',
      path
    );
  }
  if (typeof record.id !== 'string' || !ID.test(record.id)) {
    throw new KiteError(
      'KITE_CONTRACT_INVALID',
      'Obligation id must be a short lowercase token.',
      `${path}.id`
    );
  }
  if (seen.has(record.id)) {
    throw new KiteError(
      'KITE_CONTRACT_INVALID',
      `Obligation id ${record.id} is repeated.`,
      `${path}.id`
    );
  }
  seen.add(record.id);
  if (!isKind(record.kind)) {
    throw new KiteError(
      'KITE_CONTRACT_INVALID',
      'Obligation kind is not a KITE condition.',
      `${path}.kind`
    );
  }
  if (typeof record.term !== 'string' || !TERM.test(record.term)) {
    throw new KiteError(
      'KITE_CONTRACT_INVALID',
      'Obligation term must be words of letters and digits.',
      `${path}.term`
    );
  }
  const words = record.term.split(/[ -]/u);
  if (words.some((word) => word.length < 3) || record.term.length > 200) {
    throw new KiteError(
      'KITE_CONTRACT_INVALID',
      'Each obligation term word must be 3 to 200 characters.',
      `${path}.term`
    );
  }
  return { id: record.id, kind: record.kind, term: record.term };
}

function normalizeQuestion(input: unknown): string {
  if (typeof input !== 'string') {
    throw new KiteError(
      'KITE_CONTRACT_INVALID',
      'Question must be a string.',
      'question'
    );
  }
  const question = input.trim().replace(/\s+/gu, ' ');
  if (!question || question.length > 4000) {
    throw new KiteError(
      'KITE_CONTRACT_INVALID',
      'Question must be 1 to 4000 characters.',
      'question'
    );
  }
  return question;
}

function isKind(value: unknown): value is KiteConditionKind {
  return (
    typeof value === 'string' &&
    (KITE_CONDITION_KINDS as readonly string[]).includes(value)
  );
}
