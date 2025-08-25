// src/quality/proximity.ts

// Map<termId, positions[]>
export function minCoverSpan(posMap?: Map<number, number[]>): number | null {
  const lists = posMap ? [...posMap.values()].map(arr => arr.slice().sort((a,b) => a - b)) : [];
  if (lists.length === 0) return null;
  const idx = new Array(lists.length).fill(0);

  let best: number | null = null;
  while (true) {
    const cur: number[] = [];
    for (let i = 0; i < lists.length; i++) {
      const val = lists[i][idx[i]];
      if (val === undefined) return best;
      cur.push(val);
    }
    const min = Math.min(...cur);
    const max = Math.max(...cur);
    const span = max - min;
    if (best === null || span < best) best = span;

    // advance list with current min
    const minList = cur.indexOf(min);
    idx[minList]++;
  }
}

export function proximityMultiplier(span: number | null, strength = 0.15): number {
  if (span === null) return 1;
  return 1 + strength / (1 + span); // gentle, bounded
}
