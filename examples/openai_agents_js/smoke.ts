/**
 * List Knolo tools through the OpenAI Agents SDK and run one search.
 * No model call.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { setTracingDisabled } from '@openai/agents';
import { knoloServer, mcpConfigPath } from './server.ts';

const EXPECTED_TOOLS = [
  'knolo_get',
  'knolo_search',
  'knolo_status',
  'knolo_verify',
];

const GRAPH_TOOLS = [
  'knolo_cortex_verify',
  'knolo_kar_evaluate',
  'knolo_kar_verify',
];

function searchBody(result: unknown): Record<string, unknown> {
  if (result === null || typeof result !== 'object') {
    throw new Error(`search returned ${typeof result}`);
  }
  const record = result as Record<string, unknown>;
  if (record.isError) throw new Error(JSON.stringify(result));
  let body = record.structuredContent;
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    const content = record.content;
    const first =
      Array.isArray(content) && content.length > 0 ? content[0] : undefined;
    const text =
      first !== null && typeof first === 'object'
        ? (first as { text?: unknown }).text
        : undefined;
    if (typeof text === 'string') {
      const parsed: unknown = JSON.parse(text);
      if (
        parsed !== null &&
        typeof parsed === 'object' &&
        !Array.isArray(parsed)
      ) {
        body = parsed;
      }
    }
  }
  if (body === null || typeof body !== 'object' || Array.isArray(body)) {
    throw new Error('search result has no structured body');
  }
  return body as Record<string, unknown>;
}

setTracingDisabled(true);

const configPath = mcpConfigPath();
if (configPath === undefined) {
  throw new Error('Set KNOLO_MCP_CONFIG to an absolute knolo-mcp.json path.');
}

const server = knoloServer(configPath);
try {
  await server.connect();
  const tools = await server.listTools();
  const names = tools.map((tool) => tool.name).sort();
  if (names.join('\n') !== EXPECTED_TOOLS.join('\n')) {
    throw new Error(`tools ${JSON.stringify(names)}`);
  }
  for (const graphTool of GRAPH_TOOLS) {
    if (names.includes(graphTool)) {
      throw new Error(`unexpected graph tool ${graphTool}`);
    }
  }
  const result = await server.callToolResult('knolo_search', {
    query: 'enterprise refunds',
    limit: 4,
  });
  const body = searchBody(result);
  const hits = body.hits;
  const receipts = body.receipts;
  if (!Array.isArray(hits) || hits.length !== 1) {
    throw new Error(`hits ${JSON.stringify(hits)}`);
  }
  const hit = hits[0] as { excerpt?: unknown };
  const excerpt = String(hit.excerpt ?? '');
  if (!excerpt.includes('Annual enterprise refunds')) {
    throw new Error(`excerpt ${JSON.stringify(excerpt)}`);
  }
  if (!Array.isArray(receipts) || receipts.length === 0) {
    throw new Error('missing receipt');
  }
  const receiptId = (receipts[0] as { receiptId?: unknown }).receiptId;
  if (typeof receiptId !== 'string' || !receiptId.startsWith('qr_')) {
    throw new Error(`receiptId ${JSON.stringify(receiptId)}`);
  }
  const config = JSON.parse(await readFile(configPath, 'utf8')) as {
    auditDir?: unknown;
  };
  if (typeof config.auditDir !== 'string') throw new Error('missing auditDir');
  const receipt = JSON.parse(
    await readFile(path.join(config.auditDir, `${receiptId}.json`), 'utf8')
  ) as { version?: unknown };
  if (receipt.version !== 'openclaw-knolo-query-v1') {
    throw new Error(`receipt version ${JSON.stringify(receipt.version)}`);
  }
  process.stdout.write(
    `${JSON.stringify({
      tools: names,
      excerpt,
      receiptId,
      modelCalled: false,
    })}\n`
  );
} finally {
  await server.close();
}
