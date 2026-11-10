/**
 * knolo setup
 *
 * Prints one local install path. It runs knolo-box build when that binary
 * and a Grok home are both present. It does not run init, install a pack,
 * call a hub write API, or open a network connection.
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveRegistryUrl } from './registry/config.mjs';

export const SETUP_HELP = `Usage: knolo setup [--registry <url>]

Resolves the hub the same way as the other hub commands.
When knolo-box is on PATH and a Grok home exists, runs knolo-box build.
Does not run knolo-box init. Does not install a pack or call the hub.
A missing binary or a missing Grok home is printed, and setup still exits 0.`;

export async function runKnoloSetup(
  args,
  {
    env = process.env,
    homeDir = homedir(),
    spawnImpl = spawnBuild,
    print = console.log,
    printError = console.error,
  } = {}
) {
  const parsed = parseSetupArgs(args);
  if (parsed.help) {
    print(SETUP_HELP);
    return { ok: true, help: true };
  }
  const registry = resolveRegistryUrl({ value: parsed.registry, env });
  const box = await findOnPath('knolo-box', env.PATH);
  const grokHome = resolveGrokHome(env, homeDir);
  const grokHomeExists = await directoryExists(grokHome);

  if (box && grokHomeExists) {
    const status = await spawnImpl(box, ['build'], { env });
    if (status !== 0) {
      throw new Error(`knolo-box build exited with status ${status}.`);
    }
  } else {
    if (!box) printError('knolo-box is not on PATH. Skipping the local index.');
    if (!grokHomeExists) {
      printError(`No Grok home at ${grokHome}. Skipping the local index.`);
    }
  }

  const configPath = path.join(homeDir, '.knolo', 'box', 'knolo-mcp.json');
  print(`First search: ${configPath}, or knolo-mcp when a mount already exists.`);
  print('First install: knolo skill install <publisher>/<name> --dir <path>');
  print(
    `First publish: mint a token at ${registry}/dashboard/tokens, then knolo login --registry ${registry}, then knolo skill publish --registry ${registry}, knolo publish --registry ${registry}, or knolo yank --registry ${registry}.`
  );
  return { ok: true, registry, built: Boolean(box && grokHomeExists) };
}

export function resolveGrokHome(env, homeDir) {
  const configured = typeof env.GROK_HOME === 'string' ? env.GROK_HOME.trim() : '';
  const raw = configured || path.join(homeDir, '.grok');
  if (raw === '~') return homeDir;
  if (raw.startsWith('~/')) return path.resolve(path.join(homeDir, raw.slice(2)));
  return path.resolve(raw);
}

export async function findOnPath(name, pathEnv) {
  const dirs = String(pathEnv ?? '')
    .split(path.delimiter)
    .filter(Boolean);
  for (const dir of dirs) {
    const candidate = path.join(dir, name);
    try {
      await access(candidate, constants.X_OK);
      return candidate;
    } catch {
      // Try the next directory.
    }
  }
  return null;
}

function parseSetupArgs(args) {
  let registry;
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--registry') {
      const value = args[index + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new Error('Missing value for --registry');
      }
      registry = value;
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument for setup: ${arg}`);
  }
  return { registry };
}

async function directoryExists(candidate) {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

function spawnBuild(command, args) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'inherit'] });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`knolo-box build exited from ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}
