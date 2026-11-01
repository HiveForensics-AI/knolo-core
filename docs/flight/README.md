# Flight logs

`knolo flight ingest` packs a `flight-events-1` document and a source log into a V5 Knowledge Image. The command hashes the log. It writes nothing when the hash or the byte length differs from the document. It does not decode ULog, DataFlash, or rosbag2.

A KAR status of `SATISFIED` means the declared evidence requirements were met. `UNSATISFIED_EVIDENCE_REQUIREMENTS` means they were not met. Neither status means a flight was safe, legal, or compliant. Abstention text is `Evidence requirements not satisfied`.

## What is stored

The raw log stays outside the image. The image stores the log SHA-256, the byte length, the parser id and version, and one chunk per discrete event. Phase 1 keeps state transitions and scan sentences. It does not store high-rate IMU or actuator samples. The event file is capped at 2 MiB and 10,000 events.

A byte range of `0,0` means the producer did not have a message offset. The log hash is still the tamper bind.

`log.format` is `ulog` in this slice. DataFlash and rosbag2 are later extractors that emit the same document. DJI logs and live MAVLink are out of scope.

## Commands

```bash
python3 scripts/flight/extract_ulog.py --log flight.ulg --out events.json
knolo flight ingest --events events.json --log flight.ulg --out flight.knolo
```

The extractor is optional. It requires `pyulog==1.2.4` from `scripts/flight/requirements.txt`. `npm test` does not install it. The committed demo uses `examples/flight-ops/events.json` and does not call the extractor.

Mission notes stay on the normal image path. `knolo compose` joins that image with the flight image. `knolo attest` and `knolo verify-attestation` check the composition. `knolo-verify` already accepts those artifacts:

```yaml
images: dist/flight.knolo
kar-graphs: dist/flight.knolo=dist/flight.kar.json
attestations: dist/attestation.json
attestation-args: --content-only
cortex-traces: dist/flight.knolo=dist/answer.cortex.json
```

The action does not hash the external log. Compare the log file with the hash stored in the image before you treat the dossier as bound to those bytes.

`@knolo/mcp` can mount the resulting V5 image with the existing read-only tools. This slice does not add a flight tool and it does not call a model.

## Domain pack

`domains/flight-ops` is `review-required`. Relation rules are `NEEDS_REVIEW`. A regex match is not committed evidence. The hand-authored graph in `examples/flight-ops` is the deterministic demonstration.

```bash
node examples/flight-ops/run.mjs
```

The sample log in that directory is a 95-byte hash fixture. It is not a PX4 recording. Public PX4 samples are large, so this slice does not vendor one. The fixture still produces a byte-identical image and a log-hash mismatch failure.
