import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseVersion = '6.2.0';
const coreReleaseVersion = '6.2.2';
const cliReleaseVersion = '6.2.5';
const reflexReleaseVersion = '0.2.0';
const platformVersion = '5.5.1';
const coreRange = '^6.0.0';
const cliCoreRange = '^6.2.0';

function readJson(relativePath) {
  return JSON.parse(readFileSync(path.join(root, relativePath), 'utf8'));
}

const npmPackages = [
  'packages/core/package.json',
  'packages/cli/package.json',
  'packages/langchain/package.json',
  'packages/llamaindex/package.json',
  'packages/semantic-ollama/package.json',
  'packages/create-knolo-app/package.json',
];

const reflexPackage = readJson('packages/reflex/package.json');
assert.equal(reflexPackage.name, '@knolo/reflex');
assert.equal(reflexPackage.version, reflexReleaseVersion);
assert.equal(reflexPackage.license, 'Apache-2.0');
assert.equal(reflexPackage.publishConfig?.access, 'public');
assert.equal(reflexPackage.dependencies?.['@knolo/core'], coreRange);
assert.ok(existsSync(path.join(root, 'packages/reflex/README.md')));

for (const relativePath of npmPackages) {
  const pkg = readJson(relativePath);
  const expectedVersion =
    relativePath === 'packages/cli/package.json'
      ? cliReleaseVersion
      : relativePath === 'packages/core/package.json'
        ? coreReleaseVersion
        : releaseVersion;
  assert.equal(
    pkg.version,
    expectedVersion,
    `${relativePath} must be ${expectedVersion}.`
  );
  assert.notEqual(pkg.private, true, `${relativePath} is marked private.`);
  assert.equal(
    pkg.license,
    'Apache-2.0',
    `${relativePath} must declare Apache-2.0.`
  );
  assert.ok(
    pkg.repository?.url,
    `${relativePath} is missing repository metadata.`
  );
  assert.ok(
    existsSync(path.join(root, path.dirname(relativePath), 'README.md')),
    `${relativePath} is missing a package README.`
  );

  if (pkg.name.startsWith('@')) {
    assert.equal(
      pkg.publishConfig?.access,
      'public',
      `${relativePath} must publish as public.`
    );
  }

  for (const dependencyGroup of [
    'dependencies',
    'optionalDependencies',
    'peerDependencies',
  ]) {
    for (const [name, range] of Object.entries(pkg[dependencyGroup] ?? {})) {
      if (name.startsWith('@knolo/')) {
        const expected =
          relativePath === 'packages/cli/package.json' && name === '@knolo/core'
            ? cliCoreRange
            : relativePath === 'packages/cli/package.json' &&
                name === '@knolo/exchange'
              ? '^0.1.0'
              : coreRange;
        assert.equal(
          range,
          expected,
          `${relativePath} has stale ${name} range.`
        );
      }
    }
  }
}

const template = readJson('packages/create-knolo-app/template/package.json');
assert.equal(template.dependencies['@knolo/core'], coreRange);
assert.equal(template.devDependencies['@knolo/cli'], coreRange);

const rustCore = readFileSync(
  path.join(root, 'packages/core-rust/Cargo.toml'),
  'utf8'
);
const rustIcp = readFileSync(
  path.join(root, 'packages/icp-canister/Cargo.toml'),
  'utf8'
);
assert.match(rustCore, new RegExp(`version = "${platformVersion}"`));
assert.match(rustIcp, new RegExp(`version = "${platformVersion}"`));
assert.match(
  rustIcp,
  new RegExp(
    `knolo-core-rust = \\{ path = "\\.\\./core-rust", version = "${platformVersion}" \\}`
  )
);

const pythonProject = readFileSync(
  path.join(root, 'packages/core-python/pyproject.toml'),
  'utf8'
);
const pythonInit = readFileSync(
  path.join(root, 'packages/core-python/src/knolo/__init__.py'),
  'utf8'
);
assert.match(pythonProject, new RegExp(`version = "${platformVersion}"`));
assert.match(pythonInit, new RegExp(`__version__ = "${platformVersion}"`));
assert.match(
  readFileSync(path.join(root, 'packages/core-python/README.md'), 'utf8'),
  /V5 Knowledge Image verification/i
);

