export type QuantizedVector = { q: Int8Array; scale: number };

export function quantizeEmbeddingInt8L2Norm(embedding: Float32Array): QuantizedVector {
  const dims = embedding.length;
  const normalized = new Float32Array(dims);

  let normSq = 0;
  for (let i = 0; i < dims; i++) normSq += embedding[i] * embedding[i];
  const norm = Math.sqrt(normSq);

  if (norm === 0) {
    return { q: new Int8Array(dims), scale: 0 };
  }

  let maxAbs = 0;
  for (let i = 0; i < dims; i++) {
    const value = embedding[i] / norm;
    normalized[i] = value;
    const abs = Math.abs(value);
    if (abs > maxAbs) maxAbs = abs;
  }

  const scale = maxAbs / 127;
  if (scale === 0) {
    return { q: new Int8Array(dims), scale: 0 };
  }

  const q = new Int8Array(dims);
  for (let i = 0; i < dims; i++) {
    const quantized = Math.round(normalized[i] / scale);
    q[i] = clampInt8(quantized);
  }

  return { q, scale };
}

export function encodeScaleF16(scale: number): number {
  return float32ToFloat16(scale);
}

export function decodeScaleF16(encoded: number): number {
  return float16ToFloat32(encoded);
}

function clampInt8(value: number): number {
  if (value > 127) return 127;
  if (value < -127) return -127;
  return value;
}

function float32ToFloat16(value: number): number {
  if (Number.isNaN(value)) return 0x7e00;
  if (value === Infinity) return 0x7c00;
  if (value === -Infinity) return 0xfc00;

  const f32 = new Float32Array(1);
  const u32 = new Uint32Array(f32.buffer);
  f32[0] = value;
  const bits = u32[0];

  const sign = (bits >>> 16) & 0x8000;
  let exp = (bits >>> 23) & 0xff;
  let mantissa = bits & 0x7fffff;

  if (exp === 0xff) {
    return sign | (mantissa ? 0x7e00 : 0x7c00);
  }

  const halfExp = exp - 127 + 15;

  if (halfExp >= 0x1f) {
    return sign | 0x7c00;
  }

  if (halfExp <= 0) {
    if (halfExp < -10) return sign;
    mantissa = (mantissa | 0x800000) >>> (1 - halfExp);
    if (mantissa & 0x1000) mantissa += 0x2000;
    return sign | (mantissa >>> 13);
  }

  if (mantissa & 0x1000) {
    mantissa += 0x2000;
    if (mantissa & 0x800000) {
      mantissa = 0;
      exp += 1;
      if (exp > 142) return sign | 0x7c00;
    }
  }

  return sign | (halfExp << 10) | (mantissa >>> 13);
}

function float16ToFloat32(bits: number): number {
  const sign = (bits & 0x8000) ? -1 : 1;
  const exp = (bits >>> 10) & 0x1f;
  const frac = bits & 0x03ff;

  if (exp === 0) {
    if (frac === 0) return sign * 0;
    return sign * Math.pow(2, -14) * (frac / 1024);
  }

  if (exp === 0x1f) {
    if (frac === 0) return sign * Infinity;
    return NaN;
  }

  return sign * Math.pow(2, exp - 15) * (1 + frac / 1024);
}
