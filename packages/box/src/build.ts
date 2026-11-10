import { createHash } from 'node:crypto';
import {
  access,
  mkdir,
  readFile,
  rename,
  rm,
  writeFile,
} from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5, type KnowledgePolicyV1 } from '@knolo/core';
import { SCOPE_NAMES, type BoxConfig, type BoxScopeName } from './config.js';
import { BoxError } from './errors.js';
import {
  collectCorpora,
  digestScopeSources,
  scopeMissingRoot,
  utf8,
} from './sources.js';

export const MAX_AUDIT_RECORDS = 10_000;
export const MAX_AUDIT_BYTES = 256 * 1024 * 1024;

export type BoxPin = {
  sha256: string;
  stateRoot: string;
  builtAt: string;
  sourceDigest: string;
};

export type BoxPins = {
  version: 1;
  scopes: Partial<Record<BoxScopeName, BoxPin>>;
  skipped: Array<{ path: string; reason: 'missing-root' | 'too-large' }>;
  emptyDigests?: Partial<Record<BoxScopeName, string>>;
};

type StagedArtifact = {
  live: string;
  temp: string;
  data?: Uint8Array | string;
  mode: number;
  remove: boolean;
};

export type BoxAutoRebuild = {
  at: string;
  ok: boolean;
  reason?: string;
};

export type BoxScopeStatus = {
  id: BoxScopeName;
  stateRoot: string;
  builtAt: string;
  pinMatches: boolean;
  stale: boolean;
  lastAutoRebuild: BoxAutoRebuild | null;
};

const AUTO_REBUILD_INTERVAL_MS = 2_000;

const PRIVATE_SCOPES = new Set<BoxScopeName>(['memory', 'transcripts']);

export function boxPolicy(): KnowledgePolicyV1 {
  return {
    version: 1,
    default: 'deny',
    rules: [
      {
        effect: 'allow',
        action: 'query',
        principal: 'box:reader',
        kind: 'chunk',
      },
      {
        effect: 'allow',
        action: 'read',
        principal: 'box:reader',
        kind: 'chunk',
      },
    ],
  };
}

