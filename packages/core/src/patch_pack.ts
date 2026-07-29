import { createPackFingerprint } from './semantic/sidecar.js';
import { getTextDecoder, getTextEncoder } from './utils/utf8.js';
import type { BuildInputDoc } from './builder.js';
import type { Pack } from './pack.runtime.js';
import { createLivePack, type LivePack } from './live.js';

/** A complete replacement for one stable-id document in a patch stream. */
export type PatchUpsertV1 = {
  op: 'upsert';
  id: string;
  doc: BuildInputDoc & { id: string };
  ts: number;
  actor: string;
};

/** A tombstone for one stable-id document in a patch stream. */
export type PatchRemoveV1 = {
  op: 'remove';
  id: string;
  ts: number;
  actor: string;
};

export type PatchOpV1 = PatchUpsertV1 | PatchRemoveV1;

export type PatchPackV1 = {
  version: 1;
  baseFingerprint: string;
  ops: PatchOpV1[];
};

export type PatchPack = PatchPackV1;

export function createPatchPack(
  base: Pick<Pack, 'blocks' | 'docIds' | 'meta'>,
  ops: PatchOpV1[] = []
): PatchPack {
  const pack = { version: 1 as const, baseFingerprint: createPackFingerprint(base), ops };
  return normalizePatchPack(pack);
}

export function appendPatch(pack: PatchPack, op: PatchOpV1): PatchPack {
  return normalizePatchPack({
    version: 1,
    baseFingerprint: pack.baseFingerprint,
    ops: [...pack.ops, op],
  });
}

export function mergePatchPacks(a: PatchPack, b: PatchPack): PatchPack {
  const left = normalizePatchPack(a);
  const right = normalizePatchPack(b);
  if (left.baseFingerprint !== right.baseFingerprint) {
    throw new Error(
      `Cannot merge patch packs for different bases: ${left.baseFingerprint} != ${right.baseFingerprint}.`
    );
  }
  return normalizePatchPack({
    version: 1,
    baseFingerprint: left.baseFingerprint,
    ops: [...left.ops, ...right.ops],
  });
}

export function serializePatchPack(pack: PatchPack): Uint8Array {
  return getTextEncoder().encode(JSON.stringify(normalizePatchPack(pack)));
}

export function deserializePatchPack(data: Uint8Array): PatchPack {
  let parsed: unknown;
  try {
    parsed = JSON.parse(getTextDecoder().decode(data));
  } catch {
    throw new Error('Invalid patch pack payload.');
  }
  return normalizePatchPack(parsed);
}

/** Replay an append-only patch stream into a LivePack over the supplied base. */
export async function applyPatchPack(base: Pack, patch: PatchPack): Promise<LivePack> {
  const normalized = normalizePatchPack(patch);
  const expected = createPackFingerprint(base);
  if (normalized.baseFingerprint !== expected) {
    throw new Error(
      `Patch pack base fingerprint mismatch: expected ${expected}, got ${normalized.baseFingerprint}.`
    );
  }

  const live = await createLivePack(base);
  for (const op of normalized.ops) {
    if (op.op === 'upsert') {
      await live.addDocument(op.doc);
    } else {
      // A remove for an already-absent id is intentionally idempotent when
      // replaying independently produced patch streams.
      try {
        await live.removeDocument(op.id);
      } catch (error) {
        if (!(error instanceof Error) || !/unknown id/i.test(error.message)) throw error;
      }
    }
  }
  return live;
}

function normalizePatchPack(input: unknown): PatchPack {
  if (!input || typeof input !== 'object') throw new Error('Invalid patch pack.');
  const value = input as Partial<PatchPack>;
  if (value.version !== 1 || typeof value.baseFingerprint !== 'string' || !Array.isArray(value.ops)) {
    throw new Error('Invalid patch pack: expected version 1, baseFingerprint, and ops.');
  }
  const ops = value.ops.map(normalizePatchOp).sort(comparePatchOps);
  return { version: 1, baseFingerprint: value.baseFingerprint, ops };
}

function normalizePatchOp(input: unknown): PatchOpV1 {
  if (!input || typeof input !== 'object') throw new Error('Invalid patch operation.');
  const op = input as Partial<PatchOpV1>;
  const id = normalizeId(op.id);
  const ts = op.ts;
  const actor = op.actor;
  if (typeof ts !== 'number' || !Number.isFinite(ts) || typeof actor !== 'string' || !actor.trim()) {
    throw new Error('Invalid patch operation: ts must be finite and actor must be non-empty.');
  }
  if (op.op === 'remove') return { op: 'remove', id, ts, actor };
  if (op.op !== 'upsert' || !op.doc || typeof op.doc !== 'object') {
    throw new Error('Invalid patch operation: expected upsert or remove.');
  }
  const doc = op.doc as BuildInputDoc & { id: string };
  if (doc.id !== id || typeof doc.text !== 'string' || !doc.text.trim()) {
    throw new Error('Invalid patch upsert: doc.id must match id and doc.text must be non-empty.');
  }
  if (doc.heading !== undefined && typeof doc.heading !== 'string') throw new Error('Invalid patch upsert heading.');
  if (doc.namespace !== undefined && typeof doc.namespace !== 'string') throw new Error('Invalid patch upsert namespace.');
  return {
    op: 'upsert',
    id,
    ts,
    actor,
    doc: {
      id,
      text: doc.text,
      ...(doc.heading !== undefined ? { heading: doc.heading } : {}),
      ...(doc.namespace !== undefined ? { namespace: doc.namespace } : {}),
    },
  };
}

function comparePatchOps(a: PatchOpV1, b: PatchOpV1): number {
  return a.ts - b.ts || a.actor.localeCompare(b.actor) || a.id.localeCompare(b.id) || a.op.localeCompare(b.op) || stableOp(a).localeCompare(stableOp(b));
}

function stableOp(op: PatchOpV1): string {
  return op.op === 'remove' ? 'remove' : `upsert|${op.doc.text}|${op.doc.heading ?? ''}|${op.doc.namespace ?? ''}`;
}

function normalizeId(id: unknown): string {
  if (typeof id !== 'string' || !id.trim()) throw new Error('Patch operation id must be a non-empty string.');
  return id;
}
