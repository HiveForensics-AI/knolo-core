# contracts domain pack

Format `ceg-domain-1`. Id `contracts`. Version `1`.

Reusable contract semantics for rights, obligations, restrictions, exceptions, amendments, and effective dates.

This directory is reusable production logic. It does not contain customer evidence. Fixtures are tests and are not part of DomainPackRoot.

## Distribution fields

- id: `contracts`
- version: `1`
- description: Reusable contract semantics for rights, obligations, restrictions, exceptions, amendments, and effective dates.
- relations: permits, prohibits, requires, qualifies, excepts, overrides, supersedes, applies_to, valid_before, valid_after
- plan templates: amendment-review, authority-review, balanced-review, qualification-review, showcase-review, support-only, termination-review
- DomainPackRoot: `sha256-f691628a70e0a28b6ddec59b7803c5326f7a17deddeb3c67af39516c382e4d07`

## Focus

Rights, obligations, restrictions, exceptions, amendments, effective dates, termination, renewal, scope, and party applicability.

## Layout

```text
domain.yaml
rules/rules.yaml
plans/
fixtures/
```
