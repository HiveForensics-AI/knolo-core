import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import * as path from 'node:path';
import { createRequire } from 'node:module';
import type {
  KnoloCaller,
  KnoloOpenClawService as KnoloService,
  KnoloPluginConfig,
} from '@knolo/tools';
import type {
  IDataObject,
  IExecuteFunctions,
  INodeExecutionData,
  INodeType,
  INodeTypeDescription,
  NodeOperationError as NodeOperationErrorType,
} from 'n8n-workflow';

const nodeRequire = createRequire(__filename);
// n8n instantiates community nodes with require(). n8n-workflow's ESM build
// uses extensionless imports, so this file loads the CommonJS entry.
const { NodeConnectionTypes, NodeOperationError } = nodeRequire(
  'n8n-workflow'
) as typeof import('n8n-workflow');
// @knolo/tools is ESM and does not publish a require entry. Load the file
// named by its import export. require() of that file is on by default in
// Node 22.12+ and 20.19+. Node 22.0 through 22.11 still throw ERR_REQUIRE_ESM.
assertCanRequireKnoloModules();
const { KNOLO_SEARCH_DESCRIPTION, KnoloOpenClawService, KnoloPluginError } =
  nodeRequire(packageEntry('@knolo/tools')) as typeof import('@knolo/tools');
const karApi = nodeRequire(packageEntry('@knolo/core', 'kar')) as KarApi;
const cortexApi = nodeRequire(
  packageEntry('@knolo/core', 'cortex')
) as CortexApi;

const operations = [
  'search',
  'get',
  'verify',
  'status',
  'karEvaluate',
  'karVerify',
  'cortexVerify',
] as const;

const MAX_KAR_PLAN_BYTES = 65536;
const KAR_SATISFIED_STATEMENT =
  'SATISFIED means evidence requirements were met. It does not mean a claim is proven.';
const CORTEX_VERIFY_STATEMENT =
  'Verification checks that the trace matches the image. It does not mean the answer is true.';

type KarEvaluation = {
  status: string;
  code?: string;
  selectedEvidence: Array<{ id: string }>;
  certificate: { roots: Record<string, string> };
};

type KarVerification = {
  ok: boolean;
  code: string;
  reason: string;
  status?: string;
};

type KarApi = {
  createKarSession: (input: { image: unknown; graph: unknown }) => unknown;
  evaluateKar: (
    session: unknown,
    input: { proposition: string; plan: unknown }
  ) => KarEvaluation;
  verifyKar: (input: {
    image: unknown;
    graph: unknown;
    proposition: string;
    plan: unknown;
    result: unknown;
  }) => KarVerification;
  verifyKarDossier: (input: {
    image: unknown;
    graph: unknown;
    plan: unknown;
    proposition: string;
    manifest: unknown;
    certificate: unknown;
    evaluation?: unknown;
    evidenceMarkdown?: string;
  }) => KarVerification;
  KarError: new (...args: never[]) => Error;
};

type CortexVerdict = {
  ok: boolean;
  code?: string;
  message?: string;
  traceRoot?: string;
  answerRoot?: string;
  evidenceRoot?: string;
};

type CortexApi = {
  verifyCortexAnswer: (input: {
    image: Uint8Array | ArrayBuffer;
    graph?: unknown;
    question: string;
    result: unknown;
  }) => Promise<CortexVerdict>;
};

type PinnedKar = {
  graph: unknown;
  graphSha256: string;
  session: unknown;
};

type NodeSettings = {
  plugin: KnoloPluginConfig;
  mountId: string;
  agentId: string;
  pin: string;
  stateRoot: string;
  karGraphPath: string;
  karGraphSha256: string;
};

type KarDossierInput = {
  manifest: unknown;
  certificate: unknown;
  evaluation?: unknown;
  evidenceMarkdown?: string;
};

