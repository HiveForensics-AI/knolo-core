import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const npmPackages = [
  {
    name: '@knolo/core',
    directory: 'core',
    expected: [
      'README.md',
      'dist/index.js',
      'dist/index.d.ts',
      'dist/node.js',
      'dist/node.d.ts',
    ],
  },
  {
    name: '@knolo/cli',
    directory: 'cli',
    expected: ['README.md', 'bin/knolo.mjs'],
  },
  {
    name: '@knolo/langchain',
    directory: 'langchain',
    expected: ['README.md', 'src/index.js'],
  },
  {
    name: '@knolo/llamaindex',
    directory: 'llamaindex',
    expected: ['README.md', 'src/index.js'],
  },
  {
    name: '@knolo/semantic-ollama',
    directory: 'semantic-ollama',
    expected: ['README.md', 'dist/index.js', 'dist/index.d.ts'],
  },
  {
    name: 'create-knolo-app',
    directory: 'create-knolo-app',
    expected: ['README.md', 'bin/index.mjs', 'template/package.json'],
  },
];

const rustPackages = [
  {
    manifest: 'packages/core-rust/Cargo.toml',
    expected: ['Cargo.toml', 'README.md', 'src/lib.rs'],
  },
  {
    manifest: 'packages/icp-canister/Cargo.toml',
    expected: ['Cargo.toml', 'README.md', 'knolo_icp.did', 'src/lib.rs'],
  },
];

function checkNpmPackage({ name, directory, expected }) {
  const packageRoot = path.join(root, 'packages', directory);
  const manifest = JSON.parse(
    readFileSync(path.join(packageRoot, 'package.json'), 'utf8')
  );
  assert.notEqual(
    manifest.private,
    true,
    `${name}: package must be publishable.`
  );
  for (const filePath of expected) {
    assert.equal(
      existsSync(path.join(packageRoot, filePath)),
      true,
      `${name}: publication is missing ${filePath}.`
    );
  }
  assert.equal(
    (manifest.files ?? []).some((filePath) => filePath.startsWith('docs/v6/')),
    false,
    `${name}: local V6 materials must not be published.`
  );
  console.log(`Package publication source check passed: ${name}.`);
}

function checkRustPackage({ manifest, expected }) {
  const packageRoot = path.dirname(path.join(root, manifest));
  for (const filePath of expected) {
    assert.equal(
      existsSync(path.join(packageRoot, filePath)),
      true,
      `${manifest}: publication is missing ${filePath}.`
    );
  }
  console.log(`Crate publication source check passed: ${manifest}.`);
}

for (const packageInfo of npmPackages) {
  checkNpmPackage(packageInfo);
}

for (const packageInfo of rustPackages) checkRustPackage(packageInfo);

console.log('Package publication checks passed.');
