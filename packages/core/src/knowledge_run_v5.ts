import {
  canonicalCbor,
  decodeCanonicalCbor,
  digestBytes,
  digestDomain,
  type CborValue,
  type Digest,
} from './knowledge_image_v5.js';

export type KnowledgeRunStatusV1 = 'pending' | 'running' | 'paused' | 'completed' | 'failed';
export type KnowledgeRunEventKindV1 = 'run.started' | 'run.checkpointed' | 'run.resumed' | 'run.completed' | 'run.failed';
export type KnowledgeRunStateV1 = Record<string, CborValue>;

export type KnowledgeRunEventV1 = {
  version: 1;
  id: Digest;
  runId: Digest;
  sequence: number;
  kind: KnowledgeRunEventKindV1;
  at: number;
  payload: Record<string, CborValue>;
};

export type KnowledgeRunCheckpointV1 = {
  sequence: number;
  stateRoot: Digest;
  state: KnowledgeRunStateV1;
};

export type KnowledgeRunV1 = {
  version: 1;
  runId: Digest;
  agentId: string;
  imageStateRoot: Digest;
  inputRoot: Digest;
  createdAt: number;
  updatedAt: number;
  status: KnowledgeRunStatusV1;
  sequence: number;
  events: KnowledgeRunEventV1[];
  checkpoint?: KnowledgeRunCheckpointV1;
  runRoot: Digest;
};

export type CreateKnowledgeRunOptionsV1 = {
  agentId: string;
  imageStateRoot: Digest;
  input: KnowledgeRunStateV1;
  createdAt: number;
};

export function knowledgeRunInputRootV1(input: KnowledgeRunStateV1): Digest {
  return digestDomain('run-input', canonicalCbor(input));
}

export function createKnowledgeRunV1(options: CreateKnowledgeRunOptionsV1): KnowledgeRunV1 {
  validateBase(options.agentId, options.imageStateRoot, options.createdAt);
  const inputRoot = knowledgeRunInputRootV1(options.input);
  const runId = digestDomain('run-id', canonicalCbor({ agentId: options.agentId, createdAt: options.createdAt, imageStateRoot: options.imageStateRoot, inputRoot, version: 1 } as unknown as CborValue));
  return rebuild({ version: 1, runId, agentId: options.agentId, imageStateRoot: options.imageStateRoot, inputRoot, createdAt: options.createdAt, updatedAt: options.createdAt, status: 'pending', sequence: 0, events: [] });
}

export function startKnowledgeRunV1(run: KnowledgeRunV1, at: number): KnowledgeRunV1 {
  return append(run, 'run.started', {}, at, 'running');
}

export function checkpointKnowledgeRunV1(run: KnowledgeRunV1, state: KnowledgeRunStateV1, at: number): KnowledgeRunV1 {
  validateAt(at);
  const stateRoot = digestDomain('run-state', canonicalCbor(state));
  const next = append(run, 'run.checkpointed', { stateRoot }, at, 'paused');
  return rebuild({ ...next, checkpoint: { sequence: next.sequence, stateRoot, state: cloneState(state) } });
}

export function resumeKnowledgeRunV1(run: KnowledgeRunV1, at: number): KnowledgeRunV1 {
  if (!run.checkpoint) throw new Error('V5 run cannot resume without a checkpoint.');
  return append(run, 'run.resumed', { stateRoot: run.checkpoint.stateRoot }, at, 'running');
}

export function completeKnowledgeRunV1(run: KnowledgeRunV1, result: KnowledgeRunStateV1 = {}, at: number): KnowledgeRunV1 {
  return append(run, 'run.completed', result, at, 'completed');
}

export function failKnowledgeRunV1(run: KnowledgeRunV1, error: string, at: number): KnowledgeRunV1 {
  if (typeof error !== 'string' || !error.trim()) throw new Error('V5 run failure message must be non-empty.');
  return append(run, 'run.failed', { error }, at, 'failed');
}

