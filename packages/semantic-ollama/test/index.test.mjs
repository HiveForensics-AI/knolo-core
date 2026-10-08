import assert from 'node:assert/strict';
import test from 'node:test';
import { OllamaEmbeddingProvider } from '../dist/index.js';

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() {
      return body;
    },
    async text() {
      return typeof body === 'string' ? body : JSON.stringify(body);
    },
  };
}

function withFetch(handler) {
  const original = globalThis.fetch;
  globalThis.fetch = handler;
  return () => {
    globalThis.fetch = original;
  };
}

test('prefers /api/embed and batches inputs', async () => {
  const calls = [];
  const restore = withFetch(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    return jsonResponse({
      embeddings: [
        [1, 2],
        [3, 4],
      ],
    });
  });
  try {
    const provider = new OllamaEmbeddingProvider({
      endpoint: 'http://ollama/',
      batchSize: 8,
    });
    const vectors = await provider.embedTexts(['one', 'two']);
    assert.deepEqual(
      vectors.map((vector) => Array.from(vector)),
      [
        [1, 2],
        [3, 4],
      ]
    );
    assert.deepEqual(calls, [
      {
        url: 'http://ollama/api/embed',
        body: { model: 'qwen3-embedding:4b', input: ['one', 'two'] },
      },
    ]);
  } finally {
    restore();
  }
});

test('splits batches and enforces response counts and dimensions', async () => {
  const calls = [];
  const restore = withFetch(async (url, init) => {
    const body = JSON.parse(init.body);
    calls.push({ url, body });
    return jsonResponse({ embeddings: body.input.map(() => [1, 2, 3]) });
  });
  try {
    const provider = new OllamaEmbeddingProvider({
      batchSize: 2,
      dimensions: 3,
    });
    const vectors = await provider.embedTexts(['a', 'b', 'c']);
    assert.equal(vectors.length, 3);
    assert.equal(calls.length, 2);
    assert.deepEqual(
      calls.map((call) => call.body.input),
      [['a', 'b'], ['c']]
    );
  } finally {
    restore();
  }

  const mismatchRestore = withFetch(async () =>
    jsonResponse({ embeddings: [[1, 2]] })
  );
  try {
    await assert.rejects(
      () => new OllamaEmbeddingProvider().embedTexts(['a', 'b']),
      /count mismatch/i
    );
  } finally {
    mismatchRestore();
  }

  const dimensionRestore = withFetch(async () =>
    jsonResponse({ embeddings: [[1, 2, 3]] })
  );
  try {
    await assert.rejects(
      () => new OllamaEmbeddingProvider({ dimensions: 2 }).embedTexts(['a']),
      /dimension mismatch/i
    );
  } finally {
    dimensionRestore();
  }
});

test('falls back to the legacy endpoint only when /api/embed is unavailable', async () => {
  const calls = [];
  const restore = withFetch(async (url, init) => {
    calls.push({ url, body: JSON.parse(init.body) });
    if (url.endsWith('/api/embed'))
      return jsonResponse({ error: 'not found' }, 404);
    return jsonResponse({ embedding: [0.5, 0.25] });
  });
  try {
    const provider = new OllamaEmbeddingProvider({ batchSize: 1 });
    const vectors = await provider.embedTexts(['one', 'two']);
    assert.equal(vectors.length, 2);
    assert.deepEqual(
      calls.map((call) => call.url),
      [
        'http://localhost:11434/api/embed',
        'http://localhost:11434/api/embeddings',
        'http://localhost:11434/api/embeddings',
      ]
    );
    assert.deepEqual(
      calls.slice(1).map((call) => call.body.prompt),
      ['one', 'two']
    );
  } finally {
    restore();
  }
});

test('supports explicit legacy mode and keeps empty embeddings optional', async () => {
  let calls = 0;
  const restore = withFetch(async (url, init) => {
    calls += 1;
    assert.ok(url.endsWith('/api/embeddings'));
    assert.equal(JSON.parse(init.body).prompt, 'query');
    return jsonResponse({ embedding: [1, 0] });
  });
  try {
    const provider = new OllamaEmbeddingProvider({ api: 'embeddings' });
    assert.deepEqual(Array.from(await provider.embedQuery('query')), [1, 0]);
    assert.deepEqual(await provider.embedTexts([]), []);
    assert.equal(calls, 1);
  } finally {
    restore();
  }
});

test('rejects malformed vectors and non-fallback modern errors', async () => {
  const restore = withFetch(async () =>
    jsonResponse({ embeddings: [[1, 'bad']] })
  );
  try {
    await assert.rejects(
      () => new OllamaEmbeddingProvider().embedTexts(['bad']),
      /finite number/i
    );
  } finally {
    restore();
  }

  const errorRestore = withFetch(async () =>
    jsonResponse({ error: 'server error' }, 500)
  );
  try {
    await assert.rejects(
      () => new OllamaEmbeddingProvider().embedTexts(['bad']),
      /500/
    );
  } finally {
    errorRestore();
  }
});
