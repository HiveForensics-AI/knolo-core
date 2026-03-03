/*
 * pack.runtime.ts
 *
 * Runtime-safe pack mounting for browser and React Native environments.
 * No Node stdlib imports are allowed in this module.
 */

import { getTextDecoder } from './utils/utf8.js';
import type { AgentRegistry } from './agent.js';
import { validateAgentRegistry } from './agent.js';
import type { ClaimGraph } from './graph/claim_graph.js';
import { validateClaimGraph } from './graph/claim_graph.js';

export type MountOptions = { src: string | ArrayBufferLike | Uint8Array };

export type PackMeta = {
  version: number;
  stats: { docs: number; blocks: number; terms: number; avgBlockLen?: number };
  agents?: AgentRegistry;
  claimGraph?: { version: 1; nodes: number; edges: number };
};

export type Pack = {
  meta: PackMeta;
  lexicon: Map<string, number>;
  postings: Uint32Array;
  blocks: string[];
  headings?: (string | null)[];
  docIds?: (string | null)[];
  namespaces?: (string | null)[];
  blockTokenLens?: number[];
  semantic?: {
    version: 1;
    modelId: string;
    dims: number;
    encoding: 'int8_l2norm';
    perVectorScale: boolean;
    vecs: Int8Array;
    scales?: Uint16Array;
  };
  claimGraph?: ClaimGraph;
};

export function hasSemantic(pack: Pack): boolean {
  return Boolean(
    pack.semantic && pack.semantic.dims > 0 && pack.semantic.vecs.length > 0
  );
}

export async function mountPack(opts: MountOptions): Promise<Pack> {
  const buf = await resolveToBuffer(opts.src);
  return mountPackFromBuffer(buf);
}

export function mountPackFromBuffer(buf: ArrayBuffer): Pack {
  const dv = new DataView(buf);
  const dec = getTextDecoder();
  let offset = 0;

  const metaLen = dv.getUint32(offset, true);
  offset += 4;
  const metaJson = dec.decode(new Uint8Array(buf, offset, metaLen));
  offset += metaLen;
  const meta: PackMeta = JSON.parse(metaJson);
  if (meta.agents) {
    validateAgentRegistry(meta.agents);
  }

  const lexLen = dv.getUint32(offset, true);
  offset += 4;
  const lexJson = dec.decode(new Uint8Array(buf, offset, lexLen));
  offset += lexLen;
  const lexEntries: Array<[string, number]> = JSON.parse(lexJson);
  const lexicon = new Map<string, number>(lexEntries);

  const postCount = dv.getUint32(offset, true);
  offset += 4;
  const postings = new Uint32Array(postCount);
  for (let i = 0; i < postCount; i++) {
    postings[i] = dv.getUint32(offset, true);
    offset += 4;
  }

  const blocksLen = dv.getUint32(offset, true);
  offset += 4;
  const blocksJson = dec.decode(new Uint8Array(buf, offset, blocksLen));
  offset += blocksLen;
  const parsed = JSON.parse(blocksJson);

  let blocks: string[] = [];
  let headings: (string | null)[] | undefined;
  let docIds: (string | null)[] | undefined;
  let namespaces: (string | null)[] | undefined;
  let blockTokenLens: number[] | undefined;

  if (Array.isArray(parsed) && parsed.length && typeof parsed[0] === 'string') {
    blocks = parsed as string[];
  } else if (Array.isArray(parsed)) {
    blocks = [];
    headings = [];
    docIds = [];
    namespaces = [];
    blockTokenLens = [];
    for (const it of parsed) {
      if (it && typeof it === 'object') {
        blocks.push(String(it.text ?? ''));
        headings.push(it.heading ?? null);
        docIds.push(it.docId ?? null);
        namespaces.push(it.namespace ?? null);
        blockTokenLens.push(typeof it.len === 'number' ? it.len : 0);
      } else {
        blocks.push(String(it ?? ''));
        headings.push(null);
        docIds.push(null);
        namespaces.push(null);
        blockTokenLens.push(0);
      }
    }
  }

  let semantic: Pack['semantic'];
  let claimGraph: ClaimGraph | undefined;

  while (offset < buf.byteLength) {
    const sectionStart = offset;
    if (buf.byteLength - offset < 4) break;
    const jsonLen = dv.getUint32(offset, true);
    offset += 4;
    if (jsonLen < 0 || offset + jsonLen > buf.byteLength) {
      offset = sectionStart;
      break;
    }

    let parsed: unknown;
    try {
      const json = dec.decode(new Uint8Array(buf, offset, jsonLen));
      parsed = JSON.parse(json);
    } catch {
      offset = sectionStart;
      break;
    }
    offset += jsonLen;

    if (!semantic && looksLikeSemanticJson(parsed)) {
      if (buf.byteLength - offset < 4) {
        offset = sectionStart;
        break;
      }
      const semBlobLen = dv.getUint32(offset, true);
      offset += 4;
      if (semBlobLen < 0 || offset + semBlobLen > buf.byteLength) {
        offset = sectionStart;
        break;
      }
      const semBlob = new Uint8Array(buf, offset, semBlobLen);
      offset += semBlobLen;
      semantic = parseSemanticSection(parsed, semBlob);
      continue;
    }

    const graph = validateClaimGraph(parsed);
    if (!claimGraph && graph) {
      claimGraph = graph;
      continue;
    }

    offset = sectionStart;
    break;
  }

  return {
    meta,
    lexicon,
    postings,
    blocks,
    headings,
    docIds,
    namespaces,
    blockTokenLens,
    semantic,
    claimGraph,
  };
}

