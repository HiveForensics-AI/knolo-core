import { floorMicros } from './cover.js';
import { isFrontier } from './graph.js';
import { FRONTIERS, PROFILES, type Bounds, type Frontier, type Plan, type WitnessRecord } from './types.js';

function onlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function integer(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && Number.isSafeInteger(value);
}

function stringList(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of value) {
    if (typeof item !== 'string' || item.length === 0 || seen.has(item)) return null;
    seen.add(item);
    out.push(item);
  }
  return out;
}

export function validatePlan(input: unknown): Plan | null {
  if (!isRecord(input)) return null;
  if (!onlyKeys(input, [
    'version', 'anchor', 'frontierMap', 'depth', 'cardinalityBound', 'coverageMode',
    'requirements', 'floors', 'profile', 'asOf', 'minAuthority', 'bounds', 'lexical',
  ])) return null;
  if (input.version !== 1) return null;
  if (!integer(input.depth) || input.depth < 0) return null;
  if (!integer(input.cardinalityBound) || input.cardinalityBound < 0) return null;
  if (input.coverageMode !== 'requirements' && input.coverageMode !== 'nonempty') return null;
  if (typeof input.profile !== 'string' || !(PROFILES as readonly string[]).includes(input.profile)) return null;
  if (typeof input.asOf !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(input.asOf)) return null;
  if (input.minAuthority !== null && !integer(input.minAuthority)) return null;
  const anchor = validateAnchor(input.anchor);
  const frontierMap = validateFrontierMap(input.frontierMap);
  const requirements = validateFrontierRecord(input.requirements, stringList);
  const floors = validateFloors(input.floors);
  const bounds = validateBounds(input.bounds);
  const lexical = validateLexical(input.lexical);
  if (!anchor || !frontierMap || !requirements || !floors || !bounds || lexical === undefined) return null;
  for (const frontier of FRONTIERS) {
    if (requirements[frontier].length > bounds.maxRequirementsPerFrontier) return null;
  }
  return {
    version: 1,
    anchor,
    frontierMap,
    depth: input.depth,
    cardinalityBound: input.cardinalityBound,
    coverageMode: input.coverageMode,
    requirements,
    floors,
    profile: input.profile as Plan['profile'],
    asOf: input.asOf,
    minAuthority: input.minAuthority,
    bounds,
    lexical,
  };
}

function validateAnchor(input: unknown): Plan['anchor'] | null {
  if (!isRecord(input)) return null;
  if (input.mode === 'recompute') {
    if (!onlyKeys(input, ['mode', 'procedure'])) return null;
    if (input.procedure !== 'member-id-v1') return null;
    return { mode: 'recompute', procedure: input.procedure };
  }
  if (input.mode === 'supplied') {
    if (!onlyKeys(input, ['mode', 'witness']) || !Array.isArray(input.witness)) return null;
    const witness: WitnessRecord[] = [];
    for (const item of input.witness) {
      if (!isRecord(item) || !onlyKeys(item, ['nodeId', 'queryTerm'])) return null;
      if (typeof item.nodeId !== 'string' || item.nodeId.length === 0) return null;
      const record: WitnessRecord = { nodeId: item.nodeId };
      if (item.queryTerm !== undefined) {
        if (typeof item.queryTerm !== 'string') return null;
        record.queryTerm = item.queryTerm;
      }
      witness.push(record);
    }
    return { mode: 'supplied', witness };
  }
  return null;
}

function validateFrontierMap(input: unknown): Record<string, Frontier> | null {
  if (!isRecord(input)) return null;
  const map: Record<string, Frontier> = {};
  for (const [symbol, label] of Object.entries(input)) {
    if (symbol.length === 0 || !isFrontier(label)) return null;
    map[symbol] = label;
  }
  return map;
}

function validateFrontierRecord<T>(input: unknown, parse: (value: unknown) => T | null): Record<Frontier, T> | null {
  if (!isRecord(input) || !onlyKeys(input, FRONTIERS)) return null;
  const out = {} as Record<Frontier, T>;
  for (const frontier of FRONTIERS) {
    if (!(frontier in input)) return null;
    const parsed = parse(input[frontier]);
    if (parsed === null) return null;
    out[frontier] = parsed;
  }
  return out;
}

function validateFloors(input: unknown): Record<Frontier, string> | null {
  return validateFrontierRecord(input, (value) => {
    if (typeof value !== 'string' || floorMicros(value) === null) return null;
    return value;
  });
}

function validateBounds(input: unknown): Bounds | null {
  if (!isRecord(input)) return null;
  const names = [
    'maxAnchorNodes', 'maxClosureNodes', 'maxClosureEdges', 'maxFrontierEvidence',
    'maxRequirementsPerFrontier', 'maxEvidenceBindings', 'maxCoverVisits',
  ] as const;
  if (!onlyKeys(input, names)) return null;
  const bounds = {} as Bounds;
  for (const name of names) {
    if (!integer(input[name]) || (input[name] as number) < 0) return null;
    bounds[name] = input[name] as number;
  }
  return bounds;
}

function validateLexical(input: unknown): Plan['lexical'] | null | undefined {
  if (input === null) return null;
  if (!isRecord(input) || !onlyKeys(input, ['frontier', 'evidenceIds'])) return undefined;
  if (!isFrontier(input.frontier) || !Array.isArray(input.evidenceIds)) return undefined;
  for (const id of input.evidenceIds) {
    if (typeof id !== 'string' || id.length === 0) return undefined;
  }
  return { frontier: input.frontier, evidenceIds: [...input.evidenceIds] };
}
