# Reflex 0.2 Empirical Intelligence Plan

Status: Workstream 5 harness complete; production dataset pending on 2026-09-09
Branch: `feat/reflex-0.2-empirical`
Target: `@knolo/reflex` 0.2.0

This plan covers the remaining research and product work identified after the
0.1.2 correctness hardening. The 0.2 release should demonstrate measurable
small-model improvement, not only provide another runtime feature.

## 0.2 definition of done

The release is complete when all of the following are true:

- teacher records carry reproducible model, prompt, extractor, judge, source,
  and dataset provenance;
- distillation creates multiple bounded behavior clusters instead of one
  family-wide union bundle;
- calibration runs fit per-model and per-family MRS coefficients from frozen
  ablation results;
- runtime can consume an offline MRS Pareto frontier without exhaustive search
  in the request path;
- the benchmark uses frozen train/calibration/development/test splits and
  compares plain, full-Reflex, and MRS-Reflex variants;
- capability profiles include model identity, selection-policy identity, split
  identity, and measured correctness, safety, coverage, token, latency, and
  resource metrics;
- all new artifacts are deterministic, content-addressed, replayable, and
  covered by tests;
- `npm run release:check`, the full test suite, and the benchmark reproducibility
  check pass before publishing `@knolo/reflex` 0.2.0.

## Workstream 1: provenance and frozen teacher records

Add a versioned extraction-record contract in `packages/reflex/src/distill.ts`.
Each record should commit to:

- teacher model ID and immutable revision/digest;
- teacher prompt and prompt-contract digest;
- extractor ID, extractor revision, and extraction-contract digest;
- judge ID/revision and decision;
- source evidence IDs;
- dataset split and record ID;
- teacher output and extracted behavior;
- an `extractionRoot` calculated from the canonical record.

Acceptance criteria:

- changing any provenance field changes the extraction root;
- records can be serialized and loaded without executable code;
- rejected records retain a deterministic reason;
- distillation accepts only validated frozen records;
- tests cover tampered output, provenance, ordering, and replay.

## Workstream 2: behavior clustering and bounded bundles

Replace family-wide atom unions with deterministic behavior clustering.

Pipeline:

```text
frozen extraction records
        ↓
canonical behavior signature
        ↓
deterministic cluster assignment
        ↓
common/core atoms + variant atoms
        ↓
one bounded bundle per cluster
```

The first implementation should use an explicit host-provided signature or
feature extractor, not an opaque similarity heuristic. Cluster identity must
be stable for the same records and configuration. Use a maximum cluster atom
count and reject or split oversized clusters. Emit cluster IDs, member record
IDs, common atom keys, variant atom keys, and cluster digests.

Acceptance criteria:

- related but distinct account-recovery procedures produce separate bundles;
- a record belongs to exactly one cluster unless explicitly marked otherwise;
- cluster ordering and bundle keys are bytewise deterministic;
- no generated bundle exceeds configured atom/token limits;
- a regression test proves the old family-union failure cannot recur.

## Workstream 3: empirical capability calibration

Add a calibration module and CLI workflow for model ablations. For each model,
family, and frozen query, run a declared candidate design such as:

```text
zero context
atom A
atom B
A + B
A + C
```

Record correctness, policy adherence, schema validity, coverage, input/output
tokens, time-to-first-token, total latency, and resource metrics when available.
Fit the declared finite surrogate:

```text
logit(P(success)) = intercept
  + sum(atom contribution)
  + sum(pair interaction)
```

Do not claim causal or global model quality. Persist fit method, data split,
regularization/configuration, sample counts, uncertainty, and coefficient
digest. Reject calibration when there is insufficient data or invalid counts.

Acceptance criteria:

- calibration is deterministic from frozen ablation records;
- coefficients are scoped by model revision and query family;
- held-out evaluation is separate from coefficient fitting;
- uncertainty and sample counts are present in the profile;
- a synthetic fixture recovers known coefficients within tolerance.

## Workstream 4: offline MRS frontier and fast runtime path

Keep exhaustive MRS as the small-case oracle. Add an offline frontier builder
that stores nondominated selections by token cost and predicted success. Add a
runtime lookup that selects from the precomputed frontier and falls back to a
bounded local search only when explicitly configured.

Required safeguards:

- candidate and frontier digests are committed to the profile and selection
  policy;
