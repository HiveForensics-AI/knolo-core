import { readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { loadBoxConfig } from './config.js';
import { BoxError } from './errors.js';
import { boxStatus, buildBox, ensureFresh } from './build.js';
import { initBox } from './init.js';
import { launchMcp } from './launch.js';

export async function main(
  argv: readonly string[],
  env: NodeJS.ProcessEnv = process.env,
  home: string = os.homedir()
): Promise<number> {
  const command = argv[0];
  if (!command || command === '--help' || command === '-h') {
    console.error(
      'knolo-box build|status|mcp|init|ensure-fresh [--config <file>] [--root <dir>] [--skills <path>] [--managed-skills <path>] [--memory <path>] [--transcripts <path>] [--files <path>] [--tolerant] [--agent <id>] [--auto-rebuild] [--hub-skills <path>]'
    );
    return command ? 0 : 1;
  }
  try {
    if (command === 'init') {
      const configPath = flag(argv, '--config');
      if (!configPath) {
        throw new BoxError('BOX_CONFIG', '--config needs a path.');
      }
      const tolerant = argv.includes('--tolerant');
      const roots = flags(argv, '--root');
      const result = await initBox({
        configPath,
        roots: roots.length > 0 ? roots : tolerant ? [] : [home],
        skills: flag(argv, '--skills') ?? optionalEnv(env.KNOLO_BOX_SKILLS),
        managedSkills:
          flag(argv, '--managed-skills') ??
          optionalEnv(env.KNOLO_BOX_MANAGED_SKILLS),
        memory: flag(argv, '--memory') ?? optionalEnv(env.KNOLO_BOX_MEMORY),
        transcripts:
          flag(argv, '--transcripts') ?? optionalEnv(env.KNOLO_BOX_TRANSCRIPTS),
        files: flag(argv, '--files') ?? optionalEnv(env.KNOLO_BOX_FILES),
        home,
        env,
        tolerant,
        agentId: flag(argv, '--agent'),
        autoRebuild: argv.includes('--auto-rebuild') ? true : undefined,
        hubSkills: flag(argv, '--hub-skills'),
      });
      for (const line of result.reports) console.error(line);
      console.log(
        JSON.stringify(
          {
            output: result.output,
            grokHome: result.grokHome,
            agents: result.agents,
            ...(result.agentId !== undefined
              ? { agentId: result.agentId }
              : {}),
            ...(result.autoRebuild === true ? { autoRebuild: true } : {}),
            scopes: result.scopes,
          },
          null,
          2
        )
      );
      return 0;
    }
    const config = await loadBoxConfig(flag(argv, '--config'), env, home);
    if (command === 'build') {
      await buildBox(config);
      console.log(JSON.stringify(await boxStatus(config), null, 2));
      return 0;
    }
    if (command === 'status') {
      console.log(JSON.stringify(await boxStatus(config), null, 2));
      return 0;
    }
    if (command === 'ensure-fresh') {
      await ensureFresh(config);
      return 0;
    }
    if (command === 'mcp') {
      const configPath = path.join(config.output, 'knolo-mcp.json');
      await assertMcpConfig(configPath);
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

async function assertMcpConfig(configPath: string): Promise<void> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await readFile(configPath, 'utf8'));
  } catch {
    throw new BoxError(
      'BOX_CONFIG',
      'No images were built. Add a scope with text, then run knolo-box build.'
    );
  }
  const mounts =
    parsed && typeof parsed === 'object'
      ? (parsed as { mounts?: unknown }).mounts
      : undefined;
  if (!Array.isArray(mounts) || mounts.length === 0) {
    throw new BoxError(
      'BOX_CONFIG',
      'No images were built. Add a scope with text, then run knolo-box build.'
    );
  }
}

function flag(argv: readonly string[], name: string): string | undefined {
  const values = flags(argv, name);
  if (values.length > 1) {
    throw new BoxError('BOX_CONFIG', `${name} accepts one path.`);
  }
  return values[0];
}

function flags(argv: readonly string[], name: string): string[] {
  const values: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] !== name) continue;
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) {
      throw new BoxError('BOX_CONFIG', `${name} needs a path.`);
    }
    values.push(value);
    index += 1;
  }
  return values;
}

function optionalEnv(value: string | undefined): string | undefined {
  const trimmed = value?.trim();
  return trimmed ? trimmed : undefined;
}
