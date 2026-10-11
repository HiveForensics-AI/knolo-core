import { defineToolPlugin } from 'openclaw/plugin-sdk/tool-plugin';
import { Type } from 'typebox';
import {
  KnoloOpenClawService,
  type KnoloCaller,
  type KnoloPluginConfig,
} from './index.js';
import {
  assertToolContextCurrent,
  callerFromToolContext,
  executeWithCurrentToolContext,
  type KnoloToolContext,
} from './tool_context.js';

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
    maxImageBytes: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 512 * 1024 * 1024 })
    ),
    maxHits: Type.Optional(Type.Integer({ minimum: 1, maximum: 1000 })),
    maxExcerptBytes: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 64 * 1024 })
    ),
    maxQueryBytes: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 16 * 1024 })
    ),
    maxAuditRecords: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 1_000_000 })
    ),
    maxAuditBytes: Type.Optional(
      Type.Integer({ minimum: 1, maximum: 1024 * 1024 * 1024 })
    ),
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
      contextVersion: 2,
      factory({ api, toolContext }) {
        return createAuthorizedTool({
          name: 'knolo_search',
          description: 'Search approved, verified Knolo Knowledge Images.',
          parameters: Type.Object({
            query: Type.String({ minLength: 1 }),
            imageIds: Type.Optional(Type.Array(Type.String({ minLength: 1 }))),
            limit: Type.Optional(Type.Integer({ minimum: 1 })),
          }),
          config: api.pluginConfig,
          toolContext,
          operation: (service, parameters, caller, assertCurrent) =>
            service.search(parameters as never, caller, assertCurrent),
        });
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
      contextVersion: 2,
      factory({ api, toolContext }) {
        return createAuthorizedTool({
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
          config: api.pluginConfig,
          toolContext,
          operation: (service, parameters, caller) =>
            service.get(parameters as never, caller),
        });
      },
    }),
    tool({
      name: 'knolo_verify',
      description:
        'Verify the local bytes and V5 roots for approved Knolo Knowledge Images.',
      parameters: Type.Object({
        imageId: Type.Optional(Type.String({ minLength: 1 })),
      }),
      contextVersion: 2,
      factory({ api, toolContext }) {
        return createAuthorizedTool({
          name: 'knolo_verify',
          description:
            'Verify the local bytes and V5 roots for approved Knolo Knowledge Images.',
          parameters: Type.Object({
            imageId: Type.Optional(Type.String({ minLength: 1 })),
          }),
          config: api.pluginConfig,
          toolContext,
          operation: (service, parameters, caller) =>
            service.verify(
              (parameters as { imageId?: string }).imageId,
              caller
            ),
        });
      },
    }),
    tool({
      name: 'knolo_status',
      description:
        'Show the caller-visible, verified Knolo Knowledge Image mounts.',
      parameters: Type.Object({}),
      contextVersion: 2,
      factory({ api, toolContext }) {
        return createAuthorizedTool({
          name: 'knolo_status',
          description:
            'Show the caller-visible, verified Knolo Knowledge Image mounts.',
          parameters: Type.Object({}),
          config: api.pluginConfig,
          toolContext,
          operation: async (service, _parameters, caller) =>
            service.status(caller),
        });
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

function createAuthorizedTool({
  name,
  description,
  parameters,
  config,
  toolContext,
  operation,
}: {
  name: string;
  description: string;
  parameters: unknown;
  config: unknown;
  toolContext: KnoloToolContext;
  operation: (
    service: KnoloOpenClawService,
    parameters: unknown,
    caller: KnoloCaller,
    assertCurrent: () => void
  ) => Promise<unknown>;
}) {
  const caller = callerFromToolContext(toolContext);
  if (!caller) return null;
  return {
    name,
    description,
    parameters,
    async execute(
      _toolCallId: string,
      parameters: unknown,
      signal?: AbortSignal
    ) {
      const result = await executeWithCurrentToolContext(
        toolContext,
        async () => {
          signal?.throwIfAborted();
          const service = await serviceFor(config);
          const result = await operation(service, parameters, caller, () =>
            assertToolContextCurrent(toolContext)
          );
          signal?.throwIfAborted();
          return result;
        }
      );
      return {
        content: [{ type: 'text', text: JSON.stringify(result) }],
        details: result,
      };
    },
  };
}
