import fs from 'node:fs/promises';

const outputPath = process.argv[2] ?? './tasks-500.json';
const sourcePath = new URL(
  '../packages/reflex/fixtures/tasks-expanded.json',
  import.meta.url
);
const sourceTasks = JSON.parse(await fs.readFile(sourcePath, 'utf8'));
const tasks = Array.from({ length: 500 }, (_, index) => {
  const source = sourceTasks[index % sourceTasks.length];
  const sequence = String(index + 1).padStart(3, '0');
  return {
    ...source,
    id: `synthetic-${sequence}`,
    query: `${source.query} [synthetic case ${sequence}]`,
  };
});
const dataset = {
  schema: 'knolo.reflex.benchmark-dataset/v1',
  kind: 'synthetic-test',
  description:
    'Generated pipeline fixture from tasks-expanded.json; not production evidence.',
  source: 'packages/reflex/fixtures/tasks-expanded.json',
  tasks,
};
await fs.writeFile(outputPath, `${JSON.stringify(dataset, null, 2)}\n`);
console.log(`Generated ${tasks.length} synthetic benchmark tasks at ${outputPath}`);
