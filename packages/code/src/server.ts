import { McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import {
  codeImageBuild,
  codeImageExpand,
  codeImageQuery,
  codeImageStatus,
  codeImageStructure,
} from './tools.js';

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const kinds = z.enum(['structure', 'class', 'method', 'function', 'export']);

export function createCodeMcpServer(): McpServer {
  const server = new McpServer({ name: 'knolo-code', version: '0.1.0' });

  server.registerTool(
    'code_image_status',
    {
      description:
        'Report whether the local code Knowledge Image pin exists. Call this before reading whole source files.',
      inputSchema: z.object({
        root: z.string().min(1).optional(),
      }),
      annotations: readOnly,
    },
    async ({ root }) => respond(await codeImageStatus(root))
  );

  server.registerTool(
    'code_image_build',
    {
      description:
        'Rebuild the local V4 code Knowledge Image for a workspace. The raw sources stay on disk. The image stores chunks and structure skeletons.',
      inputSchema: z.object({
        root: z.string().min(1).optional(),
      }),
      annotations: {
        readOnlyHint: false,
        destructiveHint: false,
        idempotentHint: true,
        openWorldHint: false,
      },
    },
    async ({ root }) => respond(await codeImageBuild(root))
  );

  server.registerTool(
    'code_image_query',
    {
      description:
        'Search the code image for a few lexical chunks. Prefer this after code_image_structure. Query expansion and embeddings are off.',
      inputSchema: z.object({
        query: z.string().min(1),
        root: z.string().min(1).optional(),
        topK: z.number().int().min(1).max(20).optional(),
        path: z.string().min(1).optional(),
        type: kinds.optional(),
      }),
      annotations: readOnly,
    },
    async (input) => respond(await codeImageQuery(input))
  );

  server.registerTool(
    'code_image_structure',
    {
      description:
        'Return the signature skeleton for one file path or symbol. It is much smaller than the file.',
      inputSchema: z.object({
        pathOrSymbol: z.string().min(1),
        root: z.string().min(1).optional(),
      }),
      annotations: readOnly,
    },
    async ({ pathOrSymbol, root }) =>
      respond(await codeImageStructure(pathOrSymbol, root))
  );

  server.registerTool(
    'code_image_expand',
    {
      description:
        'Return one chunk, or a UTF-8 byte range inside that chunk, after the agent has chosen an id.',
      inputSchema: z.object({
        chunkId: z.string().min(1),
        root: z.string().min(1).optional(),
        start: z.number().int().min(0).optional(),
        end: z.number().int().min(0).optional(),
      }),
      annotations: readOnly,
    },
    async (input) => respond(await codeImageExpand(input))
  );

  return server;
}

function respond(result: { ok: boolean }): {
  content: Array<{ type: 'text'; text: string }>;
  isError?: boolean;
} {
  const text = JSON.stringify(result);
  if (result.ok) return { content: [{ type: 'text', text }] };
  return { isError: true, content: [{ type: 'text', text }] };
}
