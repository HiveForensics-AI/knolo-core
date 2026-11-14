import { KiteError } from './errors.js';
import {
  KITE_CHANGE_KINDS,
  KITE_CHANGES_FORMAT,
  KITE_COMPLETENESS_FORMAT,
  KITE_DELTA_FORMAT,
  KITE_RULES_FORMAT,
  type KiteChange,
  type KiteChangeSet,
  type KiteCompleteness,
  type KiteCompletenessRule,
  type KiteContract,
  type KiteDelta,
  type KiteRules,
} from './types.js';

const ID = /^[a-z][a-z0-9-]{0,63}$/;
const COLLECTION = /^[a-z][a-z0-9-]{0,63}$/;
const ASOF = /^(?:[0-9]{4})-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])$/u;
const DIGEST = /^sha256-[0-9a-f]{64}$/u;

export function parseKiteRules(
  input: unknown,
  contract: KiteContract
): KiteRules {
  const record = objectKeys(
    input,
    'completeness,conflicts,format,oppose,proposition,require,support',
    'Rules fields must be format, proposition, support, oppose, require, conflicts, and completeness.',
    'rules',
    'KITE_RULES_INVALID'
  );
  if (record.format !== KITE_RULES_FORMAT) {
    throw new KiteError(
      'KITE_RULES_INVALID',
      'Rules format is not knolo-kite-rules-1.',
      'rules.format'
    );
  }
  const proposition = normalizeProposition(record.proposition);
  const known = new Set(contract.obligations.map((item) => item.id));
  const support = idList(record.support, 'rules.support', known);
  const oppose = idList(record.oppose, 'rules.oppose', known);
  const require = idList(record.require, 'rules.require', known);
  const conflicts = conflictsOf(record.conflicts, known);
  const completeness = completenessRules(record.completeness, known);
  return {
    format: KITE_RULES_FORMAT,
    proposition,
    support,
    oppose,
    require,
    conflicts,
    completeness,
  };
}

export function parseKiteCompleteness(
  input: unknown,
  rules: KiteRules
): KiteCompleteness {
  if (input === undefined) {
    return { format: KITE_COMPLETENESS_FORMAT, declarations: [] };
  }
  const record = objectKeys(
    input,
    'declarations,format',
    'Completeness fields must be format and declarations.',
    'completeness',
    'KITE_RULES_INVALID'
  );
  if (record.format !== KITE_COMPLETENESS_FORMAT) {
    throw new KiteError(
      'KITE_RULES_INVALID',
      'Completeness format is not knolo-kite-completeness-1.',
      'completeness.format'
    );
  }
  if (!Array.isArray(record.declarations)) {
    throw new KiteError(
      'KITE_RULES_INVALID',
      'Completeness declarations must be an array.',
      'completeness.declarations'
    );
  }
  const byId = new Map(rules.completeness.map((rule) => [rule.id, rule]));
  const seen = new Set<string>();
  const declarations = record.declarations.map((item, index) => {
    const path = `completeness.declarations.${index}`;
    const row = objectKeys(
      item,
      'collection,id,signed',
      'A declaration must have id, collection, and signed.',
      path,
      'KITE_RULES_INVALID'
    );
    if (typeof row.id !== 'string' || !byId.has(row.id) || seen.has(row.id)) {
      throw new KiteError(
        'KITE_RULES_INVALID',
        'A declaration must name one completeness rule once.',
        `${path}.id`
      );
    }
    const rule = byId.get(row.id);
    if (!rule || row.collection !== rule.collection || row.signed !== true) {
      throw new KiteError(
        'KITE_RULES_INVALID',
        'A declaration must repeat the rule collection and be signed.',
        path
      );
    }
    seen.add(row.id);
    return { id: row.id, collection: rule.collection, signed: true as const };
  });
  declarations.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { format: KITE_COMPLETENESS_FORMAT, declarations };
}

export function parseKiteChanges(
  input: unknown,
  contract: KiteContract
): KiteChangeSet {
  if (input === undefined) {
    return { format: KITE_CHANGES_FORMAT, changes: [] };
  }
  const record = objectKeys(
    input,
    'changes,format',
    'Changes fields must be format and changes.',
    'changes',
    'KITE_RULES_INVALID'
  );
  if (record.format !== KITE_CHANGES_FORMAT) {
    throw new KiteError(
      'KITE_RULES_INVALID',
      'Changes format is not knolo-kite-changes-1.',
      'changes.format'
    );
  }
  if (!Array.isArray(record.changes)) {
    throw new KiteError(
      'KITE_RULES_INVALID',
      'Changes must be an array.',
      'changes.changes'
    );
  }
  const known = new Set(contract.obligations.map((item) => item.id));
  const seen = new Set<string>();
  const changes = record.changes.map((item, index) =>
    parseChange(item, index, known, seen)
  );
  changes.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return { format: KITE_CHANGES_FORMAT, changes };
}