export class Knolo implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Knolo',
    name: 'knolo',
    group: ['transform'],
    version: 1,
    description:
      'Search, get, verify, status, KAR, and Cortex on a pinned Knolo Knowledge Image. Knolo does not call a model.',
    defaults: { name: 'Knolo' },
    usableAsTool: true,
    inputs: [NodeConnectionTypes.Main],
    outputs: [NodeConnectionTypes.Main],
    properties: [
      {
        displayName: 'Operation',
        name: 'operation',
        type: 'options',
        noDataExpression: true,
        options: [
          { name: 'Search', value: 'search', action: 'Search a pinned image' },
          { name: 'Get', value: 'get', action: 'Get one object' },
          {
            name: 'Verify',
            value: 'verify',
            action: 'Verify the pinned image',
          },
          {
            name: 'Status',
            value: 'status',
            action: 'Report the pin and freshness',
          },
          {
            name: 'KAR Evaluate',
            value: 'karEvaluate',
            action: 'Evaluate a KAR plan',
          },
          {
            name: 'KAR Verify',
            value: 'karVerify',
            action: 'Verify a KAR result',
          },
          {
            name: 'Cortex Verify',
            value: 'cortexVerify',
            action: 'Verify a Cortex trace',
          },
        ],
        default: 'search',
      },
      {
        displayName: 'Agent ID',
        name: 'agentId',
        type: 'string',
        noDataExpression: true,
        default: 'n8n',
        required: true,
        description:
          'Caller identity for this node. An item field named agentId is ignored.',
      },
      {
        displayName: 'Mount ID',
        name: 'mountId',
        type: 'string',
        noDataExpression: true,
        default: 'image',
        required: true,
      },
      {
        displayName: 'Image Path',
        name: 'imagePath',
        type: 'string',
        noDataExpression: true,
        default: '',
        required: true,
        description: 'Absolute path of the pinned Knowledge Image.',
      },
      {
        displayName: 'SHA-256',
        name: 'sha256',
        type: 'string',
        noDataExpression: true,
        default: '',
        required: true,
        description: 'Hex SHA-256 of the image file.',
      },
      {
        displayName: 'State Root',
        name: 'stateRoot',
        type: 'string',
        noDataExpression: true,
        default: '',
        required: true,
      },
      {
        displayName: 'Policy Path',
        name: 'policyPath',
        type: 'string',
        noDataExpression: true,
        default: '',
        required: true,
      },
      {
        displayName: 'Audit Directory',
        name: 'auditDir',
        type: 'string',
        noDataExpression: true,
        default: '',
        required: true,
        description: 'Writable directory for query and evidence receipts.',
      },
      {
        displayName: 'Principal',
        name: 'principal',
        type: 'string',
        noDataExpression: true,
        default: 'n8n:reader',
        required: true,
      },
      {
        displayName: 'Grok Home',
        name: 'grokHome',
        type: 'string',
        noDataExpression: true,
        default: '',
        description:
          'Absolute host home used to compare a recorded source tree. Empty omits freshness.',
      },
      {
        displayName: 'Built At',
        name: 'builtAt',
        type: 'string',
        noDataExpression: true,
        default: '',
        description:
          'Timestamp recorded when the image was built from source roots.',
      },
      {
        displayName: 'Source Digest',
        name: 'sourceDigest',
        type: 'string',
        noDataExpression: true,
        default: '',
        description: 'Hex SHA-256 recorded for the source tree.',
      },
      {
        displayName: 'Source Roots',
        name: 'sourceRoots',
        type: 'string',
        noDataExpression: true,
        default: '',
        description:
          'Absolute source paths, one per line. Mount ID must be files, skills, memory, or transcripts.',
      },
      {
        displayName: 'KAR Graph Path',
        name: 'karGraphPath',
        type: 'string',
        noDataExpression: true,
        default: '',
        description:
          'Absolute path of the pinned KAR graph. Empty leaves KAR disabled.',
      },
      {
        displayName: 'KAR Graph SHA-256',
        name: 'karGraphSha256',
        type: 'string',
        noDataExpression: true,
        default: '',
        description: 'Hex SHA-256 of the KAR graph file.',
      },
      {
        displayName: 'Query',
        name: 'query',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { operation: ['search'] } },
        description: KNOLO_SEARCH_DESCRIPTION,
      },
      {
        displayName: 'Limit',
        name: 'limit',
        type: 'number',
        default: 0,
        typeOptions: { minValue: 0 },
        displayOptions: { show: { operation: ['search'] } },
        description:
          'Maximum hits. Leave empty, or set 0, to use the service default.',
      },
      {
        displayName: 'Object ID',
        name: 'objectId',
        type: 'string',
        default: '',
        required: true,
        displayOptions: { show: { operation: ['get'] } },
      },
      {
        displayName: 'Image ID',
        name: 'imageId',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['get', 'verify'] } },
        description: 'Mount id. Empty uses the Mount ID above.',
      },
      {
        displayName: 'Proposition',
        name: 'proposition',
        type: 'string',
        default: '',
        displayOptions: {
          show: { operation: ['karEvaluate', 'karVerify'] },
        },
        description:
          'KAR proposition. Empty reads proposition from the current item.',
      },
      {
        displayName: 'Plan',
        name: 'plan',
        type: 'string',
        default: '',
        typeOptions: { rows: 4 },
        displayOptions: {
          show: { operation: ['karEvaluate', 'karVerify'] },
        },
        description:
          'KAR plan JSON. Empty reads plan from the current item. The plan is checked with the KAR plan schema.',
      },
      {
        displayName: 'Result',
        name: 'result',
        type: 'string',
        default: '',
        typeOptions: { rows: 4 },
        displayOptions: { show: { operation: ['karVerify'] } },
        description:
          'KAR result JSON. Provide a result or a dossier, not both. Empty reads result from the current item.',
      },
      {
        displayName: 'Dossier',
        name: 'dossier',
        type: 'string',
        default: '',
        typeOptions: { rows: 4 },
        displayOptions: { show: { operation: ['karVerify'] } },
        description:
          'KAR dossier JSON with manifest and certificate. Empty reads dossier from the current item.',
      },
      {
        displayName: 'Trace',
        name: 'trace',
        type: 'string',
        default: '',
        typeOptions: { rows: 4 },
        displayOptions: { show: { operation: ['cortexVerify'] } },
        description:
          'Cortex trace JSON. Empty reads trace, or answer, from the current item. The trace is checked with the Cortex trace schema.',
      },
      {
        displayName: 'Question',
        name: 'question',
        type: 'string',
        default: '',
        displayOptions: { show: { operation: ['cortexVerify'] } },
        description:
          'Question for the trace. Empty uses the trace question, then question on the item.',
      },
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const node = this.getNode();
    const settings = readConfig(this);
    let service: KnoloService;
    let pinned: PinnedKar | undefined;
    try {
      service = await KnoloOpenClawService.create(settings.plugin);
      pinned = await pinKarGraph(service, settings);
    } catch (error) {
      if (this.continueOnFail()) {
        return [loadErrors(items, error)];
      }
      throw asNodeError(error, node, 0);
    }
    const caller: KnoloCaller = { agentId: settings.agentId };
    const output: INodeExecutionData[] = [];
    for (let index = 0; index < items.length; index += 1) {
      try {
        output.push({
          json: await runOperation(
            this,
            service,
            caller,
            settings,
            pinned,
            index
          ),
          pairedItem: { item: index },
        });
      } catch (error) {
        if (this.continueOnFail()) {
          output.push({
            json: { error: errorText(error) },
            pairedItem: { item: index },
          });
          continue;
        }
        throw asNodeError(error, node, index);
      }
    }
    return [output];
  }
}