export async function buildBox(
  config: BoxConfig,
  now = new Date()
): Promise<BoxPins> {
  const corpora = await collectCorpora(config);
  const previous = await readPins(config.output);
  await mkdir(config.output, { recursive: true, mode: 0o700 });
  const auditDir = path.join(config.output, 'audit');
  await mkdir(auditDir, { recursive: true, mode: 0o700 });
  const policy = boxPolicy();
  const policyPath = path.join(config.output, 'policy.json');
  const scopes: BoxPins['scopes'] = {};
  const emptyDigests: Partial<Record<BoxScopeName, string>> = {};
  const skipped = corpora.flatMap((corpus) => corpus.skipped);
  const artifacts: StagedArtifact[] = [
    stagedFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`),
  ];
  for (const corpus of corpora) {
    if (corpus.chunks.length === 0) {
      if (!scopeMissingRoot(config.scopes[corpus.scope].roots, corpus)) {
        emptyDigests[corpus.scope] = corpus.sourceDigest;
      }
      continue;
    }
    const imagePath = path.join(config.output, `${corpus.scope}.v5`);
    const prior = previous.scopes[corpus.scope];
    if (prior && prior.sourceDigest === corpus.sourceDigest) {
      try {
        await access(imagePath);
        scopes[corpus.scope] = prior;
        continue;
      } catch {
        // The pin matches the source, and the image file is gone. Write it again.
      }
    }
    const image = createKnowledgeImageV5({
      actor: 'knolo-box',
      policy,
      objects: corpus.chunks.map((item) => ({
        kind: 'chunk' as const,
        bytes: utf8(item.text),
        meta: {
          scope: item.scope,
          path: item.source,
          locator: item.locator,
          ...(item.when ? { when: item.when } : {}),
          ...(item.agent ? { agent: item.agent } : {}),
        },
      })),
    });
    scopes[corpus.scope] = {
      sha256: sha256(image.bytes),
      stateRoot: image.stateRoot,
      builtAt: now.toISOString(),
      sourceDigest: corpus.sourceDigest,
    };
    artifacts.push(stagedFile(imagePath, image.bytes));
  }
  const pins: BoxPins = {
    version: 1,
    scopes,
    skipped,
    ...(Object.keys(emptyDigests).length > 0 ? { emptyDigests } : {}),
  };
  artifacts.push(
    stagedFile(
      path.join(config.output, 'pins.json'),
      `${JSON.stringify(pins, null, 2)}\n`
    ),
    ...mcpArtifacts(config, pins, policyPath, auditDir)
  );
  await publishArtifacts(artifacts);
  return pins;
}

export async function boxStatus(
  config: BoxConfig,
  now = new Date()
): Promise<BoxScopeStatus[]> {
  const lastAutoRebuild = await ensureFresh(config, now);
  const pins = await readPins(config.output);
  const scopes: BoxScopeStatus[] = [];
  for (const name of SCOPE_NAMES) {
    const pin = pins.scopes[name];
    if (!pin) continue;
    const digest = await readScopeDigest(
      config,
      name,
      pin,
      pins.emptyDigests?.[name]
    );
    scopes.push({
      id: name,
      stateRoot: pin.stateRoot,
      builtAt: pin.builtAt,
      pinMatches: await pinMatches(config.output, name, pin),
      stale: digest.stale,
      lastAutoRebuild,
    });
  }
  return scopes;
}

export async function ensureFresh(
  config: BoxConfig,
  now = new Date()
): Promise<BoxAutoRebuild | null> {
  if (config.autoRebuild !== true) return null;
  const previous = await readAutoRebuild(config.output);
  if (previous && withinAutoRebuildInterval(previous, now)) {
    return previous;
  }
  if (!(await sourcesChanged(config))) return previous;
  const at = now.toISOString();
  await writeAutoRebuild(config.output, {
    version: 1,
    at,
    ok: false,
    reason: 'rebuild did not finish',
  });
  try {
    await buildBox(config, now);
    await writeAutoRebuild(config.output, { version: 1, at, ok: true });
    return { at, ok: true };
  } catch (error) {
    const reason = rebuildReason(error);
    await writeAutoRebuild(config.output, {
      version: 1,
      at,
      ok: false,
      reason,
    });
    return { at, ok: false, reason };
  }
}

export function mcpConfig(
  config: BoxConfig,
  pins: BoxPins,
  policyPath: string,
  auditDir: string,
  shared: boolean
) {
  const mounts = SCOPE_NAMES.flatMap((name) => {
    if (shared && PRIVATE_SCOPES.has(name)) return [];
    const pin = pins.scopes[name];
    if (!pin) return [];
    return [
      {
        id: name,
        path: path.join(config.output, `${name}.v5`),
        sha256: pin.sha256,
        stateRoot: pin.stateRoot,
        policyPath,
        agents: mountAgents(config, name),
        principal: 'box:reader',
        builtAt: pin.builtAt,
        sourceDigest: pin.sourceDigest,
        sourceRoots: config.scopes[name].roots.map((root) =>
          path.resolve(root)
        ),
      },
    ];
  });
  const agentId = config.agentId ?? 'box';
  return {
    agentId,
    ...(config.sessionId ? { sessionId: config.sessionId } : {}),
    ...(config.autoRebuild === true && config.configPath
      ? {
          autoRebuild: {
            command: process.execPath,
            args: [boxBinPath(), 'ensure-fresh', '--config', config.configPath],
          },
        }
      : {}),
    grokHome: config.grokHome,
    auditDir,
    maxAuditRecords: MAX_AUDIT_RECORDS,
    maxAuditBytes: MAX_AUDIT_BYTES,
    mounts,
  };
}

function mountAgents(config: BoxConfig, name: BoxScopeName): string[] {
  const agentId = config.agentId ?? 'box';
  if (PRIVATE_SCOPES.has(name)) return [agentId];
  return [...new Set([agentId, ...config.agents])];
}

function boxBinPath(): string {
  return fileURLToPath(new URL('../bin/knolo-box.mjs', import.meta.url));
}

function mcpArtifacts(
  config: BoxConfig,
  pins: BoxPins,
  policyPath: string,
  auditDir: string
): StagedArtifact[] {
  return [
    { filePath: path.join(config.output, 'knolo-mcp.json'), shared: false },
    {
      filePath: path.join(config.output, 'knolo-mcp-shared.json'),
      shared: true,
    },
  ].map(({ filePath, shared }) => {
    const value = mcpConfig(config, pins, policyPath, auditDir, shared);
    if (value.mounts.length === 0) {
      return {
        live: filePath,
        temp: `${filePath}.next`,
        mode: 0o600,
        remove: true,
      };
    }
    return stagedFile(filePath, `${JSON.stringify(value, null, 2)}\n`);
  });
}

function stagedFile(live: string, data: Uint8Array | string): StagedArtifact {
  return { live, temp: `${live}.next`, data, mode: 0o600, remove: false };
}

async function publishArtifacts(artifacts: StagedArtifact[]): Promise<void> {
  const written: string[] = [];
  try {
    for (const artifact of artifacts) {
      if (artifact.remove || artifact.data === undefined) continue;
      await writeFile(artifact.temp, artifact.data, { mode: artifact.mode });
      written.push(artifact.temp);
    }
  } catch (error) {
    await discardTemps(written);
    throw error;
  }

  const backups: Array<{ live: string; backup: string }> = [];
  try {
    for (const artifact of artifacts) {
      const backup = `${artifact.live}.prev`;
      try {
        await rename(artifact.live, backup);
        backups.push({ live: artifact.live, backup });
      } catch (error) {
        if (!isEnoent(error)) throw error;
      }
      if (artifact.remove) continue;
      await rename(artifact.temp, artifact.live);
    }
  } catch (error) {
    for (const item of backups.reverse()) {
      await rm(item.live, { force: true }).catch(() => undefined);
      await rename(item.backup, item.live).catch(() => undefined);
    }
    await discardTemps(written);
    throw error;
  }
  await Promise.all(
    backups.map((item) =>
      rm(item.backup, { force: true }).catch(() => undefined)
    )
  );
}

async function discardTemps(temps: readonly string[]): Promise<void> {
  await Promise.all(
    temps.map((temp) => rm(temp, { force: true }).catch(() => undefined))
  );
}

function isEnoent(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'ENOENT'
  );
}

async function readPins(output: string): Promise<BoxPins> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(output, 'pins.json'), 'utf8')
    ) as BoxPins;
    if (!parsed || parsed.version !== 1 || !parsed.scopes) {
      return { version: 1, scopes: {}, skipped: [] };
    }
    const emptyDigests = checkedEmptyDigests(parsed.emptyDigests);
    return {
      version: 1,
      scopes: parsed.scopes,
      skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
      ...(Object.keys(emptyDigests).length > 0 ? { emptyDigests } : {}),
    };
  } catch {
    return { version: 1, scopes: {}, skipped: [] };
  }
}

function checkedEmptyDigests(
  value: BoxPins['emptyDigests']
): Partial<Record<BoxScopeName, string>> {
  if (!value || typeof value !== 'object') return {};
  const digests: Partial<Record<BoxScopeName, string>> = {};
  for (const name of SCOPE_NAMES) {
    const digest = value[name];
    if (typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest)) {
      digests[name] = digest;
    }
  }
  return digests;
}

async function pinMatches(
  output: string,
  scope: BoxScopeName,
  pin: BoxPin
): Promise<boolean> {
  try {
    const bytes = await readFile(path.join(output, `${scope}.v5`));
    return sha256(bytes) === pin.sha256;
  } catch {
    return false;
  }
}

function sha256(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex');
}

async function readScopeDigest(
  config: BoxConfig,
  name: BoxScopeName,
  pin: BoxPin | undefined,
  emptyDigest: string | undefined
): Promise<{ stale: boolean; sourceDigest: string | null; blocked: boolean }> {
  try {
    const digest = await digestScopeSources({
      scope: name,
      roots: config.scopes[name].roots,
      grokHome: config.grokHome,
    });
    const unchangedEmpty =
      !pin &&
      emptyDigest !== undefined &&
      digest.sourceDigest === emptyDigest &&
      !digest.missingRoot;
    const stale = pin
      ? digest.sourceDigest === null || digest.sourceDigest !== pin.sourceDigest
      : !unchangedEmpty && digest.sourceDigest !== null && !digest.missingRoot;
    return {
      stale,
      sourceDigest: digest.sourceDigest,
      blocked: false,
    };
  } catch (error) {
    if (error instanceof BoxError && error.code === 'BOX_SECRET') {
      return { stale: true, sourceDigest: null, blocked: true };
    }
    throw error;
  }
}

async function sourcesChanged(config: BoxConfig): Promise<boolean> {
  const pins = await readPins(config.output);
  for (const name of SCOPE_NAMES) {
    const digest = await readScopeDigest(
      config,
      name,
      pins.scopes[name],
      pins.emptyDigests?.[name]
    );
    if (digest.blocked || digest.stale) return true;
  }
  return false;
}

type StoredAutoRebuild = {
  version: 1;
  at: string;
  ok: boolean;
  reason?: string;
};

function autoRebuildPath(output: string): string {
  return path.join(output, 'auto-rebuild.json');
}

async function readAutoRebuild(output: string): Promise<BoxAutoRebuild | null> {
  try {
    const parsed = JSON.parse(
      await readFile(autoRebuildPath(output), 'utf8')
    ) as StoredAutoRebuild;
    if (
      !parsed ||
      parsed.version !== 1 ||
      typeof parsed.at !== 'string' ||
      typeof parsed.ok !== 'boolean'
    ) {
      return null;
    }
    return parsed.reason
      ? { at: parsed.at, ok: parsed.ok, reason: parsed.reason }
      : { at: parsed.at, ok: parsed.ok };
  } catch {
    return null;
  }
}

async function writeAutoRebuild(
  output: string,
  record: StoredAutoRebuild
): Promise<void> {
  await mkdir(output, { recursive: true, mode: 0o700 });
  const body: StoredAutoRebuild = record.reason
    ? record
    : { version: 1, at: record.at, ok: record.ok };
  await writeFile(
    autoRebuildPath(output),
    `${JSON.stringify(body, null, 2)}\n`,
    {
      mode: 0o600,
    }
  );
}

function withinAutoRebuildInterval(record: BoxAutoRebuild, now: Date): boolean {
  const at = Date.parse(record.at);
  if (!Number.isFinite(at)) return false;
  const delta = now.getTime() - at;
  return delta >= 0 && delta < AUTO_REBUILD_INTERVAL_MS;
}

function rebuildReason(error: unknown): string {
  const message = error instanceof Error ? error.message : 'rebuild failed';
  const flat = message.replace(/\s+/g, ' ').trim() || 'rebuild failed';
  return flat.length > 180 ? `${flat.slice(0, 177)}...` : flat;
}
