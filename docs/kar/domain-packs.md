# CEG Domain Packs

A Domain Pack is reusable semantic production data. Format `ceg-domain-1`.

```text
Knowledge Image  = project evidence
Domain Pack      = reusable rules, vocabulary, and plan templates
CEG Source       = committed authoring for one image
Committed graph  = compiler output that frozen KAR already evaluates
```

A pack does not contain customer evidence, and it does not own Knowledge Image bytes. Fixtures are tests. They are stored beside the pack and they are excluded from `DomainPackRoot`.

Schema: [`ceg-domain-v1.schema.json`](../../schemas/experimental/kar/ceg-domain-v1.schema.json).

## Directory

```text
contracts-domain/
  domain.yaml
  rules/
  plans/
  fixtures/
  README.md
```

`domain.yaml` holds identity, concept kinds, the concept registry, and the relation vocabulary. `rules/*.yaml`, `rules/*.yml`, and `rules/*.json` are merged in sorted path order. `plans/*.json` are plan templates. `fixtures/*.json` are tests.

The shipped packs are [`domains/contracts`](../../domains/contracts), [`domains/policy`](../../domains/policy), and [`domains/operations`](../../domains/operations). [`domains/generic`](../../domains/generic) is a separate one-relation measurement pack.

## Identity

```text
DomainPackRoot = H(canonical domain pack body)
```

The canonical body includes format, id, version, description, concept kinds, concepts (phrases sorted), relations, rules sorted by id, plan templates, and limits. It excludes fixtures. Rule file order does not change the root. A released pack is immutable: change the rules by publishing a new version.

`knolo kar domain inspect` prints the root. Current version-1 roots:

| Pack | DomainPackRoot |
| --- | --- |
| contracts | `sha256-f691628a70e0a28b6ddec59b7803c5326f7a17deddeb3c67af39516c382e4d07` |
| policy | `sha256-0391d52bd3756a9ad7b491d8af034d98ae85fd6497c3ae60b3aac08e297d62d5` |
| operations | `sha256-2f7a5a19bcb9b2310e578f0ee10fd115780f4c1e521abd4311732bcea6138681` |
| generic | `sha256-c389d2847921fb405f3298f1c9cd98bd962cbc67c39c04d7429162f8dbdabaa2` |

A pack must stay portable. Identifiers, descriptions, phrases, and relation symbols reject absolute paths, URLs, and private-key banners. The pack carries no timestamps, credentials, or machine paths.

## What a pack declares

- Concept kinds and canonical concept names, with optional phrases.
- The relation vocabulary the rule producer may emit.
- Declarative rules. See [Rule producer](rule-producer.md).
- Recommended KAR plan templates.

A plan template is convenience. `instantiatePlanTemplate(pack, name)` rewrites a supplied anchor `concept` into the frozen node id and then calls `validatePlan`. The developer selects the template. The mappings are not KAR defaults.

Contracts ships `balanced-review`, `support-only`, `termination-review`, `amendment-review`, `qualification-review`, `authority-review`, and `showcase-review`. Policy ships `compliance-review`, `exception-review`, and `current-policy`. Operations ships `procedure-review`, `exception-review`, and `current-procedure`.

## Bounds

A pack may only lower the producer ceilings. An unknown limit key is `CEG_UNKNOWN_FIELD`. A value above the ceiling is `CEG_PRODUCER_LIMIT`.

| Limit | Ceiling |
| --- | --- |
| `maxPackBytes` | 2 MiB |
| `maxRules` | 10,000 |
| `maxConceptKinds` | 1,000 |
| `maxRelationVocabulary` | 1,000 |
| `maxPlanTemplates` | 100 |
| `maxPatternLength` | 256 |
| `maxConcepts` | 20,000 |
| `maxEvidenceObjects` | 100,000 |
| `maxMatchesPerRule` | 100 |
| `maxGeneratedConcepts` | 100,000 |
| `maxGeneratedRelations` | 200,000 |
| `maxGeneratedBindings` | 200,000 |
| `maxSpanLength` | 2,000 |
| `maxRulesPerEvidence` | 1,000 |
| `maxRegexSteps` | 10,000 |

## Commands

```bash
knolo kar domain validate domains/contracts
knolo kar domain inspect domains/contracts
knolo kar domain test domains/contracts
```

`domain test` runs every fixture, compiles the expected fragment, and evaluates the named plan template. It exits 1 when a fixture fails or when a rule never matches. The report lists rules executed, rules matched, rules never matched, fixture pass/fail, proposal counts, and diagnostic counts.

## What a pack leaves alone

A pack helps create CEG Source. It does not modify `kar-1-research-1`, `ceg-source-1`, `KARRoot`, `SemanticRoot`, frontiers, anchors, closure, minimum cover, or certificates. It does not fetch network resources, and it does not contain executable code.
