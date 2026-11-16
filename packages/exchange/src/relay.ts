import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readdir, readFile, rm, stat } from 'node:fs/promises';
import { createServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { isIP } from 'node:net';
import * as path from 'node:path';
import {
  decodeKnowledgeExchangeDecisionV1,
  decodeKnowledgeExchangeOfferV1,
  KNOWLEDGE_EXCHANGE_MAX_WIRE_BYTES_V1,
  type KnowledgeExchangeOfferV1,
} from '@knolo/core';
import {
  blobPath,
  decisionPath,
  offerPath,
  readBlobFile,
  readOfferFile,
  writeBytesAtomic,
} from './store.js';

const KEY_ID = /^[\x21-\x7e]{1,256}$/;
const UPLOAD_GRACE_MS = 30_000;

export type RelayConfig = {
  configPath: string;
  listen: { host: string; port: number };
  tls: { certPath: string; keyPath: string };
  storePath: string;
  maxBytes: number;
  retentionMs: number;
  senders: string[];
};

export type RelayServer = {
  url: string;
  close: () => Promise<void>;
};

export function loadRelayConfig(configPath: string): RelayConfig {
  const absolute = path.resolve(configPath);
  const raw = JSON.parse(readFileSync(absolute, 'utf8')) as unknown;
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    throw new Error('V5 exchange relay config must be a JSON object.');
  }
  const record = raw as Record<string, unknown>;
  const base = path.dirname(absolute);
  const tls = asRecord(record.tls, 'tls');
  const senders = asStringArray(record.senders, 'senders');
  if (
    senders.length === 0 ||
    senders.some((sender) => !KEY_ID.test(sender))
  ) {
    throw new Error('V5 exchange relay senders must list offer key ids.');
  }
  const listen = parseListen(asString(record.listen, 'listen'));
  return {
    configPath: absolute,
    listen,
    tls: {
      certPath: path.resolve(base, asString(tls.cert, 'tls.cert')),
      keyPath: path.resolve(base, asString(tls.key, 'tls.key')),
    },
    storePath: path.resolve(base, asString(record.store, 'store')),
    maxBytes: asNonNegative(record.maxBytes, 'maxBytes', 1),
    retentionMs: asNonNegative(record.retentionMs, 'retentionMs', 0),
    senders,
  };
}

