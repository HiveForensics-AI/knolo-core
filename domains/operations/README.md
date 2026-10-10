# operations domain pack

Format `ceg-domain-1`. Id `operations`. Version `1`.

Reusable procedure semantics for required steps, prohibited states, preconditions, exceptions, and equipment.

This directory is reusable production logic. It does not contain customer evidence. Fixtures are tests and are not part of DomainPackRoot.

## Distribution fields

- id: `operations`
- version: `1`
- description: Reusable procedure semantics for required steps, prohibited states, preconditions, exceptions, and equipment.
- relations: requires, prohibits, qualifies, excepts, supersedes, applies_to, valid_before, valid_after
- plan templates: current-procedure, exception-review, procedure-review
- DomainPackRoot: `sha256-2f7a5a19bcb9b2310e578f0ee10fd115780f4c1e521abd4311732bcea6138681`

## Focus

Required steps, prohibited states, preconditions, exceptions, equipment, roles, validity, and procedure replacement.

## Layout

```text
domain.yaml
rules/rules.yaml
plans/
fixtures/
```
