/** Deterministic mulberry32 PRNG. Returns values in [0, 1). */
export function mulberry32(seed) {
  let state = seed >>> 0;
  return function next() {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function percentile(sorted, p) {
  if (sorted.length === 0) return null;
  const index = (sorted.length - 1) * p;
  const lower = Math.floor(index);
  const upper = Math.ceil(index);
  if (lower === upper) return sorted[lower];
  return sorted[lower] * (upper - index) + sorted[upper] * (index - lower);
}

export function summarize(values) {
  const nums = values.filter((value) => value !== null && value !== undefined && Number.isFinite(value));
  if (nums.length === 0) return { n: 0, mean: null, median: null, min: null, max: null };
  const sorted = nums.slice().sort((a, b) => a - b);
  const mean = nums.reduce((sum, value) => sum + value, 0) / nums.length;
  return {
    n: nums.length,
    mean,
    median: percentile(sorted, 0.5),
    min: sorted[0],
    max: sorted[sorted.length - 1],
  };
}

/** Percentile bootstrap mean interval. `rng` must be deterministic. */
export function bootstrapMean(values, rng, replicates = 1000) {
  const nums = values.filter((value) => value !== null && value !== undefined && Number.isFinite(value));
  const base = summarize(nums);
  if (nums.length === 0) return { ...base, ci95: [null, null] };
  const means = new Array(replicates);
  for (let rep = 0; rep < replicates; rep += 1) {
    let sum = 0;
    for (let i = 0; i < nums.length; i += 1) sum += nums[(rng() * nums.length) | 0];
    means[rep] = sum / nums.length;
  }
  means.sort((a, b) => a - b);
  return {
    ...base,
    ci95: [percentile(means, 0.025), percentile(means, 0.975)],
  };
}

export function latencyQuantiles(samples) {
  const nums = samples.filter((value) => Number.isFinite(value)).slice().sort((a, b) => a - b);
  return {
    n: nums.length,
    p50: percentile(nums, 0.5),
    p95: percentile(nums, 0.95),
    max: nums.length ? nums[nums.length - 1] : null,
  };
}

export function round(value, digits = 4) {
  if (value === null || value === undefined || !Number.isFinite(value)) return null;
  const factor = 10 ** digits;
  return Math.round(value * factor) / factor;
}
