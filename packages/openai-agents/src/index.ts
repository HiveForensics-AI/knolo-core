import { KarError } from '@knolo/core/kar';
import {
  KNOLO_SEARCH_DESCRIPTION,
  KnoloOpenClawService,
  KnoloPluginError,
} from '@knolo/tools';
import { tool, type FunctionTool } from '@openai/agents';
import * as z from 'zod/v4';
import {
  knoloPluginConfig,
  loadKnoloOpenAIAgentsConfigFile as readKnoloOpenAIAgentsConfigFile,
  parseKnoloOpenAIAgentsConfig,
  type KnoloOpenAIAgentsConfig,
} from './config.js';
import {
  CORTEX_VERIFY_STATEMENT,
  evaluateEvidence,
  KAR_SATISFIED_STATEMENT,
  verifyCortexEvidence,
  verifyEvidence,
} from './evidence.js';
import { pinConfiguredGraphs, type PinnedKarGraph } from './graphs.js';

export type { KnoloOpenAIAgentsConfig };

type KnoloTool = FunctionTool<unknown, any, unknown>;

function toolFailure(error: unknown): Error {
  if (error instanceof KarError) {
    return new Error(`QUERY_INVALID: ${error.message}`);
  }
  if (error instanceof KnoloPluginError) {
    return new Error(`${error.code}: ${error.message}`);
  }
  return new Error('IMAGE_UNAVAILABLE: Knolo request failed.');
}

function reportToolError(_context: unknown, error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  return 'IMAGE_UNAVAILABLE: Knolo request failed.';
}

function callerFrom(config: KnoloOpenAIAgentsConfig) {
  return { agentId: config.agentId };
}

function omitted(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}

async function run<T>(work: () => Promise<T> | T): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw toolFailure(error);
  }
}

function readRecord(input: unknown, label: string): Record<string, unknown> {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      `${label} must be a JSON object.`
    );
  }
  return input as Record<string, unknown>;
}

function requireText(value: unknown, label: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      `${label} must be a non-empty string.`
    );
  }
  return value;
}

const searchParameters = z.object({
  query: z.string().min(1),
  imageIds: z.array(z.string().min(1)).nullable().optional(),
  limit: z.number().int().min(1).nullable().optional(),
});

const getParameters = z.object({
  imageId: z.string().min(1),
  objectId: z.string().min(1),
  stateRoot: z.string().min(1),
  start: z.number().int().min(0).nullable().optional(),
  end: z.number().int().min(0).nullable().optional(),
});

const verifyParameters = z.object({
  imageId: z.string().min(1).nullable().optional(),
});

const statusParameters = z.object({});

// A KAR plan is an open object. The Agents SDK strict schema rejects that
// shape, so these tools keep the object and turn strict mode off. The
// published parameter type for strict:false also requires additionalProperties
// true at the root. The cast keeps the runtime schema closed.
type OpenToolSchema = {
  type: 'object';
  properties: Record<string, Record<string, unknown>>;
  required: string[];
  additionalProperties: true;
};

function openParameters(schema: {
  type: 'object';
  additionalProperties: false;
  properties: Record<string, object>;
  required: readonly string[];
}): OpenToolSchema {
  return schema as unknown as OpenToolSchema;
}

const karEvaluateParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mountId: { type: 'string' },
    proposition: { type: 'string' },
    plan: { type: 'object', additionalProperties: true },
  },
  required: ['mountId', 'proposition', 'plan'],
} as const;

const karVerifyParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mountId: { type: 'string' },
    proposition: { type: 'string' },
    plan: { type: 'object', additionalProperties: true },
    result: { type: ['object', 'null'], additionalProperties: true },
    dossier: { type: ['object', 'null'], additionalProperties: true },
  },
  required: ['mountId', 'proposition', 'plan'],
} as const;

const cortexVerifyParameters = {
  type: 'object',
  additionalProperties: false,
  properties: {
    mountId: { type: 'string' },
    question: { type: ['string', 'null'] },
    answer: { type: 'object', additionalProperties: true },
  },
  required: ['mountId', 'answer'],
} as const;