- the exhaustive solver remains capped at 30 atoms;
- runtime never silently treats `search_limit` as optimal;
- dependency closure, conflicts, scope, and input budgets are rechecked after
  frontier lookup;
- the selected frontier entry is included in the receipt.

Acceptance criteria:

- offline frontier and runtime lookup produce the same selection as the oracle
  for all small fixtures;
- dominated entries are removed deterministically;
- lookup latency is independent of the full candidate power set;
- tampered frontier/configuration is rejected by digest verification.

Implemented in `packages/reflex/src/frontier.ts`: frontier construction shares
the exact finite enumeration oracle, removes dominated entries deterministically,
binds the result to a canonical MRS problem digest, and provides validated
lookup without request-time power-set enumeration. Runtime receipts now commit
the frontier and selected-entry digests, while runtime checks revalidate the
problem digest, closure, conflicts, scope, and budgets.

## Workstream 5: benchmark and certification harness

Create a frozen benchmark fixture with at least 500 queries when the dataset is
available. Until then, build the harness against a smaller deterministic fixture
without presenting it as evidence. Required splits:

- 60% train/calibration;
- 20% development;
- 20% untouched test.

Required variants:

| Variant     | Purpose                                           |
| ----------- | ------------------------------------------------- |
| Plain       | Model without behavior context                    |
| Full Reflex | Deterministic retrieval and full eligible context |
| MRS Reflex  | Retrieval plus calibrated minimum context         |

Run each variant on each declared model class, including approximately 0.5B,
1–1.5B, 3B, 7B, and the teacher where available. Store model metadata rather
than inferring parameter class from a tag. Report correctness, policy and
schema failures, coverage, failure upper bound, context/output tokens, TTFT,
latency, memory, and energy when measurable.

Acceptance criteria:

- split digest and task digest are recorded in every report;
- test queries never influence calibration;
- benchmark reruns reproduce task ordering and deterministic fields;
- no result is labeled certified without a split digest and configured floors;
- the report directly supports `small model + Reflex` versus `larger plain`
  comparisons.

Implemented in `packages/reflex/src/benchmark.ts` and
`packages/reflex/scripts/benchmark-local.mjs`: tasks receive deterministic
calibration/development/test assignments and task/split digests; the harness
runs plain, full-Reflex, and MRS-Reflex variants; reports correctness, policy,
schema, coverage, risk-bound, token, latency, and nullable resource metrics;
and records declared model metadata without inferring parameter classes. The
reproducibility checker is `scripts/check-reflex-benchmark.mjs`. The bundled
six-task run is exploratory only; a 500-query frozen fixture and verified model
matrix remain required for production certification.

## Workstream 6: release hardening and publication

Before 0.2.0:

1. Add conformance fixtures for provenance, clusters, coefficients, frontiers,
   and receipts.
2. Update TypeScript declarations, package README, root README, and evaluation
   record.
3. Run formatting, documentation, full tests, release checks, package dry run,
   and benchmark reproducibility checks.
4. Review the public API for schema compatibility and explicitly decide whether
   the V1 schema is frozen.
5. Publish only after the commit and tag are pushed.

Release-hardening status: conformance fixture coverage, public declaration
generation, package/root/evaluation documentation, formatting, documentation
checks, full tests, package dry runs, and benchmark reproducibility checks are
complete. The V1 schemas remain experimental and are deliberately not frozen
for 0.2.0; publication is still gated on the larger frozen benchmark dataset
and verified model matrix.

## Suggested week sequence

| Day | Deliverable                                                          |
| --- | -------------------------------------------------------------------- |
| 1   | Provenance record contract, extraction root, serialization, tests    |
| 2   | Behavior signatures, clustering, bounded multi-bundle distillation   |
| 3   | Ablation record format, synthetic calibration, coefficient profiles  |
| 4   | Frontier builder, runtime lookup, receipt integration                |
| 5   | Frozen benchmark harness, model matrix, reproducibility checks       |
| 6   | Capability-profile and certification review, docs, conformance tests |
| 7   | Full release gate, changelog/release notes, commit, tag, publication |

## Explicit non-goals for 0.2

- no opaque automatic clustering without a reproducible signature contract;
- no claim that surrogate coefficients prove causal model behavior;
- no exhaustive million-subset optimization in the normal inference path;
- no production certification from the six-task development benchmark;
- no V1 schema freeze until trigger, provenance, frontier, and profile contracts
  have passed conformance review.
