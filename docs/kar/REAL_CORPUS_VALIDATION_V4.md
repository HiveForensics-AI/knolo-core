# Real corpus validation v4

Benchmark: `real-corpus-benchmark-4`.

Classification: `HUMAN_REVIEW_REQUIRED`.

Phase 10 `real-corpus-benchmark-1`, Phase 11 `real-corpus-benchmark-2`, and Phase 12 `real-corpus-benchmark-3` were not rewritten.

## Fresh holdout

No unseen candidate corpus was frozen. `CandidateCorpusRoot` is absent. `HoldoutRoot` is absent. No document from a future holdout was read for rules, queries, or annotation.

## Pipelines

| Pipeline | Result |
| --- | --- |
| P0 auto-accept versus human gold | not run |
| P1 deterministic review | not run |
| P2 model proposals | not run |
| P3 reviewed CEG versus human gold | not run |
| KAR status, frontier, evidence, abstention | not run |
| Review seconds and manual-addition rate | not measured |
| Contradiction and qualification preservation | not run |

Automatic relation precision was not scored. Zero committed relations are reported as `AUTO_ACCEPT_RELATION_AUTOMATION_NOT_ESTABLISHED` on the existing v4 development calibration, not as a passed precision gate.

## Dossiers

No new final showcase was chosen. Phase 12 showcase dossiers remain product examples outside benchmark metrics. They use a machine-accepted proposal and are not human gold.

## Historical gates

Repository tests finished at 2026-10-11T15:13:49+02:00 with exit 0. Core 210, CLI 56, reflex 42, evidence-gate 9, semantic-ollama 6, langchain 2, llamaindex 2, create-knolo-app 1, KAR unit 16, KAR integration 5, and core-rust 24 passed with 0 failures. KAR Rust parity passed. KAR mismatches 0. CEG compiler mismatches 0.

The 50,000-node closure rerun is `research/kar-real-corpus-v4/results/closure-scale-rerun.json` at `sha256-e51ac1811bd6fdd1c68e7d01aa85fe3d45d7da9c3ff3e35f06a3fc11877bdf2c`. Chain degree 1 at 50,000 nodes: closure p50 16,770.35 ms, 49,999 edges, frontier 8. Local degree 3 depth 4 at 50,000 nodes: closure p50 29.69 ms. The published file `research/kar-1/integration/bench/scale-results.json` remains `sha256-77093ffe56710d0055d5863febc5a722a12577608322e284bf5a17f428241981`.

## Answer

A human-reviewed gold standard was not produced. Domain Pack v5 was not built. A fresh unseen corpus was not selected. The KAR and CEG runtime were not changed. Knolo has not been shown to convert real evidence into reviewable committed semantics and replayable minimum sufficient evidence dossiers under a human gold standard.

Phase 13 was not started.
