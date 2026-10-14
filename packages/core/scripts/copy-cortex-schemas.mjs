import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../../schemas/experimental/cortex');
const target = path.resolve(here, '../dist/schemas/cortex');
mkdirSync(target, { recursive: true });
const names = readdirSync(source)
  .filter((name) => name.endsWith('.schema.json'))
  .sort();
for (const name of names)
  copyFileSync(path.join(source, name), path.join(target, name));
console.log(`Copied ${names.length} cortex schemas into dist/schemas/cortex.`);
