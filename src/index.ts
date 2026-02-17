// src/index.ts
export { mountPack } from './pack.js';
export { query, lexConfidence } from './query.js';
export { makeContextPatch } from './patch.js';
export { buildPack } from './builder.js';
export { quantizeEmbeddingInt8L2Norm, encodeScaleF16, decodeScaleF16 } from './semantic.js';
export type { MountOptions, PackMeta, Pack } from './pack.js';
export type { QueryOptions, Hit } from './query.js';
export type { ContextPatch } from './patch.js';
export type { BuildInputDoc, BuildPackOptions } from './builder.js';
