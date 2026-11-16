import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdtempSync } from 'node:fs';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createServer } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const execFileAsync = promisify(execFile);
const askUrl = pathToFileURL(path.resolve(process.cwd(), 'bin/registry/ask.mjs')).href;
const credentialsUrl = pathToFileURL(path.resolve(process.cwd(), 'bin/registry/credentials.mjs')).href;
const cliPath = path.resolve(process.cwd(), 'bin/knolo.mjs');

function digest(excerpt) {
  return createHash('sha256').update(excerpt, 'utf8').digest('hex');
}

function hit(excerpt, patch = {}) {
  return {
    publisher: 'hive',
    slug: 'refunds',
    version: '1.0.0',
    visibility: 'public',
    objectId: 'chunk-1',
    stateRoot: 'sha256-abc',
    imageSha256: 'ab'.repeat(32),
    heading: 'Refunds',
    excerpt,
    excerptSha256: digest(excerpt),
    ...patch,
  };
}

function jsonResponse(body, status = 200) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(body),
  };
}

async function loadAsk() {
  return import(askUrl);
}

test('ask sends the excerpt to the model and prints the citation', async () => {
  const { runHubAsk } = await loadAsk();
  const excerpt = 'Customers may request a refund within 30 days.';
  const calls = [];
  const printed = [];
  const result = await runHubAsk(['what is the refund window?', '--model', 'llama3.2'], {
    env: {
      KNOLO_HUB_URL: 'https://fixture.example',
      KNOLO_MODEL_API_KEY: 'model-secret',
    },
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), options });
      if (String(url).includes('/api/v1/knowledge/query')) {
        return jsonResponse({ hits: [hit(excerpt)] });
      }
      return jsonResponse({
        choices: [{ message: { content: 'Refunds are available for 30 days.' } }],
      });
    },
    print: (value) => printed.push(value),
  });

  assert.equal(result.exitCode, 0);
  assert.equal(calls.length, 2);
  const hub = calls[0];
  const model = calls[1];
  assert.equal(new URL(hub.url).pathname, '/api/v1/knowledge/query');
  assert.equal(JSON.parse(hub.options.body).q, 'what is the refund window?');
  assert.equal(hub.options.headers.Authorization, undefined);
  assert.equal(JSON.stringify(hub.options.headers).includes('model-secret'), false);
  assert.equal(model.url, 'http://127.0.0.1:11434/v1/chat/completions');
  assert.equal(model.options.headers.authorization, 'Bearer model-secret');
  const modelBody = JSON.parse(model.options.body);
  assert.equal(modelBody.model, 'llama3.2');
  assert.match(modelBody.messages[0].content, /Answer only from the excerpts/);
  assert.match(modelBody.messages[1].content, /30 days/);
  assert.match(modelBody.messages[1].content, /hive\/refunds@1\.0\.0 chunk-1/);
  assert.equal(printed[0], 'Refunds are available for 30 days.');
  assert.deepEqual(printed.slice(1), ['', 'Citations:', 'hive/refunds@1.0.0 chunk-1']);
});

test('a mismatched excerpt hash is dropped and the model is not called', async () => {
  const { runHubAsk } = await loadAsk();
  const calls = [];
  const errors = [];
  const bad = hit('Thirty days.', { excerptSha256: 'a'.repeat(64) });
  const result = await runHubAsk(['refunds'], {
    env: { KNOLO_HUB_URL: 'https://fixture.example', KNOLO_MODEL: 'llama3.2' },
    fetchImpl: async (url, options) => {
      calls.push(String(url));
      assert.equal(options.body === undefined || !JSON.stringify(options.body).includes('llama'), true);
      return jsonResponse({ hits: [bad] });
    },
    printError: (value) => errors.push(value),
  });
  assert.equal(result.exitCode, 1);
  assert.deepEqual(calls, ['https://fixture.example/api/v1/knowledge/query']);
  assert.match(errors[0], /no matching evidence/);
});

test('an empty hit list does not call the model', async () => {
  const { runHubAsk } = await loadAsk();
  let calls = 0;
  const result = await runHubAsk(['refunds', '--model', 'llama3.2', '--hub', 'https://fixture.example'], {
    env: {},
    fetchImpl: async () => {
      calls += 1;
      return jsonResponse({ hits: [] });
    },
    printError: () => {},
  });
  assert.equal(result.exitCode, 1);
  assert.equal(calls, 1);
});

