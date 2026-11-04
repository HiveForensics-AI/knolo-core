import { createHash } from 'node:crypto';
import { access, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { createKnowledgeImageV5, type KnowledgePolicyV1 } from '@knolo/core';
import { SCOPE_NAMES, type BoxConfig, type BoxScopeName } from './config.js';
import { collectCorpora, utf8 } from './sources.js';

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
};

export type BoxScopeStatus = {
  id: BoxScopeName;
  stateRoot: string;
  builtAt: string;
  pinMatches: boolean;
};

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
  await writeFile(policyPath, `${JSON.stringify(policy, null, 2)}\n`, {
    mode: 0o600,
  });
  const scopes: BoxPins['scopes'] = {};
  const skipped = corpora.flatMap((corpus) => corpus.skipped);
  for (const corpus of corpora) {
    if (corpus.chunks.length === 0) continue;
    const prior = previous.scopes[corpus.scope];
    if (prior && prior.sourceDigest === corpus.sourceDigest) {
      try {
        await access(path.join(config.output, `${corpus.scope}.v5`));
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
    const imagePath = path.join(config.output, `${corpus.scope}.v5`);
    await writeFile(imagePath, image.bytes, { mode: 0o600 });
    scopes[corpus.scope] = {
      sha256: sha256(image.bytes),
      stateRoot: image.stateRoot,
      builtAt: now.toISOString(),
      sourceDigest: corpus.sourceDigest,
    };
  }
  const pins: BoxPins = { version: 1, scopes, skipped };
  await writeFile(
    path.join(config.output, 'pins.json'),
    `${JSON.stringify(pins, null, 2)}\n`,
    {
      mode: 0o600,
    }
  );
  await writeMcpConfigs(config, pins, policyPath, auditDir);
  return pins;
}

export async function boxStatus(config: BoxConfig): Promise<BoxScopeStatus[]> {
  const pins = await readPins(config.output);
  const scopes: BoxScopeStatus[] = [];
  for (const name of SCOPE_NAMES) {
    const pin = pins.scopes[name];
    if (!pin) continue;
    scopes.push({
      id: name,
      stateRoot: pin.stateRoot,
      builtAt: pin.builtAt,
      pinMatches: await pinMatches(config.output, name, pin),
    });
  }
  return scopes;
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
        agents: PRIVATE_SCOPES.has(name) ? ['box'] : config.agents,
        principal: 'box:reader',
      },
    ];
  });
  return {
    agentId: 'box',
    auditDir,
    maxAuditRecords: MAX_AUDIT_RECORDS,
    maxAuditBytes: MAX_AUDIT_BYTES,
    mounts,
  };
}

async function writeMcpConfigs(
  config: BoxConfig,
  pins: BoxPins,
  policyPath: string,
  auditDir: string
): Promise<void> {
  const primary = mcpConfig(config, pins, policyPath, auditDir, false);
  await writeConfigOrRemove(
    path.join(config.output, 'knolo-mcp.json'),
    primary
  );
  const shared = mcpConfig(config, pins, policyPath, auditDir, true);
  await writeConfigOrRemove(
    path.join(config.output, 'knolo-mcp-shared.json'),
    shared
  );
}

async function writeConfigOrRemove(
  filePath: string,
  value: { mounts: unknown[] }
): Promise<void> {
  if (value.mounts.length === 0) {
    await rm(filePath, { force: true });
    return;
  }
  await writeFile(filePath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
}

async function readPins(output: string): Promise<BoxPins> {
  try {
    const parsed = JSON.parse(
      await readFile(path.join(output, 'pins.json'), 'utf8')
    ) as BoxPins;
    if (!parsed || parsed.version !== 1 || !parsed.scopes) {
      return { version: 1, scopes: {}, skipped: [] };
    }
    return {
      version: 1,
      scopes: parsed.scopes,
      skipped: Array.isArray(parsed.skipped) ? parsed.skipped : [],
    };
  } catch {
    return { version: 1, scopes: {}, skipped: [] };
  }
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
