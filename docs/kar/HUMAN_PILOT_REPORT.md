# Human pilot report

Package version `5.5.1`. Semantic contracts `kar-1-research-1` and `ceg-source-1` were not changed.

Classification: `HUMAN_REVIEW_REQUIRED`.

## Reviewer roles

| Role | Reviewer id |
| --- | --- |
| Human Annotator A | none |
| Human Annotator B | none |
| Human Adjudicator | none |

A model was not recorded as a human annotator or adjudicator. No person has supplied Pass A, Pass B, or an adjudication.

## Pilot documents

The pilot remains `research/kar-real-corpus-v3/pilot-selection.json`. Seed `kar-real-corpus-20261011-pilot-v3`. It still lists 5 contracts, 5 policies, and 5 operations. `annotated` is false. These are previously exposed development documents. No unseen document was added.

Blind packets are in `research/kar-real-corpus-v4/pilot/packets/`. The index is `research/kar-real-corpus-v4/pilot/packet-index.json`.

| Domain | Documents | Evidence blocks |
| --- | ---: | ---: |
| contracts | 5 | 242 |
| policy | 5 | 306 |
| operations | 5 | 406 |
| total | 15 | 954 |

Each packet contains the evidence text, a heading when the segmenter found one, the paragraph index, and source metadata: title, family, license, source identifier, document hash, and phase. Document hashes match the frozen pilot. Six documents reuse evidence ids from existing chunk indexes. Nine documents receive ids from the same V5 object-digest method. The packets omit producer proposals, Domain Pack matches, CEG, KAR results, expected labels, dataset split, and agreement type.

The annotate command accepts every packet. A schema check wrote empty temporary passes and then deleted them. Those files are not Pass A or Pass B. The command refuses `--proposals` and refuses a model id in a human role.

## Agreement

Evidence agreement, evidence-plus-relation agreement, concept-kind agreement, strict endpoint agreement, requirement-token agreement, and binding agreement were not measured. The 90 percent guide-freeze gate was not claimed.

## Disagreement

There are no human labels, so there is no disagreement class to inspect. The annotation guide was not edited.

## Adjudication

No adjudication was run. Pass A and Pass B were not created, so there was nothing to preserve or overwrite. Accepted pilot gold items: 0. Gold grounding was not treated as 100 percent for an empty set.

## Guide

`research/kar-real-corpus-v3/ANNOTATION_GUIDE_V3.md` is still a draft. Draft digest `sha256-cf33474dd102a32f06a3be5ccd5e15adb8e38972fd4b28224c925b28474b58c4`. `AnnotationGuideRoot` is null.

## Domain Pack v5

`domains/contracts-v5`, `domains/policy-v5`, and `domains/operations-v5` were not created. Version 5 waits for adjudicated human pilot gold. Version 4 roots are unchanged:

| Pack | DomainPackRoot |
| --- | --- |
| contracts v4 | `sha256-1ffea8ded1877f28ce61c9e98bb79644f8bbe237c22baae6984983d92ede39a5` |
| policy v4 | `sha256-109ad58943b28a93453205ea86585843931eb69d8a989bcd071e8e48c70eacea` |
| operations v4 | `sha256-edde04257c55c480c95ce3db90074238a54ab05ee8c9d25135190f5da70f6da4` |

No holdout was selected. No new benchmark file was written.

## Historical conformance

This checkpoint did not change the KAR runtime, the CEG compiler, or the v4 packs. The last full conformance run remains `research/kar-real-corpus-v4/results/historical-gates.json`, finished 2026-10-11T15:13:49+02:00 with exit 0. KAR mismatches 0. CEG compiler mismatches 0. `spec/KAR-1.md` remains `sha256-a38f3c5e6098b88d13bd3595dce5c368bb46ace6159337858c18726b58504d66`. The published closure file remains `sha256-77093ffe56710d0055d5863febc5a722a12577608322e284bf5a17f428241981`.

## Next step

Two people independently label the 15 packets. A third person adjudicates after both passes exist. Freeze Annotation Guide v3 only if evidence-plus-relation agreement and concept-kind agreement both reach 90 percent and accepted gold is fully grounded. Build Domain Pack v5 only after that gold exists.
