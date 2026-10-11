# Human gold final report

Package version `5.5.1`. Semantic contracts `kar-1-research-1` and `ceg-source-1` were not changed.

Classification: `HUMAN_REVIEW_REQUIRED`.

## Reviewer roles

No person performed Pass A, Pass B, adjudication, or workflow review in this phase.

Roles that were not used:

| Role | Person |
| --- | --- |
| Human Annotator A | none |
| Human Annotator B | none |
| Human Adjudicator | none |
| Workflow Reviewer | none |

A model was not recorded as `human`, `human-reviewer`, `human-adjudicator`, or `domain-expert`.

## Pilot

`research/kar-real-corpus-v3/pilot-selection.json` still lists 15 exposed development documents: 5 contracts, 5 policies, and 5 operations. Seed `kar-real-corpus-20261011-pilot-v3`. `annotated` is false. `humanReviewers` is false.

`knolo kar benchmark annotate` was not run by a human on those documents. Pass A and Pass B files were not created. `knolo kar benchmark agreement` was not run on human labels. `knolo kar benchmark adjudicate` was not run.

Evidence agreement, evidence-plus-relation agreement, concept-kind agreement, strict endpoint agreement, requirement-token agreement, and binding agreement were not measured. The 90 percent stability target was not claimed.

## Guide

`research/kar-real-corpus-v3/ANNOTATION_GUIDE_V3.md` was not edited. Its draft digest remains `sha256-cf33474dd102a32f06a3be5ccd5e15adb8e38972fd4b28224c925b28474b58c4`. `AnnotationGuideRoot` was not frozen.

## Gold integrity

Accepted human gold items: 0. A grounding rate was not computed for an empty human gold set, and an empty set was not treated as 100 percent grounded.

## Holdout

No fresh candidate corpus was collected. No holdout ids were selected.
