# Fixture Regeneration

`simple.knolo` is the committed binary fixture used by the Python tests.

It is generated from the checked-in corpus files:

- `corpus/intro.md`
- `corpus/runtime.md`
- `corpus/other.md`

The root helper script `scripts/regenerate-python-fixture.mjs` rebuilds the fixture with the existing `@knolo/core` TypeScript builder.

Tests mount the committed binary directly, so Node.js is only needed when regenerating the fixture, not at runtime.

From the repo root:

```bash
node scripts/regenerate-python-fixture.mjs
```

Pass `--check` to verify that the working tree bytes still match the corpus without rewriting the file.
