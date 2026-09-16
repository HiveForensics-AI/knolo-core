# Reflex V1 Evaluation Record

Date: 2026-09-13

## Automated tests

| Area                                                          | Result                               |
| ------------------------------------------------------------- | ------------------------------------ |
| `@knolo/core` build, runtime check, test suite, legacy script | 43/43 tests passed; all tests passed |
| `@knolo/reflex` build and test suite                          | 14/14 test files passed              |
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

## BANKING77 public-seed benchmark

Date: 2026-09-13

Model: `gemma4:e2b`

Task set: 500 stratified BANKING77 test examples; calibration 300, development
100, test 100

Task type: `intent-classification`

Dataset class: `public-seed-only`

Generation: Ollama `think: false`, `temperature: 0`, `num_predict: 64`

Task digest:
`sha256-3a4af3a61f3e513669a73d65c784210938cfb7e838fae5fba4d558ce620a630d`

Split digest:
`sha256-6afe9358bfe7a22167f4213a3165b10c4ee1f7b8465bb4bc61b062457f3e526b`

Behavior root:
`sha256-ecf98fcac7f4e64965e0eda55fb2bdcea14a39d39f1f2059997e75587fccf5f8`

Run-plan digest:
`sha256-9a1bd29e45094c9c47cca4e61816c9ae6aa21f3afff961b96db1e00f6ac20715`

| Variant     | Test answered | Test failures | Test failure rate | Test coverage |
| ----------- | ------------: | ------------: | ----------------: | ------------: |
| Plain       |           100 |            32 |             32.0% |          100% |
| Full Reflex |           100 |            27 |             27.0% |          100% |
| MRS Reflex  |           100 |            27 |             27.0% |          100% |

Full Reflex and MRS Reflex improved test accuracy by five percentage points
over plain Gemma on this public seed. The report was checked at
`/tmp/knolo-reflex-gemma4-e2b-banking77-corrected.json`. This result is not
certified production evidence: BANKING77 is public seed data, and the expected
intent labels still require Knolo-owned task review and policy judging.

## CLINC OOS public-seed benchmark

Date: 2026-09-13

Source: [official CLINC OOS repository](https://github.com/clinc/oos-eval),
licensed under CC BY 3.0.

Model: `gemma4:e2b`

Task set: deterministic 500-example test subset with 450 in-scope examples
across 150 labels and 50 out-of-scope examples; calibration 300, development
100, test 100

Task type: `intent-classification`

Dataset class: `public-seed-only`

Generation: Ollama `think: false`, `temperature: 0`, `num_predict: 64`

Task digest:
`sha256-7956efa0a684ea393a98b3836a9cb413844859ef0fac4ed2029de867abb2ed44`

Split digest:
`sha256-93b85c0b01555b4b0ac488d530b874634888509b84adcfa2cc8b37652e568c02`

Behavior root:
`sha256-92579f5a1510d31a684f62efde7eaf80aaef6adb23e16b9f59b966da67c8ccfe`

Run-plan digest:
`sha256-be929ff84f889a2ebbc829e89cb2bd6baed5de1888a31b215c9454bb5819eaf5`

| Variant     | Test answered | Test failures | Test failure rate | Test coverage |
| ----------- | ------------: | ------------: | ----------------: | ------------: |
| Plain       |           100 |            40 |            40.00% |          100% |
| Full Reflex |            93 |            33 |            35.48% |           93% |
| MRS Reflex  |            93 |            33 |            35.48% |           93% |

The Reflex variants reduced raw test failures from 40 to 33 while abstaining on
seven tasks; among answered tasks, the failure rate was 35.48% versus 40.00%
for Plain. The report was checked at
`/tmp/knolo-reflex-gemma4-e2b-clinc500.json`. This remains public-seed-only
evidence and is not a Knolo production certification.

## Release interpretation

The automated package and core gates pass. Before production adoption, repeat
the benchmark across supported model revisions and replace the public-seed
expectations with application-owned correctness and policy judges.
