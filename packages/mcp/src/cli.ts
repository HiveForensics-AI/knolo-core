import { KnoloPluginError } from '@knolo/tools';
import { serveStdio } from '@modelcontextprotocol/server/stdio';
import { configPathFromArgs } from './config.js';
import { openKnoloMcp } from './index.js';

const USAGE = `knolo-mcp --config <absolute-path>

Reads a pinned Knowledge Image config from --config or KNOLO_MCP_CONFIG.
Logs go to stderr. Stdout is MCP JSON-RPC only.`;

export async function startKnoloMcpCli(
  argv: readonly string[] = process.argv.slice(2),
  env: NodeJS.ProcessEnv = process.env
): Promise<void> {
  if (argv.includes('--help') || argv.includes('-h')) {
    console.error(USAGE);
    return;
  }
  const configPath = configPathFromArgs(argv, env);
  const opened = await openKnoloMcp(configPath);
  serveStdio(() => opened.server);
  console.error('knolo-mcp: serving stdio');
}

export function reportKnoloMcpFailure(error: unknown): never {
  const message =
    error instanceof KnoloPluginError
      ? `${error.code}: ${error.message}`
      : error instanceof Error
        ? error.message
        : 'unknown error';
  console.error(`knolo-mcp: ${message}`);
  process.exit(1);
}
