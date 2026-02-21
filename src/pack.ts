/*
 * pack.ts
 *
 * Mount `.knolo` packs across Node, browsers, and RN/Expo. Tolerant of:
 *  - blocks as string[] (v1) or object[] with { text, heading?, docId?, namespace?, len? }
 *  - meta.stats.avgBlockLen (optional)
 * Includes RN/Expo-safe TextDecoder via ponyfill.
 */

import { getTextDecoder } from './utils/utf8.js';
import type { AgentRegistry } from './agent.js';
import { validateAgentRegistry } from './agent.js';

export type MountOptions = { src: string | ArrayBufferLike | Uint8Array };

export type PackMeta = {
  version: number;
  stats: { docs: number; blocks: number; terms: number; avgBlockLen?: number };
  agents?: AgentRegistry;
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
};

export function hasSemantic(pack: Pack): boolean {
  return Boolean(
    pack.semantic && pack.semantic.dims > 0 && pack.semantic.vecs.length > 0
  );
}

export async function mountPack(opts: MountOptions): Promise<Pack> {
  const buf = await resolveToBuffer(opts.src);
  const dv = new DataView(buf);
  const dec = getTextDecoder();
  let offset = 0;

  // meta
  const metaLen = dv.getUint32(offset, true);
  offset += 4;
  const metaJson = dec.decode(new Uint8Array(buf, offset, metaLen));
  offset += metaLen;
  const meta: PackMeta = JSON.parse(metaJson);
  if (meta.agents) {
    validateAgentRegistry(meta.agents);
  }

  // lexicon
  const lexLen = dv.getUint32(offset, true);
  offset += 4;
  const lexJson = dec.decode(new Uint8Array(buf, offset, lexLen));
  offset += lexLen;
  const lexEntries: Array<[string, number]> = JSON.parse(lexJson);
  const lexicon = new Map<string, number>(lexEntries);

  // postings
  const postCount = dv.getUint32(offset, true);
  offset += 4;
  const postings = new Uint32Array(postCount);
  for (let i = 0; i < postCount; i++) {
    postings[i] = dv.getUint32(offset, true);
    offset += 4;
  }

  // blocks (v1: string[]; v2/v3: {text, heading?, docId?, namespace?, len?}[])
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
    // v1
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
  } else {
    blocks = [];
  }

  let semantic: Pack['semantic'];
  if (offset < buf.byteLength) {
    const semLen = dv.getUint32(offset, true);
    offset += 4;
    const semJson = dec.decode(new Uint8Array(buf, offset, semLen));
    offset += semLen;
    const sem = JSON.parse(semJson);

    const semBlobLen = dv.getUint32(offset, true);
    offset += 4;
    const semBlob = new Uint8Array(buf, offset, semBlobLen);
    semantic = parseSemanticSection(sem, semBlob);
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
  };
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
    if (isNodeRuntime() && isLikelyLocalPath(src)) {
      return await readLocalFileAsBuffer(src);
    }
    const res = await fetch(src);
    return await res.arrayBuffer();
  }
  if (src instanceof Uint8Array) {
    if (src.byteOffset === 0 && src.byteLength === src.buffer.byteLength) {
      return src.buffer as ArrayBuffer;
    }
    const copy = src.slice();
    return copy.buffer as ArrayBuffer;
  }
  return src as ArrayBuffer;
}

function isNodeRuntime(): boolean {
  return typeof process !== 'undefined' && !!process.versions?.node;
}

function isLikelyLocalPath(value: string): boolean {
  if (value.startsWith('file://')) return true;
  if (
    value.startsWith('./') ||
    value.startsWith('../') ||
    value.startsWith('/') ||
    value.startsWith('~')
  )
    return true;
  if (/^[A-Za-z]:[\\/]/.test(value)) return true; // Windows absolute path
  if (/^[A-Za-z][A-Za-z\d+.-]*:/.test(value)) return false; // URL scheme
  return true; // plain relative path like "knowledge.knolo"
}

async function readLocalFileAsBuffer(
  pathOrFileUrl: string
): Promise<ArrayBuffer> {
  const { readFile } = await import('node:fs/promises');
  const filePath = pathOrFileUrl.startsWith('file://')
    ? decodeURIComponent(new URL(pathOrFileUrl).pathname)
    : pathOrFileUrl;
  const data = await readFile(filePath);
  return data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);
}
