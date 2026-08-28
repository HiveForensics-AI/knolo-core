import {
  inspectKnowledgeImageV5,
  mountKnowledgeImageV5,
  canonicalCbor,
  digestDomain,
  type CborValue,
  type Digest,
  type KnowledgeImageV5,
} from './knowledge_image_v5.js';
import { verifyKnowledgeQueryIndexV5, type KnowledgeQueryIndexV1 } from './knowledge_query_index_v5.js';
import { verifyKnowledgeQueryHistoryV5, type KnowledgeQueryHistoryV1 } from './knowledge_query_history_v5.js';
import { verifyKnowledgeRunV1, type KnowledgeRunV1 } from './knowledge_run_v5.js';
import { serializeKnowledgeSyncReplayStateV1, type KnowledgeSyncReplayStateV1 } from './knowledge_sync_exchange_v5.js';

export type KnowledgeRuntimeDiagnosticsInputV1 = {
  image: KnowledgeImageV5 | ArrayBufferLike | Uint8Array;
  queryIndex?: KnowledgeQueryIndexV1;
  queryHistory?: KnowledgeQueryHistoryV1;
  run?: KnowledgeRunV1;
  replayState?: KnowledgeSyncReplayStateV1;
};

export type KnowledgeRuntimeDiagnosticsV1 = {
  version: 1;
  valid: true;
  image: {
    stateRoot: Digest;
    commitDigest: Digest;
    sequence: number;
    objectCount: number;
    eventCount: number;
    segmentCount: number;
    activeSuperblock: 'A' | 'B';
  };
  queryIndex?: { stateRoot: Digest; indexRoot: Digest; objectCount: number };
  queryHistory?: { historyRoot: Digest; entryCount: number };
  run?: { runId: Digest; runRoot: Digest; imageStateRoot: Digest; status: KnowledgeRunV1['status']; sequence: number };
  replay?: { cacheRoot: Digest; entryCount: number; maxEntries: number };
  diagnosticsRoot: Digest;
};

export function inspectKnowledgeRuntimeV5(input: KnowledgeRuntimeDiagnosticsInputV1): KnowledgeRuntimeDiagnosticsV1 {
  const image = isImage(input.image) ? input.image : mountKnowledgeImageV5(input.image);
  const imageInspection = inspectKnowledgeImageV5(image.bytes);
  const diagnostics: Omit<KnowledgeRuntimeDiagnosticsV1, 'diagnosticsRoot'> = {
    version: 1,
    valid: true,
    image: {
      stateRoot: image.stateRoot,
      commitDigest: image.commitDigest,
      sequence: image.commit.sequence,
      objectCount: image.objects.length,
      eventCount: image.events.length,
      segmentCount: image.segments.length,
      activeSuperblock: imageInspection.activeSuperblock,
    },
  };
  if (input.queryIndex) {
    verifyKnowledgeQueryIndexV5(image, input.queryIndex);
    diagnostics.queryIndex = { stateRoot: input.queryIndex.stateRoot, indexRoot: input.queryIndex.indexRoot, objectCount: input.queryIndex.objectIds.length };
  }
  if (input.queryHistory) {
    verifyKnowledgeQueryHistoryV5(input.queryHistory);
    diagnostics.queryHistory = { historyRoot: input.queryHistory.historyRoot, entryCount: input.queryHistory.entries.length };
  }
  if (input.run) {
    verifyKnowledgeRunV1(input.run);
    if (input.run.imageStateRoot !== image.stateRoot) throw new Error('V5 runtime diagnostic run image root mismatch.');
    diagnostics.run = { runId: input.run.runId, runRoot: input.run.runRoot, imageStateRoot: input.run.imageStateRoot, status: input.run.status, sequence: input.run.sequence };
  }
  if (input.replayState) {
    serializeKnowledgeSyncReplayStateV1(input.replayState);
    diagnostics.replay = { cacheRoot: input.replayState.cacheRoot, entryCount: input.replayState.entries.length, maxEntries: input.replayState.maxEntries };
  }
  return { ...diagnostics, diagnosticsRoot: diagnosticsRoot(diagnostics) };
}

export function verifyKnowledgeRuntimeDiagnosticsV5(input: KnowledgeRuntimeDiagnosticsInputV1, diagnostics: KnowledgeRuntimeDiagnosticsV1): void {
  if (!diagnostics || diagnostics.version !== 1 || diagnostics.valid !== true) throw new Error('Malformed V5 runtime diagnostics.');
  const expected = inspectKnowledgeRuntimeV5(input);
  if (diagnosticsRoot(diagnostics) !== diagnostics.diagnosticsRoot || encodeDiagnostics(expected) !== encodeDiagnostics(diagnostics)) throw new Error('V5 runtime diagnostics root mismatch.');
}

function diagnosticsRoot(diagnostics: Omit<KnowledgeRuntimeDiagnosticsV1, 'diagnosticsRoot'> | KnowledgeRuntimeDiagnosticsV1): Digest {
  const { diagnosticsRoot: _ignored, ...body } = diagnostics as KnowledgeRuntimeDiagnosticsV1;
  return digestDomain('runtime-diagnostics', canonicalCbor(body as unknown as CborValue));
}
function encodeDiagnostics(diagnostics: KnowledgeRuntimeDiagnosticsV1): string { return Array.from(canonicalCbor(diagnostics as unknown as CborValue), (byte) => byte.toString(16).padStart(2, '0')).join(''); }
function isImage(input: KnowledgeImageV5 | ArrayBufferLike | Uint8Array): input is KnowledgeImageV5 { return typeof input === 'object' && input !== null && 'stateRoot' in input && 'objects' in input; }
