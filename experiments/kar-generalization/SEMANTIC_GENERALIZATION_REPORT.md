# KAR Experiment 5 — Vocabulary-independent Semantic Compilation

## Decision

**GENERALIZATION_NOT_SHOWN**

Candidate method: `g1`. Holdout gates did not all pass. Query-time mismatches: 0.

Can a compiler derive canonical concepts from the documents alone, without a hand-authored domain lexicon, commit those relationships, and then retrieve opposition and qualification for wording it was never given?

The measured result is the decision above. Retrieval stayed deterministic. Generalization is the quantity under test.

If yes, does the evidence justify writing the formal KAR specification?

The evidence does not justify writing the formal KAR specification. This experiment does not write it.

## What was frozen

Compiler files `compile.mjs`, `activate.mjs`, and `canonicalize.mjs` were hashed before this benchmark was scored. The runner refuses to score queries if that hash changes. The prompt, the alias cleaner, and the dual-anchor rule were not edited after that hash.

G1 is a non-deterministic compiler with committed frozen output. The local model runs only while the artifact is built. Query-time activation reads the frozen bytes and does not call a model.

L0 is the Experiment 4 deterministic lexicon compiler, used here as a vocabulary control. It is not the candidate.

S2 from Experiment 4 was not rerun. Its holdout result remains in that experiment.

Model status: RUN.
Provider ollama, model llama3.1:latest, digest 46e0c10c039e019119339687c3c1757cc81b9da49709a3b3924863ba87ca666e, temperature 0, prompt sha256-42a3a21ff6ff9c9646df2cbf193f517b75568e2c2c419975e3746b1e386b8836, compiler kar-generalization-g1-1.
Model calls 188, cache hits 808, parse failures 0, attempted 188, parse-failure rate 0.0%.

## Pre-registered gates

These thresholds were fixed before scoring. They apply to the holdout, where every opposition sentence and every qualifier sentence is unseen wording.

- OppositionRecall@50 ≥ 85%
- QualifierRecall@50 ≥ 80%
- Support recall drops no more than 5 points versus holdout B0
- Damage@10 ≤ 10% for unrequested opposition and qualifiers
- Query-time mismatches = 0
- L0 opposition@50 ≤ 15%, otherwise the fixture leaked the old lexicon and the run is inconclusive
- Parse-failure rate ≤ 20%, otherwise the compiler did not actually run

Development uses the same kind of unseen pairs and is reported separately. It is not part of the gate.

## Method

G1 asks the local model to name the entity, other ordinary names for that entity, the underlying action, and ordinary verbs for that action. A persistence sentence is instructed to become a prohibition of ending it. A sentence about an earlier group keeping a different rule is instructed to become a qualification. The prompt does not list a domain synonym table.

Query-time activation is deterministic. The candidate seeds a claim only when the query matches both an entity alias and an action alias. Lexical retrieval is then unioned so support that is already in the lexical pool stays there. Action-only activation is a diagnostic. It is not the candidate, because a generic ending verb would attach unrelated persistence sentences to an unrelated query.

## Holdout

Holdout n=60. Every case is token-disjoint from its opposition and qualifier. Domains: lodging, software access, and field equipment. Seed 20261013.

| Method | Support@50 | Opposition@50 | Qualifier@50 |
| --- | --- | --- | --- |
| b0 | 100.0% [100.0, 100.0] n=60 | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=60 |
| l0 | 100.0% [100.0, 100.0] n=60 | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=60 |
| g1 | 100.0% [100.0, 100.0] n=60 | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=60 |
| oracle | 100.0% [100.0, 100.0] n=60 | 100.0% [100.0, 100.0] n=60 | 100.0% [100.0, 100.0] n=60 |

B0 is lexical retrieval. L0 is the Experiment 4 lexicon compiler. G1 is the vocabulary-independent compiler. The oracle column lists the labeled evidence. It is not a retrieval method.

| Domain | G1 opposition | G1 qualifier |
| --- | --- | --- |
| field-equipment | 0.0% [0.0, 0.0] n=20 | 0.0% [0.0, 0.0] n=20 |
| lodging | 0.0% [0.0, 0.0] n=20 | 0.0% [0.0, 0.0] n=20 |
| software-access | 0.0% [0.0, 0.0] n=20 | 0.0% [0.0, 0.0] n=20 |

