import { verifyCortexAnswer } from '@knolo/core/cortex';
import {
  evaluateKar,
  KarError,
  verifyKar,
  verifyKarDossier,
} from '@knolo/core/kar';
import { KnoloPluginError, type KnoloOpenClawService } from '@knolo/tools';
import { type McpServer } from '@modelcontextprotocol/server';
import * as z from 'zod/v4';
import type { PinnedKarGraph } from './graphs.js';
import { callerFrom, failure, success } from './tool-response.js';

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
} as const;

export const MAX_KAR_PLAN_BYTES = 65536;
export const KAR_SATISFIED_STATEMENT =
  'SATISFIED means evidence requirements were met. It does not mean a claim is proven.';
export const CORTEX_VERIFY_STATEMENT =
  'Verification checks that the trace matches the image. It does not mean the answer is true.';

const planSchema = z.record(z.string(), z.unknown());

function asToolError(error: unknown): unknown {
  if (error instanceof KarError) {
    return new KnoloPluginError('QUERY_INVALID', error.message);
  }
  return error;
}

function assertPlanSize(plan: unknown): void {
  let encoded: string;
  try {
    const serialized = JSON.stringify(plan);
    if (typeof serialized !== 'string') {
      throw new KnoloPluginError(
        'QUERY_INVALID',
        'KAR plan must be a JSON object.'
      );
    }
    encoded = serialized;
  } catch (error) {
    if (error instanceof KnoloPluginError) throw error;
    throw new KnoloPluginError(
      'QUERY_INVALID',
      'KAR plan must be a JSON object.'
    );
  }
  if (new TextEncoder().encode(encoded).length > MAX_KAR_PLAN_BYTES) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      `KAR plan exceeds ${MAX_KAR_PLAN_BYTES} UTF-8 bytes.`
    );
  }
}

function requireGraph(
  graphs: ReadonlyMap<string, PinnedKarGraph>,
  mountId: string
): PinnedKarGraph {
  const pinned = graphs.get(mountId);
  if (!pinned) {
    throw new KnoloPluginError(
      'IMAGE_UNAVAILABLE',
      `Mount ${mountId} has no pinned KAR graph.`
    );
  }
  return pinned;
}

function referencesKar(answer: unknown): boolean {
  if (!answer || typeof answer !== 'object' || Array.isArray(answer))
    return false;
  const evaluations = (answer as { karEvaluations?: unknown }).karEvaluations;
  return Array.isArray(evaluations) && evaluations.length > 0;
}

function questionOf(answer: unknown, supplied: string | undefined): string {
  if (supplied !== undefined) return supplied;
  if (
    answer &&
    typeof answer === 'object' &&
    'question' in answer &&
    typeof answer.question === 'string'
  ) {
    return answer.question;
  }
  return '';
}

