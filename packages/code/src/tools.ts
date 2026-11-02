import { createHash } from 'node:crypto';
import path from 'node:path';
import {
  packDigest,
  queryWithReceipt,
  verifyReceipt,
  type Pack,
} from '@knolo/core';
import { buildCodeImage, loadCodeImage, type CodePin } from './build.js';
import { asCodeImageError, CodeImageError } from './errors.js';
import type { CodeKind } from './scan.js';

export const TOKEN_ESTIMATOR = 'code-image-tokens-v1';
export const MAX_RESPONSE_BYTES = 16 * 1024;
const KINDS = new Set<CodeKind>([
  'structure',
  'class',
  'method',
  'function',
  'export',
]);

export type CodeToolChunk = {
  id: string;
  path: string;
  start: number;
  end: number;
  kind: CodeKind;
  name: string;
  text: string;
  byteStart?: number;
  byteEnd?: number;
};

export type CodeToolResult = {
  ok: true;
  tool: string;
  estimator: typeof TOKEN_ESTIMATOR;
  tokenEstimate: number;
  packDigest?: string;
  fileSha256?: string;
  built?: boolean;
  docs?: number;
  chunkers?: string[];
  truncated?: boolean;
  note?: string;
  chunks: CodeToolChunk[];
  receipt?: BlockReceipt | Record<string, unknown>;
};

export type CodeToolFailure = {
  ok: false;
  error: string;
  message: string;
};

export type BlockReceipt = {
  version: 'code-image-block-v1';
  packDigest: string;
  blockId: number;
  sourceDigest: string;
  id: string;
};

type QueryInput = {
  root?: string;
  query: string;
  topK?: number;
  path?: string;
  type?: CodeKind;
};

type ExpandInput = {
  root?: string;
  chunkId: string;
  start?: number;
  end?: number;
};

const cache = new Map<string, string>();

export function estimateTokens(text: string): number {
  return Math.ceil(Buffer.byteLength(text, 'utf8') / 4);
}

export async function codeImageStatus(
  root?: string
): Promise<CodeToolResult | CodeToolFailure> {
  try {
    const loaded = await loadCodeImage(resolveRoot(root));
    return baseResult('code_image_status', [], {
      built: true,
      packDigest: loaded.pin.packDigest,
      fileSha256: loaded.pin.fileSha256,
      docs: loaded.pin.docs,
      chunkers: loaded.pin.chunkers,
    });
  } catch (error) {
    if (error instanceof CodeImageError && error.code === 'CODE_NOT_BUILT') {
      return baseResult('code_image_status', [], { built: false });
    }
    return failure(error);
  }
}

export async function codeImageBuild(
  root?: string
): Promise<CodeToolResult | CodeToolFailure> {
  try {
    const pin = await buildCodeImage(resolveRoot(root));
    return pinResult('code_image_build', pin);
  } catch (error) {
    return failure(error);
  }
}

export async function codeImageQuery(
  input: QueryInput
): Promise<CodeToolResult | CodeToolFailure> {
  try {
    const loaded = await loadCodeImage(resolveRoot(input.root));
    const topK = input.topK ?? 5;
    if (!Number.isInteger(topK) || topK < 1 || topK > 20) {
      throw new CodeImageError(
        'CODE_QUERY',
        'topK must be an integer from 1 to 20.'
      );
    }
    if (input.type !== undefined && !KINDS.has(input.type)) {
      throw new CodeImageError('CODE_QUERY', 'type is not a code chunk kind.');
    }
    const key = cacheKey(loaded.pin.packDigest, 'code_image_query', {
      query: input.query,
      topK,
      path: input.path ?? null,
      type: input.type ?? null,
    });
    const cached = cache.get(key);
    if (cached) return JSON.parse(cached) as CodeToolResult;
    const queried = queryWithReceipt(loaded.pack, input.query, {
      topK,
      ...(input.type ? { namespace: input.type } : {}),
      ...(input.path ? { source: input.path } : {}),
      queryExpansion: { enabled: false },
      graph: { expand: false },
      semantic: { enabled: false },
    });
    try {
      verifyReceipt(queried.receipt, loaded.pack);
    } catch {
      throw new CodeImageError('CODE_RECEIPT', 'Receipt verification failed.');
    }
    const chunks = queried.hits.map((hit) =>
      chunkFromBlock(loaded.pack, hit.blockId)
    );
    const result = finish('code_image_query', chunks, {
      packDigest: loaded.pin.packDigest,
      receipt: queried.receipt,
    });
    cache.set(key, JSON.stringify(result));
    return result;
  } catch (error) {
    return failure(error);
  }
}

