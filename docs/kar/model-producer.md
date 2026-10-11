# Model-assisted proposal producer

Model assistance is experimental and optional. Phase 9 does not require a live model. The classification of this producer, until a live corpus is scored, is `MODEL_PRODUCER_EXPERIMENTAL_ONLY`.

KAR evaluation stays offline, deterministic, and model-free. A model runs at authoring time only.

## Where the code lives

`@knolo/core` validates proposals and does not call a model, repair JSON, or import a provider.

```ts
import { validateModelProposals } from '@knolo/core/experimental/kar/authoring';
```

The local adapter is `@knolo/semantic-ollama`:

```ts
import { proposeCegWithOllama } from '@knolo/semantic-ollama';

const { output, prompt } = await proposeCegWithOllama({
  evidence: [{ id, text }],
  schema: domainSchema,
  model: 'qwen3:4b',
  endpoint: 'http://127.0.0.1:11434',
});
```

The default endpoint is `http://127.0.0.1:11434` and the default model name is `qwen3:4b`. Pass `fetchImpl` in tests. The adapter does not import authoring. A non-OK response, a non-string message, or a `JSON.parse` failure throws `CEG_PRODUCER_OUTPUT_INVALID`. Markdown fences are rejected. The adapter does not rewrite the payload.

No hosted OpenAI, Anthropic, or Gemini client is added. Credentials are not added to `@knolo/core`.

## Output contract

Schema: [`producer-proposals-v1.schema.json`](../../schemas/experimental/kar/producer-proposals-v1.schema.json).

```json
{
  "format": "ceg-model-proposals-1",
  "model": { "id": "qwen3:4b", "version": "local" },
  "concepts": [],
  "relations": [],
  "bindings": [],
  "aliases": []
}
```

Every concept, relation, and binding names an evidence id. A quote or a span should identify the source text. When a catalog is supplied, a missing object is `CEG_EVIDENCE_NOT_FOUND`, a span that does not fit is `CEG_PRODUCER_OUTPUT_INVALID`, and a quote that is absent from the text is `CEG_PRODUCER_UNGROUNDED`. A relation type outside the selected Domain Pack is `CEG_PRODUCER_RELATION_UNKNOWN`.

A date is copied onto a binding only when the quote contains that ISO date. Otherwise the field is omitted and the run warns `CEG_PRODUCER_INCOMPLETE_REFERENCE`. Authority is copied only when the quote contains the authority literal. Otherwise it is omitted and the run warns `CEG_PRODUCER_AUTHORITY_UNGROUNDED`. Model confidence stays on the proposal. Alias proposals stay on `run.aliases`.

Every surviving proposal is `PROPOSED`. The run fragment is empty. `autoAcceptModelOutput` is false and is not a configuration switch in this phase. `knolo kar produce model --auto` refuses to run.

## What becomes source

```text
model JSON
  -> validateModelProposals
  -> ceg-producer-run-1 with PROPOSED items
  -> human or batch decisions
  -> ACCEPTED fragments
  -> ceg-source-1
  -> compileCegSource()
  -> frozen KAR
```

Generation itself need not be deterministic. The run records model id, model version, and the input roots. Once the proposal file is frozen, accept, compile, and evaluate are deterministic.

`knolo kar produce model` reads a proposal file. It does not launch Ollama. Pass `--image` so the catalog is loaded, and `--domain` so the vocabulary is checked.

```bash
knolo kar produce model \
  --input model.json \
  --image knowledge.knolo \
  --domain domains/contracts \
  --out proposals.json

knolo kar produce apply \
  --proposals proposals.json \
  --decisions decisions.json \
  --out generated.ceg.yaml
```
