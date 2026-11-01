# Flight image demo

Hand-authored phase 1 fixture for issue #89. It is not a claim that a flight was safe or compliant, and it is not a PX4 recording.

`sample.log` is a 95-byte stand-in. Public ULog samples were not vendored because they are large. `events.json` is the canonical `flight-events-1` document for that file. `scripts/flight/extract_ulog.py` is the optional parser for a real `.ulg`.

```bash
npm run build --workspace @knolo/core
node examples/flight-ops/run.mjs
```

The runner checks three evidence requirements:

| Check | Result |
| --- | --- |
| Geofence scan record is committed | `SATISFIED` |
| Failsafe scan record is committed | `SATISFIED` |
| Failsafe requirement with no binding | `UNSATISFIED_EVIDENCE_REQUIREMENTS` |
| Checklist record related to arming by `requires` and `valid_before` | `SATISFIED` |
| Same checklist requirement with the mission chunk removed | `UNSATISFIED_EVIDENCE_REQUIREMENTS` |

`SATISFIED` means those requirements were met. The failsafe chunk can still sit in the image while the gap graph leaves it unbound. Unbound text is not selected evidence.

The runner also verifies a Cortex trace, rejects a tampered citation and a different image, writes a composition attestation, and checks it with `knolo verify-attestation`. A flipped flight image fails `knolo compose verify`. A flipped log fails `knolo flight ingest` and writes nothing.

`domains/flight-ops` stays `review-required`. Its relation rules are not auto-accepted, so `knolo kar domain test` expects `UNSATISFIED_EVIDENCE_REQUIREMENTS` on the pack fixtures.