export async function codeImageStructure(
  pathOrSymbol: string,
  root?: string
): Promise<CodeToolResult | CodeToolFailure> {
  try {
    const loaded = await loadCodeImage(resolveRoot(root));
    const key = cacheKey(loaded.pin.packDigest, 'code_image_structure', {
      pathOrSymbol,
    });
    const cached = cache.get(key);
    if (cached) return JSON.parse(cached) as CodeToolResult;
    const structures = blocksOfKind(loaded.pack, 'structure');
    const exact = structures.find((chunk) => chunk.path === pathOrSymbol);
    const selected =
      exact ??
      structures
        .filter((chunk) => containsSymbol(chunk.text, pathOrSymbol))
        .sort((left, right) => compareText(left.path, right.path))[0];
    if (!selected) {
      throw new CodeImageError(
        'CODE_NOT_FOUND',
        'No structure block matches that path or symbol.'
      );
    }
    const result = finish('code_image_structure', [selected], {
      packDigest: loaded.pin.packDigest,
      receipt: blockReceipt(loaded.pack, selected),
    });
    cache.set(key, JSON.stringify(result));
    return result;
  } catch (error) {
    return failure(error);
  }
}

export async function codeImageExpand(
  input: ExpandInput
): Promise<CodeToolResult | CodeToolFailure> {
  try {
    const loaded = await loadCodeImage(resolveRoot(input.root));
    const key = cacheKey(loaded.pin.packDigest, 'code_image_expand', {
      chunkId: input.chunkId,
      start: input.start ?? null,
      end: input.end ?? null,
    });
    const cached = cache.get(key);
    if (cached) return JSON.parse(cached) as CodeToolResult;
    const found = findChunk(loaded.pack, input.chunkId);
    const receipt = blockReceipt(loaded.pack, found);
    verifyBlockReceipt(loaded.pack, receipt, found.text);
    let text = found.text;
    let byteStart: number | undefined;
    let byteEnd: number | undefined;
    if (input.start !== undefined || input.end !== undefined) {
      const start = input.start ?? 0;
      const end = input.end ?? Buffer.byteLength(found.text, 'utf8');
      text = sliceUtf8(found.text, start, end);
      byteStart = start;
      byteEnd = end;
    }
    const result = finish(
      'code_image_expand',
      [
        {
          ...found,
          text,
          ...(byteStart === undefined ? {} : { byteStart, byteEnd }),
        },
      ],
      { packDigest: loaded.pin.packDigest, receipt }
    );
    cache.set(key, JSON.stringify(result));
    return result;
  } catch (error) {
    return failure(error);
  }
}

export function failure(error: unknown): CodeToolFailure {
  const coded = asCodeImageError(error);
  return { ok: false, error: coded.code, message: coded.message };
}

function finish(
  tool: string,
  chunks: CodeToolChunk[],
  extra: { packDigest: string; receipt: BlockReceipt | Record<string, unknown> }
): CodeToolResult {
  const full = baseResult(tool, chunks, extra);
  const encoded = JSON.stringify(full);
  if (Buffer.byteLength(encoded, 'utf8') <= MAX_RESPONSE_BYTES) return full;
  const slim = baseResult(
    tool,
    chunks.map((chunk) => ({ ...chunk, text: '' })),
    {
      packDigest: extra.packDigest,
      truncated: true,
      note: 'Response exceeded 16 KiB. Call code_image_expand with one id.',
    }
  );
  if (Buffer.byteLength(JSON.stringify(slim), 'utf8') <= MAX_RESPONSE_BYTES) {
    return slim;
  }
  throw new CodeImageError(
    'CODE_RESPONSE_TOO_LARGE',
    'The code image response exceeded 16 KiB.'
  );
}

function baseResult(
  tool: string,
  chunks: CodeToolChunk[],
  extra: Partial<CodeToolResult> = {}
): CodeToolResult {
  const tokenEstimate = chunks.reduce(
    (sum, chunk) => sum + estimateTokens(chunk.text),
    0
  );
  return {
    ok: true,
    tool,
    estimator: TOKEN_ESTIMATOR,
    tokenEstimate,
    chunks,
    ...extra,
  };
}

function pinResult(tool: string, pin: CodePin): CodeToolResult {
  return baseResult(tool, [], {
    built: true,
    packDigest: pin.packDigest,
    fileSha256: pin.fileSha256,
    docs: pin.docs,
    chunkers: pin.chunkers,
  });
}

function blocksOfKind(pack: Pack, kind: CodeKind): CodeToolChunk[] {
  const chunks: CodeToolChunk[] = [];
  for (let blockId = 0; blockId < pack.blocks.length; blockId += 1) {
    const chunk = chunkFromBlock(pack, blockId);
    if (chunk.kind === kind) chunks.push(chunk);
  }
  return chunks;
}