function knoloToolSet(
  config: KnoloOpenAIAgentsConfig,
  service: KnoloOpenClawService,
  graphs: ReadonlyMap<string, PinnedKarGraph>
): Record<string, KnoloTool> {
  const caller = callerFrom(config);
  const tools: Record<string, KnoloTool> = {
    knolo_search: tool({
      name: 'knolo_search',
      description: KNOLO_SEARCH_DESCRIPTION,
      parameters: searchParameters,
      errorFunction: reportToolError,
      execute: async ({ query, imageIds, limit }) =>
        run(() =>
          service.search(
            {
              query,
              ...(omitted(imageIds) ? {} : { imageIds }),
              ...(omitted(limit)
                ? {}
                : { limit: Math.min(limit, config.maxHits) }),
            },
            caller
          )
        ),
    }),
    knolo_get: tool({
      name: 'knolo_get',
      description:
        'Read an authorized Knolo evidence object at the state root returned by search.',
      parameters: getParameters,
      errorFunction: reportToolError,
      execute: async ({ imageId, objectId, stateRoot, start, end }) =>
        run(() =>
          service.get(
            {
              imageId,
              objectId,
              stateRoot,
              ...(omitted(start) ? {} : { start }),
              ...(omitted(end) ? {} : { end }),
            },
            caller
          )
        ),
    }),
    knolo_verify: tool({
      name: 'knolo_verify',
      description:
        'Verify the local bytes and V5 roots for approved Knolo Knowledge Images. A matching pin stays valid when sources are stale. builtAt and stale are set only when the mount records source roots.',
      parameters: verifyParameters,
      errorFunction: reportToolError,
      execute: async ({ imageId }) =>
        run(async () => ({
          results: await service.verify(
            omitted(imageId) ? undefined : imageId,
            caller
          ),
        })),
    }),
    knolo_status: tool({
      name: 'knolo_status',
      description:
        'Show the caller-visible, verified Knolo Knowledge Image mounts. When a mount records source roots, the result includes builtAt and whether those sources are stale.',
      parameters: statusParameters,
      errorFunction: reportToolError,
      execute: async () =>
        run(async () => ({
          mounts: await service.statusWithFreshness(caller),
        })),
    }),
  };

  if (graphs.size === 0) return tools;

  tools.knolo_kar_evaluate = tool({
    name: 'knolo_kar_evaluate',
    description: `Evaluate a proposition against a pinned KAR graph. ${KAR_SATISFIED_STATEMENT}`,
    strict: false,
    parameters: openParameters(karEvaluateParameters),
    errorFunction: reportToolError,
    execute: async (input) =>
      run(() => {
        const value = readRecord(input, 'knolo_kar_evaluate');
        return evaluateEvidence({
          service,
          graphs,
          caller,
          mountId: requireText(value.mountId, 'mountId'),
          proposition: requireText(value.proposition, 'proposition'),
          plan: value.plan,
        });
      }),
  });

  tools.knolo_kar_verify = tool({
    name: 'knolo_kar_verify',
    description:
      'Verify a KAR result or dossier against the pinned image and graph.',
    strict: false,
    parameters: openParameters(karVerifyParameters),
    errorFunction: reportToolError,
    execute: async (input) =>
      run(() => {
        const value = readRecord(input, 'knolo_kar_verify');
        const result = omitted(value.result) ? undefined : value.result;
        const dossier = omitted(value.dossier) ? undefined : value.dossier;
        return verifyEvidence({
          service,
          graphs,
          caller,
          mountId: requireText(value.mountId, 'mountId'),
          proposition: requireText(value.proposition, 'proposition'),
          plan: value.plan,
          ...(result === undefined
            ? {}
            : { result: readRecord(result, 'result') }),
          ...(dossier === undefined
            ? {}
            : {
                dossier: readRecord(dossier, 'dossier') as {
                  manifest: unknown;
                  certificate: unknown;
                  evaluation?: unknown;
                  evidenceMarkdown?: string;
                },
              }),
        });
      }),
  });

  tools.knolo_cortex_verify = tool({
    name: 'knolo_cortex_verify',
    description: `Verify a Cortex trace against a pinned Knowledge Image. ${CORTEX_VERIFY_STATEMENT}`,
    strict: false,
    parameters: openParameters(cortexVerifyParameters),
    errorFunction: reportToolError,
    execute: async (input) =>
      run(() => {
        const value = readRecord(input, 'knolo_cortex_verify');
        const question = omitted(value.question) ? undefined : value.question;
        return verifyCortexEvidence({
          service,
          graphs,
          caller,
          mountId: requireText(value.mountId, 'mountId'),
          ...(question === undefined
            ? {}
            : { question: requireText(question, 'question') }),
          answer: readRecord(value.answer, 'answer'),
        });
      }),
  });

  return tools;
}

export async function loadKnoloOpenAIAgentsConfigFile(
  filePath: string
): Promise<KnoloOpenAIAgentsConfig> {
  try {
    return await readKnoloOpenAIAgentsConfigFile(filePath);
  } catch (error) {
    throw toolFailure(error);
  }
}

export async function knoloTools(
  input: unknown
): Promise<Record<string, KnoloTool>> {
  try {
    const config = parseKnoloOpenAIAgentsConfig(input);
    const service = await KnoloOpenClawService.create(
      knoloPluginConfig(config)
    );
    const graphs = await pinConfiguredGraphs(config, service);
    return knoloToolSet(config, service, graphs);
  } catch (error) {
    throw toolFailure(error);
  }
}
