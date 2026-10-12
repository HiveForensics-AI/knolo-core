import { copyFileSync, mkdirSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const source = path.resolve(here, '../../../schemas/experimental/composition');
const target = path.resolve(here, '../dist/schemas/composition');
mkdirSync(target, { recursive: true });
const names = readdirSync(source)
  .filter((name) => name.endsWith('.schema.json'))
  .sort();
for (const name of names)
  copyFileSync(path.join(source, name), path.join(target, name));
console.log(`Copied ${names.length} composition schemas into dist/schemas/composition.`);
