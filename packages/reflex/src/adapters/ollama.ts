import type { ReflexModelAdapterV1 } from '../evaluation.js';

export type OllamaReflexAdapterOptions = {
  modelId: string;
  revision?: string;
  endpoint?: string;
  timeoutMs?: number;
  fetchImpl?: typeof fetch;
  judge: (
    output: string,
    input: { taskId?: string; query: string; context: string }
  ) => {
    failure: boolean;
    policyViolation?: boolean;
  };
};

export function createOllamaReflexAdapterV1(
  options: OllamaReflexAdapterOptions
): ReflexModelAdapterV1 {
  if (!options.modelId.trim()) throw new Error('Ollama model ID is required.');
  if (typeof options.judge !== 'function')
    throw new Error('An output judge is required for evaluation.');
  const endpoint = (options.endpoint ?? 'http://localhost:11434').replace(
    /\/$/u,
    ''
  );
  const timeoutMs = options.timeoutMs ?? 120_000;
  const fetchImpl = options.fetchImpl ?? fetch;
  return {
    modelId: options.modelId,
    revision: options.revision ?? options.modelId,
    async run(input) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      const started = performance.now();
      try {
        const response = await fetchImpl(`${endpoint}/api/generate`, {
          method: 'POST',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({
            model: options.modelId,
            prompt: `${input.context}\n\nUser request:\n${input.query}`,
            stream: false,
          }),
          signal: controller.signal,
        });
        if (!response.ok) {
          throw new Error(
            `Ollama generation failed (${response.status}): ${await response.text()}`
          );
        }
        const payload = (await response.json()) as {
          response?: unknown;
          eval_count?: unknown;
        };
        if (typeof payload.response !== 'string')
          throw new Error('Ollama response is missing generated text.');
        const judgment = options.judge(payload.response, {
          taskId: input.taskId,
          query: input.query,
          context: input.context,
        });
        return {
          ...judgment,
          outputTokens:
            typeof payload.eval_count === 'number'
              ? payload.eval_count
              : undefined,
          latencyMs: performance.now() - started,
        };
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw new Error(
          `Failed to run Ollama model at ${endpoint}: ${message}`
        );
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
