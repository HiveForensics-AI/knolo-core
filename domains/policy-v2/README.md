# policy domain pack v2

Format `ceg-domain-1`. Id `policy`. Version `2`.

Version 1 remains in `domains/policy` and is unchanged.

DomainPackRoot v1: `sha256-0391d52bd3756a9ad7b491d8af034d98ae85fd6497c3ae60b3aac08e297d62d5`

DomainPackRoot v2: `sha256-f412af2b1109b3a8d5837f5f96a98be17a80f4462deb411f4f8fb66a3169ca6e`

## Rules changed

| Rule | Change | Reason |
| --- | --- | --- |
| policy.exception.subject.v1 | pattern `subject to` became `is subject to` | "not subject to" was matching the broader phrase. The narrower phrase still covers the version 1 fixtures. |

## Rules added

| Rule | Pattern | Relation | Reason |
| --- | --- | --- | --- |
| policy.prohibits.shall-not.v2 | shall not | prohibits | A prohibition. Seen in training and development policies. |
| policy.supersedes.verb.v2 | supersedes | supersedes | One instrument replaces another. |
| policy.qualifies.unless.v2 | unless | qualifies | A stated condition. Same relation as version 1 "unless approved". |
| policy.qualifies.except-when.v2 | except when | qualifies | The exception is stated in the sentence. |
| policy.qualifies.provided.v2 | provided that | qualifies | A stated condition. |
| policy.qualifies.only-if.v2 | only if | qualifies | A stated condition. |
| policy.permits.authorized.v2 | is authorized | permits | A permission. |
| policy.scope.applies.v2 | applies to | applies_to | Applicability. Skips "applies to the role", which version 1 already labels. |
| policy.qualifies.are-subject.v2 | are subject to | qualifies | A stated qualification that is not "is subject to". |
| policy.qualifies.be-subject.v2 | be subject to | qualifies | Skips "not be subject". |
| policy.incomplete.except-as-provided.v2 | except as provided | none | The sentence points at text that may not be in the image. |
| policy.incomplete.except-as-provided-capital.v2 | Except as provided | none | Sentence-initial form of the same incomplete reference. |

`permits` was added to the relation vocabulary and to the plan frontier maps as support. No version 1 file was edited.

Bare `shall`, `must`, and `may not` were not auto-accepted. Development text uses `may not` both as a prohibition and as "might not".
