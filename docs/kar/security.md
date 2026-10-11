# KAR security notes

This is a focused review of the V6 surface. It is not a claim that every repository parser was re-audited.

## Reviewed

| Surface | Result |
| --- | --- |
| CEG Source YAML subset | Rejects tabs, anchors, flow collections, duplicate keys, deep nesting, overlong input, unsafe integers, and the keys `__proto__`, `prototype`, and `constructor` |
| CEG Source JSON | Reserved keys `__proto__`, `prototype`, and `constructor` fail with `CEG_PARSE` before `JSON.parse`. Object input with those concept, evidence, or metadata names fails with `CEG_INVALID_IDENTIFIER` |
| Domain Pack parser | Unknown fields, including `maturity` inside `domain.yaml`, are `CEG_UNKNOWN_FIELD` and fail the pack |
| Rule regex | `regexIsSafe` rejects backreferences, lookaround, and nested quantifiers. A rule stops at its match cap. The scan does not use a wall clock, so the same text and rule produce the same hits |
| Model and ontology proposals | Ungrounded spans, unknown relations, and bad dates are diagnostics. They do not write a sidecar |
| Distribution manifest | Unknown fields are `CEG_MANIFEST_MISMATCH`. Digests are compared before a bundle is accepted |
| Dossier loader | Verification recomputes the certificate and compares canonical manifest, certificate, evaluation, and rendering |
| KAR bounds | Closure and cover caps return statuses. They do not throw and they do not return a partial cover |
| CLI files | `knolo kar` refuses non-files and inputs over 32 MiB of text or 512 MiB of image bytes (`KAR_INPUT_TOO_LARGE`). Paths are resolved from the caller cwd. `..` is ordinary local CLI behavior, not a sandbox |

No archive extractor unpacks a KAR bundle. `knolo kar package` writes named files into the output directory.

## Fixes in this release

- YAML and JSON keys `__proto__`, `prototype`, and `constructor` fail with `CEG_PARSE`.
- The same names are rejected as concept names, evidence aliases, metadata keys, and plan-template names, so assignment cannot replace an object's prototype.
- Distribution manifests reject unknown fields instead of ignoring them.
- CLI reads are size-capped.

These checks do not change `kar-1-research-1` or `ceg-source-1` certificate semantics.

## Not a guarantee

Verification does not establish real-world truth, author correctness, or evidence outside the committed image. See [Verification](verification.md).

A hostile Knowledge Image can still be large up to the CLI cap and can consume CPU during mount and closure. Plans should set `maxClosureNodes`, `maxClosureEdges`, and `maxCoverVisits`. The public demos use small bounds.

Domain Pack rules are data. `AUTO_ACCEPT` is off for relation-producing v4 rules. Review `NEEDS_REVIEW` proposals before compilation. Do not treat a regex match as committed semantics.
