import { createServer } from 'node:https';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { isIP } from 'node:net';
import {
  createKnowledgeExchangeReceiptV1,
  decodeKnowledgeExchangeDecisionV1,
  decodeKnowledgeExchangeOfferV1,
  encodeKnowledgeExchangeReceiptV1,
  signKnowledgeExchangeReceiptWithEd25519,
  verifyKnowledgeExchangeDecisionWithEd25519,
  verifyKnowledgeExchangeOfferWithEd25519,
  type KnowledgeExchangeDecisionV1,
  type KnowledgeExchangeOfferV1,
} from '@knolo/core';
import type { ExchangeConfig } from './config.js';
import { loadExchangeIdentity, type ExchangeIdentity } from './identity.js';
import { knoloHome, receiptPath } from './paths.js';
import {
  blobPath,
  decisionPath,
  offerPath,
  readOfferFile,
  servedPath,
  writeBytesAtomic,
  writeEndpoint,
} from './store.js';

export type ExchangeServer = { url: string; close: () => Promise<void> };

export type ExchangeServerOptions = {
  homeDir?: string;
  now?: () => number;
  truncateAfter?: number;
};

class HttpFailure extends Error {
  constructor(
    readonly status: number,
    message: string,
    readonly code: string
  ) {
    super(message);
  }
}

export async function startExchangeServer(
  config: ExchangeConfig,
  options: ExchangeServerOptions = {}
): Promise<ExchangeServer> {
  const identity = await loadExchangeIdentity(config);
  const now = options.now ?? (() => Date.now());
  const homeDir = options.homeDir ?? knoloHome();
  const cert = readFileSync(config.tls.certPath);
  const key = readFileSync(config.tls.keyPath);
  const server = createServer({ cert, key }, (request, response) => {
    void handle(
      config,
      identity,
      homeDir,
      now,
      options.truncateAfter,
      request,
      response
    ).catch((error: unknown) => {
      const failure = asFailure(error);
      sendJson(response, failure.status, {
        error: failure.message,
        code: failure.code,
      });
    });
  });
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject);
    server.listen(config.listen.port, config.listen.host, () => resolve());
  });
  const address = server.address();
  if (!address || typeof address === 'string')
    throw new Error('V5 exchange server did not bind a port.');
  const host = endpointHost(config.listen.host);
  const url = `https://${host}:${address.port}`;
  await writeEndpoint(config.storePath, url);
  return {
    url,
    close: () =>
      new Promise((resolve, reject) => {
        server.closeAllConnections();
        server.close((error) => (error ? reject(error) : resolve()));
      }),
  };
}

async function handle(
  config: ExchangeConfig,
  identity: ExchangeIdentity,
  homeDir: string,
  now: () => number,
  truncateAfter: number | undefined,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const url = new URL(request.url ?? '/', 'https://exchange.local');
  const offerMatch = /^\/v1\/offers\/(sha256-[0-9a-f]{64})$/.exec(url.pathname);
  const decisionMatch = /^\/v1\/offers\/(sha256-[0-9a-f]{64})\/decision$/.exec(
    url.pathname
  );
  const blobMatch = /^\/v1\/blobs\/([0-9a-f]{64})$/.exec(url.pathname);
  if (request.method === 'POST' && url.pathname === '/v1/offers') {
    assertAdmin(config, request);
    const body = await readBody(request, 1024 * 1024);
    const offer = decodeKnowledgeExchangeOfferV1(body);
    await verifyKnowledgeExchangeOfferWithEd25519(
      offer,
      identity.keyring,
      now(),
      globalThis.crypto
    );
    if (offer.sender !== config.identity.principal)
      throw new HttpFailure(
        403,
        'V5 exchange offer sender is not this host.',
        'unauthorized-recipient'
      );
    await assertBlob(config.storePath, offer);
    await writeBytesAtomic(offerPath(config.storePath, offer.offerId), body);
    sendJson(response, 201, { offerId: offer.offerId });
    return;
  }
  if (request.method === 'GET' && offerMatch) {
    sendBytes(
      response,
      200,
      'application/cbor',
      await readOfferFile(config.storePath, offerMatch[1])
    );
    return;
  }
  if (request.method === 'POST' && decisionMatch) {
    const offer = decodeKnowledgeExchangeOfferV1(
      await readOfferFile(config.storePath, decisionMatch[1])
    );
    const body = await readBody(request, 1024 * 1024);
    const decision = decodeKnowledgeExchangeDecisionV1(body);
    await verifyDecision(identity, offer, decision, now());
    if (decision.offerId !== offer.offerId)
      throw new HttpFailure(
        400,
        'V5 exchange decision offer binding mismatch.',
        'binding'
      );
    await writeBytesAtomic(
      decisionPath(config.storePath, decision.decisionId),
      body
    );
    sendJson(response, 200, { decisionId: decision.decisionId });
    return;
  }
  if (request.method === 'GET' && blobMatch) {
    await sendBlob(
      config,
      identity,
      homeDir,
      now,
      truncateAfter,
      blobMatch[1],
      request,
      response
    );
    return;
  }
  throw new HttpFailure(404, 'V5 exchange route was not found.', 'not_found');
}

