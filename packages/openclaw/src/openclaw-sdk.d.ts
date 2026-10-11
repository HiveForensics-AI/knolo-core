declare module 'openclaw/plugin-sdk/plugin-entry' {
  export function definePluginEntry(entry: {
    id: string;
    name: string;
    description: string;
    register(api: {
      config?: unknown;
      pluginConfig?: unknown;
      registerTool(tool: {
        name: string;
        description: string;
        parameters: unknown;
        outputSchema?: unknown;
        execute: (
          id: string,
          parameters: unknown,
          context?: unknown
        ) => Promise<unknown>;
      }): void;
    }): void;
  }): unknown;
}

declare module 'openclaw/plugin-sdk/tool-plugin' {
  type ToolContext = {
    memoryAudience?: { agentId?: unknown; sessionId?: unknown };
    assertInvocationCurrent?: () => void;
    assertMemoryAudienceCurrent?: () => void;
  };

  type ToolDefinition = {
    name: string;
    description: string;
    parameters: unknown;
    contextVersion?: number;
    factory?: (context: {
      api: { pluginConfig?: unknown };
      toolContext: ToolContext;
    }) => unknown;
  };

  export function defineToolPlugin(entry: {
    id: string;
    name: string;
    description: string;
    configSchema?: unknown;
    tools: (tool: (definition: ToolDefinition) => unknown) => unknown[];
  }): unknown;
}

declare module 'typebox' {
  export const Type: {
    String(options?: Record<string, unknown>): unknown;
    Integer(options?: Record<string, unknown>): unknown;
    Array(item: unknown, options?: Record<string, unknown>): unknown;
    Optional(item: unknown): unknown;
    Object(
      properties: Record<string, unknown>,
      options?: Record<string, unknown>
    ): unknown;
  };
}
