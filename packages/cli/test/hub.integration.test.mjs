import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { pathToFileURL } from 'node:url';

const enabled = process.env.KNOLO_HUB_INTEGRATION === '1';

test('optional live Hub read path smoke', { skip: !enabled }, async () => {
  const registry = process.env.KNOLO_HUB_URL || 'https://hub.knolo.dev';
  const pack = process.env.KNOLO_HUB_PACK;
  if (!pack) throw new Error('KNOLO_HUB_PACK is required when KNOLO_HUB_INTEGRATION=1.');

  const { runHubAdd, runHubInfo, runHubSearch } = await import(
    pathToFileURL(path.resolve(process.cwd(), 'bin/registry/commands.mjs')).href
  );
  const searchOutput = [];
  const search = await runHubSearch([
    process.env.KNOLO_HUB_QUERY || pack.replace(/\/.*$/, ''),
    '--json',
    '--registry',
    registry,
  ], { print: (value) => searchOutput.push(value) });
  assert.ok(Array.isArray(search.body.packs));
  assert.equal(JSON.parse(searchOutput[0]).packs.length, search.body.packs.length);

  const infoOutput = [];
  const info = await runHubInfo([pack, '--json', '--registry', registry], {
    print: (value) => infoOutput.push(value),
  });
  assert.equal(info.body.name, pack);
  assert.equal(JSON.parse(infoOutput[0]).name, pack);

  if (process.env.KNOLO_HUB_INSTALL !== '1') return;
  const core = await import(pathToFileURL(path.resolve(process.cwd(), '../core/dist/index.js')).href);
  const cwd = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-integration-'));
  const homeDir = mkdtempSync(path.join(tmpdir(), 'knolo-cli-hub-integration-home-'));
  await runHubAdd([pack, '--registry', registry, '--out', './downloaded.knolo'], {
    core,
    cwd,
    homeDir,
  });
});
