// src/quality/signature.ts
// "KNS" — simple, deterministic lexical numeric signature for tie-breaking.
const PRIMES = [257, 263, 269] as const;

export type KNSSignature = [number, number, number];

export function knsSignature(s: string): KNSSignature {
  let s1 = 0, s2 = 0, s3 = 0;
  for (let i = 0; i < s.length; i++) {
    const code = s.charCodeAt(i);
    s1 = (s1 + code) % PRIMES[0];
    s2 = (s2 + code * (i + 1)) % PRIMES[1];
    s3 = (s3 + ((code << 1) ^ (i + 7))) % PRIMES[2];
  }
  return [s1, s2, s3];
}

export function knsDistance(a: KNSSignature, b: KNSSignature): number {
  // circular distance on a mod prime, averaged & normalized to 0..1
  let acc = 0;
  for (let i = 0; i < PRIMES.length; i++) {
    const p = PRIMES[i];
    const diff = Math.abs(a[i] - b[i]);
    const circ = Math.min(diff, p - diff) / p;
    acc += circ;
  }
  return acc / PRIMES.length;
}
