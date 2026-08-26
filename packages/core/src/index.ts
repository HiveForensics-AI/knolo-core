// src/index.ts
export { mountPack, hasSemantic } from './pack.runtime.js';
export { mountPackFromBuffer } from './pack.runtime.js';
export { isPackV4, inspectPackV4, parsePackV4, serializePackV4, PACK_V4_MAGIC } from './pack.v4.js';
export {
  canonicalCbor,
  decodeCanonicalCbor,
  createKnowledgeImageV5,
  digestBytes,
  digestDomain,
  inspectKnowledgeImageV5,
  isKnowledgeImageV5,
  migrateV4ToV5,
  mountKnowledgeImageV5,
  stateRoot,
  verifyKnowledgeImageV5,
  KNOWLEDGE_IMAGE_V5_MAGIC,
  KNOWLEDGE_IMAGE_V5_VERSION,
  knowledgePolicyRootV5,
} from './knowledge_image_v5.js';
export { KnowledgeImageStoreV5, KnowledgeTransactionV5 } from './knowledge_store_v5.js';
export type { KnowledgeSnapshotV5, KnowledgeTransactionOptionsV5 } from './knowledge_store_v5.js';
export { compareKnowledgeSyncImagesV5, createKnowledgeSyncSummaryV1, fastForwardKnowledgeImageV5, syncSummaryRootV1, verifyKnowledgeSyncSummaryV5 } from './knowledge_sync_v5.js';
export {
  createKnowledgeSyncRequestV1,
  createKnowledgeSyncResponseV1,
  syncRequestPayloadV1,
  syncRequestRootV1,
  syncResponsePayloadV1,
  syncResponseRootV1,
  verifyKnowledgeSyncRequestV5,
  verifyKnowledgeSyncRequestV5Async,
  verifyKnowledgeSyncResponseV5,
  verifyKnowledgeSyncResponseV5Async,
} from './knowledge_sync_protocol_v5.js';
export {
  decodeKnowledgeSyncRequestV1,
  decodeKnowledgeSyncResponseV1,
  encodeKnowledgeSyncRequestV1,
  encodeKnowledgeSyncResponseV1,
  KNOWLEDGE_SYNC_MAX_WIRE_BYTES_V1,
} from './knowledge_sync_wire_v5.js';
export {
  KnowledgeSyncReplayCacheV1,
  exchangeKnowledgeSyncOverTransportV5,
  verifyKnowledgeSyncExchangeV5,
  verifyKnowledgeSyncExchangeV5Async,
} from './knowledge_sync_exchange_v5.js';
export {
  parseKnowledgeQueryV5,
  queryKnowledgeImageV5,
  verifyKnowledgeQueryResultV5,
} from './knowledge_query_v5.js';
export {
  createKnowledgeQueryIndexV5,
  candidateObjectIdsForKnowledgeQueryIndexV1,
  deserializeKnowledgeQueryIndexV1,
  serializeKnowledgeQueryIndexV1,
  verifyKnowledgeQueryIndexV5,
} from './knowledge_query_index_v5.js';
export {
  appendKnowledgeQueryHistoryV5,
  createKnowledgeQueryHistoryV5,
  deserializeKnowledgeQueryHistoryV1,
  serializeKnowledgeQueryHistoryV1,
  verifyKnowledgeQueryHistoryV5,
} from './knowledge_query_history_v5.js';
export {
  evaluateKnowledgeQueryPolicyV5,
  verifyKnowledgeAuthorizationResultV5,
} from './knowledge_policy_v5.js';
export {
  authorityEnvelopePayloadV1,
  authorityEnvelopeRootV1,
  delegationPayloadV1,
  delegationRootV1,
  verifyKnowledgeAuthorityEnvelopeV5,
  verifyKnowledgeAuthorityEnvelopeV5Async,
} from './knowledge_authority_v5.js';
export {
  signKnowledgeKeyRotationWithEd25519,
  applyKnowledgeKeyRotationWithEd25519,
  verifyKnowledgeAuthorityEnvelopeWithEd25519,
  verifyKnowledgeKeyRotationWithEd25519,
  signKnowledgeSyncRequestWithEd25519,
  signKnowledgeSyncResponseWithEd25519,
  verifyKnowledgeSyncRequestWithEd25519,
  verifyKnowledgeSyncResponseWithEd25519,
  verifyKnowledgeSyncExchangeWithEd25519,
  exchangeKnowledgeSyncOverTransportWithEd25519,
} from './knowledge_crypto_v5.js';
export { authoritySessionRootV1, verifyKnowledgeAuthoritySessionWithEd25519 } from './knowledge_authority_session_v5.js';
export {
  applyKnowledgeKeyRotationV5,
  authorityKeyPayloadV1,
  authorityKeyringRootV1,
  deserializeAuthorityKeyringV1,
  keyRotationPayloadV1,
  keyRotationRootV1,
  serializeAuthorityKeyringV1,
  verifyKnowledgeKeyRotationV5,
  verifyKnowledgeKeyRotationV5Async,
} from './knowledge_key_rotation_v5.js';
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
export type {
  CreateKnowledgeImageOptions,
  Digest,
  KnowledgeObjectInput,
  KnowledgeCommitV1,
  KnowledgeEventV1,
  KnowledgeImageSegment,
  KnowledgeImageV5,
  KnowledgeImageVerification,
  KnowledgeObjectV1,
  MigrationReceiptV1,
  CborValue,
  KnowledgePolicyRuleV1,
  KnowledgePolicyV1,
} from './knowledge_image_v5.js';
export type {
  KnowledgeQueryFilterV1,
  KnowledgeQueryJoinV1,
  KnowledgeQueryHitV1,
  KnowledgeQueryOrderV1,
  KnowledgeQueryPlanV1,
  KnowledgeQueryResultV1,
  KnowledgeQueryScalarV1,
} from './knowledge_query_v5.js';
export type { KnowledgeQueryIndexV1 } from './knowledge_query_index_v5.js';
export type { KnowledgeQueryHistoryEntryV1, KnowledgeQueryHistoryV1 } from './knowledge_query_history_v5.js';
export type {
  KnowledgeAuthorizationDecisionV1,
  KnowledgeAuthorizationResultV1,
  KnowledgePolicyActionV1,
} from './knowledge_policy_v5.js';
export type {
  KnowledgeAuthorityEnvelopeV1,
  KnowledgeAuthorityAsyncVerificationOptionsV1,
  KnowledgeAuthorityVerificationOptionsV1,
  KnowledgeAuthorityVerificationV1,
  KnowledgeDelegationV1,
} from './knowledge_authority_v5.js';
export type {
  Ed25519AuthorityKeyV1,
  Ed25519AuthorityKeyringV1,
  UnsignedKnowledgeKeyRotationV1,
} from './knowledge_crypto_v5.js';
export type {
  KnowledgeAuthorityKeyV1,
  KnowledgeAuthorityKeyringV1,
  KnowledgeKeyRotationAsyncVerificationOptionsV1,
  KnowledgeKeyRotationRecordV1,
  KnowledgeKeyRotationVerificationOptionsV1,
} from './knowledge_key_rotation_v5.js';
export type {
  KnowledgeAuthorityKeyringProviderV1,
  KnowledgeAuthoritySessionInputV1,
  KnowledgeAuthoritySessionV1,
} from './knowledge_authority_session_v5.js';
export type {
  KnowledgeFastForwardResultV1,
  KnowledgeSyncPlanV1,
  KnowledgeSyncRelationV1,
  KnowledgeSyncSummaryV1,
} from './knowledge_sync_v5.js';
export {
  applyKnowledgeSyncMergeV5,
  planKnowledgeSyncMergeV5,
  verifyKnowledgeMergePlanV5,
} from './knowledge_merge_v5.js';
export type {
  KnowledgeMergeApplyOptionsV1,
  KnowledgeMergeConflictV1,
  KnowledgeMergeDecisionV1,
  KnowledgeMergePlanV1,
  KnowledgeMergeResolutionV1,
  KnowledgeMergeResultV1,
} from './knowledge_merge_v5.js';
export {
  checkpointKnowledgeRunV1,
  completeKnowledgeRunV1,
  createKnowledgeRunV1,
  deserializeKnowledgeRunV1,
  failKnowledgeRunV1,
  resumeKnowledgeRunV1,
  serializeKnowledgeRunV1,
  startKnowledgeRunV1,
  verifyKnowledgeRunV1,
  knowledgeRunInputRootV1,
} from './knowledge_run_v5.js';
export { executeKnowledgeAgentRunV1 } from './knowledge_agent_runtime_v5.js';
export type {
  CreateKnowledgeRunOptionsV1,
  KnowledgeRunCheckpointV1,
  KnowledgeRunEventKindV1,
  KnowledgeRunEventV1,
  KnowledgeRunStateV1,
  KnowledgeRunStatusV1,
  KnowledgeRunV1,
} from './knowledge_run_v5.js';
export type {
  KnowledgeAgentExecutionOptionsV1,
  KnowledgeAgentExecutionResultV1,
  KnowledgeAgentStepContextV1,
  KnowledgeAgentStepV1,
} from './knowledge_agent_runtime_v5.js';
export type {
  KnowledgeSyncMessageAsyncVerificationOptionsV1,
  KnowledgeSyncMessageVerificationOptionsV1,
  KnowledgeSyncRequestV1,
  KnowledgeSyncResponseV1,
} from './knowledge_sync_protocol_v5.js';
export type {
  KnowledgeSyncExchangeAsyncVerificationOptionsV1,
  KnowledgeSyncExchangeVerificationOptionsV1,
  KnowledgeSyncReplayCacheOptionsV1,
  KnowledgeSyncTransportExchangeOptionsV1,
  KnowledgeSyncTransportExchangeResultV1,
  KnowledgeSyncTransportV1,
} from './knowledge_sync_exchange_v5.js';
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
