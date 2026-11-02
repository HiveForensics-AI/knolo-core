import { createHash } from 'node:crypto';
import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import {
  buildPack,
  mountPackFromBuffer,
  packDigest,
  type Pack,
} from '@knolo/core';
import { CodeImageError } from './errors.js';
import {
  PYTHON_CHUNKER,
  scanWorkspace,
  typescriptChunkerId,
  type CodeChunk,
} from './scan.js';

export const PACK_NAME = 'workspace.knolo';
export const PIN_NAME = 'workspace.pin.json';

export type CodePin = {
  version: 1;
  fileSha256: string;
  packDigest: string;
  docs: number;
  chunkers: string[];
};

export type LoadedCodeImage = {
  root: string;
  pack: Pack;
  pin: CodePin;
  chunksByHeading: Map<number, string>;
};

export async function buildCodeImage(root: string): Promise<CodePin> {
  const resolved = path.resolve(root);
  const chunks = await scanWorkspace(resolved);
  const bytes = await buildPack(
    chunks.map((chunk) => ({
      id: chunk.path,
      heading: headingFor(chunk),
      namespace: chunk.kind,
      text: chunk.text,
    })),
    { format: 4, graph: { enabled: false } }
  );
  const pin: CodePin = {
    version: 1,
    fileSha256: sha256(bytes),
    packDigest: packDigest(mountBytes(bytes)),
    docs: chunks.length,
    chunkers: [PYTHON_CHUNKER, typescriptChunkerId()].sort(),
  };
  const directory = path.join(resolved, '.knolo');
  await mkdir(directory, { recursive: true });
  await writeAtomic(path.join(directory, PACK_NAME), bytes);
  await writeAtomic(
    path.join(directory, PIN_NAME),
    Buffer.from(`${JSON.stringify(pin, null, 2)}\n`, 'utf8')
  );
  return pin;
}

export async function loadCodeImage(root: string): Promise<LoadedCodeImage> {
  const resolved = path.resolve(root);
  const directory = path.join(resolved, '.knolo');
  let packBytes: Buffer;
  let pinBytes: Buffer;
  try {
    [packBytes, pinBytes] = await Promise.all([
      readFile(path.join(directory, PACK_NAME)),
      readFile(path.join(directory, PIN_NAME)),
    ]);
  } catch (error) {
    if (isNotFound(error)) {
      throw new CodeImageError(
        'CODE_NOT_BUILT',
        'No code image pin exists for this workspace.'
      );
    }
    throw new CodeImageError(
      'CODE_IMAGE_FAILED',
      'The code image request failed.'
    );
  }
  const pin = parsePin(pinBytes.toString('utf8'));
  const fileSha256 = sha256(packBytes);
  if (fileSha256 !== pin.fileSha256) {
    throw new CodeImageError(
      'CODE_PIN_MISMATCH',
      'The code image bytes do not match the pin.'
    );
  }
  let pack: Pack;
  try {
    pack = mountBytes(packBytes);
  } catch {
    throw new CodeImageError(
      'CODE_PACK_INVALID',
      'The code image could not be mounted.'
    );
  }
  if (packDigest(pack) !== pin.packDigest) {
    throw new CodeImageError(
      'CODE_PIN_MISMATCH',
      'The code image digest does not match the pin.'
    );
  }
  return { root: resolved, pack, pin, chunksByHeading: new Map() };
}

export function headingFor(chunk: CodeChunk): string {
  return `[${chunk.id}] ${chunk.kind} ${chunk.name} L${chunk.start}-L${chunk.end}`;
}

export function sha256(bytes: Uint8Array): string {
  return `sha256-${createHash('sha256').update(bytes).digest('hex')}`;
}

function mountBytes(bytes: Uint8Array): Pack {
  const copy = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(copy).set(bytes);
  return mountPackFromBuffer(copy);
}

function parsePin(text: string): CodePin {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch {
    throw new CodeImageError(
      'CODE_PIN_MISMATCH',
      'The code image pin is not JSON.'
    );
  }
  if (!value || typeof value !== 'object') {
    throw new CodeImageError(
      'CODE_PIN_MISMATCH',
      'The code image pin is unreadable.'
    );
  }
  const pin = value as Partial<CodePin>;
  if (
    pin.version !== 1 ||
    typeof pin.fileSha256 !== 'string' ||
    typeof pin.packDigest !== 'string' ||
    typeof pin.docs !== 'number' ||
    !Array.isArray(pin.chunkers)
  ) {
    throw new CodeImageError(
      'CODE_PIN_MISMATCH',
      'The code image pin is incomplete.'
    );
  }
  return {
    version: 1,
    fileSha256: pin.fileSha256,
    packDigest: pin.packDigest,
    docs: pin.docs,
    chunkers: pin.chunkers.filter((entry) => typeof entry === 'string'),
  };
}

async function writeAtomic(filePath: string, bytes: Uint8Array): Promise<void> {
  const temporary = `${filePath}.tmp`;
  await writeFile(temporary, bytes);
  await rename(temporary, filePath);
}

function isNotFound(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}
