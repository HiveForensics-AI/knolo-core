import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { BoxError } from './errors.js';

export function mcpBinPath(
  start = path.dirname(fileURLToPath(import.meta.url))
): string {
  let dir = start;
  for (let depth = 0; depth < 8; depth += 1) {
    const candidate = path.join(
      dir,
      'node_modules',
      '@knolo',
      'mcp',
      'bin',
      'knolo-mcp.mjs'
    );
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new BoxError('BOX_MCP_MISSING', 'knolo-mcp is not installed.');
}

export function launchMcp(configPath: string): Promise<number> {
  const child = spawn(
    process.execPath,
    [mcpBinPath(), '--config', configPath],
    {
      stdio: 'inherit',
    }
  );
  return new Promise((resolve, reject) => {
    child.once('error', reject);
    child.once('exit', (code) => resolve(code ?? 1));
  });
}
