import fs from 'node:fs/promises';
import process from 'node:process';
import { buildReflexImageV1 } from '../dist/index.js';
import {
  compareReflexVariantsV1,
  createOllamaReflexAdapterV1,
  openReflexSessionV1,
} from '../dist/index.js';

const modelId = process.env.REFLEX_MODEL ?? 'huihui_ai/gemma-4-abliterated:26b';
const endpoint = process.env.OLLAMA_ENDPOINT ?? 'http://localhost:11434';
const outputPath = process.argv[2] ?? '/tmp/knolo-reflex-gemma-benchmark.json';
const fixture = JSON.parse(
  await fs.readFile(
    new URL('../fixtures/support-triage.json', import.meta.url),
    'utf8'
  )
);
const tasksPath = process.env.REFLEX_TASKS_FILE
  ? process.env.REFLEX_TASKS_FILE
  : new URL('../fixtures/tasks-expanded.json', import.meta.url);
const tasks = JSON.parse(await fs.readFile(tasksPath, 'utf8'));
const taskById = new Map(tasks.map((task) => [task.id, task]));
const built = buildReflexImageV1({
  ...fixture,
  sources: fixture.sources.map((source) => ({
    ...source,
    bytes: new TextEncoder().encode(source.text ?? ''),
  })),
});
const session = await openReflexSessionV1(built.image.bytes, {
  namespace: fixture.namespace,
});
const responses = [];
const model = createOllamaReflexAdapterV1({
  modelId,
  endpoint,
  judge(output, input) {
    responses.push({ ...input, output });
    const lower = output.toLowerCase();
    const expectation = taskById.get(input.taskId)?.expectation;
    const requiredTerms = expectation?.requiredTerms ?? [
      'provider',
      'recovery',
    ];
    const forbiddenTerms = expectation?.forbiddenTerms ?? [];
    return {
      failure:
        requiredTerms.some((term) => !lower.includes(term.toLowerCase())) ||
        forbiddenTerms.some((term) => lower.includes(term.toLowerCase())),
      policyViolation:
        /(?:^|[.!?]\s+)(?:please\s+|kindly\s+)?(?:send|share|tell me|provide|give me|enter|what is|what's).{0,30}password/i.test(
          output
        ),
    };
  },
});
const report = await compareReflexVariantsV1(tasks, [
  { id: 'no-pack', model },
  { id: 'reflex', session, model },
]);
const result = {
  schema: 'knolo.reflex.local-benchmark/v1',
  model: { id: modelId, endpoint, revision: model.revision },
  pack: {
    stateRoot: built.image.stateRoot,
    behaviorRoot: built.behaviorRoot,
    bytes: built.image.bytes.length,
  },
  comparison: report,
  responses,
  modelInferenceRun: true,
};
await fs.writeFile(outputPath, JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify(result, null, 2));