function findChunk(pack: Pack, id: string): CodeToolChunk {
  for (let blockId = 0; blockId < pack.blocks.length; blockId += 1) {
    const chunk = chunkFromBlock(pack, blockId);
    if (chunk.id === id) return chunk;
  }
  throw new CodeImageError('CODE_NOT_FOUND', 'No chunk matches that id.');
}

function chunkFromBlock(pack: Pack, blockId: number): CodeToolChunk {
  const heading = pack.headings?.[blockId] ?? '';
  const parsed = parseHeading(heading);
  if (!parsed) {
    throw new CodeImageError(
      'CODE_RECEIPT',
      'A code image block is missing its heading.'
    );
  }
  return { ...parsed, text: pack.blocks[blockId] ?? '' };
}

function parseHeading(
  heading: string
): Omit<CodeToolChunk, 'text'> | undefined {
  const match =
    /^\[(structure\/[^\]]+|chunk\/[^\]]+)\] (structure|class|method|function|export) ([A-Za-z0-9_$]+) L(\d+)-L(\d+)$/u.exec(
      heading
    );
  if (!match) return undefined;
  const id = match[1] ?? '';
  const kind = match[2] as CodeKind;
  const path = id.startsWith('structure/')
    ? id.slice('structure/'.length)
    : id.slice('chunk/'.length, id.indexOf('#'));
  return {
    id,
    path,
    kind,
    name: match[3] ?? 'anon',
    start: Number(match[4]),
    end: Number(match[5]),
  };
}

function blockReceipt(pack: Pack, chunk: CodeToolChunk): BlockReceipt {
  const blockId = blockIdOf(pack, chunk.id);
  const docId = pack.docIds?.[blockId] ?? '';
  return {
    version: 'code-image-block-v1',
    packDigest: packDigest(pack),
    blockId,
    sourceDigest: sourceDigest(docId, pack.blocks[blockId] ?? ''),
    id: chunk.id,
  };
}

function verifyBlockReceipt(
  pack: Pack,
  receipt: BlockReceipt,
  text: string
): void {
  if (receipt.packDigest !== packDigest(pack)) {
    throw new CodeImageError('CODE_RECEIPT', 'Receipt verification failed.');
  }
  const docId = pack.docIds?.[receipt.blockId] ?? '';
  const block = pack.blocks[receipt.blockId] ?? '';
  if (receipt.sourceDigest !== sourceDigest(docId, block) || block !== text) {
    throw new CodeImageError('CODE_RECEIPT', 'Receipt verification failed.');
  }
}

function blockIdOf(pack: Pack, id: string): number {
  const headings = pack.headings ?? [];
  for (let index = 0; index < headings.length; index += 1) {
    if ((headings[index] ?? '').startsWith(`[${id}] `)) return index;
  }
  throw new CodeImageError('CODE_NOT_FOUND', 'No chunk matches that id.');
}

function sourceDigest(docId: string, text: string): string {
  return `sha256-${createHash('sha256').update(`${docId}\n${text}`, 'utf8').digest('hex')}`;
}

function sliceUtf8(text: string, start: number, end: number): string {
  if (!Number.isInteger(start) || !Number.isInteger(end)) {
    throw new CodeImageError(
      'CODE_RANGE',
      'The range must be integer byte offsets.'
    );
  }
  const bytes = Buffer.from(text, 'utf8');
  if (start < 0 || end < start || end > bytes.length) {
    throw new CodeImageError('CODE_RANGE', 'The range is outside the chunk.');
  }
  const sliced = bytes.subarray(start, end);
  const decoded = sliced.toString('utf8');
  if (!sliced.equals(Buffer.from(decoded, 'utf8'))) {
    throw new CodeImageError(
      'CODE_RANGE',
      'The range splits a UTF-8 code unit.'
    );
  }
  return decoded;
}

function containsSymbol(text: string, symbol: string): boolean {
  if (!symbol) return false;
  const escaped = symbol.replace(/[.*+?^${}()|[\]\\]/gu, '\\$&');
  return new RegExp(`(^|[^A-Za-z0-9_$])${escaped}([^A-Za-z0-9_$]|$)`, 'u').test(
    text
  );
}

function cacheKey(digest: string, tool: string, args: unknown): string {
  return `${digest}\n${tool}\n${canonicalJson(args)}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([left], [right]) => compareText(left, right)
    );
    return `{${entries
      .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
      .join(',')}}`;
  }
  return JSON.stringify(value) ?? 'null';
}

function resolveRoot(root: string | undefined): string {
  return path.resolve(root ?? process.cwd());
}

function compareText(left: string, right: string): number {
  if (left < right) return -1;
  if (left > right) return 1;
  return 0;
}
