# Flight logs

`knolo flight ingest` packs a `flight-events-1` document and one source log into a V5 Knowledge Image. The command hashes that file. It writes nothing when the hash or the byte length differs from the document. It does not decode the log.

`log.format` is `ulog`, `dataflash`, or `rosbag2`. DJI logs and live MAVLink are out of scope.

A KAR status of `SATISFIED` means the declared evidence requirements were met. `UNSATISFIED_EVIDENCE_REQUIREMENTS` means they were not met. Neither status means a flight was safe, legal, or compliant. Abstention text is `Evidence requirements not satisfied`.

## What is stored

The raw log stays outside the image. The image stores the log SHA-256, the byte length, the parser id and version, and one chunk per discrete event. The producers keep state transitions. They do not store high-rate IMU, image, or point-cloud samples, and they do not emit a scan sentence. The event file is capped at 2 MiB and 10,000 events.

A byte range of `0,0` means the producer did not have a message offset. The log hash is still the tamper bind.

## Commands

```bash
python3 scripts/flight/extract_ulog.py --log flight.ulg --out events.json
python3 scripts/flight/extract_dataflash.py --log flight.bin --out events.json
python3 scripts/flight/extract_rosbag2.py --log flight.mcap --out events.json
knolo flight ingest --events events.json --log flight.ulg --out flight.knolo
```

The extractors are optional. Install them from `scripts/flight/requirements.txt`:

| Parser | Pin | License | `parser.id` |
| --- | --- | --- | --- |
| `pyulog` | `1.2.4` | BSD-3-Clause | `pyulog` |
| `pymavlink` | `2.4.50` | LGPLv3 | `pymavlink` |
| `rosbags` | `0.11.9` | Apache-2.0 | `rosbags` |

None of those libraries is vendored, and none is imported by the published packages. `npm test` does not install them. The committed demo uses `examples/flight-ops/events.json` and does not call an extractor.

`extract_rosbag2.py` hashes one `.mcap` or `.db3` file. A directory is refused with `FLIGHT_ROSBAG_FILE`.

### ULog fields

A failsafe event is recorded only from `vehicle_status.failsafe`. `failsafe_defer_state` is not an asserted failsafe. Link loss is recorded from `gcs_connection_lost` (older logs: `data_link_lost`), `high_latency_data_link_lost`, and `rc_signal_lost`. `telemetry_status` heartbeat fields are not link state. Battery events use `battery_status.remaining` when it crosses below `0.2`. That threshold is producer policy, not an airworthiness limit.

`python3 scripts/flight/test_extract_ulog.py` checks that selection without installing pyulog.

### DataFlash fields

`ARM.ArmState` emits `armed` when non-zero and `disarmed` when zero, including the first sample. `MODE` emits `mode-<Mode>`, or `mode-<ModeNum>` when `Mode` is absent. The number is not translated into a copter or plane name.

`ERR` failsafe events use only these subsystems: 6 battery, 9 fence, 17 ekfinav, 20 adsb, 23 terrain, 26 sensors, 27 leak, 29 vibe, 31 deadreckon. A non-zero `ECode` asserts. Zero clears. An opening zero emits nothing. The name token is the lowercase enum name, such as `failsafe-fence`. Subsystems 5 (radio) and 8 (gcs) are link-loss and link-restored only, not a second failsafe. Compass, flight-mode, crash-check, GPS, and every other `ERR` are ignored. `MSG` text is ignored, including the word failsafe.

`BAT` instance 0 emits `battery-threshold` level `low` when `RemPct` crosses below 20. Instance 1 is ignored. That threshold is producer policy, not an airworthiness limit.

The reader keeps `ARM`, `MODE`, `ERR`, and `BAT` only. Other DataFlash messages, including IMU and actuator samples, are discarded while the file is scanned.

`python3 scripts/flight/test_extract_dataflash.py` checks that selection without installing pymavlink.

### rosbag2 fields

Message types outside this list are ignored:

- `px4_msgs/msg/VehicleStatus` uses the ULog edges above. Event time is the bag timestamp in microseconds, not a timestamp field inside the message. `failsafe_defer_state` is not read.
- `px4_msgs/msg/BatteryStatus` uses the same `remaining` fraction below `0.2`.
- `mavros_msgs/msg/State` maps `armed` to `armed` or `disarmed`, maps `connected` false to link-loss and true to link-restored, and stores `mode` as a nav-mode token. A mode name is not a failsafe.

A valid file with no allowlisted messages writes an empty event list and exits 0. Connections outside the allowlist are not deserialized, so a custom or high-rate message type does not have to load.

`python3 scripts/flight/test_extract_rosbag2.py` checks that selection without installing rosbags.

## Verification

Mission notes stay on the normal image path. `knolo compose` joins that image with the flight image. `knolo attest` and `knolo verify-attestation` check the composition. `knolo-verify` already accepts those artifacts:

```yaml
images: dist/flight.knolo
kar-graphs: dist/flight.knolo=dist/flight.kar.json
attestations: dist/attestation.json
attestation-args: --content-only
cortex-traces: dist/flight.knolo=dist/answer.cortex.json
```

`knolo flight verify-log --image flight.knolo --log flight.ulg` hashes that log again and compares it with the `flight-log` object. A hash or length mismatch exits non-zero with `FLIGHT_LOG_MISMATCH` and writes nothing. An image with no `flight-log` object fails closed. The command does not decode the log.

The Knolo Verify action runs that command when `flight-logs` is set. Each line is `image=log`. Globs are not expanded.

```yaml
flight-logs: dist/flight.knolo=dist/flight.ulg
```

Published `@knolo/cli@6.2.4` does not include `knolo flight verify-log`. Omit `flight-logs` until a later CLI publish. A log-byte mismatch still fails closed at `knolo flight ingest`, which writes nothing. `verify-log` is separate from `knolo cortex verify`. `SATISFIED` means the evidence requirements were met. It does not mean a flight was safe, legal, or compliant.

`@knolo/mcp` can mount the resulting V5 image with the existing read-only tools. This slice does not add a flight tool and it does not call a model.

## Domain pack

`domains/flight-ops` is `review-required`. Relation rules are `NEEDS_REVIEW`. A regex match is not committed evidence. The hand-authored graph in `examples/flight-ops` is the deterministic demonstration.

```bash
node examples/flight-ops/run.mjs
```

The ULog sample in that directory is a 95-byte hash fixture. It is not a PX4 recording. Public PX4 and ArduPilot recordings were not vendored. `examples/flight-ops/dataflash/sample.bin` and `examples/flight-ops/rosbag2/sample.mcap` are synthetic format fixtures, not flight recordings. Each still produces a byte-identical image, and a flipped byte writes nothing.
