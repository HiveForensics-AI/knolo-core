# Migration to V6

Package line moves from `5.5.1` through the historical prerelease `6.0.0-rc.1` to `6.0.0`. KAR semantics stay `kar-1-research-1`. CEG Source stays `ceg-source-1`.

Rust `knolo-core-rust` and Python `knolo` stay `5.5.0` in this candidate. They do not implement KAR.

## Imports

Prefer the public subpath:

```ts
import {
  createKarSession,
  evaluateKar,
  verifyKar,
  explainKarResult,
  createKarDossier,
} from '@knolo/core/kar';

import {
  createCegSource,
  compileCegSource,
  validateCegSource,
  lintCegSource,
  diffCegGraphs,
} from '@knolo/core/kar/authoring';
```

The experimental entry remains for this cycle. Its module comment is `@deprecated`. It re-exports the same implementation:

```ts
import { createKarSession, evaluateKar } from '@knolo/core/experimental/kar';
import { compileCegSource } from '@knolo/core/experimental/kar/authoring';
```

Do not import KAR from `@knolo/core`. The root entry stays limited to Knowledge Images and ordinary retrieval.

`createKarDossier` takes `{ image, graph, plan, proposition }`. It does not take a session. `verifyKar` takes bytes and objects, not a session. `evaluateKar` takes a session and `{ proposition, plan }`.

`explainKarCertificate` and `inspectKarComplexity` are also exported. They explain or estimate. They do not select a different evidence set.

## CLI

Command names are unchanged. New commands:

```bash
knolo kar demo
knolo kar conformance
knolo --version
```

`knolo kar evaluate` still abstains with exit 0. `knolo kar verify` and `knolo kar dossier verify` exit non-zero when the check fails. `--json` still prints the evaluation or manifest.

Domain directories for the bundled packs are `domains/contracts-v4`, `domains/policy-v4`, and `domains/operations-v4`. Earlier pack versions remain in the tree. Their roots are frozen. Do not add `maturity` to `domain.yaml`. Maturity lives in [`domains/v6-catalog.json`](../../domains/v6-catalog.json).

## Dependency ranges

Workspace packages that depend on `@knolo/core` use `^6.0.0`. The release candidate used `>=6.0.0-rc.1 <7` because a caret on that prerelease does not match `6.0.0`.

An experimental import and the public import evaluate the same committed inputs to the same `karRoot`:

```ts
import { createKarSession, evaluateKar } from '@knolo/core/experimental/kar';
import { createKarSession as createStableSession, evaluateKar as evaluateStable } from '@knolo/core/kar';
```

`@knolo/reflex` and `@knolo/evidence-gate` keep their own versions. Only their `@knolo/core` range moves.

## What did not change

- lexical query, BM25, MMR, semantic reranking
- V4 packs, V5 images, mounting, migration, EQL, VQF, Reflex, Evidence Gate
- `KARRoot` and the other frozen roots
- exact minimum-cover
- dossier sentences
