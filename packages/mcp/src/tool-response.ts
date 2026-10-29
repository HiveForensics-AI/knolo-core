import { KnoloPluginError, type KnoloCaller } from '@knolo/tools';
import { type McpServer } from '@modelcontextprotocol/server';

export function callerFrom(server: McpServer, agentId: string): KnoloCaller {
  const name = server.server.getClientVersion()?.name;
  if (typeof name !== 'string' || name.length === 0) return { agentId };
  return { agentId, sessionId: name };
}

export function failure(error: unknown) {
  if (error instanceof KnoloPluginError) {
    return {
      isError: true as const,
      content: [
        { type: 'text' as const, text: `${error.code}: ${error.message}` },
      ],
    };
  }
  return {
    isError: true as const,
    content: [
      {
        type: 'text' as const,
        text: 'IMAGE_UNAVAILABLE: Knolo request failed.',
      },
    ],
  };
}

export function success(value: object) {
  return {
    content: [{ type: 'text' as const, text: JSON.stringify(value) }],
    structuredContent: value as Record<string, unknown>,
  };
}
