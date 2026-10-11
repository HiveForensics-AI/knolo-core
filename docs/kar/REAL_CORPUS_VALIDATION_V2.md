# Real corpus validation v2

Benchmark: `real-corpus-benchmark-2`.

Classification: `GOLD_STANDARD_BLOCKED`.

Phase 10 `real-corpus-benchmark-1` was not rewritten.

## What was frozen before the holdout

Annotation guide `sha256-56ca9adbaeda5f6336406eff3c1ae9442ddf28062009d3049cc90bb00114abea`.

| Pack | DomainPackRoot |
| --- | --- |
| contracts v3 | `sha256-6ae56377066d223902532a3cbc092965f377b9be754071891e8b0fcddbcf3008` |
| policy v3 | `sha256-e8b870e3153bc9037d6b8083fc89d742d320eb9ffa7af507ba3ad40ce0d724f8` |
| operations v3 | `sha256-b71574dd91b60e29766ebcefda39c13a11f9f5eca965934d1697fec13a9c6d01` |

Holdout seed: `kar-real-corpus-20261011-holdout-v2`.

Selection: `sha256(seed + newline + domain + newline + documentId)`, ascending, greedy, at most 40 percent of the target from one source family. Target 12 per domain. Result: 12 contracts, 12 policy, 12 operations.

## Corpus

78 candidates. Contracts are unused CUAD texts under CC-BY-4.0. Policy and operations are Federal Register final rules under 17 USC 105. Twelve policy documents and five operations documents are excerpts of longer rules. Family counts in the holdout:

| Domain | Families |
| --- | --- |
| contracts | 12 filers, one document each |
| policy | GSA 4, DOJ 3, EPA 3, HHS 2 |
| operations | IRS 3, NIST 3, OSHA 2, NASA 2, FAA 2 |

No family exceeds 40 percent of its holdout.

## Gold protocol

Required protocol: pass A, pass B, and adjudication, with a human or domain reviewer before a release-candidate claim.

What ran: `llama3.1:latest` as pass A and `openchat:latest` as pass B. Both are local models. `humanAdjudicator` is false. `sameModelFamily` is false.

On `contracts-110` and `contracts-101`, evidence-relation agreement was 0 and concept-kind agreement was 0. The 90 percent stability gate failed. Labeling stopped. No adjudicated CEG was written. `query-manifest-v2` was not created.

## Producer result that does not use gold

The frozen v3 packs emitted 1,545 proposals on the 36 holdout images: 1,163 `AUTO_ACCEPT`, 382 `NEEDS_REVIEW`, and 31 `OBSERVATION_ONLY`. The accepted fragment contains 0 relations. Auto-accept grounding was 1163/1163. Invented dates, authority, evidence, and referents were 0. Empty-prediction relation precision is null. The 95 percent and 99 percent auto-accept precision gates were not claimed.

## Pipelines not scored

| Pipeline | Result |
| --- | --- |
| P0 auto-accept quality versus gold | withheld |
| P1 reviewed deterministic proposals | withheld |
| P2 model proposals after review | not run |
| P3 final reviewed CEG versus gold | withheld |
| KAR status, frontier, evidence, abstention | withheld |
| Review seconds and manual-addition rate | not measured |

Development-only v2 versus v3 numbers are in `docs/kar/DOMAIN_PACK_V3_REPORT.md` and `research/kar-real-corpus-v2/results/v2-v3-development.json`.

## Historical gates

Repository tests and the named 10,000 and 25,000 and 50,000 KAR and CEG gates completed with 0 failures and 0 mismatches. Details are in `research/kar-real-corpus-v2/results/historical-gates.json`.

## Answer

Precision-calibrated automatic and review-only semantics are implemented, and a fresh holdout was selected without tuning version 3 against it. A reliable independent gold standard was not produced. Knolo has not been shown, on this holdout, to produce CEGs accurate enough for KAR to deliver release-quality replayable evidence dossiers.

Phase 12 was not started.
