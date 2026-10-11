# Browser use

These imports are runtime-safe. They do not require `node:fs`, `node:path`, or `node:crypto`:

```ts
import { createKarSession, evaluateKar, verifyKar, explainKarResult, createKarDossier } from '@knolo/core/kar';
import { compileCegSource, validateCegSource, lintCegSource, diffCegGraphs } from '@knolo/core/kar/authoring';
```

Pass image bytes and parsed objects that the host already loaded. `verifyKar` remounts those bytes. `createKarDossier` returns objects. Rendering returns a string.

Do not import `@knolo/core/node` for this path. CLI file helpers, `knolo kar`, and directory Domain Pack loading stay on Node.

`import { query } from '@knolo/core'` does not load KAR or the authoring compiler. The package `sideEffects` flag is false, and the root bundle does not reference `experimental/kar` or `/kar/index`. The public KAR bundle does not reference `/authoring`.

`packages/core/scripts/check-runtime-no-node.mjs` enforces those boundaries after `npm run build --workspace @knolo/core`.
