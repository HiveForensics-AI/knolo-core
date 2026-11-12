import { readFileSync } from 'node:fs';
import { request as httpsRequest } from 'node:https';
import type { RequestOptions } from 'node:https';
import { isIP } from 'node:net';

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
  const ca = options.caPath ? readFileSync(options.caPath) : undefined;
  const requestOptions: RequestOptions = {
    protocol: target.protocol,
    hostname: target.hostname,
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
    ...tlsServerName(target.hostname),
    agent: false,
  };
  return new Promise((resolve, reject) => {
    const req = httpsRequest(requestOptions, (response) => {
      const chunks: Buffer[] = [];
      response.on('data', (chunk: Buffer) => chunks.push(chunk));
      response.on('end', () => {
        resolve({
          status: response.statusCode ?? 0,
          headers: response.headers,
          body: new Uint8Array(Buffer.concat(chunks)),
        });
      });
    });
    req.on('error', reject);
    if (options.body) req.write(Buffer.from(options.body));
    req.end();
  });
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
