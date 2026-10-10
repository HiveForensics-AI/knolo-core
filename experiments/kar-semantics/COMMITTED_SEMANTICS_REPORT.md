# KAR Experiment 4 — Committed Evidence Semantics

## Decision

**SEMANTIC_LAYER_PROMISING_BUT_BLOCKED**

Candidate method: `s1`. Holdout gates passed. Development gates failed. Damage gate passed. Query-time determinism mismatches: 0.

Can Knolo move semantic interpretation to Knowledge Image construction, commit the resulting evidence relationships, and then perform deterministic opposition and qualification discovery at query time?

The frozen semantic artifact supports deterministic query-time frontier retrieval, and the measured gain comes from relationships committed before the query is seen.

If yes, does the evidence now justify writing the formal KAR mathematical specification?

The evidence does not justify writing the formal KAR specification in this state. This experiment does not write it.

## What was frozen

Compiler files `lexicon.mjs`, `compile.mjs`, `activate.mjs`, `canonicalize.mjs`, and `s2.mjs` were hashed before holdout scoring. The runner refuses to score queries if that hash changes. The hash was refreshed before the official run so a dropped local-model connection is retried and generation length is capped. The prompt text, the lexicon, and the relation rules were not changed.

S1 is a deterministic compiler. S2 is non-deterministic compiler with committed frozen output.

S2 status: RUN.
Provider ollama, model llama3.1:latest, digest 46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e, temperature 0, prompt sha256-329d2667a153447f2cfcd86ac877ab27af27e1337b5b8ba99c028888a08bba37, compiler kar-semantics-s2-1. Model calls 222, cache hits 669, parse failures 0.

Pre-registered gates, unchanged after the run: opposition recall at 50 ≥ 90%, qualifier recall at 50 ≥ 85%, scenario D or holdout disconnection ≥ 75%, support recall drops no more than 5 points, damage at 10 ≤ 10% for unrequested opposition and qualifiers, query-time mismatches = 0. Development and holdout must both clear the recall gates for `GO_TO_KAR_SPEC`.

## Development benchmark

Adversarial n=160. Scenario D n=20. The oracle column is an evaluation ceiling. It is not a retrieval method.

| Method | Support@50 | Opposition@50 | Qualifier@50 | Temporal@50 | Scenario D opposition |
| --- | --- | --- | --- | --- | --- |
| b0 | 96.9% [95.0, 98.4] n=160 | 78.1% [72.8, 83.1] n=160 | 50.0% [34.9, 65.0] n=40 | 100.0% [100.0, 100.0] n=20 | 0.0% [0.0, 0.0] n=20 |
| b1 | 96.9% [95.0, 98.4] n=160 | 78.1% [72.5, 83.4] n=160 | 50.0% [34.9, 65.0] n=40 | 100.0% [100.0, 100.0] n=20 | 0.0% [0.0, 0.0] n=20 |
| b2 | 96.9% [94.7, 98.4] n=160 | 78.1% [72.5, 83.1] n=160 | 50.0% [35.0, 65.0] n=40 | 100.0% [100.0, 100.0] n=20 | 0.0% [0.0, 0.0] n=20 |
| b3 | 96.9% [95.0, 98.8] n=160 | 78.1% [72.5, 83.4] n=160 | 50.0% [35.0, 65.0] n=40 | 100.0% [100.0, 100.0] n=20 | 0.0% [0.0, 0.0] n=20 |
| s0 | 96.9% [95.0, 98.4] n=160 | 78.1% [72.5, 83.1] n=160 | 50.0% [35.0, 65.1] n=40 | 100.0% [100.0, 100.0] n=20 | 0.0% [0.0, 0.0] n=20 |
| s1 | 96.9% [95.0, 98.4] n=160 | 100.0% [100.0, 100.0] n=160 | 50.0% [35.0, 65.0] n=40 | 100.0% [100.0, 100.0] n=20 | 100.0% [100.0, 100.0] n=20 |
| s2 | 96.9% [95.0, 98.4] n=160 | 86.9% [82.3, 90.8] n=160 | 77.5% [65.0, 90.0] n=40 | 100.0% [100.0, 100.0] n=20 | 55.0% [34.9, 75.0] n=20 |
| oracle | 100.0% [100.0, 100.0] n=160 | 100.0% [100.0, 100.0] n=160 | 100.0% [100.0, 100.0] n=40 | 100.0% [100.0, 100.0] n=20 | 100.0% [100.0, 100.0] n=20 |

