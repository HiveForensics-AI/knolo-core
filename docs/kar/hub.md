# Hub labels

Hub at `https://hub.knolo.dev` already publishes Knowledge Images as V5 artifacts with `stateRoot`. This release does not change Hub's API.

KAR adds two other artifacts. They are not customer evidence and they are not a V5 image.

| Artifact | What a publisher should show | Identity |
| --- | --- | --- |
| Knowledge Image | V5 image. Evidence bytes | `stateRoot`, `objectRoot`, `commitDigest`, file sha256 |
| Domain Pack | Rules, vocabulary, plan templates, fixtures, README. No customer documents | `DomainPackRoot`, version, maturity |
| KAR-enabled bundle | `knowledge.knolo` plus `knowledge.kar.json` plus `kar-manifest.json` | image digests above, `SemanticRoot`, manifest sha256 |

`kar-distribution-1` has no maturity field and no Domain Pack field. `additionalProperties` is false. Put maturity beside the pack.

Bundled packs:

| Pack | Path | Maturity | DomainPackRoot |
| --- | --- | --- | --- |
| contracts v4 | `domains/contracts-v4` | `review-required` | `sha256-1ffea8ded1877f28ce61c9e98bb79644f8bbe237c22baae6984983d92ede39a5` |
| policy v4 | `domains/policy-v4` | `review-required` | `sha256-109ad58943b28a93453205ea86585843931eb69d8a989bcd071e8e48c70eacea` |
| operations v4 | `domains/operations-v4` | `review-required` | `sha256-edde04257c55c480c95ce3db90074238a54ab05ee8c9d25135190f5da70f6da4` |

The machine-readable copy is [`domains/v6-catalog.json`](../../domains/v6-catalog.json). Example bundles, which are demos and not universal coverage, are listed in [`examples/kar-v6/hub-labels.json`](../../examples/kar-v6/hub-labels.json).

A Domain Pack directory contains `domain.yaml`, `rules/`, `plans/`, `fixtures/`, and `README.md`. It does not contain a customer CEG or customer documents. Fixtures are tests and are outside `DomainPackRoot`.
