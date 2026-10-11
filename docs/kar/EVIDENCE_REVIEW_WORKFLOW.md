# KAR Evidence Review

This is the developer workflow for one proposition. It uses the frozen `kar-1-research-1` evaluator and the frozen `ceg-source-1` compiler. A dossier packages that result. It does not change retrieval, and it does not write an answer to the question.

Package version in this phase: `5.5.1`.

## Install and build

From the repository root:

```bash
npm install
npm run build --prefix packages/core
npm run build --prefix packages/cli
```

The commands below use the local CLI:

```bash
node packages/cli/bin/knolo.mjs kar --help
```

Browser-safe code imports `@knolo/core/experimental/kar`. That entry returns dossier objects. It does not read or write the filesystem. The CLI is the filesystem wrapper.

## 1. Documents to a Knowledge Image

Put the source documents in a directory and build an image with the normal Knolo builder, or with `createKnowledgeImageV5` when you already have evidence objects.

Evidence object ids are the V5 digests of the chunk bytes and metadata. Later semantic bindings cite those ids. A sentence that is not in the image cannot become evidence.

The worked example builds the image for one public supply agreement:

```bash
node examples/kar-real/contracts/run.mjs
```

That script writes `examples/kar-real/contracts/knowledge.knolo`.

## 2. Produce semantics

Run the deterministic rule producer for a Domain Pack. Proposals are not a committed graph.

```bash
node packages/cli/bin/knolo.mjs kar produce rules \
  --image knowledge.knolo \
  --domain domains/contracts-v2 \
  --out proposals.json
```

`proposals.json` is a `ceg-producer-run-1` document. Each proposal names a rule, an evidence id, and the excerpt the rule matched. `NEEDS_REVIEW` proposals are not auto-accepted. Incomplete references stay observations.

Inspect them:

```bash
node packages/cli/bin/knolo.mjs kar produce review proposals.json
```

## 3. Review

Decisions are a `ceg-decisions-1` file. An empty decision list keeps proposals that are already `ACCEPTED` and drops every other state. An explicit `ACCEPTED` or `REJECTED` overrides that default.

```bash
node packages/cli/bin/knolo.mjs kar produce apply \
  --proposals proposals.json \
  --decisions decisions.json \
  --out generated.ceg.yaml
```

A reviewer may also add a binding the rules missed. The addition has to quote an exact substring of an evidence object. The worked example adds one writing duty in `examples/kar-real/contracts/review.json` and merges it with the accepted proposals before compilation.

Model proposals, when used, stay build-time only. They cannot be auto-accepted. They go through the same decision file.

## 4. Compile the CEG

```bash
node packages/cli/bin/knolo.mjs kar graph build \
  --image knowledge.knolo \
  --source generated.ceg.yaml \
  --out knowledge.kar.json
```

`compileCegSource` is the only writer of committed graph bytes. If the image no longer matches the graph, evaluation fails with: `CEG was compiled against a different image state. Recompile from the CEG Source.`

## 5. Evaluate KAR

The plan declares the frontiers, the requirement tokens, the floors, the profile, and `asOf`. The proposition is recorded and hashed. It does not filter evidence by itself.

```bash
node packages/cli/bin/knolo.mjs kar evaluate \
  --image knowledge.knolo \
  --graph knowledge.kar.json \
  --plan plan.json \
  --query "Can the customer terminate this agreement early?"
```

`SATISFIED` means the declared evidence requirements are satisfied. `UNSATISFIED_EVIDENCE_REQUIREMENTS` means they are not. That second status is a completed evaluation.

## 6. Create a dossier

```bash
node packages/cli/bin/knolo.mjs kar dossier build \
  --image knowledge.knolo \
  --graph knowledge.kar.json \
  --plan plan.json \
  --query "Can the customer terminate this agreement early?" \
  --out dossier/
```

The directory contains:

```text
manifest.json       format kar-evidence-dossier-1, roots, and digests
result.json         frozen evaluation
certificate.json    KAR certificate
evidence.md         human-readable rendering
knowledge.knolo     image copy
knowledge.kar.json  graph copy
plan.json           plan copy
```

`evidence.md` uses these sentences:

```text
Evidence requirements satisfied
Evidence requirements not satisfied
Evaluation did not decide evidence requirements: STATUS
```

The SUPPORT, OPPOSITION, QUALIFICATIONS, TEMPORAL/APPLICABILITY, and AUTHORITY sections list evidence admitted to those frontiers. SELECTED EVIDENCE is the minimum set for the plan.

In application code:

```ts
import { createKarDossier } from '@knolo/core/experimental/kar';

const dossier = createKarDossier({ image, graph, plan, proposition });
```

The same image, graph, plan, and proposition produce the same manifest and the same rendering.

## 7. Verify the dossier

```bash
node packages/cli/bin/knolo.mjs kar dossier verify dossier/
```

Verification recomputes the certificate from the image, the graph, the plan, and the proposition, then compares the manifest, the certificate, the result, and `evidence.md`. A changed rendering fails with `KAR_RESULT_MISMATCH`. Replacing every committed field with a different but internally consistent evaluation verifies, which is the same model as `verifyKar`.

## Worked contrast

`examples/kar-real/contracts/COMPARISON.md` places the production lexical top 5 beside the dossier for the Ultragenyx supply agreement.

Lexical retrieval returns the best matching evidence for the question text. KAR returns a minimum evidence set that satisfies the declared frontiers. The same directory contains a second dossier whose plan requires a survival duty the agreement does not state. Its status is `UNSATISFIED_EVIDENCE_REQUIREMENTS`, and its selected set is empty.

## What this workflow does not do

It does not call a model at query time. It does not rank evidence with a vector database. It does not turn a dossier into a prose answer. It does not change anchor semantics, frontiers, closure, minimum cover, exact cover, or abstention.