function looksLikeSemanticJson(parsed: unknown): boolean {
  if (!parsed || typeof parsed !== 'object') return false;
  const sem = parsed as {
    version?: number;
    encoding?: string;
    blocks?: { vectors?: { byteOffset?: number; length?: number } };
  };
  return (
    sem.version === 1 &&
    sem.encoding === 'int8_l2norm' &&
    typeof sem.blocks?.vectors?.byteOffset === 'number' &&
    typeof sem.blocks?.vectors?.length === 'number'
  );
}

function parseSemanticSection(sem: any, blob: Uint8Array): Pack['semantic'] {
  const vectors = sem?.blocks?.vectors;
  const scales = sem?.blocks?.scales;

  const vecs = new Int8Array(
    blob.buffer,
    blob.byteOffset + Number(vectors?.byteOffset ?? 0),
    Number(vectors?.length ?? 0)
  );

  let scaleView: Uint16Array | undefined;
  if (scales) {
    const scaleLen = Number(scales.length ?? 0);
    const scaleOffset = Number(scales.byteOffset ?? 0);
    const dv = new DataView(
      blob.buffer,
      blob.byteOffset + scaleOffset,
      scaleLen * 2
    );
    scaleView = new Uint16Array(scaleLen);
    for (let i = 0; i < scaleLen; i++) {
      scaleView[i] = dv.getUint16(i * 2, true);
    }
  }

  return {
    version: 1,
    modelId: String(sem?.modelId ?? ''),
    dims: Number(sem?.dims ?? 0),
    encoding: 'int8_l2norm',
    perVectorScale: Boolean(sem?.perVectorScale),
    vecs,
    scales: scaleView,
  };
}

async function resolveToBuffer(src: MountOptions['src']): Promise<ArrayBuffer> {
  if (typeof src === 'string') {
    try {
      const res = await fetch(src);
      return await res.arrayBuffer();
    } catch {
      throw new Error(
        'mountPack({src: string}) expects a URL in React Native. For local files, load bytes in your app and pass Uint8Array/ArrayBuffer.'
      );
    }
  }
  return toArrayBuffer(src);
}

export function toArrayBuffer(src: ArrayBufferLike | Uint8Array): ArrayBuffer {
  if (src instanceof Uint8Array) {
    if (src.byteOffset === 0 && src.byteLength === src.buffer.byteLength) {
      return src.buffer as ArrayBuffer;
    }
    const copy = src.slice();
    return copy.buffer as ArrayBuffer;
  }
  return src as ArrayBuffer;
}
