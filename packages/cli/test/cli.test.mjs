import test from 'node:test';
import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdtempSync,
  existsSync,
  mkdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';

const cliPath = path.resolve(process.cwd(), 'bin/knolo.mjs');
const cliPackageJson = JSON.parse(
  readFileSync(path.resolve(process.cwd(), 'package.json'), 'utf8')
);

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

function runShellCommand(command, { cwd, env = {} } = {}) {
  const captureDir = mkdtempSync(path.join(tmpdir(), 'knolo-cli-shell-'));
  const stdoutFile = path.join(captureDir, 'stdout.txt');
  const stderrFile = path.join(captureDir, 'stderr.txt');

  try {
    try {
      execSync(
        `${command} > ${shellQuote(stdoutFile)} 2> ${shellQuote(stderrFile)}`,
        {
          cwd,
          env: { ...process.env, ...env },
          shell: '/bin/bash',
          encoding: 'utf8',
        }
      );
    } catch (error) {
      if (error?.status !== 0) {
        const stdout = existsSync(stdoutFile)
          ? readFileSync(stdoutFile, 'utf8')
          : '';
        const stderr = existsSync(stderrFile)
          ? readFileSync(stderrFile, 'utf8')
          : '';
        const wrapped = new Error((stderr || stdout || error.message).trim());
        wrapped.cause = error;
        wrapped.stdout = stdout;
        wrapped.stderr = stderr;
        throw wrapped;
      }
    }

    return {
      stdout: existsSync(stdoutFile) ? readFileSync(stdoutFile, 'utf8') : '',
      stderr: existsSync(stderrFile) ? readFileSync(stderrFile, 'utf8') : '',
    };
  } catch (error) {
    throw error;
  } finally {
    rmSync(captureDir, { recursive: true, force: true });
  }
}

function runCli(args, cwd, env = {}) {
  const command = ['node', cliPath, ...args].map(shellQuote).join(' ');
  return runShellCommand(command, { cwd, env }).stdout;
}

function npmPack(workdir, destination) {
  const out = runShellCommand(
    `npm pack --json --pack-destination ${shellQuote(destination)}`,
    {
      cwd: workdir,
      env: {
        ...process.env,
        npm_config_cache: path.join(destination, '.npm-cache'),
      },
    }
  ).stdout;
  const [result] = JSON.parse(out);
  return path.join(destination, result.filename);
}

function createFakeDfxHarness(prefix) {
  const cwd = mkdtempSync(path.join(tmpdir(), prefix));
  const scriptPath = path.join(cwd, 'fake-dfx.sh');
  const argsFile = path.join(cwd, 'args.txt');
  const didFile = path.join(cwd, 'args.did');

  writeFileSync(
    scriptPath,
    `#!/usr/bin/env bash
set -euo pipefail
printf '%s\n' "$@" > "$FAKE_DFX_ARGS_FILE"
prev=""
for arg in "$@"; do
  if [ "$prev" = "--argument-file" ]; then
    cp "$arg" "$FAKE_DFX_DID_FILE"
  fi
  prev="$arg"
done
printf '{"ok":true}\n'
`,
    'utf8'
  );
  chmodSync(scriptPath, 0o755);

  return {
    env: {
      DFX_BIN: scriptPath,
      FAKE_DFX_ARGS_FILE: argsFile,
      FAKE_DFX_DID_FILE: didFile,
    },
    argsFile,
    didFile,
  };
}

test('packed @knolo/cli tarball includes expected runtime files only', () => {
  const packDir = mkdtempSync(path.join(tmpdir(), 'knolo-cli-pack-'));
  const cliDir = process.cwd();
  const tarballPath = npmPack(cliDir, packDir);

  const entries = runShellCommand(`tar -tzf ${shellQuote(tarballPath)}`, {
    cwd: cliDir,
  })
    .stdout.trim()
    .split('\n')
    .filter(Boolean);

  assert.ok(entries.includes('package/bin/knolo.mjs'));
  assert.ok(entries.includes('package/bin/registry/commands.mjs'));
  assert.ok(entries.includes('package/bin/registry/credentials.mjs'));
  assert.ok(entries.includes('package/bin/registry/http.mjs'));
  assert.ok(entries.includes('package/package.json'));
  assert.ok(
    entries.includes('package/templates/icp-knowledge-canister/dfx.json')
  );
  assert.equal(
    entries.some((entry) => entry.startsWith('package/test/')),
    false
  );
  assert.equal(
    entries.some((entry) => entry.startsWith('package/src/')),
    false
  );

  const packedPackageJson = JSON.parse(
    runShellCommand(
      `tar -xOf ${shellQuote(tarballPath)} ${shellQuote('package/package.json')}`,
      { cwd: cliDir }
    ).stdout
  );
  assert.equal(packedPackageJson.private, false);
  assert.equal(packedPackageJson.bin.knolo, 'bin/knolo.mjs');
  assert.equal(
    packedPackageJson.dependencies['@knolo/core'],
    cliPackageJson.dependencies['@knolo/core']
  );
});

test('init creates config and sample docs', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-init-'));
  const output = runCli(['init'], cwd);

  assert.match(output, /created knolo\.config\.json/);
  assert.ok(existsSync(path.join(cwd, 'knolo.config.json')));
  assert.ok(existsSync(path.join(cwd, 'docs/hello.md')));
});

test('build produces default pack', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-build-'));
  runCli(['init'], cwd);

  const output = runCli(['build'], cwd);
  assert.match(output, /indexed 1 files/);
  assert.ok(existsSync(path.join(cwd, 'dist/knowledge.knolo')));
});

test('inspect and verify expose the v4 container', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-v4-inspect-'));
  runCli(['init'], cwd);
  runCli(['build'], cwd);

  const inspected = JSON.parse(
    runCli(['inspect', './dist/knowledge.knolo'], cwd)
  );
  assert.equal(inspected.format, 'v4');
  assert.ok(
    inspected.container.sections.some((section) => section.name === 'manifest')
  );

  const verified = JSON.parse(
    runCli(['verify', './dist/knowledge.knolo'], cwd)
  );
  assert.equal(verified.verified, true);
});

test('hub search maps filters and renders compact pack rows', async () => {
  const { runHubSearch } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  let requestUrl;
  const printed = [];
  const responseBody = {
    packs: [
      {
        id: 'acme/refund-policy',
        version: '1.2.0',
        format: 'V5',
        license: 'Apache-2.0',
        pulls: 18420,
        description: 'Customer support policy',
      },
    ],
  };
  const output = await runHubSearch(
    [
      'refund policy',
      '--format',
      'v5',
      '--license',
      'Apache-2.0',
      '--official',
      '--agents',
    ],
    {
      env: { KNOLO_HUB_URL: 'https://fixture.example' },
      fetchImpl: async (url) => {
        requestUrl = new URL(url);
        return {
          ok: true,
          status: 200,
          text: async () => JSON.stringify(responseBody),
        };
      },
      print: (value) => printed.push(value),
    }
  );
  assert.equal(output.registry, 'https://fixture.example');
  assert.equal(requestUrl.pathname, '/api/v1/packs');
  assert.equal(requestUrl.searchParams.get('q'), 'refund policy');
  assert.equal(requestUrl.searchParams.get('format'), 'V5');
  assert.equal(requestUrl.searchParams.get('license'), 'Apache-2.0');
  assert.equal(requestUrl.searchParams.get('official'), 'true');
  assert.equal(requestUrl.searchParams.get('agents'), 'true');
  assert.match(
    printed[0],
    /NAME\s+VERSION\s+FORMAT\s+LICENSE\s+PULLS\s+DESCRIPTION/
  );
  assert.match(printed[0], /acme\/refund-policy/);
  assert.match(printed[0], /Customer support policy/);
});

