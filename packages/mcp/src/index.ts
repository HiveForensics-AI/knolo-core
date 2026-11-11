import { KnoloOpenClawService } from '@knolo/tools';
import { McpServer } from '@modelcontextprotocol/server';
import {
  knoloPluginConfig,
  loadKnoloMcpConfigFile,
  type KnoloMcpConfig,
  parseKnoloMcpConfig,
} from './config.js';
import { pinConfiguredGraphs, type PinnedKarGraph } from './graphs.js';
import { runConfiguredRebuild } from './auto-rebuild.js';
import { createImageRefresh, type ImageRefresh } from './refresh.js';
import { registerKnoloTools } from './tools.js';

export function createKnoloMcpServer(options: {
  service: KnoloOpenClawService;
  agentId: string;
  sessionId?: string;
  maxHits: number;
  graphs: ReadonlyMap<string, PinnedKarGraph>;
  refresh?: ImageRefresh;
  beforeRead?: () => Promise<void>;
}): McpServer {
  const server = new McpServer({ name: 'knolo', version: '0.2.3' });
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
      ...(config.sessionId === undefined
        ? {}
        : { sessionId: config.sessionId }),
      maxHits: config.maxHits,
      graphs,
    }),
  };
}

export async function openKnoloMcp(configPath: string): Promise<{
  config: KnoloMcpConfig;
  service: KnoloOpenClawService;
  graphs: Map<string, PinnedKarGraph>;
  refresh: ImageRefresh;
  server: McpServer;
}> {
  const config = await loadKnoloMcpConfigFile(configPath);
  const pluginConfig = knoloPluginConfig(config);
  const service = await KnoloOpenClawService.create(pluginConfig);
  const graphs = await pinConfiguredGraphs(config, service);
  const refresh = await createImageRefresh({
    configPath,
    agentId: config.agentId,
    loadConfig: () => loadKnoloMcpConfigFile(configPath),
    service,
    graphs,
    pluginConfig,
    graphPaths: config.mounts.flatMap((mount) =>
      mount.kar ? [mount.kar.graphPath] : []
    ),
  });
  const beforeRead = async (): Promise<void> => {
    try {
      const current = await loadKnoloMcpConfigFile(configPath);
      if (current.autoRebuild) {
        await runConfiguredRebuild(current.autoRebuild);
      }
    } catch {
      // A hook that cannot be read leaves the loaded image in place.
    }
    await refresh();
  };
  return {
    config,
    service,
    graphs,
    refresh,
    server: createKnoloMcpServer({
      service,
      agentId: config.agentId,
      ...(config.sessionId === undefined
        ? {}
        : { sessionId: config.sessionId }),
      maxHits: config.maxHits,
      graphs,
      refresh,
      beforeRead,
    }),
  };
}

export {
  configPathFromArgs,
  loadKnoloMcpConfigFile,
  parseKnoloMcpConfig,
} from './config.js';
export type { KnoloMcpConfig } from './config.js';
