// src/index.ts
export { mountPack, hasSemantic } from './pack.runtime.js';
export { mountPackFromBuffer } from './pack.runtime.js';
export { isPackV4, inspectPackV4, parsePackV4, serializePackV4, PACK_V4_MAGIC } from './pack.v4.js';
export { ANALYZER_PROFILES, analyzerProfileDigest, resolveAnalyzerProfile } from './analyzer.js';
export {
  query,
  lexConfidence,
  validateQueryOptions,
  validateSemanticQueryOptions,
  applyHardConstraints,
  queryWithPlan,
} from './query.js';
export { createRetrievalPlan } from './retrieval_plan.js';
export { queryWithReceipt, verifyReceipt, packDigest } from './receipt.js';
export { makeContextPatch } from './patch.js';
export { buildPack } from './builder.js';
export { LivePack, createLivePack } from './live.js';
export {
  createPatchPack,
  appendPatch,
  mergePatchPacks,
  serializePatchPack,
  deserializePatchPack,
  applyPatchPack,
} from './patch_pack.js';
export {
  quantizeEmbeddingInt8L2Norm,
  encodeScaleF16,
  decodeScaleF16,
} from './semantic.js';
export { cosineSimilarity, normalizeVector } from './semantic/cosine.js';
export {
  createPackFingerprint,
  serializeSidecar,
  parseSidecar,
  validateSidecarForPack,
} from './semantic/sidecar.js';
export { rerankCandidates } from './semantic/rerank.js';
export { assertProviderCompatible, ensureProviderModelId } from './semantic/provider.js';
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
export {
  getClaimGraph,
  validateClaimGraph,
} from './graph/claim_graph.js';
export { buildClaimGraph } from './graph/build_claim_graph.js';
export {
  createGraphLog,
  appendOp,
  applyClaimGraphLog,
  mergeClaimGraphLogs,
  serializeClaimGraphLog,
  deserializeClaimGraphLog,
} from './graph/log.js';
export { expandQueryWithGraph } from './graph/query_expand.js';
export * from './memory/index.js';
export type { MountOptions, PackMeta, Pack, PackChunk } from './pack.runtime.js';
export type { QueryOptions, Hit, QueryWithPlanResult } from './query.js';
export type { RetrievalPlan } from './retrieval_plan.js';
export type { QueryReceipt, ReceiptOptions, ReceiptDecision, EvidenceSpan } from './receipt.js';
export type { LivePackOptions } from './live.js';
export type { PatchPack, PatchPackV1, PatchOpV1, PatchUpsertV1, PatchRemoveV1 } from './patch_pack.js';
export type { EmbeddingProvider, SemanticSidecar, SemanticQueryOptions, RetrievalEvidence } from './semantic/types.js';
export type { ContextPatch } from './patch.js';
export type { BuildInputDoc, BuildPackOptions } from './builder.js';
export type { AnalyzerProfile } from './analyzer.js';
export type {
  AgentPromptTemplate,
  AgentToolPolicy,
  AgentRetrievalDefaults,
  AgentDefinitionV1,
  AgentRegistry,
  ResolveAgentInput,
  ResolvedAgent,
} from './agent.js';
export type { ClaimGraph, ClaimNode, ClaimEdge } from './graph/claim_graph.js';
export type { ClaimGraphLog, ClaimOp } from './graph/log.js';

export { parseToolCallV1FromText } from './tool_parse.js';
export { nowIso, createTrace } from './trace.js';
export { assertToolCallAllowed } from './tool_gate.js';
export {
  getAgentRoutingProfileV1,
  getPackRoutingProfilesV1,
} from './routing_profile.js';
export {
  isRouteDecisionV1,
  validateRouteDecisionV1,
  selectAgentIdFromRouteDecisionV1,
} from './router.js';
export { isToolCallV1, isToolResultV1 } from './tools.js';
export type {
  ToolId,
  ToolCallV1,
  ToolResultErrorV1,
  ToolResultV1,
  ToolSpecV1,
} from './tools.js';
export type { TraceEventV1 } from './trace.js';
export type { AgentRoutingProfileV1 } from './routing_profile.js';
export type { RouteCandidateV1, RouteDecisionV1 } from './router.js';
