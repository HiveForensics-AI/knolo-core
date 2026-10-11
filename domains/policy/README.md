# policy domain pack

Format `ceg-domain-1`. Id `policy`. Version `1`.

Reusable policy and compliance semantics for controls, prohibitions, exceptions, roles, and replacement.

This directory is reusable production logic. It does not contain customer evidence. Fixtures are tests and are not part of DomainPackRoot.

## Distribution fields

- id: `policy`
- version: `1`
- description: Reusable policy and compliance semantics for controls, prohibitions, exceptions, roles, and replacement.
- relations: requires, prohibits, qualifies, excepts, supersedes, overrides, applies_to, valid_before, valid_after
- plan templates: compliance-review, current-policy, exception-review
- DomainPackRoot: `sha256-0391d52bd3756a9ad7b491d8af034d98ae85fd6497c3ae60b3aac08e297d62d5`

## Focus

Required controls, prohibited actions, exceptions, scope, roles, authority, effective dates, replaced policy, and conditional requirements.

## Layout

```text
domain.yaml
rules/rules.yaml
plans/
fixtures/
```
