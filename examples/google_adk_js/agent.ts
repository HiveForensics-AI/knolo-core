/**
 * One Google ADK agent that searches a pinned Knolo image over MCP stdio.
 *
 * The host owns the model. Importing this module does not call one.
 * `rootAgent` is set only when `KNOLO_MCP_CONFIG` is an absolute path, so a
 * bare import does not start the server.
 */

import path from 'node:path';
import { LlmAgent, MCPToolset } from '@google/adk';
import type { StdioConnectionParams } from '@google/adk';

export const PUBLISHED_PACKAGE = '@knolo/mcp@0.2.1';

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

export function connectionParams(config: string): StdioConnectionParams {
  return {
    type: 'StdioConnectionParams',
    timeout: 60,
    serverParams: {
      command: process.env.KNOLO_MCP_COMMAND ?? 'npx',
      args: [...serverArgs(), '--config', config],
    },
  };
}

export function knoloToolset(config?: string): MCPToolset {
  const resolved = config ?? mcpConfigPath();
  if (resolved === undefined) {
    throw new Error('Set KNOLO_MCP_CONFIG to an absolute knolo-mcp.json path.');
  }
  return new MCPToolset(connectionParams(resolved));
}

export function buildAgent(config?: string): LlmAgent {
  return new LlmAgent({
    model: 'gemini-2.5-flash',
    name: 'knolo_reader',
    description:
      'Searches a pinned Knolo Knowledge Image and reports receipt ids.',
    instruction:
      'Answer from knolo_search only. Include each receipt id in the reply. A receipt means the image pin and policy check ran. It does not mean a claim is proven. Do not invent passages.',
    tools: [knoloToolset(config)],
  });
}

const config = mcpConfigPath();
export const rootAgent = config === undefined ? undefined : buildAgent(config);