export function parseKiteDelta(input: unknown): KiteDelta {
  const record = objectKeys(
    input,
    'changedObligationIds,format,fromStateRoot,insertedCollections,retractedSources,toStateRoot',
    'Delta fields are format, fromStateRoot, toStateRoot, retractedSources, insertedCollections, and changedObligationIds.',
    'delta',
    'KITE_DELTA_INVALID'
  );
  if (record.format !== KITE_DELTA_FORMAT) {
    throw new KiteError(
      'KITE_DELTA_INVALID',
      'Delta format is not knolo-kite-delta-1.',
      'delta.format'
    );
  }
  return {
    format: KITE_DELTA_FORMAT,
    fromStateRoot: digestField(record.fromStateRoot, 'delta.fromStateRoot'),
    toStateRoot: digestField(record.toStateRoot, 'delta.toStateRoot'),
    retractedSources: stringList(
      record.retractedSources,
      'delta.retractedSources',
      'KITE_DELTA_INVALID'
    ),
    insertedCollections: tokenList(
      record.insertedCollections,
      'delta.insertedCollections',
      'KITE_DELTA_INVALID'
    ),
    changedObligationIds: tokenList(
      record.changedObligationIds,
      'delta.changedObligationIds',
      'KITE_DELTA_INVALID'
    ),
  };
}

export function parseAsOf(input: unknown): string | null {
  if (input === undefined || input === null) return null;
  if (typeof input !== 'string' || !ASOF.test(input)) {
    throw new KiteError(
      'KITE_RULES_INVALID',
      'asOf must be a YYYY-MM-DD date.',
      'asOf'
    );
  }
  return input;
}

export function parseSemanticRoot(graph: unknown): string | null {
  if (graph === undefined) return null;
  const value = decodeGraph(graph);
  const record = objectRecord(value, 'graph', 'KITE_GRAPH_INVALID');
  const root = record.semanticRoot;
  if (typeof root !== 'string' || !DIGEST.test(root)) {
    throw new KiteError(
      'KITE_GRAPH_INVALID',
      'Graph semanticRoot must be a sha256 digest.',
      'graph.semanticRoot'
    );
  }
  return root;
}

function parseChange(
  input: unknown,
  index: number,
  known: Set<string>,
  seen: Set<string>
): KiteChange {
  const path = `changes.changes.${index}`;
  const record = objectKeys(
    input,
    'id,kind,obligationId',
    'A change must have id, kind, and obligationId.',
    path,
    'KITE_RULES_INVALID'
  );
  if (
    typeof record.id !== 'string' ||
    !ID.test(record.id) ||
    seen.has(record.id)
  ) {
    throw new KiteError(
      'KITE_RULES_INVALID',
      'Change id must be a short unique token.',
      `${path}.id`
    );
  }
  if (
    typeof record.kind !== 'string' ||
    !(KITE_CHANGE_KINDS as readonly string[]).includes(record.kind)
  ) {
    throw new KiteError(
      'KITE_RULES_INVALID',
      'Change kind must be retract, amend, or conflict.',
      `${path}.kind`
    );
  }
  if (
    typeof record.obligationId !== 'string' ||
    !known.has(record.obligationId)
  ) {
    throw new KiteError(
      'KITE_RULES_INVALID',
      'A change must name an obligation in the contract.',
      `${path}.obligationId`
    );
  }
  seen.add(record.id);
  return {
    id: record.id,
    kind: record.kind as KiteChange['kind'],
    obligationId: record.obligationId,
  };
}

function completenessRules(
  input: unknown,
  known: Set<string>
): KiteCompletenessRule[] {
  if (!Array.isArray(input)) {
    throw new KiteError(
      'KITE_RULES_INVALID',
      'Rules completeness must be an array.',
      'rules.completeness'
    );
  }
  const seen = new Set<string>();
  const rules = input.map((item, index) => {
    const path = `rules.completeness.${index}`;
    const record = objectKeys(
      item,
      'collection,id,obligationId',
      'A completeness rule must have id, collection, and obligationId.',
      path,
      'KITE_RULES_INVALID'
    );
    if (
      typeof record.id !== 'string' ||
      !ID.test(record.id) ||
      seen.has(record.id)
    ) {
      throw new KiteError(
        'KITE_RULES_INVALID',
        'Completeness id must be a short unique token.',
        `${path}.id`
      );
    }
    if (
      typeof record.collection !== 'string' ||
      !COLLECTION.test(record.collection)
    ) {
      throw new KiteError(
        'KITE_RULES_INVALID',
        'Completeness collection must be a short token.',
        `${path}.collection`
      );
    }
    if (
      typeof record.obligationId !== 'string' ||
      !known.has(record.obligationId)
    ) {
      throw new KiteError(
        'KITE_RULES_INVALID',
        'Completeness must name an obligation in the contract.',
        `${path}.obligationId`
      );
    }
    seen.add(record.id);
    return {
      id: record.id,
      collection: record.collection,
      obligationId: record.obligationId,
    };
  });
  rules.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return rules;
}

