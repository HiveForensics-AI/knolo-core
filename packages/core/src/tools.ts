export type ToolId = string;

export interface ToolCallV1 {
  type: 'tool_call';
  callId: string;
  tool: ToolId;
  args: Record<string, unknown>;
}

export interface ToolResultErrorV1 {
  message: string;
  code?: string;
  details?: unknown;
}

export interface ToolResultV1 {
  type: 'tool_result';
  callId: string;
  tool: ToolId;
  ok: boolean;
  output?: unknown;
  error?: ToolResultErrorV1;
}

export interface ToolSpecV1 {
  id: ToolId;
  description?: string;
  jsonSchema?: unknown;
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const proto = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
}

export function isToolCallV1(x: unknown): x is ToolCallV1 {
  if (!isPlainObject(x)) return false;
  return (
    x.type === 'tool_call' &&
    typeof x.callId === 'string' &&
    x.callId.trim().length > 0 &&
    typeof x.tool === 'string' &&
    x.tool.trim().length > 0 &&
    isPlainObject(x.args)
  );
}

export function isToolResultV1(x: unknown): x is ToolResultV1 {
  if (!isPlainObject(x)) return false;
  if (
    x.type !== 'tool_result' ||
    typeof x.callId !== 'string' ||
    x.callId.trim().length === 0 ||
    typeof x.tool !== 'string' ||
    x.tool.trim().length === 0 ||
    typeof x.ok !== 'boolean'
  ) {
    return false;
  }

  if (x.ok) {
    return x.error === undefined;
  }

  return (
    isPlainObject(x.error) &&
    typeof x.error.message === 'string' &&
    x.error.message.trim().length > 0
  );
}