export async function startExchangeRelay(
  config: RelayConfig,
  options: { now?: () => number } = {}
): Promise<RelayServer> {
  const now = options.now ?? (() => Date.now());
  const pending = new Map<string, number>();
  const cert = readFileSync(config.tls.certPath);
  const key = readFileSync(config.tls.keyPath);
  const server = createServer({ cert, key }, (request, response) => {
    void handle(config, now, pending, request, response).catch(
      (error: unknown) => {
        const failure = asFailure(error);
        const bytes = Buffer.from(
          JSON.stringify({ error: failure.message, code: failure.code })
        );
        response.writeHead(failure.status, {
          'content-type': 'application/json',
          'content-length': String(bytes.length),
          'cache-control': 'no-store',
        });
        response.end(bytes);
      }
    );
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.listen.port, config.listen.host, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('V5 exchange relay did not bind a port.');
  }
  const host = endpointHost(config.listen.host);
  return {
    url: `https://${host}:${address.port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

class RelayFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}

async function handle(
  config: RelayConfig,
  now: () => number,
  pending: Map<string, number>,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  await sweepRelay(config, now(), pending);
  const url = new URL(request.url ?? '/', 'https://relay.local');
  const offerMatch = /^\/v1\/offers\/(sha256-[0-9a-f]{64})$/.exec(url.pathname);
  const decisionMatch = /^\/v1\/offers\/(sha256-[0-9a-f]{64})\/decision$/.exec(
    url.pathname
  );
  const blobMatch = /^\/v1\/blobs\/([0-9a-f]{64})$/.exec(url.pathname);
  if (request.method === 'PUT' && blobMatch) {
    await storeBlob(config, blobMatch[1], pending, request, response);
    return;
  }
  if (request.method === 'POST' && url.pathname === '/v1/offers') {
    await storeOffer(config, now(), request, response);
    return;
  }
  if (request.method === 'GET' && offerMatch) {
    const bytes = await readOfferFile(config.storePath, offerMatch[1]);
    sendBytes(response, 200, 'application/cbor', bytes);
    return;
  }
  if (request.method === 'POST' && decisionMatch) {
    await storeDecision(config, decisionMatch[1], request, response);
    return;
  }
  if (request.method === 'GET' && blobMatch) {
    await sendBlob(config, blobMatch[1], request, response);
    return;
  }
  throw new RelayFailure(404, 'V5 exchange route was not found.', 'not_found');
}

async function storeBlob(
  config: RelayConfig,
  sha256: string,
  pending: Map<string, number>,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const bytes = await readBody(request, config.maxBytes);
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
    throw new RelayFailure(
      400,
      'V5 exchange artifact digest mismatch.',
      'digest-mismatch'
    );
  }
  const file = blobPath(config.storePath, sha256);
  if (existsSync(file)) {
    const current = await readFile(file);
    if (!current.equals(Buffer.from(bytes))) {
      throw new RelayFailure(
        409,
        'V5 exchange relay already holds different bytes for this digest.',
        'digest-mismatch'
      );
    }
  } else {
    await writeBytesAtomic(file, bytes);
  }
  pending.set(sha256, Date.now());
  sendJson(response, 201, { sha256 });
}

async function storeOffer(
  config: RelayConfig,
  now: number,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const bytes = await readBody(request, KNOWLEDGE_EXCHANGE_MAX_WIRE_BYTES_V1);
  // Decode checks the CBOR shape. The relay does not check the signature.
  const offer = decodeOffer(bytes);
  await acceptOffer(config, now, offer, bytes, response);
}

async function acceptOffer(
  config: RelayConfig,
  now: number,
  offer: KnowledgeExchangeOfferV1,
  bytes: Uint8Array,
  response: ServerResponse
): Promise<void> {
  if (!offer.keyId || !config.senders.includes(offer.keyId)) {
    throw new RelayFailure(
      403,
      'V5 exchange relay sender is not allowed.',
      'unauthorized-sender'
    );
  }
  if (offer.sizeBytes > config.maxBytes) {
    throw new RelayFailure(
      413,
      'V5 exchange body exceeds the size limit.',
      'oversized'
    );
  }
  if (now >= offer.expiresAt) {
    throw new RelayFailure(
      410,
      'V5 exchange offer is outside its validity window.',
      'expired'
    );
  }
  const blob = blobPath(config.storePath, offer.sha256);
  if (!existsSync(blob)) {
    throw new RelayFailure(
      404,
      'V5 exchange artifact is not in the store.',
      'not_found'
    );
  }
  const stored = await readFile(blob);
  if (
    stored.length !== offer.sizeBytes ||
    createHash('sha256').update(stored).digest('hex') !== offer.sha256
  ) {
    throw new RelayFailure(
      400,
      'V5 exchange artifact digest mismatch.',
      'digest-mismatch'
    );
  }
  await writeBytesAtomic(offerPath(config.storePath, offer.offerId), bytes);
  sendJson(response, 201, { offerId: offer.offerId });
}

async function storeDecision(
  config: RelayConfig,
  offerId: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const bytes = await readBody(request, KNOWLEDGE_EXCHANGE_MAX_WIRE_BYTES_V1);
  let decision;
  try {
    decision = decodeKnowledgeExchangeDecisionV1(bytes);
  } catch (error) {
    throw new RelayFailure(
      400,
      error instanceof Error ? error.message : 'V5 exchange decision is malformed.',
      'malformed'
    );
  }
  if (decision.offerId !== offerId || decision.decision !== 'accept') {
    throw new RelayFailure(
      400,
      'V5 exchange decision offer binding mismatch.',
      'binding'
    );
  }
  if (!existsSync(offerPath(config.storePath, offerId))) {
    throw new RelayFailure(
      404,
      'V5 exchange object was not found.',
      'not_found'
    );
  }
  await writeBytesAtomic(
    decisionPath(config.storePath, decision.decisionId),
    bytes
  );
  sendJson(response, 200, { decisionId: decision.decisionId });
}

async function sendBlob(
  config: RelayConfig,
  sha256: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const header = request.headers['knolo-decision'];
  if (typeof header !== 'string' || !header) {
    throw new RelayFailure(
      401,
      'V5 exchange decision is required.',
      'unauthenticated'
    );
  }
  let decision;
  try {
    decision = decodeKnowledgeExchangeDecisionV1(
      new Uint8Array(Buffer.from(header, 'base64url'))
    );
  } catch (error) {
    throw new RelayFailure(
      400,
      error instanceof Error ? error.message : 'V5 exchange decision is malformed.',
      'malformed'
    );
  }
  if (decision.decision !== 'accept') {
    throw new RelayFailure(
      403,
      'V5 exchange decision is not an acceptance.',
      'rejected'
    );
  }
  const offer = decodeOffer(await readOfferFile(config.storePath, decision.offerId));
  if (offer.sha256 !== sha256 || offer.offerId !== decision.offerId) {
    throw new RelayFailure(
      400,
      'V5 exchange artifact digest mismatch.',
      'digest-mismatch'
    );
  }
  const bytes = await readBlobFile(config.storePath, sha256);
  const range = parseRange(request.headers.range, bytes.length);
  const slice = bytes.subarray(range.start, range.end + 1);
  const full = range.start === 0 && range.end === bytes.length - 1;
  response.writeHead(full ? 200 : 206, {
    'content-type': 'application/octet-stream',
    'content-length': String(slice.length),
    'accept-ranges': 'bytes',
    'cache-control': 'no-store',
    ...(full
      ? {}
      : {
          'content-range': `bytes ${range.start}-${range.end}/${bytes.length}`,
        }),
  });
  response.end(Buffer.from(slice));
}

export async function sweepRelay(
  config: RelayConfig,
  now: number,
  pending?: ReadonlyMap<string, number>
): Promise<void> {
  const offersDir = path.join(config.storePath, 'offers');
  const names = await readNames(offersDir);
  const referenced = new Set<string>();
  const dropped = new Set<string>();
  for (const name of names) {
    if (!name.endsWith('.cbor')) continue;
    const file = path.join(offersDir, name);
    let offer: KnowledgeExchangeOfferV1;
    try {
      offer = decodeOffer(new Uint8Array(await readFile(file)));
    } catch {
      await rm(file, { force: true });
      continue;
    }
    if (now >= offer.expiresAt + config.retentionMs) {
      dropped.add(offer.sha256);
      await rm(file, { force: true });
      continue;
    }
    referenced.add(offer.sha256);
  }
  for (const sha256 of dropped) {
    if (!referenced.has(sha256)) {
      await rm(blobPath(config.storePath, sha256), { force: true });
    }
  }
  const blobsDir = path.join(config.storePath, 'blobs');
  for (const name of await readNames(blobsDir)) {
    if (!name.endsWith('.knolo')) continue;
    const sha256 = name.slice(0, -'.knolo'.length);
    if (referenced.has(sha256)) continue;
    const uploadedAt = pending?.get(sha256);
    if (
      uploadedAt !== undefined &&
      Date.now() - uploadedAt < UPLOAD_GRACE_MS
    ) {
      continue;
    }
    const file = path.join(blobsDir, name);
    let mtime = 0;
    try {
      mtime = (await stat(file)).mtimeMs;
    } catch {
      continue;
    }
    if (mtime <= now - config.retentionMs) await rm(file, { force: true });
  }
}

function decodeOffer(bytes: Uint8Array): KnowledgeExchangeOfferV1 {
  try {
    return decodeKnowledgeExchangeOfferV1(bytes);
  } catch (error) {
    throw new RelayFailure(
      400,
      error instanceof Error ? error.message : 'V5 exchange offer is malformed.',
      'malformed'
    );
  }
}

function readBody(request: IncomingMessage, limit: number): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(
          new RelayFailure(
            413,
            'V5 exchange body exceeds the size limit.',
            'oversized'
          )
        );
        request.destroy();
        return;
      }
      chunks.push(chunk);
    });
    request.on('end', () => resolve(new Uint8Array(Buffer.concat(chunks))));
    request.on('error', reject);
  });
}

function parseRange(
  header: string | string[] | undefined,
  size: number
): { start: number; end: number } {
  if (header === undefined) return { start: 0, end: size - 1 };
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value ?? '');
  if (!match) {
    throw new RelayFailure(416, 'V5 exchange range is malformed.', 'range');
  }
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end >= size
  ) {
    throw new RelayFailure(416, 'V5 exchange range is malformed.', 'range');
  }
  return { start, end };
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown
): void {
  const bytes = Buffer.from(JSON.stringify(body));
  response.writeHead(status, {
    'content-type': 'application/json',
    'content-length': String(bytes.length),
    'cache-control': 'no-store',
  });
  response.end(bytes);
}

function sendBytes(
  response: ServerResponse,
  status: number,
  type: string,
  bytes: Uint8Array
): void {
  response.writeHead(status, {
    'content-type': type,
    'content-length': String(bytes.length),
    'cache-control': 'no-store',
  });
  response.end(Buffer.from(bytes));
}

function asFailure(error: unknown): RelayFailure {
  if (error instanceof RelayFailure) return error;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  ) {
    return new RelayFailure(
      404,
      'V5 exchange object was not found.',
      'not_found'
    );
  }
  const message =
    error instanceof Error ? error.message : 'V5 exchange request failed.';
  return new RelayFailure(400, message, 'malformed');
}

async function readNames(directory: string): Promise<string[]> {
  try {
    return await readdir(directory);
  } catch (error) {
    if (
      error &&
      typeof error === 'object' &&
      'code' in error &&
      (error as { code?: string }).code === 'ENOENT'
    ) {
      return [];
    }
    throw error;
  }
}

function endpointHost(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1';
  return isIP(host) === 6 ? `[${host}]` : host;
}

function parseListen(value: string): { host: string; port: number } {
  const match = /^(127\.0\.0\.1|::1|0\.0\.0\.0):(\d+)$/.exec(value);
  if (!match) {
    throw new Error(
      'V5 exchange relay listen must be 127.0.0.1, ::1, or 0.0.0.0 with a port.'
    );
  }
  const port = Number(match[2]);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error('V5 exchange relay listen port is invalid.');
  }
  return { host: match[1], port };
}

function asRecord(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`V5 exchange relay ${label} must be an object.`);
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown, label: string): string {
  if (typeof value !== 'string' || !value) {
    throw new Error(`V5 exchange relay ${label} must be a string.`);
  }
  return value;
}

function asStringArray(value: unknown, label: string): string[] {
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string')) {
    throw new Error(`V5 exchange relay ${label} must be an array of strings.`);
  }
  return value as string[];
}

function asNonNegative(value: unknown, label: string, minimum: number): number {
  if (
    typeof value !== 'number' ||
    !Number.isSafeInteger(value) ||
    value < minimum
  ) {
    throw new Error(
      `V5 exchange relay ${label} must be an integer of at least ${minimum}.`
    );
  }
  return value;
}
