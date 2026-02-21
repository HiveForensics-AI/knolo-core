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

export { parseToolCallV1FromText } from './tool_parse.js';
export { nowIso, createTrace } from './trace.js';
export { assertToolCallAllowed } from './tool_gate.js';
export { isToolCallV1, isToolResultV1 } from './tools.js';
export type {
  ToolId,
  ToolCallV1,
  ToolResultErrorV1,
  ToolResultV1,
  ToolSpecV1,
} from './tools.js';
export type { TraceEventV1 } from './trace.js';
