# Cortex API

Import Knolo Cortex from `@knolo/core/cortex`. The root `@knolo/core` entry does not load it. `createCortex` on the root export is the memory overlay, a different API.

```ts
import {
  createCortexSession,
  askCortex,
  runCortexRetrievalRound,
  verifyCortexAnswer,
  explainCortexAnswer,
  createCortexDossier,
  verifyCortexDossier,
  validateCortexTrace,
  resolveCortexPolicy,
  CORTEX_DEFAULT_POLICY,
  CORTEX_LIMITS,
  CortexError,
} from '@knolo/core/cortex';
```

Core does not call a network and does not load a model. The host passes a model adapter. Failure codes are in [Cortex error codes](errors.md). The loop and the modes are in the [Cortex guide](README.md).

## Functions

| Function | What it does | On failure |
| --- | --- | --- |
| `createCortexSession(input)` | Mounts the image bytes, resolves the policy, and binds an optional KAR graph and plan. Async. | Throws `CortexError` |
| `askCortex(session, input)` | Runs the loop and returns a sealed `knolo-cortex-trace-1` trace. Async. | Throws `CortexError` |
| `runCortexRetrievalRound(session, input)` | Runs one retrieval round and selects by lexical rank. It does not call the model. Async. | Throws `CortexError` |
| `verifyCortexAnswer(input)` | Replays a trace against the image. Async. | Returns `{ ok: false, code, message }` |
| `explainCortexAnswer(trace)` | Validates a trace and returns its rounds, rejected evidence, gaps, KAR references, and a citation map. It does not retrieve. `explainCortexTrace` is the same function. | Throws `CortexError` |
| `createCortexDossier(trace)` | Validates a trace and packages it with a `dossierRoot`. | Throws `CortexError` |
| `verifyCortexDossier(dossier, trace)` | Checks a dossier against its trace. It does not mount the image. | Returns `{ ok: false, code, message }` |
| `validateCortexTrace(value)` | Checks shape, caps, and roots, and returns the trace. It does not mount the image. | Throws `CortexError` |
| `resolveCortexPolicy(partial)`, `validateCortexPolicy(policy)` | Fill defaults and check bounds. | Throws `CortexError` |
| `cortexQuestionDigest`, `cortexEvidenceRoot`, `cortexAnswerRoot`, `cortexTraceRoot` | Recompute one digest. | — |

`CORTEX_MODES`, `CORTEX_ANSWER_STATUSES`, `CORTEX_CODES`, `CORTEX_TRACE_FORMAT`, and `CORTEX_DOSSIER_FORMAT` list the accepted values.

## Session

```ts
const session = await createCortexSession({
  image, // Uint8Array or ArrayBuffer: a V5 Knowledge Image or a V4 pack
  graph, // optional KAR graph: an object, a JSON string, or UTF-8 bytes
  plan, // optional KAR plan; prove_or_abstain needs a graph and a plan
  model, // optional CortexModelAdapter
  retriever, // optional CortexRetriever
  policy, // optional Partial<CortexPolicyV1>
});
```

A bound graph adds `knowledgeRoot` to the session image identity. That identity is part of every trace from the session, so verification needs the same graph.

```ts
const trace = await askCortex(session, {
  question: 'Where is the valve inspection?',
  mode: 'evidence_answer', // the default
  createdAt: '2026-11-25', // optional, 1 to 64 characters, not part of any root
  queryEmbedding, // optional Float32Array, needs allowSemanticRerank
});
```

The question is trimmed, and each run of whitespace becomes one space.

## Model adapter

Every hook is optional. A hook may return a value or a promise. Cortex validates each return value. A hook that returns an id it was not given fails with `CORTEX_MODEL_UNBOUND`.