export function verifyKnowledgeRunV1(run: KnowledgeRunV1): void {
  if (!run || run.version !== 1 || !run.runId || !run.agentId || !isDigest(run.runId) || !isDigest(run.imageStateRoot) || !isDigest(run.inputRoot) || !Number.isSafeInteger(run.createdAt) || !Number.isSafeInteger(run.updatedAt) || !Number.isSafeInteger(run.sequence) || !['pending', 'running', 'paused', 'completed', 'failed'].includes(run.status) || !Array.isArray(run.events)) throw new Error('Malformed V5 durable run.');
  const expectedRunId = digestDomain('run-id', canonicalCbor({ agentId: run.agentId, createdAt: run.createdAt, imageStateRoot: run.imageStateRoot, inputRoot: run.inputRoot, version: 1 } as unknown as CborValue));
  if (run.runId !== expectedRunId) throw new Error('V5 durable run identity mismatch.');
  if (run.sequence !== run.events.length) throw new Error('Malformed V5 durable run sequence.');
  if (run.updatedAt < run.createdAt || run.events.some((event, index) => !validEvent(event, run.runId, index + 1))) throw new Error('Malformed V5 run journal.');
  let status: KnowledgeRunStatusV1 = 'pending';
  for (const event of run.events) {
    if (event.kind === 'run.started' && status === 'pending') status = 'running';
    else if (event.kind === 'run.checkpointed' && status === 'running') status = 'paused';
    else if (event.kind === 'run.resumed' && status === 'paused') status = 'running';
    else if (event.kind === 'run.completed' && (status === 'running' || status === 'paused')) status = 'completed';
    else if (event.kind === 'run.failed' && (status === 'running' || status === 'paused')) status = 'failed';
    else throw new Error('Invalid V5 run state transition.');
  }
  if (status !== run.status) throw new Error('V5 run status does not match its journal.');
  if (run.checkpoint) {
    if (!Number.isSafeInteger(run.checkpoint.sequence) || run.checkpoint.sequence < 1 || run.checkpoint.sequence > run.sequence || !isDigest(run.checkpoint.stateRoot) || digestDomain('run-state', canonicalCbor(run.checkpoint.state)) !== run.checkpoint.stateRoot) throw new Error('Malformed V5 run checkpoint.');
    const checkpointEvent = run.events[run.checkpoint.sequence - 1];
    if (!checkpointEvent || checkpointEvent.kind !== 'run.checkpointed' || checkpointEvent.payload.stateRoot !== run.checkpoint.stateRoot) throw new Error('V5 run checkpoint journal mismatch.');
  }
  if (run.runRoot !== computeRunRoot(run)) throw new Error('V5 durable run root mismatch.');
}

export function serializeKnowledgeRunV1(run: KnowledgeRunV1): Uint8Array {
  verifyKnowledgeRunV1(run);
  return canonicalCbor(runToCbor(run));
}

export function deserializeKnowledgeRunV1(bytes: Uint8Array): KnowledgeRunV1 {
  const value = asRecord(decodeCanonicalCbor(bytes));
  const run: KnowledgeRunV1 = {
    version: asVersion(value.version),
    runId: asDigest(value.runId),
    agentId: asString(value.agentId),
    imageStateRoot: asDigest(value.imageStateRoot),
    inputRoot: asDigest(value.inputRoot),
    createdAt: asNumber(value.createdAt),
    updatedAt: asNumber(value.updatedAt),
    status: asStatus(value.status),
    sequence: asNumber(value.sequence),
    events: asEvents(value.events),
    ...(value.checkpoint === undefined ? {} : { checkpoint: asCheckpoint(value.checkpoint) }),
    runRoot: asDigest(value.runRoot),
  };
  verifyKnowledgeRunV1(run);
  return run;
}

function append(run: KnowledgeRunV1, kind: KnowledgeRunEventKindV1, payload: Record<string, CborValue>, at: number, status: KnowledgeRunStatusV1): KnowledgeRunV1 {
  verifyKnowledgeRunV1(run);
  validateAt(at);
  if (at < run.updatedAt) throw new Error('V5 run event time cannot move backwards.');
  const allowed = run.status === 'pending' && kind === 'run.started' || run.status === 'running' && ['run.checkpointed', 'run.completed', 'run.failed'].includes(kind) || run.status === 'paused' && ['run.resumed', 'run.failed'].includes(kind);
  if (!allowed) throw new Error(`Invalid V5 run transition: ${run.status} -> ${kind}.`);
  const eventBody = { at, kind, payload, runId: run.runId, sequence: run.sequence + 1, version: 1 as const };
  const event: KnowledgeRunEventV1 = { ...eventBody, id: digestDomain('run-event', canonicalCbor(eventBody as unknown as CborValue)) };
  return rebuild({ ...run, status, sequence: run.sequence + 1, updatedAt: at, events: [...run.events, event] });
}

function rebuild(run: Omit<KnowledgeRunV1, 'runRoot'>): KnowledgeRunV1 {
  const next = { ...run, events: run.events.map((event) => ({ ...event, payload: { ...event.payload } })) } as KnowledgeRunV1;
  return { ...next, runRoot: computeRunRoot(next) };
}

function computeRunRoot(run: KnowledgeRunV1): Digest {
  return digestDomain('run', canonicalCbor(runToCbor({ ...run, runRoot: undefined } as unknown as KnowledgeRunV1)));
}