test('hub search json mode preserves the response object', async () => {
  const { runHubSearch } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const responseBody = {
    packs: [
      { id: 'knolo/docs', version: '1.0.0', format: 'V5', topics: ['docs'] },
    ],
  };
  const printed = [];
  await runHubSearch(
    ['docs', '--json', '--registry', 'https://fixture.example'],
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(responseBody),
      }),
      print: (value) => printed.push(value),
    }
  );
  assert.deepEqual(JSON.parse(printed[0]), responseBody);
});

test('hub info renders the listing and supports json mode', async () => {
  const { runHubInfo } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const responseBody = {
    name: 'acme/refund-policy',
    publisher: 'acme',
    slug: 'refund-policy',
    description: 'Customer support policy',
    pack: {
      format: 'V5',
      version: '1.2.0',
      license: 'Apache-2.0',
      sizeBytes: 323584,
      docs: 12,
      blocks: 18,
      namespaces: ['support'],
      pulls: 18420,
      stars: 42,
      topics: ['refunds'],
    },
    latest: {
      version: '1.2.0',
      sha256:
        '21a9d04ea66f8a7da0b6427c6936e714d9e6b1f7d5c2a0b319f6e3d7a5b87a12',
      url: 'https://blob.example.test/sha256/21a9.knolo',
    },
  };
  const printed = [];
  await runHubInfo(
    ['acme/refund-policy', '--registry', 'https://fixture.example'],
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(responseBody),
      }),
      print: (value) => printed.push(value),
    }
  );
  assert.match(printed[0], /name\s+acme\/refund-policy/);
  assert.match(printed[0], /format\s+V5/);
  assert.match(
    printed[0],
    /sha256\s+21a9d04ea66f8a7da0b6427c6936e714d9e6b1f7d5c2a0b319f6e3d7a5b87a12/
  );

  await runHubInfo(
    ['acme/refund-policy', '--json', '--registry', 'https://fixture.example'],
    {
      fetchImpl: async () => ({
        ok: true,
        status: 200,
        text: async () => JSON.stringify(responseBody),
      }),
      print: (value) => printed.push(value),
    }
  );
  assert.deepEqual(JSON.parse(printed[1]), responseBody);
});

test('hub pack specs support omitted, exact, and latest versions', async () => {
  const { parsePackSpec } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/specs.mjs')).href
  );
  assert.deepEqual(parsePackSpec('acme/refund-policy'), {
    name: 'acme/refund-policy',
    publisher: 'acme',
    slug: 'refund-policy',
    version: 'latest',
  });
  assert.equal(parsePackSpec('acme/refund-policy@1.2.0').version, '1.2.0');
  assert.equal(parsePackSpec('acme/refund-policy@latest').version, 'latest');
});

test('hub registry configuration honors overrides and development defaults', async () => {
  const { normalizeRegistryUrl, registryApiUrl, resolveRegistryUrl } =
    await import(
      pathToFileURL(path.resolve(process.cwd(), 'bin/registry/config.mjs')).href
    );
  assert.equal(
    resolveRegistryUrl({ env: { KNOLO_HUB_URL: 'https://example.test/' } }),
    'https://example.test'
  );
  assert.equal(
    resolveRegistryUrl({
      value: 'https://override.test/',
      env: { KNOLO_HUB_URL: 'https://ignored.test' },
    }),
    'https://override.test'
  );
  assert.equal(
    resolveRegistryUrl({ env: { NODE_ENV: 'development' } }),
    'http://localhost:3000'
  );
  assert.equal(
    registryApiUrl('https://example.test', ['packs', 'acme', 'refund-policy'], {
      q: 'refund policy',
    }).toString(),
    'https://example.test/api/v1/packs/acme/refund-policy?q=refund+policy'
  );
  assert.throws(
    () => normalizeRegistryUrl('https://example.test/api'),
    /origin without a path/
  );
});

test('hub http client preserves structured errors', async () => {
  const { RegistryError } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/errors.mjs')).href
  );
  const { getJson } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/http.mjs')).href
  );
  await assert.rejects(
    () =>
      getJson('https://fixture.example/api/v1/packs/missing', {
        fetchImpl: async () => ({
          ok: false,
          status: 404,
          text: async () =>
            JSON.stringify({ error: 'Pack not found.', code: 'not_found' }),
        }),
      }),
    (error) => {
      assert.equal(error instanceof RegistryError, true);
      assert.equal(error.status, 404);
      assert.equal(error.code, 'not_found');
      assert.equal(error.message, 'Pack not found.');
      return true;
    }
  );
});

test('hub 401 errors explain the Bearer header instead of blaming CLI tokens', async () => {
  const { getJson } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/http.mjs')).href
  );
  await assert.rejects(
    () =>
      getJson('https://fixture.example/api/v1/account', {
        headers: { Authorization: 'Bearer kno_example' },
        fetchImpl: async () =>
          jsonResponse(
            { error: 'Sign in required.', code: 'unauthenticated' },
            401
          ),
      }),
    (error) => {
      assert.match(error.message, /Authorization: Bearer kno_/);
      assert.match(
        error.message,
        /GitHub sign-in is only required to mint tokens/
      );
      assert.doesNotMatch(error.message, /do not accept CLI tokens/);
      return true;
    }
  );
});

test('hub commands are registered without loading the core runtime for help', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-help-'));
  assert.match(runCli(['search', '--help'], cwd), /Usage: knolo search/);
  assert.match(runCli(['info', '--help'], cwd), /Usage: knolo info/);
  assert.match(runCli(['login', '--help'], cwd), /Usage: knolo login/);
  assert.match(
    runCli(['publish', '--help'], cwd),
    /Authorization: Bearer kno_/
  );
  assert.match(runCli(['publish', '--help'], cwd), /public Blob URL/);
  assert.match(runCli(['yank', '--help'], cwd), /Authorization: Bearer kno_/);
});

test('hub credentials are local, restrictive, and offline', async () => {
  const { runHubLogin, runHubLogout, runHubWhoami } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const homeDir = mkdtempSync(
    path.join(tmpdir(), 'knolo-cli-hub-credentials-')
  );
  const env = {
    KNOLO_HUB_URL: 'https://hub.example.test',
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
  };
  const token = 'kno_AbCdEfGhIjKlMnOpQrStUvWxYz0123456789';
  const printed = [];

  await runHubLogin(['--token', ` ${token} `], {
    env,
    homeDir,
    print: (value) => printed.push(value),
  });

  const credentialsPath = path.join(
    homeDir,
    '.config',
    'knolo',
    'credentials.json'
  );
  assert.equal(statSync(credentialsPath).mode & 0o777, 0o600);
  assert.deepEqual(JSON.parse(readFileSync(credentialsPath, 'utf8')), {
    registry: 'https://hub.example.test',
    token,
    prefix: token.slice(0, 12),
  });
  assert.equal(printed.join('\n').includes(token), false);
  assert.match(printed.join('\n'), /Authorization: Bearer kno_…/);

  const whoamiOutput = [];
  const identity = await runHubWhoami([], {
    env,
    homeDir,
    print: (value) => whoamiOutput.push(value),
  });
  assert.deepEqual(identity, {
    registry: 'https://hub.example.test',
    prefix: token.slice(0, 12),
  });
  assert.match(
    whoamiOutput.join('\n'),
    /registry https:\/\/hub\.example\.test/
  );
  assert.equal(whoamiOutput.join('\n').includes(token), false);

  const logoutOutput = [];
  const logout = await runHubLogout([], {
    env,
    homeDir,
    print: (value) => logoutOutput.push(value),
  });
  assert.equal(logout.removed, true);
  assert.equal(existsSync(credentialsPath), false);
  assert.match(logoutOutput[0], /logged out/);
  await assert.rejects(
    () => runHubWhoami([], { env, homeDir, print: () => {} }),
    /Not logged in/
  );
});