B0 is current lexical retrieval. B1 is lexical retrieval plus MMR. B2 is current claim-graph expansion. B3 is Experiment 3 blind activation. S0 is that same production graph projected into the experimental image. S1 is the deterministic compiler. S2 is the model-assisted compiler when it ran.

## Holdout benchmark

Holdout n=60. Disconnect cases n=60. Qualifier-required n=60. Temporal n=30. Domains: commercial contracts, software policy, and equipment operations. Seed 20261010.

| Method | Support@50 | Opposition@50 | Qualifier@50 | Temporal@50 | Disconnect opposition |
| --- | --- | --- | --- | --- | --- |
| b0 | 100.0% [100.0, 100.0] n=60 | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=30 | 0.0% [0.0, 0.0] n=60 |
| b1 | 100.0% [100.0, 100.0] n=60 | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=30 | 0.0% [0.0, 0.0] n=60 |
| b2 | 100.0% [100.0, 100.0] n=60 | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=30 | 0.0% [0.0, 0.0] n=60 |
| b3 | 100.0% [100.0, 100.0] n=60 | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=30 | 0.0% [0.0, 0.0] n=60 |
| s0 | 100.0% [100.0, 100.0] n=60 | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=30 | 0.0% [0.0, 0.0] n=60 |
| s1 | 100.0% [100.0, 100.0] n=60 | 90.0% [81.7, 96.7] n=60 | 85.0% [75.0, 93.3] n=60 | 100.0% [100.0, 100.0] n=30 | 90.0% [81.7, 96.7] n=60 |
| s2 | 100.0% [100.0, 100.0] n=60 | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=30 | 0.0% [0.0, 0.0] n=60 |
| oracle | 100.0% [100.0, 100.0] n=60 | 100.0% [100.0, 100.0] n=60 | 100.0% [100.0, 100.0] n=60 | 100.0% [100.0, 100.0] n=30 | 100.0% [100.0, 100.0] n=60 |

In-lexicon opposition for S1: 100.0% [100.0, 100.0] n=54. Stress opposition for S1: 0.0% [0.0, 0.0] n=6. In-lexicon qualifiers for S1: 100.0% [100.0, 100.0] n=51. Stress qualifiers for S1: 0.0% [0.0, 0.0] n=9.
In-lexicon opposition for S2: 0.0% [0.0, 0.0] n=54. Stress opposition for S2: 0.0% [0.0, 0.0] n=6. In-lexicon qualifiers for S2: 0.0% [0.0, 0.0] n=51. Stress qualifiers for S2: 0.0% [0.0, 0.0] n=9.

The stress stratum uses paraphrases that are absent from the frozen alias list. It is reported separately and was not removed after the run.

## Negative control

Instances n=100. Corpus size 500. Damage is method inclusion minus baseline inclusion at depth 10.

| Method | Baseline opposition inclusion | Method opposition inclusion | Opposition damage | Qualifier damage | Pool growth at 50 |
| --- | --- | --- | --- | --- | --- |
| s1 | 0.0% [0.0, 0.0] n=100 | 0.0% [0.0, 0.0] n=100 | 0.0% [0.0, 0.0] n=100 | 0.0% [0.0, 0.0] n=100 | 0.0 n=100 |
| s2 | 0.0% [0.0, 0.0] n=100 | 0.0% [0.0, 0.0] n=100 | 0.0% [0.0, 0.0] n=100 | 0.0% [0.0, 0.0] n=100 | 0.0 n=100 |

## Ablation of s1

One feature is removed at a time. `no-alias-no-reverse` is an extra diagnostic for the case where the direct alias path and the sibling path are redundant.

