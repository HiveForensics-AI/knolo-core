/**
 * Stdio MCP server settings for the OpenAI Agents SDK.
 *
 * The host owns the model. Importing this module does not connect and does
 * not call a model.
 */

import path from 'node:path';
import { MCPServerStdio } from '@openai/agents';

export const PUBLISHED_PACKAGE = '@knolo/mcp@0.2.3';

export function mcpConfigPath(): string | undefined {
  const raw = (process.env.KNOLO_MCP_CONFIG ?? '').trim();
  if (!raw) return undefined;
  if (!path.isAbsolute(raw)) {
    throw new Error('KNOLO_MCP_CONFIG must be an absolute path.');
  }
  return raw;
}

function serverArgs(): string[] {
  const raw = process.env.KNOLO_MCP_ARGS;
  if (raw === undefined) return ['-y', PUBLISHED_PACKAGE];
  const parsed: unknown = JSON.parse(raw);
  if (
    !Array.isArray(parsed) ||
    !parsed.every((item) => typeof item === 'string')
  ) {
    throw new Error('KNOLO_MCP_ARGS must be a JSON array of strings.');
  }
  return parsed;
}

export function knoloServer(config?: string): MCPServerStdio {
  const resolved = config ?? mcpConfigPath();
  if (resolved === undefined) {
    throw new Error('Set KNOLO_MCP_CONFIG to an absolute knolo-mcp.json path.');
  }
  return new MCPServerStdio({
    name: 'Knolo',
    command: process.env.KNOLO_MCP_COMMAND ?? 'npx',
    args: [...serverArgs(), '--config', resolved],
    cacheToolsList: false,
    clientSessionTimeoutSeconds: 60,
    errorFunction: null,
  });
}
