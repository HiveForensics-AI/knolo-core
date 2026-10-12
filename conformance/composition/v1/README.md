# Composition conformance v1

Sixteen offline vectors for composition records, excerpts, attestations, and one KAR byte-equality check on the 6.1.0 tree. A stale composition root, a missing nested host, an excerpt that is not in its parent, and a keyring key outside its validity window fail closed. Those checks do not change the locked roots in `expected.json`.

```bash
node conformance/composition/v1/run.mjs
```

`COMPOSITION_V1_ACCEPT=1` rewrites `expected.json`. Normal runs compare the locked roots, codes, and statuses. The vectors do not lock evidence text, and they do not edit the KAR or coverage locks.

The sentences in the runner are demos. They are not certified law.
