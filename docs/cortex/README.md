# Knolo Cortex

Knolo Cortex is reasoned evidence retrieval over a mounted V4 pack or a V5 Knowledge Image. Import it from `@knolo/core/cortex`. The root `@knolo/core` entry does not load it.

`createCortex` on the root export is a different API. That helper is the local memory overlay. Knolo Cortex is `createCortexSession`.

The host owns any model. Core does not call a network, does not embed a model, and does not decide that an answer is true. `verifyCortexAnswer` recomputes `traceRoot`, `answerRoot`, and `evidenceRoot`, checks evidence identity, replays the retrieval receipt, and recomputes KAR references. `evidenceRoot` commits the source label. Evidence must be selected by a replayed round. A dossier must match the trace body. A passing verification means the trace matches the declared evidence. It does not mean the claim is proven.

Rust, Python, and ICP do not implement Cortex. They stay on 5.5.1.

## Loop

```text
normalize question
  → retrieval round (V4 lexical receipt, or V5 EQL SEARCH)
  → optional host model selection
  → optional KAR evaluation
  → gap or refined query, inside the policy budget
  → answer from selected evidence only
  → Cortex trace
```

The model sees the question, hit ids, and excerpts of at most 500 characters. It never receives the corpus. A selected id, citation, or claim that names an id outside that round fails closed with `CORTEX_MODEL_UNBOUND`. A planned subquestion still runs when an earlier round adds no evidence. Refinement stops on that stalled round.

Semantic rerank stays off unless `allowSemanticRerank` is true and the caller passes a query embedding for vectors that are already on the pack. There is no vector database and no embedding provider inside this entry.

## Modes

| Mode | Result |
| --- | --- |
| `find_relevant` | Selected evidence and no prose. `ANSWERED` when a hit survives. |
| `evidence_answer` | Prose only from the host `synthesizeAnswer` adapter, with citations. Without a model, and when abstention is allowed, the status is `INSUFFICIENT_EVIDENCE`. |
| `compare_sources` | Needs two distinct sources. Fewer than two is `PARTIAL` or `INSUFFICIENT_EVIDENCE`. |
| `prove_or_abstain` | Requires a bound Committed Evidence Graph and a KAR plan. `SATISFIED` means the evidence requirements were met. `UNSATISFIED_EVIDENCE_REQUIREMENTS` is a gap, not a false claim. |
| `coverage_review` | Reports subquestions that retrieved nothing. A bound plan adds the KAR status as a gap. It does not load a Domain Pack. |

Answer statuses are `ANSWERED`, `PARTIAL`, and `INSUFFICIENT_EVIDENCE`.

## Policy

Defaults are 4 rounds, 80 candidates per round, and 12 evidence items in the answer. Hard caps are 8, 200, and 32. The caller supplies `createdAt` when it wants one. Core does not read the clock, and `createdAt` is not part of the three roots.

## CLI

`knolo cortex find`, `knolo cortex ask`, `knolo cortex explain`, and `knolo cortex verify` read local files. They do not take an API key. Pass a model only through `createCortexSession` in the host.

```ts
import { askCortex, createCortexSession, verifyCortexAnswer } from '@knolo/core/cortex';

const session = await createCortexSession({
  image,
  policy: { maxRounds: 2, allowAbstain: true },
});
const trace = await askCortex(session, { question: 'Where is the valve inspection?', mode: 'find_relevant' });
const verified = await verifyCortexAnswer({ image, question: trace.question, result: trace });
```

`verified.ok` means the roots match. The dossier field `verified: true` means the same thing. Neither one is a truth verdict.

Public vectors: [`conformance/cortex/v1`](../../conformance/cortex/v1/README.md).
