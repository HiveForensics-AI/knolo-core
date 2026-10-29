import { type KnoloOpenClawService } from '@knolo/tools';
import { type McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { PinnedKarGraph } from './graphs.js';
import { registerKarTools } from './kar-tools.js';
import { callerFrom, failure, success } from './tool-response.js';

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export function registerKnoloTools(
  server: McpServer,
  options: {
    service: KnoloOpenClawService;
    agentId: string;
    maxHits: number;
    graphs: ReadonlyMap<string, PinnedKarGraph>;
  }
): void {
  const { service, agentId, maxHits, graphs } = options;

  server.registerTool(
    'knolo_search',
    {
      description: 'Search approved, verified Knolo Knowledge Images.',
      inputSchema: z.object({
        query: z.string().min(1),
        imageIds: z.array(z.string().min(1)).optional(),
        limit: z.number().int().min(1).optional(),
      }),
      annotations: readOnly,
    },
    async ({ query, imageIds, limit }) => {
      try {
        const result = await service.search(
          {
            query,
            ...(imageIds === undefined ? {} : { imageIds }),
            ...(limit === undefined ? {} : { limit: Math.min(limit, maxHits) }),
          },
          callerFrom(server, agentId)
        );
        return success(result);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'knolo_get',
    {
      description:
        'Read an authorized Knolo evidence object at the state root returned by search.',
      inputSchema: z.object({
        imageId: z.string().min(1),
        objectId: z.string().min(1),
        stateRoot: z.string().min(1),
        start: z.number().int().min(0).optional(),
        end: z.number().int().min(0).optional(),
      }),
      annotations: readOnly,
    },
    async ({ imageId, objectId, stateRoot, start, end }) => {
      try {
        const result = await service.get(
          {
            imageId,
            objectId,
            stateRoot,
            ...(start === undefined ? {} : { start }),
            ...(end === undefined ? {} : { end }),
          },
          callerFrom(server, agentId)
        );
        return success(result);
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'knolo_verify',
    {
      description:
        'Verify the local bytes and V5 roots for approved Knolo Knowledge Images.',
      inputSchema: z.object({
        imageId: z.string().min(1).optional(),
      }),
      annotations: readOnly,
    },
    async ({ imageId }) => {
      try {
        const results = await service.verify(
          imageId,
          callerFrom(server, agentId)
        );
        return success({ results });
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'knolo_status',
    {
      description:
        'Show the caller-visible, verified Knolo Knowledge Image mounts.',
      inputSchema: z.object({}),
      annotations: readOnly,
    },
    async () => {
      try {
        return success({ mounts: service.status(callerFrom(server, agentId)) });
      } catch (error) {
        return failure(error);
      }
    }
  );

  if (graphs.size > 0) {
    registerKarTools(server, { service, agentId, graphs });
  }
}
