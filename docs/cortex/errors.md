# Cortex error codes

Every Knolo Cortex failure carries one of the nine codes in `CORTEX_CODES`. Import them from `@knolo/core/cortex`. A passing verification means the trace matches the image. It does not mean the answer is true.

## How a failure surfaces

| Call | On failure |
| --- | --- |
| `createCortexSession`, `askCortex`, `runCortexRetrievalRound` | Throws `CortexError`. |
| `validateCortexTrace`, `explainCortexAnswer`, `createCortexDossier`, `resolveCortexPolicy`, `validateCortexPolicy` | Throws `CortexError`. |
| `verifyCortexAnswer`, `verifyCortexDossier` | Returns `{ ok: false, code, message }` and does not throw. Any other error is returned as `CORTEX_TRACE_INVALID`. |
| `knolo cortex find`, `ask`, `explain` | Prints `knolo: <message>` and exits 1. The code is not printed. |
| `knolo cortex verify` | Prints `knolo: <CODE>: <message>` and exits 1. |
| MCP `knolo_cortex_verify` | Returns `ok: false` with `code` and `message`, and writes an evidence receipt. See [`@knolo/mcp`](../../packages/mcp/README.md). |

`CortexError` has `code`, `message`, and `path`. `path` names the input that failed, such as `policy.maxRounds`, `question`, or `model.selectEvidence`. When Cortex wraps another error, that error is on `cause`.

```ts
import { CortexError, askCortex } from '@knolo/core/cortex';

try {
  const trace = await askCortex(session, { question, mode: 'evidence_answer' });
} catch (error) {
  if (!(error instanceof CortexError)) throw error;
  console.error(error.code, error.path, error.message);
}
```

## Codes

| Code | Raised when | What to check |
| --- | --- | --- |
| `CORTEX_POLICY_INVALID` | A policy field is outside its range or has the wrong type. The question is not a string, is empty, or is over 4000 characters after whitespace is collapsed. The mode is unknown. `createdAt` is empty or over 64 characters. `queryEmbedding` is passed without `allowSemanticRerank`. Semantic rerank runs on a V4 pack with no stored vectors. A retrieval query is empty. No query produced a retrieval round, for example a question made only of punctuation. A planned subquestion or a model gap is empty or over 4000 characters. | `path` names the field. The ranges are in [Policy and limits](api.md#policy-and-limits). |
| `CORTEX_TRACE_INVALID` | A trace or dossier has the wrong shape. Examples: not an object, an unknown `format`, a missing policy field, a policy over a hard cap, round numbers that do not start at 1, more rounds or hits than the policy allows, duplicate ids, an excerpt over 500 characters, answer text over 8000 characters, an incomplete gap or KAR reference, or an answer with text or claims and no citation while `requireCitations` is true. | Do not edit a trace by hand. Produce it again with `askCortex`. |
| `CORTEX_EVIDENCE_UNBOUND` | Evidence is not tied to retrieval. A host retriever returns no `hits` array, or an id that is not on the image. A round selects an id it did not retrieve. `selectedEvidence` holds an id that no round selected. A claim or citation names evidence that was not selected, or a citation excerpt differs. On verify, a replayed hit differs in excerpt, source, `sourceDigest`, or score. | A host retriever returns ids that already exist on the mounted image: `block:<n>` for a V4 pack, the object id for a V5 image. |
| `CORTEX_RECEIPT_MISMATCH` | A round's retrieval receipt does not hold. Its `normalizedQuery` differs from the round, a field for its kind is missing, or its kind is unknown. On verify, the replayed round returns different hit ids, a different order, or a different receipt. | Verify with the same image bytes, the same host retriever, and the same `queryEmbedding` that the run used. |
| `CORTEX_MODEL_UNBOUND` | The host model adapter broke its contract. `planQuestion` returned no `subquestions` array of strings. `selectEvidence` returned no `selectedIds` or `reason`, or named an id that was not retrieved in that round. `refineQuery` returned no `query` string. `synthesizeAnswer` returned no text, text over 8000 characters, an incomplete claim or gap, a claim or citation outside the selected evidence, or text or claims with no citation while `requireCitations` is true. | `path` names the hook. The model may use only the ids it was given. See [Model adapter](api.md#model-adapter). |
| `CORTEX_MODEL_REQUIRED` | `evidence_answer`, `compare_sources`, or `prove_or_abstain` ran without `synthesizeAnswer` while the policy sets `allowAbstain: false`. | Pass a model adapter with `synthesizeAnswer`, or keep `allowAbstain: true`. With abstention allowed, the run returns `INSUFFICIENT_EVIDENCE` with a `model-required` gap. |
| `CORTEX_KAR_UNBOUND` | The graph does not parse or does not bind to the image in `createCortexSession`. `prove_or_abstain` ran without both a graph and a plan. A KAR evaluation failed. On verify, a trace with KAR references was checked without a graph, or a fresh evaluation returned a different status, `karRoot`, `evidenceSetRoot`, or plan digest. | Pass the same graph and plan that the run used. |
| `CORTEX_ROOT_MISMATCH` | A digest does not match its body: `questionDigest`, `traceRoot`, `answerRoot`, or `evidenceRoot`. The question passed to `verifyCortexAnswer` differs from the trace question after whitespace is collapsed. A dossier's `dossierRoot` or body does not match its trace. | The trace or dossier changed after it was sealed. Produce it again. |
| `CORTEX_IMAGE_INVALID` | The bytes do not mount as a V5 Knowledge Image or a V4 pack. On verify, the mounted image identity (`kind`, `stateRoot`, `commitDigest`, `knowledgeRoot`) differs from the trace. | Verify with the exact bytes that the run used, and with the same graph. |

## Common cases

- A run with a bound graph records `knowledgeRoot` in the trace image identity. Verification needs the same graph, or none when the run had none. A trace from a run with a graph, checked without that graph, returns `CORTEX_IMAGE_INVALID`. The identity check runs before the KAR check, so the code is not `CORTEX_KAR_UNBOUND`. Pass the same `--graph` to `knolo cortex verify`.
- A trace from a host retriever replays only through `verifyCortexAnswer` with the same retriever. `knolo cortex verify` and `knolo_cortex_verify` use built-in retrieval. Their replayed receipt differs, and verification returns `CORTEX_RECEIPT_MISMATCH`.
- `knolo cortex ask` without `--mode` runs `evidence_answer`. The CLI does not load a model, so the trace is `INSUFFICIENT_EVIDENCE` with a `model-required` gap. That is abstention, not an error. With `"allowAbstain": false` in `--policy`, the same command fails with `CORTEX_MODEL_REQUIRED`.
- `--top-k` sets `maxCandidatesPerRound`. A value over 200 fails with `CORTEX_POLICY_INVALID`.
- `UNSATISFIED_EVIDENCE_REQUIREMENTS` on a KAR reference is not an error. It is a gap in the answer. It does not mean the claim is false.
