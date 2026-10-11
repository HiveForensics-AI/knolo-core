# Hub

Hub upload is not required for the npm general availability of `@knolo/core`. Do not block `6.0.0` on a Hub publish.

Keep the existing Hub kinds. Do not add a new kind and do not redesign hub.knolo.dev.

Publishers distinguish artifacts with labels, not by changing `kar-distribution-1`:

| Artifact | How to label it |
| --- | --- |
| Knowledge Image | V5 image bytes. The Hub manifest still requires `stateRoot` |
| Domain Pack | `domains/v6-catalog.json`. contracts v4, policy v4, and operations v4 stay `review-required` |
| KAR bundle | `examples/kar-v6/hub-labels.json`, format `knolo-hub-label-1`, kind `kar-bundle`, `containsCustomerEvidence` false |

A Domain Pack assists semantic production. It is not a validated Knowledge Image and it is not a KAR evaluation result. KAR evaluates an already committed CEG.

Human validation of the v4 packs can continue after `6.0.0`. A later validated pack can be published as its own version without changing KAR-1.
