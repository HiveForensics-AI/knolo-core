import {
  KNOLO_KITE_EVALUATE_DESCRIPTION,
  KNOLO_KITE_VERIFY_DESCRIPTION,
  type KnoloKiteRequest,
  type KnoloOpenClawService,
} from '@knolo/tools';
import { type McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import { callerFrom, failure, success } from './tool-response.js';

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

const jsonObject = z.record(z.string(), z.unknown());

function omitted(value: unknown): value is null | undefined {
  return value === undefined || value === null;
}

function kiteRequest(value: {
  mountId: string;
  contract: Record<string, unknown>;
  rules: Record<string, unknown>;
  completeness?: Record<string, unknown> | null;
  changes?: Record<string, unknown> | null;
  bounds?: Record<string, unknown> | null;
  graph?: Record<string, unknown> | null;
  question?: string | null;
  asOf?: string | null;
}): KnoloKiteRequest {
  return {
    mountId: value.mountId,
    contract: value.contract,
    rules: value.rules,
    ...(omitted(value.completeness)
      ? {}
      : { completeness: value.completeness }),
    ...(omitted(value.changes) ? {} : { changes: value.changes }),
    ...(omitted(value.bounds) ? {} : { bounds: value.bounds }),
    ...(omitted(value.graph) ? {} : { graph: value.graph }),
    ...(omitted(value.question) ? {} : { question: value.question }),
    ...(omitted(value.asOf) ? {} : { asOf: value.asOf }),
  };
}

export function registerKiteTools(
  server: McpServer,
  options: {
    service: KnoloOpenClawService;
    agentId: string;
    sessionId?: string;
    prepare: () => Promise<void>;
  }
): void {
  const { service, agentId, sessionId, prepare } = options;
  const fields = {
    mountId: z.string().min(1),
    contract: jsonObject,
    rules: jsonObject,
    completeness: jsonObject.nullish(),
    changes: jsonObject.nullish(),
    bounds: jsonObject.nullish(),
    graph: jsonObject.nullish(),
    question: z.string().min(1).nullish(),
    asOf: z.string().min(1).nullish(),
  };

  server.registerTool(
    'knolo_kite_evaluate',
    {
      description: KNOLO_KITE_EVALUATE_DESCRIPTION,
      inputSchema: z.object(fields),
      annotations: readOnly,
    },
    async (args) => {
      try {
        await prepare();
        return success(
          await service.evaluateKite(
            kiteRequest(args),
            callerFrom(server, agentId, sessionId)
          )
        );
      } catch (error) {
        return failure(error);
      }
    }
  );

  server.registerTool(
    'knolo_kite_verify',
    {
      description: KNOLO_KITE_VERIFY_DESCRIPTION,
      inputSchema: z.object({ ...fields, certificate: jsonObject }),
      annotations: readOnly,
    },
    async (args) => {
      try {
        await prepare();
        return success(
          await service.verifyKite(
            { ...kiteRequest(args), certificate: args.certificate },
            callerFrom(server, agentId, sessionId)
          )
        );
      } catch (error) {
        return failure(error);
      }
    }
  );
}
