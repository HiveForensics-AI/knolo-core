# `@knolo/evidence-gate`

`@knolo/evidence-gate` evaluates structured answer claims against a verified
Knolo V5 Knowledge Image. It returns a deterministic decision for every claim,
preserves conflicts, and emits a certificate root that can be checked offline.

The gate verifies provenance and policy. It does not use a model to decide
whether prose is semantically true. The host application is responsible for
extracting claims and declaring the evidence relations it wants checked.

```ts
import {
  evaluateEvidenceGateV1,
  verifyEvidenceGateV1,
} from '@knolo/evidence-gate';

const result = evaluateEvidenceGateV1({
  image,
  principal: 'support-agent',
  policy: {
    knowledge: {
      version: 1,
      default: 'allow',
    },
    onConflict: 'contested',
    requireEvidenceFor: ['fact', 'instruction', 'calculation'],
  },
  claims: [
    {
      id: 'refund-window',
      text: 'Refunds are available within 30 days.',
      modality: 'fact',
      evidence: [
        {
          objectId,
          sourceDigest,
          start: 0,
          end: 34,
          relation: 'supports',
        },
      ],
    },
  ],
});

verifyEvidenceGateV1(result, {/* the same request */});
```

For a file-based workflow, the package also includes `evidence-gate check` and
`evidence-gate explain`. The request JSON contains `principal`, `policy`, and
`claims`; the V5 image is passed separately so the CLI can verify its bytes.

```bash
evidence-gate check --image knowledge.v5 --request request.json --out result.json
evidence-gate explain --image knowledge.v5 --request request.json --result result.json
```

This package is an additive V6 workstream. It does not change `@knolo/core`
V5 container bytes, roots, or receipt contracts.