function readConfig(tools: IExecuteFunctions): NodeSettings {
  const agentId = required(tools, 'agentId', 0);
  const mountId = required(tools, 'mountId', 0);
  const sourceRoots = sourceRootList(optional(tools, 'sourceRoots', 0));
  const builtAt = optional(tools, 'builtAt', 0);
  const sourceDigest = optional(tools, 'sourceDigest', 0);
  const grokHome = optional(tools, 'grokHome', 0);
  const pin = required(tools, 'sha256', 0);
  const stateRoot = required(tools, 'stateRoot', 0);
  return {
    agentId,
    mountId,
    pin,
    stateRoot,
    karGraphPath: optional(tools, 'karGraphPath', 0),
    karGraphSha256: optional(tools, 'karGraphSha256', 0),
    plugin: {
      auditDir: required(tools, 'auditDir', 0),
      ...(grokHome ? { grokHome } : {}),
      mounts: [
        {
          id: mountId,
          path: required(tools, 'imagePath', 0),
          sha256: pin,
          stateRoot,
          policyPath: required(tools, 'policyPath', 0),
          agents: [agentId],
          principal: required(tools, 'principal', 0),
          ...(builtAt ? { builtAt } : {}),
          ...(sourceDigest ? { sourceDigest } : {}),
          ...(sourceRoots.length > 0 ? { sourceRoots } : {}),
        },
      ],
    },
  };
}

