import fs from 'node:fs/promises';

const sourcePath =
  process.argv[2] ?? '/tmp/knolo-banking77-source/banking_data/test.csv';
const outputPath = process.argv[3] ?? './tasks-500.json';
const csv = await fs.readFile(sourcePath, 'utf8');
const rows = parseCsv(csv);
if (rows.length < 500)
  throw new Error(`BANKING77 source contains only ${rows.length} rows.`);
const byCategory = new Map();
for (const row of rows) {
  const category = row.category?.trim();
  const text = row.text?.trim();
  if (!category || !text) continue;
  const bucket = byCategory.get(category) ?? [];
  bucket.push({ category, text });
  byCategory.set(category, bucket);
}
const categories = [...byCategory.keys()].sort();
const selected = [];
for (let index = 0; selected.length < 500; index++) {
  let added = false;
  for (const category of categories) {
    const item = byCategory.get(category)?.[index];
    if (!item) continue;
    selected.push(item);
    added = true;
    if (selected.length === 500) break;
  }
  if (!added) throw new Error('Unable to select 500 BANKING77 examples.');
}
const tasks = selected.map(({ category, text }, index) => ({
  id: `banking77-${String(index + 1).padStart(3, '0')}`,
  family: category,
  query: text,
  expectedIntent: category,
  expectation: {
    mode: 'answer',
    requiredTerms: category.replaceAll('_', ' ').split(' '),
  },
}));
const dataset = {
  schema: 'knolo.reflex.benchmark-dataset/v1',
  kind: 'public-seed',
  taskType: 'intent-classification',
  description:
    'Stratified 500-example BANKING77 test subset; public seed for structural evaluation only.',
  source: {
    name: 'BANKING77',
    publisher: 'PolyAI',
    repository: 'https://github.com/PolyAI-LDN/task-specific-datasets',
    license: 'CC BY 4.0',
    split: 'test',
  },
  tasks,
};
await fs.writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(
  `Converted ${tasks.length} stratified BANKING77 examples to ${outputPath}`
);

function parseCsv(value) {
  const records = [];
  let field = '';
  let record = [];
  let quoted = false;
  for (let index = 0; index < value.length; index++) {
    const character = value[index];
    const next = value[index + 1];
    if (character === '"' && quoted && next === '"') {
      field += '"';
      index++;
    } else if (character === '"') {
      quoted = !quoted;
    } else if (character === ',' && !quoted) {
      record.push(field);
      field = '';
    } else if (character === '\n' && !quoted) {
      record.push(field.replace(/\r$/u, ''));
      if (record.length) records.push(record);
      field = '';
      record = [];
    } else {
      field += character;
    }
  }
  if (field || record.length) {
    record.push(field.replace(/\r$/u, ''));
    records.push(record);
  }
  const [header, ...data] = records;
  return data.map((row) =>
    Object.fromEntries(header.map((name, index) => [name, row[index] ?? '']))
  );
}
