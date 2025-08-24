// Public API surface for KnoLo core.

export type { MountOptions, PackMeta, Pack } from './pack';
export type { QueryOptions, Hit } from './query';
export type { ContextPatch } from './patch';

export { mountPack } from './pack.js';
export { query } from './query.js';
export { makeContextPatch } from './patch.js';
export { buildPack } from './builder.js';