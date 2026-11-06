/**
 * List Knolo tools through ADK and run one search. No model call.
 */

import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { MCPToolset } from '@google/adk';
import type { Context } from '@google/adk';
import { rootAgent } from './agent.ts';

const EXPECTED_TOOLS = [
  'knolo_get',
  'knolo_search',
  'knolo_status',
  'knolo_verify',
];

function searchBody(result: unknown): Record<string, unknown> {
  if (result === null || typeof result !== 'object') {
    throw new Error(`search returned ${typeof result}`);
  }
  const record = result as Record<string, unknown>;
  if (record.isError || record.is_error) {
    throw new Error(JSON.stringify(result));
  }
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

if (rootAgent === undefined) {
  throw new Error('Set KNOLO_MCP_CONFIG to an absolute knolo-mcp.json path.');
}

const toolset = rootAgent.tools[0];
if (!(toolset instanceof MCPToolset)) {
  throw new Error('agent tool 0 is not an MCPToolset');
}

try {
  const tools = await toolset.getTools();
  const names = tools.map((tool) => tool.name).sort();
  if (names.join('\n') !== EXPECTED_TOOLS.join('\n')) {
    throw new Error(`tools ${JSON.stringify(names)}`);
  }
  const search = tools.find((tool) => tool.name === 'knolo_search');
  if (search === undefined) throw new Error('missing knolo_search');
  const result = await search.runAsync({
    args: { query: 'enterprise refunds', limit: 4 },
    // runAsync reads abortSignal. This smoke does not build an invocation.
    toolContext: {
      abortSignal: AbortSignal.timeout(60_000),
    } as unknown as Context,
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
  if (typeof receiptId !== 'string' || receiptId.length === 0) {
    throw new Error('missing receiptId');
  }
  const configPath = process.env.KNOLO_MCP_CONFIG;
  if (configPath === undefined) throw new Error('missing KNOLO_MCP_CONFIG');
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
  await toolset.close();
}