test('hub publish uses Bearer auth for Hub calls and never sends the token to Blob', async () => {
  const { runHubLogin, runHubPublish } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-publish-'));
  const homeDir = mkdtempSync(
    path.join(tmpdir(), 'knolo-cli-hub-publish-home-')
  );
  const env = {
    KNOLO_HUB_URL: 'https://hub.example.test',
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
    PACKS_READ_WRITE_TOKEN: 'vercel_blob_rw_test',
  };
  const token = 'kno_PublishToken012345678901234567890';
  const bytes = Buffer.from('tiny knolo artifact');
  const packPath = path.join(cwd, 'tiny.knolo');
  writeFileSync(packPath, bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const blobUrl = `https://blob-123.public.blob.vercel-storage.com/sha256/${digest}.knolo`;
  const calls = [];
  const blobPuts = [];
  const printed = [];

  await runHubLogin(['--token', token], { env, homeDir, print: () => {} });
  const result = await runHubPublish(
    [
      './tiny.knolo',
      '--slug',
      'tiny',
      '--version',
      '1.0.0',
      '--license',
      'MIT',
    ],
    {
      env,
      cwd,
      homeDir,
      pollIntervalMs: 1,
      sleep: async (milliseconds) => assert.equal(milliseconds, 1),
      print: (value) => printed.push(value),
      putImpl: async (pathname, body, options) => {
        blobPuts.push({ pathname, body, options });
        assert.equal(options.access, 'public');
        assert.equal(options.addRandomSuffix, false);
        assert.equal(options.contentType, 'application/octet-stream');
        assert.equal(options.cacheControlMaxAge, 31536000);
        assert.equal(options.token, env.PACKS_READ_WRITE_TOKEN);
        assert.notEqual(options.token, token);
        assert.equal(pathname, `sha256/${digest}.knolo`);
        assert.deepEqual(Buffer.from(body), bytes);
        return { url: blobUrl, pathname };
      },
      fetchImpl: async (url, init = {}) => {
        const call = { url: String(url), init };
        calls.push(call);
        if (call.url.endsWith('/api/v1/account'))
          return jsonResponse({ publisher: { handle: 'acme' } }, 200);
        if (call.url.endsWith('/api/upload/complete')) {
          assert.equal(init.headers.Authorization, `Bearer ${token}`);
          assert.deepEqual(JSON.parse(init.body), {
            sha256: digest,
            url: blobUrl,
            sizeBytes: bytes.length,
            pathname: `sha256/${digest}.knolo`,
          });
          return jsonResponse({ url: blobUrl }, 200);
        }
        if (call.url.endsWith('/api/v1/publish/verify')) {
          assert.equal(init.headers.Authorization, `Bearer ${token}`);
          assert.deepEqual(JSON.parse(init.body), { sha256: digest });
          return jsonResponse({ jobId: 'job-1' }, 200);
        }
        if (call.url.endsWith('/api/v1/publish/jobs/job-1')) {
          return jsonResponse(
            calls.filter(({ url: candidate }) =>
              candidate.endsWith('/api/v1/publish/jobs/job-1')
            ).length === 1
              ? { status: 'running' }
              : { status: 'passed' },
            200
          );
        }
        if (call.url.endsWith('/api/v1/publish/drafts')) {
          assert.equal(init.headers.Authorization, `Bearer ${token}`);
          assert.deepEqual(JSON.parse(init.body), {
            sha256: digest,
            slug: 'tiny',
            version: '1.0.0',
            license: 'MIT',
            attested: true,
          });
          return jsonResponse({ id: 'draft-1' }, 200);
        }
        if (call.url.endsWith('/api/v1/publish/drafts/draft-1/release')) {
          assert.equal(init.headers.Authorization, `Bearer ${token}`);
          return jsonResponse({ released: true }, 200);
        }
        throw new Error(`Unexpected Hub request: ${call.url}`);
      },
    }
  );

  assert.equal(result.name, 'acme/tiny');
  assert.equal(result.sha256, digest);
  assert.equal(result.url, blobUrl);
  assert.equal(blobPuts.length, 1);
  assert.deepEqual(
    calls.map(({ url }) => url),
    [
      'https://hub.example.test/api/v1/account',
      'https://hub.example.test/api/upload/complete',
      'https://hub.example.test/api/v1/publish/verify',
      'https://hub.example.test/api/v1/publish/jobs/job-1',
      'https://hub.example.test/api/v1/publish/jobs/job-1',
      'https://hub.example.test/api/v1/publish/drafts',
      'https://hub.example.test/api/v1/publish/drafts/draft-1/release',
    ]
  );
  assert.equal(printed.join('\n').includes(token), false);
  assert.match(printed.join('\n'), /published acme\/tiny@1\.0\.0/);
});

test('hub publish refuses private Blob upload URLs before sending bytes', async () => {
  const { runHubLogin, runHubPublish } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-private-'));
  const homeDir = mkdtempSync(
    path.join(tmpdir(), 'knolo-cli-hub-private-home-')
  );
  const env = {
    KNOLO_HUB_URL: 'https://hub.example.test',
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
    PACKS_READ_WRITE_TOKEN: 'vercel_blob_rw_test',
  };
  const token = 'kno_PrivateToken012345678901234567890';
  const bytes = Buffer.from('private blob must fail');
  writeFileSync(path.join(cwd, 'private.knolo'), bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const calls = [];
  await runHubLogin(['--token', token], { env, homeDir, print: () => {} });

  await assert.rejects(
    () =>
      runHubPublish(
        [
          './private.knolo',
          '--slug',
          'private',
          '--version',
          '1.0.0',
          '--license',
          'MIT',
        ],
        {
          env,
          cwd,
          homeDir,
          fetchImpl: async (url, init = {}) => {
            calls.push({ url: String(url), init });
            if (String(url).endsWith('/api/v1/account'))
              return jsonResponse({ publisher: { handle: 'acme' } }, 200);
            throw new Error(`Unexpected Hub request: ${url}`);
          },
          putImpl: async () => ({
            url: `https://blob.private.blob.vercel-storage.com/sha256/${digest}.knolo`,
            pathname: `sha256/${digest}.knolo`,
          }),
        }
      ),
    /Refusing private Blob URL.*public Blob URL/
  );
  assert.equal(calls.length, 1);
});

test('hub publish requires the public Blob pathname to match the artifact digest', async () => {
  const { runHubLogin, runHubPublish } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-pathname-'));
  const homeDir = mkdtempSync(
    path.join(tmpdir(), 'knolo-cli-hub-pathname-home-')
  );
  const env = {
    KNOLO_HUB_URL: 'https://hub.example.test',
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
    PACKS_READ_WRITE_TOKEN: 'vercel_blob_rw_test',
  };
  const token = 'kno_PathnameToken01234567890123456789';
  const bytes = Buffer.from('pathname must be checked');
  writeFileSync(path.join(cwd, 'pathname.knolo'), bytes);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const calls = [];
  await runHubLogin(['--token', token], { env, homeDir, print: () => {} });

  await assert.rejects(
    () =>
      runHubPublish(
        [
          './pathname.knolo',
          '--slug',
          'pathname',
          '--version',
          '1.0.0',
          '--license',
          'MIT',
        ],
        {
          env,
          cwd,
          homeDir,
          fetchImpl: async (url, init = {}) => {
            calls.push({ url: String(url), init });
            if (String(url).endsWith('/api/v1/account'))
              return jsonResponse({ publisher: { handle: 'acme' } }, 200);
            throw new Error(`Unexpected Hub request: ${url}`);
          },
          putImpl: async (pathname, body) => ({
            url: 'https://blob.public.blob.vercel-storage.com/other.knolo',
            pathname: `${pathname}.wrong`,
          }),
        }
      ),
    /Public Blob upload pathname is not locked/
  );
  assert.deepEqual(
    calls.map(({ url }) => url),
    ['https://hub.example.test/api/v1/account']
  );
});

test('hub publish rejects loopback, private, link-local, and local-only Blob hosts', async () => {
  const { runHubLogin, runHubPublish } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const hosts = [
    'localhost',
    '127.0.0.1',
    '192.168.1.20',
    '169.254.1.20',
    '[::1]',
    'service.internal',
  ];

  for (const host of hosts) {
    const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-local-blob-'));
    const homeDir = mkdtempSync(
      path.join(tmpdir(), 'knolo-cli-hub-local-blob-home-')
    );
    const env = {
      KNOLO_HUB_URL: 'https://hub.example.test',
      XDG_CONFIG_HOME: path.join(homeDir, '.config'),
      PACKS_READ_WRITE_TOKEN: 'vercel_blob_rw_test',
    };
    const token = 'kno_LocalHostToken0123456789012345678';
    const bytes = Buffer.from(`local Blob host ${host}`);
    writeFileSync(path.join(cwd, 'local.knolo'), bytes);
    const digest = createHash('sha256').update(bytes).digest('hex');
    await runHubLogin(['--token', token], { env, homeDir, print: () => {} });

    await assert.rejects(
      () =>
        runHubPublish(
          [
            './local.knolo',
            '--slug',
            'local',
            '--version',
            '1.0.0',
            '--license',
            'MIT',
          ],
          {
            env,
            cwd,
            homeDir,
            fetchImpl: async (url) =>
              String(url).endsWith('/api/v1/account')
                ? jsonResponse({ publisher: { handle: 'acme' } }, 200)
                : (() => {
                    throw new Error(`Unexpected Hub request: ${url}`);
                  })(),
            putImpl: async () => ({
              url: `https://${host}/sha256/${digest}.knolo`,
              pathname: `sha256/${digest}.knolo`,
            }),
          }
        ),
      /Blob URL.*public Blob URL/
    );
  }
});

test('hub write credentials cannot be sent to a different registry', async () => {
  const { runHubLogin, runHubPublish, runHubYank } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const homeDir = mkdtempSync(
    path.join(tmpdir(), 'knolo-cli-hub-registry-binding-home-')
  );
  const cwd = mkdtempSync(
    path.join(tmpdir(), 'knolo-cli-hub-registry-binding-')
  );
  const env = {
    KNOLO_HUB_URL: 'https://hub.example.test',
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
  };
  const token = 'kno_RegistryBindingToken01234567890123456';
  writeFileSync(path.join(cwd, 'bound.knolo'), Buffer.from('registry binding'));
  await runHubLogin(['--token', token], { env, homeDir, print: () => {} });

  const fetchImpl = async () => {
    throw new Error('The mismatched registry must be rejected before fetch.');
  };
  await assert.rejects(
    () =>
      runHubPublish(
        [
          './bound.knolo',
          '--slug',
          'bound',
          '--version',
          '1.0.0',
          '--license',
          'MIT',
          '--registry',
          'https://other.example.test',
        ],
        {
          env,
          cwd,
          homeDir,
          fetchImpl,
        }
      ),
    /Stored credentials belong to https:\/\/hub\.example\.test; refusing to send them to https:\/\/other\.example\.test/
  );
  await assert.rejects(
    () =>
      runHubYank(
        ['acme/bound@1.0.0', '--registry', 'https://other.example.test'],
        {
          env,
          homeDir,
          fetchImpl,
        }
      ),
    /Stored credentials belong to https:\/\/hub\.example\.test; refusing to send them to https:\/\/other\.example\.test/
  );
});

test('hub yank posts to the owner-only Bearer endpoint', async () => {
  const { runHubLogin, runHubYank } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const homeDir = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-yank-home-'));
  const env = {
    KNOLO_HUB_URL: 'https://hub.example.test',
    XDG_CONFIG_HOME: path.join(homeDir, '.config'),
  };
  const token = 'kno_YankToken012345678901234567890';
  const calls = [];
  await runHubLogin(['--token', token], { env, homeDir, print: () => {} });
  const result = await runHubYank(['acme/tiny@1.0.0'], {
    env,
    homeDir,
    fetchImpl: async (url, init) => {
      calls.push({ url: String(url), init });
      return jsonResponse({ yanked: true }, 200);
    },
    print: () => {},
  });

  assert.equal(result.name, 'acme/tiny');
  assert.equal(calls.length, 1);
  assert.equal(
    calls[0].url,
    'https://hub.example.test/api/v1/packs/acme/tiny/1.0.0/yank'
  );
  assert.equal(calls[0].init.method, 'POST');
  assert.equal(calls[0].init.headers.Authorization, `Bearer ${token}`);
  assert.equal(calls[0].init.body, undefined);
});

test('hub add fetches the manifest then Blob, verifies bytes, caches, and locks atomically', async () => {
  const { runHubAdd } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const core = await import(
    pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href
  );
  const bytes = await core.buildPack([
    {
      id: 'refund.md',
      text: '# Refund policy\n\nCustomers may request a refund.',
    },
  ]);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const manifest = {
    name: 'acme/refund-policy',
    version: '1.2.0',
    sha256: digest,
    url: `https://blob.example.test/sha256/${digest}.knolo`,
    license: 'Apache-2.0',
    sizeBytes: bytes.length,
    yanked: false,
    format: 'V4',
  };
  const calls = [];
  const printed = [];
  const warnings = [];
  const fetchImpl = async (url, init) => {
    calls.push({ url: String(url), init });
    if (calls.length === 1) return jsonResponse(manifest, 200);
    return {
      ok: true,
      status: 200,
      url: manifest.url,
      headers: new Headers({ 'content-length': String(bytes.length) }),
      arrayBuffer: async () =>
        bytes.buffer.slice(
          bytes.byteOffset,
          bytes.byteOffset + bytes.byteLength
        ),
    };
  };
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-add-'));
  const homeDir = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-home-'));

  const result = await runHubAdd(
    [
      'acme/refund-policy@1.2.0',
      '--registry',
      'https://hub.example.test',
      '--out',
      './dist/refund.knolo',
    ],
    {
      core,
      cwd,
      homeDir,
      fetchImpl,
      print: (value) => printed.push(value),
      warn: (value) => warnings.push(value),
    }
  );

  const cacheFile = path.join(
    homeDir,
    '.knolo',
    'cache',
    'sha256',
    `${digest}.knolo`
  );
  const lockfile = JSON.parse(
    readFileSync(path.join(cwd, 'knolo.lock.json'), 'utf8')
  );
  assert.equal(result.version, '1.2.0');
  assert.equal(result.path, path.join(cwd, 'dist/refund.knolo'));
  assert.deepEqual(lockfile, {
    registry: 'https://hub.example.test',
    packs: {
      'acme/refund-policy': {
        version: '1.2.0',
        sha256: digest,
        license: 'Apache-2.0',
      },
    },
  });
  assert.deepEqual(readFileSync(cacheFile), Buffer.from(bytes));
  assert.deepEqual(readFileSync(result.path), Buffer.from(bytes));
  assert.equal(statSync(cacheFile).mode & 0o777, 0o644);
  assert.equal(calls.length, 2);
  assert.match(
    calls[0].url,
    /^https:\/\/hub\.example\.test\/api\/v1\/packs\/acme\/refund-policy\/1\.2\.0$/
  );
  assert.equal(calls[1].url, manifest.url);
  assert.equal(calls[1].init.headers, undefined);
  assert.match(printed.join('\n'), /added acme\/refund-policy@1\.2\.0/);
  assert.equal(warnings.length, 0);
});

test('hub add validates and locks a V5 Knowledge Image', async () => {
  const { runHubAdd } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const core = await import(
    pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href
  );
  const image = core.createKnowledgeImageV5({
    objects: [
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('hub add v5 test'),
        meta: {},
      },
    ],
  });
  const bytes = image.bytes;
  const digest = createHash('sha256').update(bytes).digest('hex');
  const manifest = {
    name: 'knolo/v5-test',
    version: '5.0.0',
    sha256: digest,
    stateRoot: image.stateRoot,
    url: `https://blob.example.test/sha256/${digest}.knolo`,
    license: 'Apache-2.0',
    sizeBytes: bytes.length,
    yanked: false,
    format: 'V5',
  };
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-add-v5-'));
  const homeDir = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-home-v5-'));
  const calls = [];
  await runHubAdd(
    ['knolo/v5-test@5.0.0', '--registry', 'https://hub.example.test'],
    {
      core,
      cwd,
      homeDir,
      fetchImpl: async (url, init) => {
        calls.push({ url: String(url), init });
        if (calls.length === 1) return jsonResponse(manifest, 200);
        return {
          ok: true,
          status: 200,
          url: manifest.url,
          headers: new Headers({ 'content-length': String(bytes.length) }),
          arrayBuffer: async () =>
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength
            ),
        };
      },
      print: () => {},
    }
  );
  const lockfile = JSON.parse(
    readFileSync(path.join(cwd, 'knolo.lock.json'), 'utf8')
  );
  assert.equal(calls.length, 2);
  assert.equal(lockfile.packs['knolo/v5-test'].stateRoot, image.stateRoot);
});

