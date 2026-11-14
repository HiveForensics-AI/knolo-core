import { KiteError } from './errors.js';
import type { KiteChange } from './types.js';

export function subsetCount(changeCount: number, maxChanges: number): number {
  const limit = Math.min(maxChanges, changeCount);
  let total = 0;
  for (let size = 0; size <= limit; size += 1) {
    total += binomial(changeCount, size);
  }
  if (!Number.isSafeInteger(total)) {
    throw new KiteError(
      'BOUND_EXCEEDED',
      'Variant count is outside the safe integer range.',
      'bounds.maxVariants'
    );
  }
  return total;
}

export function combinations<T>(items: readonly T[], size: number): T[][] {
  const found: T[][] = [];
  const current: T[] = [];
  function walk(start: number): void {
    if (current.length === size) {
      found.push([...current]);
      return;
    }
    for (let index = start; index < items.length; index += 1) {
      current.push(items[index]);
      walk(index + 1);
      current.pop();
    }
  }
  if (size === 0) return [[]];
  walk(0);
  return found;
}

export function applyChanges(
  base: ReadonlyMap<string, boolean>,
  changes: readonly KiteChange[]
): Map<string, boolean> {
  const next = new Map(base);
  for (const change of changes) {
    next.set(change.obligationId, change.kind !== 'retract');
  }
  return next;
}

function binomial(n: number, k: number): number {
  if (k < 0 || k > n) return 0;
  let result = 1;
  for (let index = 1; index <= k; index += 1) {
    result = (result * (n - k + index)) / index;
  }
  if (!Number.isInteger(result)) {
    throw new KiteError(
      'BOUND_EXCEEDED',
      'Variant count is not an integer.',
      'bounds.maxVariants'
    );
  }
  return result;
}
