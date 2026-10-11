# Domain Pack v3 report

Package version `5.5.1`. Semantic contracts `kar-1-research-1` and `ceg-source-1` were not changed. Version 6.0.0 was not published.

Classification: `GOLD_STANDARD_BLOCKED`.

## v2 failure summary

Phase 10 classified the product as `DOMAIN_PACK_QUALITY_BLOCKED` on `real-corpus-benchmark-1` (`sha256-34b65574c1f175410c31ae16c69e427601458faf30cc4d972f9fd6976a220f36`). The pipeline ran. Evidence grounding was 100 percent and invented evidence, dates, authority, and referents were 0. Relation and binding precision did not meet 95 percent and 99 percent. `UNKNOWN_PHRASE` accounted for 229 of 265 missed gold items. Every version-2 rule was auto-accepted, so the review queue was empty.

## v3 changes

Version-2 packs were left immutable:

| Pack | DomainPackRoot |
| --- | --- |
| contracts v2 | `sha256-4c16fdb2edf41fd6c5ca5d20106059210291b01c457980fb0e9565845840cfd0` |
| policy v2 | `sha256-f412af2b1109b3a8d5837f5f96a98be17a80f4462deb411f4f8fb66a3169ca6e` |
| operations v2 | `sha256-e8967d09e25ce5f6037444088494773264800d333aecc5d600d0d332764357ed` |

Version 3 packs:

| Pack | DomainPackRoot |
| --- | --- |
| contracts v3 | `sha256-6ae56377066d223902532a3cbc092965f377b9be754071891e8b0fcddbcf3008` |
| policy v3 | `sha256-e8b870e3153bc9037d6b8083fc89d742d320eb9ffa7af507ba3ad40ce0d724f8` |
| operations v3 | `sha256-b71574dd91b60e29766ebcefda39c13a11f9f5eca965934d1697fec13a9c6d01` |

The producer accepts three policy classes: `AUTO_ACCEPT`, `NEEDS_REVIEW`, and `OBSERVATION_ONLY`. There is no scalar confidence. `AUTO_ACCEPT` may enter generated CEG Source. `NEEDS_REVIEW` stays out until a reviewer accepts it. `OBSERVATION_ONLY` records a cue, including `INCOMPLETE_REFERENCE`, and does not propose a committed relation. Optional policy fields are omitted from the canonical pack body when unset, so version 1 and version 2 roots stayed on the same hashes.

A bounded clause template matches `party + modal + verb + object`, a negative modal, `agrees to`, `is required to`, and `condition + main clause` inside one sentence. It does not call an LLM, a parser service, or a vector index. Heading context can restrict a rule. It does not replace the evidence span.

Concept kinds live in pack metadata and in the annotation guide. `ceg-source-1` still has no kind field.

## Rule-family calibration

Calibration used the exposed Phase 10 holdout as development data. A rule was eligible for `AUTO_ACCEPT` only when strict precision was at least 0.98, matches were at least 10, and source families were at least 3. Zero rules qualified. The nearest contracts candidate, `may terminate`, had 7 matches, 6 families, and strict precision 1. It stayed `NEEDS_REVIEW` because the match floor was not met.

Date rules are `NEEDS_REVIEW` and do not paint committed windows. Incomplete cues are `OBSERVATION_ONLY`. Explicit integer authority still attaches only when the source states the integer. Metadata and heading rules are the only `AUTO_ACCEPT` rules, and they do not emit relations.

The calibration helper writes `research/kar-real-corpus-v2/results/rule-calibration.json`. It does not edit packs. No rule was promoted after the version-3 roots were frozen.

## Development comparison

On the 30 exposed Phase 10 documents, version 3 committed relations and bindings are empty, so precision is null and recall is 0. Treating review proposals as a diagnostic pool, not as committed semantics:

| Domain | v2 committed relation precision | v2 recall | v3 review-pool precision | v3 review-pool recall |
| --- | --- | --- | --- | --- |
| contracts | 65.7% (23/35) | 29.5% (23/78) | 72.1% (31/43) | 39.7% (31/78) |
| policy | 43.8% (7/16) | 24.1% (7/29) | 70.0% (21/30) | 72.4% (21/29) |
| operations | 58.3% (7/12) | 87.5% (7/8) | 41.2% (7/17) | 87.5% (7/8) |

Version 2 was not scored on the fresh holdout.

## Fresh corpus and gold

The candidate pool has 78 new documents: 24 CC-BY-4.0 CUAD contracts and Federal Register final rules for policy (DOJ, HHS, EPA, GSA) and operations (OSHA, NASA, NIST, FAA, IRS). No Phase 10 source identifier, title, or document hash was reused. The holdout seed `kar-real-corpus-20261011-holdout-v2` was written before selection. It selected 12 documents per domain. The largest family share is GSA at 4 of 12 policy documents (33 percent).

`annotation-guide-v2.md` was frozen at `sha256-56ca9adbaeda5f6336406eff3c1ae9442ddf28062009d3049cc90bb00114abea` before selection.

No human annotator or adjudicator was available. Two local models labeled the first two contracts and agreed on none of the evidence-relation pairs. Annotation stopped. Query manifest v2 was not built. P0–P3 quality and KAR utility were not scored against that gold.

Fresh-holdout auto-accept safety, which does not use gold, was 1163 of 1163 grounded excerpts, 0 committed relations, and 0 invented dates, authority, evidence, or referents.

## Review and model proposals

Review seconds were not measured. Pass A was not used as a reviewed graph. A model-proposal benchmark was not run. Local models were used only as the failed annotation passes.

## KAR utility

Historical gates were re-run. `@knolo/core` 209 tests, `@knolo/cli` 55, reflex 42, evidence-gate 9, semantic-ollama 6, langchain 2, llamaindex 2, create-knolo-app 1, KAR unit 16, KAR integration 5, core-rust integration 24, and the KAR Rust parity tests passed with 0 failures. The 50,000-graph differential, 10,000 exact-cover, tamper, closure, CEG reordering, reference-compiler, malformed-input, producer-repeat, rule-order, merge-order, ontology, and malformed pack and output gates passed with 0 KAR mismatches and 0 CEG compiler mismatches. The published closure file `scale-results.json` remains `sha256-77093ffe56710d0055d5863febc5a722a12577608322e284bf5a17f428241981`. The rerun is `research/kar-real-corpus-v2/results/closure-scale-rerun.json` at `sha256-20c3f6bbd01600b27585df13bba0b63a8274400752eb3f4290dc042dcd918d14`.

Downstream KAR agreement on the fresh holdout was not computed, because there is no stable reference CEG.

## Showcase dossiers

Three documents outside the holdout, `contracts-116`, `policy-103`, and `operations-124`, have verified dossiers under `research/kar-real-corpus-v2/showcase/dossiers/`. Each has a `SATISFIED` example and an `UNSATISFIED_EVIDENCE_REQUIREMENTS` example. The satisfied graphs accept one grounded review proposal by a machine. They are excluded from benchmark metrics. Statements are `Evidence requirements satisfied` and `Evidence requirements not satisfied`.

## Limitations

The release-quality gold gate is unmet. Machine agreement on the started sample is 0, and no human adjudicator reviewed the holdout. Auto-accept coverage of gold relations was not established on fresh text; the committed relation set is empty. Operations texts are regulatory rules, including excerpts, rather than shop-floor manuals. Version-3 review proposals remain below the precision gates on development data. A later promotion is version 4 plus a new holdout, after a human gold protocol.