test('hub add rejects V5 manifests without a stateRoot before downloading bytes', async () => {
  const { runHubAdd } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const core = await import(
    pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href
  );
  const manifest = {
    name: 'knolo/v5-missing-state-root',
    version: '5.0.0',
    sha256: 'a'.repeat(64),
    url: 'https://blob.example.test/sha256/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.knolo',
    sizeBytes: 1,
    yanked: false,
    format: 'V5',
  };
  const calls = [];
  await assert.rejects(
    () =>
      runHubAdd(
        [
          'knolo/v5-missing-state-root@5.0.0',
          '--registry',
          'https://hub.example.test',
        ],
        {
          core,
          homeDir: mkdtempSync(
            path.join(tmpdir(), 'knolo-cli-hub-home-v5-missing-root-')
          ),
          fetchImpl: async (url, init) => {
            calls.push({ url: String(url), init });
            return jsonResponse(manifest, 200);
          },
        }
      ),
    /stateRoot is required for V5 manifests/
  );
  assert.equal(calls.length, 1);
});

test('hub add rejects a V5 artifact when the manifest omits its stateRoot', async () => {
  const { runHubAdd } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const core = await import(
    pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href
  );
  const image = core.createKnowledgeImageV5({
    objects: [
      {
        kind: 'metadata',
        bytes: new TextEncoder().encode('missing manifest state root'),
        meta: {},
      },
    ],
  });
  const bytes = image.bytes;
  const digest = createHash('sha256').update(bytes).digest('hex');
  const manifest = {
    name: 'knolo/v5-missing-state-root',
    version: '5.0.0',
    sha256: digest,
    url: `https://blob.example.test/sha256/${digest}.knolo`,
    sizeBytes: bytes.length,
    yanked: false,
  };
  const cwd = mkdtempSync(
    path.join(tmpdir(), 'knolo-cli-hub-add-v5-runtime-check-')
  );
  const homeDir = mkdtempSync(
    path.join(tmpdir(), 'knolo-cli-hub-home-v5-runtime-check-')
  );
  await assert.rejects(
    () =>
      runHubAdd(
        [
          'knolo/v5-missing-state-root@5.0.0',
          '--registry',
          'https://hub.example.test',
        ],
        {
          core,
          cwd,
          homeDir,
          fetchImpl: async (url) =>
            String(url).includes('/api/')
              ? jsonResponse(manifest, 200)
              : {
                  ok: true,
                  status: 200,
                  url: manifest.url,
                  headers: new Headers({
                    'content-length': String(bytes.length),
                  }),
                  arrayBuffer: async () =>
                    bytes.buffer.slice(
                      bytes.byteOffset,
                      bytes.byteOffset + bytes.byteLength
                    ),
                },
        }
      ),
    /V5 artifact requires manifest stateRoot/
  );
  assert.equal(existsSync(path.join(cwd, 'knolo.lock.json')), false);
  assert.equal(
    existsSync(
      path.join(homeDir, '.knolo', 'cache', 'sha256', `${digest}.knolo`)
    ),
    false
  );
});

