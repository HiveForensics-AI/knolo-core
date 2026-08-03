#!/usr/bin/env node
/**
 * Lightweight local REST gateway over dfx canister calls.
 * Intended for Postman / curl against a local ICP deploy only.
 *
 * Env:
 *   KNOLO_CANISTER   default knolo_knowledge
 *   KNOLO_DFX_CWD    directory containing dfx.json (default: examples/icp-knowledge-canister)
 *   KNOLO_REST_PORT  default 8787
 *   DFX_BIN          default dfx
 */

import { execFileSync } from 'node:child_process';
import http from 'node:http';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, '../..');

const PORT = Number.parseInt(process.env.KNOLO_REST_PORT || '8787', 10);
const CANISTER = process.env.KNOLO_CANISTER || 'knolo_knowledge';
const DFX_BIN = process.env.DFX_BIN || 'dfx';
const DFX_CWD =
  process.env.KNOLO_DFX_CWD || path.join(repoRoot, 'examples/icp-knowledge-canister');

function json(res, status, body) {
  const payload = JSON.stringify(body, null, 2);
  res.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  });
  res.end(payload);
}

function runDfx(args, { argument } = {}) {
  const env = { ...process.env };
  if (env.TERM === 'dumb') env.TERM = 'xterm-256color';

  let tempDir;
  let finalArgs = [...args];
  try {
    if (argument !== undefined) {
      tempDir = mkdtempSync(path.join(tmpdir(), 'knolo-rest-gateway-'));
      const argFile = path.join(tempDir, 'args.did');
      writeFileSync(argFile, argument, 'utf8');
      finalArgs = [...args, '--argument-file', argFile];
    }

    const output = execFileSync(DFX_BIN, finalArgs, {
      cwd: DFX_CWD,
      encoding: 'utf8',
      env,
    });
    const trimmed = (output || '').trim();
    if (!trimmed) return null;
    try {
      return JSON.parse(trimmed);
    } catch {
      return { raw: trimmed };
    }
  } finally {
    if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  }
}

function parseBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (error) {
        reject(new Error(`Invalid JSON body: ${error.message}`));
      }
    });
    req.on('error', reject);
  });
}

function help() {
  return {
    service: 'knolo-icp-rest-gateway',
    canister: CANISTER,
    dfxCwd: DFX_CWD,
    endpoints: {
      'GET /health': 'Canister health()',
      'GET /info': 'Canister pack_info()',
      'GET /search?q=...&k=5': 'Canister search(q, k)',
      'POST /search': 'Body: { "q": "string", "k": 5 }',
      'POST /clear': 'Canister clear_pack() (controller identity required)',
    },
    notes: [
      'Local development only. Backed by dfx canister calls.',
      'Upload packs with knolo icp upload or the seed script, not this gateway.',
    ],
  };
}

const server = http.createServer(async (req, res) => {
  try {
    if (req.method === 'OPTIONS') {
      res.writeHead(204, {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
        'Access-Control-Allow-Headers': 'Content-Type',
      });
      return res.end();
    }

    const url = new URL(req.url || '/', `http://127.0.0.1:${PORT}`);
    const pathname = url.pathname.replace(/\/+$/, '') || '/';

    if (req.method === 'GET' && (pathname === '/' || pathname === '/help')) {
      return json(res, 200, help());
    }

    if (req.method === 'GET' && pathname === '/health') {
      const result = runDfx(['canister', 'call', CANISTER, 'health', '--query', '--output', 'json']);
      return json(res, 200, result);
    }

    if (req.method === 'GET' && pathname === '/info') {
      const result = runDfx([
        'canister',
        'call',
        CANISTER,
        'pack_info',
        '--query',
        '--output',
        'json',
      ]);
      return json(res, 200, result);
    }

    if (req.method === 'GET' && pathname === '/search') {
      const q = url.searchParams.get('q') || '';
      const k = Number.parseInt(url.searchParams.get('k') || '5', 10);
      if (!q.trim()) return json(res, 400, { error: 'Missing q query parameter' });
      if (!Number.isInteger(k) || k <= 0) {
        return json(res, 400, { error: 'k must be a positive integer' });
      }
      const result = runDfx(
        ['canister', 'call', CANISTER, 'search', '--query', '--output', 'json'],
        { argument: `(${JSON.stringify(q)}, ${k} : nat32)\n` }
      );
      return json(res, 200, result);
    }

    if (req.method === 'POST' && pathname === '/search') {
      const body = await parseBody(req);
      const q =
        typeof body.q === 'string'
          ? body.q
          : typeof body.query === 'string'
            ? body.query
            : '';
      const k =
        body.k === undefined && body.top_k === undefined
          ? 5
          : Number(body.k ?? body.top_k);
      if (!q.trim()) return json(res, 400, { error: 'Body must include string field q' });
      if (!Number.isInteger(k) || k <= 0) {
        return json(res, 400, { error: 'k must be a positive integer' });
      }
      const result = runDfx(
        ['canister', 'call', CANISTER, 'search', '--query', '--output', 'json'],
        { argument: `(${JSON.stringify(q)}, ${k} : nat32)\n` }
      );
      return json(res, 200, result);
    }

    if (req.method === 'POST' && pathname === '/clear') {
      const result = runDfx(['canister', 'call', CANISTER, 'clear_pack', '--output', 'json']);
      return json(res, 200, result);
    }

    return json(res, 404, { error: `Unknown route ${req.method} ${pathname}`, help: help() });
  } catch (error) {
    const message = error?.stderr?.toString?.() || error?.message || String(error);
    return json(res, 500, { error: message.trim() });
  }
});

if (!existsSync(path.join(DFX_CWD, 'dfx.json'))) {
  console.error(`dfx.json not found in ${DFX_CWD}`);
  process.exit(1);
}

server.listen(PORT, '127.0.0.1', () => {
  const runtimeDir = path.join(scriptDir, '.runtime');
  try {
    mkdirSync(runtimeDir, { recursive: true });
    writeFileSync(
      path.join(runtimeDir, 'gateway.json'),
      JSON.stringify(
        {
          baseUrl: `http://127.0.0.1:${PORT}`,
          canister: CANISTER,
          dfxCwd: DFX_CWD,
          startedAt: new Date().toISOString(),
        },
        null,
        2
      )
    );
  } catch {
    // ignore runtime write failures
  }

  console.log(`[rest-gateway] listening on http://127.0.0.1:${PORT}`);
  console.log(`[rest-gateway] canister=${CANISTER}`);
  console.log(`[rest-gateway] dfx cwd=${DFX_CWD}`);
  console.log('[rest-gateway] try: curl "http://127.0.0.1:8787/search?q=billing&k=5"');
});
