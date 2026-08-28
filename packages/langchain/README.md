# @knolo/langchain

LangChain-style retrieval adapter for Knolo knowledge packs.

```bash
npm install @knolo/langchain @knolo/core
```

```js
import { KnoLoRetriever } from '@knolo/langchain';

const retriever = new KnoLoRetriever({
  packPath: './dist/knowledge.knolo',
  topK: 5,
});
const documents = await retriever.getRelevantDocuments('billing policy');
```

The adapter preserves Knolo’s deterministic V4 retrieval API. V5 Knowledge
Image inspection, verification, migration, and runtime management are exposed
by [`@knolo/core`](https://www.npmjs.com/package/@knolo/core) and
[`@knolo/cli`](https://www.npmjs.com/package/@knolo/cli).

## License

Apache-2.0
