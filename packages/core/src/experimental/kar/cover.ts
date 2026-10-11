import { digest } from './canonicalize.js';
import type { Admission } from './closure.js';
import {
  FRONTIERS,
  type CoveragePair,
  type Decision,
  type EvidenceChoice,
  type Frontier,
  type Plan,
  type Rational,
  type Status,
} from './types.js';

export type CoverOutcome = {
  status: Status;
  evidenceIds: string[];
  choices: EvidenceChoice[];
  decision: Decision;
};

type Candidate = {
  id: string;
  mask: string;
  requirements: Map<Frontier, Set<string>>;
  nonempty: Set<Frontier>;
  tokens: string[];
  bits: Record<Frontier, bigint>;
};

export function floorMicros(floor: string): number | null {
  const match = /^(\d+)(?:\.(\d{1,6}))?$/.exec(floor);
  if (!match) return null;
  const whole = Number(match[1]);
  if (!Number.isSafeInteger(whole)) return null;
  const frac = (match[2] ?? '').padEnd(6, '0');
  return whole * 1_000_000 + Number(frac);
}

function passes(covered: number, required: number, micros: number): boolean {
  if (required === 0) return true;
  return BigInt(covered) * 1_000_000n >= BigInt(micros) * BigInt(required);
}

export function asciiTokens(text: string): string[] {
  const folded = text.replace(/[A-Z]/g, (char) => String.fromCharCode(char.charCodeAt(0) + 32));
  return folded.split(/[^0-9a-z]+/).filter((token) => token.length > 0);
}

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const next = x % y;
    x = y;
    y = next;
  }
  return x === 0n ? 1n : x;
}

type Rat = { n: bigint; d: bigint };

function reduce(n: bigint, d: bigint): Rat {
  if (d < 0n) {
    n = -n;
    d = -d;
  }
  const g = gcd(n, d);
  return { n: n / g, d: d / g };
}

function jaccard(a: readonly string[], b: readonly string[]): Rat {
  const left = new Set(a);
  const right = new Set(b);
  if (left.size === 0 && right.size === 0) return { n: 1n, d: 1n };
  let inter = 0;
  for (const token of left) if (right.has(token)) inter += 1;
  const union = left.size + right.size - inter;
  if (union === 0) return { n: 0n, d: 1n };
  return { n: BigInt(inter), d: BigInt(union) };
}

function redundancy(items: readonly Candidate[]): Rat {
  if (items.length < 2) return { n: 0n, d: 1n };
  let sumN = 0n;
  let sumD = 1n;
  let pairs = 0;
  for (let i = 0; i < items.length; i += 1) {
    for (let j = i + 1; j < items.length; j += 1) {
      const part = jaccard(items[i].tokens, items[j].tokens);
      sumN = sumN * part.d + part.n * sumD;
      sumD *= part.d;
      const g = gcd(sumN, sumD);
      sumN /= g;
      sumD /= g;
      pairs += 1;
    }
  }
  return reduce(sumN, BigInt(pairs) * sumD);
}

function compareRat(a: Rat, b: Rat): number {
  const left = a.n * b.d;
  const right = b.n * a.d;
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}

function toRational(value: Rat): Rational {
  return { numerator: Number(value.n), denominator: Number(value.d) };
}

function popcount(value: bigint): number {
  let count = 0;
  let rest = value;
  while (rest > 0n) {
    rest &= rest - 1n;
    count += 1;
  }
  return count;
}

function emptyBits(): Record<Frontier, bigint> {
  return { F_S: 0n, F_O: 0n, F_Q: 0n, F_T: 0n, F_A: 0n };
}

function requirementBits(plan: Plan, requirements: Map<Frontier, Set<string>>): Record<Frontier, bigint> {
  const bits = emptyBits();
  if (plan.coverageMode !== 'requirements') return bits;
  for (const frontier of FRONTIERS) {
    const have = requirements.get(frontier);
    if (!have) continue;
    const list = plan.requirements[frontier];
    let mask = 0n;
    for (let index = 0; index < list.length; index += 1) {
      if (have.has(list[index])) mask |= 1n << BigInt(index);
    }
    bits[frontier] = mask;
  }
  return bits;
}

function coverageOf(plan: Plan, chosen: readonly Candidate[], micros: Record<Frontier, number>): {
  pairs: Record<Frontier, CoveragePair>;
  ok: boolean;
  counts: Record<Frontier, number>;
} {
  const pairs = {} as Record<Frontier, CoveragePair>;
  const counts = {} as Record<Frontier, number>;
  let ok = true;
  for (const frontier of FRONTIERS) {
    const requiredList = plan.requirements[frontier];
    let covered = 0;
    let required = 0;
    if (plan.coverageMode === 'requirements') {
      required = requiredList.length;
      if (required > 0) {
        let mask = 0n;
        for (const candidate of chosen) mask |= candidate.bits[frontier];
        covered = popcount(mask);
      }
    } else {
      required = 1;
      covered = chosen.some((candidate) => candidate.nonempty.has(frontier)) ? 1 : 0;
    }
    pairs[frontier] = { covered, required };
    counts[frontier] = covered;
    if (!passes(covered, required, micros[frontier])) ok = false;
  }
  return { pairs, ok, counts };
}