async function sendBlob(
  config: ExchangeConfig,
  identity: ExchangeIdentity,
  homeDir: string,
  now: () => number,
  truncateAfter: number | undefined,
  sha256: string,
  request: IncomingMessage,
  response: ServerResponse
): Promise<void> {
  const header = request.headers['knolo-decision'];
  if (typeof header !== 'string' || !header)
    throw new HttpFailure(
      401,
      'V5 exchange decision is required.',
      'unauthenticated'
    );
  const decisionBytes = Buffer.from(header, 'base64url');
  const decision = decodeKnowledgeExchangeDecisionV1(
    new Uint8Array(decisionBytes)
  );
  const offer = decodeKnowledgeExchangeOfferV1(
    await readOfferFile(config.storePath, decision.offerId)
  );
  await verifyDecision(identity, offer, decision, now());
  if (decision.decision !== 'accept')
    throw new HttpFailure(
      403,
      'V5 exchange decision is not an acceptance.',
      'rejected'
    );
  if (offer.sha256 !== sha256)
    throw new HttpFailure(
      400,
      'V5 exchange artifact digest mismatch.',
      'digest-mismatch'
    );
  if (existsSync(servedPath(config.storePath, decision.decisionId)))
    throw new HttpFailure(409, 'V5 exchange replay detected.', 'replay');
  const bytes = new Uint8Array(
    await readFile(blobPath(config.storePath, sha256))
  );
  if (bytes.length !== offer.sizeBytes)
    throw new HttpFailure(
      400,
      'V5 exchange artifact size mismatch.',
      'size-mismatch'
    );
  if (createHash('sha256').update(bytes).digest('hex') !== sha256) {
    throw new HttpFailure(
      400,
      'V5 exchange artifact digest mismatch.',
      'digest-mismatch'
    );
  }
  const range = parseRange(request.headers.range, bytes.length);
  const slice = bytes.subarray(range.start, range.end + 1);
  const full = range.start === 0 && range.end === bytes.length - 1;
  const truncated = truncateAfter !== undefined && slice.length > truncateAfter;
  const payload = truncated ? slice.subarray(0, truncateAfter) : slice;
  if (full && !truncated) {
    await writeSenderReceipt(config, identity, homeDir, now, offer, decision);
  }
  response.writeHead(
    full && !truncated ? 200 : 206,
    contentHeaders(full && !truncated, bytes.length, range, payload.length)
  );
  response.end(Buffer.from(payload));
}

async function verifyDecision(
  identity: ExchangeIdentity,
  offer: KnowledgeExchangeOfferV1,
  decision: KnowledgeExchangeDecisionV1,
  now: number
): Promise<void> {
  try {
    await verifyKnowledgeExchangeDecisionWithEd25519(
      offer,
      decision,
      identity.keyring,
      now,
      globalThis.crypto
    );
  } catch (error) {
    throw mapCoreError(error);
  }
}

async function assertBlob(
  store: string,
  offer: KnowledgeExchangeOfferV1
): Promise<void> {
  const file = blobPath(store, offer.sha256);
  if (!existsSync(file))
    throw new HttpFailure(
      404,
      'V5 exchange artifact is not in the store.',
      'not_found'
    );
  const bytes = await readFile(file);
  if (bytes.length !== offer.sizeBytes)
    throw new HttpFailure(
      400,
      'V5 exchange artifact size mismatch.',
      'size-mismatch'
    );
  if (createHash('sha256').update(bytes).digest('hex') !== offer.sha256)
    throw new HttpFailure(
      400,
      'V5 exchange artifact digest mismatch.',
      'digest-mismatch'
    );
}

