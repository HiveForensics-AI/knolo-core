# `knolo`

`knolo` is the pure-Python runtime for mounting existing `.knolo` packs and running deterministic lexical queries locally.

It is intentionally release-scoped for Phase 2:

- local-first retrieval
- deterministic lexical retrieval
- no vector database
- no embeddings on the default query path
- no Python pack builder
- no LangChain or LlamaIndex integration
- no Node.js runtime dependency for mount/query

Packs are still built with `@knolo/core` in TypeScript, then mounted and queried from Python.

## Install

From this package directory:

```bash
python -m pip install -e ".[dev]"
```

For a normal install, omit the extra:

```bash
python -m pip install .
```

## Query

```python
from knolo import mount_pack, query

pack = mount_pack("tests/fixtures/simple.knolo")
hits = query(pack, "alpha beta", top_k=5)

for hit in hits:
    print(hit.block_id, hit.score, hit.text)
```

You can also mount bytes directly:

```python
from pathlib import Path
from knolo import mount_pack_from_bytes

pack = mount_pack_from_bytes(Path("tests/fixtures/simple.knolo").read_bytes())
```

## Release Readiness

The package publishes from GitHub release events via Trusted Publishing. No secret-based PyPI credentials are required in CI.

Before a release, run:

```bash
python -m pytest
python -m build
python -m twine check dist/*
```

A manual upload fallback is still available when needed:

```bash
python -m twine upload dist/*
```

See [`RELEASE.md`](./RELEASE.md) for the release checklist.

## Fixture Regeneration

The committed fixture at `tests/fixtures/simple.knolo` is what tests use, so the test suite does not need Node.js at runtime.

To regenerate the fixture from the checked-in corpus, run the root helper script from the repo root:

```bash
node scripts/regenerate-python-fixture.mjs
```

The script reads `tests/fixtures/corpus/intro.md`, `runtime.md`, and `other.md`, then rewrites the committed binary fixture. Pass `--check` to verify that the committed bytes match the corpus without rewriting.

## API

The public package exports:

- `mount_pack(source)`
- `mount_pack_from_bytes(data)`
- `query(pack, q, ...)`
- `KnoloError`
- `InvalidPackError`
- `PackStats`
- `PackMeta`
- `Pack`
- `QueryOptions`
- `Hit`
- `tokenize()`
- `normalize()`
- `__version__`

## Current Scope

- No Python pack builder yet
- No semantic reranking
- No embeddings or vector database integration on the default path
- No Node.js runtime dependency at query time
- No LangChain or LlamaIndex adapters in this package
