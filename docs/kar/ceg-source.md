# CEG Source v1

`ceg-source-1` is the parsed authoring object. `knowledge.ceg.yaml` and `knowledge.ceg.json` are two encodings of that object. YAML is a block subset: spaces, comments, quoted strings, integers, and `true` / `false` / `null`. Flow collections, tabs, and anchors are rejected. The same object in JSON compiles to the same sidecar.

The schema is [`ceg-source-v1.schema.json`](../../schemas/experimental/kar/ceg-source-v1.schema.json).

```yaml
format: ceg-source-1
concepts:
  enterprise-contract:
    label: Enterprise contract
  cancellation:
    label: Cancellation
evidence:
  cancellation-policy:
    source: policy.md
    namespace: legal
relations:
  - from: enterprise-contract
    type: permits
    to: cancellation
bindings:
  - concept: cancellation
    evidence: cancellation-policy
    requirements:
      - cancellation-rule
    authority: 80
    validFrom: 2026-01-01
requirements:
  - cancellation-rule
```

## Concepts

A concept name is the stable local identity. `label` and `note` are for people and review reports. They do not change the compiled node id and they are not query-time inference.

## Relations

`type` is an arbitrary non-empty token without spaces. The compiler checks that both endpoints name concepts. It does not assign the symbol to a KAR frontier. A plan still decides whether `prohibits` is opposition. Self-relations and cycles are allowed. A cycle produces the info diagnostic `CEG_CYCLE_PRESENT`.

Duplicate concept names, duplicate evidence aliases, and duplicate relations are errors.

## Bindings

A binding names a concept, an evidence alias, and a requirement list. Optional fields are `authority` (safe integer), `unauthorized`, `validFrom`, `validUntil`, and `provenance`. Dates are real `YYYY-MM-DD` calendar days. `validFrom` must be earlier than `validUntil` when both are set. The compiler sorts requirements before it derives the binding id and before it writes the sidecar.

A binding with an empty requirement list is a warning, `CEG_BINDING_WITHOUT_REQUIREMENTS`. Compilation still proceeds. An unknown alias or a dangling relation is an error and compilation stops.

## Evidence selectors

Exactly one strategy is allowed:

| Selector | Match |
| --- | --- |
| `objectId` | The Knowledge Image object id. Prefer this. |
| `source` | `meta.source`. Optional `namespace` must equal `meta.namespace`. |
| `locator` | `meta.locator`. |
| `meta` | Every listed string equals object metadata. `kind` matches the object kind. |

Zero matches produce `CEG_EVIDENCE_NOT_FOUND`. More than one match produces `CEG_EVIDENCE_AMBIGUOUS`. The compiler does not take the first object. It does not use embeddings, fuzzy text, or a model.

## Diagnostics

Severity is `error`, `warning`, or `info`. An error prevents compilation. A warning does not. Codes include:

```text
CEG_DUPLICATE_CONCEPT
CEG_DUPLICATE_KEY
CEG_EVIDENCE_NOT_FOUND
CEG_EVIDENCE_AMBIGUOUS
CEG_DANGLING_RELATION
CEG_UNBOUND_CONCEPT
CEG_UNUSED_REQUIREMENT
CEG_INVALID_VALIDITY
CEG_IMAGE_MISMATCH
CEG_UNREACHABLE_COMPONENT
CEG_PLAN_EMPTY_OPPOSITION
CEG_PLAN_EMPTY_QUALIFICATION
CEG_STALE_IMAGE
CEG_LIMIT_EXCEEDED
```

Unused concepts, unbound concepts, requirements that never appear on a binding, evidence reused across concepts, and extra connected components are warnings. A supplied plan that maps `prohibits` to `F_O` while the source has no `prohibits` relation warns `CEG_PLAN_EMPTY_OPPOSITION`. That check does not hard-code the mapping into KAR.

## Limits

The parser rejects input past the configured bounds: source bytes, concepts, relations, bindings, requirements per binding, identifier length, relation-name length, label length, nesting depth, and line count. Defaults live on `CEG_LIMITS` in the authoring module. A limit failure is `CEG_LIMIT_EXCEEDED`.

## Review

```bash
knolo kar graph review knowledge.ceg.yaml --image knowledge.knolo
```

The report lists each concept, relationship, evidence reference, a short source excerpt, authority, validity, and requirements. Pass `--json` for the same record as data. There is no review UI in this phase.