function runToCbor(run: KnowledgeRunV1): CborValue {
  const value: Record<string, CborValue> = { agentId: run.agentId, createdAt: run.createdAt, events: run.events.map(eventToCbor), imageStateRoot: run.imageStateRoot, inputRoot: run.inputRoot, runId: run.runId, sequence: run.sequence, status: run.status, updatedAt: run.updatedAt, version: run.version };
  if (run.checkpoint) value.checkpoint = { sequence: run.checkpoint.sequence, state: run.checkpoint.state, stateRoot: run.checkpoint.stateRoot };
  if (typeof run.runRoot === 'string') value.runRoot = run.runRoot;
  return value;
}
function eventToCbor(event: KnowledgeRunEventV1): CborValue { return { at: event.at, id: event.id, kind: event.kind, payload: event.payload, runId: event.runId, sequence: event.sequence, version: event.version }; }
function validEvent(event: KnowledgeRunEventV1, runId: Digest, sequence: number): boolean { return event.version === 1 && event.runId === runId && event.sequence === sequence && Number.isSafeInteger(event.at) && isDigest(event.id) && digestDomain('run-event', canonicalCbor({ at: event.at, kind: event.kind, payload: event.payload, runId: event.runId, sequence: event.sequence, version: 1 } as unknown as CborValue)) === event.id; }
function validateBase(agentId: string, imageStateRoot: Digest, at: number): void { if (typeof agentId !== 'string' || !agentId.trim()) throw new Error('V5 run agent ID must be non-empty.'); if (!isDigest(imageStateRoot)) throw new Error('V5 run image state root is invalid.'); validateAt(at); }
function validateAt(at: number): void { if (!Number.isSafeInteger(at) || at < 0) throw new Error('V5 run time must be a non-negative safe integer.'); }
function isDigest(value: unknown): value is Digest { if (typeof value !== 'string') return false; try { digestBytes(value); return true; } catch { return false; } }
function cloneState(state: KnowledgeRunStateV1): KnowledgeRunStateV1 { return { ...state }; }
function asRecord(value: CborValue): Record<string, CborValue> { if (!value || typeof value !== 'object' || Array.isArray(value) || value instanceof Uint8Array) throw new Error('Malformed V5 run record.'); return value as Record<string, CborValue>; }
function asString(value: CborValue | undefined): string { if (typeof value !== 'string') throw new Error('Malformed V5 run text.'); return value; }
function asVersion(value: CborValue | undefined): 1 { return asNumber(value) === 1 ? 1 : (() => { throw new Error('Unsupported V5 run version.'); })(); }
function asNumber(value: CborValue | undefined): number { const number = typeof value === 'bigint' ? Number(value) : value; if (typeof number !== 'number' || !Number.isSafeInteger(number)) throw new Error('Malformed V5 run integer.'); return number; }
function asDigest(value: CborValue | undefined): Digest { const digest = asString(value); if (!isDigest(digest)) throw new Error('Malformed V5 run digest.'); return digest; }
function asStatus(value: CborValue | undefined): KnowledgeRunStatusV1 { const status = asString(value); if (!['pending', 'running', 'paused', 'completed', 'failed'].includes(status)) throw new Error('Malformed V5 run status.'); return status as KnowledgeRunStatusV1; }
function asEvents(value: CborValue | undefined): KnowledgeRunEventV1[] { if (!Array.isArray(value)) throw new Error('Malformed V5 run events.'); return value.map((entry) => { const event = asRecord(entry); return { version: asVersion(event.version), id: asDigest(event.id), runId: asDigest(event.runId), sequence: asNumber(event.sequence), kind: asString(event.kind) as KnowledgeRunEventKindV1, at: asNumber(event.at), payload: normalizeStateValue(asRecord(event.payload)) as Record<string, CborValue> }; }); }
function asCheckpoint(value: CborValue): KnowledgeRunCheckpointV1 { const checkpoint = asRecord(value); return { sequence: asNumber(checkpoint.sequence), stateRoot: asDigest(checkpoint.stateRoot), state: normalizeStateValue(asRecord(checkpoint.state)) as KnowledgeRunStateV1 }; }
function normalizeStateValue(value: CborValue): CborValue { if (typeof value === 'bigint' && value >= BigInt(Number.MIN_SAFE_INTEGER) && value <= BigInt(Number.MAX_SAFE_INTEGER)) return Number(value); if (Array.isArray(value)) return value.map(normalizeStateValue); if (value && typeof value === 'object' && !(value instanceof Uint8Array)) return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, normalizeStateValue(item)])) as unknown as CborValue; return value; }
