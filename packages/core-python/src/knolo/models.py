from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Sequence


FilterInput = str | Sequence[str] | None


@dataclass(slots=True)
class PackStats:
    docs: int
    blocks: int
    terms: int
    avg_block_len: float | None = None


@dataclass(slots=True)
class PackMeta:
    version: int
    stats: PackStats


@dataclass(slots=True)
class Pack:
    meta: PackMeta
    lexicon: dict[str, int]
    postings: tuple[int, ...]
    blocks: tuple[str, ...]
    headings: tuple[str | None, ...]
    doc_ids: tuple[str | None, ...]
    namespaces: tuple[str | None, ...]
    block_token_lens: tuple[int, ...]


@dataclass(slots=True)
class QueryOptions:
    top_k: int = 10
    min_score: float = 0.0
    namespace: FilterInput = None
    source: FilterInput = None


@dataclass(slots=True)
class Hit:
    block_id: int
    score: float
    text: str
    source: str | None = None
    namespace: str | None = None

