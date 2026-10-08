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

The provider prefers Ollama’s current `/api/embed` endpoint and sends each
batch as one request with an array of inputs. It validates the response count
and keeps every vector in a consistent dimension. Set `api: 'embeddings'` to
force the deprecated endpoint, or leave the default `api: 'auto'` to fall back
to `/api/embeddings` only when an older server reports that `/api/embed` is not
available. Semantic reranking is optional; Knolo’s default path remains local,
lexical, and deterministic. V5 Knowledge Image verification and migration are
provided by [`@knolo/core`](https://www.npmjs.com/package/@knolo/core).

## License

Apache-2.0
