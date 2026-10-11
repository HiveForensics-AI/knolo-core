# Evidence coverage

A coverage report evaluates several plans against one Knowledge Image and one Committed Evidence Graph. Each row is a frozen `kar-1-research-1` certificate. The report adds a disposition and, when closure completes, a slot for every frontier.

`CoverageRoot` commits the image identity, `SemanticRoot`, the optional Domain Pack identity, and the sorted cases. It is not an input to `KARRoot`. It is not written into a `KarResult`. Evidence text, file paths, and timestamps stay out of the root.

## Dispositions

| Disposition | Certificate status | Sentence |
| --- | --- | --- |
| `met` | `SATISFIED` | Evidence requirements satisfied |
| `gap` | `UNSATISFIED_EVIDENCE_REQUIREMENTS` | Evidence requirements not satisfied |
| `blocked` | any other status | Evaluation did not decide evidence requirements: `<STATUS>` |

`met` does not prove the proposition. `gap` does not mean the proposition is false. `blocked` is not a knowledge gap. A report that contains only gaps still builds, and it still verifies.

## Slots

Slots come from a second read-only closure. That pass does not select evidence and does not edit the certificate. Unsatisfied certificates still record covered counts as zero. The slot says whether each required token was admitted.

| Slot | Meaning |
| --- | --- |
| `met` | The row is `met` and this frontier was required |
| `not-required` | The frontier has no required tokens and a floor of zero, or requirements mode lists none |
| `unadmitted` | At least one required token is absent from the applicable admissions |
| `admitted-but-uncovered` | Every required token was admitted, and the row is still a gap or a search bound |
| `not-evaluated` | The plan was invalid, the anchor was rejected, or closure did not finish |

`unadmitted` wins over a search bound when a required token was never admitted. An anchor rejection leaves every slot `not-evaluated`.

## API

```ts
import {
  createKarCoverage,
  verifyKarCoverage,
  renderKarCoverage,
  karCoverageStatement,
} from '@knolo/core/kar';

const report = createKarCoverage({
  image,
  graph,
  cases: [
    { id: 'met', proposition, plan },
    { id: 'gap', proposition: other, plan: gapPlan },
  ],
});
```

Case ids are unique tokens of at most 128 characters. A report holds at most 32 cases. Empty input, duplicate ids, an empty proposition, and control characters throw `KAR_COVERAGE_INVALID` and do not return a partial report. Input order does not change `CoverageRoot`.

`verifyKarCoverage` remounts the image and recomputes the report from the cases. Pass `domainPack` from the case file. The claimed report does not get to supply that identity. A mismatch returns `KAR_RESULT_MISMATCH`. A corrupt sidecar returns the same image or graph code as `verifyKar`.

Domain Pack templates expand on the authoring entry, so the retrieval entry does not load the compiler:

```ts
import { coverageCasesFromDomainPack } from '@knolo/core/kar/authoring';

const expanded = coverageCasesFromDomainPack({
  pack,
  proposition: 'May this agreement terminate?',
  templates: ['balanced-review', 'support-only'],
});
```

One proposition is applied to every selected template. A `queries` object replaces that proposition per template. Fixtures are not questions. Unknown template names fail closed. The recorded identity is `{ id, version, root }` and `root` is `DomainPackRoot`.

## CLI

```bash
knolo kar coverage build \
  --image knowledge.knolo \
  --graph knowledge.kar.json \
  --plan met.json --query "What evidence shows the valve is closed?" \
  --plan gap.json --query "What evidence shows the missing permit?" \
  --out coverage/

knolo kar coverage build \
  --image knowledge.knolo \
  --graph knowledge.kar.json \
  --domain domains/contracts-v4 \
  --template balanced-review \
  --template support-only \
  --query "May this agreement terminate?" \
  --out coverage/

knolo kar coverage verify coverage/
knolo kar coverage verify coverage/ --domain domains/contracts-v4
```

`--plan` and `--domain` cannot be mixed. `--queries queries.json` is an object of template name to proposition and replaces the single `--query`. With `--domain` and no `--template`, every template key is used, sorted. The command refuses to overwrite a directory that already contains `manifest.json`.

`coverage build` exits 0 when the report is written, including when every row is `gap` or `blocked`. `coverage verify` exits non-zero only when the recomputation does not match, or when the image or graph is rejected. A gap row does not fail verify.

The directory contains `knowledge.knolo`, `knowledge.kar.json`, `cases.json`, `report.json`, `manifest.json`, and `coverage.md`. Schema: [`kar-coverage-report-v1.schema.json`](../../schemas/experimental/kar/kar-coverage-report-v1.schema.json). The schema describes the manifest.

## Limits

Coverage is relative to the cases and templates you supply. It does not search for a better plan, accept a producer proposal, or write a new sidecar. Unaccepted proposals cannot close a gap until a person accepts them and `compileCegSource()` writes a new Committed Evidence Graph. Bundled v4 Domain Packs stay review-required.

Public vectors: [`conformance/kar/coverage-v1`](../../conformance/kar/coverage-v1/README.md). Worked files: [`examples/kar-coverage`](../../examples/kar-coverage/README.md).
