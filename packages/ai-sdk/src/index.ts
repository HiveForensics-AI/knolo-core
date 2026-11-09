import { KarError } from '@knolo/core/kar';
import {
  KNOLO_SEARCH_DESCRIPTION,
  KnoloOpenClawService,
  KnoloPluginError,
} from '@knolo/tools';
import { tool, type ToolSet } from 'ai';
import * as z from 'zod/v4';
import {
  knoloPluginConfig,
  loadKnoloAiSdkConfigFile as readKnoloAiSdkConfigFile,
  parseKnoloAiSdkConfig,
  type KnoloAiSdkConfig,
} from './config.js';
import {
  CORTEX_VERIFY_STATEMENT,
  evaluateEvidence,
  KAR_SATISFIED_STATEMENT,
  verifyCortexEvidence,
  verifyEvidence,
} from './evidence.js';
import { pinConfiguredGraphs, type PinnedKarGraph } from './graphs.js';

export type { KnoloAiSdkConfig };

const planSchema = z.record(z.string(), z.unknown());

function toolFailure(error: unknown): Error {
  if (error instanceof KarError) {
    return new Error(`QUERY_INVALID: ${error.message}`);
  }
  if (error instanceof KnoloPluginError) {
    return new Error(`${error.code}: ${error.message}`);
  }
  return new Error('IMAGE_UNAVAILABLE: Knolo request failed.');
}

function callerFrom(config: KnoloAiSdkConfig) {
  return { agentId: config.agentId };
}

async function run<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toolFailure(error);
  }
}

function knoloToolSet(
  config: KnoloAiSdkConfig,
  service: KnoloOpenClawService,
  graphs: ReadonlyMap<string, PinnedKarGraph>
): ToolSet {
  const caller = callerFrom(config);
  const tools: ToolSet = {
    knolo_search: tool({
      description: KNOLO_SEARCH_DESCRIPTION,
      inputSchema: z.object({
        query: z.string().min(1),
        imageIds: z.array(z.string().min(1)).optional(),
        limit: z.number().int().min(1).optional(),
      }),
      execute: async ({ query, imageIds, limit }) =>
        run(() =>
          service.search(
            {
              query,
              ...(imageIds === undefined ? {} : { imageIds }),
              ...(limit === undefined
                ? {}
                : { limit: Math.min(limit, config.maxHits) }),
            },
            caller
          )
        ),
    }),
    knolo_get: tool({
      description:
        'Read an authorized Knolo evidence object at the state root returned by search.',
      inputSchema: z.object({
        imageId: z.string().min(1),
        objectId: z.string().min(1),
        stateRoot: z.string().min(1),
        start: z.number().int().min(0).optional(),
        end: z.number().int().min(0).optional(),
      }),
      execute: async ({ imageId, objectId, stateRoot, start, end }) =>
        run(() =>
          service.get(
            {
              imageId,
              objectId,
              stateRoot,
              ...(start === undefined ? {} : { start }),
              ...(end === undefined ? {} : { end }),
            },
            caller
          )
        ),
    }),
    knolo_verify: tool({
      description:
        'Verify the local bytes and V5 roots for approved Knolo Knowledge Images. A matching pin stays valid when sources are stale. stale is set only when the mount records source roots.',
      inputSchema: z.object({
        imageId: z.string().min(1).optional(),
      }),
      execute: async ({ imageId }) =>
        run(async () => ({
          results: await service.verify(imageId, caller),
        })),
    }),
    knolo_status: tool({
      description:
        'Show the caller-visible, verified Knolo Knowledge Image mounts. When a mount records source roots, the result includes builtAt and whether those sources are stale.',
      inputSchema: z.object({}),
      execute: async () =>
        run(async () => ({
          mounts: await service.statusWithFreshness(caller),
        })),
    }),
  };

  if (graphs.size === 0) return tools;

  tools.knolo_kar_evaluate = tool({
    description: `Evaluate a proposition against a pinned KAR graph. ${KAR_SATISFIED_STATEMENT}`,
    inputSchema: z.object({
      mountId: z.string().min(1),
      proposition: z.string().min(1),
      plan: planSchema,
    }),
    execute: async ({ mountId, proposition, plan }) =>
      run(() =>
        evaluateEvidence({
          service,
          graphs,
          caller,
          mountId,
          proposition,
          plan,
        })
      ),
  });

  tools.knolo_kar_verify = tool({
    description:
      'Verify a KAR result or dossier against the pinned image and graph.',
    inputSchema: z
      .object({
        mountId: z.string().min(1),
        proposition: z.string().min(1),
        plan: planSchema,
        result: z.record(z.string(), z.unknown()).optional(),
        dossier: z
          .object({
            manifest: z.unknown(),
            certificate: z.unknown(),
            evaluation: z.unknown().optional(),
            evidenceMarkdown: z.string().optional(),
          })
          .optional(),
      })
      .superRefine((value, context) => {
        const selected =
          Number(value.result !== undefined) +
          Number(value.dossier !== undefined);
        if (selected !== 1) {
          context.addIssue({
            code: 'custom',
            message: 'Provide exactly one of result or dossier.',
          });
        }
      }),
    execute: async ({ mountId, proposition, plan, result, dossier }) =>
      run(() =>
        verifyEvidence({
          service,
          graphs,
          caller,
          mountId,
          proposition,
          plan,
          ...(result === undefined ? {} : { result }),
          ...(dossier === undefined ? {} : { dossier }),
        })
      ),
  });

  tools.knolo_cortex_verify = tool({
    description: `Verify a Cortex trace against a pinned Knowledge Image. ${CORTEX_VERIFY_STATEMENT}`,
    inputSchema: z.object({
      mountId: z.string().min(1),
      question: z.string().min(1).optional(),
      answer: z.record(z.string(), z.unknown()),
    }),
    execute: async ({ mountId, question, answer }) =>
      run(() =>
        verifyCortexEvidence({
          service,
          graphs,
          caller,
          mountId,
          ...(question === undefined ? {} : { question }),
          answer,
        })
      ),
  });

  return tools;
}

export async function loadKnoloAiSdkConfigFile(
  filePath: string
): Promise<KnoloAiSdkConfig> {
  try {
    return await readKnoloAiSdkConfigFile(filePath);
  } catch (error) {
    throw toolFailure(error);
  }
}

export async function knoloTools(input: unknown): Promise<ToolSet> {
  try {
    const config = parseKnoloAiSdkConfig(input);
    const service = await KnoloOpenClawService.create(
      knoloPluginConfig(config)
    );
    const graphs = await pinConfiguredGraphs(config, service);
    return knoloToolSet(config, service, graphs);
  } catch (error) {
    throw toolFailure(error);
  }
}
