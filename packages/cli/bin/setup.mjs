/**
 * knolo setup
 *
 * Writes a local box config and builds it when knolo-box is on PATH.
 * It does not install a pack, call a hub write API, or open a network
 * connection. A missing knolo-box is one line, and setup still exits 0.
 */
import { spawn } from 'node:child_process';
import { constants } from 'node:fs';
import { access, readFile, realpath, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import path from 'node:path';
import { resolveRegistryUrl } from './registry/config.mjs';

export const SETUP_HELP = `Usage: knolo setup [--registry <url>] [--root <dir>] [--agent <id>] [--auto-rebuild] [--skills <path>] [--managed-skills <path>] [--memory <path>] [--transcripts <path>]

Resolves the hub the same way as the other hub commands.
Scans ~/.grok when that directory exists, plus every --root.
Runs knolo-box init --tolerant, then knolo-box build --config.
Always includes ~/.knolo/skills as a skills root.
Pass --agent to set the caller name. Pass --auto-rebuild to rebuild on the next search.
Does not prompt. Does not install a pack or call the hub.
A missing knolo-box is printed, and setup still exits 0.
When more than one skill folder matches, pass --skills or --managed-skills.`;

export async function runKnoloSetup(
  args,
  {
    env = process.env,
    homeDir = homedir(),
    spawnImpl = spawnBox,
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
  const configPath = path.resolve(
    path.join(homeDir, '.knolo', 'box', 'box.config.json')
  );
  const hubSkills = path.resolve(path.join(homeDir, '.knolo', 'skills'));
  const grokHome = resolveGrokHome(env, homeDir);
  const roots = [];
  if (await directoryExists(grokHome)) roots.push(grokHome);
  for (const root of parsed.roots) roots.push(root);

  let built = false;
  if (!box) {
    printError('knolo-box is not on PATH. Skipping the local index.');
  } else {
    const initArgs = [
      'init',
      '--config',
      configPath,
      '--tolerant',
      '--hub-skills',
      hubSkills,
    ];
    for (const root of roots) initArgs.push('--root', root);
    if (parsed.agent) initArgs.push('--agent', parsed.agent);
    if (parsed.autoRebuild) initArgs.push('--auto-rebuild');
    if (parsed.skills) initArgs.push('--skills', parsed.skills);
    if (parsed.managedSkills) initArgs.push('--managed-skills', parsed.managedSkills);
    if (parsed.memory) initArgs.push('--memory', parsed.memory);
    if (parsed.transcripts) initArgs.push('--transcripts', parsed.transcripts);
    const initStatus = await spawnImpl(box, initArgs, { env });
    if (initStatus !== 0) {
      throw new Error(`knolo-box init exited with status ${initStatus}.`);
    }
    const buildStatus = await spawnImpl(
      box,
      ['build', '--config', configPath],
      { env }
    );
    if (buildStatus !== 0) {
      throw new Error(`knolo-box build exited with status ${buildStatus}.`);
    }
    built = true;
    if ((await skillRootsBesideHub(configPath, hubSkills)).length === 0) {
      printError('No Grok skill folder was found.');
    }
  }

  print(`Config: ${configPath}`);
  print('First install: knolo skill install <publisher>/<name>');
  print(`Connector: knolo-box mcp --config ${configPath}`);
  print(`Publish needs a token from ${registry}/dashboard/tokens.`);
  return { ok: true, registry, built, configPath };
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
  const parsed = { roots: [], autoRebuild: false };
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') return { help: true };
    if (arg === '--auto-rebuild') {
      parsed.autoRebuild = true;
      continue;
    }
    if (arg === '--root') {
      parsed.roots.push(oneValue(args, index, arg));
      index += 1;
      continue;
    }
    const key = singleFlag(arg);
    if (key) {
      if (parsed[key] !== undefined) {
        throw new Error(`${arg} accepts one value.`);
      }
      parsed[key] = oneValue(args, index, arg);
      index += 1;
      continue;
    }
    throw new Error(`Unknown argument for setup: ${arg}`);
  }
  return parsed;
}

function singleFlag(arg) {
  if (arg === '--registry') return 'registry';
  if (arg === '--agent') return 'agent';
  if (arg === '--skills') return 'skills';
  if (arg === '--managed-skills') return 'managedSkills';
  if (arg === '--memory') return 'memory';
  if (arg === '--transcripts') return 'transcripts';
  return null;
}

function oneValue(args, index, arg) {
  const value = args[index + 1];
  if (value === undefined || value.startsWith('--')) {
    throw new Error(`Missing value for ${arg}`);
  }
  return value;
}

async function directoryExists(candidate) {
  try {
    return (await stat(candidate)).isDirectory();
  } catch {
    return false;
  }
}

async function skillRootsBesideHub(configPath, hubSkills) {
  let config;
  try {
    config = JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    return [];
  }
  const roots = config?.scopes?.skills?.roots;
  if (!Array.isArray(roots)) return [];
  const hub = await canonicalDir(hubSkills);
  const others = [];
  for (const root of roots) {
    if (typeof root !== 'string' || root.length === 0) continue;
    if ((await canonicalDir(root)) === hub) continue;
    others.push(root);
  }
  return others;
}

async function canonicalDir(candidate) {
  try {
    return await realpath(candidate);
  } catch {
    return path.resolve(candidate);
  }
}

function spawnBox(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: options.env,
      cwd: options.cwd,
      stdio: ['ignore', 'ignore', 'inherit'],
    });
    child.on('error', reject);
    child.on('exit', (code, signal) => {
      if (signal) reject(new Error(`knolo-box exited from ${signal}.`));
      else resolve(code ?? 1);
    });
  });
}
