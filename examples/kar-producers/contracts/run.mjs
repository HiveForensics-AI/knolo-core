import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createKnowledgeImageV5 } from '../../../packages/core/dist/index.js';
import { loadDomainDirectory } from '../../../packages/cli/bin/kar-produce.mjs';
import {
  compileCegSource,
  emitCegSourceYaml,
  instantiatePlanTemplate,
  runRuleProducer,
  serializeCegBuild,
} from '../../../packages/core/dist/experimental/kar/authoring/index.js';
import { createKarSession, evaluateKar, verifyKar } from '../../../packages/core/dist/experimental/kar/index.js';

const directory = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(directory, '../../..');
const authoring = await import('../../../packages/core/dist/experimental/kar/authoring/index.js');
const encoder = new TextEncoder();
const documents = ['permit.md', 'bar.md', 'except.md'].map((name) => ({
  source: name,
  text: readFileSync(path.join(directory, 'docs', name), 'utf8'),
  meta: { type: 'contract' },
}));
const image = createKnowledgeImageV5({
  actor: 'kar-producers-contracts',
  sequence: 1,
  objects: documents.map((document) => ({
    kind: 'chunk',
    bytes: encoder.encode(document.text),
    meta: { source: document.source, ...document.meta },
  })),
});
const loaded = loadDomainDirectory(authoring, path.join(repo, 'domains/contracts'));
if (!loaded.ok) throw new Error(loaded.diagnostics.map((item) => item.code).join(','));
const ran = runRuleProducer({ pack: loaded.pack, image: image.bytes });
if (!ran.ok) throw new Error(ran.diagnostics.map((item) => item.code).join(','));
const plan = instantiatePlanTemplate(loaded.pack, 'showcase-review');
if (!plan.ok) throw new Error('showcase plan');
const compiled = compileCegSource({ source: ran.run.fragment, image: image.bytes });
if (!compiled.ok) throw new Error(compiled.diagnostics.map((item) => item.code).join(','));
const session = createKarSession({ image: image.bytes, graph: compiled.sidecar });
const proposition = 'May the agreement terminate?';
const result = evaluateKar(session, { proposition, plan: plan.plan });
const verdict = verifyKar({ image: image.bytes, graph: compiled.sidecar, proposition, plan: plan.plan, result });
writeFileSync(path.join(directory, 'knowledge.knolo'), image.bytes);
writeFileSync(path.join(directory, 'proposals.json'), `${JSON.stringify(ran.run, null, 2)}\n`);
writeFileSync(path.join(directory, 'generated.ceg.yaml'), emitCegSourceYaml(ran.run.fragment));
writeFileSync(path.join(directory, 'knowledge.kar.json'), compiled.bytes);
writeFileSync(path.join(directory, 'knowledge.kar.build.json'), serializeCegBuild(compiled.buildInfo));
writeFileSync(path.join(directory, 'plan.json'), `${JSON.stringify(plan.plan, null, 2)}\n`);
writeFileSync(path.join(directory, 'result.json'), `${JSON.stringify(result, null, 2)}\n`);
const populated = ['F_S', 'F_O', 'F_Q'].filter((frontier) => result.frontiers[frontier].length > 0);
console.log(result.status);
console.log(populated.join(' '));
console.log(verdict.ok ? 'VERIFIED' : verdict.code);
console.log(compiled.semanticRoot);
if (result.status !== 'SATISFIED' || populated.length !== 3 || !verdict.ok) process.exit(1);
