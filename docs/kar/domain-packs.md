# CEG Domain Packs

A Domain Pack assists semantic production. It does not change KAR. Producer output can require review. A committed CEG remains the input to deterministic KAR evaluation.

Format `ceg-domain-1`. Maturity for the bundled v4 packs is `review-required`. That field is catalog metadata in [`domains/v6-catalog.json`](../../domains/v6-catalog.json). It is not part of `domain.yaml`. An extra key there is `CEG_UNKNOWN_FIELD` and the pack fails to load. `DomainPackRoot` does not hash the README or the catalog.

## Semantic production validation

Human validation of automatic relation commitment is not complete. Initial Domain Packs stay `review-required`. KAR operates deterministically over the committed graph regardless of whether that graph was hand-authored, rule-produced, ontology-produced, or model-assisted.

`AUTO_ACCEPT` commits only what the pack explicitly marks. `NEEDS_REVIEW` does not become a relation until a person accepts it. `OBSERVATION_ONLY` is not committed as a relation. Empty `AUTO_ACCEPT` precision is not 100 percent. It is not established.

Do not describe these packs as validated. A later human-gold pass can move a pack from `review-required` to `validated` without a new KAR version.

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

The version-1 packs are [`domains/contracts`](../../domains/contracts), [`domains/policy`](../../domains/policy), and [`domains/operations`](../../domains/operations). [`domains/generic`](../../domains/generic) is a separate one-relation measurement pack. V6 distributes the latest frozen packs: [`domains/contracts-v4`](../../domains/contracts-v4), [`domains/policy-v4`](../../domains/policy-v4), and [`domains/operations-v4`](../../domains/operations-v4). Their maturity is `review-required`. The earlier directories stay so their frozen roots remain reproducible.

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

Version 2 and version 3 keep the same pack ids and publish new roots. Version 2 is the Phase 10 measurement pack. Version 3 adds `policyClass` and does not replace version 2.

| Pack | Version | DomainPackRoot |
| --- | --- | --- |
| contracts | 2 | `sha256-4c16fdb2edf41fd6c5ca5d20106059210291b01c457980fb0e9565845840cfd0` |
| policy | 2 | `sha256-f412af2b1109b3a8d5837f5f96a98be17a80f4462deb411f4f8fb66a3169ca6e` |
| operations | 2 | `sha256-e8967d09e25ce5f6037444088494773264800d333aecc5d600d0d332764357ed` |
| contracts | 3 | `sha256-6ae56377066d223902532a3cbc092965f377b9be754071891e8b0fcddbcf3008` |
| policy | 3 | `sha256-e8b870e3153bc9037d6b8083fc89d742d320eb9ffa7af507ba3ad40ce0d724f8` |
| operations | 3 | `sha256-b71574dd91b60e29766ebcefda39c13a11f9f5eca965934d1697fec13a9c6d01` |
| contracts | 4 | `sha256-1ffea8ded1877f28ce61c9e98bb79644f8bbe237c22baae6984983d92ede39a5` |
| policy | 4 | `sha256-109ad58943b28a93453205ea86585843931eb69d8a989bcd071e8e48c70eacea` |
| operations | 4 | `sha256-edde04257c55c480c95ce3db90074238a54ab05ee8c9d25135190f5da70f6da4` |

Version 4 adds review-only clause and phrase coverage. It does not replace version 3. No relation rule is `AUTO_ACCEPT`.

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