function conflictsOf(
  input: unknown,
  known: Set<string>
): { left: string; right: string }[] {
  if (!Array.isArray(input)) {
    throw new KiteError(
      'KITE_RULES_INVALID',
      'Rules conflicts must be an array.',
      'rules.conflicts'
    );
  }
  const seen = new Set<string>();
  const conflicts = input.map((item, index) => {
    const path = `rules.conflicts.${index}`;
    const record = objectKeys(
      item,
      'left,right',
      'A conflict must have left and right.',
      path,
      'KITE_RULES_INVALID'
    );
    if (
      typeof record.left !== 'string' ||
      typeof record.right !== 'string' ||
      !known.has(record.left) ||
      !known.has(record.right) ||
      record.left === record.right
    ) {
      throw new KiteError(
        'KITE_RULES_INVALID',
        'A conflict must name two different obligations.',
        path
      );
    }
    const key = `${record.left}\0${record.right}`;
    if (seen.has(key)) {
      throw new KiteError(
        'KITE_RULES_INVALID',
        'Conflict pairs must be unique.',
        path
      );
    }
    seen.add(key);
    return { left: record.left, right: record.right };
  });
  conflicts.sort((a, b) =>
    a.left === b.left ? (a.right < b.right ? -1 : 1) : a.left < b.left ? -1 : 1
  );
  return conflicts;
}

function idList(input: unknown, path: string, known: Set<string>): string[] {
  return tokenList(input, path, 'KITE_RULES_INVALID').map((id) => {
    if (!known.has(id)) {
      throw new KiteError(
        'KITE_RULES_INVALID',
        'A rule id must name an obligation in the contract.',
        path
      );
    }
    return id;
  });
}

function tokenList(
  input: unknown,
  path: string,
  code: 'KITE_RULES_INVALID' | 'KITE_DELTA_INVALID'
): string[] {
  if (!Array.isArray(input)) {
    throw new KiteError(code, 'Expected an array of tokens.', path);
  }
  const seen = new Set<string>();
  const values = input.map((item) => {
    if (typeof item !== 'string' || !ID.test(item) || seen.has(item)) {
      throw new KiteError(code, 'Tokens must be short and unique.', path);
    }
    seen.add(item);
    return item;
  });
  values.sort();
  return values;
}

function stringList(
  input: unknown,
  path: string,
  code: 'KITE_DELTA_INVALID'
): string[] {
  if (!Array.isArray(input)) {
    throw new KiteError(code, 'Expected an array of strings.', path);
  }
  const seen = new Set<string>();
  const values = input.map((item) => {
    if (
      typeof item !== 'string' ||
      item.length === 0 ||
      item.length > 200 ||
      seen.has(item)
    ) {
      throw new KiteError(code, 'Source names must be short and unique.', path);
    }
    seen.add(item);
    return item;
  });
  values.sort();
  return values;
}

function normalizeProposition(input: unknown): string {
  if (typeof input !== 'string') {
    throw new KiteError(
      'KITE_RULES_INVALID',
      'Proposition must be a string.',
      'rules.proposition'
    );
  }
  const proposition = input.trim().replace(/\s+/gu, ' ');
  if (!proposition || proposition.length > 200) {
    throw new KiteError(
      'KITE_RULES_INVALID',
      'Proposition must be 1 to 200 characters.',
      'rules.proposition'
    );
  }
  return proposition;
}

function digestField(input: unknown, path: string): string {
  if (typeof input !== 'string' || !DIGEST.test(input)) {
    throw new KiteError(
      'KITE_DELTA_INVALID',
      'State root must be a sha256 digest.',
      path
    );
  }
  return input;
}

function objectKeys(
  input: unknown,
  expected: string,
  message: string,
  path: string,
  code: 'KITE_RULES_INVALID' | 'KITE_DELTA_INVALID'
): Record<string, unknown> {
  const record = objectRecord(input, path, code);
  if (Object.keys(record).sort().join(',') !== expected) {
    throw new KiteError(code, message, path);
  }
  return record;
}

function objectRecord(
  input: unknown,
  path: string,
  code: 'KITE_RULES_INVALID' | 'KITE_DELTA_INVALID' | 'KITE_GRAPH_INVALID'
): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new KiteError(code, 'Expected an object.', path);
  }
  return input as Record<string, unknown>;
}

function decodeGraph(graph: unknown): unknown {
  if (typeof graph === 'string') return parseJson(graph, 'graph');
  if (graph instanceof Uint8Array) {
    return parseJson(new TextDecoder().decode(graph), 'graph');
  }
  return graph;
}

function parseJson(text: string, path: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new KiteError(
      'KITE_GRAPH_INVALID',
      error instanceof Error ? error.message : 'Graph JSON is invalid.',
      path,
      error
    );
  }
}