## Development

Development n=36. Same construction, different entities and different wording. Seed 20261012.

| Method | Support@50 | Opposition@50 | Qualifier@50 |
| --- | --- | --- | --- |
| b0 | 100.0% [100.0, 100.0] n=36 | 0.0% [0.0, 0.0] n=36 | 0.0% [0.0, 0.0] n=36 |
| l0 | 100.0% [100.0, 100.0] n=36 | 0.0% [0.0, 0.0] n=36 | 0.0% [0.0, 0.0] n=36 |
| g1 | 100.0% [100.0, 100.0] n=36 | 0.0% [0.0, 0.0] n=36 | 0.0% [0.0, 0.0] n=36 |
| oracle | 100.0% [100.0, 100.0] n=36 | 100.0% [100.0, 100.0] n=36 | 100.0% [100.0, 100.0] n=36 |

## Ablation of g1 on the holdout

| Ablation | Opposition@50 | Qualifier@50 | Support@50 |
| --- | --- | --- | --- |
| full | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=60 | 100.0% [100.0, 100.0] n=60 |
| action-only | 1.7% [0.0, 5.0] n=60 | 0.0% [0.0, 0.0] n=60 | 100.0% [100.0, 100.0] n=60 |
| entity-only | 18.3% [10.0, 28.3] n=60 | 3.3% [0.0, 8.3] n=60 | 100.0% [100.0, 100.0] n=60 |
| surface-only | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=60 | 100.0% [100.0, 100.0] n=60 |
| siblings | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=60 | 100.0% [100.0, 100.0] n=60 |
| no-lexical-union | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=60 | 0.0% [0.0, 0.0] n=60 |

`full` is the candidate. `action-only` drops the entity requirement. `entity-only` drops the action requirement. `surface-only` ignores paraphrase aliases and uses the words copied from the passage. `siblings` adds other claims that share a concept id. `no-lexical-union` omits the lexical pool.

## Negative control

Instances n=100. Corpus size 500. Each query asks to cancel an unrelated record. Decoys are persistence and qualification sentences about other things, with the same syntactic shape as the benchmark. Damage is method inclusion minus baseline inclusion at depth 10.

| Check | Rate |
| --- | --- |
| Baseline opposition inclusion | 0.0% [0.0, 0.0] n=100 |
| Baseline qualifier inclusion | 0.0% [0.0, 0.0] n=100 |
| G1 opposition inclusion | 0.0% [0.0, 0.0] n=100 |
| G1 qualifier inclusion | 0.0% [0.0, 0.0] n=100 |
| G1 opposition damage | 0.0% [0.0, 0.0] n=100 |
| G1 qualifier damage | 0.0% [0.0, 0.0] n=100 |
| Action-only opposition damage | 100.0% [100.0, 100.0] n=100 |
| Action-only qualifier damage | 0.0% [0.0, 0.0] n=100 |
| Pool growth at 50 | 0.00 n=100 |

## Artifact audit

| Artifact | Claims | Edges | Alias slots | Bytes | Build ms |
| --- | --- | --- | --- | --- | --- |
| l0 | 15.6 n=196 | 15.6 n=196 | 732.3 n=196 | 16279 n=196 | 2.2 n=196 |
| g1 | 5.1 n=196 | 5.1 n=196 | 44.3 n=196 | 2109 n=196 | 3146.8 n=196 |

G1 relation totals: equivalent 508, permits 11, prohibits 473.

Median G1 artifact size is 3181 bytes. The 256 KiB comparison is descriptive. The artifact is not integrated.

## Commitment proof

Instance D-clinic-visits-00. First root sha256-6784984ed1d3f9f648a45f9d91396bbc3d674b4df2615817608cc0f10286f3f6. Second build from the frozen model cache sha256-6784984ed1d3f9f648a45f9d91396bbc3d674b4df2615817608cc0f10286f3f6. Reload sha256-6784984ed1d3f9f648a45f9d91396bbc3d674b4df2615817608cc0f10286f3f6. Identical: yes. Canonical bytes 1111. V5 state roots were not modified.

Query-time activation was repeated 200 times. Mismatches: 0.

## Gain

Holdout opposition gain of G1 over the better of B0 and L0: 0.0 points. Holdout qualifier gain: 0.0 points. Support drop versus holdout B0: 0.0 points.
