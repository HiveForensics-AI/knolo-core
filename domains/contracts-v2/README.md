# contracts domain pack v2

Format `ceg-domain-1`. Id `contracts`. Version `2`.

Version 1 remains in `domains/contracts` and is unchanged.

DomainPackRoot v1: `sha256-f691628a70e0a28b6ddec59b7803c5326f7a17deddeb3c67af39516c382e4d07`

DomainPackRoot v2: `sha256-4c16fdb2edf41fd6c5ca5d20106059210291b01c457980fb0e9565845840cfd0`

## Rules added

These patterns were added from training and development contracts only. Each pattern is ordinary contract language, not a sentence copied from one document.

| Rule | Pattern | Relation | Reason |
| --- | --- | --- | --- |
| contracts.override.notwithstanding.v2 | Notwithstanding | overrides | The clause controls over a prior statement. Seen in 9 training or development contracts. |
| contracts.override.notwithstanding-lower.v2 | notwithstanding | overrides | Same pattern in lowercase. Seen in 3 training or development contracts. |
| contracts.exception.except-as.v2 | except as | qualifies | Internal exception. Seen in 8 training or development contracts. |
| contracts.exception.except-as-capital.v2 | Except as | qualifies | Same pattern at a sentence start. Seen in 5 training or development contracts. |
| contracts.supersedes-all.v2 | supersedes all | supersedes | This instrument replaces prior agreements. Seen in 5 training or development contracts. |
| contracts.payment.shall-pay.v2 | shall pay | requires | Payment duty. Seen in 4 training or development contracts. |
| contracts.renewal.automatic.v2 | automatically renew | requires | Automatic renewal. |
| contracts.renewal.automatic-passive.v2 | automatically renewed | requires | Passive form of automatic renewal. |
| contracts.termination.passive.v2 | may be terminated | permits | Passive termination right. |
| contracts.restriction.shall-not.v2 | shall not | prohibits | A prohibition. Excludes the archaic relative "as shall not". Seen in 17 training or development contracts. |
| contracts.restriction.may-not-be.v2 | may not be | prohibits | A prohibition such as "may not be assigned". |
| contracts.exception.unless-general.v2 | unless | qualifies | A stated condition. The narrower version 1 "unless stated" rule remains. |
| contracts.exception.unless-capital.v2 | Unless | qualifies | Sentence-initial form of the same condition. |

`except as` and `Except as` now skip a line that contains `provided`, because "except as provided in Section X" points outside the sentence. The version 1 rules are unchanged in `domains/contracts`.

No version 1 rule was removed or edited.

## Rules not added

`effective date` was common, including in tables of contents. No rule turns that phrase into a parsed date. ISO dates remain the only automatic dates. `survives` did not appear in the training and development contracts.
