import fs from 'node:fs/promises';

const sourcePath =
  process.argv[2] ?? '/tmp/knolo-clinc-oos/data/data_full.json';
const outputPath = process.argv[3] ?? '/tmp/knolo-clinc-oos-500.json';
const source = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const byIntent = new Map();
for (const [text, intent] of source.test ?? []) {
  if (!text?.trim() || !intent?.trim()) continue;
  const bucket = byIntent.get(intent) ?? [];
  bucket.push(text.trim());
  byIntent.set(intent, bucket);
}
const intents = [...byIntent.keys()].sort();
if (intents.length !== 150)
  throw new Error(
    `Expected 150 CLINC in-scope intents; found ${intents.length}.`
  );
const selected = [];
for (const intent of intents) {
  const examples = byIntent.get(intent);
  if (!examples || examples.length < 3)
    throw new Error(
      `CLINC intent ${intent} has fewer than three test examples.`
    );
  for (const text of examples.slice(0, 3)) selected.push({ text, intent });
}
const oos = (source.oos_test ?? [])
  .map(([text, intent]) => ({ text: text?.trim(), intent }))
  .filter(({ text, intent }) => text && intent === 'oos')
  .slice(0, 50);
if (oos.length !== 50)
  throw new Error(
    `Expected at least 50 CLINC OOS test examples; found ${oos.length}.`
  );
selected.push(...oos);

const tasks = selected.map(({ text, intent }, index) => ({
  id: `clinc150-${String(index + 1).padStart(3, '0')}`,
  family: intent,
  query: text,
  expectedIntent: intent,
}));
const dataset = {
  schema: 'knolo.reflex.benchmark-dataset/v1',
  kind: 'public-seed',
  taskType: 'intent-classification',
  description:
    'Stratified 500-example CLINC OOS test subset with 450 in-scope and 50 out-of-scope examples; public seed for structural evaluation only.',
  source: {
    name: 'CLINC OOS',
    publisher: 'CLINC',
    repository: 'https://github.com/clinc/oos-eval',
    license: 'CC BY 3.0',
    split: 'test',
  },
  tasks,
};
await fs.writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`Converted ${tasks.length} CLINC OOS examples to ${outputPath}`);