function maskKey(requirements: Map<Frontier, Set<string>>, nonempty: Set<Frontier>, plan: Plan): string {
  if (plan.coverageMode === 'nonempty') return [...nonempty].sort().join(',');
  const parts: string[] = [];
  for (const frontier of FRONTIERS) {
    const ids = [...(requirements.get(frontier) ?? [])]
      .filter((id) => plan.requirements[frontier].includes(id))
      .sort();
    if (ids.length > 0) parts.push(`${frontier}=${ids.join('+')}`);
  }
  return parts.join('|');
}

function buildCandidates(plan: Plan, admissions: readonly Admission[], texts: ReadonlyMap<string, string>): Candidate[] {
  const grouped = new Map<string, Candidate>();
  for (const admission of admissions) {
    if (!admission.applicable) continue;
    let candidate = grouped.get(admission.evidenceId);
    if (!candidate) {
      candidate = {
        id: admission.evidenceId,
        mask: '',
        requirements: new Map(),
        nonempty: new Set(),
        tokens: asciiTokens(texts.get(admission.evidenceId) ?? ''),
        bits: emptyBits(),
      };
      grouped.set(admission.evidenceId, candidate);
    }
    candidate.nonempty.add(admission.frontier);
    const bucket = candidate.requirements.get(admission.frontier) ?? new Set<string>();
    for (const requirement of admission.requirements) bucket.add(requirement);
    candidate.requirements.set(admission.frontier, bucket);
  }
  const candidates = [...grouped.values()].filter((candidate) => {
    if (plan.coverageMode === 'nonempty') return candidate.nonempty.size > 0;
    return maskKey(candidate.requirements, candidate.nonempty, plan).length > 0;
  });
  for (const candidate of candidates) {
    candidate.mask = maskKey(candidate.requirements, candidate.nonempty, plan);
    candidate.bits = requirementBits(plan, candidate.requirements);
  }
  candidates.sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  return candidates;
}

function* combinations(items: readonly Candidate[], size: number): Generator<Candidate[]> {
  const n = items.length;
  if (size === 0) {
    yield [];
    return;
  }
  if (size > n) return;
  const index = Array.from({ length: size }, (_, i) => i);
  while (true) {
    yield index.map((offset) => items[offset]);
    let cursor = size - 1;
    while (cursor >= 0 && index[cursor] === n - size + cursor) cursor -= 1;
    if (cursor < 0) return;
    index[cursor] += 1;
    for (let next = cursor + 1; next < size; next += 1) index[next] = index[next - 1] + 1;
  }
}

function betterExp1(
  left: { counts: Record<Frontier, number>; ids: string[] },
  right: { counts: Record<Frontier, number>; ids: string[] },
): boolean {
  for (const frontier of ['F_O', 'F_S', 'F_Q', 'F_T', 'F_A'] as const) {
    if (left.counts[frontier] !== right.counts[frontier]) return left.counts[frontier] > right.counts[frontier];
  }
  if (left.ids.length !== right.ids.length) return left.ids.length < right.ids.length;
  const a = left.ids.join('\0');
  const b = right.ids.join('\0');
  return a < b;
}

function minimumCoverPool(plan: Plan, base: readonly Candidate[]): Candidate[] {
  if (plan.profile !== 'minimum-cover') return [...base];
  const best = new Map<string, Candidate>();
  for (const candidate of base) {
    const current = best.get(candidate.mask);
    if (!current || candidate.id < current.id) best.set(candidate.mask, candidate);
  }
  return [...best.values()].sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
}

export type CoverShape = {
  candidates: number;
  distinctRequirementMasks: number;
  searchPool: number;
  cardinalityBound: number;
  maxCoverVisits: number;
};

/** Advisory pool shape. Does not search and does not select evidence. */
export function inspectCoverShape(plan: Plan, admissions: readonly Admission[], texts: ReadonlyMap<string, string>): CoverShape {
  const base = buildCandidates(plan, admissions, texts);
  const masks = new Set(base.map((candidate) => candidate.mask));
  const pool = minimumCoverPool(plan, base);
  return {
    candidates: base.length,
    distinctRequirementMasks: masks.size,
    searchPool: pool.length,
    cardinalityBound: plan.cardinalityBound,
    maxCoverVisits: plan.bounds.maxCoverVisits,
  };
}

