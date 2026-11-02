# Flight image demo

Hand-authored fixture for issue #89. It is not a claim that a flight was safe or compliant, and it is not a PX4 recording.

`sample.log` is a 95-byte ULog stand-in. Public flight recordings were not vendored. `events.json` is the canonical `flight-events-1` document for that file. Optional parsers live in `scripts/flight/`: `extract_ulog.py`, `extract_dataflash.py`, and `extract_rosbag2.py`. `npm test` does not install them.

`dataflash/` and `rosbag2/` are synthetic format fixtures, each well under 100 KiB. They are not flight recordings. `dataflash/sample.bin` is a minimal DataFlash log. `rosbag2/sample.mcap` is one MCAP file, not a bag directory. Its `sensor_msgs/msg/Imu` message is a one-field stand-in so the allowlist can ignore it; it is not a standard IMU layout. Each directory's `expected.json` locks the image state root for that file. The hand-authored KAR graph in this directory is unchanged.

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
