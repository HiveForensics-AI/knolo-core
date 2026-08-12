# Knolo Cortex memory overlay

The overlay now serializes into v4 packs by default. Verify generated packs
with `knolo verify` and use `queryWithReceipt()` when evidence/replay metadata
is required.

```ts
import {
  buildPack,
  consolidateMemories,
  createCortex,
  mountPack,
  recall,
  remember,
} from '@knolo/core';

const cortex = createCortex({ actor: 'notes-app' });
const { cortex: next } = remember(cortex, {
  kind: 'note',
  text: 'Project alpha uses a local-first memory overlay.',
  labels: ['project.alpha'],
  namespace: 'project.alpha',
});

const hits = recall(next, 'project alpha');
const docs = consolidateMemories(next, { namespacePrefix: 'memory' });
const bytes = await buildPack(docs);
const pack = await mountPack({ src: bytes });
```

For local files in Node, keep using `@knolo/core/node` or load the bytes first and pass `Uint8Array` into `mountPack()`.
