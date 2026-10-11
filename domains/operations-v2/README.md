# operations domain pack v2

Format `ceg-domain-1`. Id `operations`. Version `2`.

Version 1 remains in `domains/operations` and is unchanged.

DomainPackRoot v1: `sha256-2f7a5a19bcb9b2310e578f0ee10fd115780f4c1e521abd4311732bcea6138681`

DomainPackRoot v2: `sha256-e8967d09e25ce5f6037444088494773264800d333aecc5d600d0d332764357ed`

## Rules added

No version 1 rule was removed or edited.

| Rule | Pattern | Relation | Reason |
| --- | --- | --- | --- |
| operations.step.must.v2 | must | requires | Procedural duty. Skips a line that also says "must not", so a prohibition is not also labeled as a duty. |
| operations.step.must-upper.v2 | MUST | requires | Field label used as a required entry. |
| operations.step.must-not-be.v2 | must not be | prohibits | A prohibited state. |
| operations.step.do-not.v2 | Do not | prohibits | Sentence-initial instruction not to do something. Lowercase "do not" also describes states, so it is not auto-accepted. |
| operations.exception.unless-general.v2 | unless | qualifies | A stated condition. Same relation as version 1 "unless authorized". |

Bare `do not` was not added. Training text includes descriptive uses such as "do not have".