function endpointHost(host: string): string {
  if (host === '0.0.0.0') return '127.0.0.1';
  return isIP(host) === 6 ? `[${host}]` : host;
}

async function writeSenderReceipt(
  config: ExchangeConfig,
  identity: ExchangeIdentity,
  homeDir: string,
  now: () => number,
  offer: KnowledgeExchangeOfferV1,
  decision: KnowledgeExchangeDecisionV1
): Promise<void> {
  // A failed receipt must leave the decision reusable, so the served marker
  // is written only after the receipt is durable.
  const receipt = await signKnowledgeExchangeReceiptWithEd25519(
    createKnowledgeExchangeReceiptV1({
      offer,
      role: 'sender',
      decision: 'accept',
      verification: 'verified',
      policy: 'serve',
      algorithm: 'Ed25519',
      keyId: config.identity.keyId,
      ...(identity.keyring.keyringRoot === undefined
        ? {}
        : { keyringRoot: identity.keyring.keyringRoot }),
      nonce: randomNonce(),
      issuedAt: now(),
      expiresAt: decision.expiresAt,
    }),
    identity.privateKey,
    globalThis.crypto
  );
  await writeBytesAtomic(
    receiptPath(homeDir, receipt.receiptId),
    encodeKnowledgeExchangeReceiptV1(receipt)
  );
  await writeBytesAtomic(
    servedPath(config.storePath, decision.decisionId),
    new Uint8Array()
  );
}

function assertAdmin(config: ExchangeConfig, request: IncomingMessage): void {
  const remote = request.socket.remoteAddress;
  const loopback =
    remote === '127.0.0.1' || remote === '::1' || remote === '::ffff:127.0.0.1';
  if (loopback) return;
  const header = request.headers.authorization;
  if (config.adminToken && header === `Bearer ${config.adminToken}`) return;
  throw new HttpFailure(
    401,
    'V5 exchange offer publication is local.',
    'unauthenticated'
  );
}

function parseRange(
  header: string | string[] | undefined,
  size: number
): { start: number; end: number } {
  if (header === undefined) return { start: 0, end: size - 1 };
  const value = Array.isArray(header) ? header[0] : header;
  const match = /^bytes=(\d+)-(\d*)$/.exec(value);
  if (!match)
    throw new HttpFailure(416, 'V5 exchange range is malformed.', 'range');
  const start = Number(match[1]);
  const end = match[2] ? Number(match[2]) : size - 1;
  if (
    !Number.isInteger(start) ||
    !Number.isInteger(end) ||
    start < 0 ||
    end < start ||
    end >= size
  ) {
    throw new HttpFailure(416, 'V5 exchange range is malformed.', 'range');
  }
  return { start, end };
}

function contentHeaders(
  full: boolean,
  total: number,
  range: { start: number; end: number },
  length: number
): Record<string, string> {
  return {
    'content-type': 'application/octet-stream',
    'content-length': String(length),
    'accept-ranges': 'bytes',
    ...(full
      ? {}
      : {
          'content-range': `bytes ${range.start}-${range.start + length - 1}/${total}`,
        }),
  };
}

function readBody(
  request: IncomingMessage,
  limit: number
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    request.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > limit) {
        reject(
          new HttpFailure(
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
  response.end(bytes);
}

function asFailure(error: unknown): HttpFailure {
  if (error instanceof HttpFailure) return error;
  if (
    error &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: string }).code === 'ENOENT'
  ) {
    return new HttpFailure(
      404,
      'V5 exchange object was not found.',
      'not_found'
    );
  }
  return mapCoreError(error);
}

function mapCoreError(error: unknown): HttpFailure {
  const message =
    error instanceof Error ? error.message : 'V5 exchange request failed.';
  if (/replay/i.test(message)) return new HttpFailure(409, message, 'replay');
  if (/validity window|expired/i.test(message))
    return new HttpFailure(410, message, 'expired');
  if (/revoked/i.test(message))
    return new HttpFailure(401, message, 'revoked-key');
  if (/recipient mismatch|not an acceptance/i.test(message))
    return new HttpFailure(403, message, 'unauthorized-recipient');
  if (/signature|keyring/i.test(message))
    return new HttpFailure(401, message, 'signature');
  return new HttpFailure(400, message, 'invalid_body');
}

function randomNonce(): Uint8Array {
  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  return bytes;
}
