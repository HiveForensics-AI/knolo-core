# `knolo` — V5-compatible Python runtime

**Compatibility status:** V5 Knowledge Image verification and deterministic
lexical object queries, with the existing V1–V3 `.knolo` reader/query APIs
preserved for compatibility. Python does not implement V5 mutation,
coordination, Studio, network transport, or model execution.

The staged cross-runtime plan is [`../../docs/ROADMAP.md`](../../docs/ROADMAP.md).

`knolo` is the pure-Python runtime for mounting existing `.knolo` packs and running deterministic lexical queries locally.

It is intentionally release-scoped for a portable, read-only V5 profile:

- local-first retrieval
- deterministic lexical retrieval
- no vector database
- no embeddings on the default query path
- no Python pack builder or V5 mutation API
- no LangChain or LlamaIndex integration
- no Node.js runtime dependency for mount/query
- no V4 receipt or analyzer-profile compatibility claim
- no V5 Studio management runtime

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

## V5 Knowledge Images

The Python runtime mounts and verifies the shared V5 image contract without a
Node.js dependency at query time:

```python
import base64
from pathlib import Path

from knolo import mount_knowledge_image_v5, query_knowledge_image_v5

fixture = Path("conformance/v5/knowledge-image-v5.fixture.base64")
image = mount_knowledge_image_v5(base64.b64decode(fixture.read_text()))
hits = query_knowledge_image_v5(image, "hello", top_k=5)
print(image.state_root, hits[0].text)
```

`verify_knowledge_image_v5()` returns the verified state root, commit digest,
and active superblock. V5 verification is fail-closed for truncated images,
invalid superblocks, non-canonical CBOR, segment digest mismatches, object or
event identity mismatches, and root mismatches. `query_knowledge_image_v5()`
is a deterministic lexical query over UTF-8 object payloads; policy, authority,
receipts, synchronization, and writes remain host/runtime responsibilities.

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
- `mount_knowledge_image_v5(source)`
- `query_knowledge_image_v5(image, query, ...)`
- `verify_knowledge_image_v5(source)`
- `KnowledgeImageV5`
- `KnowledgeImageVerificationV5`
- `KnowledgeObjectV5`
- `KnowledgeHitV5`
- `InvalidKnowledgeImageError`
- `tokenize()`
- `normalize()`
- `__version__`

## Current Scope

- No Python pack builder or V5 writer
- No semantic reranking
- No embeddings or vector database integration on the default path
- No Node.js runtime dependency at query time
- No LangChain or LlamaIndex adapters in this package
- No V5 Studio, sync transport, authorization, or authority administration
