export function normalizeVector(vector: Float32Array): Float32Array {
  let normSq = 0;
  for (let i = 0; i < vector.length; i++) normSq += vector[i] * vector[i];
  const norm = Math.sqrt(normSq);
  if (!norm) return new Float32Array(vector.length);
  const out = new Float32Array(vector.length);
  for (let i = 0; i < vector.length; i++) out[i] = vector[i] / norm;
  return out;
}

export function cosineSimilarity(a: Float32Array, b: Float32Array): number {
  if (a.length !== b.length || a.length === 0) return 0;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