test('hub add fails closed on digest mismatch without writing a lockfile', async () => {
  const { runHubAdd } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const core = await import(
    pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href
  );
  const bytes = await core.buildPack([
    { id: 'doc.md', text: 'digest mismatch test' },
  ]);
  const manifest = {
    name: 'acme/digest-test',
    version: '1.0.0',
    sha256: '0'.repeat(64),
    url: 'https://blob.example.test/sha256/0000000000000000000000000000000000000000000000000000000000000000.knolo',
    sizeBytes: bytes.length,
    yanked: false,
  };
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-add-mismatch-'));
  const homeDir = mkdtempSync(
    path.join(tmpdir(), 'knolo-cli-hub-home-mismatch-')
  );
  await assert.rejects(
    () =>
      runHubAdd(
        ['acme/digest-test@1.0.0', '--registry', 'https://hub.example.test'],
        {
          core,
          cwd,
          homeDir,
          fetchImpl: async (url) =>
            String(url).includes('/api/')
              ? jsonResponse(manifest, 200)
              : {
                  ok: true,
                  status: 200,
                  url: manifest.url,
                  headers: new Headers({
                    'content-length': String(bytes.length),
                  }),
                  arrayBuffer: async () =>
                    bytes.buffer.slice(
                      bytes.byteOffset,
                      bytes.byteOffset + bytes.byteLength
                    ),
                },
        }
      ),
    /artifact sha256 mismatch/
  );
  assert.equal(existsSync(path.join(cwd, 'knolo.lock.json')), false);
});

