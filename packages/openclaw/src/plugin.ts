import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin';
import { Type } from 'typebox';
import {
  KnoloOpenClawService,
  KnoloPluginError,
  type KnoloCaller,
  type KnoloPluginConfig,
} from './index.js';

const services = new Map<string, Promise<KnoloOpenClawService>>();

export default defineToolPlugin({
  id: 'knolo',
  name: 'Knolo',
  description: 'Verified local Knowledge Image retrieval for OpenClaw agents.',
  configSchema: Type.Object({
    mounts: Type.Array(
      Type.Object({
        id: Type.String({ minLength: 1 }),
        path: Type.String({ minLength: 1 }),
        sha256: Type.String({ pattern: '^[a-f0-9]{64}$' }),
        stateRoot: Type.String({ pattern: '^sha256-[a-f0-9]{64}$' }),
        policyPath: Type.String({ minLength: 1 }),
        agents: Type.Array(Type.String({ minLength: 1 }), { minItems: 1 }),
        principal: Type.String({ minLength: 1 }),
      }),
      { minItems: 1 }
    ),
    maxImageBytes: Type.Optional(Type.Integer({ minimum: 1 })),
    maxHits: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    maxExcerptBytes: Type.Optional(Type.Integer({ minimum: 1 })),
    maxQueryBytes: Type.Optional(Type.Integer({ minimum: 1 })),
    auditDir: Type.String({ minLength: 1 }),
  }),
  tools: (tool) => [
    tool({
      name: 'knolo_search',
      description: 'Search approved, verified Knolo Knowledge Images.',
      parameters: Type.Object({
        query: Type.String({ minLength: 1 }),
        imageIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
        limit: Type.Optional(Type.Integer({ minimum: 1 })),
      }),
      async execute(parameters, config, context) {
        return (await serviceFor(config)).search(
          parameters as never,
          callerFrom(context)
        );
      },
    }),
    tool({
      name: 'knolo_get',
      description:
        'Read an authorized Knolo evidence object at the state root returned by search.',
      parameters: Type.Object({
        imageId: Type.String({ minLength: 1 }),
        objectId: Type.String({ minLength: 1 }),
        stateRoot: Type.String({ minLength: 1 }),
        start: Type.Optional(Type.Integer({ minimum: 0 })),
        end: Type.Optional(Type.Integer({ minimum: 0 })),
      }),
      async execute(parameters, config, context) {
        return (await serviceFor(config)).get(
          parameters as never,
          callerFrom(context)
        );
      },
    }),
    tool({
      name: 'knolo_verify',
      description:
        'Verify the local bytes and V5 roots for approved Knolo Knowledge Images.',
      parameters: Type.Object({
        imageId: Type.Optional(Type.String({ minLength: 1 })),
      }),
      async execute(parameters, config, context) {
        return (await serviceFor(config)).verify(
          (parameters as { imageId?: string }).imageId,
          callerFrom(context)
        );
      },
    }),
    tool({
      name: 'knolo_status',
      description:
        'Show the caller-visible, verified Knolo Knowledge Image mounts.',
      parameters: Type.Object({}),
      async execute(_parameters, config, context) {
        return (await serviceFor(config)).status(callerFrom(context));
      },
    }),
  ],
});

function serviceFor(config: unknown): Promise<KnoloOpenClawService> {
  const typed = config as KnoloPluginConfig;
  const key = JSON.stringify(typed);
  let service = services.get(key);
  if (!service) {
    service = KnoloOpenClawService.create(typed);
    services.set(key, service);
  }
  return service;
}

function callerFrom(context: unknown): KnoloCaller {
  const value = context as
    | {
        agentId?: unknown;
        runId?: unknown;
        sessionId?: unknown;
        memoryAudience?: { agentId?: unknown; sessionId?: unknown };
      }
    | undefined;
  const agentId = value?.memoryAudience?.agentId ?? value?.agentId;
  if (typeof agentId !== 'string' || !agentId) {
    throw new KnoloPluginError(
      'ACCESS_DENIED',
      'OpenClaw did not provide a trusted agent identity.'
    );
  }
  return {
    agentId,
    ...(typeof value?.runId === 'string' ? { runId: value.runId } : {}),
    ...(typeof value?.memoryAudience?.sessionId === 'string'
      ? { sessionId: value.memoryAudience.sessionId }
      : typeof value?.sessionId === 'string'
        ? { sessionId: value.sessionId }
        : {}),
  };
}