async function pinKarGraph(
  service: KnoloService,
  settings: NodeSettings
): Promise<PinnedKar | undefined> {
  const { karGraphPath, karGraphSha256, mountId, agentId } = settings;
  if (karGraphPath === '' && karGraphSha256 === '') return undefined;
  if (karGraphPath === '' || karGraphSha256 === '') {
    throw new KnoloPluginError(
      'IMAGE_INVALID',
      `KAR graph for ${mountId} needs both a path and a SHA-256 pin.`
    );
  }
  const authorized = service.readAuthorizedMount(mountId, { agentId });
  let bytes: Uint8Array;
  try {
    bytes = new Uint8Array(await readFile(karGraphPath));
  } catch (error) {
    throw new KnoloPluginError(
      'IMAGE_INVALID',
      `Could not read KAR graph for ${mountId}: ${
        error instanceof Error ? error.message : 'unknown error'
      }`
    );
  }
  const graphSha256 = createHash('sha256').update(bytes).digest('hex');
  if (graphSha256 !== karGraphSha256) {
    throw new KnoloPluginError(
      'IMAGE_INVALID',
      `KAR graph for ${mountId} does not match its SHA-256 pin.`
    );
  }
  let graph: unknown;
  try {
    graph = JSON.parse(new TextDecoder().decode(bytes)) as unknown;
  } catch {
    throw new KnoloPluginError(
      'IMAGE_INVALID',
      `KAR graph for ${mountId} is not valid JSON.`
    );
  }
  try {
    const session = karApi.createKarSession({
      image: authorized.image,
      graph,
    });
    return { graph, graphSha256, session };
  } catch (error) {
    const detail =
      error instanceof karApi.KarError || error instanceof Error
        ? error.message
        : 'KAR graph is not bound.';
    throw new KnoloPluginError(
      'IMAGE_INVALID',
      `KAR graph for ${mountId} is not bound to the pinned image: ${detail}`
    );
  }
}

async function runOperation(
  tools: IExecuteFunctions,
  service: KnoloService,
  caller: KnoloCaller,
  settings: NodeSettings,
  pinned: PinnedKar | undefined,
  index: number
): Promise<IDataObject> {
  const operation = String(tools.getNodeParameter('operation', index));
  if (!operations.includes(operation as (typeof operations)[number])) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      `Unknown operation ${operation}.`
    );
  }
  if (operation === 'search') {
    const limit = tools.getNodeParameter('limit', index);
    const request = {
      query: required(tools, 'query', index),
      ...(typeof limit === 'number' && Number.isFinite(limit) && limit > 0
        ? { limit }
        : {}),
    };
    return (await service.search(request, caller)) as unknown as IDataObject;
  }
  if (operation === 'status') return runStatus(service, caller, settings);
  if (operation === 'karEvaluate') {
    return evaluateKarOperation(
      tools,
      service,
      caller,
      settings,
      pinned,
      index
    );
  }
  if (operation === 'karVerify') {
    return verifyKarOperation(tools, service, caller, settings, pinned, index);
  }
  if (operation === 'cortexVerify') {
    return verifyCortexOperation(
      tools,
      service,
      caller,
      settings,
      pinned,
      index
    );
  }
  const imageId = optional(tools, 'imageId', index) || settings.mountId;
  if (operation === 'get') {
    return (await service.get(
      {
        imageId,
        objectId: required(tools, 'objectId', index),
        stateRoot: required(tools, 'stateRoot', 0),
      },
      caller
    )) as unknown as IDataObject;
  }
  return {
    results: await service.verify(imageId, caller),
  } as unknown as IDataObject;
}

async function runStatus(
  service: KnoloService,
  caller: KnoloCaller,
  settings: NodeSettings
): Promise<IDataObject> {
  const mounts = await service.statusWithFreshness(caller);
  const stale = mounts.some((mount) => mount.stale === true);
  return {
    ok: !stale,
    status: stale ? 'stale' : 'ready',
    pin: settings.pin,
    imageId: settings.mountId,
    stateRoot: settings.stateRoot,
    mounts,
    receipt: null,
    statement:
      'ok is false when a recorded source tree is stale. The image pin still matched. Status does not write a receipt.',
  };
}