export function registerKarTools(
  server: McpServer,
  options: {
    service: KnoloOpenClawService;
    agentId: string;
    graphs: ReadonlyMap<string, PinnedKarGraph>;
  }
): void {
  const { service, agentId, graphs } = options;

  server.registerTool(
    'knolo_kar_evaluate',
    {
      description: `Evaluate a proposition against a pinned KAR graph. ${KAR_SATISFIED_STATEMENT}`,
      inputSchema: z.object({
        mountId: z.string().min(1),
        proposition: z.string().min(1),
        plan: planSchema,
      }),
      annotations: readOnly,
    },
    async ({ mountId, proposition, plan }) => {
      try {
        assertPlanSize(plan);
        const caller = callerFrom(server, agentId);
        const mount = service.readAuthorizedMount(mountId, caller);
        const pinned = requireGraph(graphs, mountId);
        const evaluation = evaluateKar(pinned.session, { proposition, plan });
        const receipt = await service.writeEvidenceReceipt({
          imageId: mount.id,
          byteSha256: mount.byteSha256,
          stateRoot: mount.stateRoot,
          caller,
          tool: 'knolo_kar_evaluate',
          graphSha256: pinned.graphSha256,
          outcome: {
            status: evaluation.status,
            ...(evaluation.code ? { code: evaluation.code } : {}),
            roots: evaluation.certificate.roots,
          },
        });
        return success({
          status: evaluation.status,
          code: evaluation.code,
          evidenceIds: evaluation.selectedEvidence.map((item) => item.id),
          roots: evaluation.certificate.roots,
          statement: KAR_SATISFIED_STATEMENT,
          receiptId: receipt.receiptId,
        });
      } catch (error) {
        return failure(asToolError(error));
      }
    }
  );

  server.registerTool(
    'knolo_kar_verify',
    {
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
      annotations: readOnly,
    },
    async ({ mountId, proposition, plan, result, dossier }) => {
      try {
        assertPlanSize(plan);
        if ((result === undefined) === (dossier === undefined)) {
          throw new KnoloPluginError(
            'QUERY_INVALID',
            'Provide exactly one of result or dossier.'
          );
        }
        const caller = callerFrom(server, agentId);
        const mount = service.readAuthorizedMount(mountId, caller);
        const pinned = requireGraph(graphs, mountId);
        const verdict = dossier
          ? verifyKarDossier({
              image: mount.image,
              graph: pinned.graph,
              plan,
              proposition,
              manifest: dossier.manifest,
              certificate: dossier.certificate,
              ...(dossier.evaluation === undefined
                ? {}
                : { evaluation: dossier.evaluation }),
              ...(dossier.evidenceMarkdown === undefined
                ? {}
                : { evidenceMarkdown: dossier.evidenceMarkdown }),
            })
          : verifyKar({
              image: mount.image,
              graph: pinned.graph,
              proposition,
              plan,
              result,
            });
        const receipt = await service.writeEvidenceReceipt({
          imageId: mount.id,
          byteSha256: mount.byteSha256,
          stateRoot: mount.stateRoot,
          caller,
          tool: 'knolo_kar_verify',
          graphSha256: pinned.graphSha256,
          outcome: {
            ok: verdict.ok,
            code: verdict.code,
            ...(verdict.status ? { status: verdict.status } : {}),
          },
        });
        return success({
          ok: verdict.ok,
          code: verdict.code,
          reason: verdict.reason,
          receiptId: receipt.receiptId,
        });
      } catch (error) {
        return failure(asToolError(error));
      }
    }
  );

  server.registerTool(
    'knolo_cortex_verify',
    {
      description: `Verify a Cortex trace against a pinned Knowledge Image. ${CORTEX_VERIFY_STATEMENT}`,
      inputSchema: z.object({
        mountId: z.string().min(1),
        question: z.string().min(1).optional(),
        answer: z.record(z.string(), z.unknown()),
      }),
      annotations: readOnly,
    },
    async ({ mountId, question, answer }) => {
      try {
        const caller = callerFrom(server, agentId);
        const mount = service.readAuthorizedMount(mountId, caller);
        const pinned = graphs.get(mountId);
        const usedGraph = referencesKar(answer) ? pinned : undefined;
        const verdict = await verifyCortexAnswer({
          image: mount.image.bytes,
          question: questionOf(answer, question),
          result: answer,
          ...(usedGraph ? { graph: usedGraph.graph } : {}),
        });
        const receipt = await service.writeEvidenceReceipt({
          imageId: mount.id,
          byteSha256: mount.byteSha256,
          stateRoot: mount.stateRoot,
          caller,
          tool: 'knolo_cortex_verify',
          graphSha256: usedGraph ? usedGraph.graphSha256 : null,
          outcome: verdict.ok
            ? {
                ok: true,
                roots: {
                  traceRoot: verdict.traceRoot,
                  answerRoot: verdict.answerRoot,
                  evidenceRoot: verdict.evidenceRoot,
                },
              }
            : { ok: false, code: verdict.code },
        });
        return success({
          ok: verdict.ok,
          ...(verdict.ok
            ? {
                traceRoot: verdict.traceRoot,
                answerRoot: verdict.answerRoot,
                evidenceRoot: verdict.evidenceRoot,
              }
            : { code: verdict.code, message: verdict.message }),
          statement: CORTEX_VERIFY_STATEMENT,
          receiptId: receipt.receiptId,
        });
      } catch (error) {
        return failure(asToolError(error));
      }
    }
  );
}