const toolsVersion = '0.2.1';
const toolsCoreRange = '^6.2.1';
const mcpVersion = '0.2.3';
const openclawVersion = '0.1.0';
const toolsPackage = readJson('packages/knolo-tools/package.json');
assert.equal(toolsPackage.name, '@knolo/tools');
assert.equal(toolsPackage.version, toolsVersion);
assert.equal(toolsPackage.license, 'Apache-2.0');
assert.notEqual(toolsPackage.private, true);
assert.equal(toolsPackage.publishConfig?.access, 'public');
assert.equal(toolsPackage.engines?.node, '>=20');
assert.equal(toolsPackage.dependencies?.['@knolo/core'], toolsCoreRange);

const mcpPackage = readJson('packages/mcp/package.json');
assert.equal(mcpPackage.name, '@knolo/mcp');
assert.equal(mcpPackage.version, mcpVersion);
assert.equal(mcpPackage.license, 'Apache-2.0');
assert.notEqual(mcpPackage.private, true);
assert.equal(mcpPackage.publishConfig?.access, 'public');
assert.equal(mcpPackage.engines?.node, '>=20');
assert.equal(mcpPackage.mcpName, 'io.github.HiveForensics-AI/knolo');
assert.equal(mcpPackage.dependencies?.['@knolo/core'], toolsCoreRange);
assert.equal(mcpPackage.dependencies?.['@knolo/tools'], '^0.2.1');
assert.equal(mcpPackage.dependencies?.['@knolo/openclaw'], undefined);
const mcpServer = readJson('packages/mcp/server.json');
assert.equal(mcpServer.name, mcpPackage.mcpName);
assert.equal(mcpServer.version, mcpVersion);
assert.ok(mcpServer.description.length <= 100);
assert.equal(mcpServer.packages[0].identifier, '@knolo/mcp');
assert.equal(mcpServer.packages[0].version, mcpVersion);
assert.equal(mcpServer.packages[0].transport.type, 'stdio');
const mcpIndex = readFileSync(
  path.join(root, 'packages/mcp/src/index.ts'),
  'utf8'
);
assert.match(mcpIndex, /name: 'knolo', version: '0\.2\.3'/);

const boxPackage = readJson('packages/box/package.json');
assert.equal(boxPackage.name, '@knolo/box');
assert.equal(boxPackage.version, '0.1.1');
assert.equal(boxPackage.private, undefined);
assert.equal(boxPackage.dependencies?.['@knolo/core'], toolsCoreRange);
assert.equal(boxPackage.dependencies?.['@knolo/mcp'], '^0.2.3');
assert.equal(boxPackage.devDependencies?.['@knolo/tools'], '^0.2.1');

const aiSdkVersion = '0.1.0';
const aiSdkPackage = readJson('packages/ai-sdk/package.json');
assert.equal(aiSdkPackage.name, '@knolo/ai-sdk');
assert.equal(aiSdkPackage.version, aiSdkVersion);
assert.equal(aiSdkPackage.license, 'Apache-2.0');
assert.notEqual(aiSdkPackage.private, true);
assert.equal(aiSdkPackage.publishConfig?.access, 'public');
assert.equal(aiSdkPackage.engines?.node, '>=22');
assert.equal(aiSdkPackage.dependencies?.['@knolo/core'], cliCoreRange);
assert.equal(aiSdkPackage.dependencies?.['@knolo/tools'], '^0.2.0');
assert.equal(aiSdkPackage.peerDependencies?.ai, '^7.0.0');
assert.equal(aiSdkPackage.dependencies?.ai, undefined);
assert.equal(aiSdkPackage.devDependencies?.ai, '7.0.166');

const mastraVersion = '0.1.0';
const mastraPackage = readJson('packages/mastra/package.json');
assert.equal(mastraPackage.name, '@knolo/mastra');
assert.equal(mastraPackage.version, mastraVersion);
assert.equal(mastraPackage.license, 'Apache-2.0');
assert.notEqual(mastraPackage.private, true);
assert.equal(mastraPackage.publishConfig?.access, 'public');
assert.equal(mastraPackage.engines?.node, '>=22.13.0');
assert.equal(mastraPackage.dependencies?.['@knolo/core'], toolsCoreRange);
assert.equal(mastraPackage.dependencies?.['@knolo/tools'], '^0.2.1');
assert.equal(mastraPackage.peerDependencies?.['@mastra/core'], '^1.82.0');
assert.equal(mastraPackage.dependencies?.['@mastra/core'], undefined);
assert.equal(mastraPackage.devDependencies?.['@mastra/core'], '1.82.0');
assert.equal(mastraPackage.devDependencies?.['@knolo/mcp'], '^0.2.3');

