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
    builtAt: z.string().min(1).optional(),
    sourceDigest: z.string().regex(SHA256_PATTERN).optional(),
    sourceRoots: z.array(z.string().min(1)).min(1).optional(),
  })
  .strict();

export const knoloOpenAIAgentsConfigSchema = z
  .object({
    agentId: z.string().regex(ID_PATTERN).default('mcp'),
    grokHome: z.string().min(1).optional(),
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
    if (config.grokHome && !path.isAbsolute(config.grokHome)) {
      context.addIssue({
        code: 'custom',
        path: ['grokHome'],
        message: 'grokHome must be an absolute path.',
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
      mount.sourceRoots?.forEach((root, rootIndex) => {
        if (!path.isAbsolute(root)) {
          context.addIssue({
            code: 'custom',
            path: ['mounts', index, 'sourceRoots', rootIndex],
            message: 'source root must be an absolute path.',
          });
        }
      });
    });
  });

export type KnoloOpenAIAgentsConfig = z.infer<
  typeof knoloOpenAIAgentsConfigSchema
>;

export function parseKnoloOpenAIAgentsConfig(
  input: unknown
): KnoloOpenAIAgentsConfig {
  const parsed = knoloOpenAIAgentsConfigSchema.safeParse(input);
  if (!parsed.success) {
    const detail = parsed.error.issues
      .map((issue) => {
        const place = issue.path.length ? issue.path.join('.') : 'config';
        return `${place}: ${issue.message}`;
      })
      .join('; ');
    throw new KnoloPluginError(
      'IMAGE_INVALID',
      `Knolo config is invalid: ${detail}`
    );
  }
  return parsed.data;
}

export function knoloPluginConfig(
  config: KnoloOpenAIAgentsConfig
): KnoloPluginConfig {
  return {
    ...(config.grokHome ? { grokHome: config.grokHome } : {}),
    mounts: config.mounts.map((mount) => ({
      id: mount.id,
      path: mount.path,
      sha256: mount.sha256,
      stateRoot: mount.stateRoot,
      policyPath: mount.policyPath,
      agents: mount.agents,
      principal: mount.principal,
      ...(mount.builtAt ? { builtAt: mount.builtAt } : {}),
      ...(mount.sourceDigest ? { sourceDigest: mount.sourceDigest } : {}),
      ...(mount.sourceRoots ? { sourceRoots: mount.sourceRoots } : {}),
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

export async function loadKnoloOpenAIAgentsConfigFile(
  filePath: string
): Promise<KnoloOpenAIAgentsConfig> {
  if (!path.isAbsolute(filePath)) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      'Knolo config path must be absolute.'
    );
  }
  let text: string;
  try {
    text = await readFile(filePath, 'utf8');
  } catch (error) {
    throw new KnoloPluginError(
      'IMAGE_UNAVAILABLE',
      `Could not read Knolo config: ${
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
      'Knolo config is not valid JSON.'
    );
  }
  return parseKnoloOpenAIAgentsConfig(parsed);
}