export function selectCover(plan: Plan, admissions: readonly Admission[], texts: ReadonlyMap<string, string>): CoverOutcome {
  const micros = {} as Record<Frontier, number>;
  for (const frontier of FRONTIERS) micros[frontier] = floorMicros(plan.floors[frontier]) ?? 0;
  const base = buildCandidates(plan, admissions, texts);
  const pool = minimumCoverPool(plan, base);

  const limit = plan.bounds.maxCoverVisits;
  let visits = 0;
  const exceed = (): CoverOutcome => finish(plan, 'SEARCH_BOUND_EXCEEDED', [], zeroPairs(plan), micros);

  if (plan.profile === 'minimum-cover') {
    const maxSize = Math.min(plan.cardinalityBound, pool.length);
    for (let size = 0; size <= maxSize; size += 1) {
      for (const combo of combinations(pool, size)) {
        visits += 1;
        if (visits > limit) return exceed();
        const scored = coverageOf(plan, combo, micros);
        if (scored.ok) return finish(plan, 'SATISFIED', combo, scored.pairs, micros);
      }
    }
    return finish(plan, 'UNSATISFIED_EVIDENCE_REQUIREMENTS', [], zeroPairs(plan), micros);
  }

  let best: { combo: Candidate[]; pairs: Record<Frontier, CoveragePair>; counts: Record<Frontier, number> } | null = null;
  const maxSize = Math.min(plan.cardinalityBound, pool.length);
  for (let size = 0; size <= maxSize; size += 1) {
    const feasibleAtSize: { combo: Candidate[]; pairs: Record<Frontier, CoveragePair>; counts: Record<Frontier, number> }[] = [];
    for (const combo of combinations(pool, size)) {
      visits += 1;
      if (visits > limit) return exceed();
      const scored = coverageOf(plan, combo, micros);
      if (scored.ok) feasibleAtSize.push({ combo, pairs: scored.pairs, counts: scored.counts });
    }
    if (plan.profile === 'minimum-cover-redundancy-v1' && feasibleAtSize.length > 0) {
      feasibleAtSize.sort((left, right) => {
        const redundancyOrder = compareRat(redundancy(left.combo), redundancy(right.combo));
        if (redundancyOrder !== 0) return redundancyOrder;
        const a = left.combo.map((item) => item.id).join('\0');
        const b = right.combo.map((item) => item.id).join('\0');
        return a < b ? -1 : a > b ? 1 : 0;
      });
      const winner = feasibleAtSize[0];
      return finish(plan, 'SATISFIED', winner.combo, winner.pairs, micros, redundancy(winner.combo));
    }
    if (plan.profile === 'exp1-lexicographic') {
      for (const item of feasibleAtSize) {
        const ids = item.combo.map((candidate) => candidate.id);
        if (!best || betterExp1({ counts: item.counts, ids }, { counts: best.counts, ids: best.combo.map((candidate) => candidate.id) })) {
          best = item;
        }
      }
    }
  }
  if (best) return finish(plan, 'SATISFIED', best.combo, best.pairs, micros);
  return finish(plan, 'UNSATISFIED_EVIDENCE_REQUIREMENTS', [], zeroPairs(plan), micros);
}

function zeroPairs(plan: Plan): Record<Frontier, CoveragePair> {
  const pairs = {} as Record<Frontier, CoveragePair>;
  for (const frontier of FRONTIERS) {
    pairs[frontier] = {
      covered: 0,
      required: plan.coverageMode === 'requirements' ? plan.requirements[frontier].length : 1,
    };
  }
  return pairs;
}

function finish(
  plan: Plan,
  status: Status,
  combo: readonly Candidate[],
  pairs: Record<Frontier, CoveragePair>,
  micros: Record<Frontier, number>,
  redundant?: Rat,
): CoverOutcome {
  const evidenceIds = combo.map((candidate) => candidate.id).sort();
  const choices: EvidenceChoice[] = evidenceIds.map((evidenceId) => {
    const candidate = combo.find((item) => item.id === evidenceId)!;
    return { evidenceId, frontiers: [...candidate.nonempty].sort() };
  });
  const scored = status === 'SATISFIED' ? { pairs } : { pairs: zeroPairs(plan) };
  const recorded = status === 'SATISFIED' ? coverageOf(plan, combo, micros).pairs : scored.pairs;
  const decision: Decision = {
    status,
    profile: plan.profile,
    cardinality: status === 'SATISFIED' ? evidenceIds.length : 0,
    coverage: recorded,
  };
  if (redundant && plan.profile === 'minimum-cover-redundancy-v1' && status === 'SATISFIED') {
    decision.redundancy = toRational(redundant);
  }
  return { status, evidenceIds, choices, decision };
}

export function evidenceSetRoot(choices: readonly EvidenceChoice[]): string {
  return digest(choices);
}

export function decisionRoot(decision: Decision): string {
  return digest(decision);
}

/** Coverage of one evidence set. Used by the explainer. Does not search. */
export function coversPlan(plan: Plan, admissions: readonly Admission[], texts: ReadonlyMap<string, string>, evidenceIds: readonly string[]): boolean {
  const micros = {} as Record<Frontier, number>;
  for (const frontier of FRONTIERS) micros[frontier] = floorMicros(plan.floors[frontier]) ?? 0;
  const base = buildCandidates(plan, admissions, texts);
  const chosen = base.filter((candidate) => evidenceIds.includes(candidate.id));
  return coverageOf(plan, chosen, micros).ok;
}