test('--evidence prints the bundle and does not call the model', async () => {
  const { runHubAsk } = await loadAsk();
  const excerpt = 'Damaged items are replaced within 14 days.';
  const printed = [];
  let calls = 0;
  const result = await runHubAsk(['damage', '--evidence', '--limit', '3'], {
    env: { KNOLO_HUB_URL: 'https://fixture.example', KNOLO_MODEL: 'llama3.2' },
    fetchImpl: async (url, options) => {
      calls += 1;
      assert.equal(JSON.parse(options.body).limit, 3);
      assert.equal(String(url).includes('11434'), false);
      return jsonResponse({ hits: [hit(excerpt, { objectId: 'damaged-items', heading: 'Damaged items' })] });
    },
    print: (value) => printed.push(value),
  });
  assert.equal(result.exitCode, 0);
  assert.equal(calls, 1);
  assert.match(printed.join('\n'), /hive\/refunds@1\.0\.0 damaged-items/);
  assert.match(printed.join('\n'), /14 days/);
  assert.match(printed.join('\n'), new RegExp(digest(excerpt)));
});

test('a refused model connection prints the excerpts and exits 2', async () => {
  const { runHubAsk } = await loadAsk();
  const excerpt = 'Start a return from the order page.';
  const printed = [];
  const errors = [];
  const result = await runHubAsk(['returns'], {
    env: {
      KNOLO_HUB_URL: 'https://fixture.example',
      KNOLO_MODEL: 'llama3.2',
      KNOLO_MODEL_BASE_URL: 'http://127.0.0.1:9/v1',
    },
    fetchImpl: async (url) => {
      if (String(url).includes('knowledge/query')) return jsonResponse({ hits: [hit(excerpt)] });
      throw new Error('connect ECONNREFUSED 127.0.0.1:9');
    },
    print: (value) => printed.push(value),
    printError: (value) => errors.push(value),
  });
  assert.equal(result.exitCode, 2);
  assert.match(errors[0], /unavailable/);
  assert.match(printed.join('\n'), /order page/);
  assert.match(printed.join('\n'), /hive\/refunds@1\.0\.0 chunk-1/);
});

test('a logged-in user sends the stored token only to Hub', async () => {
  const { runHubAsk } = await loadAsk();
  const { saveCredentials } = await import(credentialsUrl);
  const homeDir = mkdtempSync(path.join(tmpdir(), 'knolo-ask-home-'));
  await saveCredentials({
    registry: 'https://fixture.example',
    token: 'kno_owner_token_value',
    homeDir,
    env: {},
  });
  const calls = [];
  await runHubAsk(['refunds', '--model', 'llama3.2', '--registry', 'https://fixture.example'], {
    env: { KNOLO_MODEL_API_KEY: 'model-secret' },
    homeDir,
    fetchImpl: async (url, options = {}) => {
      calls.push({ url: String(url), headers: options.headers });
      if (String(url).includes('knowledge/query')) return jsonResponse({ hits: [] });
      return jsonResponse({ choices: [{ message: { content: 'unused' } }] });
    },
    printError: () => {},
  });
  assert.equal(calls[0].headers.Authorization, 'Bearer kno_owner_token_value');
  assert.equal(JSON.stringify(calls[0].headers).includes('model-secret'), false);
  assert.equal(calls.length, 1);
});

test('knolo ask exits 1 when Hub returns no evidence', async () => {
  const server = await listenJson({ hits: [] });
  const homeDir = mkdtempSync(path.join(tmpdir(), 'knolo-ask-exit-'));
  try {
    await assert.rejects(
      () => execFileAsync(process.execPath, [
        cliPath,
        'ask',
        'refunds',
        '--model',
        'llama3.2',
        '--hub',
        server.url,
      ], {
        encoding: 'utf8',
        env: {
          ...process.env,
          HOME: homeDir,
          XDG_CONFIG_HOME: homeDir,
          KNOLO_MODEL_API_KEY: '',
        },
      }),
      (error) => {
        assert.equal(error.code, 1);
        assert.match(error.stderr, /no matching evidence/);
        return true;
      }
    );
  } finally {
    server.close();
  }
});

function listenJson(body) {
  return new Promise((resolve) => {
    const server = createServer((request, response) => {
      request.on('data', () => {});
      request.on('end', () => {
        response.writeHead(200, { 'content-type': 'application/json' });
        response.end(JSON.stringify(body));
      });
    });
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      resolve({
        url: `http://127.0.0.1:${address.port}`,
        close: () => server.close(),
      });
    });
  });
}