| Ablation | Dev opposition | Scenario D | Holdout opposition | Holdout qualifier | Holdout support | Holdout temporal |
| --- | --- | --- | --- | --- | --- | --- |
| full | 100.0% [100.0, 100.0] n=160 | 100.0% [100.0, 100.0] n=20 | 90.0% [81.7, 96.7] n=60 | 85.0% [75.0, 93.3] n=60 | 100.0% [100.0, 100.0] n=60 | 100.0% [100.0, 100.0] n=30 |
| no-aliases | 100.0% [100.0, 100.0] n=160 | 100.0% [100.0, 100.0] n=20 | 90.0% [81.7, 96.7] n=60 | 85.0% [75.0, 93.3] n=60 | 100.0% [100.0, 100.0] n=60 | 100.0% [100.0, 100.0] n=30 |
| no-typed | 100.0% [100.0, 100.0] n=160 | 100.0% [100.0, 100.0] n=20 | 90.0% [81.7, 96.7] n=60 | 85.0% [76.7, 93.3] n=60 | 100.0% [100.0, 100.0] n=60 | 100.0% [100.0, 100.0] n=30 |
| no-reverse | 100.0% [100.0, 100.0] n=160 | 100.0% [100.0, 100.0] n=20 | 90.0% [81.7, 96.7] n=60 | 85.0% [75.0, 93.3] n=60 | 100.0% [100.0, 100.0] n=60 | 100.0% [100.0, 100.0] n=30 |
| no-exceptions | 100.0% [100.0, 100.0] n=160 | 100.0% [100.0, 100.0] n=20 | 90.0% [81.7, 96.7] n=60 | 85.0% [75.0, 93.3] n=60 | 100.0% [100.0, 100.0] n=60 | 100.0% [100.0, 100.0] n=30 |
| no-temporal | 100.0% [100.0, 100.0] n=160 | 100.0% [100.0, 100.0] n=20 | 90.0% [81.7, 96.7] n=60 | 85.0% [75.0, 93.3] n=60 | 100.0% [100.0, 100.0] n=60 | 100.0% [100.0, 100.0] n=30 |
| no-lexical-union | 100.0% [100.0, 100.0] n=160 | 100.0% [100.0, 100.0] n=20 | 90.0% [83.3, 96.7] n=60 | 85.0% [75.0, 95.0] n=60 | 100.0% [100.0, 100.0] n=60 | 100.0% [100.0, 100.0] n=30 |
| no-alias-no-reverse | 78.1% [72.5, 83.4] n=160 | 0.0% [0.0, 0.0] n=20 | 16.7% [8.3, 26.7] n=60 | 11.7% [5.0, 20.0] n=60 | 100.0% [100.0, 100.0] n=60 | 33.3% [16.7, 50.0] n=30 |

## Artifact audit

| Artifact | Claims | Edges | Alias slots | Bytes | Build ms | Pack bytes |
| --- | --- | --- | --- | --- | --- | --- |
| s0 | 2.9 n=380 | 2.9 n=380 | 0.0 n=380 | 1084 n=380 | 0.0 n=380 | 260577 n=380 |
| s1 | 33.5 n=380 | 65.4 n=380 | 1482.6 n=380 | 37435 n=380 | 3.4 n=380 | 260577 n=380 |
| s2 | 27.5 n=380 | 50.2 n=380 | 100.0 n=380 | 12153 n=380 | 6270.8 n=380 | 260577 n=380 |

S1 relation totals: equivalent 4889, valid_before 530, prohibits 1024, permits 6826, valid_after 9319, applies_to 1287, excepts 491, qualifies 491.
S2 relation totals: equivalent 4688, prohibits 587, permits 6436, applies_to 3048, valid_after 985, excepts 314, valid_before 731, qualifies 2103, requires 64, overrides 120, supports 1.

Median S1 artifact size is small enough to store beside a Knowledge Image. Median bytes 22089 against median pack bytes 104415. It is not integrated.

## Commitment proof

Instance A-00. First root sha256-544d8cd420e7509e8365a97376ba0cc27d69e78f07f8aa10516b8c0224539fed. Second build sha256-544d8cd420e7509e8365a97376ba0cc27d69e78f07f8aa10516b8c0224539fed. Reload of the frozen bytes sha256-544d8cd420e7509e8365a97376ba0cc27d69e78f07f8aa10516b8c0224539fed. Identical: yes. Canonical bytes 98994. V5 state roots were not modified.

Query-time activation was repeated 100 times on the development proof artifact and 100 times on the first holdout artifact. Mismatches: 0.

## Existing selector on the discovered pool

This applies the Experiment 1 oracle selector at K=5. It sees benchmark labels, so it is not a retrieval result. Development adversarial B0 pool 68.8% [61.9, 75.6] n=160, S1 pool 81.3% [75.0, 86.9] n=160. Holdout B0 pool 0.0% [0.0, 0.0] n=60, S1 pool 75.0% [63.3, 86.7] n=60.

## Gain

Holdout opposition gain for the candidate: 90.0 points. Holdout disconnect gain: 90.0 points. Development scenario D gain: 100.0 points.