test('hub add rejects advertised and actual Blob size mismatches', async () => {
  const { runHubAdd } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const core = await import(
    pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href
  );
  const bytes = await core.buildPack([
    { id: 'doc.md', text: 'size validation test' },
  ]);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const makeManifest = (sizeBytes) => ({
    name: 'acme/size-test',
    version: '1.0.0',
    sha256: digest,
    url: `https://blob.example.test/sha256/${digest}.knolo`,
    sizeBytes,
    yanked: false,
  });
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-add-size-'));
  const homeDir = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-home-size-'));
  await assert.rejects(
    () =>
      runHubAdd(
        ['acme/size-test@1.0.0', '--registry', 'https://hub.example.test'],
        {
          core,
          cwd,
          homeDir,
          fetchImpl: async (url) =>
            String(url).includes('/api/')
              ? jsonResponse(makeManifest(bytes.length), 200)
              : {
                  ok: true,
                  status: 200,
                  url: makeManifest(bytes.length).url,
                  headers: new Headers({
                    'content-length': String(bytes.length + 1),
                  }),
                  arrayBuffer: async () =>
                    bytes.buffer.slice(
                      bytes.byteOffset,
                      bytes.byteOffset + bytes.byteLength
                    ),
                },
        }
      ),
    /Content-Length.*does not match manifest/
  );

  await assert.rejects(
    () =>
      runHubAdd(
        ['acme/size-test@1.0.0', '--registry', 'https://hub.example.test'],
        {
          core,
          cwd: mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-add-body-size-')),
          homeDir: mkdtempSync(
            path.join(tmpdir(), 'knolo-cli-hub-home-body-size-')
          ),
          fetchImpl: async (url) =>
            String(url).includes('/api/')
              ? jsonResponse(makeManifest(bytes.length + 1), 200)
              : {
                  ok: true,
                  status: 200,
                  url: makeManifest(bytes.length + 1).url,
                  headers: new Headers(),
                  arrayBuffer: async () =>
                    bytes.buffer.slice(
                      bytes.byteOffset,
                      bytes.byteOffset + bytes.byteLength
                    ),
                },
        }
      ),
    /body length.*does not match manifest/
  );
});

test('hub add rejects non-HTTPS Blob URLs and invalid Knowledge Images', async () => {
  const { runHubAdd } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const core = await import(
    pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href
  );
  const invalidBytes = Buffer.from('not a Knowledge Image');
  const digest = createHash('sha256').update(invalidBytes).digest('hex');
  const baseManifest = {
    name: 'acme/invalid-test',
    version: '1.0.0',
    sha256: digest,
    sizeBytes: invalidBytes.length,
    yanked: false,
  };

  await assert.rejects(
    () =>
      runHubAdd(
        ['acme/invalid-test@1.0.0', '--registry', 'https://hub.example.test'],
        {
          core,
          homeDir: mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-home-http-')),
          fetchImpl: async (url) =>
            jsonResponse(
              {
                ...baseManifest,
                url: 'http://blob.example.test/artifact.knolo',
              },
              200
            ),
        }
      ),
    /Blob URL must use HTTPS/
  );

  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-add-invalid-'));
  const homeDir = mkdtempSync(
    path.join(tmpdir(), 'knolo-cli-hub-home-invalid-')
  );
  await assert.rejects(
    () =>
      runHubAdd(
        ['acme/invalid-test@1.0.0', '--registry', 'https://hub.example.test'],
        {
          core,
          cwd,
          homeDir,
          fetchImpl: async (url) =>
            String(url).includes('/api/')
              ? jsonResponse(
                  {
                    ...baseManifest,
                    url: `https://blob.example.test/sha256/${digest}.knolo`,
                  },
                  200
                )
              : {
                  ok: true,
                  status: 200,
                  url: `https://blob.example.test/sha256/${digest}.knolo`,
                  headers: new Headers({
                    'content-length': String(invalidBytes.length),
                  }),
                  arrayBuffer: async () =>
                    invalidBytes.buffer.slice(
                      invalidBytes.byteOffset,
                      invalidBytes.byteOffset + invalidBytes.byteLength
                    ),
                },
        }
      ),
    /not a Knowledge Image/
  );
  assert.equal(existsSync(path.join(cwd, 'knolo.lock.json')), false);
  assert.equal(
    existsSync(
      path.join(homeDir, '.knolo', 'cache', 'sha256', `${digest}.knolo`)
    ),
    false
  );
});

test('hub add refuses missing artifacts and does not fetch an empty URL', async () => {
  const { runHubAdd } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const core = await import(
    pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href
  );
  const manifest = {
    name: 'acme/not-uploaded',
    version: '1.0.0',
    sha256: '1'.repeat(64),
    url: '',
    sizeBytes: 0,
    yanked: false,
  };
  const calls = [];
  await assert.rejects(
    () =>
      runHubAdd(
        ['acme/not-uploaded', '--registry', 'https://hub.example.test'],
        {
          core,
          homeDir: mkdtempSync(
            path.join(tmpdir(), 'knolo-cli-hub-home-empty-')
          ),
          fetchImpl: async (url, init) => {
            calls.push({ url: String(url), init });
            return jsonResponse(manifest, 200);
          },
        }
      ),
    /artifact bytes are not stored yet/
  );
  assert.equal(calls.length, 1);
});

test('hub add refuses yanked versions unless forced', async () => {
  const { runHubAdd } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const core = await import(
    pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href
  );
  const bytes = await core.buildPack([{ id: 'doc.md', text: 'yanked test' }]);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const manifest = {
    name: 'acme/yanked',
    version: '1.0.0',
    sha256: digest,
    url: `https://blob.example.test/sha256/${digest}.knolo`,
    sizeBytes: bytes.length,
    yanked: true,
  };
  const response = () => ({
    ok: false,
    status: 410,
    text: async () =>
      JSON.stringify({ ...manifest, error: 'Version yanked.', code: 'yanked' }),
  });
  const refusedCalls = [];
  await assert.rejects(
    () =>
      runHubAdd(
        ['acme/yanked@1.0.0', '--registry', 'https://hub.example.test'],
        {
          core,
          homeDir: mkdtempSync(
            path.join(tmpdir(), 'knolo-cli-hub-home-yanked-')
          ),
          fetchImpl: async (url, init) => {
            refusedCalls.push({ url: String(url), init });
            return response();
          },
        }
      ),
    /version yanked.*--force/i
  );
  assert.equal(refusedCalls.length, 1);

  const warnings = [];
  const forcedCalls = [];
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-add-forced-'));
  await runHubAdd(
    ['acme/yanked@1.0.0', '--force', '--registry', 'https://hub.example.test'],
    {
      core,
      cwd,
      homeDir: mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-home-forced-')),
      fetchImpl: async (url, init) => {
        forcedCalls.push({ url: String(url), init });
        if (forcedCalls.length === 1) return response();
        return {
          ok: true,
          status: 200,
          url: manifest.url,
          headers: new Headers({ 'content-length': String(bytes.length) }),
          arrayBuffer: async () =>
            bytes.buffer.slice(
              bytes.byteOffset,
              bytes.byteOffset + bytes.byteLength
            ),
        };
      },
      warn: (value) => warnings.push(value),
      print: () => {},
    }
  );
  assert.equal(forcedCalls.length, 2);
  assert.match(warnings[0], /downloading yanked version/);
});

