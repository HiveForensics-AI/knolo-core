import { createKnowledgeImageV5 } from '../../packages/core/dist/index.js';
import {
  createKiteSession,
  evaluateKiteSession,
} from '../../packages/core/dist/kite/index.js';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const contract = JSON.parse(
  readFileSync(path.join(here, 'contract.json'), 'utf8')
);
const rules = JSON.parse(readFileSync(path.join(here, 'rules.json'), 'utf8'));
const completeness = JSON.parse(
  readFileSync(path.join(here, 'completeness.json'), 'utf8')
);
const image = createKnowledgeImageV5({
  actor: 'kite-policy',
  sequence: 1,
  objects: [
    {
      kind: 'chunk',
      bytes: Buffer.from('The security policy forbids contractor access.\n'),
      meta: { source: 'policy.md' },
    },
    {
      kind: 'chunk',
      bytes: Buffer.from(
        'The contractor exception allows restricted access.\n'
      ),
      meta: { source: 'exception.md' },
    },
  ],
});
const result = await evaluateKiteSession(
  createKiteSession({ image: image.bytes, contract, rules, completeness }),
  { asOf: '2026-11-10' }
);
if (result.verdict !== 'UNDERDETERMINED' || result.certificate === null) {
  throw new Error(`Expected UNDERDETERMINED, got ${result.verdict}`);
}
console.log(`${result.verdict} ${result.certificate.invarianceRoot}`);
