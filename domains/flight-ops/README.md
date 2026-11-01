# flight-ops domain pack v1

Maturity: `review-required`. Human review is required before a relation proposal is committed. This pack does not change KAR.

Relation-producing rules are `NEEDS_REVIEW`. The metadata rule and the Geofence heading may enter a fragment. They do not state that a flight was safe, legal, or compliant.

`SATISFIED` means the declared evidence requirements were met inside a committed graph. The fixture tests stay `UNSATISFIED_EVIDENCE_REQUIREMENTS` because those relation rules are not auto-accepted. The hand-authored demonstration is `examples/flight-ops`.

DomainPackRoot: `sha256-2cd41797119709225e66356512ad5baec2fc5b460e57c640a741a72d70ada50b`

```bash
knolo kar domain validate domains/flight-ops
knolo kar domain inspect domains/flight-ops
knolo kar domain test domains/flight-ops
```