| Hook | When it is called | Input | Output |
| --- | --- | --- | --- |
| `planQuestion` | Once, in every mode except `find_relevant`. | `{ question, mode }` | `{ subquestions }`, an array of strings. Cortex keeps the first `maxRounds`. An empty array falls back to the question. |
| `selectEvidence` | Each round in `evidence_answer`, `compare_sources`, and `prove_or_abstain`. | `{ question, round, query, hits }`. Each hit has `id`, `score`, `excerpt`, and `source` when the image has one. | `{ selectedIds, reason, rejected? }`. A hit that is neither selected nor rejected is recorded as `not-selected`. |
| `refineQuery` | In the same three modes, after a round that added new hit ids, while rounds remain. | `{ question, gaps, previousQueries }` | `{ query, reason }`. An empty or repeated query is skipped. A new query runs next. |
| `synthesizeAnswer` | Once, in the same three modes. `compare_sources` calls it only when the evidence has at least two sources. | `{ question, mode, evidence }`. Each item has `id`, `excerpt`, and `source` when known. | `{ text, claims?, citations?, gaps? }`. Claims and citations may name only selected evidence. |

The model sees excerpts of at most 500 characters. A `reason` longer than 500 characters is cut to 500.

Without `selectEvidence`, a round keeps the top `maxEvidenceInAnswer` hits by score, then by id, and records the rest as `over-cap`. Without `synthesizeAnswer`, `evidence_answer` and `prove_or_abstain` return `INSUFFICIENT_EVIDENCE` with a `model-required` gap. `compare_sources` does the same once it has two sources. When `allowAbstain` is false, those three modes fail with `CORTEX_MODEL_REQUIRED` instead.

Across rounds, the first selection of an id is kept. The final evidence is sorted by score, then by id, and capped at `maxEvidenceInAnswer`.

## Retrieval

| Image | Query | Score | Round receipt |
| --- | --- | --- | --- |
| V4 pack | Lexical query with a receipt. Query expansion is off. | Query score, rounded to 6 decimals | `v4-receipt` with `replayHash` and `packDigest` |
| V5 Knowledge Image | EQL `FROM chunk SEARCH "<query>" LIMIT <maxCandidatesPerRound>` | Rank position. The first of n hits scores n. | `v5-result` with `planRoot`, `resultRoot`, and `stateRoot` |
| Host retriever | The host function | The host score, rounded to 6 decimals. A missing score is 0. | `host-retriever` with `retrieverRoot` |

Semantic rerank applies only to a V4 pack that already stores vectors. It needs `allowSemanticRerank: true` and a `queryEmbedding`.

A host retriever replaces built-in retrieval:

```ts
const retriever = async ({ query, limit }) => ({
  hits: [{ id: 'block:0', score: 1.5 }],
});
```

Each id must already exist on the mounted image: `block:<n>` for a V4 pack, the object id for a V5 image. Cortex keeps at most `limit` hits and skips duplicates and ids that are not strings. It reads the excerpt and source from the image, not from the retriever. `retrieverRoot` is a digest of the returned ids, their scores, and the normalized query. Verification needs the same retriever.

## Policy and limits

| Field | Default | Allowed |
| --- | --- | --- |
| `maxRounds` | 4 | Integer from 1 to 8 |
| `maxCandidatesPerRound` | 80 | Integer from 1 to 200 |
| `maxEvidenceInAnswer` | 12 | Integer from 1 to 32 |
| `requireCitations` | `true` | Boolean |
| `allowSemanticRerank` | `false` | Boolean |
| `allowAbstain` | `true` | Boolean |

`CORTEX_LIMITS` also fixes a question at 4000 characters, an excerpt at 500, answer text at 8000, and a model reason at 500. The resolved policy is stored in the trace. Verification replays with that policy.

## Trace

A `knolo-cortex-trace-1` trace has these fields:

| Field | Contents |
| --- | --- |
| `question`, `questionDigest` | The normalized question and its digest |
| `image` | `kind` (`v4-pack` or `v5-image`), `stateRoot`, and `commitDigest` and `knowledgeRoot` when present |
| `policy` | The resolved policy |
| `rounds` | Per round: `round`, `query`, `normalizedQuery`, `lexicalHitIds`, `selectedIds`, `rejected`, `reason`, and `queryReceipt` |
| `selectedEvidence` | Per item: `id`, `score`, `excerpt`, `sourceDigest`, and `source` when present |
| `karEvaluations`, `karPlan` | Present when a KAR evaluation ran |
| `answer` | `status`, `text`, `claims`, `citations`, and `gaps` |
| `receipt` | `traceRoot`, `answerRoot`, `evidenceRoot`, and `createdAt` when supplied |

`sourceDigest` is the SHA-256 of the object bytes for a V5 image, and of `<docId>\n<block text>` for a V4 pack.

## Roots

Each digest is `sha256-` plus the lowercase hex SHA-256 of canonical JSON. Object keys sort by UTF-16 code units and arrays keep their order. This is the same form as [KAR certificates](../kar/certificates.md).

| Root | What it commits |
| --- | --- |
| `questionDigest` | The normalized question |
| `evidenceRoot` | Each selected evidence item in order: `id`, `score`, `excerpt`, `source` (empty when absent), and `sourceDigest` |
| `answerRoot` | `status`, `text`, `claims`, `citations`, and `gaps` |
| `traceRoot` | `format`, `questionDigest`, `image`, `policy`, `rounds`, the selected ids, `karEvaluations` (empty when absent), `karPlan` when present, `answerRoot`, and `evidenceRoot` |

`createdAt` is not part of any root.

## Verification order

`verifyCortexAnswer({ image, question, result, graph?, retriever?, queryEmbedding? })` returns the first failure in this order:

1. Trace shape, policy caps, `questionDigest`, and the three roots. This is `validateCortexTrace`.
2. The supplied question matches the trace question after whitespace is collapsed. The CLI and MCP default to the trace question.
3. The mounted image identity matches the trace: `kind`, `stateRoot`, `commitDigest`, and `knowledgeRoot`.
4. A trace with KAR references has a graph.
5. Each round replays with the trace policy: the same hit ids in the same order and the same receipt. Each selected id is in that replayed round.
6. Each selected evidence item matches its replayed hit: excerpt, source, `sourceDigest`, and score.
7. Each KAR reference matches a fresh evaluation: status, `karRoot`, `evidenceSetRoot`, and plan digest.

Verification does not call the model. It shows that the selected evidence came from replayed retrieval and that the answer body matches its roots. It does not show that the model chose well or that the answer is true.

## Dossier

`createCortexDossier(trace)` returns a `knolo-cortex-dossier-1` object with the question, answer, selected evidence, citations, KAR references, gaps, the three trace roots, `verified: true`, and a `dossierRoot` over the rest. `verifyCortexDossier(dossier, trace)` builds the dossier again from the trace and compares. It does not mount the image. Use `verifyCortexAnswer` for the image check. `verified: true` means the roots matched. It is not a truth verdict.

## CLI

| Command | Notes |
| --- | --- |
| `knolo cortex find <image> --question "..." [--top-k n] [--policy file] --out file` | Runs `find_relevant`. `--top-k` sets `maxCandidatesPerRound`. |
| `knolo cortex ask <image> --question "..." [--mode m] [--graph file] [--plan file] [--policy file] [--created-at text] --out file` | The default mode is `evidence_answer`. The CLI does not load a model, so that mode abstains. |
| `knolo cortex explain <trace>` | Prints `explainCortexAnswer`. |
| `knolo cortex verify --image <image> --answer <trace> [--graph file] [--question "..."]` | Prints `ok <traceRoot>`. A failure prints `knolo: <CODE>: <message>` and exits 1. |

`--out` refuses to overwrite a file. With `--out`, `find` and `ask` print `<status> <traceRoot>`. Without it, they print the trace JSON. `--policy` reads a JSON file with any subset of the policy fields.

The MCP tool `knolo_cortex_verify` verifies a trace against a pinned mount. See [`@knolo/mcp`](../../packages/mcp/README.md).
