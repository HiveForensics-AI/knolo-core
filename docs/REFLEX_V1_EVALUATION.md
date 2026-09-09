# Reflex V1 Evaluation Record

Date: 2026-09-09

## Automated tests

| Area                                                          | Result                               |
| ------------------------------------------------------------- | ------------------------------------ |
| `@knolo/core` build, runtime check, test suite, legacy script | 43/43 tests passed; all tests passed |
| `@knolo/reflex` build and test suite                          | 13/13 test files passed              |
| TypeScript compilation                                        | Passed                               |
| `git diff --check`                                            | Passed                               |
| Full `npm run release:check`                                  | Passed                               |
| Reflex npm archive dry run                                    | Passed                               |

The Reflex tests cover schema validation, deterministic compilation, behavior
root verification, trigger/required closure, runtime selection and replayable
receipts, budget dispositions, logical-key conflicts, output-schema checks,
teacher-record distillation, finite MRS optimization and frontiers,
deterministic benchmark splits, evaluation/calibration, baseline comparison,
verifier limits, CLI contracts, and the Ollama adapter without making a network
call.

## Local model benchmark v2

Model: `gemma4:e2b`\
Endpoint: local Ollama at `http://localhost:11434`\
Task set: 6 tasks; calibration 4, development 1, test 1\
Task digest:
`sha256-6951ce8e65bdee96a5fd560d13feae30c7d87cbcb29c12b13f43a8dc5c96f1dd`\
Split digest:
`sha256-3029f316bc258b8affc0514b47cde54d2e3a858ceb9e6c8d0cae7bf993aafa00`\
Behavior root:
`sha256-7d9ffbbfbd90de9e83d6765bea7071fc6f5c2342279508b0f57b59674e4d78db`

| Variant     | Answered | Abstained | Failures | Coverage | Output tokens |
| ----------- | -------: | --------: | -------: | -------: | ------------: |
| Plain       |        6 |         0 |        4 |     100% |         3,284 |
| Full Reflex |        5 |         1 |        1 |    83.3% |         1,890 |
| MRS Reflex  |        5 |         1 |        1 |    83.3% |         1,947 |

The v2 benchmark report is generated and checked by:

```bash
REFLEX_MODELS=gemma4:e2b npm run benchmark:reflex:local -- \
  /tmp/knolo-reflex-gemma4-e2b-benchmark-v2.json
npm run benchmark:reflex:check -- \
  /tmp/knolo-reflex-gemma4-e2b-benchmark-v2.json
```

The JSON report from the recorded run is local evidence at
`/tmp/knolo-reflex-gemma4-e2b-benchmark-v2.json`; it is not included in the npm
package. The harness uses a deterministic term-based judge, records task and
split digests, and compares plain, full-Reflex, and MRS-Reflex. The fixture is
intentionally small and has one test task, so all variants remain uncertified;
this is not statistical production evidence.

The local benchmark now accepts `REFLEX_MODELS=model-a,model-b,...` and writes
one comparison run per model against the same task file. Parameter-count
classes and model capabilities must be supplied and verified by the evaluation
owner; the benchmark does not infer them from model names.

Certified profiles now require a non-null dataset split digest and include a
selection-policy digest covering runtime scope, retrieval limits, tokenizer,
renderer, and MRS settings. Output-schema failures are counted once per task,
even when the model's semantic judge also reports a failure.

## Release interpretation

The automated package and core gates pass. Before production adoption, expand
the task set, repeat the benchmark across the supported model revisions, and
replace the fixture judge with application-owned correctness and policy
judges.