async function evaluateKarOperation(
  tools: IExecuteFunctions,
  service: KnoloService,
  caller: KnoloCaller,
  settings: NodeSettings,
  pinned: PinnedKar | undefined,
  index: number
): Promise<IDataObject> {
  const proposition = requiredText(tools, index, 'proposition');
  const plan = requirePlan(jsonInput(tools, index, 'plan'));
  const graph = requirePinned(pinned, settings.mountId);
  const mount = service.readAuthorizedMount(settings.mountId, caller);
  let evaluation: KarEvaluation;
  try {
    evaluation = karApi.evaluateKar(graph.session, { proposition, plan });
  } catch (error) {
    throw asKarQuery(error);
  }
  const receipt = await service.writeEvidenceReceipt({
    imageId: mount.id,
    byteSha256: mount.byteSha256,
    stateRoot: mount.stateRoot,
    caller,
    tool: 'knolo_kar_evaluate',
    graphSha256: graph.graphSha256,
    outcome: {
      status: evaluation.status,
      ...(evaluation.code ? { code: evaluation.code } : {}),
      roots: evaluation.certificate.roots,
    },
  });
  return {
    ok: evaluation.status === 'SATISFIED',
    status: evaluation.status,
    ...(evaluation.code ? { code: evaluation.code } : {}),
    evidenceIds: evaluation.selectedEvidence.map((item) => item.id),
    roots: evaluation.certificate.roots,
    statement: KAR_SATISFIED_STATEMENT,
    receiptId: receipt.receiptId,
    receipt,
  };
}

async function verifyKarOperation(
  tools: IExecuteFunctions,
  service: KnoloService,
  caller: KnoloCaller,
  settings: NodeSettings,
  pinned: PinnedKar | undefined,
  index: number
): Promise<IDataObject> {
  const proposition = requiredText(tools, index, 'proposition');
  const plan = requirePlan(jsonInput(tools, index, 'plan'));
  const result = jsonInput(tools, index, 'result');
  const dossier = dossierInput(jsonInput(tools, index, 'dossier'));
  if ((result === undefined) === (dossier === undefined)) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      'Provide exactly one of result or dossier.'
    );
  }
  if (result !== undefined && !isRecord(result)) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      'KAR result must be a JSON object.'
    );
  }
  const graph = requirePinned(pinned, settings.mountId);
  const mount = service.readAuthorizedMount(settings.mountId, caller);
  let verdict: KarVerification;
  try {
    verdict = dossier
      ? karApi.verifyKarDossier({
          image: mount.image,
          graph: graph.graph,
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
      : karApi.verifyKar({
          image: mount.image,
          graph: graph.graph,
          proposition,
          plan,
          result,
        });
  } catch (error) {
    throw asKarQuery(error);
  }
  const receipt = await service.writeEvidenceReceipt({
    imageId: mount.id,
    byteSha256: mount.byteSha256,
    stateRoot: mount.stateRoot,
    caller,
    tool: 'knolo_kar_verify',
    graphSha256: graph.graphSha256,
    outcome: {
      ok: verdict.ok,
      code: verdict.code,
      ...(verdict.status ? { status: verdict.status } : {}),
    },
  });
  return {
    ok: verdict.ok,
    status: verdict.ok ? (verdict.status ?? verdict.code) : verdict.code,
    code: verdict.code,
    reason: verdict.reason,
    receiptId: receipt.receiptId,
    receipt,
  };
}

async function verifyCortexOperation(
  tools: IExecuteFunctions,
  service: KnoloService,
  caller: KnoloCaller,
  settings: NodeSettings,
  pinned: PinnedKar | undefined,
  index: number
): Promise<IDataObject> {
  const trace = traceInput(tools, index);
  if (!isRecord(trace)) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      'Cortex trace must be a JSON object.'
    );
  }
  const question = questionOf(trace, textInput(tools, index, 'question'));
  const mount = service.readAuthorizedMount(settings.mountId, caller);
  const usedGraph = bindsGraph(trace) ? pinned : undefined;
  const verdict = await cortexApi.verifyCortexAnswer({
    image: mount.image.bytes,
    question,
    result: trace,
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
            traceRoot: verdict.traceRoot ?? '',
            answerRoot: verdict.answerRoot ?? '',
            evidenceRoot: verdict.evidenceRoot ?? '',
          },
        }
      : { ok: false, code: verdict.code },
  });
  return {
    ok: verdict.ok,
    status: verdict.ok ? 'verified' : (verdict.code ?? 'CORTEX_TRACE_INVALID'),
    ...(verdict.ok
      ? {
          traceRoot: verdict.traceRoot,
          answerRoot: verdict.answerRoot,
          evidenceRoot: verdict.evidenceRoot,
        }
      : { code: verdict.code, message: verdict.message }),
    statement: CORTEX_VERIFY_STATEMENT,
    receiptId: receipt.receiptId,
    receipt,
  };
}

