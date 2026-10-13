import { KnoloOpenClawService } from '@knolo/tools';
import { McpServer } from '@modelcontextprotocol/server';
import {
  knoloPluginConfig,
  type KnoloMcpConfig,
  parseKnoloMcpConfig,
} from './config.js';
import { registerKnoloTools } from './tools.js';

export function createKnoloMcpServer(options: {
  service: KnoloOpenClawService;
  agentId: string;
  maxHits: number;
}): McpServer {
  const server = new McpServer({ name: 'knolo', version: '0.1.0' });
  registerKnoloTools(server, options);
  return server;
}

export async function createKnoloMcp(input: unknown): Promise<{
  config: KnoloMcpConfig;
  service: KnoloOpenClawService;
  server: McpServer;
}> {
  const config = parseKnoloMcpConfig(input);
  const service = await KnoloOpenClawService.create(knoloPluginConfig(config));
  return {
    config,
    service,
    server: createKnoloMcpServer({
      service,
      agentId: config.agentId,
      maxHits: config.maxHits,
    }),
  };
}

export {
  configPathFromArgs,
  loadKnoloMcpConfigFile,
  parseKnoloMcpConfig,
} from './config.js';
export type { KnoloMcpConfig } from './config.js';
