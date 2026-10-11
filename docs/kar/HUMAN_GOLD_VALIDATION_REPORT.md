# Human gold validation

Package version `5.5.1`. Semantic contracts `kar-1-research-1` and `ceg-source-1` were not changed.

Classification: `HUMAN_REVIEW_REQUIRED`.

## What was built

Annotation Guide v3 defines the twelve KAR relations, the domain concept kinds, endpoint-selection rules, requirement tokens, cross-section handling, dates, and authority. Draft digest `sha256-cf33474dd102a32f06a3be5ccd5e15adb8e38972fd4b28224c925b28474b58c4`. The guide is not frozen. The pilot that would justify `AnnotationGuideRoot` did not run.

`knolo kar benchmark annotate`, `adjudicate`, and `agreement` record a blind pass. The commands refuse producer output, Domain Pack hits, and another answer key. A reviewer id that names a model cannot use a human role. Quotes must be exact substrings. An ISO date or a numeric authority is stored only when that text is in the quote. Role `model-assistant` sets `releaseGold` to false.

## Pilot

Fifteen already exposed documents were listed for reviewer training: 5 contracts, 5 policies, and 5 operations. Seed `kar-real-corpus-20261011-pilot-v3`. At most two documents share a source family. The list is `research/kar-real-corpus-v3/pilot-selection.json`. `annotated` is false. `humanReviewers` is false.

No agreement was measured on that pilot, because no person labeled it. The 90 percent evidence-plus-relation gate and the 90 percent concept-kind gate were not claimed.

## Protocol that remains required

Release-quality gold still needs independent human pass A, independent human pass B, and a human adjudicator. A model may assist. It cannot be recorded as a human reviewer. Phase 11 already showed two local models at agreement 0 on the first two contracts. That result stands.

## Holdout

No Phase 12 candidate corpus was frozen. No holdout ids were selected. Phase 10 and Phase 11 documents stay development data.
