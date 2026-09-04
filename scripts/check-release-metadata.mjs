import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const releaseVersion = '5.1.0';
const cliReleaseVersion = '5.2.2';

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

for (const relativePath of npmPackages) {
  const pkg = readJson(relativePath);
  const expectedVersion = relativePath === 'packages/cli/package.json'
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
        assert.equal(
          range,
          `^${releaseVersion}`,
          `${relativePath} has stale ${name} range.`
        );
      }
    }
  }
}

const template = readJson('packages/create-knolo-app/template/package.json');
assert.equal(template.dependencies['@knolo/core'], `^${releaseVersion}`);
assert.equal(template.devDependencies['@knolo/cli'], `^${releaseVersion}`);

const rustCore = readFileSync(
  path.join(root, 'packages/core-rust/Cargo.toml'),
  'utf8'
);
const rustIcp = readFileSync(
  path.join(root, 'packages/icp-canister/Cargo.toml'),
  'utf8'
);
assert.match(rustCore, new RegExp(`version = "${releaseVersion}"`));
assert.match(rustIcp, new RegExp(`version = "${releaseVersion}"`));
assert.match(
  rustIcp,
  new RegExp(
    `knolo-core-rust = \\{ path = "\\.\\./core-rust", version = "${releaseVersion}" \\}`
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
assert.match(pythonProject, /version = "5\.1\.0"/);
assert.match(pythonInit, /__version__ = "5\.1\.0"/);
assert.match(
  readFileSync(path.join(root, 'packages/core-python/README.md'), 'utf8'),
  /V5 Knowledge Image verification/i
);

console.log(
  `Release metadata passed for npm/Rust/Python ${releaseVersion} with CLI-only @knolo/cli ${cliReleaseVersion}.`
);
