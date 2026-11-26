import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '@knolo/core';

const here = path.dirname(fileURLToPath(import.meta.url));
const docsDir = path.join(here, 'docs');
const names = (await readdir(docsDir))
  .filter((name) => name.endsWith('.md'))
  .sort();
const encoder = new TextEncoder();
const objects = [];
for (const name of names) {
  const text = await readFile(path.join(docsDir, name), 'utf8');
  objects.push({
    kind: 'chunk',
    bytes: encoder.encode(text),
    meta: { namespace: 'support', source: name },
  });
}

const policy = {
  version: 1,
  default: 'deny',
  rules: [
    {
      effect: 'allow',
      action: 'query',
      principal: 'mcp:reader',
      kind: 'chunk',
    },
    {
      effect: 'allow',
      action: 'read',
      principal: 'mcp:reader',
      kind: 'chunk',
    },
  ],
};

const image = createKnowledgeImageV5({ policy, objects });
const sha256 = createHash('sha256').update(image.bytes).digest('hex');
await writeFile(path.join(here, 'demo.v5'), image.bytes);
await writeFile(
  path.join(here, 'policy.json'),
  `${JSON.stringify(policy, null, 2)}\n`
);
await writeFile(
  path.join(here, 'pins.json'),
  `${JSON.stringify({ sha256, stateRoot: image.stateRoot }, null, 2)}\n`
);
process.stdout.write(`${sha256}\n${image.stateRoot}\n`);
