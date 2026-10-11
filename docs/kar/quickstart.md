# KAR quickstart

This walkthrough uses the redistributable contracts demo. It does not use the research corpus.

Build `@knolo/core`, then either run the demo or follow the calls below.

```bash
npm run build --workspace @knolo/core
node examples/kar-v6/run.mjs
```

From a checkout, `knolo kar demo` runs the same script. `knolo kar conformance` checks the public vectors.

Ordinary retrieval and KAR answer different questions. `query()` returns ranked passages that match a text query. `evaluateKar()` returns the minimum evidence set that meets the plan's support, opposition, qualification, temporal, and authority requirements. Ordinary retrieval stays available. KAR does not replace it.

## 1. Knowledge Image and CEG Source

`examples/kar-v6/run.mjs` writes, for each case:

- `knowledge.knolo`, the V5 Knowledge Image
- `knowledge.ceg.yaml`, the editable CEG Source
- `knowledge.kar.json`, the compiled Committed Evidence Graph
- `plan.json` and `query.txt`
- `dossier/`, the Evidence Dossier

The contracts case contains one permitting passage and one prohibiting passage. KAR keeps both.

## 2. Session and evaluation

```ts
import { readFileSync } from 'node:fs';
import { createKarSession, evaluateKar, explainKarResult } from '@knolo/core/kar';

const image = readFileSync('examples/kar-v6/contracts/knowledge.knolo');
const graph = JSON.parse(readFileSync('examples/kar-v6/contracts/knowledge.kar.json', 'utf8'));
const plan = JSON.parse(readFileSync('examples/kar-v6/contracts/plan.json', 'utf8'));
const proposition = readFileSync('examples/kar-v6/contracts/query.txt', 'utf8').trim();

const session = createKarSession({ image, graph });
const result = evaluateKar(session, { proposition, plan });
const explanation = explainKarResult(session, result);
```

`result.status` is `SATISFIED` for that plan. `result.frontiers.F_S` and `result.frontiers.F_O` both contain evidence ids. `result.certificate.roots` carries the frozen roots. There is no relevance score.

Filesystem reads stay in your program. `createKarSession` and `evaluateKar` take bytes and objects.

## 3. Dossier and verification

```ts
import { createKarDossier, verifyKar } from '@knolo/core/kar';

const dossier = createKarDossier({ image, graph, plan, proposition });
const verification = verifyKar({ image, graph, proposition, plan, result });
```

`dossier.statusStatement` is `Evidence requirements satisfied`. The dossier separates support, opposition, qualification, temporal applicability, authority, the selected minimum set, why those items were selected, the certificate roots, and the verification instructions.

```bash
knolo kar dossier verify examples/kar-v6/contracts/dossier
```

A matching dossier prints `VERIFIED`. A changed certificate, manifest, or the sentence `Claim proven` fails closed.

## 4. The other two demos

- `examples/kar-v6/policy` keeps a general requirement and an exception.
- `examples/kar-v6/operations` satisfies the valve step.
- `examples/kar-v6/operations/gap` is `UNSATISFIED_EVIDENCE_REQUIREMENTS`. The plan asked for a permit that the committed graph does not bind. That is abstention, not a finding that the proposition is false.

Abstention is a normal result. The CLI exits 0. Verification of a matching abstention certificate also exits 0. Verification of a tampered certificate exits non-zero.
