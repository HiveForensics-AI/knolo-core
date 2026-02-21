// src/index.ts
export { mountPack, hasSemantic } from './pack.js';
export {
  query,
  lexConfidence,
  validateQueryOptions,
  validateSemanticQueryOptions,
} from './query.js';
export { makeContextPatch } from './patch.js';
export { buildPack } from './builder.js';
export {
  quantizeEmbeddingInt8L2Norm,
  encodeScaleF16,
  decodeScaleF16,
} from './semantic.js';
export {
  listAgents,
  getAgent,
  resolveAgent,
  buildSystemPrompt,
  isToolAllowed,
  assertToolAllowed,
  validateAgentRegistry,
  validateAgentDefinition,
} from './agent.js';
export type { MountOptions, PackMeta, Pack } from './pack.js';
export type { QueryOptions, Hit } from './query.js';
export type { ContextPatch } from './patch.js';
export type { BuildInputDoc, BuildPackOptions } from './builder.js';
export type {
  AgentPromptTemplate,
  AgentToolPolicy,
  AgentRetrievalDefaults,
  AgentDefinitionV1,
  AgentRegistry,
  ResolveAgentInput,
  ResolvedAgent,
} from './agent.js';
