# @knolo/semantic-ollama

Optional Ollama embedding provider for Knolo’s hybrid retrieval layer.

```bash
npm install @knolo/semantic-ollama @knolo/core
```

```ts
import { OllamaEmbeddingProvider } from '@knolo/semantic-ollama';

const embeddings = new OllamaEmbeddingProvider({
  endpoint: 'http://localhost:11434',
  modelId: 'qwen3-embedding:4b',
});
const vector = await embeddings.embedQuery('billing policy');
```

The provider calls a local Ollama server through its `/api/embeddings`
endpoint. Semantic reranking is optional; Knolo’s default path remains local,
lexical, and deterministic. V5 Knowledge Image verification and migration are
provided by [`@knolo/core`](https://www.npmjs.com/package/@knolo/core).

## License

Apache-2.0
