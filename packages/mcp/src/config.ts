import { readFile } from 'node:fs/promises';
import path from 'node:path';
import {
  DEFAULT_MAX_AUDIT_BYTES,
  DEFAULT_MAX_AUDIT_RECORDS,
  DEFAULT_MAX_EXCERPT_BYTES,
  DEFAULT_MAX_HITS,
  DEFAULT_MAX_IMAGE_BYTES,
  DEFAULT_MAX_QUERY_BYTES,
  KnoloPluginError,
  type KnoloPluginConfig,
} from '@knolo/tools';
import * as z from 'zod/v4';

const ID_PATTERN = /^[a-zA-Z0-9_.-]+$/;
const SHA256_PATTERN = /^[a-f0-9]{64}$/;
const ROOT_PATTERN = /^sha256-[a-f0-9]{64}$/;

const karMountSchema = z
  .object({
    graphPath: z.string().min(1),
    graphSha256: z.string().regex(SHA256_PATTERN),
  })
  .strict();

const mountSchema = z
  .object({
    id: z.string().regex(ID_PATTERN),
    path: z.string().min(1),
    sha256: z.string().regex(SHA256_PATTERN),
    stateRoot: z.string().regex(ROOT_PATTERN),
    policyPath: z.string().min(1),
    agents: z.array(z.string().regex(ID_PATTERN)).min(1),
    principal: z.string().min(1),
    kar: karMountSchema.optional(),
  })
  .strict();

export const knoloMcpConfigSchema = z
  .object({
    agentId: z.string().regex(ID_PATTERN).default('mcp'),
    auditDir: z.string().min(1),
    mounts: z.array(mountSchema).min(1),
    maxImageBytes: z
      .number()
      .int()
      .min(1)
      .max(512 * 1024 * 1024)
      .default(DEFAULT_MAX_IMAGE_BYTES),
    maxHits: z.number().int().min(1).max(1000).default(DEFAULT_MAX_HITS),
    maxExcerptBytes: z
      .number()
      .int()
      .min(1)
      .max(64 * 1024)
      .default(DEFAULT_MAX_EXCERPT_BYTES),
    maxQueryBytes: z
      .number()
      .int()
      .min(1)
      .max(16 * 1024)
      .default(DEFAULT_MAX_QUERY_BYTES),
    maxAuditRecords: z
      .number()
      .int()
      .min(1)
      .max(1_000_000)
      .default(DEFAULT_MAX_AUDIT_RECORDS),
    maxAuditBytes: z
      .number()
      .int()
      .min(1)
      .max(1024 * 1024 * 1024)
      .default(DEFAULT_MAX_AUDIT_BYTES),
  })
  .strict()
  .superRefine((config, context) => {
    if (!path.isAbsolute(config.auditDir)) {
      context.addIssue({
        code: 'custom',
        path: ['auditDir'],
        message: 'auditDir must be an absolute path.',
      });
    }
    config.mounts.forEach((mount, index) => {
      if (!path.isAbsolute(mount.path)) {
        context.addIssue({
          code: 'custom',
          path: ['mounts', index, 'path'],
          message: 'mount path must be an absolute path.',
        });
      }
      if (!path.isAbsolute(mount.policyPath)) {
        context.addIssue({
          code: 'custom',
          path: ['mounts', index, 'policyPath'],
          message: 'policyPath must be an absolute path.',
        });
      }
      if (mount.kar && !path.isAbsolute(mount.kar.graphPath)) {
        context.addIssue({
          code: 'custom',
          path: ['mounts', index, 'kar', 'graphPath'],
          message: 'graphPath must be an absolute path.',
        });
      }
    });
  });

export type KnoloMcpConfig = z.infer<typeof knoloMcpConfigSchema>;

export function parseKnoloMcpConfig(input: unknown): KnoloMcpConfig {
  const parsed = knoloMcpConfigSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => {
        const place = issue.path.length ? issue.path.join('.') : 'config';
        return `${place}: ${issue.message}`;
      })
      .join('; ');
    throw new KnoloPluginError(
      'IMAGE_INVALID',
      `Knolo MCP config is invalid: ${detail}`
    );
  }
  return parsed.data;
}

export function knoloPluginConfig(config: KnoloMcpConfig): KnoloPluginConfig {
  return {
    mounts: config.mounts.map((mount) => ({
      id: mount.id,
      path: mount.path,
      sha256: mount.sha256,
      stateRoot: mount.stateRoot,
      policyPath: mount.policyPath,
      agents: mount.agents,
      principal: mount.principal,
    })),
    auditDir: config.auditDir,
    maxImageBytes: config.maxImageBytes,
    maxHits: config.maxHits,
    maxExcerptBytes: config.maxExcerptBytes,
    maxQueryBytes: config.maxQueryBytes,
    maxAuditRecords: config.maxAuditRecords,
    maxAuditBytes: config.maxAuditBytes,
  };
}

export function configPathFromArgs(
  argv: readonly string[],
  env: NodeJS.ProcessEnv
): string {
  let fromFlag: string | undefined;
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === '--config') {
      const value = argv[index + 1];
      if (!value || value.startsWith('--')) {
        throw new KnoloPluginError(
          'QUERY_INVALID',
          '--config requires an absolute path.'
        );
      }
      fromFlag = value;
      index += 1;
      continue;
    }
    throw new KnoloPluginError('QUERY_INVALID', `Unknown argument ${arg}.`);
  }
  const selected = fromFlag ?? env.KNOLO_MCP_CONFIG;
  if (typeof selected !== 'string' || !selected) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      'Set --config or KNOLO_MCP_CONFIG to an absolute config path.'
    );
  }
  if (!path.isAbsolute(selected)) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      'Knolo MCP config path must be absolute.'
    );
  }
  return selected;
}

export async function loadKnoloMcpConfigFile(
  filePath: string
): Promise<KnoloMcpConfig> {
  if (!path.isAbsolute(filePath)) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      'Knolo MCP config path must be absolute.'
    );
  }
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new KnoloPluginError(
      'IMAGE_UNAVAILABLE',
      `Could not read Knolo MCP config: ${
        error instanceof Error ? error.message : 'unknown error'
      }`
    );
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch {
    throw new KnoloPluginError(
      'IMAGE_INVALID',
      'Knolo MCP config is not valid JSON.'
    );
  }
  return parseKnoloMcpConfig(parsed);
}