test('hub add maps a missing manifest to a stable not-found error', async () => {
  const { runHubAdd } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const core = await import(
    pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href
  );
  await assert.rejects(
    () =>
      runHubAdd(
        ['acme/missing@9.9.9', '--registry', 'https://hub.example.test'],
        {
          core,
          fetchImpl: async () =>
            jsonResponse(
              { error: 'Pack version not found.', code: 'not_found' },
              404
            ),
          homeDir: mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-home-404-')),
        }
      ),
    /pack version not found/
  );
});

test('hub add refuses a conflicting lockfile digest without force', async () => {
  const { runHubAdd } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const core = await import(
    pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href
  );
  const bytes = await core.buildPack([
    { id: 'doc.md', text: 'lock conflict test' },
  ]);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const cwd = mkdtempSync(
    path.join(tmpdir(), 'knolo-cli-hub-add-lock-conflict-')
  );
  const homeDir = mkdtempSync(
    path.join(tmpdir(), 'knolo-cli-hub-home-lock-conflict-')
  );
  const lockPath = path.join(cwd, 'knolo.lock.json');
  const original = {
    registry: 'https://hub.example.test',
    packs: {
      'acme/locked': {
        version: '0.9.0',
        sha256: 'f'.repeat(64),
        license: 'MIT',
      },
    },
  };
  writeFileSync(lockPath, `${JSON.stringify(original, null, 2)}\n`, 'utf8');
  const manifest = {
    name: 'acme/locked',
    version: '1.0.0',
    sha256: digest,
    url: `https://blob.example.test/sha256/${digest}.knolo`,
    sizeBytes: bytes.length,
    yanked: false,
  };
  const calls = [];
  await assert.rejects(
    () =>
      runHubAdd(
        ['acme/locked@1.0.0', '--registry', 'https://hub.example.test'],
        {
          core,
          cwd,
          homeDir,
          fetchImpl: async (url) => {
            calls.push(String(url));
            return String(url).includes('/api/')
              ? jsonResponse(manifest, 200)
              : {
                  ok: true,
                  status: 200,
                  url: manifest.url,
                  headers: new Headers({
                    'content-length': String(bytes.length),
                  }),
                  arrayBuffer: async () =>
                    bytes.buffer.slice(
                      bytes.byteOffset,
                      bytes.byteOffset + bytes.byteLength
                    ),
                };
          },
          print: () => {},
        }
      ),
    /different digest.*--force/
  );
  assert.equal(calls.length, 1);
  assert.equal(
    existsSync(
      path.join(homeDir, '.knolo', 'cache', 'sha256', `${digest}.knolo`)
    ),
    false
  );
  assert.deepEqual(JSON.parse(readFileSync(lockPath, 'utf8')), original);
});

test('hub add leaves cache and lockfile unchanged when output staging cannot replace a directory', async () => {
  const { runHubAdd } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const core = await import(
    pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href
  );
  const bytes = await core.buildPack([
    { id: 'doc.md', text: 'transactional install test' },
  ]);
  const digest = createHash('sha256').update(bytes).digest('hex');
  const manifest = {
    name: 'acme/transactional',
    version: '1.0.0',
    sha256: digest,
    url: `https://blob.example.test/sha256/${digest}.knolo`,
    sizeBytes: bytes.length,
    yanked: false,
  };
  const cwd = mkdtempSync(
    path.join(tmpdir(), 'knolo-cli-hub-add-transactional-')
  );
  const homeDir = mkdtempSync(
    path.join(tmpdir(), 'knolo-cli-hub-home-transactional-')
  );
  const lockPath = path.join(cwd, 'knolo.lock.json');
  const original = {
    registry: 'https://hub.example.test',
    packs: {
      'acme/transactional': {
        version: '0.9.0',
        sha256: 'f'.repeat(64),
        license: 'MIT',
      },
    },
  };
  writeFileSync(lockPath, `${JSON.stringify(original, null, 2)}\n`, 'utf8');
  mkdirSync(path.join(cwd, 'dist'));

  await assert.rejects(
    () =>
      runHubAdd(
        [
          'acme/transactional@1.0.0',
          '--force',
          '--out',
          './dist',
          '--registry',
          'https://hub.example.test',
        ],
        {
          core,
          cwd,
          homeDir,
          fetchImpl: async (url) =>
            String(url).includes('/api/')
              ? jsonResponse(manifest, 200)
              : {
                  ok: true,
                  status: 200,
                  url: manifest.url,
                  headers: new Headers({
                    'content-length': String(bytes.length),
                  }),
                  arrayBuffer: async () =>
                    bytes.buffer.slice(
                      bytes.byteOffset,
                      bytes.byteOffset + bytes.byteLength
                    ),
                },
        }
      ),
    /Cannot replace directory/
  );

  assert.deepEqual(JSON.parse(readFileSync(lockPath, 'utf8')), original);
  assert.equal(
    existsSync(
      path.join(homeDir, '.knolo', 'cache', 'sha256', `${digest}.knolo`)
    ),
    false
  );
  assert.equal(statSync(path.join(cwd, 'dist')).isDirectory(), true);
});

function jsonResponse(value, status) {
  return {
    ok: status >= 200 && status < 300,
    status,
    text: async () => JSON.stringify(value),
  };
}

test('v5 info and health expose verified runtime diagnostics', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-v5-diagnostics-'));
  const core = await import(
    pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href
  );
  const image = core.createKnowledgeImageV5({
    objects: [
      { kind: 'metadata', bytes: new TextEncoder().encode('cli v5'), meta: {} },
    ],
  });
  const imagePath = path.join(cwd, 'knowledge.v5');
  writeFileSync(imagePath, image.bytes);

  const info = JSON.parse(runCli(['v5', 'info', './knowledge.v5'], cwd));
  assert.equal(info.valid, true);
  assert.equal(info.image.stateRoot, image.stateRoot);
  assert.equal(info.image.objectCount, 1);

  const health = JSON.parse(
    runCli(['v5', 'health', '--image', './knowledge.v5'], cwd)
  );
  assert.equal(health.healthy, true);
  assert.equal(health.diagnosticsRoot, info.diagnosticsRoot);

  const studio = JSON.parse(runCli(['v5', 'studio', './knowledge.v5'], cwd));
  assert.equal(studio.valid, true);
  assert.equal(studio.surface, 'studio-management');
  assert.equal(studio.readOnly, true);
  assert.equal(studio.diagnostics.diagnosticsRoot, info.diagnosticsRoot);
  assert.equal(studio.capabilities.mutateImage, false);
});

test('migrate converts an ICP-compatible legacy pack to v4', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-v4-migrate-'));
  const docsDir = path.join(cwd, 'docs');
  mkdirSync(docsDir);
  writeFileSync(path.join(docsDir, 'alpha.txt'), 'alpha legacy text', 'utf8');
  runCli(['icp', 'build-pack', './docs', '--out', './legacy.knolo'], cwd);
  runCli(
    ['migrate', './legacy.knolo', '--out', './migrated.knolo', '--to', '4'],
    cwd
  );
  const verified = JSON.parse(runCli(['verify', './migrated.knolo'], cwd));
  assert.equal(verified.format, 'v4');
});

