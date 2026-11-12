import type { IncomingMessage } from 'node:http';
import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import type { RequestOptions } from 'node:https';
import { isIP } from 'node:net';
import { KNOWLEDGE_EXCHANGE_MAX_WIRE_BYTES_V1 } from '@knolo/core';

export type HttpResult = {
  status: number;
  headers: Record<string, string | string[] | undefined>;
  body: Uint8Array;
};

export async function httpsJson(
  url: string,
  options: {
    method: string;
    body?: Uint8Array;
    headers?: Record<string, string>;
    caPath?: string;
    range?: string;
  }
): Promise<HttpResult> {
  const target = new URL(url);
  const hostname = requestHostname(target.hostname);
  const ca = options.caPath ? readFileSync(options.caPath) : undefined;
  const requestOptions: RequestOptions = {
    protocol: target.protocol,
    hostname,
    port: target.port,
    path: `${target.pathname}${target.search}`,
    method: options.method,
    headers: {
      ...(options.body
        ? { 'content-length': String(options.body.length) }
        : {}),
      ...(options.range ? { range: options.range } : {}),
      ...options.headers,
    },
    ...(ca ? { ca } : {}),
    ...tlsServerName(hostname),
    agent: false,
  };
  return new Promise((resolve, reject) => {
    let settled = false;
    let limited = false;
    const fail = (error: Error) => {
      if (settled) return;
      settled = true;
      reject(error);
    };
    const succeed = (result: HttpResult) => {
      if (settled) return;
      settled = true;
      resolve(result);
    };
    const req = httpsRequest(requestOptions, (response) => {
      readLimitedBody(response, KNOWLEDGE_EXCHANGE_MAX_WIRE_BYTES_V1, () => {
        limited = true;
      }).then(
        (body) =>
          succeed({
            status: response.statusCode ?? 0,
            headers: response.headers,
            body,
          }),
        (error: unknown) => {
          limited = true;
          fail(error instanceof Error ? error : new Error(String(error)));
          req.destroy();
        }
      );
    });
    req.on('error', (error) => {
      if (limited) return;
      fail(error);
    });
    if (options.body) req.write(Buffer.from(options.body));
    req.end();
  });
}

export function readLimitedBody(
  response: IncomingMessage,
  limit = KNOWLEDGE_EXCHANGE_MAX_WIRE_BYTES_V1,
  onLimit?: () => void
): Promise<Uint8Array> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    let settled = false;
    const finish = (error?: Error, body?: Uint8Array) => {
      if (settled) return;
      settled = true;
      if (error) reject(error);
      else resolve(body ?? new Uint8Array());
    };
    response.on('data', (chunk: Buffer) => {
      if (settled) return;
      size += chunk.length;
      if (size > limit) {
        onLimit?.();
        finish(new Error('V5 exchange response exceeds the size limit.'));
        response.destroy();
        return;
      }
      chunks.push(chunk);
    });
    response.on('end', () => {
      finish(undefined, new Uint8Array(Buffer.concat(chunks)));
    });
    response.on('error', (error: Error) => finish(error));
  });
}

export function requestHostname(hostname: string): string {
  return hostname.startsWith('[') && hostname.endsWith(']')
    ? hostname.slice(1, -1)
    : hostname;
}

export function tlsServerName(
  hostname: string
): { servername: string } | Record<string, never> {
  if (isIP(hostname)) return {};
  return { servername: hostname };
}

export function headerValue(
  headers: HttpResult['headers'],
  name: string
): string | undefined {
  const value = headers[name.toLowerCase()];
  if (Array.isArray(value)) return value[0];
  return value;
}
