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
  export function defineToolPlugin(entry: {
    id: string;
    name: string;
    description: string;
    configSchema?: unknown;
    tools: (
      tool: (definition: {
        name: string;
        description: string;
        parameters: unknown;
        execute: (
          parameters: unknown,
          config: unknown,
          context: unknown
        ) => Promise<unknown>;
      }) => unknown
    ) => unknown[];
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
