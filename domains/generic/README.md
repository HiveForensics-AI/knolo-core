# generic domain pack

Format `ceg-domain-1`. Id `generic`. Version `1`.

Small generic pack used to measure rules that are not tied to one domain.

This directory is reusable production logic. It does not contain customer evidence. Fixtures are tests and are not part of DomainPackRoot.

## Distribution fields

- id: `generic`
- version: `1`
- description: Small generic pack used to measure rules that are not tied to one domain.
- relations: related
- plan templates: related-review
- DomainPackRoot: `sha256-c389d2847921fb405f3298f1c9cd98bd962cbc67c39c04d7429162f8dbdabaa2`

## Focus

One metadata rule and one exact phrase. This pack is a separate metric row. It is not a domain model.

## Layout

```text
domain.yaml
rules/rules.yaml
plans/
fixtures/
```