const openaiAgentsVersion = '0.1.0';
const openaiAgentsPackage = readJson('packages/openai-agents/package.json');
assert.equal(openaiAgentsPackage.name, '@knolo/openai-agents');
assert.equal(openaiAgentsPackage.version, openaiAgentsVersion);
assert.equal(openaiAgentsPackage.license, 'Apache-2.0');
assert.notEqual(openaiAgentsPackage.private, true);
assert.equal(openaiAgentsPackage.publishConfig?.access, 'public');
assert.equal(openaiAgentsPackage.engines?.node, '>=22');
assert.equal(openaiAgentsPackage.dependencies?.['@knolo/core'], toolsCoreRange);
assert.equal(openaiAgentsPackage.dependencies?.['@knolo/tools'], '^0.2.1');
assert.equal(
  openaiAgentsPackage.peerDependencies?.['@openai/agents'],
  '^0.21.0'
);
assert.equal(openaiAgentsPackage.dependencies?.['@openai/agents'], undefined);
assert.equal(openaiAgentsPackage.devDependencies?.['@openai/agents'], '0.21.0');

const n8nNodesVersion = '0.1.0';
const n8nNodesPackage = readJson('packages/n8n-nodes-knolo/package.json');
assert.equal(n8nNodesPackage.name, 'n8n-nodes-knolo');
assert.equal(n8nNodesPackage.version, n8nNodesVersion);
assert.equal(n8nNodesPackage.license, 'Apache-2.0');
assert.equal(n8nNodesPackage.type, undefined);
assert.notEqual(n8nNodesPackage.private, true);
assert.equal(n8nNodesPackage.publishConfig?.access, 'public');
assert.equal(n8nNodesPackage.engines?.node, '>=22.12');
assert.equal(n8nNodesPackage.dependencies?.['@knolo/core'], toolsCoreRange);
assert.equal(n8nNodesPackage.dependencies?.['@knolo/tools'], '^0.2.1');
assert.deepEqual(n8nNodesPackage.peerDependencies, { 'n8n-workflow': '*' });
assert.equal(n8nNodesPackage.dependencies?.['n8n-workflow'], undefined);
assert.equal(n8nNodesPackage.dependencies?.n8n, undefined);
assert.equal(n8nNodesPackage.dependencies?.['n8n-core'], undefined);
assert.equal(n8nNodesPackage.devDependencies?.['n8n-workflow'], '2.47.0');
assert.equal(n8nNodesPackage.n8n?.n8nNodesApiVersion, 1);
assert.deepEqual(n8nNodesPackage.n8n?.credentials, []);
assert.deepEqual(n8nNodesPackage.n8n?.nodes, [
  'dist/nodes/Knolo/Knolo.node.js',
]);
assert.equal(
  n8nNodesPackage.keywords?.includes('n8n-community-node-package'),
  true
);

const openclawPackage = readJson('packages/openclaw/package.json');
assert.equal(openclawPackage.name, '@knolo/openclaw');
assert.equal(openclawPackage.version, openclawVersion);
assert.equal(openclawPackage.dependencies?.['@knolo/core'], '^5.5.1');
assert.equal(openclawPackage.dependencies?.['@knolo/tools'], '^0.1.0');
assert.equal(openclawPackage.engines?.node, '>=24.16.0');

console.log(
  `Release metadata passed for npm ${releaseVersion} with core ${coreReleaseVersion} and CLI ${cliReleaseVersion}. Rust and Python stay ${platformVersion}. @knolo/tools is ${toolsVersion}. @knolo/mcp is ${mcpVersion}. @knolo/ai-sdk is ${aiSdkVersion}. @knolo/mastra is ${mastraVersion} and is not published. @knolo/openai-agents is ${openaiAgentsVersion} and is not published. n8n-nodes-knolo is ${n8nNodesVersion} and is not published. @knolo/openclaw stays ${openclawVersion}. @knolo/box is 0.1.1.`
);