function requirePinned(
  pinned: PinnedKar | undefined,
  mountId: string
): PinnedKar {
  if (!pinned) {
    throw new KnoloPluginError(
      'IMAGE_UNAVAILABLE',
      `Mount ${mountId} has no pinned KAR graph.`
    );
  }
  return pinned;
}

// A trace from a session with a bound graph has knowledgeRoot in its image
// identity, even when no KAR evaluation ran. It verifies only with the graph.
function bindsGraph(answer: unknown): boolean {
  if (!isRecord(answer)) return false;
  const evaluations = answer.karEvaluations;
  if (Array.isArray(evaluations) && evaluations.length > 0) return true;
  return (
    isRecord(answer.image) && typeof answer.image.knowledgeRoot === 'string'
  );
}

function questionOf(answer: unknown, supplied: string): string {
  if (supplied !== '') return supplied;
  if (isRecord(answer) && typeof answer.question === 'string') {
    return answer.question;
  }
  return '';
}

function requirePlan(plan: unknown): Record<string, unknown> {
  if (!isRecord(plan)) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      'KAR plan must be a JSON object.'
    );
  }
  assertPlanSize(plan);
  return plan;
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

function dossierInput(value: unknown): KarDossierInput | undefined {
  if (value === undefined) return undefined;
  if (!isRecord(value) || !('manifest' in value) || !('certificate' in value)) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      'KAR dossier must be a JSON object with manifest and certificate.'
    );
  }
  const evidence = value.evidenceMarkdown;
  if (
    evidence !== undefined &&
    evidence !== null &&
    typeof evidence !== 'string'
  ) {
    throw new KnoloPluginError(
      'QUERY_INVALID',
      'KAR dossier evidenceMarkdown must be a string.'
    );
  }
  return {
    manifest: value.manifest,
    certificate: value.certificate,
    ...(value.evaluation === undefined || value.evaluation === null
      ? {}
      : { evaluation: value.evaluation }),
    ...(typeof evidence === 'string' ? { evidenceMarkdown: evidence } : {}),
  };
}

function traceInput(tools: IExecuteFunctions, index: number): unknown {
  const trace = jsonInput(tools, index, 'trace');
  if (trace !== undefined) return trace;
  const answer = itemValue(tools, index, 'answer');
  if (answer !== undefined) return parseJson(answer, 'answer');
  return undefined;
}

function asKarQuery(error: unknown): unknown {
  if (error instanceof karApi.KarError) {
    return new KnoloPluginError('QUERY_INVALID', error.message);
  }
  return error;
}

function requiredText(
  tools: IExecuteFunctions,
  index: number,
  name: string
): string {
  const value = textInput(tools, index, name);
  if (value === '') {
    throw new KnoloPluginError('QUERY_INVALID', `${name} is required.`);
  }
  return value;
}

function textInput(
  tools: IExecuteFunctions,
  index: number,
  name: string
): string {
  const raw = tools.getNodeParameter(name, index);
  if (typeof raw === 'string' && raw.trim() !== '') return raw.trim();
  const value = itemValue(tools, index, name);
  return typeof value === 'string' ? value.trim() : '';
}

function jsonInput(
  tools: IExecuteFunctions,
  index: number,
  name: string
): unknown {
  const raw = tools.getNodeParameter(name, index);
  if (isProvided(raw)) return parseJson(raw, name);
  const value = itemValue(tools, index, name);
  if (value === undefined || !isProvided(value)) return undefined;
  return parseJson(value, name);
}

