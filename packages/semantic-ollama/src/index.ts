import type { EmbeddingProvider } from '@knolo/core';

export type OllamaProviderOptions = {
  endpoint?: string;
  modelId?: string;
  timeoutMs?: number;
  batchSize?: number;
  /** Expected vector size. When omitted, the first response fixes the batch dimension. */
  dimensions?: number;
  /** Select the current API, the deprecated API, or automatic compatibility fallback. */
  api?: 'embed' | 'embeddings' | 'auto';
};

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly modelId: string;
  readonly endpoint: string;
  readonly timeoutMs: number;
  readonly batchSize: number;
  readonly dimensions?: number;
  readonly api: 'embed' | 'embeddings' | 'auto';
  private legacyApiUnavailable = false;

  constructor(opts: OllamaProviderOptions = {}) {
    this.modelId = opts.modelId ?? 'qwen3-embedding:4b';
    this.endpoint = (opts.endpoint ?? 'http://localhost:11434').replace(
      /\/$/u,
      ''
    );
    this.timeoutMs = opts.timeoutMs ?? 30_000;
    this.batchSize = validatePositiveInteger(opts.batchSize ?? 32, 'batchSize');
    this.dimensions =
      opts.dimensions === undefined
        ? undefined
        : validatePositiveInteger(opts.dimensions, 'dimensions');
    const api = opts.api ?? 'auto';
    if (api !== 'embed' && api !== 'embeddings' && api !== 'auto') {
      throw new Error(`Ollama api must be embed, embeddings, or auto.`);
    }
    this.api = api;
  }

  async embedQuery(text: string): Promise<Float32Array> {
    const [vec] = await this.embedTexts([text]);
    if (!vec) throw new Error('Ollama returned no embedding for the query.');
    return vec;
  }

  async embedTexts(texts: string[]): Promise<Float32Array[]> {
    if (!Array.isArray(texts))
      throw new Error('Ollama texts must be an array.');
    for (const [index, text] of texts.entries()) {
      if (typeof text !== 'string')
        throw new Error(`Ollama text[${index}] must be a string.`);
    }
    if (texts.length === 0) return [];

    const out: Float32Array[] = [];
    let dimension = this.dimensions;
    for (let i = 0; i < texts.length; i += this.batchSize) {
      const batch = texts.slice(i, i + this.batchSize);
      const vectors = await this.requestBatch(batch);
      if (vectors.length !== batch.length) {
        throw new Error(
          `Ollama embedding count mismatch: expected ${batch.length}, got ${vectors.length}.`
        );
      }
      for (const [index, vector] of vectors.entries()) {
        dimension = validateVector(vector, dimension, i + index);
        out.push(vector);
      }
    }
    return out;
  }

  private async requestBatch(texts: string[]): Promise<Float32Array[]> {
    if (this.api === 'embeddings' || this.legacyApiUnavailable) {
      return this.requestLegacyBatch(texts);
    }

    try {
      return await this.requestEmbedBatch(texts);
    } catch (error) {
      if (this.api !== 'auto' || !isLegacyFallbackError(error)) throw error;
      this.legacyApiUnavailable = true;
      return this.requestLegacyBatch(texts);
    }
  }

  private async requestEmbedBatch(texts: string[]): Promise<Float32Array[]> {
    const json = await this.requestJson('/api/embed', {
      model: this.modelId,
      input: texts,
    });
    if (!Array.isArray(json.embeddings)) {
      throw new Error(
        'Ollama /api/embed response is missing an embeddings array.'
      );
    }
    return json.embeddings.map((vector, index) =>
      parseVector(vector, `/api/embed embeddings[${index}]`)
    );
  }

  private async requestLegacyBatch(texts: string[]): Promise<Float32Array[]> {
    const vectors: Float32Array[] = [];
    for (const [index, text] of texts.entries()) {
      const json = await this.requestJson('/api/embeddings', {
        model: this.modelId,
        prompt: text,
      });
      vectors.push(
        parseVector(json.embedding, `/api/embeddings embedding[${index}]`)
      );
    }
    return vectors;
  }

  private async requestJson(
    pathname: string,
    body: Record<string, unknown>
  ): Promise<Record<string, unknown>> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), this.timeoutMs);
    try {
      const res = await fetch(`${this.endpoint}${pathname}`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        signal: controller.signal,
      });
      if (!res.ok) {
        const error = new OllamaHttpError(
          `Ollama ${pathname} failed (${res.status}): ${await res.text()}`,
          res.status
        );
        throw error;
      }
      const json = await res.json();
      if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new Error(`Ollama ${pathname} response must be a JSON object.`);
      }
      return json as Record<string, unknown>;
    } catch (error) {
      if (error instanceof OllamaHttpError) throw error;
      const message = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Failed to embed with Ollama at ${this.endpoint}: ${message}`
      );
    } finally {
      clearTimeout(timer);
    }
  }
}

class OllamaHttpError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'OllamaHttpError';
    this.status = status;
  }
}

function isLegacyFallbackError(error: unknown): boolean {
  return (
    error instanceof OllamaHttpError && [404, 405, 501].includes(error.status)
  );
}

function parseVector(value: unknown, label: string): Float32Array {
  if (!Array.isArray(value) || value.length === 0) {
    throw new Error(`Ollama ${label} must be a non-empty numeric array.`);
  }
  const vector = new Float32Array(value.length);
  for (const [index, component] of value.entries()) {
    if (typeof component !== 'number' || !Number.isFinite(component)) {
      throw new Error(`Ollama ${label}[${index}] must be a finite number.`);
    }
    vector[index] = component;
    if (!Number.isFinite(vector[index])) {
      throw new Error(
        `Ollama ${label}[${index}] is outside Float32 representable range.`
      );
    }
  }
  return vector;
}

function validateVector(
  vector: Float32Array,
  expected: number | undefined,
  index: number
): number {
  if (expected !== undefined && vector.length !== expected) {
    throw new Error(
      `Ollama embedding dimension mismatch at index ${index}: expected ${expected}, got ${vector.length}.`
    );
  }
  return expected ?? vector.length;
}

export { proposeCegWithOllama } from './ceg-producer.js';
export type { OllamaCegProposalRequest } from './ceg-producer.js';

function validatePositiveInteger(value: number, name: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`Ollama ${name} must be a positive safe integer.`);
  }
  return value;
}
