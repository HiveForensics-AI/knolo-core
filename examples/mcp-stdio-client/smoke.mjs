import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import readline from 'node:readline';
import { fileURLToPath } from 'node:url';

const configPath = process.env.KNOLO_MCP_CONFIG;
if (!configPath) {
  console.error('Set KNOLO_MCP_CONFIG to an absolute knolo-mcp.json path.');
  process.exit(1);
}

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, '../..');
const mcpBin = path.join(repoRoot, 'packages/mcp/bin/knolo-mcp.mjs');
if (!existsSync(mcpBin)) {
  console.error(`Missing MCP binary at ${mcpBin}. Run npm run build --workspace @knolo/mcp first.`);
  process.exit(1);
}

const child = spawn(process.execPath, [mcpBin, '--config', configPath], {
  stdio: ['pipe', 'pipe', 'pipe'],
});

let stderr = '';
child.stderr.on('data', (chunk) => {
  stderr += chunk.toString('utf8');
});

const rl = readline.createInterface({ input: child.stdout, crlfDelay: Infinity });
const pending = new Map();
let nextId = 1;

rl.on('line', (line) => {
  const trimmed = line.trim();
  if (!trimmed) return;
  let msg;
  try {
    msg = JSON.parse(trimmed);
  } catch {
    return;
  }
  if (msg.id !== undefined && pending.has(msg.id)) {
    const { resolve, reject } = pending.get(msg.id);
    pending.delete(msg.id);
    if (msg.error) {
      reject(new Error(msg.error.message || JSON.stringify(msg.error)));
    } else {
      resolve(msg.result);
    }
  }
});

function request(method, params = {}) {
  const id = nextId++;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      pending.delete(id);
      reject(new Error(`Timed out waiting for ${method}`));
    }, 10000);
    pending.set(id, {
      resolve: (val) => {
        clearTimeout(timer);
        resolve(val);
      },
      reject: (err) => {
        clearTimeout(timer);
        reject(err);
      },
    });
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`);
  });
}

function notify(method, params = {}) {
  child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method, params })}\n`);
}

try {
  await request('initialize', {
    protocolVersion: '2025-03-26',
    capabilities: {},
    clientInfo: { name: 'knolo-mcp-stdio-smoke', version: '1.0.0' },
  });
  notify('notifications/initialized');

  const listed = await request('tools/list');
  const names = (listed.tools || []).map((t) => t.name).sort();
  for (const required of ['knolo_get', 'knolo_search', 'knolo_status', 'knolo_verify']) {
    if (!names.includes(required)) {
      throw new Error(`Missing required tool: ${required}`);
    }
  }

  const statusRes = await request('tools/call', {
    name: 'knolo_status',
    arguments: {},
  });
  if (statusRes.isError) {
    throw new Error(`knolo_status failed: ${JSON.stringify(statusRes)}`);
  }

  const searchRes = await request('tools/call', {
    name: 'knolo_search',
    arguments: { query: 'enterprise refunds', limit: 4 },
  });
  if (searchRes.isError) {
    throw new Error(`knolo_search failed: ${JSON.stringify(searchRes)}`);
  }

  const textBlock = (searchRes.content || []).find((c) => c.type === 'text')?.text || '';
  const payload = searchRes.structuredContent || JSON.parse(textBlock);
  const excerpt = payload.hits?.[0]?.excerpt ?? '';
  const receiptId = payload.hits?.[0]?.receiptId ?? '';

  console.log(
    JSON.stringify({
      modelCalled: false,
      tools: names,
      excerpt,
      receiptId,
    })
  );

  if (!excerpt.includes('Annual enterprise refunds')) {
    throw new Error(`Unexpected excerpt: ${excerpt}`);
  }
  if (!receiptId.startsWith('qr_')) {
    throw new Error(`Missing qr_ receiptId: ${receiptId}`);
  }
} catch (err) {
  console.error(err instanceof Error ? err.message : String(err));
  if (stderr) console.error(stderr.trim());
  process.exitCode = 1;
} finally {
  rl.close();
  child.kill();
}
