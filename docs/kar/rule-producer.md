# Deterministic rule producer

`createRuleCegProducer({ domainPack })` and `runRuleProducer({ pack, image })` emit a `ceg-producer-run-1` from evidence text and metadata. The same image, Domain Pack, and producer version produce the same canonical fragment and, after `compileCegSource()`, the same `SemanticRoot`.

Producer id: `knolo-ceg-rule-producer`. Version: `ceg-rules-1`.

Objects are visited in id order. Rules are visited in id order. Identical semantic items are deduplicated. Conflicting items are both kept. Output does not depend on rule order, object order, or metadata key order.

## Rule language

A rule is data. The pack cannot call `eval`, `Function`, dynamic import, a shell, the filesystem, or the network. Kinds:

| Kind | Effect |
| --- | --- |
| `metadata` | Metadata equality, or `metadataExists`, assigns a concept. |
| `heading` | A markdown heading or a short line with no `.!?` assigns a concept. |
| `phrase` | An exact phrase, or a bounded regex, proposes a relation and binding. |
| `cue` | The same match shape, used for qualifiers such as `except`, `unless`, `subject to`, and `provided that`. |
| `section` | A heading match plus `targetPattern` proposes a section relation. |
| `date` | An explicit cue (`effective`, `until`) captures one ISO date into `validFrom` or `validUntil`. |
| `authority` | A metadata integer, or the literal `authority` plus a number, sets binding authority. |
| `incomplete` | A dangling reference such as `subject to the former` records `CEG_PRODUCER_INCOMPLETE_REFERENCE`. |

`patternMode` is `exact` or `regex`. Exact phrases use letter-and-digit boundaries, so `may terminate` does not match inside `may not terminate`. `excludePattern` drops a match that also contains the excluded text. The shipped packs use exact phrases.

`autoAccept: true` makes a concept, relation, or binding proposal `ACCEPTED`. Otherwise the state is `NEEDS_REVIEW`. Date, authority, and incomplete rules are observations even when `autoAccept` is true. They explain a binding. They do not invent a second semantic item.

CLI `--auto` writes that accepted fragment as CEG Source. It is available for this deterministic producer. See [Producers](producers.md).

## Evidence

Every text match records an observation:

```ts
{
  evidenceId,
  producerId,
  producerVersion,
  ruleId,
  span: { start, end },
  textDigest,
  excerpt
}
```

The evidence alias on the fragment is the object id, with selector `{ objectId }`. The compiler then applies Phase 8 resolution: no match is `CEG_EVIDENCE_NOT_FOUND`, and more than one match is `CEG_EVIDENCE_AMBIGUOUS`.

Rule identity stays on the observation and the proposal. It is not written into `binding.provenance`, because that string is inside the frozen binding id.

Dates and authority are document-level. They attach to every binding on that evidence object. A missing date is a warning and the field is omitted. Two different dates, or two different authorities, on one object omit the field and warn `CEG_PRODUCER_AMBIGUOUS_DATE` or `CEG_PRODUCER_AMBIGUOUS_AUTHORITY`. An impossible `validFrom` / `validUntil` window omits the dates and warns `CEG_PRODUCER_INVALID_WINDOW`. The producer does not invent a date or an authority that the evidence does not state.

Support (`permits`, `requires`, `supports`) and opposition (`prohibits`, `contradicts`) on the same ordered endpoints are both kept, with warning `CEG_PRODUCER_RELATION_CONFLICT`. `qualifies` beside `permits` is not that warning. KAR keeps the opposition. The producer does not pick a winner.

An incomplete reference does not invent the missing target.

## Regex

`regexIsSafe` rejects patterns longer than `maxPatternLength`, backreferences, lookaround, and a group that both contains a quantifier and is itself quantified. `(a+)+`, `(.*)+`, and `(?=a)` are rejected before `RegExp` runs. A safe pattern may use JavaScript regex. Text longer than 8,000 characters on the regex path fails closed. The shipped packs do not use regex.

## Bounds and cache

Generation above `maxGeneratedConcepts`, `maxGeneratedRelations`, `maxGeneratedBindings`, `maxMatchesPerRule`, or `maxRulesPerEvidence` fails the run with `CEG_PRODUCER_LIMIT`. The producer does not silently truncate.

An optional in-memory `ProducerCache` keys `canonicalRun` by `producerInputRoot` (`image` roots, producer id and version, `DomainPackRoot`, config root). A hit returns the parsed canonical JSON. The cache is not committed semantics. Incremental production is deferred: a later incremental mode must match a full run byte for byte. Phase 8 compilation stays a full compile.

## Shipped rule ids

Contracts includes `contracts.termination.permission.v1`, `contracts.termination.prohibition.v1`, and `contracts.exception.unless.v1` among its 23 rules. Policy and operations each ship 17 rules for controls or steps, prohibitions, exceptions, replacement, dates, and authority. Generic ships `generic.metadata.record.v1` and `generic.phrase.related.v1`.

Changing a canonical concept or a rule changes `DomainPackRoot`. Publish that as a new pack version.
