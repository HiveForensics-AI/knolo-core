import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseVersion = '6.2.0';
const cliReleaseVersion = '6.2.0';
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

const toolsVersion = '0.2.0';
const mcpVersion = '0.2.0';
const openclawVersion = '0.1.0';
const toolsPackage = readJson('packages/knolo-tools/package.json');
assert.equal(toolsPackage.name, '@knolo/tools');
assert.equal(toolsPackage.version, toolsVersion);
assert.equal(toolsPackage.license, 'Apache-2.0');
assert.notEqual(toolsPackage.private, true);
assert.equal(toolsPackage.publishConfig?.access, 'public');
assert.equal(toolsPackage.engines?.node, '>=20');
assert.equal(toolsPackage.dependencies?.['@knolo/core'], coreRange);

const mcpPackage = readJson('packages/mcp/package.json');
assert.equal(mcpPackage.name, '@knolo/mcp');
assert.equal(mcpPackage.version, mcpVersion);
assert.equal(mcpPackage.license, 'Apache-2.0');
assert.notEqual(mcpPackage.private, true);
assert.equal(mcpPackage.publishConfig?.access, 'public');
assert.equal(mcpPackage.engines?.node, '>=20');
assert.equal(mcpPackage.mcpName, 'io.github.HiveForensics-AI/knolo');
assert.equal(mcpPackage.dependencies?.['@knolo/core'], cliCoreRange);
assert.equal(mcpPackage.dependencies?.['@knolo/tools'], '^0.2.0');
assert.equal(mcpPackage.dependencies?.['@knolo/openclaw'], undefined);
const mcpServer = readJson('packages/mcp/server.json');
assert.equal(mcpServer.name, mcpPackage.mcpName);
assert.equal(mcpServer.version, mcpVersion);
assert.ok(mcpServer.description.length <= 100);
assert.equal(mcpServer.packages[0].identifier, '@knolo/mcp');
assert.equal(mcpServer.packages[0].version, mcpVersion);
assert.equal(mcpServer.packages[0].transport.type, 'stdio');

const openclawPackage = readJson('packages/openclaw/package.json');
assert.equal(openclawPackage.name, '@knolo/openclaw');
assert.equal(openclawPackage.version, openclawVersion);
assert.equal(openclawPackage.dependencies?.['@knolo/core'], '^5.5.1');
assert.equal(openclawPackage.dependencies?.['@knolo/tools'], '^0.1.0');
assert.equal(openclawPackage.engines?.node, '>=24.16.0');

console.log(
  `Release metadata passed for npm ${releaseVersion} with CLI ${cliReleaseVersion}. Rust and Python stay ${platformVersion}. @knolo/tools is ${toolsVersion}. @knolo/mcp is ${mcpVersion}. @knolo/openclaw stays ${openclawVersion}.`
);
