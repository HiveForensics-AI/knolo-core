import { KnoloOpenClawService } from '@knolo/tools';
import { McpServer } from '@modelcontextprotocol/server';
import {
  knoloPluginConfig,
  type KnoloMcpConfig,
  parseKnoloMcpConfig,
} from './config.js';
import { pinConfiguredGraphs, type PinnedKarGraph } from './graphs.js';
import { registerKnoloTools } from './tools.js';

export function createKnoloMcpServer(options: {
  service: KnoloOpenClawService;
  agentId: string;
  maxHits: number;
  graphs: ReadonlyMap<string, PinnedKarGraph>;
}): McpServer {
  const server = new McpServer({ name: 'knolo', version: '0.2.0' });
  registerKnoloTools(server, options);
  return server;
}

export async function createKnoloMcp(input: unknown): Promise<{
  config: KnoloMcpConfig;
  service: KnoloOpenClawService;
  graphs: Map<string, PinnedKarGraph>;
  server: McpServer;
}> {
  const config = parseKnoloMcpConfig(input);
  const service = await KnoloOpenClawService.create(knoloPluginConfig(config));
  const graphs = await pinConfiguredGraphs(config, service);
  return {
    config,
    service,
    graphs,
    server: createKnoloMcpServer({
      service,
      agentId: config.agentId,
      maxHits: config.maxHits,
      graphs,
    }),
  };
}

export {
  configPathFromArgs,
  loadKnoloMcpConfigFile,
  parseKnoloMcpConfig,
} from './config.js';
export type { KnoloMcpConfig } from './config.js';
