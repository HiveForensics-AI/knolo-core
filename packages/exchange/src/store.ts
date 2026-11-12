import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import * as path from 'node:path';
import { endpointPath } from './paths.js';

const SHA256 = /^[0-9a-f]{64}$/;
const ID = /^sha256-[0-9a-f]{64}$/;

export function blobPath(store: string, sha256: string): string {
  if (!SHA256.test(sha256)) throw new Error('Malformed V5 exchange sha256.');
  return path.join(store, 'blobs', `${sha256}.knolo`);
}

export function offerPath(store: string, offerId: string): string {
  if (!ID.test(offerId)) throw new Error('Malformed V5 exchange offer id.');
  return path.join(store, 'offers', `${offerId}.cbor`);
}

export function decisionPath(store: string, decisionId: string): string {
  if (!ID.test(decisionId))
    throw new Error('Malformed V5 exchange decision id.');
  return path.join(store, 'decisions', `${decisionId}.cbor`);
}

export function servedPath(store: string, decisionId: string): string {
  if (!ID.test(decisionId))
    throw new Error('Malformed V5 exchange decision id.');
  return path.join(store, 'served', `${decisionId}`);
}

export async function writeBytesAtomic(
  filePath: string,
  bytes: Uint8Array
): Promise<void> {
  await mkdir(path.dirname(filePath), { recursive: true });
  const temp = `${filePath}.${process.pid}.tmp`;
  await writeFile(temp, bytes);
  await rename(temp, filePath);
}

export async function readOfferFile(
  store: string,
  offerId: string
): Promise<Uint8Array> {
  return new Uint8Array(await readFile(offerPath(store, offerId)));
}

export async function readBlobFile(
  store: string,
  sha256: string
): Promise<Uint8Array> {
  return new Uint8Array(await readFile(blobPath(store, sha256)));
}

export async function writeEndpoint(store: string, url: string): Promise<void> {
  await writeBytesAtomic(
    endpointPath(store),
    new TextEncoder().encode(`${JSON.stringify({ url })}\n`)
  );
}

export async function readEndpoint(store: string): Promise<string> {
  const parsed = JSON.parse(
    await readFile(endpointPath(store), 'utf8')
  ) as unknown;
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    Array.isArray(parsed) ||
    typeof (parsed as { url?: unknown }).url !== 'string'
  ) {
    throw new Error('V5 exchange endpoint file is malformed.');
  }
  const url = (parsed as { url: string }).url;
  if (!url.startsWith('https://'))
    throw new Error('V5 exchange endpoint url must be https.');
  return url.replace(/\/$/, '');
}
