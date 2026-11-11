import { createRequire } from 'node:module';
import { existsSync, readFileSync } from 'node:fs';
import * as path from 'node:path';
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

const operations = ['search', 'get', 'verify'] as const;

type NodeSettings = {
  plugin: KnoloPluginConfig;
  mountId: string;
  agentId: string;
};

export class Knolo implements INodeType {
  description: INodeTypeDescription = {
    displayName: 'Knolo',
    name: 'knolo',
    group: ['transform'],
    version: 1,
    description:
      'Search, get, and verify a pinned Knolo Knowledge Image. Knolo does not call a model.',
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
        description: 'Writable directory for query receipts.',
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
    ],
  };

  async execute(this: IExecuteFunctions): Promise<INodeExecutionData[][]> {
    const items = this.getInputData();
    const node = this.getNode();
    const settings = readConfig(this);
    let service: KnoloService;
    try {
      service = await KnoloOpenClawService.create(settings.plugin);
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
            settings.mountId,
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
  return {
    agentId,
    mountId,
    plugin: {
      auditDir: required(tools, 'auditDir', 0),
      mounts: [
        {
          id: mountId,
          path: required(tools, 'imagePath', 0),
          sha256: required(tools, 'sha256', 0),
          stateRoot: required(tools, 'stateRoot', 0),
          policyPath: required(tools, 'policyPath', 0),
          agents: [agentId],
          principal: required(tools, 'principal', 0),
        },
      ],
    },
  };
}

async function runOperation(
  tools: IExecuteFunctions,
  service: KnoloService,
  caller: KnoloCaller,
  mountId: string,
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
    return await service.search(request, caller);
  }
  const imageId = optional(tools, 'imageId', index) || mountId;
  if (operation === 'get') {
    return await service.get(
      {
        imageId,
        objectId: required(tools, 'objectId', index),
        stateRoot: required(tools, 'stateRoot', 0),
      },
      caller
    );
  }
  return { results: await service.verify(imageId, caller) };
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

function packageEntry(packageName: string): string {
  const manifestPath = findManifest(packageName);
  const manifest = JSON.parse(readFileSync(manifestPath, 'utf8')) as {
    exports?: { '.'?: { import?: string } };
  };
  const relative = manifest.exports?.['.']?.import;
  if (typeof relative !== 'string' || relative.length === 0) {
    throw new Error(`${packageName} has no import entry.`);
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
