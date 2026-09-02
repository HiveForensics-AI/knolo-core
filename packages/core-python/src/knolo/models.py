from __future__ import annotations

from dataclasses import dataclass
from collections.abc import Sequence
from typing import Any


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


@dataclass(slots=True)
class KnowledgeObjectV5:
    id: str
    kind: str
    bytes: bytes
    meta: dict[str, Any]


@dataclass(slots=True)
class KnowledgeImageV5:
    bytes: bytes
    state_root: str
    commit_digest: str
    commit: dict[str, Any]
    objects: tuple[KnowledgeObjectV5, ...]
    events: tuple[dict[str, Any], ...]
    segments: tuple[dict[str, Any], ...]
    active_superblock: str


@dataclass(slots=True)
class KnowledgeImageVerificationV5:
    valid: bool
    state_root: str
    commit_digest: str
    active_superblock: str


@dataclass(slots=True)
class KnowledgeHitV5:
    object_id: str
    kind: str
    score: float
    text: str
    meta: dict[str, Any]


@dataclass(slots=True)
class KnowledgeQueryHitV5:
    object_id: str
    kind: str
    joined_object_ids: tuple[str, ...] = ()


@dataclass(slots=True)
class KnowledgeQueryResultV5:
    version: int
    state_root: str
    plan: dict[str, Any]
    plan_root: str
    hits: tuple[KnowledgeQueryHitV5, ...]
    result_root: str
