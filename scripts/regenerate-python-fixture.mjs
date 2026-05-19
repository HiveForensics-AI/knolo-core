#!/usr/bin/env node
import { readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildPack } from '../packages/core/dist/index.js';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const fixtureDir = path.join(repoRoot, 'packages/core-python/tests/fixtures');
const corpusDir = path.join(fixtureDir, 'corpus');
const target = path.join(fixtureDir, 'simple.knolo');

const checkOnly = process.argv.includes('--check');
const corpus = [
  { file: 'intro.md', id: 'intro.md', namespace: 'docs.alpha' },
  { file: 'runtime.md', id: 'runtime.md', namespace: 'docs.beta' },
  { file: 'other.md', id: 'other.md', namespace: 'docs.alpha' },
];

function parseCorpusMarkdown(fileName, contents) {
  const normalized = contents.replace(/\r\n/g, '\n').trim();
  const lines = normalized.split('\n');
  const headingLine = lines[0];
  if (!headingLine?.startsWith('# ')) {
    throw new Error(`${fileName} must start with a level-1 markdown heading`);
  }

  const heading = headingLine.slice(2).trim();
  const text = lines.slice(1).join('\n').trim();
  if (!heading) {
    throw new Error(`${fileName} is missing a heading title`);
  }
  if (!text) {
    throw new Error(`${fileName} is missing body text`);
  }

  return { heading, text };
}

async function loadDocs() {
  const docs = [];
  for (const item of corpus) {
    const raw = await readFile(path.join(corpusDir, item.file), 'utf8');
    const parsed = parseCorpusMarkdown(item.file, raw);
    docs.push({
      id: item.id,
      heading: parsed.heading,
      namespace: item.namespace,
      text: parsed.text,
    });
  }
  return docs;
}

const bytes = await buildPack(await loadDocs(), { graph: { enabled: true } });

if (checkOnly) {
  const existing = await readFile(target);
  if (Buffer.compare(Buffer.from(bytes), existing) !== 0) {
    throw new Error(`Fixture bytes differ from ${path.relative(repoRoot, target)}`);
  }
  console.log(`Fixture matches ${path.relative(repoRoot, target)}`);
} else {
  await writeFile(target, bytes);
  console.log(`Wrote ${path.relative(repoRoot, target)}`);
}
