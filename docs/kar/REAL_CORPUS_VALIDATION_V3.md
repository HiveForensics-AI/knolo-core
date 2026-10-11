# Real corpus validation v3

Benchmark: `real-corpus-benchmark-3`.

Classification: `HUMAN_REVIEW_REQUIRED`.

Phase 10 `real-corpus-benchmark-1` and Phase 11 `real-corpus-benchmark-2` were not rewritten.

## Frozen before any new holdout

Annotation Guide v3 was written and is not pilot-frozen. Draft digest `sha256-cf33474dd102a32f06a3be5ccd5e15adb8e38972fd4b28224c925b28474b58c4`.

| Pack | DomainPackRoot |
| --- | --- |
| contracts v4 | `sha256-1ffea8ded1877f28ce61c9e98bb79644f8bbe237c22baae6984983d92ede39a5` |
| policy v4 | `sha256-109ad58943b28a93453205ea86585843931eb69d8a989bcd071e8e48c70eacea` |
| operations v4 | `sha256-edde04257c55c480c95ce3db90074238a54ab05ee8c9d25135190f5da70f6da4` |

No candidate corpus root was computed. No holdout seed was drawn. No holdout ids exist for Phase 12.

## Gold

No human annotator and no human adjudicator labeled the pilot or a fresh corpus. Pre-adjudication agreement was not calculated. Accepted gold relations: 0. Grounding of an empty gold set was not treated as 100 percent. `query-manifest-v3` was not created.

## Producer and KAR

| Pipeline | Result |
| --- | --- |
| P0 auto-accept versus fresh gold | not run |
| P1 reviewed deterministic proposals | not run |
| P2 model proposals | not run |
| P3 final reviewed CEG versus gold | not run |
| KAR status, frontier, evidence, abstention | not run |
| Review seconds and manual-addition rate | not measured |
| Contradiction and qualification preservation on fresh gold | not run |

Development calibration, which is not a holdout score, suggested 0 relation rules for `AUTO_ACCEPT`. Details are in `docs/kar/DOMAIN_PACK_V4_REPORT.md`.

## Showcase dossiers

Three already exposed documents, `contracts-116`, `policy-103`, and `operations-124`, have verified dossiers under `research/kar-real-corpus-v3/showcase/dossiers/`. Each has one `SATISFIED` example and one `UNSATISFIED_EVIDENCE_REQUIREMENTS` example. Statements are `Evidence requirements satisfied` and `Evidence requirements not satisfied`. The satisfied graphs use one machine-accepted grounded proposal. `humanReviewer` is false. They are excluded from benchmark metrics.

## Answer

An actual human-reviewed gold standard was not created, and a fresh unseen holdout was not selected. Frozen Domain Pack v4 keeps automatic relation commitment fail-closed: no relation rule is `AUTO_ACCEPT`, and development calibration promoted none. The unchanged KAR and CEG runtime still passes the historical gates. Knolo has not been shown, on a human gold standard, to produce evidence semantics accurate enough for reliable replayable KAR Evidence Dossiers.

Phase 13 was not started.
