import path from 'node:path';
import { loadBoxConfig } from './config.js';
import { BoxError } from './errors.js';
import { boxStatus, buildBox } from './build.js';
import { launchMcp } from './launch.js';

export async function main(argv: readonly string[]): Promise<number> {
  const command = argv[0];
  if (!command || command === '--help' || command === '-h') {
    console.error('knolo-box build|status|mcp [--config <file>]');
    return command ? 0 : 1;
  }
  try {
    const config = await loadBoxConfig(flag(argv, '--config'));
    if (command === 'build') {
      await buildBox(config);
      console.log(JSON.stringify(await boxStatus(config), null, 2));
      return 0;
    }
    if (command === 'status') {
      console.log(JSON.stringify(await boxStatus(config), null, 2));
      return 0;
    }
    if (command === 'mcp') {
      const configPath = path.join(config.output, 'knolo-mcp.json');
      return await launchMcp(configPath);
    }
    throw new BoxError('BOX_CONFIG', `Unknown command ${command}.`);
  } catch (error) {
    const message =
      error instanceof BoxError
        ? `${error.code}: ${error.message}`
        : error instanceof Error
          ? error.message
          : 'unknown error';
    console.error(`knolo-box: ${message}`);
    return 1;
  }
}

function flag(argv: readonly string[], name: string): string | undefined {
  const index = argv.indexOf(name);
  if (index < 0) return undefined;
  const value = argv[index + 1];
  if (!value || value.startsWith('--')) {
    throw new BoxError('BOX_CONFIG', `${name} needs a path.`);
  }
  return value;
}
