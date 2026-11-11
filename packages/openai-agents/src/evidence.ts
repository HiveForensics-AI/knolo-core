import { verifyCortexAnswer } from '@knolo/core/cortex';
import { evaluateKar, verifyKar, verifyKarDossier } from '@knolo/core/kar';
import {
  KnoloPluginError,
  type KnoloCaller,
  type KnoloOpenClawService,
} from '@knolo/tools';
import type { PinnedKarGraph } from './graphs.js';

export const MAX_KAR_PLAN_BYTES = 65536;
export const KAR_SATISFIED_STATEMENT =
  'SATISFIED means evidence requirements were met. It does not mean a claim is proven.';
export const CORTEX_VERIFY_STATEMENT =
  'Verification checks that the trace matches the image. It does not mean the answer is true.';

export function assertPlanSize(plan: unknown): void {
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

export function requireGraph(
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

export async function evaluateEvidence(input: {
  service: KnoloOpenClawService;
  graphs: ReadonlyMap<string, PinnedKarGraph>;
  caller: KnoloCaller;
  mountId: string;
  proposition: string;
  plan: unknown;
}) {
  assertPlanSize(input.plan);
  const mount = input.service.readAuthorizedMount(input.mountId, input.caller);
  const pinned = requireGraph(input.graphs, input.mountId);
  const evaluation = evaluateKar(pinned.session, {
    proposition: input.proposition,
    plan: input.plan,
  });
  const receipt = await input.service.writeEvidenceReceipt({
    imageId: mount.id,
    byteSha256: mount.byteSha256,
    stateRoot: mount.stateRoot,
    caller: input.caller,
    tool: 'knolo_kar_evaluate',
    graphSha256: pinned.graphSha256,
    outcome: {
      status: evaluation.status,
      ...(evaluation.code ? { code: evaluation.code } : {}),
      roots: evaluation.certificate.roots,
    },
  });
  return {
    status: evaluation.status,
    code: evaluation.code,
    evidenceIds: evaluation.selectedEvidence.map((item) => item.id),
    roots: evaluation.certificate.roots,
    statement: KAR_SATISFIED_STATEMENT,
    receiptId: receipt.receiptId,
  };
}

export async function verifyEvidence(input: {
  service: KnoloOpenClawService;
  graphs: ReadonlyMap<string, PinnedKarGraph>;
  caller: KnoloCaller;
  mountId: string;
  proposition: string;
  plan: unknown;
  result?: Record<string, unknown>;
  dossier?: {
    manifest: unknown;
    certificate: unknown;
    evaluation?: unknown;
    evidenceMarkdown?: string;
  };
}) {
  assertPlanSize(input.plan);
  if ((input.result === undefined) === (input.dossier === undefined)) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      'Provide exactly one of result or dossier.'
    );
  }
  const mount = input.service.readAuthorizedMount(input.mountId, input.caller);
  const pinned = requireGraph(input.graphs, input.mountId);
  const dossier = input.dossier;
  const verdict = dossier
    ? verifyKarDossier({
        image: mount.image,
        graph: pinned.graph,
        plan: input.plan,
        proposition: input.proposition,
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
        proposition: input.proposition,
        plan: input.plan,
        result: input.result,
      });
  const receipt = await input.service.writeEvidenceReceipt({
    imageId: mount.id,
    byteSha256: mount.byteSha256,
    stateRoot: mount.stateRoot,
    caller: input.caller,
    tool: 'knolo_kar_verify',
    graphSha256: pinned.graphSha256,
    outcome: {
      ok: verdict.ok,
      code: verdict.code,
      ...(verdict.status ? { status: verdict.status } : {}),
    },
  });
  return {
    ok: verdict.ok,
    code: verdict.code,
    reason: verdict.reason,
    receiptId: receipt.receiptId,
  };
}

export async function verifyCortexEvidence(input: {
  service: KnoloOpenClawService;
  graphs: ReadonlyMap<string, PinnedKarGraph>;
  caller: KnoloCaller;
  mountId: string;
  question?: string;
  answer: Record<string, unknown>;
}) {
  const mount = input.service.readAuthorizedMount(input.mountId, input.caller);
  const pinned = input.graphs.get(input.mountId);
  const usedGraph = referencesKar(input.answer) ? pinned : undefined;
  const verdict = await verifyCortexAnswer({
    image: mount.image.bytes,
    question: questionOf(input.answer, input.question),
    result: input.answer,
    ...(usedGraph ? { graph: usedGraph.graph } : {}),
  });
  const receipt = await input.service.writeEvidenceReceipt({
    imageId: mount.id,
    byteSha256: mount.byteSha256,
    stateRoot: mount.stateRoot,
    caller: input.caller,
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
  return {
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
  };
}