test('query returns hit from sample doc', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-query-'));
  runCli(['init'], cwd);
  runCli(['build'], cwd);

  const output = runCli(['query', 'hello'], cwd);
  assert.match(output, /Top 1 hit\(s\)/);
  assert.match(output, /docs\/hello\.md/);
});

test('query receipts can be explained and verified', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-receipt-'));
  runCli(['init'], cwd);
  runCli(['build'], cwd);
  runCli(['query', 'hello', '--receipt', './receipt.json', '--json'], cwd);
  assert.ok(existsSync(path.join(cwd, 'receipt.json')));
  const explained = runCli(
    ['explain', './receipt.json', '--pack', './dist/knowledge.knolo'],
    cwd
  );
  assert.match(explained, /"verified": true/);
});

test('add updates existing source path', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-add-'));
  runCli(['init'], cwd);
  mkdirSync(path.join(cwd, 'knowledge-base'));
  writeFileSync(path.join(cwd, 'knowledge-base', 'a.txt'), 'alpha', 'utf8');

  runCli(['add', 'docs', './knowledge-base'], cwd);

  const config = JSON.parse(
    readFileSync(path.join(cwd, 'knolo.config.json'), 'utf8')
  );
  assert.equal(config.sources[0].path, './knowledge-base');
});

test('icp init copies the bundled scaffold', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-icp-init-'));
  const target = path.join(cwd, 'demo');

  const output = runCli(['icp', 'init', target], cwd);

  assert.match(output, /created .*demo/);
  assert.ok(existsSync(path.join(target, 'dfx.json')));
  assert.ok(existsSync(path.join(target, 'knowledge/alpha.md')));
  assert.ok(
    existsSync(path.join(target, 'canisters/knolo-icp-canister/Cargo.toml'))
  );
});

test('icp build-pack produces a pack from a docs directory', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-icp-build-pack-'));
  const docsDir = path.join(cwd, 'knowledge');
  mkdirSync(path.join(docsDir, 'guides'), { recursive: true });
  writeFileSync(
    path.join(docsDir, 'alpha.md'),
    '# Alpha\n\nOne two three.\n',
    'utf8'
  );
  writeFileSync(
    path.join(docsDir, 'guides', 'beta.txt'),
    'Beta guide text.\n',
    'utf8'
  );

  const output = runCli(
    ['icp', 'build-pack', './knowledge', '--out', './dist/knowledge.knolo'],
    cwd
  );

  assert.match(output, /indexed 2 files/);
  assert.ok(existsSync(path.join(cwd, 'dist/knowledge.knolo')));
});

test('icp upload shells out through dfx with an argument file', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-icp-upload-'));
  const packPath = path.join(cwd, 'knowledge.knolo');
  writeFileSync(packPath, Buffer.from([1, 2, 3, 255]));
  const harness = createFakeDfxHarness('knolo-cli-fake-dfx-upload-');

  const output = runCli(
    [
      'icp',
      'upload',
      './knowledge.knolo',
      '--canister',
      'knolo_knowledge',
      '--label',
      'sample-pack',
    ],
    cwd,
    harness.env
  );

  const args = readFileSync(harness.argsFile, 'utf8');
  const didArgs = readFileSync(harness.didFile, 'utf8');
  assert.match(output, /\{"ok":true\}/);
  assert.match(args, /canister\ncall\nknolo_knowledge\nset_pack/);
  assert.match(didArgs, /\(vec \{ 1; 2; 3; 255 \}, "sample-pack"\)/);
});

test('icp query shells out through dfx query with top-k', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-icp-query-'));
  const harness = createFakeDfxHarness('knolo-cli-fake-dfx-query-');

  const output = runCli(
    ['icp', 'query', 'alpha beta', '--canister', 'knolo_knowledge', '--k', '7'],
    cwd,
    harness.env
  );

  const args = readFileSync(harness.argsFile, 'utf8');
  const didArgs = readFileSync(harness.didFile, 'utf8');
  assert.match(output, /\{"ok":true\}/);
  assert.match(args, /canister\ncall\nknolo_knowledge\nsearch\n--query/);
  assert.match(didArgs, /\("alpha beta", 7 : nat32\)/);
});

test('icp health and info call query methods', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-icp-health-'));
  const healthHarness = createFakeDfxHarness('knolo-cli-fake-dfx-health-');
  const healthOut = runCli(
    ['icp', 'health', '--canister', 'knolo_knowledge'],
    cwd,
    healthHarness.env
  );
  assert.match(healthOut, /\{"ok":true\}/);
  assert.match(
    readFileSync(healthHarness.argsFile, 'utf8'),
    /canister\ncall\nknolo_knowledge\nhealth\n--query/
  );

  const infoHarness = createFakeDfxHarness('knolo-cli-fake-dfx-info-');
  const infoOut = runCli(
    ['icp', 'info', '--canister', 'knolo_knowledge'],
    cwd,
    infoHarness.env
  );
  assert.match(infoOut, /\{"ok":true\}/);
  assert.match(
    readFileSync(infoHarness.argsFile, 'utf8'),
    /canister\ncall\nknolo_knowledge\npack_info\n--query/
  );
});

test('icp clear shells out to clear_pack', () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-icp-clear-'));
  const harness = createFakeDfxHarness('knolo-cli-fake-dfx-clear-');
  const output = runCli(
    ['icp', 'clear', '--canister', 'knolo_knowledge'],
    cwd,
    harness.env
  );
  assert.match(output, /\{"ok":true\}/);
  assert.match(
    readFileSync(harness.argsFile, 'utf8'),
    /canister\ncall\nknolo_knowledge\nclear_pack/
  );
});

test('semantic:validate succeeds for matching pack/model and fails on mismatch', async () => {
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-sem-validate-'));
  runCli(['init'], cwd);
  runCli(['build'], cwd);

  const coreModule = await import(
    pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href
  );
  const packPath = path.join(cwd, 'dist/knowledge.knolo');
  const packBytes = readFileSync(packPath);
  const pack = await coreModule.mountPack({ src: Uint8Array.from(packBytes) });
  const sidecarPath = path.join(cwd, 'dist/knowledge.knolo.semantic.json');
  const sidecar = {
    version: 1,
    packFingerprint: coreModule.createPackFingerprint(pack),
    modelId: 'qwen3-embedding:4b',
    dimension: 3,
    metric: 'cosine',
    createdAt: new Date().toISOString(),
    blocks: pack.blocks.map((_, blockId) => ({ blockId, vector: [1, 0, 0] })),
  };
  writeFileSync(sidecarPath, coreModule.serializeSidecar(sidecar), 'utf8');

  const output = runCli(
    [
      'semantic:validate',
      '--pack',
      './dist/knowledge.knolo',
      '--sidecar',
      './dist/knowledge.knolo.semantic.json',
      '--model',
      'qwen3-embedding:4b',
    ],
    cwd
  );
  assert.match(output, /validation passed/);

  assert.throws(
    () =>
      runCli(
        [
          'semantic:validate',
          '--pack',
          './dist/knowledge.knolo',
          '--sidecar',
          './dist/knowledge.knolo.semantic.json',
          '--model',
          'other-model',
        ],
        cwd
      ),
    /Semantic model mismatch/
  );
});
