# KITE conformance v1

Small synthetic images. They lock verdicts and `InvarianceRoot` values.
They do not replace the V5 `stateRoot` or a `KARRoot`.

```bash
node conformance/kite/v1/run.mjs
```

`WARRANTED_IN_SCOPE` in this set is the one closed fixture. A tampered
certificate does not verify. `BOUND_EXCEEDED` has no certificate.