function itemValue(
  tools: IExecuteFunctions,
  index: number,
  name: string
): unknown {
  const json = tools.getInputData()[index]?.json;
  if (!json || typeof json !== 'object') return undefined;
  if (!Object.hasOwn(json, name)) return undefined;
  return json[name];
}

function isProvided(value: unknown): boolean {
  if (value === undefined || value === null) return false;
  if (typeof value === 'string' && value.trim() === '') return false;
  return true;
}

function parseJson(value: unknown, name: string): unknown {
  if (typeof value !== 'string') return value;
  try {
    return JSON.parse(value) as unknown;
  } catch {
    throw new KnoloPluginError('QUERY_INVALID', `${name} must be JSON.`);
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function sourceRootList(value: string): string[] {
  return value
    .split(/\r?\n/u)
    .map((item) => item.trim())
    .filter((item) => item !== '');
}

function required(
  tools: IExecuteFunctions,
  name: string,
  index: number
): string {
  const value = tools.getNodeParameter(name, index);
  if (typeof value !== 'string' || value.trim() === '') {
    throw new KnoloPluginError('QUERY_INVALID', `${name} is required.`);
  }
  return value.trim();
}

function optional(
  tools: IExecuteFunctions,
  name: string,
  index: number
): string {
  const value = tools.getNodeParameter(name, index);
  return typeof value === 'string' ? value.trim() : '';
}

function loadErrors(
  items: INodeExecutionData[],
  error: unknown
): INodeExecutionData[] {
  const text = errorText(error);
  const count = items.length > 0 ? items.length : 1;
  return Array.from({ length: count }, (_, index) => ({
    json: { error: text },
    pairedItem: { item: index },
  }));
}

function errorText(error: unknown): string {
  if (error instanceof KnoloPluginError)
    return `${error.code}: ${error.message}`;
  return error instanceof Error ? error.message : String(error);
}

/** True when this Node can require() an ES module without a flag. */
export function canRequireKnoloModules(
  version: string = process.versions.node
): boolean {
  const [majorText, minorText] = version.split('.');
  const major = Number(majorText);
  const minor = Number(minorText);
  if (!Number.isInteger(major) || !Number.isInteger(minor)) return false;
  return (
    (major === 20 && minor >= 19) || (major === 22 && minor >= 12) || major > 22
  );
}

function assertCanRequireKnoloModules(): void {
  if (canRequireKnoloModules()) return;
  throw new Error(
    `n8n-nodes-knolo cannot load @knolo/tools on Node.js ${process.versions.node}. Use Node.js 22.12 or newer.`
  );
}

function asNodeError(
  error: unknown,
  node: ReturnType<IExecuteFunctions['getNode']>,
  index: number
): NodeOperationErrorType {
  const text = errorText(error);
  // n8n replaces a message that mentions a Node error code such as ENOTDIR.
  // Put the Knolo code back after that replacement.
  const wrapped = new NodeOperationError(node, text, { itemIndex: index });
  wrapped.message = text;
  return wrapped;
}

function packageEntry(packageName: string, subpath = '.'): string {
  const manifestPath = findManifest(packageName);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    exports?: Record<string, { import?: string } | string | undefined>;
  };
  const key = subpath === '.' ? '.' : `./${subpath.replace(/^\.\//u, '')}`;
  const exported = manifest.exports?.[key];
  const relative =
    typeof exported === 'string'
      ? exported
      : exported && typeof exported.import === 'string'
        ? exported.import
        : '';
  if (relative.length === 0) {
    throw new Error(`${packageName} has no import entry for ${key}.`);
  }
  const root = path.dirname(manifestPath);
  const entry = path.resolve(root, relative);
  if (entry !== root && !entry.startsWith(`${root}${path.sep}`)) {
    throw new Error(`${packageName} import entry escapes the package.`);
  }
  return entry;
}

function findManifest(packageName: string): string {
  const segments = packageName.split('/');
  let dir = __dirname;
  while (true) {
    const candidate = path.join(
      dir,
      'node_modules',
      ...segments,
      'package.json'
    );
    if (existsSync(candidate)) return candidate;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  throw new Error(`Cannot resolve ${packageName}.`);
}
