import type { EmbeddingProvider } from '@knolo/core';

export type OllamaProviderOptions = {
  endpoint?: string;
  modelId?: string;
  timeoutMs?: number;
  batchSize?: number;
};

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  readonly endpoint: string;
  readonly timeoutMs: number;
  readonly batchSize: number;

  constructor(opts: OllamaProviderOptions = {}) {
    this.modelId = opts.modelId ?? 'qwen3-embedding:4b';
    this.endpoint = opts.endpoint ?? 'http://localhost:11434';
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.batchSize = Math.max(1, opts.batchSize ?? 32);
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [vec] = await this.embedTexts([text]);
    return vec;
  }

  async embedTexts(texts: string[]): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      for (const text of batch) out.push(await this.requestEmbedding(text));
    }
    return out;
  }

  private async requestEmbedding(text: string): Promise<Float32Array> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.endpoint}/api/embeddings`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ model: this.modelId, prompt: text }),
        signal: controller.signal,
      });
      if (!res.ok) {
        throw new Error(`Ollama embeddings failed (${res.status}): ${await res.text()}`);
      }
      const json = (await res.json()) as { embedding?: number[] };
      if (!Array.isArray(json.embedding) || json.embedding.length === 0) {
        throw new Error('Ollama embeddings response missing embedding vector.');
      }
      return Float32Array.from(json.embedding);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(`Failed to embed text with Ollama at ${this.endpoint}: ${message}`);
    } finally {
      clearTimeout(timer);
    }
  }
}
